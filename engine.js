/* ============================================================
   PhotoMagic 图像处理引擎
   纯前端 Canvas 实现：人像区域估计 → 背景替换 → 尺寸裁切
   → 水印 → 拼版（证件照 A4 / 写真 4 张 / 表情包 9 宫格）
   ============================================================ */

export const PRESETS = {
  id: {
    name: '证件照',
    ratio: [25, 35],           // 一寸 25×35mm
    bg: ['#ffffff', '#dbeafe', '#fef3c7'],
    label: '一寸 · 25×35mm',
    sheet: 'a4',               // 解锁后 A4 排版
  },
  business: {
    name: '商务照',
    ratio: [35, 45],           // 二寸 35×45mm
    bg: ['#1e3a5f', '#334155', '#0f766e'],
    label: '二寸 · 35×45mm',
    sheet: 'a4',
  },
  portrait: {
    name: '写真',
    ratio: [3, 4],
    bg: ['#fef3c7', '#fce7f3', '#e0e7ff'],
    label: '3:4 竖版',
    sheet: 'quad',            // 解锁后 4 张拼版
  },
  meme: {
    name: '表情包',
    ratio: [1, 1],
    bg: ['#ffffff'],
    label: '1:1 方图',
    sheet: 'nine',            // 解锁后 9 宫格
  },
};

const MM_TO_PX = 8;           // 预览渲染密度：1mm ≈ 8px
const DPI = 300;              // 打印密度：A4 排版用 300dpi
const MM = (v) => Math.round((v / 25.4) * DPI);   // mm → 300dpi 像素
const PREVIEW_W = 720;        // 预览长边

/* ---------- 工具 ---------- */

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 估算人像主体框。
 *  真实产品应接人脸检测模型；此处在纯前端条件下用
 *  「上重下轻 + 中轴对称」的经验权重估计主体位置与范围，
 *  保证流程可跑通，接口留好可替换。
 */
export function estimateSubject(w, h) {
  const boxW = w * 0.62;
  const boxH = h * 0.78;
  const centerX = w / 2;
  const centerY = h * 0.42;               // 头部略高于中线
  return {
    x: centerX - boxW / 2,
    y: centerY - boxH / 2,
    w: boxW,
    h: boxH,
  };
}

/** 颜色量化 → 判断是否为纯色背景 */
function isFlatBackground(data, w, h, tolerance = 34) {
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(4, Math.floor(w / 60));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  r /= n; g /= n; b /= n;
  let variance = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      variance += Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b);
    }
  }
  return variance / n / 3 < tolerance;
}

/**
 * 抠图：把原背景替换为目标纯色。
 * 策略 —— 先估计主体框，再按「椭圆羽化蒙版 + 边缘羽化」合成。
 * 真实产品此处替换为人脸/人体分割模型输出。
 */
export function renderPortrait(srcImg, preset, bgColor, subjectBox) {
  const [rw, rh] = preset.ratio;
  // 统一使用 300dpi 输出，保证 A4 排版时 1:1 无缩放
  const outW = MM(rw);
  const outH = MM(rh);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');

  // 1) 背景层
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, outW, outH);

  // 2) 主体层：按主体框做 cover 裁切
  const box = subjectBox || estimateSubject(srcImg.width, srcImg.height);
  const boxCx = box.x + box.w / 2;
  const boxCy = box.y + box.h / 2;
  const targetRatio = outW / outH;

  let sw = box.w, sh = box.h;
  if (sw / sh > targetRatio) sw = sh * targetRatio;
  else sh = sw / targetRatio;
  const sx = boxCx - sw / 2, sy = boxCy - sh / 2;

  const subjectCanvas = document.createElement('canvas');
  subjectCanvas.width = outW;
  subjectCanvas.height = outH;
  const sctx = subjectCanvas.getContext('2d');
  sctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, outW, outH);

  // 3) 羽化蒙版：椭圆 + 径向渐变，模拟抠图边缘
  const mask = subjectCanvas.getContext('2d');
  const grad = mask.createRadialGradient(
    outW / 2, outH * 0.46, outW * 0.18,
    outW / 2, outH * 0.46, outW * 0.62
  );
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.72, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  mask.globalCompositeOperation = 'destination-in';
  mask.fillStyle = grad;
  mask.fillRect(0, 0, outW, outH);
  mask.globalCompositeOperation = 'source-over';

  ctx.drawImage(subjectCanvas, 0, 0);

  // 4) 证件照底色微调：证件照类加一层极淡渐变，模拟影棚光
  if (preset.name === '证件照' || preset.name === '商务照') {
    const light = ctx.createLinearGradient(0, 0, 0, outH);
    light.addColorStop(0, 'rgba(255,255,255,0.16)');
    light.addColorStop(0.45, 'rgba(255,255,255,0)');
    light.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, outW, outH);
  }

  return canvas;
}

/* ---------- 水印 ---------- */

