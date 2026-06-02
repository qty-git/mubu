// Extracted from app.js in r56.
// Kept in global-scope script style to preserve existing behavior.

    function stageW() {
      return stageRect.w;
    }
    function stageH() {
      return stageRect.h;
    }
    function appViewportWidth() {
      return Math.round(window.visualViewport ? window.visualViewport.width : window.innerWidth);
    }
    function appViewportHeight() {
      return Math.round(window.visualViewport ? window.visualViewport.height : window.innerHeight);
    }
    function updateViewportVars() {
      const vh = appViewportHeight();
      const vw = appViewportWidth();
      document.documentElement.style.setProperty("--app-height", `${vh}px`);
      document.documentElement.style.setProperty("--app-width", `${vw}px`);
      document.body.classList.toggle("is-mobile", Math.min(vw, vh) < 720);
      document.body.classList.toggle("is-portrait", vh >= vw);
    }
    function isMobileLayout() {
      return Math.min(width, height) < 720;
    }
    function resolveStageAspect() {
      if (stageAspectKey === "auto") {
        return height > width ? 9 / 16 : 16 / 9;
      }
      return ASPECT_PRESETS[stageAspectKey];
    }
    function updateStageRect() {
      const vw = width;
      const vh = height;
      const aspect = resolveStageAspect();
      if (aspect == null) {
        stageRect = { x: 0, y: 0, w: vw, h: vh };
        return;
      }
      const mobile = isMobileLayout();
      const marginX = mobile ? 10 : 0;
      const marginTop = mobile ? Math.max(52, vh * 0.06) : 0;
      const marginBottom = mobile ? Math.max(18, vh * 0.03) : 0;
      const availW = Math.max(120, vw - marginX * 2);
      const availH = Math.max(120, vh - marginTop - marginBottom);
      let sw;
      let sh;
      if (availW / availH > aspect) {
        sh = availH;
        sw = sh * aspect;
      } else {
        sw = availW;
        sh = sw / aspect;
      }
      stageRect = {
        x: (vw - sw) * 0.5,
        y: marginTop + (availH - sh) * 0.5,
        w: sw,
        h: sh
      };
    }
    function screenToStage(x, y) {
      return {
        x: x - stageRect.x,
        y: y - stageRect.y
      };
    }
    function drawStageFrame() {
      if (stageAspectKey === "full" || resolveStageAspect() == null) return;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      ctx.strokeRect(stageRect.x + 0.5, stageRect.y + 0.5, stageRect.w - 1, stageRect.h - 1);
      ctx.restore();
    }
    function drawCover(source, x, y, w, h, mirrored) {
      const sw = source.videoWidth || source.naturalWidth || source.width || 1;
      const sh = source.videoHeight || source.naturalHeight || source.height || 1;
      const scale = Math.max(w / sw, h / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = x + (w - dw) / 2;
      const dy = y + (h - dh) / 2;
      ctx.save();
      if (mirrored) {
        const mirrorW = stageW();
        ctx.translate(mirrorW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(source, mirrorW - dx - dw, dy, dw, dh);
      } else {
        ctx.drawImage(source, dx, dy, dw, dh);
      }
      ctx.restore();
    }
    function drawContain(source, x, y, w, h, mirrored) {
      const sw = source.videoWidth || source.naturalWidth || source.width || 1;
      const sh = source.videoHeight || source.naturalHeight || source.height || 1;
      const scale = Math.min(w / sw, h / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = x + (w - dw) / 2;
      const dy = y + (h - dh) / 2;
      ctx.save();
      if (mirrored) {
        const mirrorW = stageW();
        ctx.translate(mirrorW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(source, mirrorW - dx - dw, dy, dw, dh);
      } else {
        ctx.drawImage(source, dx, dy, dw, dh);
      }
      ctx.restore();
    }
    function drawStageCamera(x = 0, y = 0, w = stageW(), h = stageH()) {
      drawCover(cameraVideo, x, y, w, h, mirrorCamera);
    }
    function mediaReady(el) {
      if (!el) return false;
      if (el instanceof HTMLVideoElement) return el.readyState >= 2;
      return el.complete && el.naturalWidth > 0;
    }
    function defaultClothRect(aspectOverride = null, index = 0, total = 1) {
      const sw = stageW();
      const sh = stageH();
      const mobile = isMobileLayout();
      const maxW = Math.min(sw * (mobile ? 0.92 : 0.85), mobile ? sw : 960);
      const maxH = Math.min(sh * (mobile ? 0.62 : 0.55), mobile ? sh * 0.72 : 620);
      const sizeFactor = total > 1 ? Math.max(0.52, 0.76 - total * 0.035) : 1;
      const layoutW = maxW * sizeFactor;
      const layoutH = maxH * sizeFactor;
      const aspect = aspectOverride || (layoutW / layoutH);
      let w = layoutW;
      let h = w / aspect;
      if (h > layoutH) {
        h = layoutH;
        w = h * aspect;
      }
      const centerOffset = index - (total - 1) / 2;
      const spreadX = total > 1 ? Math.min(mobile ? 90 : 190, w * 0.32) : 0;
      const spreadY = total > 1 ? (mobile ? 24 : 36) : 0;
      const topInset = mobile ? sh * 0.08 : Math.max(36, sh * 0.12);
      const x = constrain((sw - w) * 0.5 + centerOffset * spreadX, 10, Math.max(10, sw - w - 10));
      const y = constrain(topInset + (index % 3) * spreadY, 24, Math.max(24, sh - h - 16));
      return {
        x,
        y,
        w,
        h
      };
    }
    function scaleRect(rect, scale) {
      const w = rect.w * scale;
      const h = rect.h * scale;
      return {
        x: rect.x + (rect.w - w) / 2,
        y: rect.y,
        w,
        h
      };
    }
    function roundRectPath(context, x, y, w, h, r) {
      const rr = Math.min(r, w * 0.5, h * 0.5);
      context.moveTo(x + rr, y);
      context.arcTo(x + w, y, x + w, y + h, rr);
      context.arcTo(x + w, y + h, x, y + h, rr);
      context.arcTo(x, y + h, x, y, rr);
      context.arcTo(x, y, x + w, y, rr);
      context.closePath();
    }
    function dist2(ax, ay, bx, by) {
      const dx = ax - bx;
      const dy = ay - by;
      return dx * dx + dy * dy;
    }
