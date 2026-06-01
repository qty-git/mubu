// Gesture routing and hit-testing extracted from app.js in r55.
// Same global-scope style as app.js; behavior should stay unchanged.

    function handGrabsOnSameCloth(cloth) {
      if (!cloth) return [];
      return Array.from(grabs.values()).filter((grab) => grab && grab.cloth === cloth);
    }

    function currentPinchGrabsOnSameCloth(cloth) {
      if (!cloth) return [];
      return Array.from(grabs.values()).filter((grab) => {
        return grab &&
          grab.cloth === cloth &&
          currentHandIds.has(grab.id) &&
          currentPinchIds.has(grab.id);
      });
    }

    function hasTwoHandGrabOnSameCloth(targetGrab) {
      return !!targetGrab && handGrabsOnSameCloth(targetGrab.cloth).length >= 2;
    }

    function markTwoHandScaleLock(cloth, duration = 1500) {
      if (!cloth) return;
      cloth.scaleGestureLockUntil = Math.max(cloth.scaleGestureLockUntil || 0, performance.now() + duration);
    }

    function hasTwoHandScaleLock(cloth) {
      return !!cloth && performance.now() < (cloth.scaleGestureLockUntil || 0);
    }

    function reserveTwoHandScaleIfNeeded(cloth) {
      const same = currentPinchGrabsOnSameCloth(cloth);
      if (same.length < 2) return false;
      // r49: the moment two pinches are on the same rolled/raised curtain, protect
      // them as a scale gesture candidate. This runs before the delayed scale
      // confirmation, so the first frames cannot be misread as rope pull/drop.
      markTwoHandScaleLock(cloth, 1800);
      for (const grab of same) {
        grab.suppressRollRelease = true;
        if (grab.mode !== "scale") grab.mode = "scalePending";
        grab.dropArmed = false;
      }
      return true;
    }

    function isScaleProtectedGrab(grab) {
      if (!grab) return false;
      if (grab.suppressRollRelease) return true;
      if (hasTwoHandScaleLock(grab.cloth)) return true;
      if (grab.mode === "scale" || grab.mode === "scalePending") return true;
      if (dualHandScale && (dualHandScale.aid === grab.id || dualHandScale.bid === grab.id)) return true;
      // When a raised/rolled curtain has two simultaneous pinches, reserve the
      // gesture for scaling immediately. Otherwise the first few frames before
      // scale confirmation can be misread as rope pulling and drop the curtain.
      return grab.cloth && grab.cloth.isRolledOrTied && grab.cloth.isRolledOrTied() && hasTwoHandGrabOnSameCloth(grab);
    }

    function updateDualHandScale() {
      if (currentPinchIds.size < 2) {
        if (dualHandScale) {
          for (const grab of grabs.values()) {
            if (grab.mode === "scale") grab.mode = grab.scaleOnly ? "scaleOnly" : "cloth";
          }
          if (dualHandScale.cloth) markTwoHandScaleLock(dualHandScale.cloth, 500);
        }
        dualHandScale = null;
        return;
      }
      const pair = activeHandGrabsForScaling();
      if (!pair) {
        if (dualHandScale) {
          for (const grab of grabs.values()) {
            if (grab.mode === "scale") grab.mode = grab.scaleOnly ? "scaleOnly" : "cloth";
          }
        }
        if (dualHandScale && dualHandScale.cloth) markTwoHandScaleLock(dualHandScale.cloth, 1200);
        dualHandScale = null;
        return;
      }
      const [a, b] = pair;
      const cloth = a.cloth;
      // r52: two-hand pinching is a different gesture from rope pull-down.
      // When two pinches are on the same curtain, classify both as scale candidates
      // before any rope-drop logic can run. This is a hard gesture routing rule,
      // not a visual/temporary protection workaround.
      markTwoHandScaleLock(cloth, 1800);
      a.suppressRollRelease = true;
      b.suppressRollRelease = true;
      a.mode = a.mode === "scale" ? "scale" : "scalePending";
      b.mode = b.mode === "scale" ? "scale" : "scalePending";
      const distance = Math.max(24, Math.hypot(a.x - b.x, a.y - b.y));
      const centerX = (a.x + b.x) * 0.5;
      const centerY = (a.y + b.y) * 0.5;
      if (!dualHandScale || dualHandScale.cloth !== cloth || !grabs.has(dualHandScale.aid) || !grabs.has(dualHandScale.bid)) {
        dualHandScale = {
          cloth,
          aid: a.id,
          bid: b.id,
          startDistance: distance,
          startScale: cloth.scale,
          lastScale: cloth.scale,
          previousDistance: distance,
          virtualDistance: distance,
          previousCenterX: centerX,
          previousCenterY: centerY,
          startCenterX: centerX,
          startCenterY: centerY,
          stableFrames: 0,
          active: false
        };
      }
      const pairSpeed = Math.max(Math.hypot(a.vx || 0, a.vy || 0), Math.hypot(b.vx || 0, b.vy || 0));
      const distanceDelta = Math.abs(distance - dualHandScale.startDistance);
      const centerDeltaFromStart = Math.hypot(centerX - dualHandScale.startCenterX, centerY - dualHandScale.startCenterY);
      if (pairSpeed < CFG.dualScaleMaxStartSpeed) dualHandScale.stableFrames += 1;
      else dualHandScale.stableFrames = 0;
      if (!dualHandScale.active) {
        const scaleReady = distanceDelta >= CFG.dualScaleDeadZone;
        const panReady = centerDeltaFromStart >= (CFG.dualPanDeadZone || 10);
        if (dualHandScale.stableFrames < CFG.dualScaleConfirmFrames || (!scaleReady && !panReady)) return;
        dualHandScale.active = true;
        dualHandScale.startDistance = distance;
        dualHandScale.startScale = cloth.scale;
        dualHandScale.lastScale = cloth.scale;
        dualHandScale.previousDistance = distance;
        dualHandScale.virtualDistance = distance;
        dualHandScale.previousCenterX = centerX;
        dualHandScale.previousCenterY = centerY;
      }
      a.mode = "scale";
      b.mode = "scale";

      // r54: 双手缩放加入速度判定。
      // 不直接用当前双手距离做比例，而是维护一个“虚拟距离”：
      // 手拉开/合拢越快，同样的实际位移会产生更大的缩放变化。
      // 慢速微调仍然接近原来的 1:1 手感，避免抖动误放大。
      const prevDistance = dualHandScale.previousDistance || distance;
      const distanceStep = distance - prevDistance;
      const stepSpeed = Math.abs(distanceStep);
      const speedGain = constrain(
        1 + stepSpeed / Math.max(1, CFG.dualScaleVelocityDivisor || 18),
        1,
        CFG.dualScaleVelocityMaxGain || 3.4
      );
      dualHandScale.virtualDistance = Math.max(
        24,
        (dualHandScale.virtualDistance || dualHandScale.startDistance) + distanceStep * speedGain
      );
      dualHandScale.previousDistance = distance;

      const rawScale = dualHandScale.startScale * (dualHandScale.virtualDistance / Math.max(24, dualHandScale.startDistance));
      const smoothAmount = constrain(
        (CFG.dualScaleSmoothMin || 0.14) + stepSpeed / 260,
        CFG.dualScaleSmoothMin || 0.14,
        CFG.dualScaleSmoothMax || 0.30
      );
      const smoothedScale = dualHandScale.lastScale + (rawScale - dualHandScale.lastScale) * smoothAmount;
      dualHandScale.lastScale = smoothedScale;
      selectedCloth = cloth;
      // r61: 双手捏住时，除了距离变化控制缩放，双手中点的移动也会平移幕布/媒体区域。
      // 这样放大后不用一直固定在画面中心，可以像双指缩放图片一样移动显示区域。
      const centerStepX = centerX - (dualHandScale.previousCenterX ?? centerX);
      const centerStepY = centerY - (dualHandScale.previousCenterY ?? centerY);
      dualHandScale.previousCenterX = centerX;
      dualHandScale.previousCenterY = centerY;

      cloth.setScaleByGesture(smoothedScale, centerX, centerY);
      const panGain = CFG.dualPanGain || 0.92;
      const maxPanStep = CFG.dualPanMaxStep || 58;
      const panDx = constrain(centerStepX * panGain, -maxPanStep, maxPanStep);
      const panDy = constrain(centerStepY * panGain, -maxPanStep, maxPanStep);
      if (Math.abs(panDx) > 0.01 || Math.abs(panDy) > 0.01) {
        cloth.moveBy(panDx, panDy);
        clampClothPosition(cloth);
      }
      curtainSizeInput.value = cloth.scale.toFixed(2);
    }

    function clampClothPosition(cloth) {
      if (!cloth || !cloth.mediaRect) return;
      const r = cloth.mediaRect;
      let nextX = r.x;
      let nextY = r.y;
      if (r.w <= stageW()) nextX = constrain(r.x, 0, Math.max(0, stageW() - r.w));
      else nextX = constrain(r.x, stageW() - r.w, 0);
      if (r.h <= stageH()) nextY = constrain(r.y, 0, Math.max(0, stageH() - r.h));
      else nextY = constrain(r.y, stageH() - r.h, 0);
      const dx = nextX - r.x;
      const dy = nextY - r.y;
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) cloth.moveBy(dx, dy);
    }

    function frostedHitPadFor(rect) {
      return Math.max(
        CFG.frostedHitPadMin || 82,
        Math.min(rect.w, rect.h) * (CFG.frostedHitPadRatio || 0.22)
      );
    }

    function startFistMove(id, x, y) {
      if (dualHandScale || grabs.size > 0) return;
      const cloth = coverMode === "frosted" ? findFrostedOverlayAt(x, y, "move") : findClothAt(x, y);
      if (!cloth) return;
      selectedCloth = cloth;
      curtainSizeInput.value = selectedCloth.scale.toFixed(2);
      fistMoves.set(id, {
        id,
        x,
        y,
        cloth,
        createdAt: performance.now()
      });
      cloth.settleStart = Infinity;
    }

    function moveFistMove(id, x, y) {
      const move = fistMoves.get(id);
      if (!move || !move.cloth) return;
      const gain = CFG.fistPanGain || 1;
      const maxStep = CFG.fistPanMaxStep || 64;
      const dx = constrain((x - move.x) * gain, -maxStep, maxStep);
      const dy = constrain((y - move.y) * gain, -maxStep, maxStep);
      move.x = x;
      move.y = y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
      selectedCloth = move.cloth;
      move.cloth.moveBy(dx, dy);
      clampClothPosition(move.cloth);
      curtainSizeInput.value = selectedCloth.scale.toFixed(2);
    }

    function releaseFistMove(id) {
      const move = fistMoves.get(id);
      if (move && move.cloth) move.cloth.settleStart = performance.now();
      fistMoves.delete(id);
    }

    function startGrab(id, x, y) {
      // r66: frosted mode is not a physical curtain, but it still needs the
      // two-hand resize/pan gesture. In frosted mode, create only a virtual
      // scale handle inside the display rectangle. It cannot grab, open, drop,
      // impulse, or deform the curtain.
      if (coverMode === "frosted") {
        const cloth = findFrostedOverlayAt(x, y, "pinch");
        if (!cloth) return;
        selectedCloth = cloth;
        curtainSizeInput.value = selectedCloth.scale.toFixed(2);
        grabs.set(id, {
          id,
          x,
          y,
          startX: x,
          startY: y,
          maxY: y,
          createdAt: performance.now(),
          tieSide: "center",
          dropArmed: false,
          suppressRollRelease: true,
          scaleOnly: true,
          vx: 0,
          vy: 0,
          cloth,
          points: [],
          mode: "scaleOnly"
        });
        reserveTwoHandScaleIfNeeded(cloth);
        updateDualHandScale();
        return;
      }

      const candidate = nearestClothPoints(x, y);
      if (!candidate) return;
      selectedCloth = candidate.cloth;
      curtainSizeInput.value = selectedCloth.scale.toFixed(2);
      const initialMode = candidate.scaleOnly ? "scaleOnly" : "cloth";
      grabs.set(id, { id, x, y, startX: x, startY: y, maxY: y, createdAt: performance.now(), tieSide: candidate.cloth.tieSideForX(x, y), dropArmed: false, suppressRollRelease: candidate.scaleOnly || false, scaleOnly: !!candidate.scaleOnly, vx: 0, vy: 0, cloth: candidate.cloth, points: candidate.points, mode: initialMode });
      reserveTwoHandScaleIfNeeded(candidate.cloth);
      updateDualHandScale();
    }

    function moveGrab(id, x, y, vx, vy) {
      const grab = grabs.get(id);
      if (!grab) return;
      grab.x = x;
      grab.y = y;
      grab.maxY = Math.max(grab.maxY || grab.startY || y, y);
      grab.vx = vx;
      grab.vy = vy;

      // Scale must take priority over rope-release when two hands are pinching.
      // Reserve immediately, before the delayed scale detector confirms.
      reserveTwoHandScaleIfNeeded(grab.cloth);
      updateDualHandScale();
      if (isScaleProtectedGrab(grab) || grab.scaleOnly || hasTwoHandScaleLock(grab.cloth)) return;

      if (grab.cloth.isRolledOrTied()) {
        grab.cloth.pullTieOnly(grab.tieSide, grab.maxY, vy > 9);
        // Do not release while the user is still pinching. Crossing 1/2 height only
        // arms the tear-away; releaseGrab() performs the drop after they let go.
        grab.dropArmed = grab.dropArmed || grab.cloth.shouldDropFromRoll(grab.startY, grab.maxY, vy);
      }
    }

    function releaseGrab(id, vx, vy, x, y) {
      const grab = grabs.get(id);
      if (grab && coverMode === "frosted") {
        // r66: frosted mode pinches are virtual scale handles only.
        // Releasing must never trigger curtain drop, impulse, auto-hang, or roll logic.
        grabs.delete(id);
        updateDualHandScale();
        return;
      }
      if (grab) {
        // If this grab participated in two-hand scaling or two-hand scale-pending,
        // releasing it should never drop the rolled curtain. This prevents the
        // second hand release from falling through after the first hand cleared
        // dualHandScale.
        const sameClothGrabs = handGrabsOnSameCloth(grab.cloth);
        const twoHandPinchActive = sameClothGrabs.length >= 2;
        if (twoHandPinchActive) {
          // r52: releasing during a two-hand pinch must never be interpreted as
          // pulling the rope down. The curtain only drops from a single-hand pull
          // that was started in the narrow top/rope hit area.
          for (const item of sameClothGrabs) {
            item.dropArmed = false;
            item.suppressRollRelease = true;
            if (item.mode !== "scale") item.mode = "scalePending";
          }
          markTwoHandScaleLock(grab.cloth, 900);
          grab.cloth.settleStart = performance.now();
        } else if (isScaleProtectedGrab(grab) || grab.scaleOnly || hasTwoHandScaleLock(grab.cloth)) {
          grab.dropArmed = false;
          markTwoHandScaleLock(grab.cloth, 900);
          grab.cloth.settleStart = performance.now();
        } else if (grab.cloth.isRolledOrTied()) {
          const releaseY = Math.max(y, grab.maxY || y);
          const singleHandPulledDown = !grab.scaleOnly && !grab.suppressRollRelease && (grab.dropArmed || grab.cloth.shouldDropFromRoll(grab.startY, releaseY, vy));
          if (singleHandPulledDown) {
            grab.cloth.releaseFromRoll(releaseY);
          } else {
            grab.cloth.pullTieOnly(grab.tieSide, releaseY, vy > 9);
          }
        } else if (grab.cloth.shouldAutoHang(x, y, vy)) {
          grab.cloth.setHung(true);
        } else {
          grab.cloth.impulse(x, y, vx, vy);
          grab.cloth.settleStart = performance.now();
        }
      }
      grabs.delete(id);
      updateDualHandScale();
    }

    function nearestClothPoints(x, y) {
      let best = null;
      for (let i = cloths.length - 1; i >= 0; i--) {
        const cloth = cloths[i];
        let points = [];
        let d = Infinity;
        let scaleOnly = false;

        // r47: rolled-up curtains must not be grabbable across the old full
        // curtain rectangle. When rolled/tied, only the visible top roll strip
        // and the two rope/knot zones are valid hit targets. This prevents a
        // pinch in the empty curtain area from grabbing or dropping the curtain.
        if (cloth.isRolledOrTied()) {
          const left = cloth.tieAnchor("left");
          const right = cloth.tieAnchor("right");
          const leftDist = Math.hypot(x - left.x, y - left.y);
          const rightDist = Math.hypot(x - right.x, y - right.y);
          const side = leftDist <= rightDist ? "left" : "right";
          const anchor = side === "left" ? left : right;
          const anchorDist = Math.min(leftDist, rightDist);

          // r49: make the real pull/drop hit area much smaller. When rolled,
          // only the visible roll line and the knots should act like a grabbable
          // curtain; the old full rectangle is reserved for two-hand scale only.
          const rollPadX = Math.max(10, cloth.mediaRect.w * 0.025);
          const visualRollY = typeof cloth.rolledVisualY === "function" ? cloth.rolledVisualY() : cloth.mediaRect.y;
          const visualRollThickness = typeof cloth.rolledVisualThickness === "function" ? cloth.rolledVisualThickness() : Math.max(24, cloth.mediaRect.h * 0.055);
          const rollTop = visualRollY - Math.max(10, cloth.mediaRect.h * 0.018);
          const rollBottom = visualRollY + Math.max(24, visualRollThickness + cloth.mediaRect.h * 0.022);
          const inTopRollStrip =
            x >= cloth.mediaRect.x - rollPadX &&
            x <= cloth.mediaRect.x + cloth.mediaRect.w + rollPadX &&
            y >= rollTop &&
            y <= rollBottom;

          const ropeRadius = Math.max(22, Math.min(58, cloth.mediaRect.w * 0.055));
          const ropeHit = anchorDist <= ropeRadius;

          // r48: rolled curtains have two hit zones with different meanings:
          // 1) Top roll strip / rope zones: real grab, pull-down, rope release.
          // 2) Original curtain rectangle: scale-only zone for two-hand resize.
          //    A single pinch here must not grab or drop the rolled curtain.
          const scalePad = Math.max(12, cloth.mediaRect.w * 0.025);
          const inScaleRect =
            x >= cloth.mediaRect.x - scalePad &&
            x <= cloth.mediaRect.x + cloth.mediaRect.w + scalePad &&
            y >= cloth.mediaRect.y - scalePad &&
            y <= cloth.mediaRect.y + cloth.mediaRect.h + scalePad;

          if (!inTopRollStrip && !ropeHit && !inScaleRect) continue;

          const isScaleOnly = !inTopRollStrip && !ropeHit && inScaleRect;
          scaleOnly = isScaleOnly;
          const targetX = ropeHit ? anchor.x : constrain(x, cloth.mediaRect.x, cloth.mediaRect.x + cloth.mediaRect.w);
          const targetY = ropeHit ? anchor.y + cloth.mediaRect.h * 0.025 : (isScaleOnly ? constrain(y, cloth.mediaRect.y, cloth.mediaRect.y + cloth.mediaRect.h) : visualRollY + visualRollThickness * 0.55);
          points = cloth.nearestPoints(targetX, targetY);
          d = isScaleOnly ? 9999 + Math.hypot(x - targetX, y - targetY) : (ropeHit ? anchorDist : Math.abs(y - targetY));
          if (isScaleOnly) {
            // r51: scale-only hits must not depend on the current rolled-up
            // mesh points. When the curtain is rolled, the cloth points are
            // compressed near the top, so a pinch in the original media area
            // may have no nearby mesh points. That area should still be valid
            // for two-hand scale, but it must not physically grab or drop the
            // curtain. Keep an empty virtual grab here; scale detection only
            // needs x/y/cloth, not physical points.
            points = [];
          }
        } else {
          points = cloth.nearestPoints(x, y);
          d = points.length ? points[0].d : Infinity;
        }

        if (!points.length && !scaleOnly) continue;
        if (!best || d < best.d) best = { cloth, points, d, scaleOnly };
      }
      return best;
    }

    function findClothAt(x, y) {
      for (let i = cloths.length - 1; i >= 0; i--) {
        if (cloths[i].contains(x, y)) return cloths[i];
      }
      return null;
    }


    function findFrostedOverlayAt(x, y, purpose = "default") {
      for (let i = cloths.length - 1; i >= 0; i--) {
        const r = displayRectFor(cloths[i]);
        const pad = purpose === "default" ? 0 : frostedHitPadFor(r);
        if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return cloths[i];
      }
      return null;
    }

    function findFrostedOverlayForPalm(x, y, radius) {
      // r75: palm erasing should begin as soon as any part of the palm overlaps
      // the frosted rectangle. The palm center does not need to be inside.
      for (let i = cloths.length - 1; i >= 0; i--) {
        const cloth = cloths[i];
        const r = displayRectFor(cloth);
        const nearestX = constrain(x, r.x, r.x + r.w);
        const nearestY = constrain(y, r.y, r.y + r.h);
        const pad = frostedHitPadFor(r);
        if (Math.hypot(x - nearestX, y - nearestY) <= Math.max(1, radius + pad)) return cloth;
      }
      return null;
    }

    function frostRevealAmountFor(cloth) {
      const entry = cloth ? frostEraseMasks.get(cloth.id) : null;
      return entry ? constrain(entry.revealEstimate || 0, 0, 1) : 0;
    }

    function ensureFrostEraseMask(cloth, rect) {
      const key = cloth.id;
      let entry = frostEraseMasks.get(key);
      const base = FROST_CFG.eraseMaskSize || 720;
      const aspect = Math.max(0.2, Math.min(5, rect.w / Math.max(1, rect.h)));
      let mw;
      let mh;
      if (aspect >= 1) {
        mw = base;
        mh = Math.max(160, Math.round(base / aspect));
      } else {
        mh = base;
        mw = Math.max(160, Math.round(base * aspect));
      }
      if (!entry || entry.canvas.width !== mw || entry.canvas.height !== mh) {
        const canvas = document.createElement("canvas");
        canvas.width = mw;
        canvas.height = mh;
        entry = { canvas, ctx: canvas.getContext("2d"), hasMarks: false };
        frostEraseMasks.set(key, entry);
      }
      return entry;
    }

    function addFrostEraseMark(cloth, rect, x, y, r) {
      // r73: draw permanent erase information into a compact offscreen mask.
      // This avoids replaying thousands of circles every frame, which caused
      // the frosted mode to become slower the more the user wiped.
      const entry = ensureFrostEraseMask(cloth, rect);
      const mask = entry.canvas;
      const mctx = entry.ctx;
      // r75: do not clamp the eraser center. If only part of the palm enters
      // the frosted area, the offscreen canvas clipping naturally reveals only
      // that small overlapping part instead of popping a full circle at the edge.
      const u = (x - rect.x) / Math.max(1, rect.w);
      const v = (y - rect.y) / Math.max(1, rect.h);
      const mx = u * mask.width;
      const my = v * mask.height;
      const rx = Math.max(2, r / Math.max(1, rect.w) * mask.width);
      const ry = Math.max(2, r / Math.max(1, rect.h) * mask.height);
      const soft = constrain(FROST_CFG.eraseSoftEdge ?? 0.18, 0.02, 0.45);
      const outer = 1;
      const inner = Math.max(0.05, 1 - soft);

      mctx.save();
      mctx.translate(mx, my);
      mctx.scale(rx, ry);
      const g = mctx.createRadialGradient(0, 0, inner, 0, 0, outer);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.72, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = g;
      mctx.globalCompositeOperation = "source-over";
      mctx.beginPath();
      mctx.arc(0, 0, 1, 0, Math.PI * 2);
      mctx.fill();
      mctx.restore();
      entry.hasMarks = true;
      const add = Math.PI * r * r / Math.max(1, rect.w * rect.h) * 0.55;
      entry.revealEstimate = constrain((entry.revealEstimate || 0) + add, 0, 1);
    }

    function updatePalmErase(tracks) {
      if (coverMode !== "frosted") {
        palmErasers = [];
        frostEraseTargets.clear();
        frostEraseLastSamples.clear();
        return;
      }
      const targets = [];
      const activeIds = new Set();
      for (const hand of tracks || []) {
        if (!hand || !hand.palmOpen || hand.pinching) continue;
        const x = hand.palmX ?? hand.x;
        const y = hand.palmY ?? hand.y;
        const palmDiameter = hand.palmEraseDiameter || ((hand.palmEraseRadius || FROST_CFG.eraseRadius) * 2);
        const rawR = constrain(
          palmDiameter * (FROST_CFG.erasePalmDiameterScale || 1.0) * 0.5,
          FROST_CFG.eraseRadiusMin || 30,
          FROST_CFG.eraseRadiusMax || 230
        );
        const cloth = findFrostedOverlayForPalm(x, y, rawR);
        if (!cloth) continue;
        const id = hand.id ?? `${cloth.id}-palm`;
        activeIds.add(id);
        const target = { clothId: cloth.id, cloth, x, y, r: rawR, at: performance.now() };
        frostEraseTargets.set(id, target);
        targets.push({ x, y, cloth, r: rawR });
      }
      for (const id of Array.from(frostEraseTargets.keys())) {
        if (!activeIds.has(id)) frostEraseTargets.delete(id);
      }
      palmErasers = targets;
    }

    function processPalmEraseFrame() {
      if (coverMode !== "frosted") return;
      const now = performance.now();
      const maxAge = FROST_CFG.eraseTargetMaxAge || 170;
      const activeIds = new Set();
      for (const [id, target] of frostEraseTargets.entries()) {
        if (!target || now - target.at > maxAge) {
          frostEraseTargets.delete(id);
          continue;
        }
        const cloth = target.cloth || cloths.find((item) => item && item.id === target.clothId);
        if (!cloth) continue;
        const rect = displayRectFor(cloth);
        activeIds.add(id);
        const last = frostEraseLastSamples.get(id);
        const posFollow = FROST_CFG.erasePositionFollow ?? 0.62;
        const radiusFollow = FROST_CFG.eraseRadiusSmooth ?? 0.72;
        let x = target.x;
        let y = target.y;
        let r = target.r;
        if (last && last.clothId === cloth.id) {
          x = last.x + (target.x - last.x) * posFollow;
          y = last.y + (target.y - last.y) * posFollow;
          r = last.r + (target.r - last.r) * radiusFollow;
          const dx = x - last.x;
          const dy = y - last.y;
          const distance = Math.hypot(dx, dy);
          const step = Math.max(2, r * (FROST_CFG.eraseStepFactor || 0.05));
          const steps = Math.max(1, Math.ceil(distance / step));
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            addFrostEraseMark(
              cloth,
              rect,
              last.x + dx * t,
              last.y + dy * t,
              last.r + (r - last.r) * t
            );
          }
        } else {
          addFrostEraseMark(cloth, rect, x, y, r);
        }
        frostEraseLastSamples.set(id, { clothId: cloth.id, x, y, r, at: now });
      }
      for (const id of Array.from(frostEraseLastSamples.keys())) {
        if (!activeIds.has(id) && !frostEraseTargets.has(id)) frostEraseLastSamples.delete(id);
      }
      // r74: erase history lives in frostEraseMasks, so there is no growing mark list to trim.
    }