export function applyWatermark(canvas, text = '预览') {
  const ctx = canvas.getContext('2d');
  const size = Math.round(canvas.width * 0.13);
  ctx.save();
  ctx.font = `800 ${size}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 9);

  const step = size * 2.2;
  for (let y = -canvas.height; y < canvas.height; y += step) {
    for (let x = -canvas.width; x < canvas.width; x += step) {
      // 深色描边打底，保证浅色背景上也能看清
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillText(text, x, y);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1.5, size * 0.045);
      ctx.strokeText(text, x, y);
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
  return canvas;
}

/* ---------- 拼版 ---------- */

/** 证件照 A4 排版：25×35mm，300dpi 对应 295×413px，
 *  A4 210×297mm 内可排 8 张（2×4），含裁切线与规格标注 */
export function buildA4Sheet(photoCanvas, unlocked) {
  const sheetW = MM(210), sheetH = MM(297);
  const pw = MM(25), ph = MM(35);
  const gap = MM(4);

  const sheet = document.createElement('canvas');
  sheet.width = sheetW; sheet.height = sheetH;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheetW, sheetH);

  const cols = 2, rows = 4;
  const totalW = cols * pw + (cols - 1) * gap;
  const totalH = rows * ph + (rows - 1) * gap;
  const ox = (sheetW - totalW) / 2;
  const oy = MM(16);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + c * (pw + gap);
      const y = oy + r * (ph + gap);
      ctx.drawImage(photoCanvas, x, y, pw, ph);
      ctx.strokeStyle = '#d4d4d8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, pw, ph);
      ctx.setLineDash([]);
    }
  }

  ctx.fillStyle = '#52525b';
  ctx.font = `400 ${MM(3.2)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('25×35mm · 8 张 · A4', sheetW / 2, sheetH - MM(9));

  if (!unlocked) applyWatermark(sheet, '预览');
  return sheet;
}

/** 写真 4 张拼版 */
export function buildQuadSheet(photoCanvas, unlocked) {
  const W = 1200, H = 1600;
  const sheet = document.createElement('canvas');
  sheet.width = W; sheet.height = H;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, W, H);
  const pad = 24, gap = 16;
  const cw = (W - pad * 2 - gap) / 2;
  const ch = (H - pad * 2 - gap) / 2;
  // cover 裁切比例，避免拉伸变形
  const sAspect = photoCanvas.width / photoCanvas.height;
  const cAspect = cw / ch;
  let dw = cw, dh = ch;
  if (sAspect > cAspect) dw = ch * sAspect; else dh = cw / sAspect;
  const sx = (cw - dw) / 2, sy = (ch - dh) / 2;

  for (let i = 0; i < 4; i++) {
    const x = pad + (i % 2) * (cw + gap);
    const y = pad + Math.floor(i / 2) * (ch + gap);
    ctx.drawImage(photoCanvas, x + sx, y + sy, dw, dh);
  }
  if (!unlocked) applyWatermark(sheet, '预览');
  return sheet;
}

/** 表情包 9 宫格 */
export function buildNineGrid(photoCanvas, unlocked) {
  const CELL = 300;
  const sheet = document.createElement('canvas');
  sheet.width = CELL * 3; sheet.height = CELL * 3;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  for (let i = 0; i < 9; i++) {
    const x = (i % 3) * CELL, y = Math.floor(i / 3) * CELL;

    // 每格做轻微变换，模拟不同表情包构图（缩放 + 微旋转）
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL, CELL);
    ctx.clip();
    ctx.translate(x + CELL / 2, y + CELL / 2);
    const zoom = 1 + (i % 3) * 0.06;
    const rot = (i % 2 ? 1 : -1) * (i % 3) * 0.02;
    ctx.rotate(rot);
    ctx.scale(zoom, zoom);

    // cover 裁切：保持原图比例填满格子，不变形
    const sAspect = photoCanvas.width / photoCanvas.height;
    let dw = CELL, dh = CELL;
    if (sAspect > 1) dw = CELL * sAspect; else dh = CELL / sAspect;
    ctx.drawImage(photoCanvas, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    // 边框画在照片之上，用中性灰避免被裁切线干扰
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
  }
  if (!unlocked) applyWatermark(sheet, '预览');
  return sheet;
}

/** 预览图：等比缩到固定宽度 */
export function toPreview(canvas, w = PREVIEW_W) {
  const scale = w / canvas.width;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/** 生成该预设对应的成品（预览版带水印） */
export function generate(imageSrc, presetKey, bgIndex = 0) {
  return loadImage(imageSrc).then((img) => {
    const preset = PRESETS[presetKey];
    const bg = preset.bg[bgIndex % preset.bg.length];
    const subject = estimateSubject(img.width, img.height);
    const photo = renderPortrait(img, preset, bg, subject);
    const sheet = preset.sheet === 'a4' ? buildA4Sheet(photo, false)
      : preset.sheet === 'quad' ? buildQuadSheet(photo, false)
        : buildNineGrid(photo, false);
    return { photo, sheet, preset, bg };
  });
}

/** 解锁后重新生成无水印版本 */
export function generateUnlocked(imageSrc, presetKey, bgIndex = 0) {
  return loadImage(imageSrc).then((img) => {
    const preset = PRESETS[presetKey];
    const bg = preset.bg[bgIndex % preset.bg.length];
    const subject = estimateSubject(img.width, img.height);
    const photo = renderPortrait(img, preset, bg, subject);
    const sheet = preset.sheet === 'a4' ? buildA4Sheet(photo, true)
      : preset.sheet === 'quad' ? buildQuadSheet(photo, true)
        : buildNineGrid(photo, true);
    return { photo, sheet, preset, bg };
  });
}

export function canvasToBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, 'image/png', 0.95));
}
