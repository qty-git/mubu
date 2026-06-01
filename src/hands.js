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
            fistFrames: 0,
            fistReleaseFrames: 0,
            pinching: false
          };
        } else {
          used.add(best.id);
        }

        const wasPinching = best.pinching;
        const wasFisting = best.fisting;
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
        best.fistClosed = hand.fistClosed;
        const handSpeed = Math.hypot(best.vx, best.vy);
        // r34: avoid single-frame false pinches from a fast moving fist.
        // A new pinch must be both relatively small and absolutely close for a few frames.
        const pinchLooksReal = hand.ratio < CFG.pinchOnRatio && hand.absDist < CFG.pinchOffAbs;
        const pinchStillValid = hand.ratio < CFG.pinchOffRatio && hand.absDist < CFG.pinchOffAbs * 1.18;
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
        }

        if (!best.pinching && hand.fistClosed) {
          best.fistFrames = (best.fistFrames || 0) + 1;
          best.fistReleaseFrames = 0;
        } else {
          best.fistReleaseFrames = (best.fistReleaseFrames || 0) + 1;
          best.fistFrames = 0;
        }
        if (!wasFisting) {
          best.fisting = best.fistFrames >= (CFG.fistConfirmFrames || 3) && handSpeed < (CFG.fistMaxStartSpeed || 72);
        } else if (best.pinching || best.fistReleaseFrames >= (CFG.fistReleaseFrames || 4)) {
          best.fisting = false;
        }
        best.wasPinching = wasPinching;
        best.wasFisting = wasFisting;
        currentHandIds.add(best.id);
        if (best.pinching) currentPinchIds.add(best.id);
        next.push(best);
      }

      for (const track of previous) {
        if (!next.find((item) => item.id === track.id) && grabs.has(track.id)) {
          releaseGrab(track.id, track.vx || 0, track.vy || 0, track.x || stageW() / 2, track.y || stageH() / 2);
        }
        if (!next.find((item) => item.id === track.id) && fistMoves.has(track.id)) {
          releaseFistMove(track.id);
        }
      }

      for (const hand of next) {
        const moveX = hand.palmX ?? hand.x;
        const moveY = hand.palmY ?? hand.y;
        if (!hand.wasPinching && hand.pinching) startGrab(hand.id, hand.x, hand.y);
        if (hand.pinching) moveGrab(hand.id, hand.x, hand.y, hand.vx, hand.vy);
        if (hand.wasPinching && !hand.pinching) releaseGrab(hand.id, hand.vx, hand.vy, hand.x, hand.y);
        if (!hand.wasFisting && hand.fisting) startFistMove(hand.id, moveX, moveY);
        if (hand.fisting) moveFistMove(hand.id, moveX, moveY);
        if (hand.wasFisting && !hand.fisting) releaseFistMove(hand.id);
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
        fists: next.filter((item) => item.fisting).length
      };
    }
    function handFromLandmarks(lm) {
      const thumb = lm[4];
      const index = lm[8];
      const wrist = lm[0];
      const middleBase = lm[9];
      const sx = mirrorCamera ? 1 - (thumb.x + index.x) * 0.5 : (thumb.x + index.x) * 0.5;
      const sy = (thumb.y + index.y) * 0.5;
      const tx = mirrorCamera ? 1 - thumb.x : thumb.x;
      const ix = mirrorCamera ? 1 - index.x : index.x;
      const sw = stageW();
      const sh = stageH();
      const thumbIndexPx = Math.hypot((tx - ix) * sw, (thumb.y - index.y) * sh);
      const palmPx = Math.max(1, Math.hypot((wrist.x - middleBase.x) * sw, (wrist.y - middleBase.y) * sh));

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
      return {
        x: sx * sw,
        y: sy * sh,
        palmX: px * sw,
        palmY: py * sh,
        palmSize: palmPx,
        palmEraseRadius: palmEraseDiameter * 0.5,
        palmEraseDiameter,
        handBoxSize,
        palmOpen,
        fistClosed,
        ratio: thumbIndexPx / palmPx,
        absDist: thumbIndexPx / Math.min(sw, sh)
      };
    }
