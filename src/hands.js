// Extracted from app.js in r56.
// Kept in global-scope script style to preserve existing behavior.

    async function initHands() {
      if (handsReady) return true;
      if (typeof Hands === "undefined") {
        setStatus("手势库加载失败。仍可用鼠标/触摸拖动幕布。", true);
        return false;
      }
      try {
        hands = new Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.62,
          minTrackingConfidence: 0.62,
          selfieMode: false
        });
        hands.onResults(onHandsResults);
        handsReady = true;
        setStatus("手势识别已就绪。");
        return true;
      } catch (err) {
        console.warn("MediaPipe Hands init error", err);
        setStatus("手势识别初始化失败。仍可用鼠标/触摸拖动幕布。", true);
        return false;
      }
    }
    function requestHandsLoop() {
      if (!started || !handsReady) return;
      const loop = async () => {
        if (cameraVideo.readyState >= 2 && !sendingHands) {
          sendingHands = true;
          try {
            await hands.send({ image: cameraVideo });
          } catch (err) {
            console.warn("MediaPipe Hands error", err);
          } finally {
            sendingHands = false;
          }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    function onHandsResults(results) {
      const detections = (results.multiHandLandmarks || []).map((landmarks) => handFromLandmarks(landmarks));
      const previous = handTracks;
      const next = [];
      const used = new Set();
      currentHandIds = new Set();
      currentPinchIds = new Set();

      for (const hand of detections) {
        let best = null;
        let bestDist = Infinity;
        for (const track of previous) {
          if (used.has(track.id)) continue;
          const d = dist2(hand.x, hand.y, track.x, track.y);
          if (d < bestDist && Math.sqrt(d) < CFG.matchRadius) {
            best = track;
            bestDist = d;
          }
        }
        if (!best) {
          best = {
            id: nextHandId++,
            x: hand.x,
            y: hand.y,
            prevX: hand.x,
            prevY: hand.y,
            vx: 0,
            vy: 0,
            pinchFrames: 0,
            releaseFrames: 0,
            triMoveFrames: 0,
            triMoveReleaseFrames: 0,
            pinchCooldownUntil: 0,
            pinching: false
          };
        } else {
          used.add(best.id);
        }

        const wasPinching = best.pinching;
        const wasTriMoving = best.triMoving;
        const now = performance.now();
        best.prevX = best.x;
        best.prevY = best.y;
        best.x = hand.x;
        best.y = hand.y;
        best.vx = best.x - best.prevX;
        best.vy = best.y - best.prevY;
        best.ratio = hand.ratio;
        best.absDist = hand.absDist;
        best.palmX = hand.palmX;
        best.palmY = hand.palmY;
        best.palmSize = hand.palmSize;
        best.palmOpen = hand.palmOpen;
        best.triPinch = hand.triPinch;
        best.triX = hand.triX;
        best.triY = hand.triY;
        best.triRatio = hand.triRatio;
        const handSpeed = Math.hypot(best.vx, best.vy);
        const triLooksReal = hand.triPinch &&
          hand.triRatio < (wasTriMoving ? (CFG.triMoveOffRatio || 0.42) : (CFG.triMoveOnRatio || 0.30)) &&
          hand.triAbs < (CFG.triMoveOnAbs || 0.085) * (wasTriMoving ? 1.35 : 1) &&
          now > (best.pinchCooldownUntil || 0);
        // r34: avoid single-frame false pinches from fast hand motion.
        // A new pinch must be both relatively small and absolutely close for a few frames.
        const pinchLooksReal = !triLooksReal && hand.ratio < CFG.pinchOnRatio && hand.absDist < CFG.pinchOffAbs;
        const pinchStillValid = !triLooksReal && hand.ratio < CFG.pinchOffRatio && hand.absDist < CFG.pinchOffAbs * 1.18;
        if (wasPinching ? pinchStillValid : pinchLooksReal) {
          best.pinchFrames = (best.pinchFrames || 0) + 1;
          best.releaseFrames = 0;
        } else {
          best.releaseFrames = (best.releaseFrames || 0) + 1;
          best.pinchFrames = 0;
        }
        if (!wasPinching) {
          best.pinching = best.pinchFrames >= CFG.pinchConfirmFrames && handSpeed < CFG.maxPinchStartSpeed;
        } else if (best.releaseFrames >= CFG.pinchReleaseFrames) {
          best.pinching = false;
          best.pinchCooldownUntil = now + (CFG.triMoveCooldownMs || 420);
        }

        if (!best.pinching && triLooksReal) {
          best.triMoveFrames = (best.triMoveFrames || 0) + 1;
          best.triMoveReleaseFrames = 0;
        } else {
          best.triMoveReleaseFrames = (best.triMoveReleaseFrames || 0) + 1;
          best.triMoveFrames = 0;
        }
        if (!wasTriMoving) {
          best.triMoving = best.triMoveFrames >= (CFG.triMoveConfirmFrames || 4) && handSpeed < (CFG.triMoveMaxStartSpeed || 42);
        } else if (best.pinching || best.triMoveReleaseFrames >= (CFG.triMoveReleaseFrames || 5)) {
          best.triMoving = false;
        }
        best.wasPinching = wasPinching;
        best.wasTriMoving = wasTriMoving;
        currentHandIds.add(best.id);
        if (best.pinching) currentPinchIds.add(best.id);
        next.push(best);
      }

      for (const track of previous) {
        if (!next.find((item) => item.id === track.id) && grabs.has(track.id)) {
          releaseGrab(track.id, track.vx || 0, track.vy || 0, track.x || stageW() / 2, track.y || stageH() / 2);
        }
        if (!next.find((item) => item.id === track.id) && handMoves.has(track.id)) {
          releaseHandMove(track.id);
        }
      }

      for (const hand of next) {
        const moveX = hand.triX ?? hand.palmX ?? hand.x;
        const moveY = hand.triY ?? hand.palmY ?? hand.y;
        if (!hand.wasPinching && hand.pinching) startGrab(hand.id, hand.x, hand.y);
        if (hand.pinching) moveGrab(hand.id, hand.x, hand.y, hand.vx, hand.vy);
        if (hand.wasPinching && !hand.pinching) releaseGrab(hand.id, hand.vx, hand.vy, hand.x, hand.y);
        if (!hand.wasTriMoving && hand.triMoving) startHandMove(hand.id, moveX, moveY);
        if (hand.triMoving) moveHandMove(hand.id, moveX, moveY);
        if (hand.wasTriMoving && !hand.triMoving) releaseHandMove(hand.id);
      }
      if (currentPinchIds.size < 2 && dualHandScale) updateDualHandScale();

      handTracks = next;
      updatePalmErase(next);
      const first = next[0];
      lastDebug = {
        ratio: first ? first.ratio.toFixed(2) : "-",
        dist: first ? first.absDist.toFixed(3) : "-",
        hands: next.length,
        pinches: next.filter((item) => item.pinching).length,
        scaling: !!(dualHandScale && dualHandScale.active),
        scaleHands: dualHandScale && dualHandScale.active ? 2 : 0,
        lastFrameAt: performance.now(),
        palms: next.filter((item) => item.palmOpen && !item.pinching).length,
        triMoves: next.filter((item) => item.triMoving).length
      };
    }
    function handFromLandmarks(lm) {
      const thumb = lm[4];
      const index = lm[8];
      const middle = lm[12];
      const ring = lm[16];
      const pinky = lm[20];
      const wrist = lm[0];
      const middleBase = lm[9];
      const sx = mirrorCamera ? 1 - (thumb.x + index.x) * 0.5 : (thumb.x + index.x) * 0.5;
      const sy = (thumb.y + index.y) * 0.5;
      const tx = mirrorCamera ? 1 - thumb.x : thumb.x;
      const ix = mirrorCamera ? 1 - index.x : index.x;
      const mx = mirrorCamera ? 1 - middle.x : middle.x;
      const rx = mirrorCamera ? 1 - ring.x : ring.x;
      const kx = mirrorCamera ? 1 - pinky.x : pinky.x;
      const sw = stageW();
      const sh = stageH();
      const thumbIndexPx = Math.hypot((tx - ix) * sw, (thumb.y - index.y) * sh);
      const palmPx = Math.max(1, Math.hypot((wrist.x - middleBase.x) * sw, (wrist.y - middleBase.y) * sh));
      const thumbMiddlePx = Math.hypot((tx - mx) * sw, (thumb.y - middle.y) * sh);
      const indexMiddlePx = Math.hypot((ix - mx) * sw, (index.y - middle.y) * sh);
      const triClusterPx = Math.max(thumbIndexPx, thumbMiddlePx, indexMiddlePx);
      const triCx = (tx + ix + mx) / 3;
      const triCy = (thumb.y + index.y + middle.y) / 3;
      const ringAwayPx = Math.hypot((rx - triCx) * sw, (ring.y - triCy) * sh);
      const pinkyAwayPx = Math.hypot((kx - triCx) * sw, (pinky.y - triCy) * sh);

      const palmIndices = [0, 5, 9, 13, 17];
      let px = 0;
      let py = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of lm) {
        const lx = mirrorCamera ? 1 - point.x : point.x;
        const ly = point.y;
        minX = Math.min(minX, lx);
        minY = Math.min(minY, ly);
        maxX = Math.max(maxX, lx);
        maxY = Math.max(maxY, ly);
      }
      for (const idx of palmIndices) {
        px += mirrorCamera ? 1 - lm[idx].x : lm[idx].x;
        py += lm[idx].y;
      }
      px /= palmIndices.length;
      py /= palmIndices.length;
      const handBoxSize = Math.max((maxX - minX) * sw, (maxY - minY) * sh);
      const indexBase = lm[5];
      const pinkyBase = lm[17];
      const thumbCmc = lm[1];
      const thumbMcp = lm[2];
      const ixBase = mirrorCamera ? 1 - indexBase.x : indexBase.x;
      const pxBase = mirrorCamera ? 1 - pinkyBase.x : pinkyBase.x;
      const thumbCmcX = mirrorCamera ? 1 - thumbCmc.x : thumbCmc.x;
      const thumbMcpX = mirrorCamera ? 1 - thumbMcp.x : thumbMcp.x;
      const palmHorizontalDiameter = Math.abs(ixBase - pxBase) * sw;

      // r74: use the visible palm body rather than the whole hand/fingers.
      // The eraser diameter should follow the real palm horizontal diameter,
      // with a gentle perspective curve so near/far movement is more obvious.
      const palmBodyPoints = [thumbCmc, thumbMcp, indexBase, middleBase, lm[13], pinkyBase];
      const palmBodyXs = palmBodyPoints.map((point) => (mirrorCamera ? 1 - point.x : point.x));
      const palmBodyYs = palmBodyPoints.map((point) => point.y);
      const palmBodyWidth = (Math.max(...palmBodyXs) - Math.min(...palmBodyXs)) * sw;
      const palmBodyHeight = (Math.max(...palmBodyYs) - Math.min(...palmBodyYs)) * sh;
      const palmCore = Math.max(1, palmHorizontalDiameter * 1.16, palmBodyWidth * 1.06, palmBodyHeight * 1.18, palmPx * 1.28);
      const palmRef = Math.max(54, Math.min(sw, sh) * 0.145);
      const palmNorm = constrain(palmCore / palmRef, 0.42, 2.75);
      const palmEraseDiameter = palmRef * Math.pow(palmNorm, 1.28);
      const fingerTriples = [[8, 6], [12, 10], [16, 14], [20, 18]];
      let extended = 0;
      let curled = 0;
      for (const [tipIdx, pipIdx] of fingerTriples) {
        const tip = lm[tipIdx];
        const pip = lm[pipIdx];
        const tipD = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
        const pipD = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
        if (tipD > pipD * 1.08) extended++;
        if (tipD < pipD * 1.04) curled++;
      }
      const palmOpen = extended >= 3;
      const fistClosed = curled >= 3 && extended <= 1;
      const triRatio = triClusterPx / palmPx;
      const triAbs = triClusterPx / Math.min(sw, sh);
      const spareFingersAway = Math.min(ringAwayPx, pinkyAwayPx) / palmPx > 0.42;
      const triPinch = triRatio < (CFG.triMoveOffRatio || 0.42) &&
        triAbs < (CFG.triMoveOnAbs || 0.085) * 1.35 &&
        spareFingersAway &&
        !fistClosed;
      return {
        x: sx * sw,
        y: sy * sh,
        triX: triCx * sw,
        triY: triCy * sh,
        palmX: px * sw,
        palmY: py * sh,
        palmSize: palmPx,
        palmEraseRadius: palmEraseDiameter * 0.5,
        palmEraseDiameter,
        handBoxSize,
        palmOpen,
        triPinch,
        triRatio,
        triAbs,
        ratio: thumbIndexPx / palmPx,
        absDist: thumbIndexPx / Math.min(sw, sh)
      };
    }
