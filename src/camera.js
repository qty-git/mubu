// Extracted from app.js in r56.
// Kept in global-scope script style to preserve existing behavior.

    function hasCameraSupport() {
      return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }
    function cameraConstraints() {
      const aspect = resolveStageAspect();
      const portrait = aspect != null && aspect < 1;
      const mobile = isMobileLayout();
      const idealW = portrait ? (mobile ? 720 : 1080) : (mobile ? 1280 : 1920);
      const idealH = portrait ? (mobile ? 1280 : 1920) : (mobile ? 720 : 1080);
      return {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: idealW },
          height: { ideal: idealH },
          frameRate: { ideal: mobile ? 24 : 30, max: mobile ? 30 : 60 }
        }
      };
    }
    async function requestCameraStream() {
      const primary = cameraConstraints();
      try {
        return await navigator.mediaDevices.getUserMedia(primary);
      } catch (primaryError) {
        const mobile = isMobileLayout();
        if (!mobile) throw primaryError;
        console.warn("Camera primary constraints failed, retrying mobile fallback", primaryError);
        return navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: facingMode,
            width: { ideal: 640 },
            height: { ideal: 960 },
            frameRate: { ideal: 20, max: 30 }
          }
        });
      }
    }
    async function initCamera() {
      if (!hasCameraSupport()) {
        setStatus("当前环境不支持摄像头。请用 HTTPS、localhost，或手机浏览器重新打开。", true);
        return false;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      try {
        mirrorCamera = facingMode === "user";
        stream = await requestCameraStream();
        cameraVideo.srcObject = stream;
        cameraVideo.setAttribute("playsinline", "");
        cameraVideo.setAttribute("webkit-playsinline", "");
        await cameraVideo.play();
        setStatus(isMobileLayout() ? "摄像头已启动。建议把手机竖放，并让手完整进入画面。" : "摄像头已启动。正在加载手势识别…");
        return true;
      } catch (err) {
        console.warn("Camera unavailable", err);
        setStatus("摄像头启动失败：手机请使用 Safari/Chrome，确认已授权摄像头，并通过 HTTPS 或 localhost 打开。", true);
        return false;
      }
    }
    function drawCameraBackground() {
      ctx.save();
      ctx.fillStyle = "#07090b";
      ctx.fillRect(0, 0, stageW(), stageH());
      // r64: green screen applies only to the curtain/media display region,
      // not to the whole camera background. Keep the real camera background visible.
      if (cameraVideo.readyState >= 2) {
        ctx.globalAlpha = 0.96;
        drawCover(cameraVideo, 0, 0, stageW(), stageH(), mirrorCamera);
      } else {
        ctx.fillStyle = "#111418";
        ctx.fillRect(0, 0, stageW(), stageH());
        ctx.fillStyle = "rgba(255,255,255,0.48)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${Math.max(14, Math.min(22, stageW() * 0.026))}px sans-serif`;
        ctx.fillText("摄像头未启动 / 等待权限", stageW() / 2, stageH() / 2);
      }
      ctx.restore();
    }
