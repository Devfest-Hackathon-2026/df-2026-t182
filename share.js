// Share sheet for the ending the player actually reached.
// Called from game.js: import('./share.js').then(m => m.openShare({ key, kind, title })).
// Only the ending's title and kind go into the image and the post: no story text, answers, names, messages, location or device info.

export const GAME_URL = 'https://miwoshinjite.web.app/'; // Firebase Hosting on My First Project (older copies stay up)
export const HASHTAG = '#ミーを信じて';

export const C = { night: '#101816', night2: '#1a2522', paper: '#F2F0E9', paper2: '#E6E2D8', ink: '#22272A', sage: '#A7B4AC', mint: '#6CA99B', label: '#C8A65A' };
// The game's three faces only: Kowai Mincho (titles), Noto Serif JP (the paper-like labels), Noto Sans JP (everything else).
export const MIN = '"Noto Serif JP","Hiragino Mincho ProN","Yu Mincho",serif';
export const KOWAI = `"Kowai Mincho",${MIN}`;
export const SANS = '"Noto Sans JP","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic Medium",sans-serif';

// Mi's face and the backdrop per ending. be3 has no photo: a dark ground only.
const LOOK = {
  true: { mi: 'mi-yay', photo: 'end-true.jpg' },
  trueSos: { mi: 'mi-hi', photo: 'end-true.jpg' },
  secret: { mi: 'mi-ok', photo: 'end-secret.jpg', crop: [.42, 0, .58, .4] }, // the street corner only: the phone's last line stays out of the picture
  fake: { mi: 'mi-bow', photo: 'end-fake.jpg' },
  be1: { mi: 'mi-sad', photo: 'end-bad1.jpg' },
  be2: { mi: 'mi-sleep', photo: 'end-bad2.jpg' },
  be3: { mi: 'mi-tired', photo: null }
};

const TEMPLATES = [
  { label: 'さそう', text: 'AIと一緒に、出口を探してみない？🌙\n『ミーを信じて』で「{title}」エンドにたどり着いた！\nあなたなら、ミーをどこまで信じる？👀\n{url}\n{tag}' },
  { label: 'ふつうに', text: 'スマホで遊べる脱出ゲーム『ミーを信じて』をやってみた。\n結末は「{title}」（{kind}）だったよ。\nほかの結末もあるみたい。やったら教えて〜\n{url}\n{tag}' },
  { label: 'ひとこと', text: '『ミーを信じて』、「{title}」エンドだった🌙\nミーの言うこと、どこまで聞く？\n{url}\n{tag}' }
];

const SIZES = { square: { w: 1080, h: 1080, label: '正方形' }, story: { w: 1080, h: 1920, label: 'ストーリーズ' } };

export const asset = p => new URL('./assets/' + p, import.meta.url).href;

