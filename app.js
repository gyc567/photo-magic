/* ============================================================
   拾光影棚 — 交互层
   ============================================================ */
import {
  PRESETS, generate, generateUnlocked, canvasToBlob, toPreview, loadImage,
} from './engine.js';

const $ = (id) => document.getElementById(id);

const state = {
  file: null,
  dataUrl: null,
  preset: 'id',
  bgIndex: 0,
  unlocked: false,
  result: null,       // { photo, sheet, preset, bg }
  unlockedResult: null,
  busy: false,
};

/* ---------- 提示 ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ---------- 预设图标 ---------- */
const ICONS = {
  id: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="2"/><path d="M4.5 16c.8-2 2.2-3 4-3s3.2 1 4 3"/><path d="M14 9h4M14 12h4"/></svg>`,
  business: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7 12 3 4 7v10l8 4 8-4V7Z"/><path d="m4 7 8 4 8-4M12 21V11"/></svg>`,
  portrait: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="9.5" r="2.6"/><path d="M7.5 18c1-2.6 2.6-4 4.5-4s3.5 1.4 4.5 4"/></svg>`,
  meme: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>`,
};

/* ---------- 渲染预设按钮 ---------- */
function renderPresets() {
  const box = $('presets');
  box.innerHTML = Object.entries(PRESETS).map(([key, p]) => `
    <button class="preset ${key === state.preset ? 'sel' : ''}" data-key="${key}">
      <div class="preset-ico">${ICONS[key]}</div>
      <strong>${p.name}</strong>
      <span>${p.label}</span>
    </button>
  `).join('');

  box.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.busy) return;
      state.preset = btn.dataset.key;
      state.bgIndex = 0;
      renderPresets();
      run();
    });
  });
}

/* ---------- 生成 ---------- */
async function run() {
  if (!state.dataUrl) return;
  setBusy(true);
  try {
    const r = state.unlocked
      ? await generateUnlocked(state.dataUrl, state.preset, state.bgIndex)
      : await generate(state.dataUrl, state.preset, state.bgIndex);
    state.result = r;

    if (state.unlocked) state.unlockedResult = r;

    const canvas = $('outCanvas');
    canvas.width = r.sheet.width;
    canvas.height = r.sheet.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(r.sheet, 0, 0);

    $('resultTitle').textContent = r.preset.name;
    $('resultMeta').textContent =
      r.preset.sheet === 'a4' ? 'A4 排版 · 8 张' :
      r.preset.sheet === 'quad' ? '4 张拼版' : '9 宫格';

    updateLockUI();
  } catch (err) {
    console.error('生成失败:', err);
    toast('生成失败，请换一张照片试试');
  } finally {
    setBusy(false);
  }
}

function setBusy(on) {
  state.busy = on;
  const btn = $('btnPaid');
  btn.disabled = on || state.unlocked;
  btn.textContent = on ? '生成中…' : (state.unlocked ? '已支付' : '我已支付');
}

/* ---------- 锁定态 UI ---------- */
function updateLockUI() {
  const locked = !state.unlocked;
  const tag = $('resultTag');
  const wrap = $('canvasWrap');
  const dl = $('btnDl');
  const panel = $('payPanel');

  if (locked) {
    tag.textContent = '预览版 · 带水印';
    tag.className = 'tag locked';
    wrap.classList.add('locked');
    dl.disabled = true;
    dl.textContent = '下载高清';
    if (panel) panel.style.display = '';
    $('footNote').textContent = '解锁后可下载：证件照 A4 排版 / 写真 4 张 / 表情包 9 宫格';
  } else {
    tag.textContent = '高清无水印';
    tag.className = 'tag';
    wrap.classList.remove('locked');
    dl.disabled = false;
    dl.textContent = '下载高清';
    if (panel) panel.style.display = 'none';
    $('footNote').textContent =
      state.preset === 'id' ? '已解锁 · A4 排版 8 张 · 可直接送印' :
      state.preset === 'business' ? '已解锁 · A4 排版 8 张 · 可直接送印' :
      state.preset === 'portrait' ? '已解锁 · 4 张拼版 · 3:4 竖版' :
      '已解锁 · 9 宫格表情包 · 1:1 方图';
  }
}

/* ---------- 文件处理 ---------- */
function handleFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    toast('请选择图片文件');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast('图片太大啦，请控制在 20MB 以内');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const url = e.target.result;
    // 校验能否解码
    try {
      const img = await loadImage(url);
      if (img.width < 200 || img.height < 200) {
        toast('图片太小了，至少要 200×200');
        return;
      }
      state.file = file;
      state.dataUrl = url;
      state.unlocked = false;
      state.unlockedResult = null;

      $('srcThumb').src = url;
      $('srcName').textContent = file.name;
      $('srcMeta').textContent =
        `${img.width}×${img.height} · ${(file.size / 1024 / 1024).toFixed(2)}MB`;

      $('uploader').style.display = 'none';
      $('preview').classList.add('on');
      $('payHint').classList.remove('on');
      $('btnPaid').disabled = false;
      $('btnPaid').textContent = '我已支付';

      renderPresets();
      await run();   // run() 内部会调 updateLockUI()，统一在此处决定按钮显隐
      $('preview').scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      toast('这张图片读不出来，换一张试试');
    }
  };
  reader.readAsDataURL(file);
}

/* ---------- 下载 ---------- */
function download(canvas, filename) {
  canvasToBlob(canvas).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/* ---------- 事件绑定 ---------- */
const drop = $('drop');
const fileInput = $('file');

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

$('btnReset').addEventListener('click', () => {
  state.file = null; state.dataUrl = null; state.unlocked = false;
  state.result = null; state.unlockedResult = null;
  $('uploader').style.display = '';
  $('preview').classList.remove('on');
  $('payHint').classList.remove('on');
  $('payPanel').style.display = '';
  $('btnPaid').disabled = false;
  $('btnPaid').textContent = '我已支付';
  fileInput.value = '';
});

$('btnUnlock').addEventListener('click', () => {
  const qr = document.querySelector('#payPanel .pay-qr');
  if (qr) {
    qr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    qr.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
      { duration: 700, iterations: 3 }
    );
  }
  toast('请用微信扫码支付 9.9 元，支付后点「我已支付」');
});

$('btnPaid').addEventListener('click', async () => {
  if (!state.dataUrl) return;
  $('payHint').classList.add('on');
  $('btnPaid').disabled = true;
  $('btnPaid').textContent = '生成中…';
  await new Promise((r) => setTimeout(r, 600));   // 模拟支付确认
  state.unlocked = true;
  await run();
  toast('已解锁，高清无水印版本生成完毕');
  $('btnPaid').textContent = '已支付';
});

$('btnDl').addEventListener('click', () => {
  if (!state.unlocked) { toast('请先解锁高清版本'); return; }
  const r = state.unlockedResult || state.result;
  const ext = r.preset.sheet === 'a4' ? 'A4排版' : r.preset.sheet === 'quad' ? '4张拼版' : '9宫格';
  download(r.sheet, `拾光影棚-${r.preset.name}-${ext}.png`);
});

$('btnDlPreview').addEventListener('click', () => {
  if (!state.result) return;
  download(state.result.sheet, '拾光影棚-预览版.png');
});

renderPresets();
updateLockUI();
