// Transparent veil rendering helpers.
// Kept separate from cloth physics so texture tuning stays isolated.

function veilSamplePoint(cloth, u, v) {
  const x = constrain(u, 0, 1) * (CFG.cols - 1);
  const y = constrain(v, 0, 1) * (CFG.rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(CFG.cols - 1, x0 + 1);
  const y1 = Math.min(CFG.rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = cloth.pt(x0, y0);
  const b = cloth.pt(x1, y0);
  const c = cloth.pt(x0, y1);
  const d = cloth.pt(x1, y1);
  const topX = a.x + (b.x - a.x) * tx;
  const topY = a.y + (b.y - a.y) * tx;
  const bottomX = c.x + (d.x - c.x) * tx;
  const bottomY = c.y + (d.y - c.y) * tx;
  return {
    x: topX + (bottomX - topX) * ty,
    y: topY + (bottomY - topY) * ty
  };
}

function drawFineGauze(cloth, context, stress = 1) {
  const open = cloth.openness();
  const visibility = constrain(stress, 0, 1) * (0.42 + open * 0.58);
  if (visibility <= 0.01) return;
  const t = frameCount * 0.012;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  const verticalCount = CFG.cols * 4;
  for (let i = 2; i < verticalCount - 2; i++) {
    const u = i / verticalCount;
    const fade = Math.sin(u * Math.PI);
    const shimmer = 0.74 + 0.26 * Math.sin(t + i * 0.39);
    const mainThread = i % 4 === 0;
    const alpha = (mainThread ? 0.15 : 0.075) * visibility * fade * shimmer;
    if (alpha < 0.006) continue;
    context.beginPath();
    for (let j = 1; j < CFG.rows - 1; j += 1.15) {
      const v = j / (CFG.rows - 1);
      const p = veilSamplePoint(cloth, u, v);
      const wobble = Math.sin(t * 1.4 + j * 0.31 + i * 0.17) * 0.45;
      if (j === 1) context.moveTo(p.x + wobble, p.y);
      else {
        const prev = veilSamplePoint(cloth, u, Math.max(0, (j - 0.58) / (CFG.rows - 1)));
        context.quadraticCurveTo(prev.x, prev.y, p.x + wobble, p.y);
      }
    }
    context.strokeStyle = mainThread
      ? `rgba(236,250,255,${alpha.toFixed(3)})`
      : `rgba(255,255,255,${alpha.toFixed(3)})`;
    context.lineWidth = mainThread ? 0.62 : 0.42;
    context.stroke();
  }

  const horizontalCount = CFG.rows * 3.5;
  for (let i = 3; i < horizontalCount - 2; i++) {
    const v = i / horizontalCount;
    const fade = Math.sin(v * Math.PI);
    const mainThread = i % 4 === 0;
    const alpha = (mainThread ? 0.085 : 0.045) * visibility * (0.45 + fade * 0.55);
    if (alpha < 0.004) continue;
    context.beginPath();
    for (let j = 1; j < CFG.cols - 1; j += 1.2) {
      const u = j / (CFG.cols - 1);
      const p = veilSamplePoint(cloth, u, v);
      const drift = Math.sin(t + j * 0.27 + i * 0.11) * 0.36;
      if (j === 1) context.moveTo(p.x, p.y + drift);
      else {
        const prev = veilSamplePoint(cloth, Math.max(0, (j - 0.6) / (CFG.cols - 1)), v);
        context.quadraticCurveTo(prev.x, prev.y, p.x, p.y + drift);
      }
    }
    context.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    context.lineWidth = mainThread ? 0.5 : 0.32;
    context.stroke();
  }

  context.globalCompositeOperation = "multiply";
  for (let i = 0; i < 10; i++) {
    const u = (i + 0.5) / 10;
    const alpha = 0.026 * visibility * Math.sin(u * Math.PI);
    context.beginPath();
    for (let j = 2; j < CFG.rows - 2; j += 2) {
      const v = j / (CFG.rows - 1);
      const p = veilSamplePoint(cloth, constrain(u + Math.sin(t + j * 0.2 + i) * 0.008, 0, 1), v);
      if (j === 2) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    }
    context.strokeStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
    context.lineWidth = 0.45;
    context.stroke();
  }

  context.globalCompositeOperation = "screen";
  for (let i = 0; i < 15; i++) {
    const v = (2 + i * 2.6) / (CFG.rows - 1);
    if (v >= 0.96) break;
    context.beginPath();
    for (let j = 2; j < CFG.cols - 2; j += 1.8) {
      const u = j / (CFG.cols - 1);
      const p = veilSamplePoint(cloth, u, constrain(v + Math.sin(t * 1.5 + j * 0.19 + i) * 0.009, 0, 1));
      if (j === 2) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    }
    context.strokeStyle = `rgba(180,230,245,${(0.045 * visibility).toFixed(3)})`;
    context.lineWidth = 0.45;
    context.stroke();
  }
  context.restore();
}

function drawVeilWrinkles(cloth, context, stress = 1) {
  const t = frameCount * 0.02;
  const visibility = constrain((stress - 0.08) / 0.92, 0, 1) * (0.18 + cloth.openness() * 0.82);
  if (visibility <= 0.01) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let i = 0; i < 10; i++) {
    const u = (i + 0.4 + Math.sin(t * 0.4 + i) * 0.16) / 10;
    const col = constrain(Math.floor(u * (CFG.cols - 1)), 1, CFG.cols - 2);
    context.beginPath();
    for (let y = 2; y < CFG.rows - 2; y += 3) {
      const p = cloth.pt(col + ((y + i) % 2), y);
      const wobble = Math.sin(t + y * 0.22 + i * 1.7) * 3.0;
      if (y === 2) context.moveTo(p.x + wobble, p.y);
      else context.quadraticCurveTo(p.x - wobble * 0.2, p.y - 5, p.x + wobble, p.y);
    }
    context.strokeStyle = i % 3 === 0
      ? `rgba(0,0,0,${(0.010 * visibility).toFixed(3)})`
      : `rgba(255,255,255,${(0.024 * visibility).toFixed(3)})`;
    context.lineWidth = i % 3 === 0 ? 0.65 : 0.78;
    context.stroke();
  }
  context.restore();
}