// ── style (inserted once) ──
const CSS = `
#share-sheet{position:fixed;inset:0;z-index:60;background:#101816;color:#F2F0E9;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font-family:${SANS};font-size:16px;line-height:1.7;text-align:left;
  padding:calc(12px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom))}
#share-sheet *{box-sizing:border-box}
#share-sheet .ss-in{max-width:1080px;margin:0 auto}
#share-sheet .ss-top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px}
#share-sheet .ss-top h2{margin:0;font-family:${MIN};font-weight:600;font-size:18px;letter-spacing:.12em;color:#F2F0E9}
#share-sheet button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
#share-sheet .ss-close{min-height:44px;min-width:72px;padding:8px 14px;background:none;border:0;color:#A7B4AC;font-size:15px}
#share-sheet .ss-close:hover{color:#F2F0E9}
#share-sheet .ss-grid{display:grid;gap:20px;margin-top:8px}
#share-sheet .ss-preview{display:flex;flex-direction:column;align-items:center;gap:14px}
#share-sheet .ss-pic{position:relative;display:flex;align-items:center;justify-content:center;width:100%;min-height:200px}
#share-sheet .ss-pic img{display:block;max-width:100%;max-height:52vh;width:auto;height:auto;box-shadow:0 14px 34px #0009;background:#0b1211}
#share-sheet .ss-pic .ss-wait{font-size:14px;color:#A7B4AC}
#share-sheet .ss-seg{display:inline-flex;gap:0;border-bottom:1px solid #A7B4AC40}
#share-sheet .ss-seg button{background:none;border:0;padding:10px 16px;min-height:44px;font-size:15px;color:#A7B4AC;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
#share-sheet .ss-seg small{font-size:14px;margin-left:8px;opacity:.75}
#share-sheet .ss-seg button[aria-pressed="true"]{color:#F2F0E9;border-bottom-color:#6CA99B}
#share-sheet .ss-end small{display:inline-block;font-family:${MIN};font-size:14px;letter-spacing:.24em;color:#2a2416;background:#C8A65A;padding:1px 10px 0;transform:rotate(-2deg)}
#share-sheet .ss-end small.good{background:#6CA99B;color:#0f1a17}
#share-sheet .ss-end b{display:block;font-family:"Kowai Mincho",${MIN};font-weight:400;font-size:30px;letter-spacing:.06em;line-height:1.4;margin-top:8px}
#share-sheet .ss-label{display:block;font-size:14px;color:#A7B4AC;margin:18px 0 6px;letter-spacing:.06em}
#share-sheet .ss-side>.ss-label:first-child{margin-top:0}
#share-sheet .ss-tpl{display:flex;flex-wrap:wrap;gap:8px}
#share-sheet .ss-tpl button{background:none;border:1px solid #A7B4AC55;border-radius:999px;padding:6px 14px;min-height:40px;font-size:14px;color:#cfd6d1}
#share-sheet .ss-tpl button[aria-pressed="true"]{background:#F2F0E9;border-color:#F2F0E9;color:#101816}
#share-sheet textarea{display:block;width:100%;min-height:168px;resize:vertical;margin-top:10px;padding:12px 14px;border:0;border-radius:2px;background:#F2F0E9;color:#22272A;font-family:${SANS};font-size:16px;line-height:1.7}
#share-sheet textarea:focus{outline:2px solid #6CA99B;outline-offset:2px}
#share-sheet .ss-acts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}
#share-sheet .ss-acts button{min-height:50px;padding:10px 12px;border-radius:999px;font-size:15px;line-height:1.35;border:1px solid #A7B4AC60;background:none;color:#F2F0E9}
#share-sheet .ss-acts .ss-x{background:#F2F0E9;color:#101816;border-color:#F2F0E9}
#share-sheet .ss-acts .ss-ig{background:#6CA99B;color:#0f1a17;border-color:#6CA99B}
#share-sheet .ss-acts .wide{grid-column:1/-1}
#share-sheet .ss-acts button:disabled{opacity:.45;cursor:default}
#share-sheet .ss-note{font-size:14px;color:#A7B4AC;margin:10px 2px 0;line-height:1.65}
#share-sheet .ss-msg{min-height:1.6em;font-size:14px;color:#8FD0C0;margin:12px 2px 0;line-height:1.65}
#share-sheet .ss-msg.err{color:#e0a597}
#share-sheet .ss-done{display:block;margin:22px auto 0;min-height:48px;padding:10px 28px;background:none;border:0;border-bottom:1px solid #A7B4AC60;color:#A7B4AC;font-size:15px}
@media (min-width:860px){
  #share-sheet{padding-left:32px;padding-right:32px}
  #share-sheet .ss-grid{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:48px;align-items:start;margin-top:20px}
  #share-sheet .ss-preview{position:sticky;top:12px}
  #share-sheet .ss-pic img{max-height:calc(100dvh - 180px)}
  #share-sheet .ss-end b{font-size:36px}
}
@media (max-width:359px){#share-sheet .ss-acts{grid-template-columns:1fr}}
`;
function injectStyle() {
  if (document.getElementById('share-style')) return;
  const s = document.createElement('style'); s.id = 'share-style'; s.textContent = CSS; document.head.append(s);
}

