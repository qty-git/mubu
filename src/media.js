// Extracted from app.js in r56.
// Kept in global-scope script style to preserve existing behavior.

    function createMediaItem(file, index) {
      const url = URL.createObjectURL(file);
      const kind = file.type.startsWith("video/") ? "video" : "image";
      const item = {
        id: `${Date.now()}-${index}`,
        kind,
        url,
        element: null,
        aspect: 16 / 9,
        sizeScale: 1,
        audio: null
      };
      if (kind === "video") {
        const video = document.createElement("video");
        video.src = url;
        video.loop = true;
        video.muted = false;
        video.volume = 1;
        video.playsInline = true;
        video.autoplay = true;
        video.addEventListener("loadedmetadata", () => {
          if (video.videoWidth && video.videoHeight) {
            item.aspect = video.videoWidth / video.videoHeight;
            rebuildCloths();
          }
        }, { once: true });
        setupVideoAudio(item, video);
        video.play().catch(() => {});
        item.element = video;
      } else {
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth && img.naturalHeight) {
            item.aspect = img.naturalWidth / img.naturalHeight;
            rebuildCloths();
          }
        };
        img.src = url;
        item.element = img;
      }
      return item;
    }
    function disposeMediaItems() {
      for (const item of mediaItems) {
        if (item.element instanceof HTMLVideoElement) item.element.pause();
        if (item.audio) {
          item.audio.source.disconnect();
          item.audio.filter.disconnect();
          item.audio.gain.disconnect();
        }
        URL.revokeObjectURL(item.url);
      }
    }
    function drawMediaLayer() {
      if (coverMode === "frosted") return;

      for (const cloth of cloths) {
        const r = displayRectFor(cloth);
        const item = cloth.item;
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        const source = sourceForCloth(cloth);
        if (greenScreenEnabled) {
          // r64: green screen is the media/curtain display region only.
          ctx.fillStyle = CHROMA_GREEN;
          ctx.fillRect(r.x, r.y, r.w, r.h);
        } else if (source && mediaReady(source)) {
          const sw = r.w * mediaScale;
          const sh = r.h * mediaScale;
          drawSourceCover(source, r.x + (r.w - sw) / 2, r.y + (r.h - sh) / 2, sw, sh, false);
          ctx.fillStyle = "rgba(255,255,255,0.025)";
          ctx.fillRect(r.x, r.y, r.w, r.h);
        } else {
          const stress = cloth.visualStress ? cloth.visualStress() : 0;
          const textAlpha = stress > 0.08 ? 0.20 : 0.42;
          ctx.fillStyle = `rgba(255,255,255,${textAlpha.toFixed(2)})`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `${Math.max(13, Math.min(20, stageW() * 0.023))}px sans-serif`;
          ctx.fillText("上传图片/视频", r.x + r.w / 2, r.y + r.h / 2);
        }
        ctx.restore();
      }
    }

    function sourceForCloth(cloth) {
      return cloth && cloth.item ? cloth.item.element : null;
    }

    function sourceReadyForCloth(cloth) {
      const source = sourceForCloth(cloth);
      return source && mediaReady(source);
    }

    function drawSourceForCloth(cloth, x, y, w, h, mirrored = false) {
      const source = sourceForCloth(cloth);
      if (!source || !mediaReady(source)) return false;
      drawCover(source, x, y, w, h, mirrored);
      return true;
    }

    function displayRectFor(cloth) {
      const r = cloth.mediaRect;
      const aspect = DISPLAY_ASPECT_PRESETS[greenAspectKey];
      if (greenAspectKey === "inherit" || aspect == null) {
        if (greenAspectKey === "full") return { x: 0, y: 0, w: stageW(), h: stageH() };
        return { ...r };
      }
      let w = r.w;
      let h = w / aspect;
      if (h > r.h) {
        h = r.h;
        w = h * aspect;
      }
      return {
        x: r.x + (r.w - w) * 0.5,
        y: r.y + (r.h - h) * 0.5,
        w,
        h
      };
    }

    function drawSourceCover(source, x, y, w, h, keyed = false) {
      if (!source || !mediaReady(source)) return false;
      drawCover(source, x, y, w, h, false);
      return true;
    }
