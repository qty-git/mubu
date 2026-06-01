// Extracted from app.js in r56.
// Kept in global-scope script style to preserve existing behavior.

    function ensureAudioGraph() {
      if (audioCtx) {
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
        return;
      }
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      audioCtx = new AudioCtor();
      audioDestination = audioCtx.createMediaStreamDestination();
    }
    function setupVideoAudio(item, video) {
      ensureAudioGraph();
      if (!audioCtx || item.audio) return;
      try {
        const source = audioCtx.createMediaElementSource(video);
        const filter = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();
        filter.type = "lowpass";
        filter.frequency.value = 650;
        filter.Q.value = 0.85;
        gain.gain.value = 0.08;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        if (audioDestination) gain.connect(audioDestination);
        item.audio = { source, filter, gain, openness: 0 };
      } catch (err) {
        console.warn("Audio graph unavailable", err);
      }
    }
    function updateMediaAudio() {
      for (const cloth of cloths) {
        const item = cloth.item;
        if (!item || !item.audio) continue;
        // r75: in frosted mode, uploaded media audio should fade in as the
        // frosted overlay is wiped clean, similar to curtain openness.
        const target = coverMode === "frosted" && typeof frostRevealAmountFor === "function"
          ? frostRevealAmountFor(cloth)
          : cloth.openness();
        item.audio.openness += (target - item.audio.openness) * 0.08;
        const open = item.audio.openness;
        // r36：幕布完全盖住时必须静音；只有真正掀开后声音才逐渐出现。
        // 之前最低音量固定为 0.05，所以即使幕布盖住也仍有声音。
        const audibleOpen = open < 0.045 ? 0 : constrain((open - 0.045) / 0.955, 0, 1);
        const volume = Math.pow(audibleOpen, 1.55);
        const cutoff = 360 + Math.pow(audibleOpen, 1.8) * 15660;
        item.audio.gain.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.055);
        item.audio.filter.frequency.setTargetAtTime(cutoff, audioCtx.currentTime, 0.10);
      }
    }