// ── helpers ──
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const isGood = kind => /TRUE|SECRET|HAPPY/.test(kind || '');
function fill(tpl, ending) {
  return tpl.replace(/\{title\}/g, ending.title).replace(/\{kind\}/g, ending.kind).replace(/\{url\}/g, GAME_URL).replace(/\{tag\}/g, HASHTAG);
}
const imgCache = new Map();
export function loadImage(src) {
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('image: ' + src)); i.src = src; }));
  return imgCache.get(src);
}
async function fontsReady(text) {
  if (!document.fonts || !document.fonts.load) return;
  const t = text + 'ミーを信じて';
  await Promise.race([
    Promise.all([document.fonts.load(`400 80px "Kowai Mincho"`, t), document.fonts.load(`600 30px "Noto Serif JP"`, t + 'エンドにたどり着いた'), document.fonts.load(`500 30px "Noto Serif JP"`, 'エンドにたどり着いた'), document.fonts.load(`700 30px "Noto Sans JP"`, '182 lab'), document.fonts.ready]).catch(() => {}),
    new Promise(r => setTimeout(r, 3500))
  ]);
}

// Deterministic noise so every render of an ending looks the same.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
let grainCanvas = null;
export function grain() {
  if (grainCanvas) return grainCanvas;
  const g = document.createElement('canvas'); g.width = g.height = 200; const x = g.getContext('2d'); const d = x.createImageData(200, 200); const r = rng(7);
  for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 22; }
  x.putImageData(d, 0, 0); return (grainCanvas = g);
}
// A torn paper outline (like the afterword's slip), as a polygon around w×h.
export function tornPath(ctx, w, h, seed) {
  const r = rng(seed), j = () => (r() - .5) * 10;
  ctx.beginPath(); ctx.moveTo(0, 6);
  for (let x = 0; x <= w; x += w / 9) ctx.lineTo(x, Math.max(0, 4 + j()));
  ctx.lineTo(w, 6);
  for (let y = 0; y <= h; y += h / 6) ctx.lineTo(w - Math.abs(j() * .5), y);
  for (let x = w; x >= 0; x -= w / 9) ctx.lineTo(x, h - Math.max(0, 4 + j()));
  for (let y = h; y >= 0; y -= h / 6) ctx.lineTo(Math.abs(j() * .5), y);
  ctx.closePath();
}
export function tape(ctx, cx, cy, w, rot) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.shadowColor = '#0003'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
  ctx.fillStyle = 'rgba(217,207,164,.72)'; ctx.fillRect(-w / 2, -17, w, 34);
  ctx.restore();
}
function cover(ctx, img, x, y, w, h) {
  const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
  const s = Math.max(w / nw, h / nh), iw = nw * s, ih = nh * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
// The photo sits under the slip: cropped (optionally) and softened so details and any on-screen text do not read.
function soften(img, crop) {
  const nw = img.naturalWidth, nh = img.naturalHeight; const [cx, cy, cw, ch] = crop || [0, 0, 1, 1];
  const sw = nw * cw, sh = nh * ch, k = 3.2;
  const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(sw / k)); small.height = Math.max(1, Math.round(sh / k));
  const sx = small.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(img, nw * cx, nh * cy, sw, sh, 0, 0, small.width, small.height);
  const out = document.createElement('canvas'); out.width = Math.round(sw); out.height = Math.round(sh);
  const ox = out.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(small, 0, 0, out.width, out.height); return out;
}
// The stickers were cut from a sheet: slivers of the neighbours touch the edges. Keep the main figure and anything that floats free (sparkles, z's).
const stickerCache = new Map();
export function cleanSticker(img) {
  if (stickerCache.has(img.src)) return stickerCache.get(img.src);
  const w = img.naturalWidth, hh = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = hh;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  try {
    const d = x.getImageData(0, 0, w, hh), a = d.data, lab = new Int32Array(w * hh), comps = [];
    for (let i = 0; i < w * hh; i++) {
      if (lab[i] || a[i * 4 + 3] < 12) continue;
      const id = comps.length + 1, st = [i]; lab[i] = id; let n = 0, edge = false;
      while (st.length) { const p = st.pop(); n++; const px = p % w, py = (p - px) / w; if (px === 0 || py === 0 || px === w - 1 || py === hh - 1) edge = true;
        for (const q of [p - 1, p + 1, p - w, p + w]) { if (q < 0 || q >= w * hh || lab[q] || a[q * 4 + 3] < 12) continue; if ((q === p - 1 && px === 0) || (q === p + 1 && px === w - 1)) continue; lab[q] = id; st.push(q); } }
      comps.push({ n, edge });
    }
    const main = comps.reduce((m, c, i) => c.n > comps[m].n ? i : m, 0);
    for (let i = 0; i < w * hh; i++) { const l = lab[i]; if (l && l - 1 !== main && comps[l - 1].edge) a[i * 4 + 3] = 0; }
    x.putImageData(d, 0, 0);
  } catch {}
  stickerCache.set(img.src, c); return c;
}
export function fitFont(ctx, text, family, max, min, width) {
  let size = max; for (; size > min; size -= 2) { ctx.font = `400 ${size}px ${family}`; if (ctx.measureText(text).width <= width) break; }
  ctx.font = `400 ${size}px ${family}`; return size;
}
export function spaced(ctx, text, x, y, gap) { // letter-spaced text (canvas letterSpacing is not everywhere yet)
  for (const ch of text) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + gap; } return x;
}
export function spacedWidth(ctx, text, gap) { let w = 0; for (const ch of text) w += ctx.measureText(ch).width + gap; return w - gap; }

