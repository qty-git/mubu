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
      const handStatus = !started ? "未启动" : (!cameraOn ? "摄像头未开" : (!handsReady ? "手势加载中" : (handFrameAge == null ? "等待中" : `${handFrameAge}毫秒`)));
      gestureHud.textContent =
        `手数：${lastDebug.hands}
` +
        `捏合：${lastDebug.pinches}
` +
        `手掌：${lastDebug.palms || 0}
` +
        `三指移动：${lastDebug.triMoves || handMoves.size || 0}
` +
        `模式：${COVER_MODES[coverMode] || coverMode}
` +
        `绿幕：${greenScreenEnabled ? "开" : "关"}
` +
        `缩放：${scalingActive ? "开" : "关"}
` +
        `缩放手数：${scaleHands}
` +
        `抓取：${activeGrabs}
` +
        `手势帧：${handStatus}`;
    }
    function updateDebug() {
      if (!debugVisible || !debugEl) return;
      const now = performance.now();
      if (now - lastDebugUpdateAt < 180) return;
      lastDebugUpdateAt = now;
      const aspectLabel = stageAspectKey === "auto"
        ? (height > width ? "自动 9:16" : "自动 16:9")
        : stageAspectKey;
      debugEl.textContent =
        `版本：${APP_VERSION}\n` +
        `手数：${lastDebug.hands}  捏合：${lastDebug.pinches}\n` +
        `捏合比例：${lastDebug.ratio}\n` +
        `捏合距离：${lastDebug.dist}\n` +
        `画面比例：${aspectLabel}  舞台：${Math.round(stageRect.w)}×${Math.round(stageRect.h)}\n` +
        `幕布数量：${cloths.length}\n` +
        `当前幕布：${selectedCloth ? selectedCloth.id.slice(-3) : "-"} ${selectedCloth && selectedCloth.hung ? "已挂起" : ""}\n` +
        `鼠标模式：${dragMode ? "移动" : "抓布"}\n` +
        `抓取：${grabs.size + (pointerGrab ? 1 : 0)}  三指移动：${handMoves.size}`;
    }

    function updateTutorialUI() {
      if (!tutorialOverlay) return;
      const steps = [
        {
          title: "新手教程",
          text: "拇指和食指捏合可以抓住透明幕布；在磨砂玻璃模式下，张开手掌可以擦出清晰区域。"
        },
        {
          title: "移动和缩放",
          text: "拇指、食指、中指三指捏合后移动手掌，可以移动幕布或磨砂区域；双手捏合可以缩放并平移显示区域。"
        },
        {
          title: "收起和放下",
          text: "把幕布边缘甩到顶部会吸附收起；从顶部捏住向下拉，可以把幕布放下。"
        }
      ];
      const step = steps[Math.min(tutorialIndex, steps.length - 1)];
      tutorialOverlay.classList.toggle("hidden", !tutorialVisible);
      if (tutorialTitle) tutorialTitle.textContent = step.title;
      if (tutorialText) tutorialText.textContent = step.text;
      if (tutorialStep) tutorialStep.textContent = `${Math.min(tutorialIndex + 1, steps.length)} / ${steps.length}`;
      if (tutorialNextBtn) tutorialNextBtn.textContent = tutorialIndex >= steps.length - 1 ? "完成" : "继续";
    }

    function hideTutorial() {
      tutorialVisible = false;
      updateTutorialUI();
    }

    function advanceTutorial() {
      tutorialIndex += 1;
      if (tutorialIndex >= 3) {
        hideTutorial();
        return;
      }
      updateTutorialUI();
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
      updateControlsPanelUI();
      updateDebugModeUI();
      updateTutorialUI();
    }

    function updateControlsPanelUI() {
      document.body.classList.toggle("controls-collapsed", Boolean(controlsCollapsed));
      if (controlsToggleBtn) {
        controlsToggleBtn.textContent = controlsCollapsed ? "控制" : "收起";
        controlsToggleBtn.classList.toggle("is-active", !controlsCollapsed);
      }
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
