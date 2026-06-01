// Extracted from app.js in r56.
// Kept in global-scope script style to preserve existing behavior.

    function setStatus(message, isError = false) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      statusEl.classList.toggle("error", Boolean(isError));
    }
    function updateGestureHud() {
      if (!gestureHud) return;
      const now = performance.now();
      if (now - lastHudUpdateAt < 120) return;
      lastHudUpdateAt = now;
      const scalingActive = !!dualHandScale;
      const scaleHands = scalingActive ? 2 : 0;
      const activeGrabs = grabs.size + (pointerGrab ? 1 : 0);
      const cameraOn = cameraVideo.readyState >= 2;
      const handFrameAge = lastDebug.lastFrameAt ? Math.round(performance.now() - lastDebug.lastFrameAt) : null;
      const handStatus = !started ? "not started" : (!cameraOn ? "camera off" : (!handsReady ? "hands loading" : (handFrameAge == null ? "waiting" : `${handFrameAge}ms`)));
      gestureHud.textContent =
        `Hands: ${lastDebug.hands}
` +
        `Pinch: ${lastDebug.pinches}
` +
        `Palm: ${lastDebug.palms || 0}
` +
        `FistMove: ${lastDebug.fists || fistMoves.size || 0}
` +
        `Cover: ${COVER_MODES[coverMode] || coverMode}
` +
        `GreenBG: ${greenScreenEnabled ? "ON" : "off"}
` +
        `Scale: ${scalingActive ? "ON" : "off"}
` +
        `ScaleHands: ${scaleHands}
` +
        `Grabs: ${activeGrabs}
` +
        `HandFrame: ${handStatus}`;
    }
    function updateDebug() {
      if (!debugVisible || !debugEl) return;
      const now = performance.now();
      if (now - lastDebugUpdateAt < 180) return;
      lastDebugUpdateAt = now;
      const aspectLabel = stageAspectKey === "auto"
        ? (height > width ? "auto 9:16" : "auto 16:9")
        : stageAspectKey;
      debugEl.textContent =
        `Version: ${APP_VERSION}\n` +
        `Hands: ${lastDebug.hands}  Pinch: ${lastDebug.pinches}\n` +
        `pinchRatio: ${lastDebug.ratio}\n` +
        `distance: ${lastDebug.dist}\n` +
        `aspect: ${aspectLabel}  stage: ${Math.round(stageRect.w)}×${Math.round(stageRect.h)}\n` +
        `curtains: ${cloths.length}\n` +
        `selected: ${selectedCloth ? selectedCloth.id.slice(-3) : "-"} ${selectedCloth && selectedCloth.hung ? "hung" : ""}\n` +
        `mode: ${dragMode ? "move" : "cloth"}\n` +
        `grabs: ${grabs.size + (pointerGrab ? 1 : 0)}  fists: ${fistMoves.size}`;
    }

    function updateCoverModeUI() {
      if (coverModeBtn) coverModeBtn.textContent = `模式：${COVER_MODES[coverMode] || coverMode}`;
      if (frostResetBtn) frostResetBtn.style.display = coverMode === "frosted" ? "inline-block" : "none";
      if (greenScreenBtn) greenScreenBtn.textContent = `绿幕背景：${greenScreenEnabled ? "开" : "关"}`;
      if (modeBtn) modeBtn.textContent = dragMode ? "鼠标移动幕布" : "鼠标抓布";
      if (sizeTargetBtn) sizeTargetBtn.textContent = sizeAllCurtains ? "缩放：全部幕布" : "缩放：选中幕布";
      if (greenAspectSelect) greenAspectSelect.value = greenAspectKey;
      if (versionBadge) versionBadge.textContent = APP_VERSION;
      const versionCorner = document.getElementById("versionCorner");
      if (versionCorner) versionCorner.textContent = APP_VERSION;
      document.title = `透明物理幕布 · 手势交互 · ${APP_VERSION}`;
      if (coverModeBtn) coverModeBtn.classList.toggle("is-active", coverMode === "frosted");
      if (greenScreenBtn) greenScreenBtn.classList.toggle("is-active", greenScreenEnabled);
      if (modeBtn) modeBtn.classList.toggle("is-active", dragMode);
      if (sizeTargetBtn) sizeTargetBtn.classList.toggle("is-active", sizeAllCurtains);
      updateDebugModeUI();
    }

    function updateDebugModeUI() {
      document.body.classList.toggle("debug-visible", debugVisible);
      if (debugToggleBtn) debugToggleBtn.textContent = `调试：${debugVisible ? "开" : "关"}`;
      const hidden = String(!debugVisible);
      const versionCorner = document.getElementById("versionCorner");
      if (versionCorner) versionCorner.setAttribute("aria-hidden", hidden);
      if (gestureHud) gestureHud.setAttribute("aria-hidden", hidden);
      if (debugEl) debugEl.setAttribute("aria-hidden", hidden);
    }