// ── the picture ──
async function render(ending, sizeKey) {
  const { w: W, h: H } = SIZES[sizeKey], story = sizeKey === 'story';
  const look = LOOK[ending.key] || LOOK.true;
  await fontsReady(ending.title + ending.kind);
  const [mi, photo] = await Promise.all([
    loadImage(asset(`img/stickers/${look.mi}.png`)),
    look.photo ? loadImage(asset('img/' + look.photo)).catch(() => null) : Promise.resolve(null)
  ]);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

  // ground
  ctx.fillStyle = C.night; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = .9; ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();

  // Layout. Square keeps everything ≥64px from the edges; stories keep text and Mi between y=250 and y=H-340.
  const L = story
    ? { pad: 84, top: 250, bottom: H - 340, title: 96, photo: [372, 476, 624, 600], slip: [84, 900, 600, 330], mi: [548, 1090, 470], invite: 40, inviteY: 1330 }
    : { pad: 72, top: 64, bottom: H - 64, title: 70, photo: [474, 214, 540, 392], slip: [72, 330, 540, 300], mi: [568, 548, 440], invite: 34, inviteY: 760 };

  // title — 『ミーを信じて』
  ctx.fillStyle = C.paper; ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${L.title}px ${KOWAI}`;
  const titleY = L.top + L.title + (story ? 60 : 36);
  spaced(ctx, '『ミーを信じて』', L.pad - L.title * .45, titleY, story ? 6 : 4);
  // 182 lab
  ctx.font = `600 ${story ? 32 : 28}px ${SANS}`; ctx.fillStyle = C.sage; ctx.textAlign = 'right';
  spacedRight(ctx, '182 lab', W - L.pad, story ? L.top + 40 : L.top + 34, 3);
  ctx.textAlign = 'left';

  // photo — dark, desaturated, taped down under the slip
  {
    const [px, py, pw, ph] = L.photo; const rot = story ? .035 : .04;
    ctx.save(); ctx.translate(px + pw / 2, py + ph / 2); ctx.rotate(rot);
    ctx.shadowColor = '#000c'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#0b1110'; ctx.fillRect(-pw / 2, -ph / 2, pw, ph); ctx.shadowColor = 'transparent';
    ctx.beginPath(); ctx.rect(-pw / 2, -ph / 2, pw, ph); ctx.clip();
    if (photo) {
      cover(ctx, soften(photo, look.crop), -pw / 2, -ph / 2, pw, ph);
      ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'hsl(0,0%,50%)'; ctx.globalAlpha = .78; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .55; ctx.fillStyle = C.night; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.globalAlpha = .16; ctx.fillStyle = C.mint; ctx.globalCompositeOperation = 'soft-light'; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    } else {
      // be3: no photo. A dark screen with faint scan lines.
      ctx.fillStyle = '#070b0a'; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.globalAlpha = .07; ctx.fillStyle = C.sage; for (let y = -ph / 2; y < ph / 2; y += 6) ctx.fillRect(-pw / 2, y, pw, 1);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .9; ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    ctx.restore();
    tape(ctx, px + pw * .62, py + 4, story ? 150 : 128, .07);
  }

  // slip — ending title, big, on torn paper
  {
    const [sx, sy, sw, sh] = L.slip; const good = isGood(ending.kind);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(-.022);
    ctx.shadowColor = '#000b'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 18;
    tornPath(ctx, sw, sh, 11); ctx.fillStyle = C.paper; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.save(); tornPath(ctx, sw, sh, 11); ctx.clip(); ctx.globalAlpha = 1; ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(0, 0, sw, sh); ctx.restore();
    const ip = story ? 44 : 40;
    // kind label (cut-out tag)
    ctx.font = `600 ${story ? 30 : 28}px ${MIN}`; const kw = spacedWidth(ctx, ending.kind, 6);
    ctx.save(); ctx.translate(ip, ip + 4); ctx.rotate(-.035);
    ctx.fillStyle = good ? C.mint : C.label; ctx.fillRect(-12, -4, kw + 24, (story ? 30 : 28) + 14);
    ctx.fillStyle = good ? '#0f1a17' : '#2a2416'; ctx.textBaseline = 'top'; spaced(ctx, ending.kind, 0, 4, 6);
    ctx.restore();
    // title
    ctx.fillStyle = '#1b201e'; ctx.textBaseline = 'alphabetic';
    const ts = fitFont(ctx, ending.title, KOWAI, story ? 112 : 100, 56, sw - ip * 2);
    const ty = ip + (story ? 64 : 58) + ts * 1.02;
    spaced(ctx, ending.title, ip, ty, ts * .05);
    // small line under the title
    ctx.font = `500 ${story ? 32 : 30}px ${MIN}`; ctx.fillStyle = '#4a514d';
    ctx.fillText('エンドにたどり着いた', ip + 2, Math.min(sh - ip + 4, ty + (story ? 70 : 62)));
    ctx.restore();
    tape(ctx, sx + 40, sy + 10, story ? 120 : 104, -.5);
  }

  // Mi, big, in front
  {
    const [mx, my, ms] = L.mi;
    ctx.save(); ctx.shadowColor = '#000a'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 20;
    ctx.drawImage(cleanSticker(mi), mx, my, ms, ms); ctx.restore();
  }

  // invitation
  {
    ctx.fillStyle = C.paper; ctx.font = `500 ${L.invite}px ${MIN}`; ctx.textBaseline = 'alphabetic';
    const lines = ['あなたもミーと一緒に、', '出口を探してみない？'];
    lines.forEach((t, i) => ctx.fillText(t, L.pad, L.inviteY + i * L.invite * 1.7));
    ctx.font = `500 ${story ? 30 : 28}px ${SANS}`; ctx.fillStyle = C.sage;
    const subY = L.inviteY + lines.length * L.invite * 1.7 + (story ? 30 : 18);
    ctx.fillText('スマホで遊べる3D脱出ゲーム', L.pad, subY);
    ctx.fillStyle = C.mint; ctx.fillRect(L.pad, subY + 22, 56, 3);
  }
  return cv;
}
function spacedRight(ctx, text, right, y, gap) { const al = ctx.textAlign; ctx.textAlign = 'left'; spaced(ctx, text, right - spacedWidth(ctx, text, gap), y, gap); ctx.textAlign = al; }

export const toBlob = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/png'));

// ── clipboard / download ──
export async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
  try {
    const t = h('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.append(t); t.select(); t.setSelectionRange(0, text.length); const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}
export function download(blob, name) {
  const u = URL.createObjectURL(blob); const a = h('a'); a.href = u; a.download = name; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
export const canShareFiles = file => { try { return !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch { return false; } };

export function xIntentURL(text) { return 'https://twitter.com/intent/tweet?' + new URLSearchParams({ text }).toString(); }

// ── sheet ──
export function openShare(input) {
  injectStyle();
  const ending = { key: String(input && input.key || 'true'), kind: String(input && input.kind || ''), title: String(input && input.title || '') };
  document.getElementById('share-sheet')?.remove();
  const prevFocus = document.activeElement;

  const sheet = h('div'); sheet.id = 'share-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '結果をシェアする');
  const inner = h('div', 'ss-in'); sheet.append(inner);
  const top = h('div', 'ss-top'); const close = h('button', 'ss-close', '閉じる'); close.type = 'button';
  top.append(h('h2', '', '結果をシェアする'), close); inner.append(top);

  const grid = h('div', 'ss-grid'); inner.append(grid);
  // preview
  const pv = h('div', 'ss-preview'); const pic = h('div', 'ss-pic'); const wait = h('span', 'ss-wait', '画像をつくっています…'); pic.append(wait);
  const img = h('img'); img.alt = `『ミーを信じて』${ending.kind}「${ending.title}」のシェア画像`; img.hidden = true; pic.append(img);
  const seg = h('div', 'ss-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '画像のサイズ');
  const segBtns = {};
  for (const [k, s] of Object.entries(SIZES)) { const b = h('button', '', s.label); b.append(h('small', '', k === 'story' ? '9:16' : '1:1')); b.title = `${s.w}×${s.h}`; b.type = 'button'; b.dataset.size = k; segBtns[k] = b; seg.append(b); }
  pv.append(pic, seg); grid.append(pv);

  // controls
  const side = h('div', 'ss-side');
  const tplLabel = h('span', 'ss-label', '投稿文は書き換えられます');
  const tplBox = h('div', 'ss-tpl'); tplBox.setAttribute('role', 'group'); tplBox.setAttribute('aria-label', '投稿文のテンプレート');
  const tplBtns = TEMPLATES.map((t, i) => { const b = h('button', '', t.label); b.type = 'button'; b.dataset.i = i; tplBox.append(b); return b; });
  const ta = h('textarea'); ta.setAttribute('aria-label', '投稿文'); ta.spellcheck = false;
  const acts = h('div', 'ss-acts');
  const bX = h('button', 'ss-x', 'Xでシェアする'), bIG = h('button', 'ss-ig', 'Instagramに画像を送る'), bCopy = h('button', '', '投稿文をコピーする'), bSave = h('button', '', '画像を保存する');
  bIG.classList.add('wide'); bCopy.classList.add('wide');
  for (const b of [bX, bSave, bIG, bCopy]) { b.type = 'button'; acts.append(b); } // X and 保存 side by side: the picture goes onto X by hand
  const msg = h('p', 'ss-msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
  side.append(tplLabel, tplBox, ta, acts, msg); grid.append(side);
  document.body.append(sheet);

  // state
  let size = 'square', tpl = 0, file = null, blobUrl = null, token = 0;
  const fileName = () => `mi-wo-shinjite_${ending.key}_${size}.png`;
  const say = (t, err) => { msg.textContent = t; msg.classList.toggle('err', !!err); };
  const setTpl = i => { tpl = i; ta.value = fill(TEMPLATES[i].text, ending); tplBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i))); };
  const imageOff = () => { bSave.disabled = true; wait.textContent = '画像をつくれませんでした。投稿文のコピーと X のシェアは使えます。'; wait.hidden = false; img.hidden = true; };

  async function build() {
    const my = ++token; file = null; bSave.disabled = true; wait.textContent = '画像をつくっています…'; wait.hidden = false;
    for (const [k, b] of Object.entries(segBtns)) b.setAttribute('aria-pressed', String(k === size));
    try {
      const cv = await render(ending, size); if (my !== token) return;
      sheet._canvas = cv; // for checking the output
      const blob = await toBlob(cv); if (my !== token) return;
      try { file = new File([blob], fileName(), { type: 'image/png' }); } catch { file = blob; file.name = fileName(); }
      if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = URL.createObjectURL(blob);
      img.src = blobUrl; img.hidden = false; wait.hidden = true; bSave.disabled = false;
    } catch (e) { if (my === token) imageOff(); }
  }

  const shut = () => { token++; if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 1000); document.removeEventListener('keydown', onKey, true); sheet.remove(); try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch {} };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); shut(); } };
  document.addEventListener('keydown', onKey, true);
  close.onclick = shut;
  for (const b of Object.values(segBtns)) b.onclick = () => { if (size !== b.dataset.size) { size = b.dataset.size; say(''); build(); } };
  tplBtns.forEach((b, i) => b.onclick = () => setTpl(i));

  bX.onclick = () => {
    const url = xIntentURL(ta.value.trim());
    const w = window.open(url, '_blank', 'noopener');
    if (w === undefined) location.href = url;
    say(bSave.disabled ? 'X の投稿画面を開きました。' : 'X の投稿画面を開きました。X には画像を自動で添付できません。画像は「画像を保存する」で保存してから、投稿画面で添付してください。');
  };
  bCopy.onclick = async () => { say(await copyText(ta.value) ? '投稿文をコピーしました。' : 'コピーできませんでした。投稿文を長押しして選んでください。', false); };
  bSave.onclick = async () => {
    if (!file) return;
    // Phones: the share sheet's 「画像を保存」 puts it in Photos. Elsewhere: a normal download.
    if (coarse() && canShareFiles(file)) {
      try { await navigator.share({ files: [file] }); say('共有メニューの「画像を保存」で写真に保存できます。'); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { download(file, fileName()); say('画像を保存しました。' + (coarse() ? '保存できないときは、上の画像を長押ししてください。' : '')); }
    catch { say('保存できませんでした。上の画像を長押し（右クリック）して保存してください。', true); }
  };
  bIG.onclick = async () => {
    const text = ta.value;
    if (file && canShareFiles(file)) {
      copyText(text); // Instagram usually drops shared text, so it is on the clipboard too (not awaited: share needs the tap)
      try { await navigator.share({ files: [file], text }); say('Instagram を選んで投稿してください。投稿文はコピー済みなので、キャプション欄に貼り付けられます。'); }
      catch (e) { if (e && e.name !== 'AbortError') fallbackIG(text); }
      return;
    }
    fallbackIG(text);
  };
  async function fallbackIG(text) {
    const copied = await copyText(text);
    let saved = false; if (file) { try { download(file, fileName()); saved = true; } catch {} }
    say(saved
      ? `画像を保存${copied ? 'し、投稿文をコピー' : ''}しました。Instagram アプリで保存した画像を選び、${copied ? '投稿文を貼り付けてください。' : '投稿文を書き添えてください。'}`
      : `${copied ? '投稿文をコピーしました。' : ''}画像は上の画像を長押し（右クリック）して保存し、Instagram アプリで選んでください。`);
  }

  setTpl(0); build(); setTimeout(() => close.focus({ preventScroll: true }), 0);
  return { close: shut, sheet };
}
