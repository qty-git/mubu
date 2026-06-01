// Extracted from app.js in r56.
// Kept in global-scope script style to preserve existing behavior.

    async function startRecording() {
      if (!canvasEl || typeof MediaRecorder === "undefined") return;
      ensureAudioGraph();
      if (audioCtx && audioCtx.state === "suspended") {
        try { await audioCtx.resume(); } catch (err) { console.warn("Audio resume failed", err); }
      }

      // r61：录屏同时录入两类声音：
      // 1) 页面内上传视频的声音，经 audioDestination 混音；
      // 2) 麦克风采集到的环境声音，也接入同一个 audioDestination。
      // 如果用户拒绝麦克风权限，仍会继续录制画面和页面内媒体声音。
      if (audioCtx && audioDestination && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          recordingMicStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: false,
              autoGainControl: false
            },
            video: false
          });
          recordingMicSource = audioCtx.createMediaStreamSource(recordingMicStream);
          recordingMicGain = audioCtx.createGain();
          recordingMicGain.gain.value = 1;
          recordingMicSource.connect(recordingMicGain);
          recordingMicGain.connect(audioDestination);
          setStatus("录屏中：画面、媒体声音和环境声音都会录入。", false);
        } catch (err) {
          console.warn("Microphone unavailable for recording", err);
          setStatus("麦克风未授权：将只录制画面和上传媒体声音。", true);
        }
      }

      const mime = ["video/mp4;codecs=h264,aac", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
        .find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const visualStream = canvasEl.captureStream(30);
      const tracks = [...visualStream.getVideoTracks()];
      if (audioDestination) tracks.push(...audioDestination.stream.getAudioTracks());
      const streamToRecord = new MediaStream(tracks);
      recordChunks = [];
      mediaRecorder = new MediaRecorder(streamToRecord, mime ? { mimeType: mime } : undefined);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) recordChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const type = mediaRecorder.mimeType || mime || "video/webm";
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(recordChunks, { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `transparent-veil-r61-recording-${Date.now()}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        try { if (recordingMicSource) recordingMicSource.disconnect(); } catch (err) {}
        try { if (recordingMicGain) recordingMicGain.disconnect(); } catch (err) {}
        if (recordingMicStream) recordingMicStream.getTracks().forEach((track) => track.stop());
        recordingMicStream = null;
        recordingMicSource = null;
        recordingMicGain = null;

        recordBtn.textContent = "开始录屏";
        setStatus("录屏已保存。", false);
      };
      mediaRecorder.start();
      recordBtn.textContent = "停止录屏";
    }
