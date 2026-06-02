    // setStatus() moved to src/ui.js in r56.

    let viewportResizeTimer = null;

    // hasCameraSupport() moved to src/camera.js in r56.


    function setup() {
      updateViewportVars();
      const cnv = createCanvas(appViewportWidth(), appViewportHeight());
      canvasEl = cnv.elt;
      cnv.elt.addEventListener("pointerdown", onPointerDown, { passive: false });
      cnv.elt.addEventListener("pointermove", onPointerMove, { passive: false });
      cnv.elt.addEventListener("pointerup", onPointerUp, { passive: false });
      cnv.elt.addEventListener("pointercancel", onPointerUp, { passive: false });
      ctx = drawingContext;
      pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      updateStageRect();
      rebuildCloths();
      noStroke();
      textFont("ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
      updateCoverModeUI();
    }

    // stageW() moved to src/geometry.js in r56.


    // stageH() moved to src/geometry.js in r56.


    // isMobileLayout() moved to src/geometry.js in r56.


    // resolveStageAspect() moved to src/geometry.js in r56.


    // updateStageRect() moved to src/geometry.js in r56.


    // screenToStage() moved to src/geometry.js in r56.


    // drawStageFrame() moved to src/geometry.js in r56.


    function draw() {
      clear();
      updateStageRect();
      ctx.fillStyle = "#050607";
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(stageRect.x, stageRect.y, stageRect.w, stageRect.h);
      ctx.clip();
      ctx.translate(stageRect.x, stageRect.y);
      drawCameraBackground();
      drawMediaLayer();
      if (typeof processPalmEraseFrame === "function") processPalmEraseFrame();
      for (const cloth of cloths) {
        cloth.step();
        cloth.render(ctx);
      }
      ctx.restore();
      drawStageFrame();
      updateMediaAudio();
      updateDebug();
      updateGestureHud();
    }

    function windowResized() {
      resizeForViewport();
    }

    function resizeForViewport() {
      updateViewportVars();
      const nextW = appViewportWidth();
      const nextH = appViewportHeight();
      if (nextW !== width || nextH !== height) resizeCanvas(nextW, nextH);
      updateStageRect();
      rebuildCloths();
    }

    function scheduleViewportResize(delay = 90) {
      clearTimeout(viewportResizeTimer);
      viewportResizeTimer = setTimeout(resizeForViewport, delay);
    }

    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      setStatus("正在启动摄像头和手势识别…");
      ensureAudioGraph();
      const cameraOk = await initCamera();
      const handsOk = await initHands();
      started = true;
      startOverlay.classList.add("hidden");
      startBtn.disabled = false;
      if (cameraOk && handsOk) {
        requestHandsLoop();
      } else {
        debugEl.textContent = cameraOk ? "Hands: unavailable，已启用鼠标/触摸模式" : "Camera: unavailable，已启用鼠标/触摸模式";
      }
    });

    flipBtn.addEventListener("click", async () => {
      facingMode = facingMode === "user" ? "environment" : "user";
      mirrorCamera = facingMode === "user";
      await initCamera();
    });

    modeBtn.addEventListener("click", () => {
      dragMode = !dragMode;
      pointerGrab = null;
      moveDrag = null;
      pointerDown = false;
      updateCoverModeUI();
    });

    recordBtn.addEventListener("click", () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      } else {
        startRecording();
      }
    });

    sizeTargetBtn.addEventListener("click", () => {
      sizeAllCurtains = !sizeAllCurtains;
      updateCoverModeUI();
    });

    eyeBtn.addEventListener("click", () => {
      document.body.classList.toggle("ui-hidden");
      eyeBtn.textContent = document.body.classList.contains("ui-hidden") ? "◎" : "◉";
    });

    if (debugToggleBtn) {
      debugToggleBtn.addEventListener("click", () => {
        debugVisible = !debugVisible;
        localStorage.setItem("curtainDebugVisible", debugVisible ? "1" : "0");
        updateDebugModeUI();
        lastDebugUpdateAt = 0;
        updateDebug();
        updateGestureHud();
      });
    }



    if (coverModeBtn) {
      coverModeBtn.addEventListener("click", () => {
        coverMode = coverMode === "transparent" ? "frosted" : "transparent";
        localStorage.setItem("curtainCoverMode", coverMode);
        // r63: frosted mode is a strict overlay mode, not a physical curtain.
        // Clear active cloth grabs so it cannot be pinched/opened.
        grabs.clear();
        handMoves.clear();
        pointerGrab = null;
        moveDrag = null;
        dualHandScale = null;
        frostEraseMarks = [];
        palmErasers = [];
        frostEraseTargets.clear();
        frostEraseLastSamples.clear();
        frostEraseMasks.clear();
        frostRevealLayers.clear();
        updateCoverModeUI();
      });
    }

    if (frostResetBtn) {
      frostResetBtn.addEventListener("click", () => {
        frostEraseMarks = [];
        palmErasers = [];
        frostEraseTargets.clear();
        frostEraseLastSamples.clear();
        frostEraseMasks.clear();
        frostRevealLayers.clear();
      });
    }

    if (greenScreenBtn) {
      greenScreenBtn.addEventListener("click", () => {
        greenScreenEnabled = !greenScreenEnabled;
        localStorage.setItem("curtainGreenScreen", greenScreenEnabled ? "1" : "0");
        updateCoverModeUI();
      });
    }

    if (greenAspectSelect) {
      greenAspectSelect.addEventListener("change", () => {
        greenAspectKey = greenAspectSelect.value;
        localStorage.setItem("curtainGreenAspect", greenAspectKey);
      });
    }


    scaleInput.addEventListener("input", () => {
      mediaScale = Number(scaleInput.value);
    });

    curtainSizeInput.addEventListener("input", () => {
      const value = Number(curtainSizeInput.value);
      const targets = sizeAllCurtains ? cloths : [selectedCloth || cloths[0]].filter(Boolean);
      for (const cloth of targets) cloth.setScale(value);
    });

    aspectSelect.addEventListener("change", async () => {
      stageAspectKey = aspectSelect.value;
      updateStageRect();
      rebuildCloths();
      if (started) await initCamera();
    });

    mediaInput.addEventListener("change", () => {
      const files = Array.from(mediaInput.files || []);
      if (!files.length) return;
      disposeMediaItems();
      mediaItems = files.map((file, index) => createMediaItem(file, index));
      rebuildCloths();
    });

    // createMediaItem() moved to src/media.js in r56.


    // disposeMediaItems() moved to src/media.js in r56.


    // ensureAudioGraph() moved to src/audio.js in r56.


    // setupVideoAudio() moved to src/audio.js in r56.


    // updateMediaAudio() moved to src/audio.js in r56.


    // startRecording() moved to src/recorder.js in r56.


    // cameraConstraints() moved to src/camera.js in r56.


    // initCamera() moved to src/camera.js in r56.


    // initHands() moved to src/hands.js in r56.


    // requestHandsLoop() moved to src/hands.js in r56.


    // onHandsResults() moved to src/hands.js in r56.


    // handFromLandmarks() moved to src/hands.js in r56.


    // drawCameraBackground() moved to src/camera.js in r56.


    // drawMediaLayer() moved to src/media.js in r56.


    // drawCover() moved to src/geometry.js in r56.


    // mediaReady() moved to src/geometry.js in r56.


    // Point, Stick, and Cloth moved to src/cloth.js in r58.

    // defaultClothRect() moved to src/geometry.js in r56.


    // scaleRect() moved to src/geometry.js in r56.


    function rebuildCloths() {
      if (mediaItems.length) {
        cloths = mediaItems.map((item, index) => new Cloth(item, index, mediaItems.length));
      } else {
        cloths = [new Cloth(null, 0, 1)];
      }
      selectedCloth = cloths[0] || null;
      grabs.clear();
      handMoves.clear();
      pointerGrab = null;
      moveDrag = null;
    }

    // handGrabsOnSameCloth() moved to src/gestures.js in r55.

    // hasTwoHandGrabOnSameCloth() moved to src/gestures.js in r55.

    // markTwoHandScaleLock() moved to src/gestures.js in r55.

    // hasTwoHandScaleLock() moved to src/gestures.js in r55.

    // reserveTwoHandScaleIfNeeded() moved to src/gestures.js in r55.

    // isScaleProtectedGrab() moved to src/gestures.js in r55.

    function activeHandGrabsForScaling() {
      const now = performance.now();
      const active = Array.from(grabs.values()).filter((grab) => {
        if (!grab || !grab.cloth) return false;
        if (!currentHandIds.has(grab.id) || !currentPinchIds.has(grab.id)) return false;
        const speed = Math.hypot(grab.vx || 0, grab.vy || 0);
        const age = now - (grab.createdAt || now);
        // r49: scale-only / scale-pending grabs are intentionally allowed to
        // enter the scaling detector quickly; the detector still waits for a
        // real distance change before applying scale.
        if (grab.scaleOnly || grab.mode === "scalePending" || grab.suppressRollRelease) {
          return age > 20 && speed < CFG.dualScaleMaxStartSpeed * 1.8;
        }
        return age > 120 && speed < CFG.dualScaleMaxStartSpeed;
      });
      if (active.length < 2) return null;
      const minPairDistance = Math.max(CFG.dualScaleMinHandDistance || 120, Math.min(stageW(), stageH()) * 0.20);
      for (let i = 0; i < active.length - 1; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const d = Math.hypot(active[i].x - active[j].x, active[i].y - active[j].y);
          if (active[i].cloth === active[j].cloth && d >= minPairDistance) return [active[i], active[j]];
        }
      }
      return null;
    }

    // updateDualHandScale() moved to src/gestures.js in r55.

    // startGrab() moved to src/gestures.js in r55.

    // moveGrab() moved to src/gestures.js in r55.

    // releaseGrab() moved to src/gestures.js in r55.

    function onPointerDown(e) {
      e.preventDefault();
      if (canvasEl.setPointerCapture && e.pointerId != null) {
        try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
      pointerDown = true;
      const p = pointerPos(e);
      if (coverMode === "frosted") {
        pointerGrab = null;
        // r75: frosted mode has no physical curtain grab, but the rectangle
        // should still be movable with the mouse when mouse-move mode is active.
        if (dragMode && typeof findFrostedOverlayAt === "function") {
          const cloth = findFrostedOverlayAt(p.x, p.y);
          if (cloth) {
            selectedCloth = cloth;
            curtainSizeInput.value = selectedCloth.scale.toFixed(2);
            moveDrag = { cloth, x: p.x, y: p.y };
          } else {
            moveDrag = null;
          }
        } else {
          moveDrag = null;
        }
        return;
      }
      if (dragMode) {
        const cloth = findClothAt(p.x, p.y);
        if (cloth) {
          selectedCloth = cloth;
          curtainSizeInput.value = selectedCloth.scale.toFixed(2);
        }
        moveDrag = cloth ? { cloth, x: p.x, y: p.y } : null;
        pointerGrab = null;
        return;
      }
      const candidate = nearestClothPoints(p.x, p.y);
      if (candidate) {
        selectedCloth = candidate.cloth;
        curtainSizeInput.value = selectedCloth.scale.toFixed(2);
        candidate.cloth.settleStart = Infinity;
      }
      pointerGrab = candidate ? { x: p.x, y: p.y, startX: p.x, startY: p.y, maxY: p.y, tieSide: candidate.cloth.tieSideForX(p.x, p.y), dropArmed: false, vx: 0, vy: 0, px: p.x, py: p.y, cloth: candidate.cloth, points: candidate.points } : null;
    }

    function onPointerMove(e) {
      if (!pointerDown) return;
      e.preventDefault();
      const p = pointerPos(e);
      if (moveDrag) {
        const dx = p.x - moveDrag.x;
        const dy = p.y - moveDrag.y;
        moveDrag.cloth.moveBy(dx, dy);
        moveDrag.x = p.x;
        moveDrag.y = p.y;
        return;
      }
      if (!pointerGrab) return;
      pointerGrab.vx = p.x - pointerGrab.x;
      pointerGrab.vy = p.y - pointerGrab.y;
      pointerGrab.px = pointerGrab.x;
      pointerGrab.py = pointerGrab.y;
      pointerGrab.x = p.x;
      pointerGrab.y = p.y;
      pointerGrab.maxY = Math.max(pointerGrab.maxY || pointerGrab.startY || pointerGrab.y, pointerGrab.y);
      if (pointerGrab.cloth.isRolledOrTied()) {
        pointerGrab.cloth.pullTieOnly(pointerGrab.tieSide, pointerGrab.maxY, pointerGrab.vy > 9);
        // Do not release while the user is still dragging. Crossing 1/2 height only
        // arms the tear-away; onPointerUp() performs the drop after they let go.
        pointerGrab.dropArmed = pointerGrab.dropArmed || pointerGrab.cloth.shouldDropFromRoll(pointerGrab.startY, pointerGrab.maxY, pointerGrab.vy);
      }
    }

    function onPointerUp(e) {
      if (pointerGrab) {
        if (pointerGrab.cloth.isRolledOrTied()) {
          const releaseY = Math.max(pointerGrab.y, pointerGrab.maxY || pointerGrab.y);
          if (pointerGrab.dropArmed || pointerGrab.cloth.shouldDropFromRoll(pointerGrab.startY, releaseY, pointerGrab.vy)) {
            pointerGrab.cloth.releaseFromRoll(releaseY);
          } else {
            pointerGrab.cloth.pullTieOnly(pointerGrab.tieSide, releaseY, pointerGrab.vy > 9);
          }
        } else if (pointerGrab.cloth.shouldAutoHang(pointerGrab.x, pointerGrab.y, pointerGrab.vy)) {
          pointerGrab.cloth.setHung(true);
        } else {
          pointerGrab.cloth.impulse(pointerGrab.x, pointerGrab.y, pointerGrab.vx, pointerGrab.vy);
          pointerGrab.cloth.settleStart = performance.now();
        }
      }
      pointerGrab = null;
      moveDrag = null;
      pointerDown = false;
      if (canvasEl.releasePointerCapture && e.pointerId != null) {
        try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      e.preventDefault();
    }

    // nearestClothPoints() moved to src/gestures.js in r55.

    // findClothAt() moved to src/gestures.js in r55.

    function pointerPos(e) {
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      const sx = (e.clientX - rect.left) * scaleX;
      const sy = (e.clientY - rect.top) * scaleY;
      return screenToStage(sx, sy);
    }

    // updateGestureHud() moved to src/ui.js in r56.


    // updateDebug() moved to src/ui.js in r56.


    // roundRectPath() moved to src/geometry.js in r56.


    // dist2() moved to src/geometry.js in r56.


    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (e) => {
      const target = e.target;
      if (target && target.closest && target.closest(".panel, .start-card, select, input, button, .upload-label")) return;
      e.preventDefault();
    }, { passive: false });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => scheduleViewportResize(80), { passive: true });
      window.visualViewport.addEventListener("scroll", () => updateViewportVars(), { passive: true });
    }
    window.addEventListener("orientationchange", () => {
      scheduleViewportResize(240);
    });
