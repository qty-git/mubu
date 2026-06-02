// Curtain physics and rendering classes extracted in r58.
// Depends on globals provided by config.js, geometry.js, media/camera/app runtime state.

// r73 helper: reveal clean content through a persistent low-resolution erase mask.
    function ensureFrostRevealLayer(clothId, rect) {
      const maxSize = FROST_CFG.revealLayerMaxSize || 960;
      const scale = Math.min(1, maxSize / Math.max(1, rect.w, rect.h));
      const w = Math.max(2, Math.round(rect.w * scale));
      const h = Math.max(2, Math.round(rect.h * scale));
      let entry = frostRevealLayers.get(clothId);
      if (!entry || entry.canvas.width !== w || entry.canvas.height !== h) {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        entry = { canvas, ctx: canvas.getContext("2d"), scale };
        frostRevealLayers.set(clothId, entry);
      } else {
        entry.scale = scale;
      }
      return entry;
    }

    function drawCleanFrostContentTo(layerCtx, rect, source, hasSource, hasCamera) {
      const s = layerCtx.__scale || 1;
      layerCtx.save();
      layerCtx.clearRect(0, 0, layerCtx.canvas.width, layerCtx.canvas.height);
      layerCtx.scale(s, s);
      if (greenScreenEnabled) {
        layerCtx.fillStyle = CHROMA_GREEN;
        layerCtx.fillRect(0, 0, rect.w, rect.h);
      } else if (hasCamera) {
        layerCtx.save();
        layerCtx.translate(-rect.x, -rect.y);
        const sw = cameraVideo.videoWidth || cameraVideo.width || 1;
        const sh = cameraVideo.videoHeight || cameraVideo.height || 1;
        const x = 0;
        const y = 0;
        const coverScale = Math.max(stageW() / sw, stageH() / sh);
        const dw = sw * coverScale;
        const dh = sh * coverScale;
        const dx = x + (stageW() - dw) / 2;
        const dy = y + (stageH() - dh) / 2;
        if (mirrorCamera) {
          const mirrorW = stageW();
          layerCtx.translate(mirrorW, 0);
          layerCtx.scale(-1, 1);
          layerCtx.drawImage(cameraVideo, mirrorW - dx - dw, dy, dw, dh);
        } else {
          layerCtx.drawImage(cameraVideo, dx, dy, dw, dh);
        }
        layerCtx.restore();
      }
      layerCtx.restore();
    }

    class Point {
      constructor(x, y, u, v, pinned) {
        const jitter = pinned ? 0 : 3.4;
        this.x = x + random(-jitter, jitter);
        this.y = y + random(-jitter, jitter);
        this.oldx = this.x;
        this.oldy = this.y;
        this.baseX = x;
        this.baseY = y;
        this.u = u;
        this.v = v;
        this.pinned = pinned;
        this.pinx = x;
        this.piny = y;
        this.noiseSeed = random(1000);
        this.liftPulse = 0;
      }
    }

    class Stick {
      constructor(a, b, stiffness) {
        this.a = a;
        this.b = b;
        this.len = Math.hypot(a.x - b.x, a.y - b.y);
        this.stiffness = stiffness;
      }

      solve() {
        const dx = this.b.x - this.a.x;
        const dy = this.b.y - this.a.y;
        const d = Math.max(0.0001, Math.hypot(dx, dy));
        const stretch = d / Math.max(0.0001, this.len);
        // r19：防止手势拉拽时把软膜整体“拉长”。
        // 平时仍然很软；只有超过自然长度太多时才提高回弹，避免静置一会才恢复的橡皮筋感。
        const antiStretch = stretch > 1.055
          ? Math.min(0.72, 0.28 + (stretch - 1.055) * 3.4)
          : 0;
        const stiffness = Math.max(this.stiffness, antiStretch);
        const diff = (d - this.len) / d * stiffness;
        const ox = dx * diff * 0.5;
        const oy = dy * diff * 0.5;
        if (!this.a.pinned) {
          this.a.x += ox;
          this.a.y += oy;
        }
        if (!this.b.pinned) {
          this.b.x -= ox;
          this.b.y -= oy;
        }
      }
    }

    class Cloth {
      constructor(item, index = 0, total = 1) {
        this.item = item || null;
        this.id = item ? item.id : "placeholder";
        this.scale = item ? item.sizeScale : 1;
        this.hung = false;
        this.settleStart = performance.now();
        this.rollProgress = 0;
        this.rollTarget = 0;
        this.rollStarted = performance.now();
        this.releaseGraceUntil = 0;
        this.scaleGestureLockUntil = 0;
        this.tiedLeft = false;
        this.tiedRight = false;
        this.manualUntieActive = false;
        this.lastUntiedSide = null;
        this.dropFromRollUntil = 0;
        this.postRollRecoveryUntil = 0;
        const r = defaultClothRect(item ? item.aspect : null, index, total);
        const scaled = scaleRect(r, this.scale);
        scaled.scaleRef = this.scale;
        this.mediaRect = { ...r };
        this.points = [];
        this.sticks = [];
        this.time = random(1000);
        for (let y = 0; y < CFG.rows; y++) {
          for (let x = 0; x < CFG.cols; x++) {
            const u = x / (CFG.cols - 1);
            const v = y / (CFG.rows - 1);
            const px = scaled.x + u * scaled.w;
            const py = scaled.y + v * scaled.h;
            this.points.push(new Point(px, py, u, v, y === 0));
          }
        }
        this.mediaRect = { ...scaled };
        for (let y = 0; y < CFG.rows; y++) {
          for (let x = 0; x < CFG.cols; x++) {
            const v = y / (CFG.rows - 1);
            // r18：重新建立软膜物理。横向越到底部越松，避免中间拎起时整条底边被当成一根杆带起来。
            const horizontal = CFG.stickStiffness * (0.78 - v * 0.46);
            const vertical = CFG.stickStiffness * (1.05 - v * 0.22);
            const shear = CFG.bendStiffness * (0.62 - v * 0.28);
            const bend = CFG.bendStiffness * (0.42 - v * 0.18);
            if (x < CFG.cols - 1) this.sticks.push(new Stick(this.pt(x, y), this.pt(x + 1, y), Math.max(0.055, horizontal)));
            if (y < CFG.rows - 1) this.sticks.push(new Stick(this.pt(x, y), this.pt(x, y + 1), Math.max(0.115, vertical)));
            if (x < CFG.cols - 1 && y < CFG.rows - 1) {
              this.sticks.push(new Stick(this.pt(x, y), this.pt(x + 1, y + 1), Math.max(0.010, shear)));
              this.sticks.push(new Stick(this.pt(x + 1, y), this.pt(x, y + 1), Math.max(0.010, shear)));
            }
            if (x < CFG.cols - 2) this.sticks.push(new Stick(this.pt(x, y), this.pt(x + 2, y), Math.max(0.006, bend)));
            if (y < CFG.rows - 2) this.sticks.push(new Stick(this.pt(x, y), this.pt(x, y + 2), Math.max(0.010, bend * 1.25)));
          }
        }
      }

      pt(x, y) {
        return this.points[y * CFG.cols + x];
      }

      step() {
        this.time += 0.012;
        const t = frameCount * 0.018;
        const settling = !this.isGrabbed();
        const now = performance.now();
        const idleAge = settling ? now - this.settleStart : 0;
        const recoveryActive = settling && this.rollTarget <= 0 && this.rollProgress < 0.04 && idleAge > 180;
        const recoveryFade = recoveryActive ? constrain((idleAge - 180) / 1600, 0, 1) : 0;
        const recoveryEase = recoveryFade * recoveryFade * (3 - 2 * recoveryFade);
        // r29：大幅交互后可能留下很大的形变。长时间空闲时进入“收尾回正”，
        // 不是瞬间复位，而是逐步关闭外力，并持续把所有点柔和拉回 base。
        const recoveryFinishFade = recoveryActive ? constrain((idleAge - 2600) / 3000, 0, 1) : 0;
        const recoveryFinishEase = recoveryFinishFade * recoveryFinishFade * (3 - 2 * recoveryFinishFade);
        if (this.rollTarget !== this.rollProgress) {
          const delta = this.rollTarget - this.rollProgress;
          const ease = this.rollTarget > this.rollProgress ? 0.052 : 0.070;
          this.rollProgress = constrain(this.rollProgress + delta * ease, 0, 1);
          if (Math.abs(this.rollTarget - this.rollProgress) < 0.004) this.rollProgress = this.rollTarget;
        }
        if (this.rollProgress > 0.995) {
          this.rollProgress = 1;
          this.hung = true;
          // Only auto-tie when the curtain has just finished rolling up naturally.
          // After a user manually unties one side, do not re-bind it every frame.
          if (this.rollTarget > 0 && !this.manualUntieActive) {
            this.tiedLeft = true;
            this.tiedRight = true;
          }
        }
        if (this.rollProgress < 0.005) {
          this.rollProgress = 0;
          this.hung = false;
          this.manualUntieActive = false;
          this.lastUntiedSide = null;
        }
        for (const p of this.points) {
          if (p.pinned) {
            p.x = p.pinx;
            p.y = p.piny;
            p.oldx = p.x;
            p.oldy = p.y;
            continue;
          }
          const vx = (p.x - p.oldx) * CFG.friction;
          const vy = (p.y - p.oldy) * CFG.friction;
          p.oldx = p.x;
          p.oldy = p.y;

          // r29：进入回正阶段后，重力和微风会在长时间空闲后完全退场。
          // 否则 settleFlat 一边回正，gravity/breeze 一边继续制造弯曲，长时间后仍会残留大曲线。
          const forceScale = Math.max(0, 1 - recoveryEase * 0.86 - recoveryFinishEase * 0.32);
          const breeze = ((noise(p.noiseSeed, this.time) - 0.5) * 0.34 + Math.sin(t + p.u * 8 + p.v * 3) * 0.035) * forceScale;
          p.x += vx + breeze;
          const weightedGravity = CFG.gravity * (0.82 + p.v * 3.15) * forceScale;
          p.y += vy + weightedGravity - p.liftPulse;
          p.liftPulse *= p.liftPulse > 0 ? 0.94 : 0.9;
          if (Math.abs(p.liftPulse) < 0.01) p.liftPulse = 0;
        }

        for (let i = 0; i < CFG.iterations; i++) {
          for (const stick of this.sticks) stick.solve();
          for (const grab of grabs.values()) {
            if (grab.cloth === this && !["scale", "scalePending", "scaleOnly"].includes(grab.mode)) this.applyGrab(grab, i);
          }
          if (pointerGrab && pointerGrab.cloth === this) this.applyGrab(pointerGrab, i);
          this.keepInBounds();
        }
        this.limitOverallStretch();
        this.preserveNaturalLengthWhileIdleGrab();
        if (settling) this.settleFlat();
        if (this.rollProgress > 0 && !this.isGrabbed() && performance.now() > this.dropFromRollUntil) this.applyRollAnimation();
      }

      isGrabbed() {
        if (pointerGrab && pointerGrab.cloth === this) return true;
        for (const grab of grabs.values()) {
          if (grab.cloth !== this) continue;
          // r53: scale-only / scale-pending / scale grabs are virtual resize handles.
          // They must not count as physical cloth grabs, especially while rolled up;
          // otherwise the roll solver is paused, gravity pulls the compressed mesh
          // down, and the curtain appears to drop until the hands are released.
          if (grab.scaleOnly || grab.mode === "scaleOnly" || grab.mode === "scalePending" || grab.mode === "scale") continue;
          if (!grab.points || !grab.points.length) continue;
          return true;
        }
        return false;
      }

      grabMotionAmount() {
        let amount = 0;
        if (pointerGrab && pointerGrab.cloth === this) {
          amount = Math.max(amount, Math.hypot(pointerGrab.x - (pointerGrab.startX ?? pointerGrab.x), pointerGrab.y - (pointerGrab.startY ?? pointerGrab.y)), Math.hypot(pointerGrab.vx || 0, pointerGrab.vy || 0) * 4);
        }
        for (const grab of grabs.values()) {
          if (grab.cloth !== this) continue;
          amount = Math.max(amount, Math.hypot(grab.x - (grab.startX ?? grab.x), grab.y - (grab.startY ?? grab.y)), Math.hypot(grab.vx || 0, grab.vy || 0) * 4);
        }
        return amount;
      }

      preserveNaturalLengthWhileIdleGrab() {
        // r21：修复“手势一开始介入但不拉动，整块幕布自动向下变长”。
        // 原因是 grabbed 状态会暂停回到基准形态，但重力仍持续作用；手不动时就像整块布被持续向下拉伸。
        // 这里只在手势基本静止时介入，真实拖拽/甩动时不影响 r18 的自然垂坠物理。
        if (!this.isGrabbed() || this.rollProgress > 0.08) return;
        const motion = this.grabMotionAmount();
        if (motion > Math.max(10, this.mediaRect.h * 0.018)) return;
        const k = 0.035;
        for (const p of this.points) {
          if (p.pinned) continue;
          const slack = this.mediaRect.h * (0.012 + p.v * 0.018);
          const maxY = p.baseY + slack;
          if (p.y > maxY) {
            const dy = (maxY - p.y) * k;
            p.y += dy;
            p.oldy += dy * 0.25;
          }
        }
      }

      applyGrab(grab, iteration) {
        // r20：修复“刚开始手势互动但不移动，幕布也自动变长”。
        // 之前把抓取点的初始偏移压缩到 0.18，会在手静止时也不断把局部网格吸向捏合中心，
        // 造成幕布被动拉伸。现在保留抓取瞬间的相对偏移：手不动时形态不变，手移动时才带动局部软膜。
        const base = iteration < 2 ? 0.82 : 0.36;
        for (const item of grab.points) {
          const p = item.p;
          const tx = grab.x + item.ox;
          const ty = grab.y + item.oy;
          const local = item.weight;
          const s = base * local;
          p.x += (tx - p.x) * s;
          p.y += (ty - p.y) * s;
          p.oldx = p.x - grab.vx * (0.26 + local * 0.22);
          p.oldy = p.y - grab.vy * (0.26 + local * 0.22);
        }
      }

      keepInBounds() {
        const pad = 18;

        // r57：修复双手缩放到超过屏幕时，幕布底边被屏幕边界“挤皱”的问题。
        // 之前所有点都会被限制在 stageH()+pad 内。幕布放大到超过摄像头画面后，
        // 底部真实网格应该允许自然延伸到屏幕外；如果仍被强行夹回屏幕内，
        // 下边缘就会堆叠起皱，露出后面的媒体内容。
        // 现在边界跟随当前 mediaRect 外扩：缩小时仍限制在屏幕附近，
        // 放大超过屏幕时允许不可见的边缘停留在屏幕外，不改变幕布形态。
        const minX = Math.min(-pad, this.mediaRect.x - pad);
        const maxX = Math.max(stageW() + pad, this.mediaRect.x + this.mediaRect.w + pad);
        const minY = Math.min(-stageH() * 0.28, this.mediaRect.y - pad);
        const maxY = Math.max(stageH() + pad, this.mediaRect.y + this.mediaRect.h + pad);

        for (const p of this.points) {
          if (p.pinned) continue;
          p.x = constrain(p.x, minX, maxX);
          p.y = constrain(p.y, minY, maxY);
        }
        this.relaxSoftMembrane();
      }

      relaxSoftMembrane() {
        // r18：只做极轻的防尖刺处理，不再人为拉直侧边或底边。
        // 真实形态交给网格约束 + 重力，避免补丁互相打架。
        if (this.rollProgress > 0.86) return;
        const k = this.isGrabbed() ? 0.010 : 0.016;
        for (let y = 2; y < CFG.rows - 2; y++) {
          for (let x = 2; x < CFG.cols - 2; x++) {
            const p = this.pt(x, y);
            if (p.pinned) continue;
            const avgY = (this.pt(x - 1, y).y + this.pt(x + 1, y).y + this.pt(x, y - 1).y + this.pt(x, y + 1).y) * 0.25;
            const spike = p.y - avgY;
            if (Math.abs(spike) > this.mediaRect.h * 0.13) p.y += (avgY - p.y) * k;
          }
        }
      }

      limitOverallStretch() {
        // r19：只限制“整体被拉长”，不改变 r18 已经调好的自然垂坠形态。
        // 收起/放下动画期间不介入，避免影响绳子释放和落下效果。
        if (this.rollProgress > 0.08 || performance.now() < this.dropFromRollUntil) return;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of this.points) {
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        const currentH = maxY - minY;
        const maxH = this.mediaRect.h * (this.isGrabbed() ? 1.012 : 1.045);
        if (currentH <= maxH) return;
        const factor = maxH / Math.max(1, currentH);
        const anchorY = this.mediaRect.y;
        for (const p of this.points) {
          if (p.pinned) continue;
          const nextY = anchorY + (p.y - anchorY) * factor;
          const oldNextY = anchorY + (p.oldy - anchorY) * factor;
          p.y += (nextY - p.y) * 0.075;
          p.oldy += (oldNextY - p.oldy) * 0.075;
        }
      }

      settleFlat() {
        // r35：最终回正必须“必然收敛”，但全程不能 snap。
        // r34 的问题是：大幅形变后只靠温和 spring，某些边缘/角落会长期停在错误形态。
        // 这里改成连续的三段恢复：早进入、慢回正、长时间后平滑增强到足够收干净。
        const now = performance.now();
        const elapsed = now - this.settleStart;
        // r40：收起释放后的自然下落保护期内不介入；保护期结束后再从当下实时形态开始连续回正。
        if (now < this.dropFromRollUntil || elapsed < 90 || this.rollTarget > 0 || this.rollProgress > 0.04 || this.isGrabbed()) return;

        let maxErr = 0;
        let meanErr = 0;
        for (const p of this.points) {
          const e = Math.hypot(p.x - p.baseX, p.y - p.baseY);
          maxErr = Math.max(maxErr, e);
          meanErr += e;
        }
        meanErr /= Math.max(1, this.points.length);

        const unit = Math.max(1, Math.min(this.mediaRect.w, this.mediaRect.h));
        const err01 = constrain(maxErr / unit, 0, 1);

        // r40：恢复仍然完全基于当前实时形态逐帧靠近 base，不做任何瞬间重置。
        // 但把后段收尾提前、加快一点，避免等待过久才完全收干净。
        const rampA = constrain((elapsed - 90) / 900, 0, 1);
        const easeA = rampA * rampA * (3 - 2 * rampA);
        const rampB = constrain((elapsed - 1050) / 1600, 0, 1);
        const easeB = rampB * rampB * (3 - 2 * rampB);
        const rampC = constrain((elapsed - 2300) / 1800, 0, 1);
        const easeC = rampC * rampC * (3 - 2 * rampC);
        const rampD = constrain((elapsed - 4050) / 1700, 0, 1);
        const easeD = rampD * rampD * (3 - 2 * rampD);
        // r38：收起后再放下，或者大幅交互后的残余扭曲，需要更确定的“形状记忆”。
        // 这是连续增强，不是 snap；只要空闲足够久，就会继续收敛到初始矩形。
        const postRoll = 0; // r38：收起后放下不再启用特殊强制回正窗口，让幕布先自然下落。

        // 连续增强的恢复力：前段轻，后段足够强，保证最终一定回到 base。
        // 没有任何一帧直接赋值到 base，所以不会出现突然弹动。
        // r36：方向沿用 r35，但把最后恢复过程整体提速一点。
        // 仍然不用 snap，只提高连续回正力，让大形变更快收干净。
        let k = 0.0055 + easeA * 0.013 + easeB * 0.032 + easeC * 0.078 + easeD * 0.145 + err01 * 0.040 + postRoll * (0.006 + easeB * 0.018);
        if (maxErr < 28) k = Math.min(k, 0.042 + easeC * 0.046 + easeD * 0.110 + postRoll * 0.020);
        if (maxErr < 10) k = Math.min(k, 0.031 + easeC * 0.036 + easeD * 0.086 + postRoll * 0.016);
        if (maxErr < 3) k = Math.min(k, 0.022 + easeD * 0.062 + postRoll * 0.010);

        // 逐步增加阻尼。同步 old 点，避免 Verlet 在下一帧把已经回正的边缘又甩开。
        let damping = 0.15 + easeA * 0.095 + easeB * 0.17 + easeC * 0.28 + easeD * 0.40 + postRoll * 0.10;
        if (maxErr < 8) damping *= 0.72;
        if (maxErr < 2) damping *= 0.58;

        for (const p of this.points) {
          if (p.pinned) continue;
          const edge = Math.max(Math.abs(p.u - 0.5) * 2, p.v);
          const corner = Math.pow(Math.max(Math.abs(p.u - 0.5) * 2, p.v), 2.2);
          const localK = k * (1 + corner * (0.35 + easeB * 0.35 + easeC * 0.55 + easeD * 0.75));

          const dx = (p.baseX - p.x) * localK;
          const dy = (p.baseY - p.y) * localK;
          p.x += dx;
          p.y += dy;
          p.oldx += dx;
          p.oldy += dy;

          p.oldx += (p.x - p.oldx) * damping;
          p.oldy += (p.y - p.oldy) * damping;
          p.liftPulse *= Math.max(0.42, 0.92 - easeB * 0.10 - easeC * 0.18 - easeD * 0.20);
        }

        // r35 关键补充：长时间空闲后做“形状记忆约束”。
        // 这不是 snap，而是用多次很小的连续插值消除自交、裂缝和边缘残留大曲线。
        // 只有空闲较久才启动，避免影响刚松手时的自然物理。
        if (easeC > 0) {
          const passes = 1 + Math.floor(easeC * 2.0) + Math.floor(easeD * 5);
          const memoryK = 0.020 + easeC * 0.058 + easeD * 0.125 + postRoll * 0.024;
          for (let pass = 0; pass < passes; pass++) {
            for (const p of this.points) {
              if (p.pinned) continue;
              const edge = Math.max(Math.abs(p.u - 0.5) * 2, p.v);
              const local = memoryK * (1 + Math.pow(edge, 2.0) * 0.65);
              const dx = (p.baseX - p.x) * local;
              const dy = (p.baseY - p.y) * local;
              p.x += dx;
              p.y += dy;
              p.oldx += dx;
              p.oldy += dy;
              p.oldx += (p.x - p.oldx) * (0.14 + easeD * 0.30 + postRoll * 0.08);
              p.oldy += (p.y - p.oldy) * (0.14 + easeD * 0.30 + postRoll * 0.08);
            }
          }
        }
      }

      applyRollAnimation() {
        const eased = 1 - Math.pow(1 - this.rollProgress, 3);
        const rollY = this.rolledVisualY();
        const rollThickness = this.rolledVisualThickness();
        for (const p of this.points) {
          const targetX = this.mediaRect.x + p.u * this.mediaRect.w;
          const bow = Math.sin(p.u * Math.PI) * rollThickness * 0.18;
          const targetY = rollY + p.v * rollThickness + bow;
          p.x += (targetX - p.x) * eased * 0.14;
          p.y += (targetY - p.y) * eased * 0.14;
          p.oldx += (p.x - p.oldx) * 0.42;
          p.oldy += (p.y - p.oldy) * 0.42;
        }
      }

      rolledVisualLift() {
        return Math.min(64, Math.max(24, this.mediaRect.h * 0.085));
      }

      rolledVisualY() {
        return this.mediaRect.y - this.rolledVisualLift() * constrain(this.rollProgress, 0, 1);
      }

      rolledVisualThickness() {
        return Math.max(12, Math.min(30, this.mediaRect.h * 0.034));
      }

      getCoveragePath(context, pad = 14) {
        const top = [];
        const right = [];
        const bottom = [];
        const left = [];
        const cx = this.mediaRect.x + this.mediaRect.w * 0.5;
        const cy = this.mediaRect.y + this.mediaRect.h * 0.5;
        const expand = (p) => {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d = Math.max(1, Math.hypot(dx, dy));
          return {
            x: p.x + dx / d * pad,
            y: p.y + dy / d * pad
          };
        };
        for (let x = 0; x < CFG.cols; x++) top.push(expand(this.pt(x, 0)));
        for (let y = 1; y < CFG.rows; y++) right.push(expand(this.pt(CFG.cols - 1, y)));
        for (let x = CFG.cols - 2; x >= 0; x--) bottom.push(expand(this.pt(x, CFG.rows - 1)));
        for (let y = CFG.rows - 2; y > 0; y--) left.push(expand(this.pt(0, y)));
        const pts = top.concat(right, bottom, left);
        context.beginPath();
        context.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          const n = pts[(i + 1) % pts.length];
          context.quadraticCurveTo(p.x, p.y, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5);
        }
        context.closePath();
      }

      getBoundaryPath(context) {
        const top = [];
        const right = [];
        const bottom = [];
        const left = [];
        for (let x = 0; x < CFG.cols; x++) top.push(this.pt(x, 0));
        for (let y = 1; y < CFG.rows; y++) right.push(this.pt(CFG.cols - 1, y));
        for (let x = CFG.cols - 2; x >= 0; x--) bottom.push(this.pt(x, CFG.rows - 1));
        for (let y = CFG.rows - 2; y > 0; y--) left.push(this.pt(0, y));
        const pts = top.concat(right, bottom, left);
        context.beginPath();
        context.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          const n = pts[(i + 1) % pts.length];
          context.quadraticCurveTo(p.x, p.y, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5);
        }
        context.closePath();
      }

      render(context) {
        if (coverMode === "frosted") {
          this.renderFrosted(context);
          return;
        }
        context.save();
        // r24: 用稍微外扩的遮挡路径绘制幕布本体，避免边角卷曲时露出后方媒体/视频。
        // 视觉描边仍然使用真实边界，所以不会出现边线和幕布分离。
        const coveragePad = this.rollProgress > 0.82 ? 1.2 : 7;
        this.getCoveragePath(context, coveragePad);
        context.clip();

        if (cameraVideo.readyState >= 2) {
          context.globalAlpha = 1;
          drawStageCamera();
        }

        const stress = this.visualStress();
        if (stress > 0.018) {
          const open = this.openness();
          const textile = constrain((stress - 0.018) / 0.72, 0, 1);
          const veilStrength = textile * (0.005 + open * 0.018);
          const shadowStrength = textile * (0.004 + open * 0.016);
          const veil = context.createLinearGradient(this.mediaRect.x, this.mediaRect.y, this.mediaRect.x, this.mediaRect.y + this.mediaRect.h);
          veil.addColorStop(0, `rgba(255,255,255,${veilStrength.toFixed(3)})`);
          veil.addColorStop(0.45, `rgba(255,255,255,${(veilStrength * 0.28).toFixed(3)})`);
          veil.addColorStop(1, `rgba(0,0,0,${shadowStrength.toFixed(3)})`);
          context.globalAlpha = 1;
          context.fillStyle = veil;
          context.fillRect(0, 0, stageW(), stageH());

          drawFineGauze(this, context, textile);
          drawVeilWrinkles(this, context, stress);
        }
        context.restore();

        this.drawSoftEdge(context, stress);
        if (this.rollProgress > 0.88) this.drawTieRopes(context);
      }


      renderFrosted(context) {
        // r63: frosted mode is not a physical curtain. It is a rectangular
        // frosted overlay over the same display area used by transparent mode.
        // No cloth boundary, no ropes, no roll state, no pinch-open behavior.
        const r = displayRectFor(this);
        context.save();
        context.beginPath();
        context.rect(r.x, r.y, r.w, r.h);
        context.clip();

        const source = sourceForCloth(this);
        const hasSource = source && mediaReady(source);
        const hasCamera = cameraVideo.readyState >= 2;
        if (hasCamera) {
          context.save();
          context.filter = `blur(${FROST_CFG.blur}px) saturate(0.88) contrast(1.03)`;
          drawStageCamera();
          context.restore();
        } else {
          context.fillStyle = "rgba(210,220,225,0.22)";
          context.fillRect(r.x, r.y, r.w, r.h);
        }

        const glass = context.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
        glass.addColorStop(0, `rgba(245,250,255,${FROST_CFG.glassAlpha})`);
        glass.addColorStop(0.55, `rgba(210,230,240,${FROST_CFG.glassAlpha * 0.52})`);
        glass.addColorStop(1, `rgba(255,255,255,${FROST_CFG.glassAlpha * 0.28})`);
        context.fillStyle = glass;
        context.fillRect(r.x, r.y, r.w, r.h);

        // r73: reveal clean content through a persistent erase mask. This is
        // much cheaper than replaying every historical erase circle each frame.
        const maskEntry = frostEraseMasks.get(this.id);
        if (maskEntry && maskEntry.canvas && maskEntry.hasMarks) {
          const layer = ensureFrostRevealLayer(this.id, r);
          const lctx = layer.ctx;
          lctx.__scale = layer.scale || 1;
          drawCleanFrostContentTo(lctx, r, source, hasSource, hasCamera);
          lctx.save();
          lctx.setTransform(1, 0, 0, 1, 0, 0);
          lctx.globalCompositeOperation = "destination-in";
          lctx.drawImage(maskEntry.canvas, 0, 0, layer.canvas.width, layer.canvas.height);
          lctx.restore();
          context.drawImage(layer.canvas, r.x, r.y, r.w, r.h);
        }
        context.restore();

        this.drawFrostedEdge(context);
      }

      drawFrostedEdge(context) {
        const r = displayRectFor(this);
        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";
        context.strokeStyle = "rgba(255,255,255,0.22)";
        context.lineWidth = 1.2;
        context.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        context.strokeStyle = "rgba(0,0,0,0.08)";
        context.lineWidth = 3;
        context.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
        context.restore();
      }

      visualStress() {
        if (this.rollTarget > 0 || this.rollProgress > 0.02) return 1;
        if (this.isGrabbed()) {
          const motion = this.grabMotionAmount();
          const unit = Math.max(1, Math.min(this.mediaRect.w, this.mediaRect.h));
          return constrain(0.24 + motion / (unit * 0.26), 0.28, 1);
        }
        let total = 0;
        const sampleStep = 4;
        let count = 0;
        for (let y = 0; y < CFG.rows; y += sampleStep) {
          for (let x = 0; x < CFG.cols; x += sampleStep) {
            const p = this.pt(x, y);
            total += Math.hypot(p.x - p.baseX, p.y - p.baseY);
            count++;
          }
        }
        const avg = total / Math.max(1, count);
        return constrain((avg - 1.8) / 34, 0, 1);
      }

      drawTieRopes(context) {
        const left = this.pt(0, 1);
        const right = this.pt(CFG.cols - 1, 1);
        const size = Math.max(14, Math.min(28, this.mediaRect.w * 0.026));
        context.save();
        if (this.tiedLeft) this.drawRopeBundle(context, left.x - size * 0.2, left.y + size * 0.15, size, -1);
        if (this.tiedRight) this.drawRopeBundle(context, right.x + size * 0.2, right.y + size * 0.15, size, 1);
        context.restore();
      }

      drawRopeBundle(context, x, y, size, dir) {
        context.save();
        context.translate(x, y);
        context.scale(dir, 1);
        context.strokeStyle = "rgba(230,235,232,0.62)";
        context.lineWidth = 1.4;
        context.lineCap = "round";
        for (let i = 0; i < 3; i++) {
          const s = size * (0.45 + i * 0.18);
          context.beginPath();
          context.ellipse(0, -i * 1.4, s * 0.42, s * 0.24, 0.45 + i * 0.18, 0.15, Math.PI * 1.88);
          context.stroke();
        }
        context.strokeStyle = "rgba(245,250,248,0.42)";
        context.lineWidth = 1.1;
        context.beginPath();
        context.moveTo(-size * 0.08, -size * 0.32);
        context.quadraticCurveTo(size * 0.2, 0, -size * 0.04, size * 0.32);
        context.stroke();
        context.restore();
      }

      visualEdgePoint(p, pad = 0) {
        if (!pad) return p;
        const cx = this.mediaRect.x + this.mediaRect.w * 0.5;
        const cy = this.mediaRect.y + this.mediaRect.h * 0.5;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.max(1, Math.hypot(dx, dy));
        return {
          x: p.x + dx / d * pad,
          y: p.y + dy / d * pad
        };
      }

      drawSideEdges(context, pad = 0) {
        // r26: 边线和幕布本体使用同一套轻微外扩边界，避免线条与可见边缘脱离。
        context.beginPath();
        let leftStart = this.visualEdgePoint(this.pt(0, 1), pad);
        context.moveTo(leftStart.x, leftStart.y);
        for (let y = 2; y < CFG.rows; y++) {
          const p = this.visualEdgePoint(this.pt(0, y), pad);
          const n = this.visualEdgePoint(this.pt(0, Math.min(CFG.rows - 1, y + 1)), pad);
          context.quadraticCurveTo(p.x, p.y, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5);
        }
        let rightStart = this.visualEdgePoint(this.pt(CFG.cols - 1, CFG.rows - 1), pad);
        context.moveTo(rightStart.x, rightStart.y);
        for (let y = CFG.rows - 2; y >= 1; y--) {
          const p = this.visualEdgePoint(this.pt(CFG.cols - 1, y), pad);
          const n = this.visualEdgePoint(this.pt(CFG.cols - 1, Math.max(1, y - 1)), pad);
          context.quadraticCurveTo(p.x, p.y, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5);
        }
      }

      drawSoftBottomHem(context, visible, pad = 0) {
        // 底边仍然断续显示，但位置跟随幕布本体的外扩边界，避免边线漂移。
        const bottomY = CFG.rows - 1;
        const t = frameCount * 0.018;
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        for (let x = 1; x < CFG.cols - 2; x += 2) {
          const fade = Math.sin((x / (CFG.cols - 1)) * Math.PI);
          if (fade < 0.18) continue;
          const flicker = 0.62 + 0.38 * Math.sin(t + x * 0.73);
          const alpha = 0.045 * visible * fade * flicker;
          if (alpha < 0.006) continue;
          const p = this.visualEdgePoint(this.pt(x, bottomY), pad);
          const n = this.visualEdgePoint(this.pt(x + 1, bottomY), pad);
          const nn = this.visualEdgePoint(this.pt(Math.min(CFG.cols - 1, x + 2), bottomY), pad);
          context.beginPath();
          context.moveTo(p.x, p.y);
          context.quadraticCurveTo(n.x, n.y, (n.x + nn.x) * 0.5, (n.y + nn.y) * 0.5);
          context.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          context.lineWidth = 0.7 + 0.25 * fade;
          context.stroke();
        }
        context.restore();
      }

      drawSoftEdge(context, stress = 0) {
        const visible = constrain((stress - 0.12) / 0.48, 0, 1);
        if (visible <= 0.001) return;
        const edgePad = 7;
        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";

        this.drawSideEdges(context, edgePad);
        context.strokeStyle = `rgba(0,0,0,${(0.012 * visible).toFixed(3)})`;
        context.lineWidth = 1.4;
        context.stroke();

        this.drawSideEdges(context, edgePad);
        context.strokeStyle = `rgba(255,255,255,${(0.075 * visible).toFixed(3)})`;
        context.lineWidth = 0.7;
        context.stroke();
        context.restore();

        this.drawSoftBottomHem(context, visible, edgePad);
      }

      nearestPoints(x, y) {
        return this.points
          .filter((p) => !p.pinned)
          .map((p) => {
            const d = Math.hypot(p.x - x, p.y - y);
            return { p, d };
          })
          .filter((item) => item.d < CFG.grabRadius)
          .sort((a, b) => a.d - b.d)
          .slice(0, CFG.maxGrabPoints)
          .map((item) => {
            const q = item.d / CFG.grabRadius;
            return {
              p: item.p,
              d: item.d,
              ox: item.p.x - x,
              oy: item.p.y - y,
              weight: Math.exp(-q * q * 3.8)
            };
          });
      }

      contains(x, y) {
        const r = this.mediaRect;
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
      }

      moveBy(dx, dy) {
        this.mediaRect.x += dx;
        this.mediaRect.y += dy;
        for (const p of this.points) {
          p.x += dx;
          p.y += dy;
          p.oldx += dx;
          p.oldy += dy;
          p.baseX += dx;
          p.baseY += dy;
          if (p.pinned) {
            p.pinx += dx;
            p.piny += dy;
          }
        }
      }

      setScale(scale) {
        const cx = this.mediaRect.x + this.mediaRect.w / 2;
        const top = this.mediaRect.y;
        const nextW = this.mediaRect.w / Math.max(0.001, this.mediaRect.scaleRef || 1) * scale;
        const nextH = this.mediaRect.h / Math.max(0.001, this.mediaRect.scaleRef || 1) * scale;
        this.resizeToRect({
          x: cx - nextW / 2,
          y: top,
          w: nextW,
          h: nextH,
          scaleRef: scale
        }, scale);
      }

      resizeToRect(nextRect, scale) {
        this.scale = scale;
        if (this.item) this.item.sizeScale = scale;
        const old = { ...this.mediaRect };
        this.mediaRect = { ...nextRect };
        for (const p of this.points) {
          const nx = (p.baseX - old.x) / old.w;
          const ny = (p.baseY - old.y) / old.h;
          const cxNorm = (p.x - old.x) / old.w;
          const cyNorm = (p.y - old.y) / old.h;
          const oxNorm = (p.oldx - old.x) / old.w;
          const oyNorm = (p.oldy - old.y) / old.h;
          const newBaseX = this.mediaRect.x + nx * this.mediaRect.w;
          const newBaseY = this.mediaRect.y + ny * this.mediaRect.h;
          p.baseX = newBaseX;
          p.baseY = newBaseY;
          p.x = this.mediaRect.x + cxNorm * this.mediaRect.w;
          p.y = this.mediaRect.y + cyNorm * this.mediaRect.h;
          p.oldx = this.mediaRect.x + oxNorm * this.mediaRect.w;
          p.oldy = this.mediaRect.y + oyNorm * this.mediaRect.h;
          if (p.pinned) {
            p.pinx = newBaseX;
            p.piny = newBaseY;
          }
        }
        this.refreshStickLengths();
        this.settleStart = performance.now();
      }

      setScaleByGesture(scale, anchorX, anchorY) {
        const baseW = this.mediaRect.w / Math.max(0.001, this.mediaRect.scaleRef || 1);
        const baseH = this.mediaRect.h / Math.max(0.001, this.mediaRect.scaleRef || 1);
        const coverScale = Math.max(stageW() / baseW, stageH() / baseH) * 1.02;
        const nextScale = constrain(scale, 0.45, Math.max(1.35, coverScale));
        const nextW = baseW * nextScale;
        const nextH = baseH * nextScale;
        const old = this.mediaRect;
        const oldCx = old.x + old.w / 2;
        const oldCy = old.y + old.h / 2;
        const targetCx = oldCx + ((anchorX ?? oldCx) - oldCx) * 0.12;
        const targetCy = oldCy + ((anchorY ?? oldCy) - oldCy) * 0.08;
        let x = targetCx - nextW / 2;
        let y = targetCy - nextH / 2;
        if (nextW <= stageW()) x = constrain(x, 0, stageW() - nextW);
        else x = constrain(x, stageW() - nextW, 0);
        if (nextH <= stageH()) y = constrain(y, 0, stageH() - nextH);
        else y = constrain(y, stageH() - nextH, 0);
        this.resizeToRect({ x, y, w: nextW, h: nextH, scaleRef: nextScale }, nextScale);
      }

      refreshStickLengths() {
        for (const stick of this.sticks) {
          stick.len = Math.hypot(stick.a.baseX - stick.b.baseX, stick.a.baseY - stick.b.baseY);
        }
      }

      setHung(hung) {
        this.rollTarget = hung ? 1 : 0;
        this.hung = hung && this.rollProgress > 0.99;
        this.settleStart = performance.now();
        this.manualUntieActive = false;
        this.lastUntiedSide = null;
        if (hung) {
          this.tiedLeft = true;
          this.tiedRight = true;
        } else {
          this.tiedLeft = false;
          this.tiedRight = false;
        }
        for (const p of this.points) {
          p.liftPulse = 0;
        }
      }

      tieAnchor(side) {
        const p = side === "left" ? this.pt(0, 1) : this.pt(CFG.cols - 1, 1);
        const size = Math.max(14, Math.min(28, this.mediaRect.w * 0.026));
        return {
          x: p.x + (side === "left" ? -size * 0.2 : size * 0.2),
          y: p.y + size * 0.15
        };
      }

      tieSideForX(x, y = null) {
        if (this.isRolledOrTied()) {
          const yy = y == null ? this.mediaRect.y : y;
          const left = this.tieAnchor("left");
          const right = this.tieAnchor("right");
          const leftD = Math.hypot(x - left.x, yy - left.y);
          const rightD = Math.hypot(x - right.x, yy - right.y);
          return leftD <= rightD ? "left" : "right";
        }
        return x < this.mediaRect.x + this.mediaRect.w * 0.5 ? "left" : "right";
      }

      rolledPullAmount(dragY) {
        const divisor = this.mediaRect.h * (isMobileLayout() ? 0.30 : 0.38);
        return constrain((dragY - this.mediaRect.y) / divisor, 0, 1);
      }

      shouldHideRopesFromRoll(dragY) {
        // Arm the tear-away only after the pulled point passes half of the curtain
        // height. The actual drop waits until pinch/pointer release, so it feels
        // like the user has pulled the cord off and then let go.
        const ratio = isMobileLayout() ? (CFG.mobileRolledDropRatio || 0.34) : 0.5;
        return dragY >= this.mediaRect.y + this.mediaRect.h * ratio;
      }

      shouldDropFromRoll(startY, dragY, vy = 0) {
        return this.shouldHideRopesFromRoll(dragY);
      }

      pullTieOnly(side, dragY, force = false) {
        const amount = this.rolledPullAmount(dragY);
        if (!force && amount < 0.06) return false;

        // Lock the state as a manual untie. Without this, the roll-up logic re-binds
        // both sides on the next physics frame because rollTarget is still 1.
        this.manualUntieActive = true;
        this.lastUntiedSide = side;
        if (side === "left") this.tiedLeft = false;
        if (side === "right") this.tiedRight = false;

        this.releaseGraceUntil = performance.now() + 1600;
        this.tugRolledSide(side, amount);
        return true;
      }

      releaseTie(side, dragY, force = false) {
        // Kept for compatibility: release only the selected side.
        // Full drop is now controlled by releaseFromRoll() after a clear downward pull.
        return this.pullTieOnly(side, dragY, force);
      }

      tugRolledSide(side, amount) {
        const leftSide = side === "left";
        for (const p of this.points) {
          const sideWeight = leftSide ? 1 - p.u : p.u;
          const w = Math.pow(sideWeight, 1.8) * (0.25 + amount);
          p.y += this.mediaRect.h * 0.035 * w;
          p.oldy = p.y - (3 + amount * 7) * w;
        }
      }

      releaseFromRoll(dragY) {
        const amount = constrain((dragY - this.mediaRect.y) / (this.mediaRect.h * 0.5), 0.5, 1);
        const side = this.lastUntiedSide || "center";
        const now = performance.now();
        this.rollTarget = 0;
        // Hide the knots after release, but do not snap the cloth open. For a short
        // window we also skip the roll-up solver, so the shape starts from the user's
        // pulled-down rope pose and then gravity/Verlet motion unwraps it naturally.
        this.rollProgress = Math.min(this.rollProgress, 0.94);
        this.dropFromRollUntil = now + 3000;
        // r38：取消“放下后特殊强制回正窗口”。
        // 先让幕布按当前形态自然掉落；延长自然掉落保护窗口，避免松手约 2 秒后 roll/settle 求解突然把布拉回顶部再下落。
        this.postRollRecoveryUntil = 0;
        this.settleStart = now + 3000;
        this.hung = false;
        this.tiedLeft = false;
        this.tiedRight = false;
        this.manualUntieActive = false;
        this.lastUntiedSide = null;
        this.releaseGraceUntil = now + 1800;

        const pullSide = side === "left" ? -1 : side === "right" ? 1 : 0;
        const fall = 7 + amount * 15;
        for (const p of this.points) {
          if (p.pinned) continue;
          const sideBias = pullSide === 0 ? 0.55 : (pullSide < 0 ? 1 - p.u : p.u);
          const openTargetY = this.mediaRect.y + p.v * this.mediaRect.h * (0.42 + amount * 0.48);
          const ease = (0.08 + p.v * 0.20) * (0.55 + sideBias * 0.45);
          p.x += (p.baseX - p.x) * 0.018;
          p.y += (openTargetY - p.y) * Math.min(ease, 0.055);
          // Verlet velocity: oldy above current y means the cloth continues moving down.
          p.oldx = p.x - pullSide * sideBias * amount * 0.45;
          p.oldy = p.y - fall * (0.12 + p.v * 0.42) * (0.65 + sideBias * 0.35);
          p.liftPulse = Math.min(p.liftPulse, -amount * (0.2 + p.v * 0.6));
        }
        return true;
      }

      shouldAutoHang(x, y, vy) {
        if (this.rollTarget > 0) return false;
        if (performance.now() < this.releaseGraceUntil) return false;
        if (vy > 2) return false;
        return this.openness() > 0.66;
      }

      isRolledOrTied() {
        return this.rollProgress > 0.82 || this.rollTarget > 0 || this.tiedLeft || this.tiedRight;
      }

      openness() {
        if (this.hung) return 1;
        let bottom = 0;
        let middle = 0;
        for (let x = 0; x < CFG.cols; x++) bottom += this.pt(x, CFG.rows - 1).y;
        for (let x = 0; x < CFG.cols; x++) middle += this.pt(x, Math.floor(CFG.rows * 0.56)).y;
        bottom /= CFG.cols;
        middle /= CFG.cols;
        const bottomOpen = constrain((this.mediaRect.y + this.mediaRect.h - bottom) / (this.mediaRect.h * 0.58), 0, 1);
        const midOpen = constrain((this.mediaRect.y + this.mediaRect.h * 0.56 - middle) / (this.mediaRect.h * 0.4), 0, 1);
        return constrain(bottomOpen * 0.72 + midOpen * 0.28, 0, 1);
      }

      impulse(x, y, vx, vy) {
        const up = vy < -15;
        const down = vy > 15;
        if (!up && !down) return;
        const strength = constrain(Math.abs(vy) * 0.075, 1.1, 4.5);
        for (const p of this.points) {
          if (p.pinned) continue;
          const local = Math.exp(-Math.pow((p.x - x) / (this.mediaRect.w * 0.44), 2));
          const upper = up ? 1 - p.v * 0.72 : 0.35 + p.v * 0.8;
          const w = constrain(local * upper, 0, 1);
          if (up) {
            p.oldy += strength * 4.4 * w;
            p.oldx -= vx * 0.28 * w;
            p.liftPulse = Math.max(p.liftPulse, strength * w * 0.18);
          } else {
            p.oldy -= strength * 9.2 * w;
            p.liftPulse = Math.min(p.liftPulse, -strength * w * 0.28);
          }
        }
      }
    }
