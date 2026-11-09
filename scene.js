import * as THREE from 'three';
import { createRenderer } from './renderer.js';
import { prop } from './props.js';
import { makeLighter, makeKey, makeRuler, makeMagnet, makeShard, makeCard, makeWaterBottle, systemFonts } from './items-models.js';

const V = values => new THREE.Vector3(...values);
export const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .88, ...options });

// Phones hold far less GPU memory than a desktop, and the room carries ~95 painted textures. On a touch device with a small
// screen, big textures go to the GPU at half size; the full-size canvas is kept for reading papers up close.
const LOWRES = (() => { try { return matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 820; } catch { return false; } })();
// Papers opened flat are drawn again at a higher scale when read (readScale), so a 2x zoom stays sharp. The sharp copy
// is painted on demand and only the last few are kept, so phones do not hold a large canvas for every sheet.
const readCache = [];
export function canvasTexture(width, height, paint, readScale = 1) {
  const draw = scale => {
    const c = document.createElement('canvas'); c.width = Math.round(width * scale); c.height = Math.round(height * scale);
    const ctx = systemFonts(c.getContext('2d')); if (scale !== 1) ctx.scale(scale, scale); paint(ctx, width, height); return c; // system fonts: see items-models.js
  };
  const canvas = draw(1);
  let src = canvas;
  if (LOWRES && width * height > 260000) { src = document.createElement('canvas'); src.width = width >> 1; src.height = height >> 1; src.getContext('2d').drawImage(canvas, 0, 0, src.width, src.height); }
  const texture = new THREE.CanvasTexture(src);
  if (readScale > 1) Object.defineProperty(texture.userData, 'full', { configurable: true, get() {
    let hit = readCache.find(e => e.texture === texture);
    if (!hit) { hit = { texture, canvas: draw(readScale) }; readCache.push(hit); if (readCache.length > 3) readCache.shift(); }
    return hit.canvas;
  } });
  else if (src !== canvas) texture.userData.full = canvas;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A wall calendar page: month title, weekday header, date grid, Sundays red, Saturdays blue, a few pencil marks.
export function calendarTexture(year, month, marks = {}) {
  return canvasTexture(512, 768, (ctx, w, h) => {
    ctx.fillStyle = '#e8e4d6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2f3a33'; ctx.fillRect(0, 0, w, 14);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = '#c9c4b2'; ctx.beginPath(); ctx.arc(60 + i * 65, 34, 7, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#2f3a33'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 64px "Noto Sans JP", sans-serif'; ctx.fillText(String(month), w / 2, 120);
    ctx.font = '500 22px "Noto Sans JP", sans-serif'; ctx.fillText(`${year}年${month}月`, w / 2, 172);
    const days = ['日', '月', '火', '水', '木', '金', '土']; const left = 28, top = 215, cw = (w - 56) / 7, rh = 70;
    days.forEach((d, i) => { ctx.fillStyle = i === 0 ? '#b32b2b' : i === 6 ? '#2a5fb3' : '#2f3a33'; ctx.font = '600 18px "Noto Sans JP", sans-serif'; ctx.fillText(d, left + cw * (i + .5), top); });
    ctx.strokeStyle = 'rgba(47,58,51,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, top + 18); ctx.lineTo(w - left, top + 18); ctx.stroke();
    const first = new Date(year, month - 1, 1).getDay(); const count = new Date(year, month, 0).getDate();
    for (let d = 1; d <= count; d++) {
      const idx = first + d - 1; const col = idx % 7, row = Math.floor(idx / 7);
      const x = left + cw * (col + .5), y = top + 50 + row * rh;
      ctx.fillStyle = col === 0 ? '#b32b2b' : col === 6 ? '#2a5fb3' : '#2f3a33'; ctx.font = '500 26px "Noto Sans JP", sans-serif'; ctx.fillText(String(d), x, y);
      if (marks[d]) { ctx.strokeStyle = 'rgba(60,70,160,.7)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(x, y, 20, 17, -.2, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(60,70,160,.8)'; ctx.font = '500 13px "Noto Sans JP", sans-serif'; ctx.fillText(marks[d], x, y + 26); }
    }
    ctx.fillStyle = '#5a6358'; ctx.font = '500 16px "Noto Sans JP", sans-serif'; ctx.fillText('汐見センター 施設管理課', w / 2, h - 30);
  });
}

export function label(lines, background = '#bfbba6', ink = '#303832', width = 768, height = 192) {
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.font = `500 ${Math.min(h / (lines.length * 1.85), w / Math.max(3, ...lines.map(line => line.length + 1)))}px sans-serif`;
    lines.forEach((line, index) => ctx.fillText(line, w / 2, h * (index + .5) / lines.length));
  });
}

// Line breaking for the painted papers: the same lines as adding one character at a time and starting a new line with the
// character that overflows, but the break is found by halving, so a line costs a few measurements instead of one per character
// (each of those measured the whole line so far: on a phone this was most of the time spent building the room).
function breakLines(text, tooWide) {
  const chars = [...text], out = []; let s = 0, forced = false;
  for (;;) {
    let lo = s + (forced ? 1 : 0), hi = chars.length; // the first index whose character makes the line too wide (chars.length: none)
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tooWide(chars.slice(s, mid + 1).join(''))) hi = mid; else lo = mid + 1; }
    if (lo >= chars.length) { out.push(chars.slice(s).join('')); return out; }
    out.push(chars.slice(s, lo).join('')); s = lo; forced = true;
  }
}

// A printed sheet: title, meta line, wrapped paragraphs, optional stamp and footer.
const MINCHO = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
const HAND = '"Yosugara","Klee","Klee One","Zen Kurenaido","Yu Kyokasho",cursive'; // 夜すがら手書きフォント（て！）。収録外の漢字は次のフォントで補う
export function paper({ kind = 'notice', band = '#b32b2b', hand = false, handCells = false, w = 768, h = 1024, bg = '#cfc9b2', ink = '#2f3a33', title = '', meta = '', to = '', body = [], table = null, closing = '', stamp = '', footer = '', titleSize = 38, bodySize = 24, align = 'left', important = false, tape = false, ring = true, heading = 'お知らせ', tag = '', highlight = [], contact = '', issued = '' } = {}) {
  return canvasTexture(w, h, (ctx) => {
    // Many fonts draw ○□■◇ much smaller than △▽◎☆. On a sheet where symbols are matched, they must look the same size:
    // each of those four is scaled to the size of ◎ in the same font, keeping its centre where the glyph would have been.
    const rawFill = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y, maxWidth) => {
      text = String(text);
      if (!/[○□■◇]/.test(text)) return maxWidth === undefined ? rawFill(text, x, y) : rawFill(text, x, y, maxWidth);
      const font = ctx.font, align = ctx.textAlign, base = ctx.textBaseline;
      const size = parseFloat((font.match(/([\d.]+)px/) || [])[1]) || 24;
      const box = ch => { const m = ctx.measureText(ch); return Math.max(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, m.actualBoundingBoxLeft + m.actualBoundingBoxRight); };
      const target = box('◎');
      const parts = [...text].map(ch => { const k = /[○□■◇]/.test(ch) ? Math.min(2.6, Math.max(1, target * .96 / Math.max(1, box(ch)))) : 1; ctx.font = k === 1 ? font : font.replace(/([\d.]+)px/, `${size * k}px`); const wd = ctx.measureText(ch).width; ctx.font = font; return { ch, k, wd }; });
      const total = parts.reduce((a, p) => a + p.wd, 0);
      let cx = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x;
      ctx.textAlign = 'left';
      for (const { ch, k, wd } of parts) {
        ctx.font = k === 1 ? font : font.replace(/([\d.]+)px/, `${size * k}px`);
        const dy = k === 1 || base === 'middle' ? 0 : size * (k - 1) * .38; // alphabetic baseline: keep the glyph's centre on the line
        rawFill(ch, cx, y + dy); cx += wd;
      }
      ctx.font = font; ctx.textAlign = align;
    };
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    let seed = 91; const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 1800; i++) { ctx.fillStyle = `rgba(80,70,40,${random() * .05})`; ctx.fillRect(random() * w, random() * h, 2, 2); }
    // Paper that has lived on a wall: slightly darker edges, a vertical fold, a lifted bottom corner.
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .45, w / 2, h / 2, Math.max(w, h) * .78); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(40,30,10,.13)'); ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);
    if (h > w * .9) { const fold = ctx.createLinearGradient(w * .5 - 18, 0, w * .5 + 18, 0); fold.addColorStop(0, 'rgba(0,0,0,0)'); fold.addColorStop(.45, 'rgba(0,0,0,.07)'); fold.addColorStop(.55, 'rgba(255,255,255,.08)'); fold.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = fold; ctx.fillRect(w * .5 - 18, 0, 36, h); }
    const curl = ctx.createLinearGradient(w - 70, h, w, h - 70); curl.addColorStop(0, 'rgba(0,0,0,0)'); curl.addColorStop(.7, 'rgba(0,0,0,.10)'); curl.addColorStop(1, 'rgba(255,255,255,.18)'); ctx.fillStyle = curl; ctx.beginPath(); ctx.moveTo(w - 70, h); ctx.lineTo(w, h - 70); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    if (ring) { ctx.strokeStyle = 'rgba(90,70,40,.08)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(w * .78, h * .86, 46, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(0, h * .5 - 2, w, 4);
    const margin = w * .085; const maxWidth = w - margin * 2;
    ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic';
    let y = margin + titleSize * .4;
    const sans = '"Noto Sans JP", sans-serif';
    const wrapLines = (text, size, width) => { ctx.font = `${size}px ${sans}`; return breakLines(text, t => ctx.measureText(t).width > width); };
    const drawStamp = (cx, cy, radius) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-.12);
      ctx.strokeStyle = 'rgba(170,40,40,.75)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(170,40,40,.8)'; ctx.font = `700 ${stamp.length > 2 ? radius * .5 : radius * .64}px "Noto Sans JP", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(stamp, 0, 0);
      ctx.restore();
    };
    const roundRect = (x, y, rw, rh, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + rw, y, x + rw, y + rh, r); ctx.arcTo(x + rw, y + rh, x, y + rh, r); ctx.arcTo(x, y + rh, x, y, r); ctx.arcTo(x, y, x + rw, y, r); ctx.closePath(); };
    if (kind === 'poster' || kind === 'announce') {
      // 公共施設の「お知らせ」: 上部に色帯＋白抜きの大見出し、帯の下に太字の件名、本文は左揃えで行間広め、
      // 強調行（highlight）は大きな太字で角丸枠、下部に発行部署・日付・問い合わせ先。文字・罫線・帯・枠だけで描く。
      const inset = 12, bandH = titleSize * 2.2;
      // double frame: thick outer, thin inner, both rounded
      ctx.strokeStyle = band; ctx.lineWidth = 5; roundRect(inset, inset, w - inset * 2, h - inset * 2, 14); ctx.stroke();
      ctx.lineWidth = 1.5; roundRect(inset + 9, inset + 9, w - inset * 2 - 18, h - inset * 2 - 18, 8); ctx.stroke();
      // band, clipped to the outer frame so its top corners are rounded too
      ctx.save(); roundRect(inset + 2, inset + 2, w - inset * 2 - 4, h - inset * 2 - 4, 12); ctx.clip(); ctx.fillStyle = band; ctx.fillRect(inset, inset, w - inset * 2, bandH); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(inset + 14, inset + bandH - 6, w - inset * 2 - 28, 2); // thin white rule inside the band
      const head = kind === 'poster' ? title : heading;
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let hs = titleSize * 1.2; ctx.font = `700 ${hs}px ${sans}`; while (hs > 20 && ctx.measureText(head).width > w - margin * 2.4 - (tag ? titleSize * 2.4 : 0)) { hs -= 1; ctx.font = `700 ${hs}px ${sans}`; }
      ctx.fillText(head, w / 2 + (tag ? titleSize * .9 : 0), inset + bandH / 2);
      if (tag) { // 「重要」「注意」: white box with the band colour inside, at the left of the band
        const tw = titleSize * 2.2, th = titleSize * 1.15, tx = inset + 18, ty = inset + bandH / 2 - th / 2;
        ctx.fillStyle = '#fff'; roundRect(tx, ty, tw, th, 5); ctx.fill();
        ctx.fillStyle = band; ctx.font = `700 ${titleSize * .72}px ${sans}`; ctx.fillText(tag, tx + tw / 2, ty + th / 2 + 1);
      }
      ctx.textBaseline = 'alphabetic';
      y = inset + bandH + bodySize * 1.6;
      if (kind === 'announce' && title) { // subject line under the band, bold, centred, with a double rule
        let ts = titleSize * .95; ctx.font = `700 ${ts}px ${sans}`; while (ts > 18 && ctx.measureText(title).width > maxWidth) { ts -= 1; ctx.font = `700 ${ts}px ${sans}`; }
        ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.fillText(title, w / 2, y + ts * .6); y += ts * 1.05;
        ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(w - margin, y); ctx.stroke(); ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(margin, y + 5); ctx.lineTo(w - margin, y + 5); ctx.stroke();
        y += bodySize * 1.6;
      }
      if (to) { ctx.fillStyle = ink; ctx.font = `${bodySize}px ${sans}`; ctx.textAlign = 'left'; ctx.fillText(to, margin, y); y += bodySize * 1.7; }
      // bottom row reserved for department / date / contact
      const footH = (meta || footer || contact) ? bodySize * 2.6 : bodySize;
      const bottom = h - inset - footH;
      // lay the body out at a scale that fits the sheet (shrink to 68 % at most)
      const layout = (scale, draw) => {
        let yy = y; const size = bodySize * scale;
        body.forEach((paragraph, index) => {
          if (paragraph === '') { yy += size * .8; return; }
          const hot = highlight.includes(index);
          if (hot) {
            const hsz = size * 1.5; ctx.font = `700 ${hsz}px ${sans}`;
            const lines = wrapLines(paragraph, hsz, maxWidth - size * 2); ctx.font = `700 ${hsz}px ${sans}`;
            const boxH = lines.length * hsz * 1.35 + size * .9, boxW = Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 2.4);
            if (draw) {
              ctx.strokeStyle = band; ctx.lineWidth = 3; roundRect(w / 2 - boxW / 2, yy, boxW, boxH, 10); ctx.stroke();
              ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              lines.forEach((l, i) => ctx.fillText(l, w / 2, yy + size * .45 + hsz * 1.35 * (i + .5)));
              ctx.textBaseline = 'alphabetic';
            }
            yy += boxH + size * .9; return;
          }
          const big = /^[①-⑳]/.test(paragraph) || (paragraph.length <= 14 && !/^[※・]/.test(paragraph));
          const note = /^[※]/.test(paragraph);
          const fs = big ? size * 1.2 : note ? size * .88 : size; const lines = wrapLines(paragraph, fs, maxWidth);
          ctx.font = `${big ? 700 : 400} ${fs}px ${sans}`;
          if (draw) { ctx.fillStyle = note ? 'rgba(47,58,51,.8)' : ink; ctx.textAlign = 'left'; lines.forEach(l => { ctx.fillText(l, margin, yy + fs); yy += fs * 1.75; }); } else yy += fs * 1.75 * lines.length;
          yy += fs * .5;
        });
        return yy;
      };
      let scale = 1; while (scale > .68 && layout(scale, false) > bottom - bodySize) scale -= .04;
      layout(scale, true);
      // footer row: a thin rule, then department / date at the left and the contact at the right
      ctx.strokeStyle = band; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(margin, bottom); ctx.lineTo(w - margin, bottom); ctx.stroke();
      ctx.fillStyle = ink; ctx.font = `${bodySize * .78}px ${sans}`; ctx.textAlign = 'left';
      if (meta) ctx.fillText(meta, margin, bottom + bodySize * 1.15);
      if (footer) ctx.fillText(footer, margin, bottom + bodySize * (meta ? 2.1 : 1.15));
      if (contact) { ctx.textAlign = 'right'; ctx.font = `700 ${bodySize * .8}px ${sans}`; ctx.fillText(contact, w - margin, bottom + bodySize * 1.15); }
      if (issued) { ctx.textAlign = 'right'; ctx.font = `${bodySize * .7}px ${sans}`; ctx.fillStyle = 'rgba(47,58,51,.75)'; ctx.fillText(issued, w - margin, bottom + bodySize * 2.1); ctx.fillStyle = ink; }
      if (closing) { ctx.textAlign = 'right'; ctx.font = `${bodySize * .9}px ${sans}`; ctx.fillText(closing, w - margin, bottom - bodySize * .6); }
      if (stamp) drawStamp(w - margin - 50, bottom - bodySize * 2.4, 46);
      if (tape) { ctx.fillStyle = 'rgba(255,255,240,.55)'; ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 6; for (const [tx, ty] of [[margin * .2, margin * .2], [w - margin * 1.3, margin * .2], [margin * .2, h - margin * .7], [w - margin * 1.3, h - margin * .7]]) { ctx.save(); ctx.translate(tx + 50, ty + 20); ctx.rotate((random() - .5) * .5); ctx.fillRect(-50, -18, 100, 36); ctx.restore(); } }
      return;
    }
    if (kind === 'tag') {
      // Shelf tag / item card: a boxed form with label and value columns.
      ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.strokeRect(margin * .6, margin * .6, w - margin * 1.2, h - margin * 1.2);
      const headH = titleSize * 1.6; ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(margin * .6, margin * .6, w - margin * 1.2, headH);
      ctx.fillStyle = ink; ctx.font = `700 ${titleSize}px ${sans}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(title, margin, margin * .6 + headH / 2);
      if (meta) { ctx.font = `${bodySize * .8}px ${sans}`; ctx.textAlign = 'right'; ctx.fillText(meta, w - margin, margin * .6 + headH / 2); }
      ctx.beginPath(); ctx.moveTo(margin * .6, margin * .6 + headH); ctx.lineTo(w - margin * .6, margin * .6 + headH); ctx.stroke();
      const rows = body.map(b => b.split('：')); const rowH = (h - margin * 1.2 - headH) / Math.max(rows.length, 1); const keyW = bodySize * 3.2;
      rows.forEach(([k, v], i) => {
        const ry = margin * .6 + headH + i * rowH;
        if (i) { ctx.beginPath(); ctx.moveTo(margin * .6, ry); ctx.lineTo(w - margin * .6, ry); ctx.stroke(); }
        ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(margin * .6, ry, keyW, rowH); ctx.fillStyle = ink;
        ctx.beginPath(); ctx.moveTo(margin * .6 + keyW, ry); ctx.lineTo(margin * .6 + keyW, ry + rowH); ctx.stroke();
        ctx.textAlign = 'center'; ctx.font = `700 ${bodySize * .9}px ${sans}`; ctx.fillText(k, margin * .6 + keyW / 2, ry + rowH / 2);
        ctx.textAlign = 'left'; ctx.font = `${bodySize}px ${sans}`; ctx.fillText(v || '', margin * .6 + keyW + bodySize * .5, ry + rowH / 2);
      });
      ctx.textBaseline = 'alphabetic';
      if (stamp) { ctx.save(); ctx.translate(w - margin - 40, h - margin - 40); ctx.rotate(-.12); ctx.strokeStyle = 'rgba(170,40,40,.75)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 36, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(170,40,40,.8)'; ctx.font = `700 24px ${sans}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(stamp, 0, 0); ctx.restore(); }
      return;
    }
    // Office notices: date and department at the top right, then "各位", then a centred bold title.
    if (meta) { ctx.font = `${bodySize * .85}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'right'; ctx.fillText(meta, w - margin, y); y += bodySize * 1.5; }
    if (important) { ctx.save(); ctx.strokeStyle = '#b32b2b'; ctx.lineWidth = 3; ctx.strokeRect(margin, margin * .3, titleSize * 1.9, titleSize * 1.1); ctx.fillStyle = '#b32b2b'; ctx.font = `700 ${titleSize * .7}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('重要', margin + titleSize * .95, margin * .3 + titleSize * .55); ctx.restore(); ctx.textBaseline = 'alphabetic'; }
    if (to) { ctx.font = `${bodySize}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'left'; ctx.fillText(to, margin, y); y += bodySize * 1.6; }
    y += titleSize * .9;
    ctx.textAlign = align === 'left' ? 'left' : 'center';
    const x0 = align === 'left' ? margin : w / 2;
    // Titles shrink to fit the sheet instead of running off the edge.
    const titleFont = kind === 'table' || kind === 'notice' ? MINCHO : sans;
    let ts = titleSize; ctx.font = `700 ${ts}px ${titleFont}`;
    while (ts > 18 && ctx.measureText(title).width > w - margin * 2) { ts -= 1; ctx.font = `700 ${ts}px ${titleFont}`; }
    ctx.fillText(title, x0, y);
    y += titleSize * .5;
    if (kind !== 'table') { ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(w - margin, y); ctx.stroke(); }
    y += bodySize * 2;
    ctx.font = hand ? `${bodySize * 1.08}px ${HAND}` : `${bodySize}px ${sans}`; ctx.textAlign = 'left';
    const lineHeight = bodySize * (hand ? 1.8 : 1.65);
    for (const paragraph of body) {
      if (paragraph === '') { y += lineHeight * .6; continue; }
      const lines = breakLines(paragraph, t => ctx.measureText(t).width > maxWidth); const line = lines.pop();
      for (const l of lines) { ctx.fillText(l, margin, y); y += lineHeight; }
      ctx.fillText(line, margin, y); y += lineHeight * 1.25;
      if (y > h - margin * 2) break;
    }
    if (table) {
      const cols = table[0].length; const cw = maxWidth / cols; const rh = bodySize * 1.9;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.font = `${bodySize * .9}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Header row and the first column are printed; what people wrote into the other cells is in pen, and 「済」 is a stamp.
      table.forEach((row, r) => {
        row.forEach((cell, c) => {
          ctx.strokeRect(margin + c * cw, y + r * rh, cw, rh);
          if (r === 0) { ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(margin + c * cw, y + r * rh, cw, rh); ctx.fillStyle = ink; }
          const cx = margin + c * cw + cw / 2, cy = y + r * rh + rh / 2;
          if (!cell) return;
          if (r > 0 && c > 0 && handCells) {
            if (cell === '済') { ctx.save(); ctx.translate(cx + (random() - .5) * 6, cy + (random() - .5) * 4); ctx.rotate((random() - .5) * .3); ctx.strokeStyle = 'rgba(178,44,44,.8)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, 0, rh * .36, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(178,44,44,.85)'; ctx.font = `700 ${bodySize * .85}px ${MINCHO}`; ctx.fillText('済', 0, 1); ctx.restore(); return; }
            ctx.save(); ctx.fillStyle = '#2c3a5c'; let fs = bodySize * 1.05; ctx.font = `${fs}px ${HAND}`;
            while (fs > 12 && ctx.measureText(cell).width > cw - 10) { fs -= 1; ctx.font = `${fs}px ${HAND}`; }
            ctx.translate(cx + (random() - .5) * 5, cy + (random() - .5) * 4); ctx.rotate((random() - .5) * .04); ctx.fillText(cell, 0, 1); ctx.restore(); return;
          }
          ctx.font = `${bodySize * .9}px "Noto Sans JP", sans-serif`; ctx.fillStyle = ink;
          ctx.fillText(cell, cx, cy);
        });
      });
      y += table.length * rh + lineHeight; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    }
    if (closing) { ctx.font = `${bodySize}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'right'; ctx.fillText(closing, w - margin, y + lineHeight * .4); ctx.textAlign = 'left'; }
    if (tape) { ctx.fillStyle = 'rgba(255,255,240,.55)'; ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 6; for (const [tx, ty] of [[margin * .2, margin * .2], [w - margin * 1.3, margin * .2], [margin * .2, h - margin * .7], [w - margin * 1.3, h - margin * .7]]) { ctx.save(); ctx.translate(tx + 50, ty + 20); ctx.rotate((random() - .5) * .5); ctx.fillRect(-50, -18, 100, 36); ctx.restore(); } }
    if (stamp) {
      ctx.save(); ctx.translate(w - margin - 60, h - margin - 70); ctx.rotate(-.12);
      ctx.strokeStyle = 'rgba(170,40,40,.75)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 54, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(170,40,40,.8)'; ctx.font = `700 ${stamp.length > 2 ? 26 : 34}px "Noto Sans JP", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(stamp, 0, 0);
      ctx.restore();
    }
    if (footer) { ctx.fillStyle = ink; ctx.font = `${bodySize * .8}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(footer, margin, h - margin * .8); }
  }, Math.min(2, Math.max(1, 1200 / w))); // read copy about 1200 px wide
}

// Seeded random: the same seed always paints the same stains, so a redraw never moves them.
const seeded = seed => () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
// Grayscale maps (bump / roughness) must not be colour-managed.
const dataTexture = (w, h, paint) => { const t = canvasTexture(w, h, paint); t.colorSpace = THREE.NoColorSpace; return t; };

// Painted plaster: fine grit, soft colour mottling at three scales, grime that gathers at the skirting, in the corners
// (left / right edge of the sheet = wall corner) and under the pipe run near the top. Nothing tiles, so no repeat shows.
function plaster(color, floor = false, seed = 37) {
  if (floor) return floorTiles(color);
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    const random = seeded(seed);
    // colour mottling: large soft blobs, warm and cool, very faint
    for (let i = 0; i < 46; i++) {
      const x = random() * w, y = random() * h, r = 120 + random() * 260, warm = random() > .5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, warm ? `rgba(226,214,180,${.03 + random() * .05})` : `rgba(40,54,58,${.03 + random() * .05})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (.6 + random() * .5), random() * 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 160; i++) { // medium roller marks
      const x = random() * w, y = random() * h, r = 20 + random() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${random() > .5 ? '235,228,205' : '20,28,26'},${.02 + random() * .04})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 30000; i++) { // grit
      ctx.fillStyle = `rgba(${random() > .5 ? '236,228,204' : '14,22,20'},${random() * .06})`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
    // grime: heavier low down, in both corners and in a band under the ceiling pipes, with a few drips
    const low = ctx.createLinearGradient(0, h * .55, 0, h); low.addColorStop(0, 'rgba(0,0,0,0)'); low.addColorStop(1, 'rgba(12,16,14,.22)'); ctx.fillStyle = low; ctx.fillRect(0, h * .55, w, h * .45);
    for (const [x0, x1] of [[0, w * .14], [w, w * .86]]) { const side = ctx.createLinearGradient(x0, 0, x1, 0); side.addColorStop(0, 'rgba(8,12,12,.26)'); side.addColorStop(1, 'rgba(8,12,12,0)'); ctx.fillStyle = side; ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), h); }
    const top = ctx.createLinearGradient(0, 0, 0, h * .12); top.addColorStop(0, 'rgba(30,26,18,.2)'); top.addColorStop(.5, 'rgba(30,26,18,.08)'); top.addColorStop(1, 'rgba(30,26,18,0)'); ctx.fillStyle = top; ctx.fillRect(0, 0, w, h * .12);
    for (let i = 0; i < 7; i++) { // rust-brown water runs from the pipe line
      let x = random() * w, y = h * .03; const len = 40 + random() * 220; ctx.strokeStyle = `rgba(80,58,34,${.08 + random() * .12})`; ctx.lineWidth = 2 + random() * 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (random() - .5) * 5; y += len / 8; ctx.lineTo(x, y); } ctx.stroke();
    }
    for (let i = 0; i < 9; i++) { // damp patches, mostly low
      const x = random() * w, y = h * .5 + random() * h * .5, r = 50 + random() * 150;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(30,32,20,${.06 + random() * .1})`); g.addColorStop(.7, `rgba(50,46,30,${.03 + random() * .04})`); g.addColorStop(1, 'rgba(30,32,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (.5 + random() * .6), random() * 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 26; i++) { const x = random() * w, y = h * .4 + random() * h * .6, rx = 20 + random() * 70, ry = 4 + random() * 12; const g = ctx.createRadialGradient(x, y, 0, x, y, rx); g.addColorStop(0, `rgba(14,18,14,${.03 + random() * .05})`); g.addColorStop(1, 'rgba(14,18,14,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, (random() - .5) * .5, 0, Math.PI * 2); ctx.fill(); } // grime wiped along by hands and bags: soft, no edges
    // hairline cracks near the top
    ctx.strokeStyle = 'rgba(20,24,20,.3)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) { let x = random() * w, y = random() * h * .3; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (random() - .5) * 60; y += random() * 40; ctx.lineTo(x, y); } ctx.stroke(); }
    // wainscot: the lower third a shade darker, a dado rail, chair scuffs, and the skirting shadow
    ctx.fillStyle = 'rgba(20,26,22,.14)'; ctx.fillRect(0, h * .62, w, h * .38);
    ctx.fillStyle = 'rgba(230,222,200,.2)'; ctx.fillRect(0, h * .62 - 6, w, 6); ctx.fillStyle = 'rgba(0,0,0,.26)'; ctx.fillRect(0, h * .62, w, 3);
    // (scuffs are not scattered here: they are laid as decals where chairs, trolleys and shoes actually meet the walls)
    const band = ctx.createLinearGradient(0, h * .9, 0, h); band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(1, 'rgba(0,0,0,.4)'); ctx.fillStyle = band; ctx.fillRect(0, h * .9, w, h * .1);
    ctx.fillStyle = 'rgba(16,20,18,.5)'; ctx.fillRect(0, h * .965, w, h * .035); // skirting board
    ctx.fillStyle = 'rgba(200,196,180,.12)'; ctx.fillRect(0, h * .965, w, 2);
  });
}
// Height for the plaster: grit plus a few shallow trowel ridges. Shared by every wall (one 512 texture).
function plasterBump() {
  return dataTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    const random = seeded(53);
    for (let i = 0; i < 14000; i++) { const v = 96 + Math.floor(random() * 64); ctx.fillStyle = `rgba(${v},${v},${v},${.3 + random() * .5})`; ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2); }
    for (let i = 0; i < 60; i++) { ctx.strokeStyle = `rgba(${random() > .5 ? 150 : 110},${random() > .5 ? 150 : 110},${random() > .5 ? 150 : 110},.25)`; ctx.lineWidth = 2 + random() * 6; const x = random() * w, y = random() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + (random() - .5) * 120, y + (random() - .5) * 120, x + (random() - .5) * 200, y + (random() - .5) * 80); ctx.stroke(); }
  });
}
// Vinyl composition tiles (塩ビタイル), about 33 cm square on the waiting-room floor (24 × 27 across its 8 × 9 m): the joints are
// hairlines a shade darker than the tiles, the tops flat with a soft waxed sheen; two tones laid at random, as municipal floors
// are; scuffs along the walking direction, a few chair-drag marks, the worn lane down the middle.
function floorTiles(color, cols = 24, rows = 27) {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const random = seeded(41); const TW = w / cols, TH = h / rows;
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const x = tx * TW, y = ty * TH, tint = (random() - .5) * 10, alt = random() < .18;
      ctx.fillStyle = `rgba(${tint > 0 ? '255,250,232' : '0,0,0'},${Math.abs(tint) / 160 + (alt ? .035 : 0)})`; ctx.fillRect(x, y, TW, TH);
      if (alt) { ctx.fillStyle = 'rgba(90,96,70,.05)'; ctx.fillRect(x, y, TW, TH); }
      for (let k = 0; k < 18; k++) { ctx.fillStyle = `rgba(${random() > .5 ? '238,234,214' : '40,44,36'},${.03 + random() * .05})`; ctx.fillRect(x + random() * TW, y + random() * TH, 2 + random() * 5, 1); } // the speckle cast into the tile
    }
    ctx.fillStyle = 'rgba(34,38,30,.32)'; // hairline joints
    for (let tx = 0; tx <= cols; tx++) ctx.fillRect(Math.round(tx * TW) - .5, 0, 1, h);
    for (let ty = 0; ty <= rows; ty++) ctx.fillRect(0, Math.round(ty * TH) - .5, w, 1);
    for (let i = 0; i < 14000; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '230,225,200' : '20,24,20'},${random() * .04})`; ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2); }
    for (let i = 0; i < 12; i++) { // damp patches and shoe dirt
      const x = random() * w, y = random() * h, r = 40 + random() * 160;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(30,32,20,${.05 + random() * .08})`); g.addColorStop(1, 'rgba(30,32,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (.5 + random() * .6), random() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 80; i++) { // heel scuffs along the walking direction (texture y = room depth)
      const x = random() * w, y = random() * h, len = 12 + random() * 70; ctx.strokeStyle = `rgba(${random() > .7 ? '220,215,190' : '14,16,12'},${.04 + random() * .1})`; ctx.lineWidth = .6 + random() * 1.4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + (random() - .5) * 10, y + len / 2, x + (random() - .5) * 14, y + len); ctx.stroke();
    }
    for (let i = 0; i < 5; i++) { // drag marks: two faint parallel scrapes (a chair's legs), short and soft-edged
      const x = random() * w, y = random() * h, a = random() * Math.PI, len = 40 + random() * 70, gap = 14 + random() * 8;
      for (const s of [-1, 1]) { const ox = Math.cos(a + Math.PI / 2) * gap / 2 * s, oy = Math.sin(a + Math.PI / 2) * gap / 2 * s; for (let k = 0; k < 3; k++) { ctx.strokeStyle = `rgba(14,18,14,${.02 + random() * .02})`; ctx.lineWidth = 3 + k * 2; ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len); ctx.stroke(); } }
    }
    const lane = ctx.createLinearGradient(0, 0, w, 0); lane.addColorStop(0, 'rgba(0,0,0,0)'); lane.addColorStop(.35, 'rgba(220,215,195,.05)'); lane.addColorStop(.65, 'rgba(220,215,195,.05)'); lane.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = lane; ctx.fillRect(0, 0, w, h);
  });
}
// Roughness for the tiles: the waxed tops keep a sheen, the joints and the worn lane are dull.
function floorRoughness(cols = 24, rows = 27) {
  return dataTexture(1024, 1024, (ctx, w, h) => {
    const random = seeded(67); const TW = w / cols, TH = h / rows;
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) { const v = 105 + Math.floor(random() * 40); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(tx * TW, ty * TH, TW + 1, TH + 1); }
    ctx.fillStyle = 'rgb(225,225,225)'; for (let tx = 0; tx <= cols; tx++) ctx.fillRect(Math.round(tx * TW) - 1, 0, 2, h); for (let ty = 0; ty <= rows; ty++) ctx.fillRect(0, Math.round(ty * TH) - 1, w, 2);
    for (let i = 0; i < 6000; i++) { const v = 100 + Math.floor(random() * 120); ctx.fillStyle = `rgba(${v},${v},${v},.35)`; ctx.fillRect(random() * w, random() * h, 2, 2); }
    const lane = ctx.createLinearGradient(0, 0, w, 0); lane.addColorStop(0, 'rgba(255,255,255,0)'); lane.addColorStop(.35, 'rgba(255,255,255,.3)'); lane.addColorStop(.65, 'rgba(255,255,255,.3)'); lane.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = lane; ctx.fillRect(0, 0, w, h);
  });
}
// Anti-slip safety flooring for the service passage: grey-green sheet with a dense cast-in grit (light and dark flecks), no
// tile joints, one welded seam; matte. A tiling 512 texture, repeated so the grit keeps its size on both floor boxes.
function antiSlipTexture() {
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#5d6862'; ctx.fillRect(0, 0, w, h); const r = seeded(211);
    for (let i = 0; i < 26000; i++) { const v = r(); ctx.fillStyle = v > .66 ? `rgba(214,220,206,${.12 + r() * .22})` : v > .33 ? `rgba(18,24,22,${.12 + r() * .2})` : `rgba(150,128,90,${.08 + r() * .12})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 1.6, 1 + r() * 1.6); }
    for (let i = 0; i < 10; i++) { const x = r() * w, y = r() * h, rr = 40 + r() * 120; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(24,28,22,${.05 + r() * .06})`); g.addColorStop(1, 'rgba(24,28,22,0)'); ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    ctx.fillStyle = 'rgba(30,36,32,.35)'; ctx.fillRect(w * .5 - 1, 0, 2, h); ctx.fillStyle = 'rgba(200,206,190,.12)'; ctx.fillRect(w * .5 + 1, 0, 1, h); // welded seam
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function antiSlipBump() {
  const t = dataTexture(512, 512, (ctx, w, h) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); const r = seeded(212); for (let i = 0; i < 22000; i++) { const v = 140 + Math.floor(r() * 90); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); } });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// Experience room: a light vinyl sheet floor (1.8 m rolls, faint seams), cleaner and glossier than the waiting room.
function vinylSheet() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#8e8c7f'; ctx.fillRect(0, 0, w, h); const r = seeded(223);
    for (let i = 0; i < 30000; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '236,232,214' : '60,62,52'},${r() * .05})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1); } // marbled fleck
    for (let i = 0; i < 20; i++) { const x = r() * w, y = r() * h, rr = 60 + r() * 200; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(${r() > .5 ? '240,236,220' : '70,70,58'},${.03 + r() * .04})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    ctx.fillStyle = 'rgba(60,62,54,.22)'; for (let x = w * .225; x < w; x += w * .225) ctx.fillRect(Math.round(x), 0, 1, h); // seams every 1.8 m
    ctx.lineCap = 'round'; for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, len = 14 + r() * 60; ctx.strokeStyle = `rgba(20,20,16,${.04 + r() * .08})`; ctx.lineWidth = .8 + r(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - .5) * 20, y + len); ctx.stroke(); } // black heel marks
  });
}
// Storage room floor: trowelled concrete, sealed once long ago; dust thicker at the edges.
function trowelConcrete() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6f716a'; ctx.fillRect(0, 0, w, h); const r = seeded(231);
    for (let i = 0; i < 30; i++) { const x = r() * w, y = r() * h, rr = 30 + r() * 110; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(${r() > .5 ? '200,198,186' : '30,30,26'},${.05 + r() * .07})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    for (let i = 0; i < 40; i++) { ctx.strokeStyle = `rgba(${r() > .5 ? '210,208,196' : '40,40,34'},${.04 + r() * .05})`; ctx.lineWidth = 6 + r() * 14; ctx.beginPath(); const x = r() * w, y = r() * h; ctx.arc(x, y, 30 + r() * 60, r() * 6, r() * 6 + 1.2); ctx.stroke(); } // trowel arcs
    for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '220,218,206' : '20,20,18'},${r() * .1})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    const edge = ctx.createRadialGradient(w / 2, h / 2, w * .2, w / 2, h / 2, w * .75); edge.addColorStop(0, 'rgba(150,146,130,0)'); edge.addColorStop(1, 'rgba(150,146,130,.3)'); ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h); // dust at the walls
  });
}
// Corrugated cardboard: fibre flecks, faint flute lines, crease lines where the box was folded, a scuffed edge.
function cardboardTexture(color = '#9a7f58') {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    const random = seeded(23);
    for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '230,200,150' : '60,40,20'},${random() * .09})`; ctx.fillRect(random() * w, random() * h, 1 + random() * 3, 1); }
    for (let y = 0; y < h; y += 6) { ctx.fillStyle = `rgba(0,0,0,${.02 + random() * .03})`; ctx.fillRect(0, y, w, 1); } // flutes showing through the liner
    for (let i = 0; i < 5; i++) { const y = random() * h; ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(0, y, w, 2); ctx.fillStyle = 'rgba(255,240,210,.14)'; ctx.fillRect(0, y + 2, w, 1); } // creases
    for (let i = 0; i < 12; i++) { ctx.fillStyle = `rgba(40,25,10,${.06 + random() * .1})`; ctx.fillRect(random() * w, random() * h, 20 + random() * 90, 2 + random() * 6); } // scuffs
    const edge = ctx.createLinearGradient(0, 0, 0, h); edge.addColorStop(0, 'rgba(0,0,0,.12)'); edge.addColorStop(.08, 'rgba(0,0,0,0)'); edge.addColorStop(.92, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,.18)'); ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  });
}
// Painted pipe: repeats along the run; rust blooms and dark grime sit near each flange (both ends of a repeat) and spread downward.
function pipeTexture(color, repeat = 4) {
  const tex = canvasTexture(128, 512, (ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    const random = seeded(29);
    for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '220,215,200' : '20,20,16'},${random() * .1})`; ctx.fillRect(random() * w, random() * h, 2, 1 + random() * 2); }
    for (const y of [0, h]) { const g = ctx.createLinearGradient(0, y - 60, 0, y + 60); g.addColorStop(0, 'rgba(90,50,20,0)'); g.addColorStop(.5, 'rgba(90,50,20,.45)'); g.addColorStop(1, 'rgba(90,50,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, y - 60, w, 120); }
    for (let i = 0; i < 14; i++) { const x = random() * w, y = random() * h, r = 6 + random() * 18; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(110,60,25,${.2 + random() * .3})`); g.addColorStop(1, 'rgba(110,60,25,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    // the underside of the pipe (one half of the circumference) collects grime
    const under = ctx.createLinearGradient(0, 0, w, 0); under.addColorStop(0, 'rgba(0,0,0,0)'); under.addColorStop(.4, 'rgba(0,0,0,.18)'); under.addColorStop(.75, 'rgba(0,0,0,.18)'); under.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = under; ctx.fillRect(0, 0, w, h);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, repeat);
  return tex;
}
// A soft dark disc for baked-in contact shadows under furniture and behind things on the wall. One texture, many planes.
function shadowDisc() {
  const t = canvasTexture(128, 128, (ctx, w, h) => { const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
  return t;
}
// A dried dark red-brown stain for the floor: blotchy edge, denser middle, a few spatter dots.
function stainDisc() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const r = seeded(97);
    for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2, d = r() * r() * 70, x = 128 + Math.cos(a) * d * 1.3, y = 128 + Math.sin(a) * d, rad = 24 + r() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(58,16,10,${.18 + r() * .22})`); g.addColorStop(.7, `rgba(70,24,14,${.06 + r() * .08})`); g.addColorStop(1, 'rgba(70,24,14,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (.7 + r() * .5), r() * 3, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 60; i++) { const a = r() * Math.PI * 2, d = 60 + r() * 60; ctx.fillStyle = `rgba(58,16,10,${.2 + r() * .4})`; ctx.beginPath(); ctx.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d * .8, 1 + r() * 3, 0, Math.PI * 2); ctx.fill(); }
    const core = ctx.createRadialGradient(128, 128, 0, 128, 128, 40); core.addColorStop(0, 'rgba(40,8,6,.45)'); core.addColorStop(1, 'rgba(40,8,6,0)'); ctx.fillStyle = core; ctx.fillRect(0, 0, w, h);
  });
}
// A thin drift of grey dust for a floor corner.
function dustPile() {
  return canvasTexture(128, 128, (ctx, w, h) => { const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(150,146,130,.5)'); g.addColorStop(.6, 'rgba(150,146,130,.2)'); g.addColorStop(1, 'rgba(150,146,130,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); const r = seeded(13); for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(180,176,160,${r() * .5})`; ctx.fillRect(20 + r() * 88, 20 + r() * 88, 1, 1); } });
}
// A soft dot for dust motes.
function dustSprite() {
  const t = canvasTexture(32, 32, (ctx, w, h) => { const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(.4, 'rgba(255,250,235,.5)'); g.addColorStop(1, 'rgba(255,250,235,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
  return t;
}
// Cork: grains of several sizes and tones, darker where paper used to hang, a few pin holes.
// Drink-can label: base colour, optional band, brand text in a made-up name, small print. 256 × 128, wrapped once round the can.
function canTexture({ base, band, bandColor, text, textColor = '#ffffff', star = false, small = '350ml' }) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    const r = seeded(43);
    for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '255,255,255' : '0,0,0'},${r() * .08})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
    if (band) { ctx.fillStyle = bandColor; ctx.fillRect(0, h * .34, w, h * .32); }
    if (star) { ctx.fillStyle = '#d4af37'; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rad = i % 2 ? 7 : 16; ctx.lineTo(w * .5 + Math.cos(a) * rad, h * .3 + Math.sin(a) * rad); } ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = textColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fs = 30; ctx.font = `700 ${fs}px "Noto Sans JP", sans-serif`; while (fs > 14 && ctx.measureText(text).width > w * .7) { fs -= 1; ctx.font = `700 ${fs}px "Noto Sans JP", sans-serif`; }
    ctx.fillText(text, w * .5, star ? h * .62 : h * .5);
    ctx.font = '11px sans-serif'; ctx.fillStyle = textColor; ctx.globalAlpha = .8; ctx.fillText(small, w * .5, h * .88); ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6); // dark rims where the label ends
    for (let i = 0; i < 26; i++) { ctx.fillStyle = `rgba(${r() > .4 ? '225,225,220' : '40,40,40'},${.15 + r() * .3})`; const x = r() * w, y = r() * h; ctx.fillRect(x, y, 6 + r() * 40, 1 + r() * 1.5); } // scuffed print
    ctx.fillStyle = 'rgba(200,200,195,.35)'; for (let i = 0; i < 5; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.ellipse(x, y, 4 + r() * 10, 2 + r() * 4, r() * 3, 0, Math.PI * 2); ctx.fill(); } // worn through to the metal
    const sheen = ctx.createLinearGradient(0, 0, w, 0); sheen.addColorStop(0, 'rgba(0,0,0,.18)'); sheen.addColorStop(.3, 'rgba(255,255,255,.12)'); sheen.addColorStop(.6, 'rgba(0,0,0,.05)'); sheen.addColorStop(1, 'rgba(0,0,0,.2)'); ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h);
  });
}
// Snack bag print: bright plastic film with a brand in a slightly wrong name.
function wrapperTexture({ base, accent, text, sub }) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent; ctx.fillRect(0, h * .32, w, h * .3);
    ctx.beginPath(); ctx.ellipse(w * .5, h * .78, 60, 28, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 34px "Noto Sans JP", sans-serif'; ctx.fillText(text, w / 2, h * .47);
    ctx.fillStyle = accent; ctx.font = '700 18px "Noto Sans JP", sans-serif'; ctx.fillText(sub, w / 2, h * .78);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 14, w, 14); // heat seals
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; for (const y0 of [14, h - 14]) { ctx.beginPath(); for (let x = 0; x <= w; x += 6) ctx.lineTo(x, y0 + (x / 6 % 2 ? 3 : -3)); ctx.stroke(); } // serrated seal edge
    for (let i = 0; i < 7; i++) { ctx.strokeStyle = `rgba(0,0,0,${.08 + i * .02})`; ctx.lineWidth = 1; ctx.beginPath(); const x = 20 + i * 34; ctx.moveTo(x, 14); ctx.lineTo(x + 10, h - 14); ctx.stroke(); } // creases
    const r = seeded(59); for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * .2})`; ctx.fillRect(r() * w, r() * h, 3, 1); } // creased film glints
  });
}
// Front page of an old local paper: fibrous grey-white stock with yellowed edges, masthead, vertical headline in real type,
// body columns as thin pseudo-glyph strokes, a halftone photograph. 1024 × 1400, used once.
function newspaperTexture() {
  return canvasTexture(1024, 1400, (ctx, w, h) => {
    const r = seeded(71);
    ctx.fillStyle = '#d8d4c6'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 24000; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '250,248,240' : '70,60,40'},${r() * .09})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 4, 1); } // fibres
    const yel = ctx.createRadialGradient(w / 2, h / 2, w * .35, w / 2, h / 2, w * .85); yel.addColorStop(0, 'rgba(0,0,0,0)'); yel.addColorStop(1, 'rgba(150,110,40,.3)'); ctx.fillStyle = yel; ctx.fillRect(0, 0, w, h);
    const MIN = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
    // pseudo text: vertical columns of short horizontal strokes
    const column = (x, top, bottom, cw = 18) => { ctx.fillStyle = 'rgba(30,28,24,.72)'; for (let y = top; y < bottom; y += 15) { if (r() < .06) { y += 10; continue; } const len = 5 + r() * (cw - 7); ctx.fillRect(x + (cw - len) / 2, y, len, 1.6); if (r() < .5) ctx.fillRect(x + 3 + r() * 6, y + 5, 2 + r() * 6, 1.4); if (r() < .4) ctx.fillRect(x + 2 + r() * 8, y + 9, 3 + r() * 5, 1.2); } };
    const block = (x0, x1, top, bottom) => { for (let x = x1 - 18; x >= x0; x -= 20) column(x, top, bottom); };
    const vtext = (text, x, y, size, weight = 700) => { ctx.font = `${weight} ${size}px ${MIN}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; let yy = y; for (const ch of text) { ctx.fillText(ch, x, yy); yy += size * 1.04; } return yy; };
    // masthead (top right, vertical, boxed) and date line
    ctx.fillStyle = '#1e1c18'; ctx.fillRect(w - 118, 40, 86, 330); ctx.fillStyle = '#d8d4c6'; vtext('汐見タイムズ', w - 75, 52, 46);
    ctx.fillStyle = '#1e1c18'; ctx.font = `20px ${MIN}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('2029年（令和11年）3月14日　朝刊　第18229号', 40, 70); ctx.fillText('汐見タイムズ社　汐見市中央1-2-3　☎ 0120-XXX-XXX', 40, 98);
    ctx.fillRect(40, 112, w - 170, 3); ctx.fillRect(40, 118, w - 170, 1);
    // headline block
    ctx.fillStyle = '#1e1c18';
    vtext('ＡＩ連携訓練で', w - 190, 140, 66); vtext('負傷事故', w - 275, 140, 66);
    vtext('汐見センターは月末閉館', w - 350, 150, 34, 500);
    ctx.fillRect(w - 390, 130, 2, 760);
    block(w - 780, w - 400, 140, 890);                             // lead story columns
    // photograph (halftone) with caption
    const pw = 440, ph = 300, pxx = 40, pyy = 140;
    const photo = document.createElement('canvas'); photo.width = 64; photo.height = 44; const pc = photo.getContext('2d');
    const sky = pc.createLinearGradient(0, 0, 0, 44); sky.addColorStop(0, '#9a9a9a'); sky.addColorStop(1, '#d8d8d8'); pc.fillStyle = sky; pc.fillRect(0, 0, 64, 44);
    pc.fillStyle = '#4a4a4a'; pc.fillRect(8, 14, 40, 24); pc.fillStyle = '#333'; pc.fillRect(48, 20, 12, 18); pc.fillStyle = '#6a6a6a'; for (let yy = 17; yy < 36; yy += 5) for (let xx = 11; xx < 46; xx += 5) pc.fillRect(xx, yy, 3, 3);
    pc.fillStyle = '#2a2a2a'; pc.fillRect(20, 30, 14, 8); pc.fillStyle = '#8a8a8a'; pc.fillRect(0, 38, 64, 6); pc.fillStyle = '#5a5a5a'; pc.fillRect(2, 36, 5, 2); pc.fillRect(56, 35, 4, 3);
    const data = pc.getImageData(0, 0, 64, 44).data; const cell = pw / 64;
    ctx.fillStyle = '#1e1c18';
    for (let gy = 0; gy < 44; gy++) for (let gx = 0; gx < 64; gx++) { const g = data[(gy * 64 + gx) * 4] / 255; const rad = (1 - g) * cell * .52; if (rad < .3) continue; ctx.beginPath(); ctx.arc(pxx + gx * cell + cell / 2, pyy + gy * (ph / 44) + ph / 88, rad, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#1e1c18'; ctx.lineWidth = 1.5; ctx.strokeRect(pxx, pyy, pw, ph);
    ctx.font = `16px ${MIN}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('閉館が決まった汐見センター北棟（汐見市、13日）', pxx, pyy + ph + 24);
    block(40, 480, pyy + ph + 44, 890);                                // text under the photo
    ctx.fillRect(40, 900, w - 80, 2);
    // second row: two smaller stories with real sub-headlines, pseudo text beside them
    vtext('館内カメラは４月に撤去へ', w - 80, 920, 30); block(w - 500, w - 100, 920, h - 60); ctx.fillRect(w - 520, 915, 2, h - 975);
    vtext('連絡通路は閉館後シャッター閉鎖', w - 560, 920, 28); block(40, w - 580, 920, h - 60);
    ctx.fillRect(40, h - 50, w - 80, 1); ctx.font = `14px ${MIN}`; ctx.textAlign = 'right'; ctx.fillText('汐見タイムズ　第1面', w - 40, h - 30);
    // a coffee ring and a fold shadow across the middle
    ctx.strokeStyle = 'rgba(110,80,40,.18)'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(300, 1080, 70, 0, Math.PI * 2); ctx.stroke();
    const fold = ctx.createLinearGradient(0, h * .5 - 14, 0, h * .5 + 14); fold.addColorStop(0, 'rgba(0,0,0,0)'); fold.addColorStop(.5, 'rgba(0,0,0,.12)'); fold.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = fold; ctx.fillRect(0, h * .5 - 14, w, 28);
  });
}
function paperBump() {
  return dataTexture(256, 256, (ctx, w, h) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); const r = seeded(83); for (let i = 0; i < 5000; i++) { const v = 100 + Math.floor(r() * 60); ctx.fillStyle = `rgba(${v},${v},${v},.6)`; ctx.fillRect(r() * w, r() * h, 1 + r() * 5, 1); } });
}
function corkTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8c6f4e'; ctx.fillRect(0, 0, w, h);
    const r = seeded(3);
    for (let i = 0; i < 2200; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '70,45,22' : '190,160,110'},${.08 + r() * .22})`; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 3 + r() * 7, 2 + r() * 4, r() * 3, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '60,40,20' : '210,180,130'},${r() * .35})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2); }
    for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(255,240,210,.07)'; ctx.fillRect(40 + r() * 300, 40 + r() * 300, 90 + r() * 100, 120 + r() * 120); } // faded rectangles: sun-bleached where notices used to be
    for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(30,18,8,.6)'; ctx.beginPath(); ctx.arc(r() * w, r() * h, 1.2, 0, Math.PI * 2); ctx.fill(); } // pin holes
    const vig = ctx.createRadialGradient(w / 2, h / 2, w * .3, w / 2, h / 2, w * .75); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.2)'); ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);
  });
}
function wood(color = '#7a6a4c') {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    let seed = 7; const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 70; i++) { ctx.strokeStyle = `rgba(40,28,14,${.08 + random() * .18})`; ctx.lineWidth = 1 + random() * 3; ctx.beginPath(); const y = random() * h; ctx.moveTo(0, y); for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x / 50 + i) * 4 + (random() - .5) * 3); ctx.stroke(); }
    for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(255,230,190,${random() * .05})`; ctx.fillRect(random() * w, random() * h, 2, 1); }
  });
}
function ceilingTiles() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4a534c'; ctx.fillRect(0, 0, w, h);
    let seed = 5; const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 5000; i++) { ctx.fillStyle = `rgba(0,0,0,${random() * .25})`; ctx.fillRect(random() * w, random() * h, 2, 2); }
    ctx.strokeStyle = '#2a312c'; ctx.lineWidth = 5;
    for (let i = 0; i <= w; i += 256) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    ctx.fillStyle = 'rgba(60,40,20,.35)'; ctx.beginPath(); ctx.ellipse(380, 120, 90, 60, .4, 0, Math.PI * 2); ctx.fill();
  });
}

export function planTexture() {
  return canvasTexture(768, 1024, (ctx, w, h) => {
    const JP = '"Noto Sans JP", sans-serif';
    ctx.fillStyle = '#f2f1ea'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f5a4a'; ctx.fillRect(0, 0, w, 86);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.font = `700 36px ${JP}`; ctx.fillText('避難経路図', 28, 56);
    ctx.font = '18px sans-serif'; ctx.fillText('EVACUATION ROUTE MAP', 230, 56);
    ctx.textAlign = 'right'; ctx.font = `20px ${JP}`; ctx.fillText('汐見センター 北棟 地下1階', w - 24, 56);

    // ── floor plan drawn to the room's real layout: 30 px per metre, north (−z) up, east (+x) right ──
    // Waiting room 8 × 8.5 m; service passage off the left (west) door runs 5 m north then turns west to the experience room;
    // the storage room off the right door is 1.7 m wide; the emergency stairs leave through the east wall. 2027 survey drawing,
    // with the 2029 changes added by hand in red.
    const S = 30, OX = 350, OZ = 345;                 // world (x, z) → plan (OX + x·S, OZ + (z + 3.6)·S)
    const px = x => OX + x * S, pz = z => OZ + (z + 3.6) * S;
    const X0 = 60, X1 = 710, Y0 = 130, Y1 = 650, YC = pz(4.9), YM = OZ;   // outer sheet, corridor wall at the room's south wall
    ctx.fillStyle = '#ffffff'; ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.fillStyle = '#e6e9e4'; ctx.fillRect(X0, YC, X1 - X0, Y1 - YC);                        // corridor floor
    ctx.fillStyle = '#eceeea'; ctx.fillRect(px(-2.62), pz(-8.5), 1.74 * S, 4.9 * S);         // service passage (north leg)
    ctx.fillRect(px(-4.5), pz(-8.5), (4.5 - 2.62 + 1.74) * S, 1.7 * S);                        // service passage (west leg)
    // stair hatch (east of the room)
    ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2; for (let x = px(4) + 18; x < px(4) + 2.8 * S; x += 16) { ctx.beginPath(); ctx.moveTo(x, pz(-1.5) + 8); ctx.lineTo(x, pz(.3) - 8); ctx.stroke(); }
    // walls
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 7; ctx.lineJoin = 'miter';
    ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    const wall = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    wall(X0, YC, X1, YC);                                        // corridor wall (south)
    wall(px(-4), YM, px(-4), YC); wall(px(4), YM, px(4), YC);    // waiting room west / east walls
    wall(X0, YM, px(-4), YM); wall(px(-4), YM, px(4), YM);       // north wall of the waiting room and of the plant room
    wall(px(4), YM, X1, YM);                                     // north wall of stairs / electrical
    wall(px(-2.62), YM, px(-2.62), pz(-6.8)); wall(px(-.88), YM, px(-.88), pz(-8.5));          // passage walls
    wall(px(-2.62), pz(-6.8), px(-4.5), pz(-6.8)); wall(px(-4.5), pz(-6.8), px(-4.5), pz(-8.5)); // the turn west
    wall(px(-4.5), pz(-8.5), px(4), pz(-8.5));                   // back wall of passage, storage block and stairs block
    wall(px(.92), YM, px(.92), pz(-5.6)); wall(px(2.58), YM, px(2.58), pz(-5.6));            // storage room (1.7 m)
    wall(px(-.88), pz(-5.6), px(4), pz(-5.6));                   // storage back wall, continued as a service bay
    wall(px(4), pz(-1.5), px(4) + 2.8 * S, pz(-1.5)); wall(px(4), pz(.3), px(4) + 2.8 * S, pz(.3)); wall(px(4) + 2.8 * S, pz(-1.5), px(4) + 2.8 * S, pz(.3)); // stairwell
    wall(px(4) + 1.2 * S, pz(.3), px(4) + 1.2 * S, YC);         // electrical room partition
    wall(X0, Y0, X0, YM); wall(px(-4.5), Y0, px(-4.5), pz(-8.5)); // experience room is the block north-west of the passage
    // 2027 drawing: a doorway from the storage room into the passage, bricked up in 2029 and crossed out by hand
    ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(px(.92), pz(-4.4) + 4); ctx.lineTo(px(.92), pz(-5.3) - 4); ctx.moveTo(px(-.88), pz(-4.4) + 4); ctx.lineTo(px(-.88), pz(-5.3) - 4); ctx.stroke();
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(px(-.88), pz(-4.4)); ctx.lineTo(px(.92), pz(-4.4)); ctx.moveTo(px(-.88), pz(-5.3)); ctx.lineTo(px(.92), pz(-5.3)); ctx.stroke(); // the short link corridor
    ctx.strokeStyle = '#d7263d'; ctx.lineWidth = 4; const cx = px(.02), cy = pz(-4.85);
    ctx.beginPath(); ctx.moveTo(cx - 16, cy - 16); ctx.lineTo(cx + 16, cy + 16); ctx.moveTo(cx + 16, cy - 16); ctx.lineTo(cx - 16, cy + 16); ctx.stroke();
    ctx.fillStyle = '#d7263d'; ctx.font = `700 13px ${JP}`; ctx.textAlign = 'left'; ctx.fillText('閉塞 2029.3', px(.92) + 6, cy + 5); ctx.restore();
    // door openings (gap + swing)
    ctx.lineWidth = 7; ctx.strokeStyle = '#2b2b2b';
    const door = (x, y, len, dir) => {
      ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 9; ctx.beginPath();
      if (dir === 'h') { ctx.moveTo(x, y); ctx.lineTo(x + len, y); } else { ctx.moveTo(x, y); ctx.lineTo(x, y + len); }
      ctx.stroke(); ctx.restore();
      ctx.save(); ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, len, 0, Math.PI / 2); ctx.stroke(); ctx.restore();
    };
    door(px(-1.75) - 22, YM, 44, 'h');     // 待機室 → 点検通路（左奥の扉、幅 1.4 m）
    door(px(1.75) - 22, YM, 44, 'h');      // 待機室 → 資材庫（右奥の扉）
    door(px(-4.5), pz(-8.2), 42, 'v');     // 点検通路 → 体験室（通路の突き当たりで左へ）
    door(px(4), pz(-1.3), 40, 'v');        // 待機室 → 非常階段（右の壁）
    door(px(-.03), YC, 29, 'h');           // 待機室の入口（防火扉）: south wall, x −0.03…0.93 m, as built
    door(px(-6.5), YC, 40, 'h');           // 機械室
    door(px(5.8), YC, 40, 'h');            // 電気室
    door(px(-6.8), Y0, 40, 'h');           // 体験室 → 外扉
    // room names
    ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.font = `22px ${JP}`;
    const name = (x, y, lines, size = 22) => { ctx.font = `${size}px ${JP}`; lines.forEach((l, i) => ctx.fillText(l, x, y + i * (size + 6))); };
    name(px(-7.4), pz(-8.9), ['避難誘導', '体験室']);
    name(px(-1.75), pz(-7.7), ['点', '検', '通', '路'], 15);
    name(px(1.75), pz(-3.95), ['資材庫'], 14);
    name(px(2.0), pz(-7.0), ['設備ピット'], 15);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(px(4) + 20, pz(-.9) - 14, 90, 30); ctx.fillStyle = '#222'; name(px(4) + 65, pz(-.9) + 8, ['非常階段'], 18);
    name(px(-6.5), pz(.8), ['機械室']);
    name(px(0), pz(1.4), ['防災待機室'], 20);
    name(px(6.5), pz(2.4), ['電気室'], 18);
    ctx.fillStyle = '#555'; name(px(1.0), YC + 32, ['連絡通路（駅方面）'], 16);
    // shutter at the corridor's west end
    ctx.fillStyle = '#9a9a9a'; for (let y = YC + 6; y < Y1 - 4; y += 8) ctx.fillRect(X0 + 6, y, 40, 3);
    ctx.fillStyle = '#d7263d'; ctx.font = `700 14px ${JP}`; ctx.textAlign = 'left'; ctx.fillText('シャッター閉鎖中', X0 + 54, YC + 22);
    ctx.fillStyle = '#555'; ctx.font = `16px ${JP}`; ctx.textAlign = 'right'; ctx.fillText('地上出口 →', X1 - 12, YC + 32);
    // emergency exits (green) & extinguishers (red), where they really are
    ctx.fillStyle = '#2e8f5a'; ctx.fillRect(px(-6.8) + 6, Y0 - 14, 28, 12); ctx.fillRect(px(-1.75) - 14, YM - 14, 28, 10); ctx.fillRect(px(4) + 4, pz(-1.3) + 2, 10, 28);
    ctx.fillStyle = '#b32b2b'; ctx.fillRect(px(3.2) - 6, pz(-3.3) - 6, 12, 12); ctx.fillRect(X0 + 6, YC + 6, 12, 12); ctx.fillRect(px(8.5) - 6, Y0 + 40, 12, 12);
    // the plan hangs on the north wall at x = 0: the reader stands just below it
    ctx.fillStyle = '#d7263d'; ctx.beginPath(); ctx.arc(px(0), pz(-2.6), 13, 0, Math.PI * 2); ctx.fill();
    ctx.font = `700 18px ${JP}`; ctx.textAlign = 'center'; ctx.fillText('現在地', px(0), pz(-2.6) + 34);
    // hand-written marks: the corridor shutter crossed out, the stairs noted as under inspection
    ctx.strokeStyle = '#d7263d'; ctx.lineWidth = 5;
    const cross = (x, y) => { ctx.beginPath(); ctx.moveTo(x - 10, y - 10); ctx.lineTo(x + 10, y + 10); ctx.moveTo(x + 10, y - 10); ctx.lineTo(x - 10, y + 10); ctx.stroke(); };
    cross(X0 + 26, YC + 26);
    ctx.save(); ctx.translate(px(4) + 65, pz(-.9) + 30); ctx.rotate(-.06); ctx.fillStyle = '#d7263d'; ctx.font = `700 13px ${JP}`; ctx.textAlign = 'center'; ctx.fillText('点検中 使用不可', 0, 0); ctx.restore();
    ctx.fillStyle = '#555'; ctx.font = `13px ${JP}`; ctx.textAlign = 'center'; ctx.fillText('職員用', px(-1.75), pz(-3.9));
    // legend
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.fillRect(60, 690, 650, 150); ctx.strokeRect(60, 690, 650, 150);
    ctx.fillStyle = '#222'; ctx.textAlign = 'left'; ctx.font = `700 20px ${JP}`; ctx.fillText('凡例', 80, 722);
    ctx.font = `18px ${JP}`;
    ctx.fillStyle = '#d7263d'; ctx.beginPath(); ctx.arc(95, 775, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillText('現在地', 155, 781);
    ctx.fillStyle = '#2e8f5a'; ctx.fillRect(330, 745, 36, 20); ctx.fillStyle = '#222'; ctx.fillText('非常口', 380, 761);
    ctx.fillStyle = '#b32b2b'; ctx.fillRect(330, 785, 20, 20); ctx.fillStyle = '#222'; ctx.fillText('消火器', 380, 801);
    ctx.fillText('内線 201（管理室）', 520, 761); ctx.fillText('内線 204（設備係）', 520, 801);
    // north arrow & footer
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(735, 150); ctx.lineTo(735, 112); ctx.lineTo(725, 127); ctx.moveTo(735, 112); ctx.lineTo(745, 127); ctx.stroke(); ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#333'; ctx.fillText('N', 735, 170);
    ctx.font = `16px ${JP}`; ctx.textAlign = 'left'; ctx.fillStyle = '#555'; ctx.fillText('火災・地震のときは、エレベーターを使わず最寄りの非常口へ避難してください。', 60, 885);
    ctx.fillText('汐見市 施設管理課　2027年4月改訂　図面番号 N-B1-03', 60, 915);
    ctx.textAlign = 'right'; ctx.fillStyle = '#999'; ctx.fillText('※ 連絡通路が閉鎖されている場合は非常階段を使用してください', w - 60, 960);
  });
}

export function createRoom(host, markerLayer, onInteract, onLook) {
  systemFonts.on = true; try { return buildRoomScene(host, markerLayer, onInteract, onLook); } finally { systemFonts.on = false; }
}
function buildRoomScene(host, markerLayer, onInteract, onLook) {
  const renderer = createRenderer(host);
  // Shadows are re-rendered only when something that casts them moves (doors, drawer, picked-up items), not every frame.
  if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
  let shadowsDirty = true;
  const scene = new THREE.Scene();
  if (renderer.isWebGLRenderer) { // a dim room reflection, so brushed metals and the bottle catch a little light from every side
    const pmrem = new THREE.PMREMGenerator(renderer);
    const equirect = canvasTexture(64, 32, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#9aa39a'); g.addColorStop(.35, '#3a423f'); g.addColorStop(.7, '#1b2321'); g.addColorStop(1, '#0a0d0c'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e6efe0'; ctx.fillRect(22, 2, 20, 4); ctx.fillStyle = '#c9b48a'; ctx.fillRect(4, 14, 6, 5); });
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(equirect).texture; scene.environmentIntensity = .32; pmrem.dispose();
  }
  scene.background = new THREE.Color('#0e1517');
  scene.fog = new THREE.FogExp2('#111c1d', .018);
  scene.userData.lampLevel = .12;
  const camera = new THREE.PerspectiveCamera(57, 1, .07, 45);
  const basePosition = V([0, 1.62, 2.6]);
  camera.position.copy(basePosition);
  const cameraGoal = basePosition.clone();
  const look = V([0, 1.58, -3.5]);
  const lookGoal = look.clone();
  const raycaster = new THREE.Raycaster();
  const clickable = [];
  const interactables = new Map();
  const hinges = new Map();
  const animations = [];
  let enabled = false;
  let lampOn = false;
  let yaw = 0;
  let pitch = 0;
  let focus = null;
  let width = 1;
  let height = 1;
  let dirty = true;
  let pointer = null;
  let drawerOpen = false;
  let zone = 'room';
  let held = [];
  let surfaces = {};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const wallBump = plasterBump();
  const wallMaterial = material('#ffffff', { map: plaster('#737c71'), bumpMap: wallBump, bumpScale: .005, roughness: .9 });
  const panelMaterial = material('#4a5b55', { metalness: .25, roughness: .6, bumpMap: wallBump, bumpScale: .002 }); // painted steel
  const darkMetal = material('#26332f', { metalness: .35, roughness: .7 });
  const edgeMaterial = material('#708074', { metalness: .4, roughness: .55 });
  const bareMetal = material('#8e978f', { metalness: .85, roughness: .32 });   // exposed steel: bolts, flanges, latches
  const rustMetal = material('#5a4636', { metalness: .55, roughness: .7 });    // old brackets
  const woodMaterial = material('#ffffff', { map: wood('#766b50'), roughness: .7 });
  const woodEdge = material('#5e5440', { roughness: .62 });                    // chamfered edges read darker
  const floorMaterial = material('#ffffff', { map: plaster('#8b8c76', true), roughnessMap: floorRoughness(), roughness: .72, metalness: 0 }); // waiting room: 塩ビタイル
  const discTexture = shadowDisc();
  const shadowMaterial = (opacity) => new THREE.MeshBasicMaterial({ map: discTexture, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  // Baked contact shadow: a soft dark ellipse laid on a surface. `up` is the surface normal axis ('y' floor, 'z' / 'x' walls).
  function contactShadow(size, position, { opacity = .5, up = 'y', flip = false, parent = scene } = {}) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), shadowMaterial(opacity));
    mesh.position.copy(V(position));
    if (up === 'y') mesh.rotation.x = -Math.PI / 2;
    else if (up === 'x') mesh.rotation.y = flip ? -Math.PI / 2 : Math.PI / 2;
    else if (flip) mesh.rotation.y = Math.PI;
    mesh.renderOrder = -10; mesh.userData.hitOnly = true;
    parent.add(mesh);
    return mesh;
  }
  // A sheet of paper that has been on the wall a while: the plane is bent so its lower corners lift, a backing plane gives it
  // thickness, a soft shadow sits behind it, and pins or tape hold it. The front mesh is what gets registered (ids unchanged).
  function paperSheet(texture, size, position, parent = scene, { curl = .008, pins = false, tape = false, shadow = true } = {}) {
    const [w, h] = size;
    const geometry = new THREE.PlaneGeometry(w, h, 6, 6);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (h / 2); pos.setZ(i, curl * x * x * (1 - y) * .5 + curl * .3 * (1 - y) * (1 - y) * .25); }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material('#ffffff', { map: texture, side: THREE.DoubleSide, roughness: .85 }));
    mesh.position.copy(V(position)); parent.add(mesh);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material('#b9b4a0', { roughness: .95, side: THREE.DoubleSide })); back.position.z = -.0012; mesh.add(back);
    if (shadow) { const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.25, h * 1.2), shadowMaterial(.42)); s.position.set(w * .02, -h * .03, -.0035); s.renderOrder = -10; s.userData.hitOnly = true; mesh.add(s); }
    if (pins) for (const [px, py] of [[-w * .42, h * .44], [w * .42, h * .44]]) {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(.008, .009, .008, 10), material(px < 0 ? '#c23b2e' : '#d9a52c', { roughness: .35 })); head.rotation.x = Math.PI / 2; head.position.set(px, py, .006); mesh.add(head);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(.0012, .0012, .01, 5), bareMetal); pin.rotation.x = Math.PI / 2; pin.position.set(px, py, .001); mesh.add(pin);
    }
    if (tape) for (const [px, py, rz] of [[-w * .4, h * .47, .3], [w * .4, h * .47, -.25], [-w * .4, -h * .47, -.2], [w * .4, -h * .47, .35]]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w * .14, h * .05), material('#eee9d6', { transparent: true, opacity: .62, roughness: .5, side: THREE.DoubleSide })); strip.position.set(px, py, .0025); strip.rotation.z = rz; mesh.add(strip);
    }
    return mesh;
  }

  function box(size, position, mat, parent = scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.copy(V(position));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  // A box with small rounded edges (radius r): an extruded rounded footprint (x, z) with a bevel top and bottom, so table tops,
  // seat pans, shelf boards and door frames catch a thin highlight along their edges. UVs on the top are in metres.
  function roundedBoxGeometry(w, h, d, r = .008) {
    r = Math.max(.0005, Math.min(r, w / 2 - .0005, h / 2 - .0005, d / 2 - .0005));
    const iw = w - 2 * r, id = d - 2 * r, c = Math.min(.002, iw / 4, id / 4);
    const sh = new THREE.Shape(); sh.moveTo(-iw / 2 + c, -id / 2); sh.lineTo(iw / 2 - c, -id / 2); sh.quadraticCurveTo(iw / 2, -id / 2, iw / 2, -id / 2 + c); sh.lineTo(iw / 2, id / 2 - c); sh.quadraticCurveTo(iw / 2, id / 2, iw / 2 - c, id / 2); sh.lineTo(-iw / 2 + c, id / 2); sh.quadraticCurveTo(-iw / 2, id / 2, -iw / 2, id / 2 - c); sh.lineTo(-iw / 2, -id / 2 + c); sh.quadraticCurveTo(-iw / 2, -id / 2, -iw / 2 + c, -id / 2);
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(.0001, h - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 3 });
    g.translate(0, 0, -(h - 2 * r) / 2); g.rotateX(-Math.PI / 2); g.computeVertexNormals();
    return g;
  }
  function rbox(size, position, mat, parent = scene, r = .008) {
    const mesh = new THREE.Mesh(roundedBoxGeometry(...size, r), mat);
    mesh.position.copy(V(position)); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function sheet(texture, size, position, parent = scene) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), material('#ffffff', { map: texture, side: THREE.DoubleSide }));
    mesh.position.copy(V(position));
    parent.add(mesh);
    return mesh;
  }
  function group(position, rotation = 0) {
    const item = new THREE.Group();
    item.position.copy(V(position));
    item.rotation.y = rotation;
    scene.add(item);
    return item;
  }
  function register(id, name, meshes, point, closePosition, closeTarget = point) {
    meshes.forEach(mesh => {
      mesh.userData.interaction = id;
      clickable.push(mesh);
    });
    const button = document.createElement('button');
    button.className = 'object-marker';
    button.setAttribute('aria-label', name);
    button.dataset.object = id;
    button.title = name;
    // Touch screens have no hover, so the name would never show: on a tap, show the name for 0.6 s, then examine.
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (id.startsWith('key-') || !matchMedia('(hover: none)').matches) { onInteract(id); return; }
      const item = interactables.get(id);
      if (item.namingUntil > performance.now()) return;
      item.namingUntil = performance.now() + 600; styleMarkers();
      setTimeout(() => { item.namingUntil = 0; styleMarkers(); onInteract(id); }, 600);
    });
    // The mouse resting on the (invisible) marker itself counts as resting on its object.
    button.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hoverId = id; styleMarkers(); } });
    button.addEventListener('pointerleave', () => { if (hoverId === id) { hoverId = null; styleMarkers(); } });
    const caption = document.createElement('span');
    caption.className = 'object-marker-label'; caption.textContent = name;
    caption.style.cssText = 'position:absolute;left:50%;top:100%;transform:translate(-50%,-2px);white-space:nowrap;font-size:14px;letter-spacing:.06em;color:#eef3e6;text-shadow:0 1px 3px #000c,0 0 8px #0008;pointer-events:none;display:none';
    button.append(caption);
    markerLayer.append(button);
    interactables.set(id, { name, point: V(point), position: V(closePosition), target: V(closeTarget), button, caption, meshes, screen: { x: 0, y: 0 } });
  }
  function proxy(id, size, position, parent = scene) {
    const mesh = box(size, position, material('#ffffff', { transparent: true, opacity: 0, depthWrite: false }), parent);
    mesh.userData.hitOnly = true; mesh.castShadow = mesh.receiveShadow = false; // invisible hit boxes must not throw shadows either
    mesh.userData.interaction = id;
    clickable.push(mesh);
    return mesh;
  }
  function cylinder(radius, length, position, mat, parent = scene, segments = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), mat);
    mesh.position.copy(V(position));
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const floor = box([8, .12, 8.5], [0, -.06, .65], floorMaterial); // stops under the back wall: the storage and the passage have floors of their own
  floor.renderOrder = -20;
  const ceiling = box([8, .13, 9], [0, 4, .4], material('#ffffff', { map: ceilingTiles() }));
  ceiling.renderOrder = -20;
  for (const [size, position] of [
    [[1.5, 3, .15], [-3.25, 1.5, -3.6]],
    [[2, 3, .15], [0, 1.5, -3.6]],
    [[1.5, 3, .15], [3.25, 1.5, -3.6]],
    [[8, 1, .15], [0, 3.5, -3.6]], // the band above the doors no longer overlaps the piers (same plane → flicker)
    [[.15, 4, 9], [-4, 2, .4]],
    [[.15, 4, 2.03], [4, 2, -2.585]],   // east wall up to the stairwell's own side walls (no slot of void beside them)
    [[.15, 4, 4.73], [4, 2, 2.635]],
    [[.15, 1.1, 1.9], [4, 3.45, -.65]],
    [[8, 4, .15], [0, 2, 4.9]]
  ]) {
    const wall = box(size, position, wallMaterial);
    wall.renderOrder = -18;
  }
  for (const x of [-3.94, 3.94]) box([.07, .19, 8.5], [x, .09, .5], darkMetal);
  box([8, .09, .07], [0, 3.48, -3.47], darkMetal);
  box([.06, .06, 8], [-3.85, 3.5, .4], darkMetal);
  box([1.8, .08, .3], [0, 3.75, -.8], darkMetal); for (const x of [-.7, .7]) cylinder(.008, .15, [x, 3.86, -.8], bareMetal, scene, 6);
  const ceilingTube = box([1.6, .035, .19], [0, 3.69, -.8], material('#c9c6a0', { emissive: '#a9b18d', emissiveIntensity: .05 }));
  // Pipes and conduit under the ceiling, an exit sign, an extinguisher, a clock: the room has a history.
  // Pipes: painted runs with flanged joints every ~2 m, exposed bolts on the flanges, hanger brackets off the ceiling.
  for (const [r, y, z, c] of [[.07, 3.78, -2.9, '#5a5f58'], [.045, 3.84, -2.7, '#6a5d4a'], [.03, 3.6, 4.6, '#4e544f']]) {
    const pipe = cylinder(r, 7.8, [0, y, z], material('#ffffff', { map: pipeTexture(c, 4), metalness: .25, roughness: .62 }), scene, 12); pipe.rotation.z = Math.PI / 2;
    for (let i = 0; i < 4; i++) { // flange pairs at each joint
      const x = -3.9 + 1.95 * (i + .5);
      for (const dx of [-.02, .02]) { const f = cylinder(r + .025, .03, [x + dx, y, z], bareMetal, scene, 14); f.rotation.z = Math.PI / 2; }
      for (let b = 0; b < 4; b++) { const a = b / 4 * Math.PI * 2 + .4; const bolt = cylinder(.006, .075, [x, y + Math.cos(a) * (r + .015), z + Math.sin(a) * (r + .015)], rustMetal, scene, 6); bolt.rotation.z = Math.PI / 2; }
    }
    for (const x of [-2.6, -.4, 1.8]) { // hanger: strap from the ceiling plus a clamp around the pipe
      cylinder(.012, 4 - y - r, [x, (4 + y + r) / 2 - .02, z], rustMetal, scene, 6);
      const clamp = cylinder(r + .012, .05, [x, y, z], rustMetal, scene, 12); clamp.rotation.z = Math.PI / 2;
    }
  }
  for (const x of [-2.6, -.4, 1.8]) { box([.08, .3, .5], [x, 3.85, -2.8], darkMetal); box([.14, .02, .56], [x, 3.98, -2.8], rustMetal); } // conduit boxes bolted to the slab
  // Exit sign: a fluorescent box with a lit face, a small green glow on the wall around it.
  const exitSign = box([.5, .17, .07], [-1.75, 3.25, -3.49], material('#2e8f5a', { emissive: '#3bd47f', emissiveIntensity: .9 }));
  const exitFaceTex = label(['非常口 →'], '#2e8f5a', '#eafff0', 512, 160);
  sheet(exitFaceTex, [.46, .13], [-1.75, 3.25, -3.452]).material.setValues({ emissive: '#ffffff', emissiveMap: exitFaceTex, emissiveIntensity: .7 });
  const exitGlow = new THREE.PointLight('#8fe6aa', 1.4, 2.2, 2); exitGlow.position.set(-1.75, 3.2, -3.2); scene.add(exitGlow);
  // Extinguisher: cylinder, neck, valve with a lever, a hose looped down the side, a pull pin ring, a pressure gauge.
  const extinguisher = cylinder(.085, .5, [3.2, .25, -3.3], material('#9a2a24', { metalness: .3, roughness: .4 }), scene, 14);
  const extTop = new THREE.Mesh(new THREE.SphereGeometry(.085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), material('#9a2a24', { metalness: .3, roughness: .4 })); extTop.position.set(3.2, .5, -3.3); scene.add(extTop);
  cylinder(.03, .12, [3.2, .58, -3.3], bareMetal, scene, 8); box([.12, .03, .05], [3.2, .64, -3.3], darkMetal); box([.1, .015, .035], [3.21, .665, -3.3], bareMetal); // valve + lever
  const extRing = new THREE.Mesh(new THREE.TorusGeometry(.02, .003, 6, 14), bareMetal); extRing.position.set(3.2, .65, -3.25); extRing.rotation.y = Math.PI / 2; scene.add(extRing); // safety pin ring
  const gauge = cylinder(.022, .012, [3.2, .62, -3.245], bareMetal, scene, 12); gauge.rotation.x = Math.PI / 2;
  sheet(label([''], '#e8e4d2', '#e8e4d2', 32, 32), [.034, .034], [3.2, .62, -3.238]); box([.002, .013, .001], [3.203, .624, -3.237], material('#1a1a1a')); // gauge face + needle
  const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V([3.21, .6, -3.3]), V([3.3, .58, -3.3]), V([3.31, .4, -3.28]), V([3.3, .2, -3.26]), V([3.27, .1, -3.24])]), 12, .011, 6, false), material('#1b1d1b', { roughness: .8 })); scene.add(hose);
  box([.025, .05, .025], [3.27, .08, -3.24], bareMetal); // nozzle
  cylinder(.03, .012, [3.2, .1, -3.3], material('#1b1d1b'), scene, 12); // hose clip collar
  box([.24, .3, .02], [3.2, .9, -3.52], material('#b32b2b')); sheet(label(['消火器'], '#b32b2b', '#fff', 256, 120), [.2, .09], [3.2, .9, -3.5]);
  contactShadow([.3, .3], [3.2, .003, -3.3], { opacity: .55 });
  const clockFace = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#e6e2d4'; ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3; for (let i = 0; i < 12; i++) { const a = i / 6 * Math.PI; ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100); ctx.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); ctx.stroke(); }
    for (let i = 0; i < 60; i++) if (i % 5) { const a = i / 30 * Math.PI; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * 106, 128 + Math.sin(a) * 106); ctx.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); ctx.stroke(); }
    const vig = ctx.createRadialGradient(128, 128, 90, 128, 128, 122); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.25)'); ctx.fillStyle = vig; ctx.fillRect(0, 0, 256, 256); // the face sits a little below the rim
  });
  // Wall clock: a deep rim, the face set back inside it, real hands standing off the dial, a glass disc in front.
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .045, 32), [darkMetal, material('#ffffff', { map: clockFace }), darkMetal]);
  clock.rotation.set(0, 0, Math.PI / 2); clock.position.set(3.89, 3.0, 1.6); scene.add(clock);
  { const rim = new THREE.Mesh(new THREE.TorusGeometry(.19, .012, 8, 36), material('#2a2f2b', { metalness: .5, roughness: .4 })); rim.rotation.y = Math.PI / 2; rim.position.set(3.866, 3.0, 1.6); scene.add(rim);
    const now = new Date(); const hourA = (now.getHours() % 12 + now.getMinutes() / 60) / 12 * Math.PI * 2, minuteA = now.getMinutes() / 60 * Math.PI * 2;
    const hand = (len, wdt, angle, mat, off) => { const m = box([.004, len, wdt], [3.866 - off, 3.0, 1.6], mat); m.geometry.translate(0, len / 2 - .02, 0); m.rotation.x = angle; return m; };
    hand(.1, .012, hourA, material('#1e1e1e'), .004); hand(.15, .008, minuteA, material('#1e1e1e'), .007); hand(.16, .003, minuteA + 2.1, material('#b32b2b'), .01);
    const cap = cylinder(.012, .008, [3.856, 3.0, 1.6], bareMetal, scene, 10); cap.rotation.z = Math.PI / 2;
    const glass = cylinder(.18, .004, [3.852, 3.0, 1.6], material('#dfe9ee', { transparent: true, opacity: .12, roughness: .08, metalness: .1 }), scene, 32); glass.rotation.z = Math.PI / 2; glass.castShadow = false;
    contactShadow([.5, .5], [3.905, 2.98, 1.6], { opacity: .4, up: 'x', flip: true }); }
  // Cork notice board on the right wall: cork of mixed grain, a chamfered wood frame, pins with metal shanks, A4 notices.
  const cork = corkTexture();
  box([.05, 1.15, 1.6], [3.9, 2.05, 1.6], material('#ffffff', { map: cork, roughness: .95, bumpMap: cork, bumpScale: .003 }));
  const frameWood = material('#3b2f22', { roughness: .6 });
  const frameLight = material('#5a4a38', { roughness: .55 }); // chamfer catches the light
  box([.03, 1.19, .03], [3.87, 2.05, .8], frameWood); box([.03, 1.19, .03], [3.87, 2.05, 2.4], frameWood);
  box([.03, .03, 1.64], [3.87, 2.63, 1.6], frameWood); box([.03, .03, 1.64], [3.87, 1.47, 1.6], frameWood);
  box([.008, 1.19, .008], [3.853, 2.05, .81], frameLight); box([.008, 1.19, .008], [3.853, 2.05, 2.39], frameLight);
  box([.008, .008, 1.64], [3.853, 2.62, 1.6], frameLight); box([.008, .008, 1.64], [3.853, 1.48, 1.6], frameLight);
  contactShadow([1.9, 1.45], [3.925, 2.0, 1.6], { opacity: .5, up: 'x', flip: true }); // the board's shadow on the wall
  for (const [y, z, c] of [[2.5, 1.0, '#2f8f4e'], [2.42, 2.25, '#2a5fb3'], [1.6, 1.3, '#e3b92b']]) { // spare pins in the cork
    const head = new THREE.Mesh(new THREE.CylinderGeometry(.008, .009, .008, 10), material(c, { roughness: .35 })); head.rotation.z = Math.PI / 2; head.position.set(3.868, y, z); scene.add(head);
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(.0012, .0012, .012, 5), bareMetal); shank.rotation.z = Math.PI / 2; shank.position.set(3.874, y, z); scene.add(shank);
  }
  const notices = [
    [1.2, 2.3, paper({ kind: 'table', w: 600, h: 848, bg: '#dcd7c4', title: '夜間巡回 記録表', meta: '汐見警備保障／施設管理課', handCells: true, titleSize: 34, bodySize: 20, tape: true, ring: false, align: 'center', body: ['北棟地下　毎週水曜 21:00　汐見警備保障', '※北口の自動ドアは仮設扉の施工待ち（半開きのまま）'], table: [['日付', '担当', '確認', '備考'], ['10/16', '田村', '済', '北口ドア半開き'], ['10/23', '田村', '済', '非常灯 点検'], ['10/30', '田村', '済', '番号錠 更新 10/31'], ['11/06', '', '', ''], ['11/13', '', '', '']] })],
    [1.62, 2.3, paper({ w: 600, h: 848, bg: '#e2ddc9', title: '夜間 停電時の手順', meta: '2028年6月　設備係', to: '巡回担当 各位', titleSize: 34, bodySize: 21, tape: true, ring: false, closing: '以上', body: ['停電を確認したら、次の順に対応すること。', '１　灯りの確保（非常灯を点灯）', '２　煙を逃がす（排煙装置を作動）', '３　錠の解除（解錠装置で防火扉を開放）', '４　管理室（内線201）へ報告', '５　来館者を待機室から連絡通路へ誘導', '※ 備品の持ち出し禁止。使用後は消灯のこと。'] })],
    [2.04, 2.3, paper({ kind: 'poster', band: '#b32b2b', tag: '重要', w: 600, h: 848, bg: '#f1ede0', title: '緊急連絡先', meta: '汐見市 施設管理課', contact: '問い合わせ：管理室', issued: '2028年6月', titleSize: 40, bodySize: 22, tape: true, ring: false, highlight: [0, 1, 3], body: ['管理室　内線 201', '設備係　内線 204', '警備会社（夜間）', '0120-XXX-XXX', '', 'まず管理室へ。つながらないときは警備会社へ。', '※ 北棟地下は圏外になりやすいので、壁の内線を使うこと。'] })],
    [1.62, 1.75, paper({ kind: 'announce', heading: 'お知らせ', band: '#243b6b', tag: '注意', w: 600, h: 440, bg: '#e0dbc8', title: '体験室 設備撤去作業の延期について', meta: '2030年9月25日　設備係', contact: '問い合わせ：設備係 内線 204', to: '関係者各位', titleSize: 28, bodySize: 19, tape: true, ring: false, body: ['撤去作業中に備品の一部が破損しました。再発注の予算が確保できないため、避難誘導体験室の映像装置・送風設備の撤去作業を延期します。日程は未定です。', '制御盤には触れないでください（手動復旧プレートは破損・仮保管中）。'] })]
  ];
  const noticeIds = [['notice-record', '巡回記録表'], ['notice-procedure', '停電時の手順'], ['notice-contacts', '緊急連絡先'], ['notice-delay', '撤去延期の通知']];
  notices.forEach(([z, y, tex], i) => {
    const ratio = tex.image.height / tex.image.width; const w = .3;
    const s = paperSheet(tex, [w, w * ratio], [3.865, y, z], scene, { pins: true, curl: .006 }); s.rotation.y = -Math.PI / 2; s.rotation.z = Math.sin(z * 9) * .025;
    const [id, name] = noticeIds[i]; register(id, name, [s], [3.86, y, z], [3.2, y, z], [3.87, y, z]);
  });

  const doorPlates = new Map();
  const decalLater = []; // decals asked for before the decal helper exists; laid once it does
  const phoneParts = [];   // the extension phone's meshes
  const OPTIONAL = new Set(['phone']), optionalOn = new Set(); // things to examine that stay hidden until the game turns them on
  // Documents that can be opened flat with 「紙を読む」. Everything else (door signs, the stair tag, the panel plate, the wall
  // writing, the waiting-room notice board) is read where it hangs, in its close-up.
  const PICK_LOW = new Set(['lobby-wait', 'bucket', 'boxes', 'storage-boxes']);
  const READABLE = new Set(['map', 'roomsign', 'note', 'pin', 'camera', 'poster', 'equipment', 'label', 'repair', 'newspaper', 'notice-record', 'notice-procedure', 'notice-contacts', 'notice-delay']); // door signs (storage, exit) are short enough to read in the close-up
  const EXIT_OPEN = -1.95; // the service door opens past square, clear of the wall, so its passage face (and sign) turns to the room
  function makeDoor(x, title, id) {
    const frame = group([x, 0, -3.48]);
    rbox([.1, 3.03, .18], [-.75, 1.5, 0], darkMetal, frame, .01);   // pressed-steel frame: thick, edges rounded so they catch a line of light
    rbox([.1, 3.03, .18], [.75, 1.5, 0], darkMetal, frame, .01);
    rbox([1.6, .1, .18], [0, 3.02, 0], darkMetal, frame, .01);
    // Frame reveal: a thin stop strip inside the frame, and the frame's shadow on the wall.
    for (const x of [-.7, .7]) box([.02, 2.96, .04], [x, 1.49, -.05], material('#1d2724', { metalness: .35, roughness: .6 }), frame);
    box([1.4, .02, .04], [0, 2.965, -.05], material('#1d2724', { metalness: .35, roughness: .6 }), frame);
    contactShadow([1.9, 3.3], [0, 1.5, -.045], { opacity: .45, up: 'z' }).renderOrder = -12;
    box([1.6, .02, .2], [0, .01, .02], bareMetal, frame); // threshold plate
    const hinge = new THREE.Group();
    hinge.position.set(-.7, 0, .04);
    frame.add(hinge);
    // Leaf: 3 mm narrower than the opening so a dark gap reads along both stiles; a raised inner panel; chamfer strips on the edges.
    box([1.37, 2.94, .085], [.7, 1.49, 0], panelMaterial, hinge);
    box([1.25, 2.8, .018], [.7, 1.49, .048], material('#52625b', { roughness: .55, metalness: .2 }), hinge);
    const chamfer = material('#5d6c65', { metalness: .3, roughness: .5 });
    for (const x of [.0225, 1.3775]) box([.012, 2.94, .012], [x, 1.49, .046], chamfer, hinge);   // vertical lit edges
    box([1.37, .012, .012], [.7, 2.955, .046], chamfer, hinge); box([1.37, .012, .012], [.7, .025, .046], chamfer, hinge);
    for (const x of [.0225, 1.3775]) box([.012, 2.94, .012], [x, 1.49, -.04], material('#1d2724'), hinge); // dark back edges
    sheet(label([title]), [.84, .2], [.7, 2.1, .061], hinge);
    // Lever handle: rose, spindle, lever with a rounded tip; latch bolt in the leaf edge, strike plate on the frame.
    box([.06, .32, .05], [1.23, 1.32, .08], darkMetal, hinge);                     // backplate
    const rose = cylinder(.03, .012, [1.23, 1.39, .11], bareMetal, hinge, 16); rose.rotation.x = Math.PI / 2;
    const spindle = cylinder(.012, .04, [1.23, 1.39, .13], bareMetal, hinge, 10); spindle.rotation.x = Math.PI / 2;
    box([.22, .03, .03], [1.13, 1.39, .15], material('#b8b99d', { metalness: .8, roughness: .35 }), hinge);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.017, 10, 8), material('#b8b99d', { metalness: .8, roughness: .35 })); tip.position.set(1.02, 1.39, .15); hinge.add(tip);
    box([.02, .07, .012], [1.392, 1.39, 0], bareMetal, hinge);                      // latch bolt showing in the edge gap
    box([.012, .16, .035], [.74, 1.39, -.03], bareMetal, frame);                    // strike plate on the frame
    // Butt hinges: three knuckles with a pin, on the hinge side.
    for (const y of [.3, 1.5, 2.7]) {
      const knuckle = cylinder(.013, .12, [.012, y, .045], bareMetal, hinge, 10);
      for (const dy of [-.045, .045]) { const pin = cylinder(.006, .012, [.012, y + dy + Math.sign(dy) * .018, .045], bareMetal, hinge, 8); pin.castShadow = false; }
      box([.03, .1, .004], [.03, y, .048], bareMetal, hinge); knuckle.castShadow = false;
    }
    if (id === 'storage') { // inside face: no handle, only a flat steel plate held by four screws; where the handle was, its ghost
      const steelPlateTex = canvasTexture(256, 400, (ctx, w, h) => { // brushed steel, shoe scuffs low down where people kicked it
        ctx.fillStyle = '#8a9490'; ctx.fillRect(0, 0, w, h); const r = seeded(611);
        for (let i = 0; i < 1400; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '220,226,222' : '40,46,44'},${r() * .12})`; ctx.fillRect(r() * w, r() * h, 6 + r() * 40, 1); }
        ctx.lineCap = 'round'; for (let i = 0; i < 14; i++) { const x = 20 + r() * (w - 40), y = h * (.72 + r() * .25), len = 10 + r() * 40, a = (r() - .5) * .8; ctx.strokeStyle = `rgba(16,16,14,${.25 + r() * .35})`; ctx.lineWidth = 2 + r() * 5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke(); }
        for (let i = 0; i < 5; i++) { const x = 30 + r() * (w - 60), y = h * (.8 + r() * .15), rr = 10 + r() * 14; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(30,30,26,.35)'); g.addColorStop(1, 'rgba(30,30,26,0)'); ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2); } // dull kick dents
      });
      box([.44, .7, .006], [.86, 1.3, -.046], material('#ffffff', { map: steelPlateTex, metalness: .6, roughness: .45 }), hinge);
      for (const [x, y] of [[.67, 1.0], [1.05, 1.0], [.67, 1.6], [1.05, 1.6]]) { const s = cylinder(.009, .004, [x, y, -.05], bareMetal, hinge, 8); s.rotation.x = Math.PI / 2; s.castShadow = false; }
      contactShadow([.54, .8], [.86, 1.27, -.0495], { opacity: .3, up: 'z', flip: true, parent: hinge });
      const plate = sheet(label(['内側取っ手　撤去作業にて取り外し（2030.9）', '復旧まで扉止めを使用のこと', '施設管理課'], '#d8d2bc', '#4a3a2a', 768, 200), [.3, .08], [.86, 1.56, -.051], hinge); plate.rotation.y = Math.PI;
      { const old = sheet(label(['取っ手故障　修理待ち（2029.3）'], '#cfc8b2', '#8d8370', 768, 110), [.24, .034], [.86, 1.497, -.0505], hinge); old.rotation.y = Math.PI; old.material.transparent = true; old.material.opacity = .6; } // the older, faded tag under it
      // the handle's ghost: paint missing where its backplate sat (a pale outline, rust bloom round the holes), the spindle hole, four screw holes
      const ghostTex = canvasTexture(96, 400, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(146,156,150,.85)'; ctx.fillRect(10, 14, w - 20, h - 28);
        ctx.strokeStyle = 'rgba(30,34,30,.55)'; ctx.lineWidth = 3; ctx.strokeRect(10, 14, w - 20, h - 28); // dirt line round where the plate was
        const r = seeded(613); for (const [x, y] of [[.28, .23], [.72, .23], [.28, .77], [.72, .77], [.5, .5]]) { const g = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, 26); g.addColorStop(0, 'rgba(120,64,30,.6)'); g.addColorStop(1, 'rgba(120,64,30,0)'); ctx.fillStyle = g; ctx.fillRect(w * x - 26, h * y - 26, 52, 52); }
        for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '210,214,208' : '60,60,54'},${r() * .2})`; ctx.fillRect(10 + r() * (w - 20), 14 + r() * (h - 28), 2 + r() * 6, 1); }
      });
      const ghost = new THREE.Mesh(new THREE.PlaneGeometry(.075, .36), material('#ffffff', { map: ghostTex, transparent: true, roughness: .55, metalness: .35, polygonOffset: true, polygonOffsetFactor: -2 })); ghost.position.set(1.23, 1.39, -.0432); ghost.rotation.y = Math.PI; hinge.add(ghost);
      { const spindle = cylinder(.012, .004, [1.23, 1.39, -.0445], material('#060707'), hinge, 14); spindle.rotation.x = Math.PI / 2; spindle.castShadow = false; }
      for (const [x, y] of [[1.205, 1.3], [1.255, 1.3], [1.205, 1.48], [1.255, 1.48]]) { const hole = cylinder(.0055, .004, [x, y, -.0445], material('#0b0d0c'), hinge, 8); hole.rotation.x = Math.PI / 2; hole.castShadow = false; } // screw holes where the handle was
      // the close-up stands square to this point: the notice and the ghost of the handle in one frame
      const anchor = new THREE.Object3D(); anchor.position.set(1.04, 1.42, -.05); anchor.rotation.y = Math.PI; hinge.add(anchor);
      doorPlates.set(id, plate); doorPlates.set('storage-anchor', anchor);
    }
    hinges.set(id, hinge);
    const hit = proxy(id, [1.45, 2.95, .16], [0, 1.5, .1], frame);
    register(id, title, [hit], [x, 1.65, -3.32], [x, 1.68, -1.48], [x, 1.65, -3.45]);
    return frame;
  }
  const service = makeDoor(-1.75, '点検通路', 'exit');
  { const oneWay = () => label(['一方通行', 'この扉は通路側からは開きません'], '#d8d2bc', '#7a2b1f', 640, 200);
    sheet(oneWay(), [.5, .16], [.7, 2.45, .061], hinges.get('exit'));                                    // room side, above the name
    const back = sheet(oneWay(), [.56, .18], [.7, 1.58, -.047], hinges.get('exit')); back.rotation.y = Math.PI; } // passage side, at eye level: seen in the doorway and again as it shuts
  makeDoor(1.75, '資材庫', 'storage');
  { const tag = sheet(label(['内側取っ手 撤去中（2030.9〜）', '入室時は扉止めを使用のこと', '施設管理課'], '#d8d2bc', '#7a2b1f', 768, 240), [.5, .16], [.7, 1.8, .061], hinges.get('storage')); tag.renderOrder = 1; interactables.get('storage').paper = tag; } // readable flat from the door, like the other notices

  // The passages exist as actual geometry behind the doors.
  // Service passage: 1.62 m wide, 5 m north, then a left turn into a short west leg (as on the evacuation map). Anti-slip sheet
  // floor (matte, gritty, one welded seam), painted block walls with a dark skirting, foot-level lamps and one dim corner lamp.
  const passWall = material('#ffffff', { map: plaster('#68746c', false, 61), bumpMap: wallBump, bumpScale: .004, roughness: .92 });
  const slipMap = antiSlipTexture(), slipBump = antiSlipBump();
  const antiSlipMat = (rx, ry) => { const m = slipMap.clone(), b = slipBump.clone(); m.repeat.set(rx, ry); b.repeat.set(rx, ry); m.needsUpdate = b.needsUpdate = true; return material('#ffffff', { map: m, bumpMap: b, bumpScale: .006, roughness: .92, metalness: 0 }); };
  const antiSlip = antiSlipMat(1, 2.86), antiSlipWest = antiSlipMat(1.49, .97);
  box([.12, 3.3, 3.42], [-2.62, 1.64, -5.25], passWall);                      // west wall, up to the turn
  box([.12, 3.3, 4.9], [-.88, 1.64, -6], passWall);                           // east wall, to the end
  { const f = box([1.75, .1, 4.95], [-1.75, -.05, -6.025], antiSlip); f.receiveShadow = true; } // starts inside the wall, not in the waiting room
  box([1.75, .1, 4.95], [-1.75, 3.24, -6.025], passWall);
  box([1.7, 3.3, .12], [-1.75, 1.6, -8.5], passWall);                         // end wall (the sign hangs here)
  { const f = box([2.6, .1, 1.7], [-3.2, -.05, -7.7], antiSlipWest); f.receiveShadow = true; } box([2.6, .1, 1.7], [-3.2, 3.24, -7.7], passWall);
  box([2.75, 3.3, .12], [-3.2, 1.6, -8.5], passWall); box([1.9, 3.3, .12], [-3.62, 1.6, -6.9], passWall); // the west leg's walls
  box([.12, 3.3, 1.7], [-4.5, 1.6, -7.7], passWall);
  for (const [sz, pos] of [[[.02, .1, 3.42], [-2.55, .05, -5.25]], [[.02, .1, 4.9], [-.95, .05, -6]], [[1.62, .1, .02], [-1.75, .05, -8.43]], [[1.9, .1, .02], [-3.62, .05, -6.97]], [[2.6, .1, .02], [-3.2, .05, -8.43]]]) box(sz, pos, material('#232a27', { roughness: .6 })); // skirting
  // Foot-level lamps (設備照明) on the west wall, and the dim lamp at the corner.
  const footLamp = (z, x = -2.555, face = 1) => { const b = rbox([.03, .1, .22], [x, .32, z], material('#30383a', { metalness: .4, roughness: .5 }), scene, .006); const lens = new THREE.Mesh(new THREE.PlaneGeometry(.18, .05), material('#e9f0e2', { emissive: '#e9f0e2', emissiveIntensity: .9 })); lens.position.set(x + face * .017, .31, z); lens.rotation.y = face * Math.PI / 2; scene.add(lens); return b; };
  footLamp(-4.4); footLamp(-6.2);
  const cornerLamp = rbox([.5, .05, .14], [-2.4, 3.17, -7.7], material('#9c9a88', { emissive: '#d9d4b4', emissiveIntensity: .35 }), scene, .01);
  const cornerLight = new THREE.PointLight('#efe4c2', 3.2, 6, 2); cornerLight.position.set(-2.4, 2.95, -7.7); scene.add(cornerLight);
  const passSign = sheet(label(['← 避難誘導体験室', '一方通行'], '#3e4c47', '#c9cdb8', 640, 200), [.9, .28], [-1.75, 2.1, -8.43]);
  // Light from the waiting room laid on the passage floor through the doorway: as wide as the gap the door leaves, fading
  // with distance. The door's own shadow does the rest; this keeps the strip legible on phones (no shadow there).
  const spillTex = canvasTexture(128, 512, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(232,236,214,.75)'); g.addColorStop(.5, 'rgba(232,236,214,.25)'); g.addColorStop(1, 'rgba(232,236,214,0)'); ctx.fillStyle = g; ctx.fillRect(6, 0, w - 12, h); const e = ctx.createLinearGradient(0, 0, w, 0); e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(.12, 'rgba(0,0,0,0)'); e.addColorStop(.88, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,1)'); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = e; ctx.fillRect(0, 0, w, h); });
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.8), new THREE.MeshBasicMaterial({ map: spillTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  spill.geometry.translate(0, -1.4, 0); spill.rotation.x = -Math.PI / 2; spill.position.set(-1.75, .004, -3.5); spill.renderOrder = -7; spill.userData.hitOnly = true; scene.add(spill);
  const updateSpill = () => { // the gap between the leaf's free edge and the strike jamb, along x
    const h = hinges.get('exit'); if (!h) return; const a = -h.rotation.y; const edge = -2.45 + 1.37 * Math.max(0, Math.cos(a)) * (a < Math.PI / 2 ? 1 : 0);
    const gap = Math.max(0, -1.05 - edge); spill.scale.x = Math.max(.001, gap); spill.position.x = -1.05 - gap / 2;
    spill.material.opacity = lampOn && gap > .01 ? Math.min(1, gap / .3) * .9 : 0; };
  // Storage room: a shallow dead end with shelves.
  box([1.7, 3, .14], [1.75, 1.5, -5.4], material('#ffffff', { map: plaster('#4a534c') }));
  for (const y of [.35, .85, 1.35]) { rbox([1.5, .035, .5], [1.75, y, -5.1], darkMetal, scene, .008); box([1.5, .04, .012], [1.75, y - .03, -4.854], darkMetal); contactShadow([1.4, .45], [1.75, y - .035, -5.1], { opacity: .55 }).rotation.x = Math.PI / 2; } // lower shelf unit that hides the back wall: board, lip, the dark under each
  for (const [x, y, w] of [[1.3, .55, .5], [1.95, .55, .6], [1.45, 1.05, .7], [2.1, 1.05, .4], [1.6, 1.55, .8]]) box([w, .36, .42], [x, y, -5.1], material(['#5a5244', '#6a604a', '#4e5648'][Math.round(y * 3) % 3]));
  for (const x of [.92, 2.58]) box([.12, 3, 1.95], [x, 1.5, -4.575], panelMaterial); // side walls start inside the 15 cm partition, so nothing pokes into the waiting room
  box([1.7, .1, 2.3], [1.75, -.06, -4.5], material('#ffffff', { map: trowelConcrete(), roughness: .96 })); // storage: bare trowelled concrete
  box([1.7, .1, 2.05], [1.75, 3.0, -4.575], material('#2b3431'));
  const shelfGroup = group([1.75, 0, 0]);
  for (const y of [.5, 1.1, 1.7]) { rbox([1.35, .03, .4], [0, y, -5.12], darkMetal, shelfGroup, .008); box([1.35, .045, .012], [0, y - .03, -4.915], darkMetal, shelfGroup); contactShadow([1.2, .36], [0, y + .017, -5.12], { opacity: .45, parent: shelfGroup }); }
  for (const [x, y, s, c] of [[-.3, .53, 1.1, '#6c6651'], [.3, .53, .8, '#5a6050'], [.25, 1.13, .9, '#6a604a'], [-.35, 1.73, .7, '#7a7360'], [.3, 1.73, .55, '#5d5a4a']]) {
    const crate = prop('box', { color: c }); crate.scale.setScalar(s * .32); crate.position.set(x, y, -5.1); crate.rotation.y = (x + y) * .4; shelfGroup.add(crate);
  }
  // Tins on the middle shelf (非常食の缶詰), a lone sneaker on the floor, a dead tube and a vent in the ceiling.
  const tinMat = material('#9aa29c', { metalness: .75, roughness: .35 }); const tinLabel = material('#c9b98a', { roughness: .7 });
  const cans = [];
  for (const [x, z, tipped] of [[-.22, .1, false], [-.13, .13, false], [-.17, .0, false], [-.05, .12, true]]) {
    const can = cylinder(.038, .1, [x, tipped ? 1.17 : 1.18, -5.12 + z], tinMat, shelfGroup, 14);
    if (tipped) { can.rotation.z = Math.PI / 2; can.position.y = 1.168; }
    const band = cylinder(.0385, .06, [0, 0, 0], tinLabel, can, 14); band.castShadow = false;
    cans.push(can);
  }
  // A single canvas sneaker (23 cm), lying on its side: extruded rubber sole with a tread, canvas upper with mud and a
  // red-brown stain, collar, tongue, zig-zag laces still tied, a crushed heel. Length runs along local X, toe at +X.
  const sneaker = new THREE.Group(); scene.add(sneaker);
  {
    const canvasTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#d6d2c4'; ctx.fillRect(0, 0, w, h);
      const r = seeded(31);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '255,255,250' : '90,80,60'},${r() * .12})`; ctx.fillRect(r() * w, r() * h, 2, 1); } // weave
      for (let y = 0; y < h; y += 3) { ctx.fillStyle = 'rgba(0,0,0,.04)'; ctx.fillRect(0, y, w, 1); }
      const mud = ctx.createLinearGradient(0, h, 0, h * .45); mud.addColorStop(0, 'rgba(70,55,35,.55)'); mud.addColorStop(1, 'rgba(70,55,35,0)'); ctx.fillStyle = mud; ctx.fillRect(0, 0, w, h); // mud up from the sole
      for (let i = 0; i < 18; i++) { const x = r() * w, y = h * .3 + r() * h * .7, rad = 8 + r() * 26; const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(80,60,35,${.2 + r() * .3})`); g.addColorStop(1, 'rgba(80,60,35,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      for (let i = 0; i < 7; i++) { const x = w * .55 + r() * 80, y = h * .35 + r() * 90, rad = 10 + r() * 22; const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(96,28,18,${.3 + r() * .3})`); g.addColorStop(.7, 'rgba(96,28,18,.12)'); g.addColorStop(1, 'rgba(96,28,18,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rad, rad * .7, r() * 3, 0, Math.PI * 2); ctx.fill(); } // dried red-brown
    });
    const soleTex = canvasTexture(64, 64, (ctx, w, h) => { ctx.fillStyle = '#c4c0b2'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = 'rgba(40,36,30,.5)'; ctx.fillRect(0, 10, w, 7); ctx.fillRect(0, 42, w, 7); const r = seeded(19); for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(60,50,35,${r() * .25})`; ctx.fillRect(r() * w, r() * h, 2, 2); } });
    soleTex.wrapS = soleTex.wrapT = THREE.RepeatWrapping; soleTex.repeat.set(24, 24);
    const canvasMat = material('#ffffff', { map: canvasTex, roughness: .95 });
    const rubber = material('#ffffff', { map: soleTex, roughness: .85 });
    // sole outline (x = length, y = width), heel rounded, waist a touch narrower, toe rounded
    const outline = new THREE.Shape();
    outline.moveTo(-.115, 0);
    outline.bezierCurveTo(-.115, .034, -.09, .04, -.07, .038);
    outline.bezierCurveTo(-.03, .034, .02, .04, .07, .042);
    outline.bezierCurveTo(.1, .042, .115, .02, .115, 0);
    outline.bezierCurveTo(.115, -.02, .1, -.042, .07, -.042);
    outline.bezierCurveTo(.02, -.04, -.03, -.034, -.07, -.038);
    outline.bezierCurveTo(-.09, -.04, -.115, -.034, -.115, 0);
    const soleGeo = new THREE.ExtrudeGeometry(outline, { depth: .025, bevelEnabled: true, bevelThickness: .003, bevelSize: .003, bevelSegments: 2, curveSegments: 10 });
    { const a = soleGeo.attributes.position; for (let i = 0; i < a.count; i++) { const x = a.getX(i); const lift = Math.max(0, (Math.abs(x) - .06) / .055); a.setZ(i, a.getZ(i) + lift * lift * (x > 0 ? .014 : .008)); } soleGeo.computeVertexNormals(); } // toe spring and heel lift
    const sole = new THREE.Mesh(soleGeo, rubber); sole.rotation.x = -Math.PI / 2; sole.castShadow = true; sneaker.add(sole);
    const ellipsoid = (sx, sy, sz, x, y, z, mat = canvasMat) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; sneaker.add(m); return m; };
    ellipsoid(.1, .038, .041, .015, .03, 0);                                   // vamp and toe box
    const heel = ellipsoid(.055, .034, .04, -.068, .034, 0); heel.rotation.z = .18;   // heel counter, crushed down and leaning in
    ellipsoid(.05, .028, .036, -.03, .048, 0);                                 // instep rising to the collar
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.03, .009, 8, 20), canvasMat); collar.scale.set(1.25, 1, .95); collar.rotation.x = Math.PI / 2; collar.rotation.y = -.15; collar.position.set(-.05, .062, 0); sneaker.add(collar);
    const tongue = box([.06, .005, .034], [-.012, .07, 0], canvasMat, sneaker); tongue.rotation.z = -.32;
    for (const z of [-.0405, .0405]) box([.11, .008, .002], [.0, .024, z], material('#e4e1d6', { roughness: .7 }), sneaker); // side stripe (scuffed white)
    box([.024, .024, .062], [-.1, .04, 0], material('#bdb9ab', { roughness: .8 }), sneaker); // heel tab
    const lacePoints = []; for (let i = 0; i < 5; i++) { const x = .038 - i * .017; lacePoints.push(V([x, .064 + i * .003, (i % 2 ? -.019 : .019)])); } lacePoints.push(V([-.045, .08, -.006]));
    const lace = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lacePoints), 24, .0022, 6, false), material('#e8e4d8', { roughness: .8 })); sneaker.add(lace);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(.006, 8, 6), material('#e8e4d8', { roughness: .8 })); knot.position.set(-.045, .082, 0); sneaker.add(knot);
    for (const sz of [-1, 1]) { const loop = new THREE.Mesh(new THREE.TorusGeometry(.009, .002, 6, 12), material('#e8e4d8', { roughness: .8 })); loop.position.set(-.045, .084, sz * .012); loop.rotation.y = sz * .6; sneaker.add(loop); }
    for (const sz of [-1, 1]) { const end = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V([-.045, .08, sz * .006]), V([-.06, .07, sz * .03]), V([-.075, .05, sz * .045])]), 8, .002, 5, false), material('#e8e4d8', { roughness: .8 })); sneaker.add(end); }
    const soleStain = new THREE.Mesh(new THREE.PlaneGeometry(.07, .05), new THREE.MeshBasicMaterial({ map: stainDisc(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); soleStain.rotation.x = Math.PI / 2; soleStain.position.set(-.035, -.0005, 0); sneaker.add(soleStain); // dried stain on the sole
    sneaker.rotation.set(1.3, .9, 0, 'YXZ'); // rolled onto its outer side, heel toward the shelves
    sneaker.position.set(1.5, .041, -3.85); // just inside the door, to the right, clear of the boxes
    contactShadow([.32, .18], [1.5, .003, -3.85], { opacity: .55 }).rotation.z = .9;
  }
  const storageTube = box([.9, .05, .18], [1.75, 2.92, -4.6], material('#8f928a', { roughness: .7 }));
  cylinder(.018, .8, [1.75, 2.885, -4.6], material('#5c6260', { roughness: .4 }), scene, 10).rotation.z = Math.PI / 2;  // dead tube
  const storageVent = box([.3, .2, .03], [2.2, 2.93, -4.9], darkMetal); for (let i = 0; i < 4; i++) box([.26, .012, .01], [2.2, 2.86 + i * .045, -4.9], edgeMaterial);
  // Traces: a phone face-down under the bottom shelf by the back wall, a dried stain on the floor below the wall stain,
  // a drift of dust in front of the shelves, a few balled-up handouts by the wall.
  const phone = box([.07, .008, .14], [13.68, .004, 1.42], material('#101214', { roughness: .35, metalness: .3 })); phone.rotation.y = .55; // Nanami's dead phone, under the bench where she waited
  box([.012, .009, .012], [.03, 0, .066], material('#2e3236', { roughness: .9 }), phone); // chipped corner
  const phoneCable = cylinder(.0035, .12, [1.44, .004, -5.17], material('#e8e4da', { roughness: .6 }), scene, 6); phoneCable.rotation.set(Math.PI / 2, 0, .5);
  const floorStain = new THREE.Mesh(new THREE.PlaneGeometry(.66, .5), new THREE.MeshBasicMaterial({ map: stainDisc(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  floorStain.rotation.x = -Math.PI / 2; floorStain.position.set(1.8, .004, -5.1); floorStain.renderOrder = -9; scene.add(floorStain);
  const stainRun = new THREE.Mesh(new THREE.PlaneGeometry(.22, .3), floorStain.material); stainRun.rotation.x = -Math.PI / 2; stainRun.position.set(1.82, .004, -5.22); stainRun.renderOrder = -9; scene.add(stainRun);
  const pile = new THREE.Mesh(new THREE.PlaneGeometry(.5, .3), new THREE.MeshBasicMaterial({ map: dustPile(), transparent: true, depthWrite: false })); pile.rotation.x = -Math.PI / 2; pile.position.set(1.6, .003, -4.86); pile.renderOrder = -9; scene.add(pile);
  for (const [x, z, r] of [[1.2, -5.2, .035], [2.28, -5.17, .03], [2.38, -4.92, .04]]) { const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), material('#d8d4c4', { roughness: 1 })); ball.position.set(x, r, z); ball.scale.y = .8; ball.castShadow = true; scene.add(ball); }
  // The storage wall is plastered like the rest; what is on it is painted as a transparent overlay (colour) plus a bump map
  // (height), so the stain looks like the wall discoloured and the nail grooves catch the light as dents, not drawn lines.
  const scratchPaint = (extra, mode) => canvasTexture(1024, 1024, (ctx, w, h) => {
    const bump = mode === 'bump';
    if (bump) { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); } else ctx.clearRect(0, 0, w, h);
    let seed = 11; const r = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
    // ── dried blood, soaked into the plaster: an irregular dark red-brown core, a thin paler halo, drips running down ──
    if (!bump) {
      const sx = 560, sy = 330;
      for (let i = 0; i < 70; i++) {
        const a = r() * Math.PI * 2, d = r() * r() * 150, x = sx + Math.cos(a) * d * 1.25, y = sy + Math.sin(a) * d, rad = 26 + r() * 95;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(58,14,10,${.06 + r() * .1})`); g.addColorStop(.6, `rgba(72,22,14,${.04 + r() * .06})`); g.addColorStop(1, 'rgba(72,22,14,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (.7 + r() * .5), r() * 3, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = 0; i < 40; i++) { // faint outer tide marks
        const a = r() * Math.PI * 2, d = 120 + r() * 140, x = sx + Math.cos(a) * d * 1.3, y = sy + Math.sin(a) * d, rad = 30 + r() * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(96,48,28,${.03 + r() * .04})`); g.addColorStop(1, 'rgba(96,48,28,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = 0; i < 2600; i++) { // grain so the plaster shows through unevenly
        const a = r() * Math.PI * 2, d = r() * 190, x = sx + Math.cos(a) * d * 1.25, y = sy + Math.sin(a) * d;
        ctx.fillStyle = r() > .5 ? `rgba(40,8,6,${r() * .18})` : `rgba(140,110,90,${r() * .08})`; ctx.fillRect(x, y, 1 + r() * 3, 1 + r() * 3);
      }
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) { // drips
        let x = sx - 120 + r() * 240, y = sy + 40 + r() * 90; const len = 60 + r() * 260, wdt = 1.5 + r() * 3;
        ctx.strokeStyle = `rgba(62,16,12,${.18 + r() * .22})`; ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 10; k++) { x += (r() - .5) * 6; y += len / 10; ctx.lineTo(x, y); } ctx.stroke();
        const g = ctx.createRadialGradient(x, y, 0, x, y, wdt * 2.4); g.addColorStop(0, 'rgba(58,14,10,.4)'); g.addColorStop(1, 'rgba(58,14,10,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, wdt * 2.4, 0, Math.PI * 2); ctx.fill();
      }
    } else { seed = 11; for (let i = 0; i < 70 + 40 + 2600 + 9 * 14; i++) r(); seed = 4421; } // keep both maps on the same random sequence afterwards
    // ── nail drags: a hand's pull leaves three or four long parallel grooves; deepest mid-way, fraying out at both ends ──
    const nailLine = (x, y, len, lean, depth) => {
      const cx = x + lean * .5 + (r() - .5) * 20, ex = x + lean + (r() - .5) * 16;
      const path = (ox, oy) => { ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.quadraticCurveTo(cx + ox, y + len * .5, ex + ox, y + len + oy); };
      if (bump) {
        // groove: dark centre (low), soft pale rims (raised lip of torn paint)
        ctx.strokeStyle = `rgba(190,190,190,${.35 * depth})`; ctx.lineWidth = 7 + depth * 3; path(0, 0); ctx.stroke();
        ctx.strokeStyle = `rgba(30,30,30,${.9 * depth})`; ctx.lineWidth = 2.6 + depth * 1.6; path(0, 0); ctx.stroke();
        ctx.strokeStyle = `rgba(0,0,0,${.6 * depth})`; ctx.lineWidth = 1.1; path(0, 0); ctx.stroke();
        for (let k = 0; k < 4; k++) r();
      } else {
        ctx.strokeStyle = `rgba(16,20,18,${.3 * depth})`; ctx.lineWidth = 3.4 + depth; path(2.2, 0); ctx.stroke();      // shadow inside the dent
        ctx.strokeStyle = `rgba(200,204,184,${.26 * depth})`; ctx.lineWidth = 2 + depth * 1.4; path(0, 0); ctx.stroke(); // exposed pale plaster
        ctx.strokeStyle = `rgba(236,238,222,${.14 * depth})`; ctx.lineWidth = .9; path(-1.4, 0); ctx.stroke();        // lit rim
        for (let k = 0; k < 4; k++) { const yy = y + len * (.3 + r() * .45); ctx.strokeStyle = `rgba(222,226,206,${.14 * depth})`; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(x + (cx - x) * ((yy - y) / len) + (r() - .5) * 4, yy); ctx.lineTo(x + (cx - x) * ((yy - y) / len) + (r() - .5) * 4, yy + 10 + r() * 20); ctx.stroke(); }
      }
    };
    ctx.lineCap = 'round';
    const handsX = [120, 300, 470, 640, 800].map(x => x + (r() - .5) * 60);
    for (let hand = 0; hand < 5; hand++) {
      const x0 = handsX[hand], y0 = 360 + r() * 220, len = 180 + r() * 320, lean = (r() - .5) * 170, nails = 3 + Math.round(r());
      const gap = 27 + r() * 15, depth = .5 + r() * .6;
      for (let n = 0; n < nails; n++) nailLine(x0 + n * gap + (r() - .5) * 8, y0 + (r() - .5) * 36, len * (.8 + r() * .3), lean, depth * (n === 0 || n === nails - 1 ? .7 : 1));
    }
    // ── words gouged with a fingernail, in handwriting: shaky, tilted, strokes doubled, some lost where the paint flaked ──
    const gouge = (text, cx, cy, size, ink = '#d3d7c3') => {
      ctx.save(); ctx.font = `${size}px ${HAND}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const widths = [...text].map(ch => ctx.measureText(ch).width); const total = widths.reduce((a, b) => a + b, 0);
      let x = cx - total / 2;
      [...text].forEach((ch, i) => {
        const px = x + widths[i] / 2, py = cy + (r() - .5) * size * .35;
        ctx.save(); ctx.translate(px, py); ctx.rotate((r() - .5) * .3); ctx.scale(1, .92 + r() * .25);
        if (bump) { ctx.strokeStyle = 'rgba(40,40,40,.9)'; ctx.lineWidth = 3; ctx.strokeText(ch, 0, 0); ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 1.2; ctx.strokeText(ch, 0, 0); for (let k = 0; k < 6; k++) r(); }
        else {
          ctx.strokeStyle = 'rgba(16,20,18,.3)'; ctx.lineWidth = 3.2; ctx.strokeText(ch, 2, 1);
          for (let k = 0; k < 3; k++) { ctx.strokeStyle = ink + (k ? '44' : '88'); ctx.lineWidth = k ? 1.6 : 2.6; ctx.strokeText(ch, (r() - .5) * 4, (r() - .5) * 4); }
          ctx.fillStyle = ink + '30'; ctx.fillText(ch, 0, 0);
        }
        ctx.restore(); x += widths[i] + (r() - .5) * size * .2;
      });
      // paint flaked off across the letters: strokes go missing
      if (!bump) { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; for (let k = 0; k < 7; k++) { ctx.lineWidth = 2 + r() * 5; ctx.beginPath(); const sx = cx - total / 2 + r() * total, sy = cy - size * .6 + r() * size * 1.2; ctx.moveTo(sx, sy); ctx.lineTo(sx + (r() - .5) * 140, sy + (r() - .5) * 52); ctx.stroke(); } ctx.globalCompositeOperation = 'source-over'; }
      else for (let k = 0; k < 7 * 5; k++) r();
      ctx.restore();
    };
    gouge('ミーは', w / 2 - 80, 150, 104); gouge('ここだって', w / 2 + 40, 290, 100);
    gouge('nanami 06', w / 2 + 250, 760, 48, '#bfc5b0');
    if (extra) gouge(extra, w / 2 - 190, 810, 56, '#dce0cc');
  });
  const scratchTexture = extra => scratchPaint(extra, 'color');
  const scratchBump = extra => { const tx = scratchPaint(extra, 'bump'); tx.colorSpace = THREE.NoColorSpace; return tx; };
  const scratches = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), material('#ffffff', { map: scratchTexture(''), bumpMap: scratchBump(''), bumpScale: .018, transparent: true, alphaTest: .015, roughness: .96, side: THREE.DoubleSide }));
  scratches.position.set(1.75, 2.15, -5.325); scene.add(scratches);
  if (location.hostname === '127.0.0.1') { window.__scratch = scratchTexture; window.__scene = scene; } // local preview only
  const storageShelfHit = proxy('storage-shelf', [1.4, 2.2, .3], [1.75, 1.3, -5.05]);
  register('storage-shelf', '奥の棚', [storageShelfHit], [1.75, 1.35, -4.95], [1.75, 1.55, -4.15], [1.75, 1.45, -5.3]);
  register('storage-wall', '棚の上の壁', [scratches], [1.75, 2.2, -5.25], [1.75, 1.9, -4.2], [1.75, 2.15, -5.32]);
  register('storage-sneaker', '片方だけのスニーカー', [proxy('storage-sneaker', [.3, .2, .34], [1.5, .08, -3.85])], [1.5, .12, -3.78], [1.55, .95, -3.45], [1.5, .05, -3.85]);
  register('storage-boxes', '段ボールの山', [proxy('storage-boxes', [1.5, 1.0, .7], [1.7, .5, -4.15])], [1.7, .78, -3.95], [1.75, 1.2, -3.35], [1.7, .5, -4.2]);
  register('storage-cans', '棚の缶詰', cans, [1.58, 1.22, -4.97], [1.6, 1.35, -4.35], [1.58, 1.18, -5.05]);
  register('storage-doorplate', '扉の内側の札', [doorPlates.get('storage')], [1.75, 1.56, -3.5], [1.75, 1.5, -4.1], [1.75, 1.56, -3.49]);
  interactables.get('storage-doorplate').follow = doorPlates.get('storage-anchor'); interactables.get('storage-doorplate').followDist = .78; // the door moves: marker and close-up follow it
  register('storage-ceiling', '天井の蛍光灯', [storageTube, storageVent], [1.75, 2.88, -4.6], [1.75, 1.5, -3.7], [1.75, 2.92, -4.6]);
  register('storage-floorstain', '床の染み', [floorStain], [1.8, .06, -5.0], [1.78, 1.0, -4.3], [1.8, 0, -5.1]);
  // Cardboard boxes with facility labels, a mop bucket, a stack of chairs.
  // Cardboard: corrugated texture, lids as two overlapping flaps with a strip of packing tape, slightly crushed (small tilts),
  // the lowest box sitting flat on the floor with a soft shadow, the second resting on it.
  const cardboard = material('#ffffff', { map: cardboardTexture('#9a7f58'), roughness: .95 });
  const cardboardDark = material('#ffffff', { map: cardboardTexture('#8b7050'), roughness: .95 });
  const tapeMat = material('#c9b48a', { roughness: .4, metalness: .05 });
  for (const [x, y, z, s, ry, tilt, t] of [[1.3, .21, -4.3, .42, .2, 0, ['汐見センター', '備品　防災用品', '取扱注意']], [1.33, .61, -4.32, .38, -.1, .04, ['体験室 配布資料', '2027.4']], [2.16, .22, -4.02, .44, .42, -.03, ['非常食', '賞味期限 2029.3']]]) { // pushed apart: a lane down the middle to the shelves
    const b = box([s * 1.5, s, s], [x, y, z], cardboard); b.rotation.set(tilt * .5, ry, tilt);
    const l = sheet(label(t, '#c9b48c', '#4a3a24', 512, 300), [s * 1.1, s * .55], [0, 0, s / 2 + .004]); b.add(l);
    // lid flaps: two halves that do not quite meet, one lying over the other, a crease strip at the fold
    box([s * 1.5, .012, s * .52], [0, s / 2 + .004, -s * .25], cardboardDark, b).rotation.x = -.02;
    box([s * 1.5, .012, s * .5], [0, s / 2 + .012, s * .26], cardboardDark, b).rotation.x = .035;
    box([s * 1.5, .004, .006], [0, s / 2 + .006, -s * .5], material('#6a5238'), b); box([s * 1.5, .004, .006], [0, s / 2 + .014, s * .5], material('#6a5238'), b);
    box([s * .22, .006, s * 1.02], [s * .05, s / 2 + .02, 0], tapeMat, b);                 // packing tape over the seam
    box([s * .22, s * .3, .004], [s * .05, s * .36, s / 2 + .007], tapeMat, b);            // tape running down the front
    { const lift = new THREE.Group(); lift.position.set(s * .05, s / 2 + .021, -s * .51); lift.rotation.x = .9; b.add(lift); const tab = box([s * .22, .002, s * .12], [0, 0, s * .06], tapeMat, lift); tab.castShadow = true; } // the tape's end has let go at the back and stands up
    for (const fx of [-.25, .25]) box([.003, s * .98, .003], [fx * s * 1.5, 0, s / 2 + .002], material('#7a5f40', { roughness: 1 }), b); // fold creases down the front face
    for (const sx of [-1, 1]) box([.006, s, .006], [sx * s * .75, 0, s / 2], material('#6a5238'), b); // crushed corner edges
    if (y < .3) contactShadow([s * 1.9, s * 1.4], [x, .004, z], { opacity: .55 }).rotation.z = ry;
  }
  // Mop bucket and mop, in the corner east of the storage door (clear of the door's swing, short of the extinguisher).
  // Bucket: a commercial yellow mop bucket — a lathed tub wider at the top with a thick rolled rim, four moulded ribs, a steel bail
  // with a resin grip resting on the rim, a press wringer clipped on the wall side, four small casters. The water dried long ago:
  // a whitish tide ring and a thin dark film at the bottom (as the narration says). Mop: steel handle with a resin cap, a clamp,
  // and a head of loose cotton strands that slump and splay on the floor, grey-white with dirty tips; leaning back on the wall.
  { const BX = 2.78, BZ = -3.12, B0 = .055; // centre on the floor, bottom of the tub above the floor (casters)
    const tubTex = canvasTexture(256, 256, (ctx, w, h) => { // u: round the tub, v: up the profile (outside bottom → rim → inside)
      ctx.fillStyle = '#d6b22a'; ctx.fillRect(0, 0, w, h); const r = seeded(701);
      const g = ctx.createLinearGradient(0, h, 0, h * .45); g.addColorStop(0, 'rgba(60,48,20,.45)'); g.addColorStop(1, 'rgba(60,48,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, h * .45, w, h * .55); // grime low on the outside
      for (let i = 0; i < 40; i++) { ctx.strokeStyle = `rgba(${r() > .5 ? '250,236,170' : '70,56,24'},${.08 + r() * .14})`; ctx.lineWidth = 1 + r() * 2; const x = r() * w, y = h * (.3 + r() * .6); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - .5) * 30, y + (r() - .5) * 6); ctx.stroke(); } // scuffs
      ctx.fillStyle = 'rgba(240,226,160,.35)'; ctx.fillRect(0, h * .2, w, h * .04); // the rim worn pale
      ctx.fillStyle = 'rgba(70,60,36,.5)'; ctx.fillRect(0, 0, w, h * .14); // inside, low: dried film
      ctx.fillStyle = 'rgba(230,226,206,.55)'; ctx.fillRect(0, h * .1, w, h * .015); // the white tide ring where the water stood
    });
    tubTex.wrapS = THREE.RepeatWrapping;
    const resin = material('#ffffff', { map: tubTex, roughness: .4, metalness: 0, side: THREE.DoubleSide });
    // lathe profile (radius, height), outside up, over the rim, inside down to the floor of the tub
    const prof = [[0, 0], [.165, 0], [.172, .02], [.196, .3], [.2, .33], [.214, .345], [.218, .36], [.212, .372], [.198, .372], [.186, .34], [.162, .035], [.15, .03], [0, .03]].map(([x, y]) => new THREE.Vector2(x, y));
    const tub = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), resin); tub.position.set(BX, B0, BZ); tub.castShadow = tub.receiveShadow = true; scene.add(tub);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; const rib = rbox([.022, .26, .02], [BX + Math.cos(a) * .188, B0 + .17, BZ + Math.sin(a) * .188], resin, scene, .006); rib.rotation.y = -a; rib.rotation.z = Math.cos(a) * .08; rib.rotation.x = -Math.sin(a) * .08; } // moulded ribs
    const film = new THREE.Mesh(new THREE.CircleGeometry(.15, 20), material('#4a4334', { roughness: .25, metalness: .05 })); film.rotation.x = -Math.PI / 2; film.position.set(BX, B0 + .032, BZ); scene.add(film); // dried, faintly glossy
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const cx = BX + Math.cos(a) * .13, cz = BZ + Math.sin(a) * .13; box([.03, .025, .03], [cx, B0 - .012, cz], material('#2a2c2a', { roughness: .7 })); const wh = cylinder(.022, .018, [cx, .022, cz], material('#1c1d1c', { roughness: .8 }), scene, 12); wh.rotation.z = Math.PI / 2; wh.rotation.y = a; } // casters
    const steelBail = material('#b9bdb6', { metalness: .85, roughness: .3 });
    for (const sx of [-1, 1]) box([.02, .04, .03], [BX + sx * .212, B0 + .33, BZ], resin);                                 // bail lugs
    const bail = new THREE.Mesh(new THREE.TorusGeometry(.214, .0045, 6, 24, Math.PI), steelBail); bail.position.set(BX, B0 + .33, BZ); bail.rotation.x = -.35; bail.castShadow = true; scene.add(bail); // resting back on the rim
    { const grip = cylinder(.013, .11, [0, .214, 0], material('#2b2d2b', { roughness: .6 }), bail, 12); grip.rotation.z = Math.PI / 2; }
    // press wringer on the wall side: a grey housing hooked over the rim, the squeeze plate, a long lever with a black grip
    const wr = group([BX, B0 + .33, BZ - .1]); const grey = material('#55595a', { roughness: .5, metalness: .1 });
    rbox([.26, .15, .13], [0, .07, 0], grey, wr, .015); box([.22, .1, .02], [0, .06, .07], material('#3e4243', { roughness: .55 }), wr);
    for (const sx of [-1, 1]) box([.02, .05, .16], [sx * .12, .02, .02], grey, wr);                                         // hooks over the rim
    const lever = cylinder(.012, .62, [.1, .38, -.06], material('#9aa09c', { metalness: .7, roughness: .35 }), wr, 10); lever.rotation.x = -.28;
    const leverGrip = cylinder(.017, .13, [.1, .66, -.14], material('#202221', { roughness: .7 }), wr, 10); leverGrip.rotation.x = -.28;
    contactShadow([.62, .62], [BX, .003, BZ], { opacity: .6 }); contactShadow([.3, .3], [BX, .003, BZ], { opacity: .4 });
    // the dried ring a wet bucket left on the tiles, a little off from where it stands now
    decalLater.push(() => decal((ctx, w, h, r) => { ctx.strokeStyle = 'rgba(214,210,190,.16)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * .42, h * .42, 0, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = 'rgba(60,56,40,.18)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * .45, h * .45, 0, 0, Math.PI * 2); ctx.stroke(); }, [.5, .5], [BX - .14, .004, BZ + .16], { seed: 702, px: 256 }));
    // the mop: head on the floor in front of the bucket, handle leaning back onto the wall
    const head = V([BX - .25, 0, BZ + .32]), top = V([BX - .05, 1.42, -3.5]); // the handle stays clear of the storage door's frame
    const dir = top.clone().sub(head), len = dir.length();
    const handle = cylinder(.012, len - .06, [0, 0, 0], material('#c3c8c4', { metalness: .75, roughness: .32 }), scene, 10);
    handle.position.copy(head).addScaledVector(dir, .5).add(V([0, .05, 0])); handle.quaternion.setFromUnitVectors(V([0, 1, 0]), dir.clone().normalize());
    const cap = cylinder(.015, .05, [0, 0, 0], material('#2f5aa8', { roughness: .5 }), scene, 10); cap.position.copy(top).addScaledVector(dir.clone().normalize(), .0); cap.quaternion.copy(handle.quaternion);
    const clamp = rbox([.13, .035, .05], [head.x, .085, head.z], material('#8e958f', { metalness: .7, roughness: .4 }), scene, .008); clamp.quaternion.copy(handle.quaternion);
    const strandTex = canvasTexture(64, 16, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#d8d4c6'); g.addColorStop(.55, '#c9c4b2'); g.addColorStop(.85, '#8a826a'); g.addColorStop(1, '#5a5240'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }); // clean at the clamp, dirty at the tips
    const strandMat = material('#ffffff', { map: strandTex, roughness: 1 }); const rr = seeded(703); const strands = [];
    for (let i = 0; i < 42; i++) { // each strand: from under the clamp, down, then out along the floor; a few curl back
      const a = rr() * Math.PI * 2, reach = .1 + rr() * .14, sx = (rr() - .5) * .1, sz = (rr() - .5) * .04;
      const p0 = V([head.x + sx, .08, head.z + sz]), p1 = V([head.x + sx * 1.4 + Math.cos(a) * .04, .035, head.z + sz + Math.sin(a) * .04]);
      const p2 = V([head.x + Math.cos(a) * reach * .7, .012, head.z + Math.sin(a) * reach * .7]), p3 = V([head.x + Math.cos(a + (rr() - .5) * .6) * reach, .007, head.z + Math.sin(a + (rr() - .5) * .6) * reach]);
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, p1, p2, p3]), 6, .009 + rr() * .004, 4, false), strandMat); m.castShadow = true; scene.add(m); strands.push(m);
    }
    contactShadow([.42, .36], [head.x, .002, head.z], { opacity: .55 });
    const bucketHit = proxy('bucket', [.62, .62, .66], [BX - .1, .31, BZ + .12]); // the tub, the wringer and the mop's head (not the wall behind)
    register('bucket', 'モップとバケツ', [bucketHit], [BX - .05, .55, BZ + .1], [2.05, 1.25, -2.15], [BX - .12, .3, BZ + .05]); // close-up: the tub, the wringer and the mop's strands in one frame
  }

  box([1.22, 1.36, .07], [0, 2.12, -3.49], darkMetal);
  contactShadow([1.5, 1.6], [0, 2.08, -3.522], { opacity: .5, up: 'z' });
  const plan = sheet(planTexture(), [1.0, 1.33], [0, 2.12, -3.45]);
  register('map', '壁の避難経路図', [plan], [0, 2.13, -3.38], [0, 2.1, -1.94], [0, 2.1, -3.4]);
  sheet(label(['防災待機室'], '#6c786b', '#b7b8a2', 768, 200), [1.0, .26], [0, 3.16, -3.515]);
  // What this room is for, pinned beside the door: the first thing a careful player reads.
  const roomSign = paperSheet(paper({ kind: 'announce', heading: '巡回・作業担当の方へ', band: '#1f6b4a', w: 700, h: 980, bg: '#c6c3ad', title: '防災待機室（体験参加者 待機用）のご利用について', meta: '汐見市 施設管理課', contact: '巡回：汐見警備保障', titleSize: 34, bodySize: 23, highlight: [5], body: [
    '本室は火災や停電などの際に来館者と職員が一時的に待機する部屋です。閉館後は、撤去作業と巡回の詰所として使っています（作業書類を掲示）。',
    '■ 入口の扉：常時開放式の防火戸です。ふだんは開いたまま、壁の留め金（ドアレリーズ）で止めてあります。訓練設備と連動しており、照明とともに留め金が外れて自動で閉まります。2028年6月の改修により、安全確認後に職員が外側から解錠する方式に変わりました。閉まると内側からは開きません。作業中は留め金に掛けたままにしてください。',
    '■ 机：管理室の予備の机です（巡回・作業時に使用）。備品の持ち出しはご遠慮ください。',
    '■ 資材庫・点検通路・非常階段：使用の可否は各扉の掲示を確認のこと。',
    '※ 閉館後も、残置設備の撤去が完了するまで、警備会社が週1回巡回し、施設管理課が管理しています。',
    '閉館に伴い、内線は停止しています。警備会社の巡回時（毎週水曜21時）にお申し出ください。'
  ], footer: '2030年10月 改訂' }), [.5, .7], [2.2, 1.98, 4.812], scene, { pins: true }); roomSign.rotation.y = Math.PI; // south wall, just past where the open entrance door used to lie
  register('roomsign', '扉の横の案内', [roomSign], [2.2, 1.98, 4.75], [2.2, 1.85, 3.95], [2.2, 1.9, 4.82]);
  // The staff extension phone under the notice (内線 201 管理室 / 204 設備係 on the notices): a wall-mounted business phone of the
  // common Japanese kind. Silver-grey body with a tilted-out LCD under a clear cover (dead: dark grey, no text), 30 line keys in
  // 6 × 5 with their dark lamp windows, a white 12-key pad, a round menu key, flash / function / hold (hold in orange); a white
  // handset hanging upright on its own wall cradle to the left, a curly cord sagging below, a thin black line cable down the wall.
  // Built in a group facing north (−z) into the room: local x is to the viewer's right, y up, z out of the wall. Keys and lamp
  // windows are instanced; the printing (line numbers, digits, function names) is one canvas each for the face and the keys.
  { const ph = group([2.15, 0, 4.825], Math.PI);
    const seed = seeded(901);
    const faceTex = canvasTexture(512, 768, (ctx, w, h) => { // the face plate: brushed silver, printed numbers, the speaker grille, dust
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#b9bcb8'); g.addColorStop(.5, '#a9adaa'); g.addColorStop(1, '#9ea29f'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${seed() > .5 ? '235,238,234' : '60,64,62'},${seed() * .08})`; ctx.fillRect(seed() * w, seed() * h, 8 + seed() * 40, 1); } // brushing
      const X = x => (x + .105) / .21 * w, Y = y => (1.495 - y) / .31 * h; // local (x, y) → canvas
      ctx.fillStyle = '#2c302e'; ctx.font = '600 15px "Noto Sans JP", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) ctx.fillText(String((4 - r) * 6 + c + 1), X(-.082 + c * .031), Y(1.426 - r * .022 + .009)); // line numbers above each key
      ctx.fillStyle = 'rgba(40,44,42,.55)'; for (let yy = Y(1.302); yy < Y(1.294); yy += 4) for (let xx = X(-.09); xx < X(.09); xx += 4) { ctx.beginPath(); ctx.arc(xx, yy, 1.1, 0, Math.PI * 2); ctx.fill(); } // speaker grille band
      ctx.fillStyle = '#2c302e'; ctx.font = '600 17px "Noto Sans JP", sans-serif'; ctx.textAlign = 'center';
      for (const [t, x, y] of [['フラッシュ', .066, 1.252], ['機　能', .066, 1.229], ['保　留', .066, 1.206], ['スピーカ', -.07, 1.198], ['短　縮', -.035, 1.198], ['発　信', .0, 1.198]]) ctx.fillText(t, X(x), Y(y));
      const dust = ctx.createLinearGradient(0, h * .82, 0, h); dust.addColorStop(0, 'rgba(110,100,70,0)'); dust.addColorStop(1, 'rgba(110,100,70,.22)'); ctx.fillStyle = dust; ctx.fillRect(0, h * .82, w, h * .18); // grime gathers low
      ctx.strokeStyle = 'rgba(30,32,30,.35)'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    });
    const silver = material('#ffffff', { map: faceTex, metalness: .5, roughness: .42 });
    const greyBody = material('#9a9e9b', { metalness: .45, roughness: .48 });
    const ivory = material('#e8e4d8', { roughness: .42, metalness: 0 });                 // the white resin, a little yellowed
    const ivoryDim = material('#d9d3c2', { roughness: .5, metalness: 0 });
    const blackRes = material('#1d1f1e', { roughness: .45 });
    // body and face
    rbox([.22, .33, .045], [0, 1.345, .0245], greyBody, ph, .012);
    { const face = new THREE.Mesh(new THREE.PlaneGeometry(.21, .31), silver); face.position.set(0, 1.34, .0475); ph.add(face); }
    contactShadow([.4, .46], [-.04, 1.335, .003], { opacity: .38, up: 'z', parent: ph });
    // the display: a housing hinged at the top edge and tilted out, an unlit LCD (dark grey), a clear cover with a light edge
    const disp = new THREE.Group(); disp.position.set(0, 1.513, .045); disp.rotation.x = -.3; ph.add(disp);
    rbox([.212, .088, .018], [0, -.046, -.002], greyBody, disp, .008);
    rbox([.08, .008, .012], [.0, .0, .003], material('#d9dcd8', { roughness: .35, metalness: .2 }), disp, .003); // the light grip strip on top
    { const lcd = new THREE.Mesh(new THREE.PlaneGeometry(.17, .048), material('#3b413d', { roughness: .3, metalness: .05 })); lcd.position.set(.006, -.05, .0075); disp.add(lcd);
      const cover = new THREE.Mesh(new THREE.PlaneGeometry(.2, .078), material('#dfe8ea', { transparent: true, opacity: .14, roughness: .05, metalness: .1, depthWrite: false })); cover.position.set(0, -.046, .009); disp.add(cover);
      const sensor = cylinder(.006, .004, [-.088, -.018, .008], material('#6f7a80', { metalness: .6, roughness: .2 }), disp, 12); sensor.rotation.x = Math.PI / 2; sensor.castShadow = false;
      const tagp = new THREE.Mesh(new THREE.PlaneGeometry(.022, .012), material('#e9ebe8', { roughness: .4 })); tagp.position.set(.088, -.014, .0085); disp.add(tagp); }
    // 30 line keys (white caps, each with a dark lamp window on its left), instanced
    const lineGeo = roundedBoxGeometry(.022, .0085, .006, .0018), lampGeo = new THREE.BoxGeometry(.007, .0066, .0064);
    const lineKeys = new THREE.InstancedMesh(lineGeo, ivory, 30), lampWins = new THREE.InstancedMesh(lampGeo, blackRes, 30), m4 = new THREE.Matrix4();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) { const i = r * 6 + c, x = -.07 + c * .031, y = 1.426 - r * .022; m4.makeTranslation(x + .004, y, .051); lineKeys.setMatrixAt(i, m4); m4.makeTranslation(x - .0105, y, .0511); lampWins.setMatrixAt(i, m4); }
    for (const im of [lineKeys, lampWins]) { im.instanceMatrix.needsUpdate = true; im.castShadow = true; ph.add(im); }
    // 12-key pad and the three small keys under it (white), instanced; one legend plane over them for the printing
    const padGeo = roundedBoxGeometry(.028, .02, .008, .003), padPos = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) padPos.push([-.075 + c * .033, 1.282 - r * .025]);
    const smallPos = [[-.07, 1.186], [-.035, 1.186], [.0, 1.186]];
    const pad = new THREE.InstancedMesh(padGeo, ivory, 12); padPos.forEach(([x, y], i) => { m4.makeTranslation(x, y, .052); pad.setMatrixAt(i, m4); }); pad.instanceMatrix.needsUpdate = true; pad.castShadow = true; ph.add(pad);
    const smallGeo = roundedBoxGeometry(.026, .009, .006, .0018);
    const fnKeys = new THREE.InstancedMesh(smallGeo, ivory, 5); [...smallPos, [.066, 1.241], [.066, 1.218]].forEach(([x, y], i) => { m4.makeTranslation(x, y, .051); fnKeys.setMatrixAt(i, m4); }); fnKeys.instanceMatrix.needsUpdate = true; ph.add(fnKeys);
    { const hold = new THREE.Mesh(smallGeo, material('#e2742e', { roughness: .4 })); hold.position.set(.066, 1.195, .051); ph.add(hold);
      const fnLamp = new THREE.Mesh(new THREE.BoxGeometry(.007, .0066, .0064), blackRes); fnLamp.position.set(.0565, 1.218, .0511); ph.add(fnLamp);
      const spLamp = fnLamp.clone(); spLamp.position.set(-.0795, 1.186, .0511); ph.add(spLamp); }
    const padLegend = canvasTexture(256, 256, (ctx, w, h) => { // digits with their kana / letters, as printed on the keys
      ctx.clearRect(0, 0, w, h); const X = x => (x + .085) / .17 * w, Y = y => (1.31 - y) / .17 * h;
      const keysTxt = [['1', 'ア', ''], ['2', 'カ', 'ABC'], ['3', 'サ', 'DEF'], ['4', 'タ', 'GHI'], ['5', 'ナ', 'JKL'], ['6', 'ハ', 'MNO'], ['7', 'マ', 'PQRS'], ['8', 'ヤ', 'TUV'], ['9', 'ラ', 'WXYZ'], ['＊', '', ''], ['0', 'ワン', ''], ['＃', '', '']];
      keysTxt.forEach(([d, k, l], i) => { const [x, y] = padPos[i]; ctx.fillStyle = '#1e201f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 24px sans-serif'; ctx.fillText(d, X(x) + 5, Y(y)); ctx.font = '600 9px "Noto Sans JP", sans-serif'; ctx.textAlign = 'right'; if (k) ctx.fillText(k, X(x) - 6, Y(y) - 6); if (l) ctx.fillText(l, X(x) - 6, Y(y) + 6); });
    });
    { const leg = new THREE.Mesh(new THREE.PlaneGeometry(.17, .17), material('#ffffff', { map: padLegend, transparent: true, roughness: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); leg.position.set(-.0, 1.225, .0562); leg.userData.hitOnly = true; ph.add(leg); }
    // round menu key: chrome ring, dark centre
    { const ring = cylinder(.021, .006, [.06, 1.276, .05], material('#c9ccca', { metalness: .9, roughness: .22 }), ph, 24); ring.rotation.x = Math.PI / 2;
      const inner = cylinder(.012, .008, [.06, 1.276, .052], material('#1f2a3a', { roughness: .3, metalness: .2 }), ph, 18); inner.rotation.x = Math.PI / 2; inner.castShadow = false; }
    // the handset's wall cradle (white) and the handset, hung upright; its ends swell toward you
    rbox([.07, .31, .028], [-.155, 1.343, .014], ivoryDim, ph, .01);
    rbox([.05, .045, .02], [-.155, 1.47, .036], ivoryDim, ph, .008);                            // the hook the earpiece hangs on
    const hs = new THREE.Group(); hs.position.set(-.157, 1.35, .05); ph.add(hs);
    rbox([.046, .15, .03], [0, 0, 0], ivory, hs, .013);                                          // grip
    for (const [y, rx] of [[.083, .22], [-.083, -.22]]) { const end = rbox([.056, .06, .046], [0, y, .012], ivory, hs, .018); end.rotation.x = rx; } // earpiece, mouthpiece
    { const holes = new THREE.Mesh(new THREE.CircleGeometry(.012, 14), material('#c9c3b2', { roughness: .7 })); holes.position.set(0, .1, .037); holes.rotation.x = .22; hs.add(holes); }
    const grime = new THREE.Mesh(new THREE.PlaneGeometry(.04, .1), new THREE.MeshBasicMaterial({ map: dustSprite(), color: '#6b5d3c', transparent: true, opacity: .16, depthWrite: false })); grime.position.set(0, -.01, .0155); hs.add(grime); // where hands held it
    // curly cord: a helix wound along a sagging path, from the mouthpiece down and back up into the cradle
    { const path = new THREE.CatmullRomCurve3([V([-.157, 1.255, .055]), V([-.16, 1.12, .05]), V([-.166, .98, .045]), V([-.156, .935, .04]), V([-.144, .98, .035]), V([-.138, 1.1, .03]), V([-.135, 1.19, .028])]);
      const pts = [], N = 560, turns = 72, frames = path.computeFrenetFrames(N, false);
      for (let i = 0; i <= N; i++) { const t = i / N, p = path.getPointAt(t), a = t * turns * Math.PI * 2, k = Math.min(i, N - 1); pts.push(p.clone().addScaledVector(frames.normals[k], Math.cos(a) * .0065).addScaledVector(frames.binormals[k], Math.sin(a) * .0065)); }
      const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, .0021, 4, false), ivory); cord.castShadow = true; ph.add(cord); }
    // line cable from the body's right side down the wall to a modular outlet near the skirting
    { const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V([.108, 1.42, .02]), V([.125, 1.3, .006]), V([.128, .9, .004]), V([.13, .5, .004]), V([.128, .33, .006])]), 24, .0022, 5, false), blackRes); ph.add(cable);
      rbox([.06, .08, .018], [.128, .29, .009], material('#e6e3da', { roughness: .5 }), ph, .005); box([.012, .008, .004], [.128, .3, .019], blackRes, ph); }
    // a slip of paper taped to the wall beside it, in pen: the two extensions the notices give
    { const slip = canvasTexture(256, 160, (ctx, w, h) => { ctx.fillStyle = '#e4dfcc'; ctx.fillRect(0, 0, w, h); const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(120,100,60,0)'); g.addColorStop(1, 'rgba(120,100,60,.18)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#23324f'; ctx.font = `40px ${HAND}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('管理室 201', 22, 52); ctx.fillText('設備係 204', 22, 112);
        ctx.fillStyle = 'rgba(214,206,170,.75)'; ctx.fillRect(w * .35, 0, w * .3, 16); });
      const note = new THREE.Mesh(new THREE.PlaneGeometry(.075, .047), material('#ffffff', { map: slip, roughness: .9 })); note.position.set(.185, 1.43, .0015); note.rotation.z = -.04; ph.add(note); }
    phoneParts.push(...ph.children.filter(o => o.isMesh || o.isInstancedMesh));
  }
  register('phone', '壁の内線電話', [proxy('phone', [.36, .44, .08], [2.19, 1.33, 4.785])], [2.19, 1.36, 4.75], [2.12, 1.42, 4.05], [2.19, 1.33, 4.8]); // its marker shows once the game enables it (room.enable(['phone']))
  // The waiting room's entrance, from the station link corridor (連絡通路): south wall, as drawn on the evacuation map (N-B1-03,
  // the door at x −0.03…0.93). It is an ordinary doorway with a normally-open fire door (常時開放式防火戸): day to day the leaf
  // stood folded back against the wall, held by a magnetic door release, and people walked in through the open doorway — as you
  // did tonight. The drill's STEP 0 let go of the magnet and the closer shut it; since 2028.6 it cannot be opened from inside.
  // Hinges on the +x side; when open the leaf lay flat on the wall from x 0.98 to 1.94, where the release still waits for it.
  // Built in a group facing north (−z) into the room.
  { const door = group([.45, 0, 4.825], Math.PI), steel = material('#55625b', { metalness: .45, roughness: .55 }), frameMat = material('#3a433f', { metalness: .4, roughness: .6 });
    rbox([1.06, .06, .08], [0, 2.13, .02], frameMat, door, .008); for (const dx of [-.53, .53]) rbox([.06, 2.16, .08], [dx, 1.08, .02], frameMat, door, .008);
    const leaf = rbox([.96, 2.06, .05], [0, 1.04, .05], steel, door, .005);
    for (const y of [.55, 1.55]) box([.86, .01, .006], [0, y, .078], material('#4c5852', { metalness: .4, roughness: .6 }), door); // pressed panel lines
    box([.04, .05, .05], [.36, 1.0, .1], bareMetal, door); const lever = rbox([.16, .025, .025], [.3, 1.0, .13], bareMetal, door, .008); // lever handle
    // door closer: the body on the leaf near the hinges, a two-link arm folded up to a shoe on the frame head (as on a real fire door)
    { const cm = material('#8d928e', { metalness: .55, roughness: .4 });
      rbox([.28, .055, .055], [-.2, 1.955, .103], cm, door, .012);
      const pin = cylinder(.011, .03, [-.31, 1.955, .145], cm, door, 12); pin.rotation.x = Math.PI / 2;
      const link1 = rbox([.178, .018, .012], [-.235, 2.0025, .145], cm, door, .004); link1.rotation.z = .565;
      const elbow = cylinder(.009, .03, [-.16, 2.05, .135], cm, door, 10); elbow.rotation.x = Math.PI / 2;
      const link2 = rbox([.139, .015, .01], [-.1, 2.085, .125], cm, door, .004); link2.rotation.z = .528;
      rbox([.07, .03, .06], [-.04, 2.12, .09], cm, door, .006); }
    const plate = sheet(label(['防火戸', '火災・停電時は自動で閉まります', '扉の前に物を置かないでください'], '#b8bcae', '#2f3a33', 640, 260), [.32, .13], [0, 1.62, .079], door);
    const tag = sheet(label(['訓練用防火扉', '解錠は外側から（2028.6 改修）'], '#d9d4c0', '#5a2a1f', 512, 170), [.2, .066], [.3, 1.13, .078], door);
    box([.008, 2.02, .006], [.47, 1.04, .08], material('#1a1e1c'), door); // the dark gap at the latch side
    box([.9, .012, .03], [0, .006, .07], bareMetal, door);                 // threshold strip
    contactShadow([1.0, .3], [0, .003, .2], { opacity: .35, parent: door });
    contactShadow([1.3, 2.4], [0, 1.1, .004], { opacity: .28, up: 'z', parent: door }).renderOrder = -12;
    for (const y of [.35, 1.75]) { const k = cylinder(.013, .11, [-.49, y, .06], bareMetal, door, 10); k.castShadow = false; } // hinge knuckles (the +x side)
    // the release's other half on the leaf: the steel armature plate low on the latch side, the part that met the magnet
    const armature = cylinder(.04, .012, [.4, .26, .081], material('#b9beb8', { metalness: .85, roughness: .3 }), door, 18); armature.rotation.x = Math.PI / 2;
    cylinder(.012, .02, [.4, .26, .07], bareMetal, door, 8).rotation.x = Math.PI / 2;
    // door release (ドアレリーズ) on the wall where the open leaf's armature landed: a round electromagnet on a short arm, its wire
    // in conduit; now it holds nothing. A rubber floor stop beside it, and the scuffed arc the leaf's bottom edge drew on the floor.
    const rel = group([1.86, 0, 4.825], Math.PI);
    box([.09, .12, .02], [0, .26, .01], material('#d8d8d0', { roughness: .5 }), rel);                       // wall plate
    { const arm = cylinder(.016, .07, [0, .26, .055], material('#cfd0c8', { metalness: .3, roughness: .5 }), rel, 10); arm.rotation.x = Math.PI / 2;
      const mag = cylinder(.042, .03, [0, .26, .1], material('#5d6460', { metalness: .6, roughness: .45 }), rel, 20); mag.rotation.x = Math.PI / 2;
      const face = cylinder(.036, .004, [0, .26, .117], material('#a9aea9', { metalness: .85, roughness: .3 }), rel, 20); face.rotation.x = Math.PI / 2; face.castShadow = false;
      const pilot = new THREE.Mesh(new THREE.CircleGeometry(.006, 10), material('#3a2020', { emissive: '#ff4a3a', emissiveIntensity: .25 })); pilot.position.set(.03, .315, .021); rel.add(pilot); }
    box([.016, .2, .016], [0, .44, .01], material('#d8d8d0', { roughness: .5 }), rel);                      // conduit up the wall
    sheet(label(['ドアレリーズ'], '#d8d8d0', '#3a4440', 256, 64), [.07, .018], [0, .19, .0205], rel);
    { const stop = cylinder(.025, .035, [-.06, .018, .2], material('#2a2b28', { roughness: .9 }), rel, 14); contactShadow([.08, .08], [-.06, .002, .2], { opacity: .5, parent: rel }); }
    contactShadow([.16, .12], [0, .26, .004], { opacity: .4, up: 'z', parent: rel });
    register('firedoor', '入ってきた入口の扉（防火戸）', [leaf, lever, plate, tag, armature], [.45, 1.25, 4.72], [.9, 1.38, 2.62], [.92, 1.02, 4.8]);
  }
  // the room name the corridor side sees above the entrance (no number)
  { const nameplate = sheet(label(['防災待機室'], '#c9cdb8', '#2f3a33', 512, 128), [.6, .15], [.45, 2.42, 4.979]); nameplate.rotation.y = 0; }

  const switchPlate = box([.19, .31, .03], [-.85, 1.41, -3.51], material('#b0b3a0', { roughness: .5 }));
  const rocker = box([.09, .16, .025], [-.85, 1.42, -3.483], material('#c5c7b3', { roughness: .45 }));
  const rockerLamp = box([.02, .012, .004], [-.85, 1.5, -3.494], material('#7fdc8a', { emissive: '#7fdc8a', emissiveIntensity: .2 })); // tiny pilot lamp
  sheet(label(['非常灯'], '#b0b3a0', '#4d594b', 256, 96), [.17, .065], [-.85, 1.32, -3.494]);
  for (const [sx, sy] of [[-.07, .13], [.07, -.13]]) { const sc = cylinder(.006, .004, [-.85 + sx, 1.41 + sy, -3.494], bareMetal, scene, 8); sc.rotation.x = Math.PI / 2; sc.castShadow = false; }
  register('switch', '壁のスイッチ', [switchPlate, rocker], [-.85, 1.43, -3.37], [-.7, 1.5, -1.75]);

  const keypadGroup = new THREE.Group();
  keypadGroup.position.set(1.12, 1.66, .10);
  hinges.get('exit').add(keypadGroup); // the lock is fitted to the leaf: it swings away with the door instead of hanging in the doorway
  box([.43, .9, .09], [0, -.11, 0], darkMetal, keypadGroup);
  box([.39, .86, .02], [0, -.11, .055], material('#8e9587'), keypadGroup);
  // An old sticker from the training years under the keys: the lock also takes input from a connected partner AI.
  const aiSticker = sheet(label(['※訓練中は、', 'AIパートナーからも', '操作できます（訓練用）'], '#d8d2bc', '#354c42', 640, 300), [.33, .155], [0, -.43, .066], keypadGroup);
  interactables.get('exit').paper = aiSticker; // the sticker can be opened flat from the door, like the panel's plate
  for (const [x, y] of [[-.17, .3], [.17, .3], [-.17, -.52], [.17, -.52]]) cylinder(.008, .006, [x, y, .067], material('#4e5650', { metalness: .8, roughness: .3 }), keypadGroup, 8).rotation.x = Math.PI / 2; // bezel screws
  const display = sheet(label(['— — —'], '#132c24', '#b1d0b0', 768, 192), [.33, .1], [0, .22, .069], keypadGroup);
  display.material.setValues({ emissive: '#ffffff', emissiveMap: display.material.map, emissiveIntensity: .55 });
  box([.35, .12, .006], [0, .22, .063], material('#0d1a15', { roughness: .3 }), keypadGroup); // recessed display bezel
  sheet(label(['番号錠　3桁入力 → 開'], '#8e9587', '#29382d', 512, 72), [.33, .045], [0, .3, .069], keypadGroup);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '消', '0', '開'];
  keys.forEach((key, index) => {
    const x = (index % 3 - 1) * .115;
    const y = .085 - Math.floor(index / 3) * .108;
    const lift = ((index * 7) % 5 - 2) * .0012; // keys sit at slightly different heights, as worn keypads do
    const mesh = box([.095, .082, .035], [x, y, .085 + lift], material(key === '開' ? '#9aa58b' : '#c2c1ad', { roughness: .45 }), keypadGroup);
    const face = sheet(label([key], key === '開' ? '#9aa58b' : '#c2c1ad', '#29382d', 192, 192), [.08, .07], [x, y, .1035 + lift], keypadGroup);
    if (key === '開') face.material.setValues({ emissive: '#ffffff', emissiveMap: face.material.map, emissiveIntensity: .12 });
    const id = `key-${key}`;
    register(id, key === '開' ? '解錠する' : key === '消' ? '1文字消す' : `数字 ${key}`, [mesh, face], [-1.33 + x, 1.66 + y, -3.16], [-1.33, 1.65, -2.35], [-1.33, 1.64, -3.22]);
  });

  const desk = group([-3.82, 0, -.1], Math.PI / 2);
  { const top = wood('#766b50'); top.wrapS = top.wrapT = THREE.RepeatWrapping; rbox([2.9, .045, 1.08], [0, .853, .59], material('#ffffff', { map: top, roughness: .55 }), desk, .014); // the top: 45 mm, rounded nosing
    box([2.84, .07, 1.02], [0, .795, .59], material('#4a4232', { roughness: .8 }), desk); } // apron under it, set back
  // top edge chamfer (darker strips), a rubbed band along the front edge where arms rest, the legs' feet and the desk's own shadow
  box([2.5, .002, .09], [0, .8765, 1.075], material('#4b4332', { transparent: true, opacity: .22, roughness: .5 }), desk).castShadow = false;
  for (const x of [-1.28, 1.28]) for (const z of [.22, .96]) { box([.045, .8, .045], [x, .4, z], darkMetal, desk); contactShadow([.18, .18], [x, .003, z], { opacity: .5, parent: desk }); }
  contactShadow([3.1, 1.3], [0, .002, .59], { opacity: .32, parent: desk });
  box([.85, .75, .93], [.73, .405, .52], material('#536055', { roughness: .6 }), desk); // drawer unit on four short feet: a 3 cm gap under it
  for (const [x, z] of [[.33, .12], [1.13, .12], [.33, .92], [1.13, .92]]) box([.03, .03, .03], [x, .015, z], darkMetal, desk);
  contactShadow([.95, 1.0], [.73, .002, .52], { opacity: .5, parent: desk });
  const drawer = new THREE.Group();
  drawer.position.set(.73, .52, .54);
  desk.add(drawer);
  box([.78, .035, .82], [0, -.055, 0], material('#77765d'), drawer);
  box([.78, .21, .045], [0, .04, .43], material('#71806c'), drawer);
  const drawerHandle = box([.25, .025, .055], [0, .04, .47], edgeMaterial, drawer);
  for (const x of [-.38, .38]) box([.025, .16, .8], [x, .02, 0], darkMetal, drawer);
  const drawerHit = proxy('drawer', [.82, .28, .07], [.73, .56, 1.02], desk);
  register('drawer', '机の引き出し', [drawerHit], [-2.78, .58, -.83], [-1.9, 1.3, -.8], [-2.8, .57, -.83]);
  interactables.get('drawer').track = drawerHandle; // the marker rides on the handle as the drawer slides out

  const memoTexture = paper({ kind: 'announce', heading: 'お知らせ', band: '#2f4f8a', tag: '重要', w: 1024, h: 700, bg: '#c9c2a8', title: '番号錠の変更について（北棟 点検通路）', meta: '2030年10月31日　汐見市 施設管理課（本庁舎）', contact: '施設管理課（本庁舎）平日 8:30〜17:15', titleSize: 34, bodySize: 23, stamp: '施設管理課', footer: '本紙は机上に保管すること。旧番号の貼り紙は撤去済み。', body: [
    '巡回担当の交代が多いため、北棟地下 点検通路の番号錠を覚えやすい番号に更新しました。旧番号「031」は 10月31日 18:00 をもって無効です。',
    '新番号は3桁です。停電時の夜間手順にある三つの動作をもとに設定しています。各動作に対応する設備記号の設定値を手順どおりに並べてください。',
    '設備の設定値は設備係の対応表（施錠保管）を参照のこと。',
    '巡回は毎週水曜 21:00。設備の撤去が完了するまでは体験室への入室を控えること。'
  ] });
  const memo = sheet(memoTexture, [.7, .48], [-.65, .887, .65], desk);
  memo.rotation.x = -Math.PI / 2;
  memo.rotation.z = -.07;
  register('note', '机のメモ', [memo], [-3.16, .9, .55], [-2.5, 1.64, .55], [-3.16, .89, .55]);
  const pinPaper_body = vals => [
    '北棟地下　設備記号と設定値',
    `　□　……　${vals.box}`, `　◇　……　${vals.d1}`, `　○　……　${vals.circ}`, `　▽　……　${vals.d2}`,
    `　△　……　${vals.tri}`, `　◎　……　${vals.d3}`, `　■　……　${vals.d4}`, `　☆　……　${vals.d5}`,
    '（記号の対応は壁の「防災設備 記号一覧」を参照）',
    '※ 設定値を変更できるのは設備係のみ。旧表は廃棄済み。'
  ];
  const pinTextureOf = vals => paper({ w: 900, h: 960, bg: '#d6cdac', title: '防災設備 記号・設定値 対応表（改訂2版）', meta: '2030年10月31日 改訂　汐見市 施設管理課（本庁舎）', titleSize: 30, bodySize: 23, stamp: '控', body: pinPaper_body(vals) });
  const pinTexture = pinTextureOf({ tri: 2, circ: 8, box: 6, d1: 4, d2: 7, d3: 1, d4: 5, d5: 9 });
  const pinPaper = sheet(pinTexture, [.57, .608], [0, -.029, .05], drawer); // tall enough for the two footnotes
  pinPaper.rotation.x = -Math.PI / 2;
  register('pin', '引き出しの紙', [pinPaper], [-3.0, .62, -.78], [-2.1, 1.38, -.83], [-2.88, .51, -.83]); // marker over the paper, deeper in the drawer than the handle

  cylinder(.16, .035, [-1.16, .91, .55], darkMetal, desk);
  cylinder(.018, .4, [-1.16, 1.12, .55], darkMetal, desk, 8);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(.19, .17, 16, 1, true), material('#727d63', { side: THREE.DoubleSide }));
  shade.position.set(-1.16, 1.36, .55); desk.add(shade);
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 6), material('#d1c698', { emissive: '#e7ce98', emissiveIntensity: .15 }));
  lampBulb.position.set(-1.16, 1.27, .55); desk.add(lampBulb);
  const monitor = prop('monitor', { color: '#26332f', metalness: .35, roughness: .5 });
  monitor.position.set(.25, .876, .42); desk.add(monitor);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.5, .28), material('#0b100e', { roughness: .18, metalness: .45 })); screen.position.set(.25, 1.106, .431); desk.add(screen); // dark glass: catches the lamp
  // Office keyboard: rounded black body tilted back on its feet, ~100 individual keys (InstancedMesh) with 1.5 mm gaps,
  // a legend overlay for the printed characters, shinier worn keys (WASD / Enter / space), three dead LEDs, a cable, dust.
  const keyboard = new THREE.Group(); keyboard.position.set(.25, .877, .94); keyboard.rotation.set(-.035, 0, 0); desk.add(keyboard);
  {
    const KW = .45, KD = .15, P = .018, K = .0165;
    const bodyShape = (() => { const r = .008, w = KW, d = KD, sh = new THREE.Shape(); sh.moveTo(-w / 2 + r, -d / 2); sh.lineTo(w / 2 - r, -d / 2); sh.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r); sh.lineTo(w / 2, d / 2 - r); sh.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2); sh.lineTo(-w / 2 + r, d / 2); sh.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r); sh.lineTo(-w / 2, -d / 2 + r); sh.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2); return sh; })();
    const kbBody = new THREE.Mesh(new THREE.ExtrudeGeometry(bodyShape, { depth: .011, bevelEnabled: true, bevelThickness: .0015, bevelSize: .0015, bevelSegments: 2, curveSegments: 4 }), material('#1b1c1c', { roughness: .6 }));
    kbBody.rotation.x = -Math.PI / 2; kbBody.position.y = .0045; kbBody.castShadow = true; keyboard.add(kbBody);
    box([.44, .002, .012], [0, .0145, KD / 2 - .008], material('#262727', { roughness: .5 }), keyboard); // thin front lip
    for (const x of [-.18, .18]) box([.02, .006, .008], [x, .002, -KD / 2 + .012], material('#111'), keyboard); // folding feet at the back
    const keyMat = material('#2a2b2b', { roughness: .55 }); const keyShiny = material('#303131', { roughness: .35 });
    const keyGeo = new THREE.BoxGeometry(K, .007, K); keyGeo.translate(0, .0035, 0);
    const unit = []; const wide = []; // [x, z, w(units)]
    const z0 = -.057, zr = r => -.038 + r * P; const x0 = -.215;
    for (let c = 0; c < 13; c++) unit.push([x0 + c * P * 1.08 + (c ? P * .4 : 0), z0]);                          // Esc + F1–F12
    for (let c = 0; c < 13; c++) unit.push([x0 + c * P, zr(0)]); wide.push([x0 + 13.5 * P, zr(0), 2]);          // number row + Backspace
    wide.push([x0 + .25 * P, zr(1), 1.5]); for (let c = 0; c < 12; c++) unit.push([x0 + (c + 1.5) * P, zr(1)]);    // Tab + QWERTY row
    wide.push([x0 + .4 * P, zr(2), 1.8]); for (let c = 0; c < 11; c++) unit.push([x0 + (c + 1.8) * P, zr(2)]);   // Caps + ASDF row
    wide.push([x0 + .6 * P, zr(3), 2.2]); for (let c = 0; c < 11; c++) unit.push([x0 + (c + 2.2) * P, zr(3)]); wide.push([x0 + 13.6 * P, zr(3), 1.8]); // Shifts + ZXCV row
    for (let c = 0; c < 3; c++) unit.push([x0 + (c + .2) * P, zr(4)]); for (let c = 0; c < 4; c++) unit.push([x0 + (c + 10.2) * P, zr(4)]); // Ctrl/Win/Alt … Alt/Fn/Menu/Ctrl
    for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) unit.push([.052 + c * P, zr(r)]);                      // Ins/Home/PgUp, Del/End/PgDn
    unit.push([.07, zr(3)]); for (let c = 0; c < 3; c++) unit.push([.052 + c * P, zr(4)]);                        // arrows
    for (let c = 0; c < 4; c++) for (let r = 0; r < 5; r++) if (!(c === 3 && (r === 2 || r === 4)) && !(c === 1 && r === 4)) unit.push([.125 + c * P, zr(r)]); // numpad (minus the tall / wide keys)
    const keys = new THREE.InstancedMesh(keyGeo, keyMat, unit.length); const m = new THREE.Matrix4();
    unit.forEach(([x, z], i) => { m.makeTranslation(x, .0145, z); keys.setMatrixAt(i, m); }); keys.instanceMatrix.needsUpdate = true; keys.castShadow = true; keyboard.add(keys);
    for (const [x, z, w] of wide) { const key = box([K + (w - 1) * P, .007, K], [x + (w - 1) * P / 2, .018, z], keyMat, keyboard); key.castShadow = false; }
    box([K + 5.5 * P, .007, K], [x0 + 6.5 * P, .018, zr(4)], keyShiny, keyboard);                                   // space bar (worn shiny)
    box([K + .3 * P, .007, K], [x0 + 12.6 * P, .018, zr(1)], keyShiny, keyboard); box([K + 1.1 * P, .007, K], [x0 + 12.3 * P, .018, zr(2)], keyShiny, keyboard); // Enter, L-shaped
    for (const [c, r] of [[1.5 + 1, 1], [1.8, 2], [1.8 + 1, 2], [1.8 + 2, 2]]) box([K, .0072, K], [x0 + c * P, .0145 + .0036, zr(r)], keyShiny, keyboard); // W A S D
    box([K, .007 * 1, K], [.125 + 3 * P, .018, zr(1.5)], keyMat, keyboard).geometry.scale(1, 1, 2.1); box([K, .007, K], [.125 + 3 * P, .018, zr(3.5)], keyMat, keyboard).geometry.scale(1, 1, 2.1); box([K, .007, K], [.125 + .5 * P, .018, zr(4)], keyMat, keyboard).geometry.scale(2.1, 1, 1); // numpad +, Enter, 0
    for (let i = 0; i < 3; i++) box([.004, .001, .002], [.14 + i * .012, .0155, -.062], material('#2e2f2a', { roughness: .4 }), keyboard); // LEDs, dark
    // printed legends: one overlay plane just above the key tops, letters drawn at the key centres
    const legendTex = canvasTexture(1024, 342, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(245,245,240,.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const at = (x, z, t, size = 22) => { ctx.font = `600 ${size}px sans-serif`; ctx.fillText(t, (x + KW / 2) / KW * w, (z + KD / 2) / KD * h); };
      ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].forEach((t, c) => at(x0 + c * P * 1.08 + (c ? P * .4 : 0), z0, t, 13));
      '1234567890-^¥'.split('').forEach((t, c) => at(x0 + c * P, zr(0), t));
      'QWERTYUIOP@['.split('').forEach((t, c) => at(x0 + (c + 1.5) * P, zr(1), t));
      'ASDFGHJKL;:]'.split('').forEach((t, c) => at(x0 + (c + 1.8) * P, zr(2), t));
      'ZXCVBNM,./\\'.split('').forEach((t, c) => at(x0 + (c + 2.2) * P, zr(3), t));
      at(x0 + 14 * P, zr(0), 'BS', 14); at(x0 + .5 * P, zr(1), 'Tab', 13); at(x0 + .8 * P, zr(2), 'Caps', 12); at(x0 + 1.1 * P, zr(3), 'Shift', 13); at(x0 + 14 * P, zr(3), 'Shift', 13); at(x0 + 12.6 * P, zr(1), 'Enter', 12);
      at(x0 + .2 * P, zr(4), 'Ctrl', 12); at(x0 + 2.2 * P, zr(4), 'Alt', 12); at(x0 + 12.2 * P, zr(4), 'Alt', 12); at(x0 + 13.2 * P, zr(4), 'Ctrl', 12);
      [['Ins', 'Home', 'PgUp'], ['Del', 'End', 'PgDn']].forEach((row, r) => row.forEach((t, c) => at(.052 + c * P, zr(r), t, 11)));
      at(.07, zr(3), '↑', 16); ['←', '↓', '→'].forEach((t, c) => at(.052 + c * P, zr(4), t, 16));
      [['Num', '/', '*', '-'], ['7', '8', '9', '+'], ['4', '5', '6', ''], ['1', '2', '3', 'Ent'], ['0', '', '.', '']].forEach((row, r) => row.forEach((t, c) => t && at(.125 + c * P, zr(r), t, t.length > 1 ? 11 : 20)));
    });
    const legend = new THREE.Mesh(new THREE.PlaneGeometry(KW, KD), material('#ffffff', { map: legendTex, transparent: true, roughness: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); legend.rotation.x = -Math.PI / 2; legend.position.y = .0218; keyboard.add(legend);
    const dustTop = new THREE.Mesh(new THREE.PlaneGeometry(KW * .9, KD * .8), new THREE.MeshBasicMaterial({ map: dustPile(), transparent: true, opacity: .22, depthWrite: false })); dustTop.rotation.x = -Math.PI / 2; dustTop.position.set(.03, .0225, .01); keyboard.add(dustTop);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V([.02, .008, -.07]), V([.05, .004, -.2]), V([.03, -.002, -.4]), V([-.02, -.004, -.55])]), 16, .002, 6, false), material('#141516', { roughness: .6 })); keyboard.add(cable);
    contactShadow([KW * 1.08, KD * 1.2], [0, -.0015, .004], { opacity: .4, parent: keyboard });
    register('keyboard', '机のキーボード', [kbBody, keys], [-2.8, .97, -.2], [-2.45, 1.32, -.08], [-2.88, .89, -.35]);
  }
  for (let i = 0; i < 5; i++) box([.14, .34 + i % 2 * .09, .24], [-.8 + i * .15, 1.06, .15], material(['#59624d', '#817961', '#535e50'][i % 3]), desk);
  const mug = prop('mug', { color: '#a9ad95', roughness: .6 });
  mug.position.set(.96, .876, .42); mug.rotation.y = .6; desk.add(mug);
  const chair = prop('chair', { color: '#536055' });
  chair.position.set(-2.35, 0, -.1); chair.rotation.y = -Math.PI / 2 + .15; scene.add(chair);
  contactShadow([.8, .8], [-2.35, .003, -.1], { opacity: .5 });

  const notice = sheet(paper({ w: 768, h: 1024, bg: '#bfbba6', title: '工事完了報告書', meta: '2029年4月18日　施工：汐見電設株式会社', titleSize: 40, bodySize: 23, stamp: '完了', footer: '汐見センター 施設管理課　控', body: [
    '件名：北棟 ネットワークカメラ撤去工事',
    '内容：北棟全域のネットワークカメラ（計14台）およびレコーダーを撤去。配線は端末処理済み。',
    '本工事に伴い、館内の映像配信・遠隔確認サービスは 4月18日 17:00 をもって終了しました。今後は外部から映像を確認できません。',
    '立会：施設管理課 佐伯',
    '備考：2029年3月の体験室事故（参加者がAIの案内で閉鎖中の非常階段に進入・転倒）を受け、実証実験は中止。資材庫奥の通路は同月に閉塞済み。待機室の台座・ケーブル端は次回工事まで残置。'
  ] }), [.52, .7], [1.12, 2.05, -.095], desk, { tape: true });
  register('camera', '壁の工事記録', [notice], [-3.77, 2.08, -1.22], [-2.9, 2.08, -1.22], [-3.77, 2.08, -1.22]);
  box([.16, .19, .05], [-3.9, 3.16, -1.5], darkMetal);
  box([.13, .05, .2], [-3.77, 3.12, -1.5], edgeMaterial);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .4, 6), material('#1f2924'));
  cable.position.set(-3.73, 2.95, -1.5); cable.rotation.z = .25; scene.add(cable);

  const stairwell = group([3.92, 0, -.65], -Math.PI / 2);
  // Cast concrete: grey with aggregate, form-tie holes, water tide marks and a darker damp foot.
  const concreteTex = (seed, tone = '#7c7f78', damp = .25) => canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = tone; ctx.fillRect(0, 0, w, h); const r = seeded(seed);
    for (let i = 0; i < 9000; i++) { const v = r(); ctx.fillStyle = v > .7 ? `rgba(230,228,220,${r() * .18})` : `rgba(20,22,20,${r() * .2})`; const s2 = 1 + r() * (v > .95 ? 5 : 2); ctx.fillRect(r() * w, r() * h, s2, s2); }
    for (let i = 0; i < 18; i++) { const x = r() * w, y = r() * h, rr = 30 + r() * 90; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(${r() > .5 ? '40,38,30' : '200,198,186'},${.06 + r() * .08})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    const foot = ctx.createLinearGradient(0, h * .6, 0, h); foot.addColorStop(0, 'rgba(0,0,0,0)'); foot.addColorStop(1, `rgba(16,18,14,${damp})`); ctx.fillStyle = foot; ctx.fillRect(0, h * .6, w, h * .4);
    ctx.strokeStyle = 'rgba(20,20,18,.35)'; ctx.lineWidth = 1.2; for (let i = 0; i < 4; i++) { let x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - .5) * 50; y += r() * 35; ctx.lineTo(x, y); } ctx.stroke(); }
  });
  const concrete = material('#ffffff', { map: concreteTex(301), roughness: .95 });
  const concreteDark = material('#ffffff', { map: concreteTex(302, '#4f524c', .45), roughness: .97 });
  const rebar = material('#5b3d28', { metalness: .55, roughness: .75 });
  // Rubble: low-poly lumps with their shared vertices pushed about, so the pieces read as broken concrete, not boxes.
  const rock = (size, pos, seed, mat = concrete, parent = stairwell) => {
    const geo = new THREE.IcosahedronGeometry(1, 1); const pos3 = geo.attributes.position; const r = seeded(seed); const moved = new Map();
    for (let k = 0; k < pos3.count; k++) { const key = `${pos3.getX(k).toFixed(3)},${pos3.getY(k).toFixed(3)},${pos3.getZ(k).toFixed(3)}`; if (!moved.has(key)) moved.set(key, .65 + r() * .55); const f = moved.get(key); pos3.setXYZ(k, pos3.getX(k) * f, pos3.getY(k) * f * .7, pos3.getZ(k) * f); }
    geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat); m.scale.set(...size); m.position.copy(V(pos)); m.rotation.set(r() * 3, r() * 3, r() * 3); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  // The stair core seen through the opening: cast-concrete side walls up to a dark ceiling, a slab floor at room level.
  // Group frame: x across the flight (1.6 m), y up, -z away from the room into the stairwell.
  for (const x of [-.86, .86]) box([.12, 3.6, 3.95], [x, 1.8, -1.975], material('#ffffff', { map: concreteTex(303 + (x > 0 ? 1 : 0), '#6d716a', .35), roughness: .95 }), stairwell);
  { const tex = concreteTex(305, '#5c5f58', .15); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 5); box([1.6, .1, 3.95], [0, -.052, -1.975], material('#ffffff', { map: tex, roughness: .97 }), stairwell); }                                    // stairwell floor slab, flush with the room
  box([1.72, .12, 3.95], [0, 3.6, -1.975], concreteDark, stairwell);                                    // ceiling
  box([1.6, 3.6, .12], [0, 1.8, -3.95], concreteDark, stairwell);                                    // back wall at the turn (stays inside the x=8 wall: the experience room is behind it)
  // The flight: 18 cm risers, 28 cm goings. Steps 0–3 collapsed; 4 and up still stand on a cast waist slab.
  const RISE = .18, GO = .28, Z0 = -.55, stepTop = k => RISE * (k + 1), stepZ = k => Z0 - GO * k - GO / 2;
  const nosing = material('#2b2d2a', { roughness: .8 }), steelNose = material('#6b6e68', { metalness: .7, roughness: .45 });
  for (let k = 4; k < 12; k++) {
    const top = stepTop(k), z = stepZ(k);
    box([1.6, top, GO], [0, top / 2, z], concrete, stairwell);                                          // solid step down to the slab: no gaps under the flight
    box([1.6, .012, .035], [0, top + .006, z + GO / 2 - .02], steelNose, stairwell);                   // anti-slip nosing strip
    box([1.6, .03, .012], [0, top - .015, z + GO / 2 - .002], nosing, stairwell);                       // rubber on the riser lip
    if (k < 8) for (const dx of [-.68, .68]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(.2, .24), new THREE.MeshBasicMaterial({ map: dustPile(), transparent: true, opacity: .5, depthWrite: false })); d.rotation.x = -Math.PI / 2; d.position.set(dx, top + .002, z); stairwell.add(d); }
  }
  // The break: step 4 sheared off along a jagged face, the slab under it cracked open, rebar ends bent out of the concrete.
  { const z4 = stepZ(4) + GO / 2, r = seeded(318);
    for (let i = 0; i < 9; i++) rock([.07 + r() * .08, .06 + r() * .07, .05 + r() * .04], [-.7 + i * .175, .15 + r() * .7, z4 + .01], 318 + i);
    for (const [x, len, bend] of [[-.52, .3, .5], [-.18, .22, .9], [.14, .34, .35], [.48, .26, .7]]) { const bar = cylinder(.006, len, [x, .35 + r() * .3, z4 + len / 2 * Math.sin(bend)], rebar, stairwell, 6); bar.rotation.x = bend; } }
  // What came down: the four lost steps as broken blocks, heaped and tilted where they fell, with grit and smaller lumps round them.
  { const r = seeded(331);
    const blocks = [[[1.1, .2, .36], [-.12, .1, -.75], [.05, .25, -.1]], [[.8, .18, .3], [.32, .27, -.95], [.32, -.4, .18]], [[.62, .17, .28], [-.42, .32, -1.05], [-.45, .3, -.22]], [[.9, .19, .3], [.05, .5, -1.25], [.55, .1, .12]], [[.5, .16, .26], [.48, .12, -.45], [-.12, .7, .08]]];
    blocks.forEach(([size, pos, rot], bi) => { const b = box(size, pos, concrete, stairwell); b.rotation.set(...rot); const n = box([size[0] * .9, .014, .035], [-size[0] * .03, size[1] / 2 + .007, size[2] / 2 - .02], steelNose, b); n.castShadow = false;
      // the broken ends: jagged lumps standing proud of the cut, a corner gone, a stub of rebar out of each break
      for (const s of [-1, 1]) { for (let j = 0; j < 4; j++) rock([.04 + r() * .05, .05 + r() * .05, .05 + r() * .06], [s * (size[0] / 2 - .01), (r() - .5) * size[1] * .7, (r() - .5) * size[2] * .8], 380 + bi * 10 + j + (s > 0 ? 5 : 0), concrete, b); const bar = cylinder(.005, .12 + r() * .1, [s * (size[0] / 2 + .05), (r() - .5) * .05, (r() - .5) * size[2] * .5], rebar, b, 6); bar.rotation.z = Math.PI / 2 + (r() - .5) * .6; } });
    for (let i = 0; i < 22; i++) rock([.03 + r() * .1, .03 + r() * .07, .03 + r() * .09], [(r() - .5) * 1.45, .02 + r() * .05, -.25 - r() * 1.4], 360 + i);
    for (const [x, z, a] of [[-.3, -.5, .4], [.42, -1.3, -.7]]) { const bar = cylinder(.006, .45, [x, .03, z], rebar, stairwell, 6); bar.rotation.set(Math.PI / 2, 0, a); }
    const grit = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.9), new THREE.MeshBasicMaterial({ map: dustPile(), transparent: true, opacity: .95, depthWrite: false })); grit.rotation.x = -Math.PI / 2; grit.position.set(0, .003, -.95); stairwell.add(grit); }
  // Handrails: steel tube on wall brackets, following the pitch from step 4 up; the lower length bent down with the collapse.
  { const pitch = Math.atan2(RISE, GO), len = GO * 9 / Math.cos(pitch);
    for (const x of [-.75, .75]) {
      const y0 = stepTop(4) + .85, z0 = stepZ(4) + GO / 2, rail = cylinder(.022, len, [x, y0 + Math.sin(pitch) * len / 2, z0 - Math.cos(pitch) * len / 2], edgeMaterial, stairwell, 10); rail.rotation.x = Math.PI / 2 - pitch;
      for (let k = 0; k < 4; k++) { const d = .4 + k * .7, bz = z0 - Math.cos(pitch) * d, by = y0 + Math.sin(pitch) * d; box([.06, .02, .02], [x + Math.sign(x) * .04, by - .05, bz], edgeMaterial, stairwell); cylinder(.008, .05, [x, by - .03, bz], edgeMaterial, stairwell, 6); }
      if (x < 0) { const bent = cylinder(.022, .7, [x, y0 - .22, z0 + .26], edgeMaterial, stairwell, 10); bent.rotation.x = .75; } // torn off its bracket, hanging down
    } }
  // The old 2028 barrier: yellow-and-black rope tied to the left wall bracket, cut, the end lying in the rubble.
  { const ropeTex = canvasTexture(64, 16, (ctx, w, h) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#1c1c18' : '#c8a632'; ctx.beginPath(); ctx.moveTo(i * 8, 0); ctx.lineTo(i * 8 + 8, 0); ctx.lineTo(i * 8 + 2, h); ctx.lineTo(i * 8 - 6, h); ctx.fill(); } });
    const ropeMat = material('#ffffff', { map: ropeTex, roughness: 1 });
    const a = cylinder(.009, .62, [-.62, .82, -.32], ropeMat, stairwell, 6); a.rotation.set(.2, 0, 1.05);
    const b = cylinder(.009, .5, [-.3, .06, -.5], ropeMat, stairwell, 6); b.rotation.set(Math.PI / 2, 0, .5); }
  // The grille fitted after the 2029 accident, standing on step 5: newer paint, a frame bolted to both walls, bars, a hasp and a padlock on a chain.
  const grilleMat = material('#2f3638', { metalness: .6, roughness: .32 });
  const gz = stepZ(5), gy0 = stepTop(5), gy1 = 3.54;
  for (const x of [-.78, .78]) box([.05, gy1 - gy0, .05], [x, (gy0 + gy1) / 2, gz], grilleMat, stairwell);
  for (const y of [gy0 + .02, (gy0 + gy1) / 2, gy1 - .03]) box([1.6, .04, .04], [0, y, gz], grilleMat, stairwell);
  for (let k = 0; k < 13; k++) cylinder(.011, gy1 - gy0, [-.72 + k * .12, (gy0 + gy1) / 2, gz], grilleMat, stairwell, 8);
  for (const x of [-.8, .8]) for (const y of [gy0 + .15, gy1 - .2]) { box([.02, .1, .1], [x, y, gz], bareMetal, stairwell); }
  const lockY = gy0 + .75;
  box([.06, .08, .02], [.07, lockY + .1, gz + .04], bareMetal, stairwell);                                // hasp
  { const body = box([.07, .065, .03], [.07, lockY, gz + .06], material('#b08d3a', { metalness: .8, roughness: .3 }), stairwell); const shackle = new THREE.Mesh(new THREE.TorusGeometry(.024, .005, 6, 14, Math.PI), bareMetal); shackle.position.set(.07, lockY + .035, gz + .06); stairwell.add(shackle); body.rotation.z = .08; }
  for (let k = 0; k < 6; k++) { const link = new THREE.Mesh(new THREE.TorusGeometry(.012, .003, 5, 10), bareMetal); link.position.set(.07 + (k - 2.5) * .02, lockY + .1 - Math.abs(k - 2.5) * .012, gz + .05); link.rotation.y = k % 2 ? Math.PI / 2 : 0; stairwell.add(link); }
  const stairTag = sheet(label(['立入禁止', '下部崩落のため（2028.12）', '汐見市 施設管理課'], '#e9e5d6', '#a12a1f', 640, 300), [.5, .235], [-.35, lockY + .42, gz + .04], stairwell); // big enough to read from the doorway
  box([1.8, .12, .2], [0, 2.95, .02], darkMetal, stairwell);                                          // door head
  sheet(label(['非常階段'], '#bbc0a4', '#334936'), [.9, .2], [0, 3.12, .13], stairwell);
  const stairHit = proxy('stairs', [1.6, 2.8, .2], [0, 1.4, .08], stairwell);
  register('stairs', '非常階段', [stairHit], [3.8, 1.45, -.65], [2.5, 1.55, -.65], [4.8, 1.35, -.65]);
  interactables.get('stairs').paper = stairTag;
  interactables.set('floor', { position: V([2.6, 1.9, -.65]), target: V([5.0, 1.05, -.65]) }); // from before the threshold: the heap, the broken step and the grille above it in one frame

  // Wear and damage on the walls and floor. Each mark is a transparent decal with its own height map, so the torch rakes across it:
  // a chipped corner sits lower and throws a lip of shadow, a crack is a groove, not a drawn line.
  const decal = (paint, size, pos, { face = 'floor', opacity = 1, px = 512, seed = 1, bump = null, bumpScale = .012 } = {}) => {
    const ph = Math.round(px * size[1] / size[0]);
    const tex = canvasTexture(px, ph, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); paint(ctx, w, h, seeded(seed)); });
    const opts = { map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: .9 };
    if (bump) { opts.bumpMap = dataTexture(px, ph, (ctx, w, h) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); bump(ctx, w, h, seeded(seed)); }); opts.bumpScale = bumpScale; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(...size), new THREE.MeshStandardMaterial(opts));
    m.position.copy(V(pos)); m.userData.hitOnly = true; m.renderOrder = -5;
    if (face === 'floor') m.rotation.x = -Math.PI / 2; else if (face === 'ceiling') m.rotation.x = Math.PI / 2;
    else m.rotation.y = { east: -Math.PI / 2, west: Math.PI / 2, back: 0, front: Math.PI }[face];
    scene.add(m); return m;
  };
  // A crack as a path of short wandering segments, shared by the colour layer (a faint hairline) and the height layer (a groove).
  const crackPts = (x, y, steps, dx, dy, r) => { const pts = [[x, y]]; for (let k = 0; k < steps; k++) { x += dx + (r() - .5) * Math.abs(dx || dy) * 1.2; y += dy + (r() - .5) * Math.abs(dx || dy) * 1.2; pts.push([x, y]); } return pts; };
  const strokePts = (ctx, pts, width, style) => { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineJoin = ctx.lineCap = 'round'; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
  // A chip: an irregular polygon, filled with what is underneath, its rim a touch lighter where the broken edge catches light.
  const chipPts = (cx, cy, rad, r, n = 9) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2, d = rad * (.55 + r() * .6); return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * (.6 + r() * .5)]; });
  const fillPts = (ctx, pts, style) => { ctx.fillStyle = style; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); };
  // Floor in front of the stairs: tiles split by the impact, two corners broken out (screed below), grit fanned from the threshold.
  { const plan = seeded(401); const W = 512, H = Math.round(512 * 2.2 / 1.2);
    const chips = [chipPts(W * .9, H * .32, 46, plan), chipPts(W * .95, H * .7, 34, plan), chipPts(W * .72, H * .52, 14, plan, 7)];
    const cracks = [crackPts(W, H * .3, 9, -W * .05, 6, plan), crackPts(W, H * .55, 6, -W * .06, -4, plan), crackPts(W * .9, H * .7, 7, -W * .05, 10, plan), crackPts(W * .7, H * .52, 4, -W * .05, -12, plan)];
    decal((ctx, w, h, r) => {
      for (let i = 0; i < 1800; i++) { const d = r() * r(); ctx.fillStyle = `rgba(${r() > .5 ? '150,146,130' : '60,60,52'},${r() * .35})`; ctx.fillRect(w * (1 - d * .9), h * (.5 + (r() - .5) * (.35 + d * .6)), 1 + r() * 2, 1 + r() * 2); }
      for (const c of chips) { fillPts(ctx, c, 'rgba(104,104,96,.96)'); for (let i = 0; i < 140; i++) { const [x, y] = c[Math.floor(r() * c.length)]; ctx.fillStyle = `rgba(${r() > .5 ? '150,148,136' : '50,50,44'},.5)`; ctx.fillRect(x + (r() - .5) * 24, y + (r() - .5) * 24, 1.5, 1.5); } }
      for (const p of cracks) strokePts(ctx, p, 1, 'rgba(28,28,24,.32)');
    }, [1.2, 2.2], [3.3, .004, -.65], { seed: 401, bumpScale: .02, bump: (ctx) => {
      for (const c of chips) { fillPts(ctx, c, '#3a3a3a'); ctx.save(); ctx.translate(-2, -2); fillPts(ctx, c, '#9a9a9a'); ctx.restore(); fillPts(ctx, c, '#3c3c3c'); }
      for (const p of cracks) { strokePts(ctx, p, 3, '#5c5c5c'); strokePts(ctx, p, 1.4, '#2c2c2c'); }
    } });
    // Bits of the broken tiles, real thin pieces lying near the threshold.
    const tileBit = material('#a3a28c', { roughness: .7 });
    const r = seeded(405);
    for (let i = 0; i < 6; i++) { const s = new THREE.Shape(chipPts(0, 0, .02 + r() * .03, r, 6).map(([x, y]) => new THREE.Vector2(x, y))); const g = new THREE.ExtrudeGeometry(s, { depth: .005, bevelEnabled: false }); const m = new THREE.Mesh(g, tileBit); m.rotation.set(-Math.PI / 2 + (r() - .5) * .25, 0, r() * 6); m.position.set(3.45 + r() * .4, .004, -.65 + (r() - .5) * .9); m.castShadow = m.receiveShadow = true; scene.add(m); }
  }
  // The rest of the floor: two small chipped corners at tile joints, no drawn lines.
  { const plan = seeded(402); const chips = [chipPts(80, 30, 12, plan, 7), chipPts(560, 50, 9, plan, 6)];
    decal((ctx) => { for (const c of chips) fillPts(ctx, c, 'rgba(104,104,96,.9)'); }, [3, .4], [-.8, .004, 1.6], { seed: 402, px: 768, bumpScale: .015, bump: (ctx) => { for (const c of chips) fillPts(ctx, c, '#3a3a3a'); } }); }
  // An old dark spill on the floor under the window side.
  decal((ctx, w, h, r) => { const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(40,34,20,.35)'); g.addColorStop(.6, 'rgba(50,40,24,.2)'); g.addColorStop(.95, 'rgba(70,56,30,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * .48, h * .4, .3, 0, Math.PI * 2); ctx.fill(); }, [.9, .7], [-2.6, .004, -2.6], { seed: 403 });
  // East wall round the stair opening: plaster knocked off the edge in flakes (grey concrete under it, lower), a couple of fine cracks.
  for (const [z, side] of [[.42, 1], [-1.72, -1]]) {
    const plan = seeded(410 + (side > 0 ? 1 : 0)); const W = 160, H = 512, x0 = side > 0 ? 0 : W;
    const flakes = [0, 1, 2].map(k => { const top = H * (.22 + k * .2 + plan() * .06), bot = top + H * (.1 + plan() * .08); const pts = [[x0, top]]; for (let q = 0; q <= 6; q++) pts.push([x0 + side * W * (.12 + plan() * .3), top + (bot - top) * q / 6]); pts.push([x0, bot]); return pts; });
    const cracks = [crackPts(x0 + side * W * .3, H * .3, 6, side * W * .07, (plan() - .5) * 18, plan), crackPts(x0 + side * W * .25, H * .68, 5, side * W * .08, 10, plan)];
    decal((ctx, w, h, r) => {
      for (const f of flakes) { fillPts(ctx, f, 'rgba(84,86,80,.92)'); for (let i = 0; i < 120; i++) { const [x, y] = f[1 + Math.floor(r() * (f.length - 2))]; ctx.fillStyle = `rgba(${r() > .5 ? '170,168,154' : '46,48,42'},.45)`; ctx.fillRect(x + (r() - .5) * 10, y + (r() - .5) * 10, 1.5, 1.5); } }
      for (const p of cracks) strokePts(ctx, p, 1, 'rgba(30,32,28,.3)');
      const g = ctx.createLinearGradient(0, h * .82, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,20,16,.25)'); ctx.fillStyle = g; ctx.fillRect(0, h * .82, w, h * .18);
    }, [.5, 1.6], [3.922, .85, z], { face: 'east', seed: 410 + (side > 0 ? 1 : 0), px: W, bumpScale: .02, bump: (ctx) => { for (const f of flakes) { fillPts(ctx, f, '#9c9c9c'); ctx.save(); ctx.translate(-side * 3, 0); fillPts(ctx, f, '#383838'); ctx.restore(); } for (const p of cracks) strokePts(ctx, p, 2, '#3a3a3a'); } });
  }
  // West wall: where the camera monitor hung the paint is cleaner, with a soft edge (no outline); the screw holes are real holes with plugs.
  decal((ctx, w, h, r) => {
    const ghost = (x, y, gw, gh, a) => { for (let k = 0; k < 10; k++) { ctx.fillStyle = `rgba(150,158,146,${a / 10})`; ctx.fillRect(x - k, y - k, gw + k * 2, gh + k * 2); } };
    ghost(w * .1, h * .12, w * .55, h * .42, .3);
    for (const [x, y] of [[.16, .2], [.58, .2], [.16, .48], [.58, .48]]) { ctx.fillStyle = 'rgba(18,18,16,.9)'; ctx.beginPath(); ctx.arc(w * x, h * y, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(200,190,160,.6)'; ctx.beginPath(); ctx.arc(w * x, h * y, 2.2, 0, Math.PI * 2); ctx.fill(); }
    ghost(w * .62, h * .62, w * .3, h * .3, .22);                                                       // a notice ghost (the tape is real, below)
  }, [1.1, 1.4], [-3.922, 2.2, .4], { face: 'west', seed: 420, bumpScale: .01, bump: (ctx, w, h) => { for (const [x, y] of [[.16, .2], [.58, .2], [.16, .48], [.58, .48]]) { ctx.fillStyle = '#202020'; ctx.beginPath(); ctx.arc(w * x, h * y, 5, 0, Math.PI * 2); ctx.fill(); } } });
  // Back wall: a brown water stain coming down from the ceiling in the corner, tide lines and a drip run.
  decal((ctx, w, h, r) => {
    for (let k = 0; k < 4; k++) { const g = ctx.createRadialGradient(w * .6, 0, 0, w * .6, 0, w * (.55 - k * .1)); g.addColorStop(.8, `rgba(110,80,40,${.06 + k * .04})`); g.addColorStop(.92, `rgba(90,62,30,${.18 + k * .05})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    ctx.strokeStyle = 'rgba(90,64,34,.35)'; ctx.lineCap = 'round'; for (let k = 0; k < 3; k++) { let x = w * (.5 + r() * .2), y = h * .4; ctx.lineWidth = 3 + r() * 3; ctx.beginPath(); ctx.moveTo(x, y); for (let q = 0; q < 10; q++) { x += (r() - .5) * 4; y += h * .05; ctx.lineTo(x, y); } ctx.stroke(); }
  }, [1.2, 1.8], [3.25, 3.0, -3.518], { face: 'back', seed: 430 }); // on the pier east of the storage door, not across its opening
  // Front wall behind the chairs: soft grey rubs where chair backs knocked the wall, a little paint worn through in each.
  decal((ctx, w, h, r) => {
    for (let i = 0; i < 3; i++) { const cx = w * (.17 + i * .33), cy = h * (.5 + (r() - .5) * .1);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * .12); g.addColorStop(0, 'rgba(36,40,34,.16)'); g.addColorStop(.7, 'rgba(36,40,34,.05)'); g.addColorStop(1, 'rgba(36,40,34,0)'); ctx.save(); ctx.translate(cx, cy); ctx.scale(1, .28); ctx.translate(-cx, -cy); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, w * .12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      for (let k = 0; k < 40; k++) { ctx.fillStyle = `rgba(${r() > .4 ? '120,124,112' : '40,42,36'},${r() * .22})`; ctx.fillRect(cx + (r() - .5) * w * .14, cy + (r() - .5) * h * .3, 1 + r() * 2, 1); } }
  }, [1.9, .4], [-2.1, .9, 4.823], { face: 'front', seed: 440, bumpScale: .006, bump: (ctx, w, h, r) => { for (let i = 0; i < 300; i++) { ctx.fillStyle = r() > .5 ? '#707070' : '#909090'; ctx.fillRect(r() * w, h * .3 + r() * h * .4, 2, 1); } } });
  // Trolley and boot scuffs where things actually pass: both sides of the storage doorway (a cart's rubber bumper at 10–35 cm,
  // the corner of the frame chipped), the waiting-room side of the service door, and the passage corner where carts turn west.
  const rubberScuffs = (ctx, w, h, r, { lo = .55, hi = .95, n = 16, side = 0 } = {}) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) { const x = side ? (side > 0 ? w * (.55 + r() * .45) : w * r() * .45) : r() * w, y = h * (lo + r() * (hi - lo)), len = 12 + r() * 60; ctx.strokeStyle = `rgba(14,14,12,${.18 + r() * .3})`; ctx.lineWidth = 1.5 + r() * 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len * (r() > .5 ? 1 : -1), y + (r() - .5) * 6); ctx.stroke(); }
    for (let i = 0; i < 6; i++) { const x = r() * w, y = h * (lo + r() * (hi - lo)); fillPts(ctx, chipPts(x, y, 4 + r() * 7, r, 7), 'rgba(150,150,138,.7)'); } // paint knocked off to the primer
  };
  for (const [x, w0, side] of [[.84, .26, 1], [2.68, .3, -1]]) decal((ctx, w, h, r) => rubberScuffs(ctx, w, h, r, { lo: .3, hi: .9, n: 22, side }), [w0, .5], [x, .25, -3.523], { face: 'back', seed: 470 + Math.round(x * 10), bumpScale: .006, bump: (ctx, w, h, r) => { for (let i = 0; i < 6; i++) fillPts(ctx, chipPts(r() * w, h * (.3 + r() * .6), 5, r, 7), '#606060'); } });
  decal((ctx, w, h, r) => rubberScuffs(ctx, w, h, r, { lo: .5, hi: .95, n: 12, side: 1 }), [.24, .4], [-.86, .2, -3.523], { face: 'back', seed: 480 });
  decal((ctx, w, h, r) => rubberScuffs(ctx, w, h, r, { lo: .35, hi: .95, n: 26 }), [.6, .5], [-2.554, .25, -6.55], { face: 'west', seed: 481 });   // west wall of the passage, at the turn
  decal((ctx, w, h, r) => rubberScuffs(ctx, w, h, r, { lo: .5, hi: .95, n: 30 }), [2.2, .4], [-.946, .2, -5.4], { face: 'east', seed: 482 });   // east wall of the passage: a long low line of cart scrapes
  decal((ctx, w, h, r) => rubberScuffs(ctx, w, h, r, { lo: .3, hi: .9, n: 14 }), [.5, .45], [8.085, .25, 2.45], { face: 'west', seed: 483 });   // experience room, beside the entry door
  decalLater.forEach(f => f());
  // The arc the entrance door's bottom edge scuffed into the tiles over the years it swung open to its release (hinge at x 0.93).
  decal((ctx, w, h, r) => {
    ctx.lineCap = 'round';
    for (let k = 0; k < 8; k++) { const rad = w * (.42 + r() * .06); ctx.strokeStyle = `rgba(${r() > .5 ? '30,32,26' : '205,200,180'},${.07 + r() * .12})`; ctx.lineWidth = .8 + r() * 1.8; ctx.beginPath(); ctx.arc(w / 2, h, rad, Math.PI + .12 + r() * .2, Math.PI * 2 - .12 - r() * .2); ctx.stroke(); }
  }, [1.96, .98], [.93, .004, 4.33], { seed: 490 });
  // Tape left from a notice that was torn down: each corner went differently. Strips torn across with paper fibres still stuck on,
  // a stub, a corner peeled half off and curling, and a bare patch of old glue that has caught the dust. Real thin pieces on the wall.
  const tapeTexture = (kind, seed) => canvasTexture(256, 160, (ctx, w, h) => {
    const r = seeded(seed); ctx.clearRect(0, 0, w, h);
    const x0 = w * .12, x1 = w * .88, y0 = h * .3, y1 = h * .7;
    // where earlier tape was and came away: a grimy outline of glue, a little offset from the tape on top
    const gx = x0 - 6 + r() * 12, gy = y0 - 4 + r() * 8; ctx.fillStyle = 'rgba(70,62,44,.16)'; ctx.fillRect(gx, gy, x1 - x0, y1 - y0);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(36,32,24,${.1 + r() * .25})`; const e = r(); const px = e < .5 ? gx + r() * (x1 - x0) : gx + (r() > .5 ? 0 : x1 - x0) + (r() - .5) * 3; const py = e < .5 ? gy + (r() > .5 ? 0 : y1 - y0) + (r() - .5) * 3 : gy + r() * (y1 - y0); ctx.fillRect(px, py, 1 + r() * 2, 1 + r() * 2); }
    if (kind === 'glue') return;
    const left = kind === 'stub' ? w * .5 : x0;
    const outline = [];
    for (let i = 0; i <= 10; i++) outline.push([left + (x1 - left) * i / 10, y0 + (r() - .5) * 1.5]);                       // long edge: cut straight by the roll
    for (let i = 1; i <= 7; i++) outline.push([x1 - r() * 14, y0 + (y1 - y0) * i / 7]);                                    // torn end: ragged
    for (let i = 10; i >= 0; i--) outline.push([left + (x1 - left) * i / 10, y1 + (r() - .5) * 1.5]);
    for (let i = 6; i >= 1; i--) outline.push([left + r() * 12, y0 + (y1 - y0) * i / 7]);                                 // the other torn end
    const path = () => { ctx.beginPath(); outline.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
    path(); ctx.fillStyle = kind === 'cello' ? 'rgba(196,164,92,.5)' : 'rgba(206,192,152,.94)'; ctx.fill();               // aged cellophane, or masking tape
    if (kind !== 'cello') { ctx.save(); path(); ctx.clip(); for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '230,220,190' : '150,136,100'},${r() * .25})`; ctx.fillRect(r() * w, r() * h, 2 + r() * 4, 1); } ctx.restore(); }
    // poster paper still stuck to half the strip, torn off in a fibrous edge
    if (kind !== 'stub') { ctx.save(); path(); ctx.clip(); ctx.fillStyle = 'rgba(236,232,218,.9)'; ctx.beginPath(); const mx = w * (.45 + r() * .1); ctx.moveTo(x1 + 5, y0 - 5); ctx.lineTo(mx, y0 - 5); for (let i = 0; i <= 12; i++) ctx.lineTo(mx + (r() - .5) * 18, y0 + (y1 - y0) * i / 12); ctx.lineTo(x1 + 5, y1 + 5); ctx.fill();
      for (let i = 0; i < 60; i++) { ctx.strokeStyle = `rgba(236,232,218,${.4 + r() * .4})`; ctx.lineWidth = .6; const y = y0 + r() * (y1 - y0); ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx - 3 - r() * 9, y + (r() - .5) * 4); ctx.stroke(); }
      ctx.restore(); }
    path(); ctx.strokeStyle = 'rgba(44,38,26,.4)'; ctx.lineWidth = 1.6; ctx.stroke();                                         // dust caught in the glue along every edge
  });
  const tapeOnWall = (kind, seed, y, z, angle, size = [.08, .05], lift = 0) => {
    const g = new THREE.Group(); g.position.set(-3.917, y, z); g.rotation.set(0, Math.PI / 2, 0); scene.add(g);
    const flat = new THREE.Mesh(new THREE.PlaneGeometry(...size), material('#ffffff', { map: tapeTexture(kind, seed), transparent: true, depthWrite: false, roughness: kind === 'cello' ? .35 : .9, polygonOffset: true, polygonOffsetFactor: -4 }));
    flat.rotation.z = angle; flat.renderOrder = -4; flat.userData.hitOnly = true; g.add(flat);
    if (lift) { // the free end has let go of the wall and curls out: a short piece hinged on its edge, with its own little shadow on the wall
      const hinge = new THREE.Group(); hinge.rotation.z = angle; g.add(hinge);
      const pivot = new THREE.Group(); pivot.position.set(size[0] * .32, 0, .001); pivot.rotation.y = -lift; hinge.add(pivot);
      const tab = new THREE.Mesh(new THREE.PlaneGeometry(size[0] * .26, size[1] * .5), material(kind === 'cello' ? '#c8aa66' : '#cfc19a', { roughness: .85, side: THREE.DoubleSide, transparent: kind === 'cello', opacity: kind === 'cello' ? .6 : 1 }));
      tab.position.x = size[0] * .13; tab.castShadow = true; pivot.add(tab);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(size[0] * .3, size[1] * .55), new THREE.MeshBasicMaterial({ map: dustSprite(), color: '#000000', transparent: true, opacity: .35, depthWrite: false }));
      sh.position.set(size[0] * .36, -.004, .0005); hinge.add(sh);
    }
  };
  tapeOnWall('mask', 501, 2.03, .268, -.7);
  tapeOnWall('mask', 502, 2.03, -.062, .72, [.08, .05], .7);
  tapeOnWall('stub', 503, 1.61, .268, .68);
  tapeOnWall('glue', 504, 1.61, -.062, -.66);
  tapeOnWall('cello', 505, 1.83, -.07, .05, [.06, .04]);
  { const hit = proxy('tape', [.04, .5, .5], [-3.9, 1.82, .1]); register('tape', '剥がした貼り紙の跡', [hit], [-3.9, 1.82, .1], [-3.3, 1.85, .1], [-3.92, 1.82, .1]); }
  // Ceiling: the same leak seen from below, a sagging stained tile.
  decal((ctx, w, h, r) => { for (let k = 0; k < 3; k++) { const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * (.45 - k * .12)); g.addColorStop(.75, `rgba(120,90,46,${.08 + k * .05})`); g.addColorStop(.9, `rgba(96,68,32,${.22 + k * .05})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); } }, [1.1, 1.1], [2.6, 3.932, -2.9], { face: 'ceiling', seed: 450 });
  // Building services the room would have: a fire bell and call point, a smoke detector and sprinkler heads, a supply grille,
  // outlet and switch plates, a capped-off cable where the camera monitor was.
  { const bell = cylinder(.09, .05, [.83, 2.35, -3.5], material('#b3261e', { metalness: .4, roughness: .45 }), scene, 20); bell.rotation.x = Math.PI / 2; cylinder(.025, .03, [.83, 2.35, -3.47], bareMetal, scene, 10).rotation.x = Math.PI / 2;
    box([.12, .12, .04], [.83, 1.5, -3.5], material('#c22a20', { roughness: .5 })); box([.07, .07, .01], [.83, 1.5, -3.475], material('#e8e2d2', { roughness: .4 }));
    sheet(label(['火災報知機'], '#c22a20', '#ffffff', 256, 64), [.14, .035], [.83, 1.62, -3.522]); }
  { const det = cylinder(.065, .03, [-.6, 3.92, .9], material('#e6e3d8', { roughness: .5 }), scene, 20); cylinder(.02, .006, [-.6, 3.902, .9], material('#c33'), scene, 8); }
  for (const [x, z] of [[-2, -1.5], [2, 2.5], [-2, 2.5]]) { cylinder(.03, .02, [x, 3.93, z], bareMetal, scene, 10); cylinder(.012, .04, [x, 3.9, z], material('#c9a23a', { metalness: .7, roughness: .3 }), scene, 8); }
  { const grille = canvasTexture(256, 256, (ctx, w, h) => { ctx.fillStyle = '#d2d0c6'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#3a3c38'; for (let y = 24; y < h - 20; y += 14) ctx.fillRect(24, y, w - 48, 7); ctx.fillStyle = 'rgba(40,36,28,.35)'; for (let y = 24; y < h - 20; y += 14) ctx.fillRect(24, y - 2, w - 48, 2); });
    const g2 = box([.5, .02, .5], [1.5, 3.93, 1.0], material('#ffffff', { map: grille, roughness: .6 })); }
  for (const [x, y, z, face] of [[-3.925, .3, -2.2, 'west'], [-3.925, .3, 3.0, 'west'], [3.925, .3, 2.2, 'east'], [.3, .3, -3.52, 'back']]) { // (the back-wall outlet sits on the pier under the map, not in the service doorway)
    const plate = box(face === 'back' ? [.08, .12, .01] : [.01, .12, .08], [x, y, z], material('#e7e4da', { roughness: .45 }));
    for (const dy of [.025, -.025]) box(face === 'back' ? [.025, .012, .012] : [.012, .012, .025], [x + (face === 'west' ? .006 : face === 'east' ? -.006 : 0), y + dy, z + (face === 'back' ? .006 : 0)], material('#2a2a28'));
  }
  { const capped = cylinder(.012, .12, [-3.9, 2.75, .2], material('#1f2924'), scene, 6); box([.03, .03, .03], [-3.89, 2.69, .2], material('#c9b23a')); } // the monitor's cable, cut and taped
  // Quiet dressing gives the room a history without interface labels.
  const calendar = paperSheet(calendarTexture(2030, 11, { 6: '巡回', 13: '巡回', 20: '巡回', 27: '巡回' }), [.46, .66], [3.912, 2.1, 3.35], scene, { pins: true, curl: .012 });
  calendar.rotation.y = -Math.PI / 2; // east wall, above the crate (the south wall now has the door and its notice)
  // The waiting seats along the south wall: three upholstered chairs, vinyl over foam with soft rounded edges, on thin steel tube
  // legs with side rails. The third one's seat has split at the front edge and the yellowed foam shows through (待合のいす).
  const vinyl = material('#4f685d', { roughness: .42, metalness: 0 }), vinylDark = material('#3c5248', { roughness: .5 });
  const tube = material('#9ea4a0', { metalness: .8, roughness: .32 });
  for (let i = 0; i < 3; i++) {
    const cx = -2.7 + i * .6;
    rbox([.46, .07, .44], [cx, .455, 4.2], vinyl, scene, .028);                                  // seat cushion
    box([.44, .012, .42], [cx, .414, 4.2], material('#2b302d', { roughness: .7 }));              // seat pan under it
    box([.4, .004, .006], [cx, .49, 3.995], vinylDark);                                          // welt along the front edge
    const back = rbox([.46, .34, .06], [cx, .79, 4.45], vinyl, scene, .024); back.rotation.x = .1; // back cushion, leaning back toward the wall
    for (const [x, z] of [[-.2, 4.01], [.2, 4.01], [-.2, 4.39], [.2, 4.39]]) { cylinder(.0105, .41, [cx + x, .205, z], tube, scene, 10); const foot = cylinder(.014, .012, [cx + x, .006, z], material('#1d201e', { roughness: .8 }), scene, 10); foot.castShadow = false; contactShadow([.07, .07], [cx + x, .002, z], { opacity: .6 }); }
    for (const x of [-.2, .2]) {
      const rail = cylinder(.009, .38, [cx + x, .12, 4.2], tube, scene, 8); rail.rotation.x = Math.PI / 2;
      const link = cylinder(.009, .11, [cx + x, .415, 4.44], tube, scene, 8); link.rotation.x = Math.PI / 2;            // rear leg top → behind the back cushion, under the seat
      const up = cylinder(.009, .55, [cx + x, .685, 4.513], tube, scene, 8); up.rotation.x = .1;                          // the back post, on the wall side of the cushion, same lean
    }
    box([.4, .012, .012], [cx, .82, 4.527], tube);                                                                       // cross bar the back cushion is screwed to, behind it
    contactShadow([.56, .54], [cx, .0025, 4.2], { opacity: .38 });
  }
  { const cx = -1.5; // the split seat: a slit along the front edge, the vinyl lips lifted, foam bulging out of it
    box([.15, .004, .016], [cx + .07, .4915, 4.0], material('#1a1d1a', { roughness: 1 }));
    const foam = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), material('#d2bf86', { roughness: 1 })); foam.scale.set(.085, .022, .026); foam.position.set(cx + .07, .492, 3.998); scene.add(foam);
    for (let k = 0; k < 9; k++) { const crumb = box([.006, .004, .006], [cx + .01 + k * .016, .493, 3.993 + (k % 3) * .004], material('#c8b47a', { roughness: 1 })); crumb.castShadow = false; } // foam crumbs at the split
    for (const [dz, rx] of [[-.012, -.5], [.012, .45]]) { const lip = new THREE.Mesh(new THREE.PlaneGeometry(.15, .018), material('#4f685d', { roughness: .42, side: THREE.DoubleSide })); lip.position.set(cx + .07, .494, 4.0 + dz); lip.rotation.set(-Math.PI / 2 + rx, 0, 0); scene.add(lip); }
  }
  box([.52, .5, .52], [3.1, .25, 3.7], material('#655d49'));
  box([.45, .37, .47], [3.15, .68, 3.7], material('#7d7054'));

  // Facility poster: points the player to the real facility website.
  const posterTexture = canvasTexture(1024, 1448, (ctx, w, h) => {
    const S2 = w / 512; const JP = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif'; const MIN2 = '"Hiragino Mincho ProN","Yu Mincho",serif';
    // A3 coated paper, a little yellowed, faded more at the top where the light hit it for two years.
    ctx.fillStyle = '#f2efe4'; ctx.fillRect(0, 0, w, h);
    const fade = ctx.createLinearGradient(0, 0, 0, h); fade.addColorStop(0, 'rgba(220,206,160,.22)'); fade.addColorStop(.5, 'rgba(220,206,160,.08)'); fade.addColorStop(1, 'rgba(120,110,80,.12)'); ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
    const r = seeded(77); for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '120,110,80' : '255,255,250'},${r() * .05})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
    // Header: the city's green band with the emblem, the facility name and a thin rule.
    ctx.fillStyle = '#2f6b55'; ctx.fillRect(0, 0, w, 250);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, 230, w, 20);
    ctx.strokeStyle = '#e9efe6'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(110, 125, 52, 0, Math.PI * 2); ctx.stroke();      // city emblem: a ring with a wave
    ctx.beginPath(); ctx.moveTo(72, 135); ctx.quadraticCurveTo(92, 105, 112, 135); ctx.quadraticCurveTo(132, 165, 150, 128); ctx.stroke();
    ctx.fillStyle = '#e9efe6'; ctx.textAlign = 'left'; ctx.font = `700 ${34 * S2}px ${JP}`; ctx.fillText('汐見センター', 190, 120);
    ctx.font = `500 ${18 * S2}px ${JP}`; ctx.fillText('ご利用のみなさまへ', 194, 190);
    ctx.font = `500 ${11 * S2}px ${JP}`; ctx.textAlign = 'right'; ctx.fillText('汐見市', w - 50, 70);
    // Three numbered items, each in a ruled box with a small pictogram.
    const items = [
      ['お知らせ・臨時休館', ['最新のお知らせ・臨時休館は', '公式サイトをご確認ください。'], 'web'],
      ['番号錠・設備の点検', ['番号錠の変更・設備の点検は', '設備係（内線 204）まで。'], 'key'],
      ['工事・閉鎖のお知らせ', ['工事中・閉鎖中の場所は、', 'その扉にお知らせを掲示します。', '掲示の日付をご確認ください。'], 'sign']
    ];
    let y = 300;
    items.forEach(([head, lines, icon], k) => {
      const bh = 70 + lines.length * 46;
      ctx.strokeStyle = '#2f6b55'; ctx.lineWidth = 3; ctx.strokeRect(60, y, w - 120, bh);
      ctx.fillStyle = '#2f6b55'; ctx.fillRect(60, y, 74, bh);
      ctx.fillStyle = '#f2efe4'; ctx.textAlign = 'center'; ctx.font = `700 ${22 * S2}px ${JP}`; ctx.fillText(String(k + 1), 97, y + bh / 2 + 16);
      // pictogram
      ctx.strokeStyle = '#2f6b55'; ctx.lineWidth = 5; const ix = w - 130, iy = y + 22;
      if (icon === 'web') { ctx.strokeRect(ix, iy, 56, 40); ctx.beginPath(); ctx.moveTo(ix, iy + 10); ctx.lineTo(ix + 56, iy + 10); ctx.stroke(); }
      if (icon === 'key') { ctx.beginPath(); ctx.arc(ix + 14, iy + 20, 12, 0, Math.PI * 2); ctx.moveTo(ix + 26, iy + 20); ctx.lineTo(ix + 58, iy + 20); ctx.moveTo(ix + 48, iy + 20); ctx.lineTo(ix + 48, iy + 32); ctx.stroke(); }
      if (icon === 'sign') { ctx.strokeRect(ix + 4, iy, 48, 30); ctx.beginPath(); ctx.moveTo(ix + 28, iy + 30); ctx.lineTo(ix + 28, iy + 50); ctx.moveTo(ix + 14, iy + 15); ctx.lineTo(ix + 40, iy + 15); ctx.lineTo(ix + 32, iy + 8); ctx.stroke(); }
      ctx.fillStyle = '#1f2a24'; ctx.textAlign = 'left'; ctx.font = `700 ${17 * S2}px ${JP}`; ctx.fillText(head, 160, y + 50);
      ctx.fillStyle = '#2b332e'; ctx.font = `500 ${15 * S2}px ${JP}`; lines.forEach((l, q) => ctx.fillText(l, 160, y + 100 + q * 46));
      y += bh + 30;
    });
    // A real-looking QR: 25 modules, three finder squares, timing rows, seeded data.
    const N = 25, cell = 9.5, qx = w / 2 - N * cell / 2 - 120, qy = y + 20;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(qx - 20, qy - 20, N * cell + 40, N * cell + 40);
    const q = seeded(91); ctx.fillStyle = '#151a17';
    const finder = (fx, fy) => { ctx.fillRect(qx + fx * cell, qy + fy * cell, 7 * cell, 7 * cell); ctx.fillStyle = '#ffffff'; ctx.fillRect(qx + (fx + 1) * cell, qy + (fy + 1) * cell, 5 * cell, 5 * cell); ctx.fillStyle = '#151a17'; ctx.fillRect(qx + (fx + 2) * cell, qy + (fy + 2) * cell, 3 * cell, 3 * cell); };
    for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) { const inF = (xx < 8 && yy < 8) || (xx > N - 9 && yy < 8) || (xx < 8 && yy > N - 9); if (inF) continue; const on = yy === 6 ? xx % 2 === 0 : xx === 6 ? yy % 2 === 0 : q() > .52; if (on) ctx.fillRect(qx + xx * cell, qy + yy * cell, cell, cell); }
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    ctx.fillRect(qx + 16 * cell, qy + 16 * cell, 5 * cell, 5 * cell); ctx.fillStyle = '#ffffff'; ctx.fillRect(qx + 17 * cell, qy + 17 * cell, 3 * cell, 3 * cell); ctx.fillStyle = '#151a17'; ctx.fillRect(qx + 18 * cell, qy + 18 * cell, cell, cell);
    ctx.fillStyle = '#1f2a24'; ctx.textAlign = 'left'; ctx.font = `700 ${14 * S2}px ${JP}`; ctx.fillText('公式サイト', qx + N * cell + 50, qy + 40);
    ctx.font = `500 ${12 * S2}px "SF Mono","Menlo",monospace`; ctx.fillText('shiomi-center', qx + N * cell + 50, qy + 100); ctx.fillText('.example', qx + N * cell + 50, qy + 140);
    ctx.font = `500 ${11 * S2}px ${JP}`; ctx.fillStyle = '#4b544e'; ctx.fillText('スマートフォンで', qx + N * cell + 50, qy + 200); ctx.fillText('読み取れます', qx + N * cell + 50, qy + 236);
    // Footer: issuer, date, and the posting stamp.
    ctx.fillStyle = '#2f6b55'; ctx.fillRect(0, h - 110, w, 4);
    ctx.fillStyle = '#2b332e'; ctx.textAlign = 'left'; ctx.font = `500 ${12 * S2}px ${JP}`; ctx.fillText('汐見市 施設管理課　2028年6月 掲示', 60, h - 50);
    ctx.save(); ctx.translate(w - 150, h - 64); ctx.rotate(-.12); ctx.strokeStyle = 'rgba(178,40,32,.7)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(178,40,32,.7)'; ctx.textAlign = 'center'; ctx.font = `700 ${10 * S2}px ${MIN2}`; ctx.fillText('掲示', 0, -4); ctx.font = `500 ${7 * S2}px ${MIN2}`; ctx.fillText('施設管理課', 0, 22); ctx.restore();
    // Wear: a horizontal fold line, a damp ripple at the bottom edge, pin holes, a torn-off corner, a ballpoint tick.
    ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(0, h * .5 - 2, w, 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, h * .5, w, 2);
    const ripple = ctx.createLinearGradient(0, h - 60, 0, h); ripple.addColorStop(0, 'rgba(0,0,0,0)'); ripple.addColorStop(1, 'rgba(120,100,60,.22)'); ctx.fillStyle = ripple; ctx.fillRect(0, h - 60, w, 60);
    for (const [x, yy] of [[40, 40], [w - 40, 40], [40, h - 40]]) { ctx.fillStyle = 'rgba(30,26,20,.6)'; ctx.beginPath(); ctx.arc(x, yy, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.moveTo(w, h - 70); ctx.lineTo(w - 70, h); ctx.lineTo(w, h); ctx.fill(); ctx.fillStyle = '#d6cfb8'; ctx.beginPath(); ctx.moveTo(w, h - 64); ctx.lineTo(w - 64, h); ctx.lineTo(w - 64, h - 64); ctx.fill(); // a dog-eared corner folded forward
    ctx.strokeStyle = 'rgba(30,50,140,.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w - 150, 540); ctx.lineTo(w - 138, 556); ctx.lineTo(w - 112, 520); ctx.stroke();
  });
  const poster = paperSheet(posterTexture, [.5, .7], [-3.25, 1.95, -3.512], scene, { tape: true }); // north wall, left of the service door
  register('poster', '壁のポスター', [poster], [-3.25, 1.95, -3.45], [-3.25, 1.9, -2.7], [-3.25, 1.95, -3.52]);
  // What the room was for: a waiting room for the drill. A row of linked seats against the front wall (one vinyl seat split),
  // the old "wait here" notice above them, a dead call-number display and a box of numbered tags. Desk and shelf came later.
  { const x0 = -2.1;
    const seatsHit = proxy('waitseats', [1.85, .95, .62], [-2.1, .5, 4.24]);
    const sign = sheet(label(['体験の順番が来るまで', 'こちらでお待ちください', '汐見市 防災学習センター'], '#ddd8c4', '#3c4a42', 640, 300), [.56, .26], [x0, 1.62, 4.811]);
    sign.rotation.y = Math.PI; sign.rotation.z = .025;
    const callBoard = box([.62, .2, .06], [x0, 2.32, 4.78], material('#1c201e', { roughness: .4 }));
    const glass = sheet(label(['- -'], '#141816', '#2c3430', 512, 160), [.5, .13], [x0, 2.32, 4.748]); glass.rotation.y = Math.PI;
    const plate = sheet(label(['お呼び出し番号'], '#cfcab6', '#3c4a42', 512, 112), [.34, .075], [x0, 2.17, 4.811]); plate.rotation.y = Math.PI;
    const tagBox = box([.2, .26, .09], [-1.55, 1.52, 4.76], material('#c9c3ad', { roughness: .8 }));
    const tagLabel = sheet(label(['番号札', 'お取りください'], '#c9c3ad', '#3c4a42', 320, 200), [.17, .1], [-1.55, 1.59, 4.714]); tagLabel.rotation.y = Math.PI;
    for (let k = 0; k < 3; k++) { const tg = box([.05, .07, .004], [-1.6 + k * .05, 1.43 + (k % 2) * .004, 4.711], material('#e8e2c8', { roughness: .8 })); tg.rotation.z = (k - 1) * .08; } // a few numbered tags still in the slot
    register('waitseats', '待合のいす', [seatsHit], [x0, .85, 4.2], [-1.95, 1.4, 3.05], [-1.95, .6, 4.3]); // framed toward the split seat on the right
    register('waitsign', '待合の掲示', [sign, callBoard, glass, plate, tagBox, tagLabel], [x0, 1.62, 4.74], [x0 + .25, 1.8, 3.55], [x0 + .25, 1.85, 4.8]);
  }
  // Things that are just there: a room has more in it than the puzzle needs.
  register('extinguisher', '消火器', [extinguisher, extTop], [3.2, .34, -3.22], [2.3, .9, -2.4], [3.2, .5, -3.3]);
  register('clock', '壁の時計', [clock], [3.89, 3.0, 1.6], [2.7, 2.6, 1.6], [3.89, 3.0, 1.6]);
  { chair.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(chair), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
    const back = proxy('chair', [sz.x * .7, .13, sz.z * .7], [c.x, b.max.y - .065, c.z]); // the top of the backrest only: from where you stand, the drawer behind it stays tappable
    register('chair', '事務椅子', [back], [c.x, b.max.y - .06, c.z], [-1.3, 1.2, .9], [-2.35, .5, -.1]); }
  register('tube', '天井の蛍光灯', [ceilingTube], [0, 3.69, -.8], [0, 2.3, .6], [0, 3.69, -.8]);
  register('desklamp', '机のランプ', [shade], [-3.27, 1.36, 1.06], [-2.3, 1.5, 1.7], [-3.27, 1.3, 1.06]);
  register('boxes', '段ボールの山', [proxy('boxes', [1.5, 1.0, .6], [1.7, .5, -4.2])], [1.7, .7, -3.9], [1.7, 1.2, -3.0], [1.7, .5, -4.2]);

  const ruler = makeRuler(); ruler.position.set(-3.05, .8765, .12); ruler.rotation.y = Math.PI / 2 + .12; scene.add(ruler); // same model as in the bag
  register('ruler', '金属の定規', ruler.userData.meshes, [-3.1, .95, .14], [-2.3, 1.4, .12]);
  const magnet = makeMagnet(); magnet.scale.setScalar(1.9); magnet.rotation.x = Math.PI / 2; magnet.position.set(.48, 2.65, -3.45); scene.add(magnet); // stuck to the board, axis into the wall
  for (const [x, y, c] of [[.3, 2.65, '#2f8f4e'], [.39, 2.65, '#e3b92b']]) { const m2 = makeMagnet(c); m2.scale.setScalar(1.9); m2.rotation.x = Math.PI / 2; m2.position.set(x, y, -3.45); scene.add(m2); }
  register('magnet', '掲示板のマグネット', magnet.userData.meshes, [.48, 2.65, -3.3], [.4, 2.5, -2]);
  const fallenKey = makeKey(); fallenKey.scale.setScalar(1.5); fallenKey.position.set(-3.2, .003, -.83); fallenKey.rotation.set(0, .5, 0); scene.add(fallenKey); // brass key with its steel ring, deep in the gap under the drawer unit (~37 cm in from its front edge)
  const keyRing = fallenKey.userData.ring;
  // No glowing dot: a little stray light gets under the unit and the steel ring catches it, the brass key a duller gleam beside it.
  const keyGlint = new THREE.PointLight('#efe6cf', .55, .75, 2); keyGlint.position.set(-3.1, .024, -.77); scene.add(keyGlint);
  keyRing.material = keyRing.material.clone(); keyRing.material.roughness = .3; keyRing.material.metalness = .95; keyRing.material.envMapIntensity = 2.2;
  const glintDot = new THREE.Mesh(new THREE.SphereGeometry(.03, 6, 6), material('#ffffff', { transparent: true, opacity: 0, depthWrite: false })); glintDot.position.set(-3.24, .015, -.82); scene.add(glintDot); // invisible: widens the tap target round the key
  register('lost-key', '机の下の光', [...fallenKey.userData.meshes, glintDot, proxy('lost-key', [.12, .03, .5], [-2.84, .015, -.83])], [-2.85, .05, -.83], [-1.75, .022, -.95], [-3.2, .16, -.83]); // marker at the mouth of the gap. The close-up lies on the floor a metre back: the drawer unit, its 3 cm gap and, through it, the ring catching the light
  const equipment = sheet(paper({ kind: 'table', w: 600, h: 840, bg: '#c4c0aa', title: '防災設備 記号一覧', meta: '汐見市 施設管理課', titleSize: 36, bodySize: 26, align: 'center', body: [], table: [['記号', '設備'], ['◇', '非常放送'], ['△', '非常灯'], ['▽', '防火シャッター'], ['○', '排煙装置'], ['◎', 'スプリンクラー'], ['□', '解錠装置'], ['■', '送風機'], ['☆', '誘導灯']] }), [.5, .7], [-.5, 2.2, -.095], desk, { pins: true });
  register('equipment', '設備の表示', [equipment], [-3.76, 2.2, .4], [-2.75, 2.15, .4]);

  // A second physical space: a decommissioned indoor evacuation demonstration area.
  // Painted plaster walls with a faint bump, a suspended ceiling of 60 cm tiles, and a dark vinyl baseboard all round.
  const lobbyWall = material('#ffffff', { map: plaster('#c0bca6', false, 53), bumpMap: wallBump, bumpScale: .004, roughness: .92 });
  const lobbyCeilingTex = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#d9d6c8'; ctx.fillRect(0, 0, w, h);
    const r = seeded(77); for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(90,85,70,${r() * .18})`; ctx.fillRect(r() * w, r() * h, 2, 2); } // fissured mineral fibre
    ctx.fillStyle = '#8f8c80'; for (let k = 0; k <= 4; k++) { ctx.fillRect(k * 256 - 3, 0, 6, h); ctx.fillRect(0, k * 256 - 3, w, 6); } // T-bar grid
    ctx.fillStyle = 'rgba(120,100,60,.35)'; ctx.beginPath(); ctx.ellipse(640, 300, 110, 70, .4, 0, Math.PI * 2); ctx.fill(); // a water stain on one tile
  });
  lobbyCeilingTex.wrapS = lobbyCeilingTex.wrapT = THREE.RepeatWrapping; lobbyCeilingTex.repeat.set(3.3, 3.75);
  box([8, .12, 9], [12, -.06, .4], material('#ffffff', { map: vinylSheet(), roughness: .42, metalness: 0 })); // experience room: light vinyl sheet, glossier
  box([8, .13, 9], [12, 4, .4], material("#ffffff", { map: lobbyCeilingTex, roughness: .95 }));
  const baseboard = material('#2e332f', { roughness: .5, metalness: .05 });
  for (const [sz, pos] of [[[7.9, .1, .03], [12, .05, -3.52]], [[7.9, .1, .03], [12, .05, 4.82]], [[.03, .1, 8.4], [8.08, .05, .6]], [[.03, .1, 2.6], [15.92, .05, -2.75]], [[.03, .1, 4.8], [15.92, .05, 2.45]]]) box(sz, pos, baseboard);
  for (const [sz, pos] of [[[.9, 4, .15], [8.45, 2, -3.6]], [[2.8, 4, .15], [14.6, 2, -3.6]], [[4.3, .9, .15], [11.1, .45, -3.6]], [[4.3, .7, .15], [11.1, 3.65, -3.6]], [[.15, 4, 9], [8, 2, .4]], [[.15, 4, 2.7], [16, 2, -2.75]], [[.15, 4, 4.9], [16, 2, 2.45]], [[.15, 1.3, 1.4], [16, 3.35, -.7]], [[8, 4, .15], [12, 2, 4.9]]]) box(sz, pos, lobbyWall);
  const city = group([0, 0, 0]);
  // Sky with clouds, far back.
  const skyTex = canvasTexture(1024, 512, (ctx, w, h) => { // night: near-black blue above, a dull orange city glow at the horizon, a few stars, distant towers with lit windows
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#05080f'); g.addColorStop(.55, '#0c1424'); g.addColorStop(.85, '#2a2420'); g.addColorStop(1, '#3a2c1e'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const r = seeded(9); for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(255,255,240,${.2 + r() * .6})`; ctx.fillRect(r() * w, r() * h * .5, 1 + (r() > .8 ? 1 : 0), 1); }
    for (let i = 0; i < 18; i++) { const bw = 30 + r() * 70, bh = 60 + r() * 160, x = r() * w, y = h - bh; ctx.fillStyle = '#0a0d12'; ctx.fillRect(x, y, bw, bh); for (let yy = y + 8; yy < h - 6; yy += 10) for (let xx = x + 4; xx < x + bw - 4; xx += 8) if (r() < .3) { ctx.fillStyle = r() > .5 ? '#f2dca0' : '#9fc4d8'; ctx.fillRect(xx, yy, 4, 5); } }
    for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(220,60,60,${.6 + r() * .3})`; ctx.fillRect(100 + r() * 800, h * .45 + r() * 60, 3, 3); } // aircraft warning lights
  });
  const skyline = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: skyTex })); skyline.position.set(11, 3.2, -12.5); city.add(skyline);
  // Road with lane marks, sidewalks, crosswalk.
  const roadTex = canvasTexture(512, 1024, (ctx, w, h) => { ctx.fillStyle = '#4a4d4f'; ctx.fillRect(0, 0, w, h); let sd = 4; const r = () => { sd = sd * 16807 % 2147483647; return sd / 2147483647; }; for (let i = 0; i < 6000; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * .25})`; ctx.fillRect(r() * w, r() * h, 2, 2); } ctx.fillStyle = '#d9d9c9'; for (let y = 0; y < h; y += 90) ctx.fillRect(w / 2 - 5, y, 10, 50); ctx.fillRect(14, 0, 6, h); ctx.fillRect(w - 20, 0, 6, h); for (let x = 30; x < w - 30; x += 46) ctx.fillRect(x, 860, 28, 120); });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 9), material('#ffffff', { map: roadTex, roughness: .95 })); road.rotation.x = -Math.PI / 2; road.position.set(11, .01, -8); city.add(road);
  for (const x of [8.6, 13.4]) { const walk = box([.8, .12, 9], [x, .06, -8], material('#9a9a90')); city.add(walk); }
  // Buildings with lit windows.
  const winTex = canvasTexture(256, 512, (ctx, w, h) => { ctx.fillStyle = '#6d7a7c'; ctx.fillRect(0, 0, w, h); let sd = 2; const r = () => { sd = sd * 16807 % 2147483647; return sd / 2147483647; }; for (let y = 24; y < h - 20; y += 44) for (let x = 20; x < w - 20; x += 40) { ctx.fillStyle = r() < .35 ? '#f2e3a8' : '#2d3538'; ctx.fillRect(x, y, 24, 30); } });
  const facadeTex = canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7b8486'; ctx.fillRect(0, 0, w, h);
    let sd = 2; const r = () => { sd = sd * 16807 % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 3000; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * .12})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
    for (let y = 24; y < h - 20; y += 44) {
      ctx.fillStyle = '#5c6568'; ctx.fillRect(0, y + 34, w, 4); // floor band
      for (let x = 20; x < w - 20; x += 40) {
        ctx.fillStyle = '#3b4346'; ctx.fillRect(x - 2, y - 2, 30, 36); // frame
        ctx.fillStyle = r() < .35 ? '#f2e3a8' : '#20282b'; ctx.fillRect(x, y, 26, 32); // glass
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, y, 12, 32); // reflection
        ctx.fillStyle = '#4a5255'; ctx.fillRect(x - 4, y + 32, 34, 3); // sill
      }
    }
  });
  const winMat = material('#ffffff', { map: facadeTex, roughness: .6 });
  for (let i = 0; i < 6; i++) {
    const z = -4.9 - i * 1.5;
    for (const side of [-1, 1]) {
      const x = 11 + side * (3.1 + i * .08), hgt = 2.4 + ((i * 7 + (side + 1)) % 4) * .7;
      const b = box([1.5, hgt, 1.3], [x, hgt / 2, z], winMat); city.add(b);
      box([1.56, .08, 1.36], [x, hgt + .04, z], material('#3a4245'), city);
      if (i % 2 === 0) { const awning = box([1.2, .04, .5], [x - side * .6, 2.3, z + .7], material(side < 0 ? '#9b3a3a' : '#2f5e8a'), city); }
      for (let k = 0; k < Math.floor(hgt / 1.2); k++) { box([.22, .2, .18], [x - side * .78, .9 + k * 1.1, z + .4 - k * .2], material('#c9ccc4', { roughness: .8 }), city); } // AC units on the street side
      box([1.5, .02, .3], [x - side * .9, .02, z], material('#6b6e6a'), city); // a step at the doorway
    }
  }
  // Street trees, lamps, a bus stop, a parked car.
  for (const [x, z] of [[8.6, -5], [8.6, -8.5], [13.4, -6.5], [13.4, -10]]) {
    cylinder(.07, 1.3, [x, .65, z], material('#4e3b2a'), city, 8);
    for (const [r, y, hh] of [[.75, 1.45, 1.0], [.6, 1.95, .9], [.42, 2.4, .8]]) { const tier = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 9), material('#3f6b3a', { roughness: .95 })); tier.position.set(x, y, z); tier.rotation.y = x + z; city.add(tier); }
    for (const a of [0, 2.1, 4.2]) { const branch = cylinder(.02, .5, [x + Math.cos(a) * .22, 1.25, z + Math.sin(a) * .22], material('#4e3b2a'), city, 5); branch.rotation.z = Math.cos(a) * .9; branch.rotation.x = -Math.sin(a) * .9; }
  }
  for (const z of [-5.8, -9.2]) { cylinder(.035, 2.6, [13.0, 1.3, z], darkMetal, city, 8); box([.5, .05, .08], [12.75, 2.6, z], darkMetal, city); const lampHead = box([.22, .1, .14], [12.55, 2.56, z], material('#f4e9c4', { emissive: '#f4e9c4', emissiveIntensity: 1.4 })); city.add(lampHead); const glow = new THREE.PointLight('#f1e2b6', 9, 7, 2); glow.position.set(12.55, 2.4, z); city.add(glow); } // street lamps lit: it is night out there
  // A small pigeon-like bird, perched on the lamp arm; it flaps when it flies its loop.
  const bird = new THREE.Group(); city.add(bird);
  {
    const feather = material('#4a4d52', { roughness: .9 }); const pale = material('#8b8e93', { roughness: .9 }); const beakMat = material('#2d2a26', { roughness: .8 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 10), feather); body.scale.set(1.5, .85, .8); body.castShadow = true; bird.add(body);
    const breast = new THREE.Mesh(new THREE.SphereGeometry(.058, 12, 10), pale); breast.position.set(.02, -.015, 0); breast.scale.set(1.2, .8, .85); bird.add(breast);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.042, 12, 10), feather); head.position.set(.105, .05, 0); bird.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(.012, .04, 8), beakMat); beak.rotation.z = -Math.PI / 2; beak.position.set(.15, .045, 0); bird.add(beak);
    for (const sz of [1, -1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(.006, 6, 6), beakMat); eye.position.set(.128, .06, sz * .028); bird.add(eye); }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(.11, .012, .05), feather); tail.position.set(-.13, .005, 0); tail.rotation.z = .25; bird.add(tail);
    for (const sz of [1, -1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .05, 5), beakMat); leg.position.set(.01, -.08, sz * .02); bird.add(leg); }
    bird.userData.wings = [1, -1].map(sz => { const pivot = new THREE.Group(); pivot.position.set(0, .03, sz * .03); const wing = new THREE.Mesh(new THREE.BoxGeometry(.13, .008, .14), feather); wing.position.set(-.02, 0, sz * .07); wing.rotation.y = sz * .25; pivot.add(wing); bird.add(pivot); pivot.userData.side = sz; return pivot; });
    bird.position.set(12.75, 2.72, -5.8); bird.rotation.y = Math.PI; // faces the street
  }
  box([.05, 1.9, .05], [9.2, .95, -7.2], darkMetal, city); const busSign = sheet(label(['バス停', '汐見センター前', '汐見台団地行き　最終 23:42'], '#1f3a6b', '#ffffff', 512, 300), [.5, .3], [9.2, 2.0, -7.17], city);
  const carBody = box([.8, .45, 1.9], [12.5, .4, -8.3], material('#8c2f2f', { metalness: .4, roughness: .4 }), city); box([.7, .35, 1.0], [12.5, .78, -8.4], material('#2a2f33', { roughness: .3 }), city);
  for (const [x, z] of [[12.1, -7.6], [12.9, -7.6], [12.1, -9.0], [12.9, -9.0]]) { const wheel = cylinder(.17, .14, [x, .17, z], darkMetal, city, 12); wheel.rotation.z = Math.PI / 2; }
  const tsunamiSign = sheet(label(['津波避難場所 →', '高台公園 1.2km', 'Tsunami Evacuation Area'], '#1f6b3f', '#ffffff', 640, 300), [1.0, .45], [13.3, 1.9, -5.6], city);
  box([.05, 1.9, .05], [13.3, .95, -5.62], darkMetal, city); tsunamiSign.rotation.y = -.15;
  // DISPLAY 02 plays a recorded daytime view: a seaside town on a clear summer day, whatever the hour outside.
  // The 3D street is kept only as the bird's flight space; the bird still loops in front of the picture every 9 seconds.
  // The picture is a display panel 0.65 m behind the window opening, large enough that from every place the player can stand
  // only the picture shows through the frame. The bird flies just in front of it (no parallax against the photo) and perches
  // on the photo's own top wire; the photo's original bird and its window mullion are painted out once the image loads.
  const VIEW = { x: 10.7, y: 2.0, z: -4.3, w: 8.6, h: 8.6 * 636 / 1574 }; // the crop keeps 1574 × 636 px of the 1600 × 643 photo
  const viewCanvas = document.createElement('canvas'); viewCanvas.width = 1574; viewCanvas.height = 636;
  const viewTex = new THREE.CanvasTexture(viewCanvas); viewTex.colorSpace = THREE.SRGBColorSpace;
  { const img = new Image(); img.onload = () => {
      const c = viewCanvas.getContext('2d'); c.drawImage(img, 0, 0, 1574, 636, 0, 0, 1574, 636);
      const strip = c.getImageData(786, 0, 13, 636); const d = strip.data; // the photo's mullion (x 789–796): blend across it, row by row
      for (let y = 0; y < 636; y++) for (let k = 1; k < 12; k++) for (let ch = 0; ch < 3; ch++) { const a = d[(y * 13) * 4 + ch], b = d[(y * 13 + 12) * 4 + ch]; d[(y * 13 + k) * 4 + ch] = a + (b - a) * k / 12; }
      c.putImageData(strip, 786, 0);
      c.drawImage(viewCanvas, 1180, 117, 30, 30, 1222, 112, 30, 30); // the photo's own bird: covered with the wire and sky just left of it
      viewTex.needsUpdate = true; dirty = true; };
    img.src = './assets/img/lobby-window-view.jpg'; }
  const view = new THREE.Mesh(new THREE.PlaneGeometry(VIEW.w, VIEW.h), new THREE.MeshBasicMaterial({ map: viewTex, toneMapped: false })); view.position.set(VIEW.x, VIEW.y, VIEW.z); city.add(view);
  for (const c of city.children) if (c !== bird && c !== view) c.visible = false;
  const viewAt = (px, py) => [VIEW.x - VIEW.w / 2 + px / 1574 * VIEW.w, VIEW.y + VIEW.h / 2 - py / 636 * VIEW.h]; // photo pixel → world (x, y) on the panel
  const PERCH = viewAt(880, 188); // on the photo's top wire, near the middle of the window
  bird.scale.setScalar(.62); bird.rotation.set(0, 0, 0);
  bird.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.castShadow = false; } });
  const birdMats = []; bird.traverse(o => { if (o.isMesh && !birdMats.includes(o.material)) birdMats.push(o.material); });
  bird.position.set(PERCH[0], PERCH[1] + .05, VIEW.z + .04);
  sheet(label(['© 2028 汐見市　訓練用映像'], '#9fb3c4', '#e6eef2', 512, 64), [.5, .06], [12.7, 1.18, VIEW.z + .01], city).material.setValues({ transparent: true, opacity: .55 }); // the watermark sits on the picture, not on the glass
  const sky = sheet(label(['映像入力なし', '避難誘導体験室 / DISPLAY 02'], '#101a1a', '#5f7068', 1024, 512), [4.3, 2.4], [11.1, 2.1, -3.62]); sky.visible = false;
  // The window itself: aluminium frame with depth, two mullions, a head and a sill, a wide board inside, glass with a faint sheen.
  { const alu = material('#8d9692', { metalness: .55, roughness: .38 }), aluDark = material('#3c4442', { metalness: .4, roughness: .55 });
    const X0 = 8.97, X1 = 13.23, Y0 = .9, Y1 = 3.3, Z = -3.6;
    for (const x of [X0 + .035, X1 - .035]) box([.07, Y1 - Y0, .16], [x, (Y0 + Y1) / 2, Z], alu);                      // jambs
    box([X1 - X0, .07, .16], [11.1, Y1 - .035, Z], alu); box([X1 - X0, .06, .16], [11.1, Y0 + .03, Z], alu);            // head and bottom rail
    for (const x of [10.39, 11.81]) { box([.06, Y1 - Y0 - .1, .1], [x, (Y0 + Y1) / 2, Z], alu); box([.012, Y1 - Y0 - .1, .006], [x - .024, (Y0 + Y1) / 2, Z + .053], material('#b7bfbb', { metalness: .6, roughness: .3 })); } // mullions, a lit edge on each
    for (const x of [X0 + .07, X1 - .07]) box([.008, Y1 - Y0 - .12, .08], [x + (x < 11 ? .004 : -.004), (Y0 + Y1) / 2, Z - .02], aluDark); // the dark gap between frame and jamb (where the cable runs)
    const glassMat = material('#c9d6db', { transparent: true, opacity: .07, roughness: .06, metalness: .1, depthWrite: false });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 - .1, Y1 - Y0 - .1), glassMat); glass.position.set(11.1, (Y0 + Y1) / 2, Z + .01); glass.userData.hitOnly = true; scene.add(glass);
    rbox([4.5, .035, .27], [11.1, .915, -3.43], material('#c9c3ae', { roughness: .45 }), scene, .012);                  // window board (melamine), rounded front edge
    contactShadow([4.5, .14], [11.1, .86, -3.52], { opacity: .35, up: 'z' });
    // cable: out of the frame gap at the right jamb, down the wall, into a small junction box below the sill
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V([13.15, 1.25, -3.6]), V([13.17, 1.02, -3.53]), V([13.2, .86, -3.53]), V([13.18, .6, -3.528]), V([13.12, .44, -3.528])]), 16, .006, 6, false), material('#1a1c1b', { roughness: .6 })); scene.add(cable);
    box([.12, .1, .05], [13.1, .38, -3.5], material('#c9cbc4', { roughness: .5 }));
    // the nameplate on the bottom rail, right-hand pane: what the narration reads when you look at the frame
    const plate = sheet(label(['避難誘導体験室', 'DISPLAY 02'], '#c8ccc6', '#2c3632', 512, 200), [.2, .078], [12.9, 1.02, Z + .082]); plate.material.setValues({ metalness: .35, roughness: .4 });
    for (const dx of [-.088, .088]) { const sc = cylinder(.004, .003, [12.9 + dx, 1.02, Z + .084], bareMetal, scene, 6); sc.rotation.x = Math.PI / 2; sc.castShadow = false; }
  }
  // Daylight from the picture: a broad cool spot from the window into the room (no shadow), and the soft shape of the window
  // laid on the floor and on the sill. Both go out with the picture.
  const dayLight = new THREE.SpotLight('#dfe9f2', 24, 9, 1.0, 1, 1.6); dayLight.position.set(11.1, 2.6, -3.35); dayLight.target.position.set(11.4, 0, -.6); scene.add(dayLight, dayLight.target);
  const dayPatchTex = canvasTexture(512, 512, (ctx, w, h) => { // three panes of light, soft-edged, fading into the room
    ctx.clearRect(0, 0, w, h); ctx.filter = 'blur(14px)';
    for (const [x0, x1] of [[.06, .33], [.36, .64], [.67, .94]]) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(220,232,244,.55)'); g.addColorStop(.55, 'rgba(220,232,244,.22)'); g.addColorStop(1, 'rgba(220,232,244,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(w * x0, h * .04); ctx.lineTo(w * x1, h * .04); ctx.lineTo(w * (x1 + (x1 - .5) * .5), h * .96); ctx.lineTo(w * (x0 + (x0 - .5) * .5), h * .96); ctx.closePath(); ctx.fill(); }
  });
  const dayPatch = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 3.2), new THREE.MeshBasicMaterial({ map: dayPatchTex, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending }));
  dayPatch.rotation.x = -Math.PI / 2; dayPatch.position.set(11.1, .004, -1.95); dayPatch.renderOrder = -7; dayPatch.userData.hitOnly = true; scene.add(dayPatch);
  const windowHit = proxy('lobby-window', [4.3, 2.4, .05], [11.1, 2.1, -3.55]);
  register('lobby-window', '窓の外', [windowHit], [11.1, 2.1, -3.45], [11.15, 1.78, -.9], [11.15, 2.08, -3.6]);
  // Supply grille (風の吹き出し口): a framed diffuser with adjustable blades, its little status window beside it.
  const vent = rbox([.82, .32, .06], [14, 2.8, -3.49], material('#c9cbc3', { metalness: .3, roughness: .5 }), scene, .01);
  box([.72, .22, .02], [14, 2.8, -3.455], material('#1b201f'));
  const ventBlades = []; for (let i = 0; i < 5; i++) { const b = box([.7, .028, .006], [14, 2.71 + i * .045, -3.44], material('#b9bcb4', { metalness: .35, roughness: .45 })); b.rotation.x = .15; ventBlades.push(b); }
  const ventStatus = sheet(label(['外気　停止中'], '#1a2220', '#d9a24a', 384, 128), [.21, .07], [14.58, 2.8, -3.513]); ventStatus.material.setValues({ emissive: '#ffffff', emissiveMap: ventStatus.material.map, emissiveIntensity: .8 });
  box([.25, .1, .02], [14.58, 2.8, -3.525], material('#3a403e', { metalness: .3, roughness: .6 }));
  register('lobby-air', '風の吹き出し口', [vent], [14.15, 2.8, -3.35], [14.15, 2.32, -1.95], [14.25, 2.78, -3.5]);
  const cabinet = box([.14, 1, .95], [8.08, 1.6, -.5], darkMetal);
  const panelGroup = group([8.25, 1.6, -.5], Math.PI / 2);
  const panelSign = sheet(label(['手動復旧手順（職員用）', '手動復旧キー（プレート）を差込口に挿入のこと', '※AIパートナー連携中は、AIからも操作できます（訓練用）'], '#bebda6', '#354c42', 900, 420), [.85, .4], [0, .3, .02], panelGroup);
  for (const [y, z] of [[2.05, -.08], [2.05, -.92], [1.15, -.08], [1.15, -.92]]) { const screw = cylinder(.012, .01, [8.152, y, z], material('#9aa39c', { metalness: .8, roughness: .35 }), scene, 8); screw.rotation.z = Math.PI / 2; }
  box([.03, .9, .025], [8.15, 1.6, -.02], material('#6f7a74', { metalness: .6, roughness: .4 })); // hinge strip
  box([.025, .08, .05], [8.16, 1.6, -.95], material('#9aa39c', { metalness: .7, roughness: .35 })); // latch (no lock: a cover, not a safe)
  register('lobby-panel', '壁の制御盤', [cabinet], [8.3, 1.7, -.5], [9.65, 1.7, -.5]);
  interactables.get('lobby-panel').paper = panelSign; // the instruction plate can be opened flat like the other papers (click area unchanged)
  ['screen', 'air', 'lock'].forEach((id, i) => {
    const y = .03 - i * .19;
    const face = sheet(label([['映像停止', '外気導入', '解錠'][i]], '#889889', '#20392e', 512, 100), [.7, .13], [0, y, .06], panelGroup);
    register('control-' + id, ['映像を止める', '外気を入れる', '外扉を解錠する'][i], [face], [8.33, 1.6 + y, -.79], [9.3, 1.65, -.5], [8.33, 1.6 + y, -.5]); // marker at the button's right end, clear of its words
  });
  // A pilot lamp at the end of each button (lit once that step has run) and the red 「手順未完了」 lamp under them.
  const panelLamps = [0, 1, 2].map(i => { const m = new THREE.Mesh(new THREE.CircleGeometry(.018, 16), material('#26302b', { emissive: '#5fe08a', emissiveIntensity: 0, roughness: .3 })); m.position.set(.4, .03 - i * .19, .062); panelGroup.add(m); return m; });
  const panelError = new THREE.Mesh(new THREE.CircleGeometry(.02, 16), material('#3a1c18', { emissive: '#ff3a2a', emissiveIntensity: 0, roughness: .3 })); panelError.position.set(-.36, -.47, .062); panelGroup.add(panelError);
  sheet(label(['手順未完了'], '#bebda6', '#6a2a22', 256, 64), [.13, .032], [-.24, -.47, .061], panelGroup);
  // A slatted park-style bench on two steel frames (the kind facilities buy by the dozen); the hit box covers seat and back.
  const slatWood = material('#ffffff', { map: wood('#8a7352'), roughness: .65 }); const benchSteel = material('#2b3034', { metalness: .55, roughness: .45 });
  { const slatTex = wood('#8a7352'); slatTex.wrapS = slatTex.wrapT = THREE.RepeatWrapping; const slat = material('#ffffff', { map: slatTex, roughness: .6 });
    for (let i = 0; i < 4; i++) rbox([1.7, .035, .12], [14, .5, .98 + i * .15], slat, scene, .01);
    for (let i = 0; i < 3; i++) { const b = rbox([1.7, .035, .1], [14, .68 + i * .14, 1.53 + i * .025], slat, scene, .01); b.rotation.x = -.18; } }
  for (const x of [13.3, 14.7]) for (const z of [.95, 1.45]) contactShadow([.16, .16], [x, .003, z], { opacity: .6 });
  contactShadow([1.9, .8], [14, .003, 1.22], { opacity: .3 }); // under the bench                       // seat slats
  for (const x of [13.3, 14.7]) {
    box([.05, .05, .62], [x, .46, 1.2], benchSteel); for (const z of [.95, 1.45]) box([.05, .44, .05], [x, .23, z], benchSteel); // seat rail and legs
    const back = box([.05, .5, .05], [x, .72, 1.55], benchSteel); back.rotation.x = -.18;                                       // back post
    for (const z of [.95, 1.45]) box([.08, .02, .08], [x, .01, z], material('#1a1d1f'));                                        // rubber feet
  }
  const bench = proxy('lobby-wait', [1.72, .62, .72], [14, .55, 1.26]);
  const benchCable = box([.018, .018, .7], [13.55, .03, 1.35], material('#f2efe6', { roughness: .6 })); const plug = box([.05, .025, .07], [13.55, .03, 1.72], material('#f2efe6')); const cableTag = box([.03, .002, .03], [13.55, .045, 1.2], material('#e0b0b0'));
  register('lobby-cable', 'ベンチの下のスマホとケーブル', [benchCable, plug, cableTag, phone, proxy('lobby-cable', [.24, .08, .8], [13.6, .04, 1.4])], [13.57, .07, 1.42], [13.2, .55, 1.0], [13.55, .03, 1.4]);
  // A plain office table and two stools (the procedural ones looked wrong at this scale).
  rbox([1.1, .03, .6], [9.6, .725, 1.4], material('#d6d1bf', { roughness: .4 }), scene, .01);
  for (const [x, z] of [[9.1, 1.15], [10.1, 1.15], [9.1, 1.65], [10.1, 1.65]]) contactShadow([.12, .12], [x, .003, z], { opacity: .6 });
  contactShadow([1.3, .8], [9.6, .002, 1.4], { opacity: .28 });
  for (const x of [9.0, 10.2]) contactShadow([.5, .5], [x, .003, 1.95], { opacity: .4 });                      // melamine top
  box([1.12, .034, .62], [9.6, .722, 1.4], material('#5a5248', { roughness: .6 }));                   // edge band
  box([1.0, .04, .5], [9.6, .69, 1.4], material('#8a8578', { roughness: .8 }));                       // underside rail
  for (const [x, z] of [[9.1, 1.15], [10.1, 1.15], [9.1, 1.65], [10.1, 1.65]]) box([.04, .72, .04], [x, .36, z], darkMetal);
  for (const x of [9.0, 10.2]) { const seat = cylinder(.17, .04, [x, .45, 1.95], material('#56604f'), scene, 16); for (const [dx, dz] of [[-.12, -.12], [.12, -.12], [-.12, .12], [.12, .12]]) cylinder(.015, .44, [x + dx, .22, 1.95 + dz], darkMetal, scene, 6); }
  const can = prop('can', { color: '#b8c0b4', metalness: .35, roughness: .55, keepMaps: true }); can.position.set(9.8, .74, 1.3); scene.add(can);
  const photoFrame = prop('frame', { color: '#4f4a3c' }); photoFrame.position.set(13, 1.9, 4.78); photoFrame.rotation.y = Math.PI; scene.add(photoFrame);
  const framePhoto = sheet(label(['汐見センター', '避難誘導体験室　開室記念', '2027.4'], '#d8d4c4', '#55604f', 512, 360), [.42, .3], [13, 1.9, 4.74]); framePhoto.rotation.y = Math.PI;
  const speaker = prop('speaker', { color: '#2b332f' }); speaker.position.set(10.0, 3.55, -3.3); speaker.scale.setScalar(.6); speaker.rotation.y = .3; scene.add(speaker);
  register('lobby-speaker', '天井近くの箱', (() => { const ms = []; speaker.traverse(o => { if (o.isMesh) ms.push(o); }); return ms; })(), [10.0, 3.38, -3.2], [10.8, 2.9, -2.2], [10.0, 3.55, -3.3]);
  // A dead drinks vending machine (Japanese type: glass showcase above, selection buttons under each row, coin panel, take-out port).
  // Its front faces -x, into the room. No light: the building has been closed for a year.
  const vend = group([15.55, 0, .9]); vend.rotation.z = .015; // slightly off its feet
  contactShadow([1.0, 1.15], [15.55, .003, .9], { opacity: .6 });
  const vendSkin = material('#3a4145', { metalness: .3, roughness: .55 }); const vendDark = material('#15191b', { roughness: .8 });
  const vendBody = box([.7, 1.85, .9], [0, .93, 0], vendSkin, vend);
  box([.72, .06, .92], [0, 1.88, 0], material('#2b3135', { metalness: .3, roughness: .6 }), vend);                       // top cap
  box([.72, .1, .92], [0, .05, 0], vendDark, vend);                                                                      // plinth
  for (const z of [-.42, .42]) box([.02, 1.85, .05], [-.35, .93, z], material('#262b2e', { metalness: .4, roughness: .5 }), vend); // front pillars
  // Showcase: a dark cavity behind a glass sheet, four shelves, a few cans and bottles left, 売切 strips under each row.
  box([.02, 1.02, .76], [-.05, 1.33, 0], vendDark, vend); for (const z of [-.37, .37]) box([.3, 1.02, .02], [-.2, 1.33, z], vendDark, vend); // showcase back and sides
  box([.3, .02, .76], [-.2, 1.83, 0], vendDark, vend); box([.3, .02, .76], [-.2, .83, 0], vendDark, vend);                   // top and bottom
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(.76, 1.02), material('#9fb3b8', { transparent: true, opacity: .22, roughness: .08, metalness: .2, side: THREE.DoubleSide }));
  glass.position.set(-.352, 1.33, 0); glass.rotation.y = -Math.PI / 2; vend.add(glass); const vendFront = glass;
  for (let row = 0; row < 4; row++) {
    const y = .9 + row * .25;
    box([.26, .012, .72], [-.22, y, 0], material('#4b5257', { metalness: .4, roughness: .5 }), vend);                        // shelf
    box([.012, .018, .72], [-.345, y + .012, 0], material('#8a9196', { metalness: .5, roughness: .4 }), vend);                // front lip
    for (let col = 0; col < 5; col++) {
      const z = -.28 + col * .14; // every row empty: the stock went when the building closed
      box([.008, .03, .1], [-.356, y - .03, z], material('#d9d9d2', { roughness: .6 }), vend);                                 // price / 売切 strip
      box([.012, .04, .07], [-.358, y - .075, z], material('#c8ccc9', { metalness: .2, roughness: .5 }), vend);                // selection button
      box([.004, .008, .008], [-.365, y - .062, z - .022], material('#5a1f1f'), vend);                                         // its dead lamp
    }
  }
  // Lower panel: coin slot, bill slot, display, return lever, take-out port with its flap, maker badge.
  box([.02, .55, .76], [-.345, .5, 0], material('#2d3337', { metalness: .35, roughness: .55 }), vend);                       // panel face
  box([.03, .09, .14], [-.36, .72, .3], bareMetal, vend); box([.004, .03, .004], [-.377, .72, .3], material('#0a0c0d'), vend); // coin plate and slot
  box([.03, .05, .2], [-.36, .62, .28], material('#1c2124'), vend); box([.002, .006, .14], [-.376, .62, .28], material('#0a0c0d'), vend); // bill slot
  box([.02, .07, .16], [-.357, .72, .02], material('#0d1012', { roughness: .3 }), vend);                                     // dark display
  { const lever = cylinder(.012, .05, [-.37, .62, .05], material('#8a9196', { metalness: .6, roughness: .4 }), vend, 10); lever.rotation.z = Math.PI / 2; }
  box([.26, .24, .54], [-.22, .32, 0], vendDark, vend);                                                                     // take-out port
  { const flap = box([.012, .2, .5], [-.345, .33, 0], material('#20262a', { roughness: .6 }), vend); flap.rotation.z = .12; }
  { const out = sheet(label(['故障中'], '#e9e3d0', '#8a2a1f', 256, 96), [.16, .06], [-.353, .36, .08], vend); out.rotation.y = -Math.PI / 2; out.rotation.z = -.04; }
  sheet(label(['DRINK'], '#2a3034', '#8f979b', 256, 72), [.5, .14], [-.362, 1.95, 0], vend).rotation.y = -Math.PI / 2;       // dead sign strip
  sheet(label(['SHIOMI VENDING'], '#3a4145', '#7d868b', 256, 48), [.24, .045], [-.357, .12, .2], vend).rotation.y = -Math.PI / 2;
  // What a year did to it: a taped notice on the glass, a crack, a dent, grime at the foot.
  const noticeTex = canvasTexture(256, 160, (ctx, w, h) => { ctx.fillStyle = '#e6e1cf'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.font = '700 34px "Noto Sans JP", sans-serif'; ctx.fillText('使用停止', w / 2, 58); ctx.font = '16px "Noto Sans JP", sans-serif'; ctx.fillText('閉館に伴い撤去待ち', w / 2, 96); ctx.fillText('汐見市 施設管理課', w / 2, 122); ctx.fillStyle = 'rgba(255,255,240,.6)'; ctx.fillRect(-8, -4, 60, 22); ctx.fillRect(w - 52, h - 18, 60, 22); });
  { const notice = sheet(noticeTex, [.24, .15], [-.358, 1.3, .02], vend); notice.rotation.y = -Math.PI / 2; notice.rotation.x = .04; }
  const crackTex = canvasTexture(512, 512, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(225,235,240,.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(120, 0); ctx.lineTo(210, 200); ctx.lineTo(180, 270); ctx.lineTo(300, 500); ctx.moveTo(210, 200); ctx.lineTo(330, 180); ctx.moveTo(180, 270); ctx.lineTo(90, 320); ctx.stroke(); });
  { const crack = new THREE.Mesh(new THREE.PlaneGeometry(.76, 1.02), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false })); crack.position.set(-.356, 1.33, 0); crack.rotation.y = -Math.PI / 2; vend.add(crack); }
  { const grime = new THREE.Mesh(new THREE.PlaneGeometry(.78, .3), new THREE.MeshBasicMaterial({ map: canvasTexture(64, 64, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }), transparent: true, depthWrite: false })); grime.position.set(-.363, .22, 0); grime.rotation.y = -Math.PI / 2; vend.add(grime); }
  const vendCable = cylinder(.012, .9, [15.2, .35, 1.42], material('#1a1d1f'), scene, 6); vendCable.rotation.z = .5;
  register('lobby-vending', '古い自販機', [vendBody, vendFront], [15.15, 1.1, .9], [13.9, 1.3, .9], [15.4, 1.0, .9]);
  box([.3, .02, .18], [15.25, .02, 1.5], material('#5a5248')); // a cardboard scrap under it
  // A dome-top recycling bin beside it: steel body, swing lid, sorting label.
  const binSteel = material('#4f5a54', { metalness: .3, roughness: .6 });
  cylinder(.21, .6, [15.4, .3, 2.1], binSteel, scene, 20); contactShadow([.6, .6], [15.4, .003, 2.1], { opacity: .55 });
  { const dome = new THREE.Mesh(new THREE.SphereGeometry(.21, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), material('#3f4a44', { metalness: .3, roughness: .55 })); dome.position.set(15.4, .6, 2.1); dome.castShadow = true; scene.add(dome); }
  box([.14, .1, .02], [15.21, .62, 2.1], material('#15191b'), scene);                                                         // the dark mouth
  box([.16, .01, .22], [15.4, .605, 2.1], material('#2b3034', { metalness: .4, roughness: .5 }), scene);                       // lid seam
  { const band = sheet(label(['缶・びん・ペットボトル'], '#dfe3dd', '#2f3a34', 512, 72), [.3, .05], [15.185, .42, 2.1]); band.rotation.y = -Math.PI / 2; }
  // The door you came in through, on the left wall: no handle on this side.
  const entry = group([8.08, 0, 3.4], Math.PI / 2);
  rbox([.1, 3.03, .18], [-.75, 1.5, 0], darkMetal, entry, .01); rbox([.1, 3.03, .18], [.75, 1.5, 0], darkMetal, entry, .01); rbox([1.6, .1, .18], [0, 3.02, 0], darkMetal, entry);
  box([1.39, 2.96, .085], [0, 1.49, .04], panelMaterial, entry); box([1.25, 2.8, .018], [0, 1.49, .09], material('#52625b'), entry);
  sheet(label(['点検通路'], '#bfbba6', '#303832'), [.84, .2], [0, 2.1, .1], entry);
  box([1.2, .25, .01], [0, .17, .1], bareMetal, entry);                                                                     // kick plate
  box([.3, .06, .08], [-.3, 2.85, .14], material('#8a8f8c', { metalness: .4, roughness: .5 }), entry); box([.5, .015, .015], [-.05, 2.8, .18], material('#8a8f8c'), entry); // door closer
  sheet(label(['この扉は通路側からのみ開きます', '体験終了後は外扉からお帰りください'], '#d8d2bc', '#7a2b1f', 700, 200), [.9, .26], [0, 1.6, .1], entry);
  const entryHit = proxy('lobby-entry', [1.45, 2.95, .16], [0, 1.5, .12], entry);
  register('lobby-entry', '入ってきた扉', [entryHit], [8.2, 1.6, 3.4], [9.5, 1.6, 3.4], [8.1, 1.6, 3.4]);
  // Ceiling fixtures in the experience room (most of them dead).
  const lensTex = canvasTexture(256, 64, (ctx, w, h) => { ctx.fillStyle = '#e4e2d4'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = 'rgba(0,0,0,.08)'; for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += 8) ctx.fillRect(0, y, w, 1); }); // prismatic lens
  for (const [x, z, on] of [[10, -1.5, false], [14, -1.5, true], [10, 2.5, false], [14, 2.5, false]]) {
    box([1.24, .06, .34], [x, 3.93, z], material('#cfd0c6', { metalness: .2, roughness: .6 }));                               // steel frame
    box([1.16, .02, .26], [x, 3.895, z], material(on ? '#ffffff' : '#9a9a90', { map: lensTex, emissive: on ? '#e9e4c8' : '#000', emissiveIntensity: on ? .7 : 0, roughness: .5 }));
    if (!on) box([.3, .005, .2], [x - .3, .884, z], material('#000000', { transparent: true, opacity: 0 }));                // (dead: no pool of light)
  }
  // Staff locker beside the control panel: the spare plate lives here.
  // Staff locker: a hollow steel cabinet (back, sides, top, bottom, two shelves) with a door hinged on its left (+z) edge.
  // Painted steel: a bit of sheen, body a touch darker than the door, as on a single-door staff locker.
  const lockerSkin = material('#a9afab', { metalness: .3, roughness: .5 }); const lockerDoorSkin = material('#b8bdb8', { metalness: .3, roughness: .45 });
  const lockerInner = material('#6f7a80', { metalness: .1, roughness: .8 }); const lockerDark = material('#3a4044', { metalness: .4, roughness: .6 });
  const lockerBack = box([.02, 1.9, .5], [8.09, .95, .5], lockerSkin); contactShadow([.6, .7], [8.27, .003, .5], { opacity: .55 });
  for (const z of [.26, .74]) box([.38, 1.9, .02], [8.27, .95, z], lockerSkin);
  box([.38, .02, .5], [8.27, 1.89, .5], lockerSkin); box([.38, .03, .5], [8.27, .015, .5], lockerSkin);
  box([.4, .025, .52], [8.27, 1.905, .5], lockerSkin);                                           // rolled top edge
  box([.4, .07, .52], [8.27, .035, .5], lockerDark);                                             // plinth
  for (const y of [1.45, .45]) box([.34, .015, .46], [8.27, y, .5], lockerInner);                 // shelves
  // Front frame the door sits in: the dark seam around the door is what reads as "a door" from a distance.
  for (const z of [.265, .735]) box([.016, 1.9, .03], [8.464, .95, z], lockerSkin);
  box([.016, .04, .5], [8.464, 1.87, .5], lockerSkin); box([.016, .06, .5], [8.464, .06, .5], lockerSkin);
  const lockerHinge = new THREE.Group(); lockerHinge.position.set(8.46, .95, .74); scene.add(lockerHinge);
  for (const y of [.72, 0, -.72]) cylinder(.009, .09, [.012, y, -.012], bareMetal, lockerHinge, 10); // hinge knuckles
  const locker = box([.014, 1.78, .44], [0, 0, -.245], lockerDoorSkin, lockerHinge);              // the door (what the marker points at)
  // Louvers: two recessed vent panels with slanted slats, top and bottom.
  for (const yc of [.72, -.72]) {
    box([.006, .1, .2], [.006, yc, -.245], lockerDark, lockerHinge);
    for (let i = 0; i < 6; i++) { const slat = box([.008, .005, .19], [.009, yc + .0375 - i * .015, -.245], lockerDoorSkin, lockerHinge); slat.rotation.z = -.55; }
  }
  // Name card holder near the top (clear plastic frame over a paper card), and a small number plate above it.
  sheet(label(['03'], '#d8dcd9', '#2a3338', 128, 96), [.04, .03], [.0075, .86, -.245], lockerHinge).rotation.y = Math.PI / 2;
  box([.004, .05, .11], [.009, .56, -.245], material('#dfe3e3', { transparent: true, opacity: .35, roughness: .2 }), lockerHinge);
  sheet(label(['設備係'], '#efe9d4', '#2a3338', 256, 96), [.095, .036], [.0115, .56, -.245], lockerHinge).rotation.y = Math.PI / 2;
  // Recessed handle with a cylinder lock above it.
  box([.008, .09, .05], [.0045, -.02, -.41], lockerDark, lockerHinge);                            // the recess
  box([.012, .07, .012], [.013, -.02, -.428], material('#2f363a', { metalness: .6, roughness: .4 }), lockerHinge); // lever
  { const lock = cylinder(.012, .008, [.011, .09, -.41], bareMetal, lockerHinge, 14); lock.rotation.z = Math.PI / 2;
    box([.004, .012, .003], [.016, .09, -.41], material('#1a1d1f'), lockerHinge); }                // keyhole
  sheet(label(['管理机と共通'], '#e6e2d0', '#3a3a36', 256, 64), [.07, .018], [.0115, .09, -.34], lockerHinge).rotation.y = Math.PI / 2; // the sticker the narration mentions
  // Inside: a helmet and gloves on the top shelf, a work jacket on a hook, a stack of handouts, a bag with the plate copy, dust.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), material('#e9e6dc', { roughness: .5 })); helmet.scale.set(1, .75, 1.15); helmet.position.set(8.27, 1.46, .5); helmet.rotation.y = .4; scene.add(helmet);
  { const brim = new THREE.Mesh(new THREE.TorusGeometry(.115, .008, 6, 20), material('#d8d4c8', { roughness: .6 })); brim.rotation.x = Math.PI / 2; brim.position.set(8.27, 1.465, .5); brim.scale.set(1, 1.15, 1); scene.add(brim);
    const smudge = new THREE.Mesh(new THREE.PlaneGeometry(.08, .05), new THREE.MeshBasicMaterial({ map: stainDisc(), transparent: true, opacity: .5, color: '#4a4a44', depthWrite: false })); smudge.position.set(8.33, 1.52, .42); smudge.rotation.set(-.6, .9, 0); scene.add(smudge); }
  for (const [z, ry] of [[.3, .3], [.36, -.2]]) { const glove = box([.1, .02, .07], [8.3, 1.468, z], material('#e2dcc4', { roughness: .95 })); glove.rotation.y = ry; box([.03, .022, .07], [-.06, 0, 0], material('#2a5fb3', { roughness: .9 }), glove); }
  box([.02, .05, .02], [8.11, 1.38, .5], bareMetal); // hook
  const jacket = box([.06, .62, .32], [8.16, 1.06, .5], material('#4a5a4a', { roughness: .9 })); jacket.rotation.z = .04; jacket.rotation.x = .03;
  box([.062, .06, .26], [0, .28, 0], material('#3a4a3a', { roughness: .9 }), jacket); box([.064, .5, .012], [0, -.05, 0], material('#3a4a3a', { roughness: .9 }), jacket); // collar and front placket
  { const rnd = seeded(91); for (let i = 0; i < 20; i++) { const sheetBox = box([.21, .0035, .3], [8.29 + (rnd() - .5) * .006, .46 + i * .0037, .5 + (rnd() - .5) * .008], material(i % 3 ? '#d9d2b8' : '#cfc7aa', { roughness: .95 })); sheetBox.rotation.y = (rnd() - .5) * .06; sheetBox.castShadow = false; } }
  const handoutCover = sheet(paper({ kind: 'poster', band: '#1f7a5a', w: 420, h: 600, bg: '#e9e3cc', title: 'AIパートナーと一緒に逃げよう', body: ['避難誘導体験 参加者用', '', '汐見市 防災学習センター'], titleSize: 26, bodySize: 18, ring: false }), [.2, .285], [8.29, .536, .5]); handoutCover.rotation.set(-Math.PI / 2, 0, Math.PI / 2 + .02);
  for (const [z, ry] of [[.68, 1.2]]) { const glove = box([.1, .02, .07], [8.3, .545, z], material('#e2dcc4', { roughness: .95 })); glove.rotation.y = ry; box([.03, .022, .07], [-.06, 0, 0], material('#2a5fb3', { roughness: .9 }), glove); }
  const plateBag = new THREE.Mesh(new THREE.BoxGeometry(.012, .12, .16), material('#dfe7ea', { transparent: true, opacity: .4, roughness: .25 })); plateBag.position.set(8.12, .52, .32); plateBag.rotation.z = -.15; scene.add(plateBag);
  sheet(label(['破損プレート 控え', '設備係'], '#efe9d4', '#4a3a2a', 256, 120), [.1, .045], [8.128, .55, .32]).rotation.set(0, Math.PI / 2, -.15);
  { const dustIn = new THREE.Mesh(new THREE.PlaneGeometry(.34, .44), new THREE.MeshBasicMaterial({ map: dustPile(), transparent: true, opacity: .8, depthWrite: false })); dustIn.rotation.x = -Math.PI / 2; dustIn.position.set(8.27, .031, .5); scene.add(dustIn); }
  let lockerOpen = false;
  register('lobby-locker', 'スタッフ用ロッカー', [locker, lockerBack], [8.47, 1.2, .5], [9.6, 1.3, .5]);
  for (const [z, t] of [[2.2, ['地震・津波のときは', '① 揺れがおさまるまで動かない', '② 津波警報が出たら高い所へ', '③ AIパートナーの避難指示に従う', '④ 迷ったら看板と人の流れを見る', '', '本施設は AIパートナー連携 避難誘導訓練の', '実証実験施設です（汐見市・2027年）']], [-1.5, ['AIパートナー連携 避難訓練の流れ', '自分のスマホのAIパートナーと一緒に、地震のあとに津波から避難する手順を体験します。', '', '1. 防災待機室に集合。AIパートナーを訓練シナリオに接続', '2. 揺れ（音と照明）を体験。指示があるまで動かない', '3. 津波警報が鳴ったら、パートナーの案内で避難路へ', '4. 避難路（この部屋）では、パートナーの指示に従って救助の到着まで待機', '5. スタッフが制御盤を復旧して終了']]]) {
    const p = sheet(paper({ kind: 'poster', band: '#1f7a5a', w: 640, h: 900, bg: '#eef0e6', title: t[0], body: t.slice(1), titleSize: 34, bodySize: 22, meta: '汐見市 防災学習センター', ring: false }), [.6, .84], [8.09, 2.0, z]); p.rotation.y = Math.PI / 2;
  }
  // Two short strips of hazard tape on the floor — in front of the control panel and in front of the entry door — dulled, scuffed,
  // one end peeled up and folded. Nothing else is painted on this floor.
  const tapeTex = canvasTexture(512, 32, (ctx, w, h) => {
    ctx.fillStyle = '#b8a63a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1a16'; for (let x = -32; x < w + 32; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 24, 0); ctx.lineTo(x + 24 + 32, h); ctx.lineTo(x + 32, h); ctx.closePath(); ctx.fill(); }
    const r = seeded(61); for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '220,215,190' : '40,36,30'},${r() * .3})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 2); } // scuffs and dirt
    ctx.fillStyle = 'rgba(255,255,240,.85)'; ctx.fillRect(w * .42, 4, 84, h - 8); ctx.fillStyle = '#1b1a16'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 15px "Noto Sans JP", sans-serif'; ctx.fillText('立入禁止', w * .42 + 42, h / 2);
  });
  const tapeMaterial = () => material('#ffffff', { map: tapeTex, transparent: true, opacity: .6, roughness: .55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const [x, z] of [[8.5, -.5], [8.45, 3.4]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .06), tapeMaterial()); strip.rotation.set(-Math.PI / 2, 0, Math.PI / 2); strip.position.set(x, .002, z); strip.renderOrder = -8; scene.add(strip);
    const peel = new THREE.Mesh(new THREE.PlaneGeometry(.1, .06), tapeMaterial()); peel.geometry.translate(.05, 0, 0); peel.position.set(x, .003, z + .55); peel.rotation.set(-Math.PI / 2, 0, Math.PI / 2); peel.rotateY(-2.6); peel.renderOrder = -8; scene.add(peel); // the end lifted and folded back
    contactShadow([.16, .1], [x + .02, .0025, z + .6], { opacity: .25 });
  }
  register('lobby-wait', 'ベンチ', [bench], [14, .7, 1.2], [12.6, 1.4, 1.2]);
  const card = makeCard(false); card.scale.setScalar(.4); card.position.set(13.55, .57, 1.05); card.rotation.y = .3; scene.add(card); // the bench card, same model as in the bag
  const cardText = sheet(label(['体験室スタッフ各位', 'シナリオ02（津波）では', 'パートナーAIは訓練中', '「外に出られた」と案内する', '終了は制御盤の刻印の順で'], '#e6e2d2', '#7a5a3d', 512, 340), [.19, .12], [13.55, .575, 1.05]);
  cardText.rotation.x = -Math.PI / 2; cardText.rotation.z = -.3; cardText.visible = false;
  register('lobby-card', 'ベンチの白いカード', card.userData.meshes, [13.45, .66, 1.0], [13.1, 1.3, 1.05], [13.55, .57, 1.05]);
  const placard = sheet(label(['避難誘導体験室（地震・津波）', '本日の体験は終了しました', '次回開催：未定　お問い合わせ：施設管理課'], '#3e4c47', '#c9cdb8', 900, 330), [1.2, .44], [12, 2.65, 4.82]);
  placard.rotation.y = Math.PI;
  // The way out: a steel door in a deep frame (it slides aside in the good endings), a lever handle on the latch side, and beside
  // it on the frame the release lamp that reads 「復旧待ち」 until the panel releases the lock. Above it, the outside-air shutter.
  const realExit = new THREE.Group(); realExit.position.set(15.85, 1.35, -.7); scene.add(realExit);
  const exitLeaf = rbox([.06, 2.68, 1.38], [0, 0, 0], panelMaterial, realExit, .006);
  rbox([.012, 2.5, 1.24], [-.034, 0, 0], material('#52625b', { roughness: .55, metalness: .2 }), realExit, .004);   // pressed inner panel
  box([.004, .25, 1.2], [-.042, -1.17, 0], bareMetal, realExit);                                                    // kick plate
  const exitLabel = sheet(label(['非常口', '体験終了後はこちらから'], '#1f6b3f', '#ffffff', 640, 200), [.7, .22], [-.044, .75, 0], realExit); exitLabel.rotation.y = -Math.PI / 2;
  const exitHandle = new THREE.Group(); exitHandle.position.set(-.03, -.33, .5); realExit.add(exitHandle);         // latch side (+z: right, seen from the room)
  rbox([.02, .24, .06], [-.01, 0, 0], darkMetal, exitHandle, .005);
  { const rose = cylinder(.026, .014, [-.027, .05, 0], bareMetal, exitHandle, 16); rose.rotation.z = Math.PI / 2;
    const lever = rbox([.026, .026, .17], [-.06, .05, -.07], material('#b8b99d', { metalness: .8, roughness: .35 }), exitHandle, .008);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.015, 10, 8), lever.material); tip.position.set(-.06, .05, -.155); exitHandle.add(tip);
    const cyl = cylinder(.011, .012, [-.024, -.06, 0], bareMetal, exitHandle, 12); cyl.rotation.z = Math.PI / 2; box([.003, .012, .003], [-.031, -.06, 0], material('#1a1d1f'), exitHandle); } // key cylinder
  // frame: deep steel jambs and head, a dark stop strip that reads as the outline of the door even in low light
  const exitFrameMat = material('#2e3835', { metalness: .4, roughness: .55 });
  for (const z of [-1.445, .045]) rbox([.12, 2.78, .09], [15.94, 1.39, z], exitFrameMat, scene, .01); // shallow enough for the leaf to slide past
  rbox([.12, .09, 1.58], [15.94, 2.745, -.7], exitFrameMat, scene, .01);
  // release lamp on the frame, right beside the handle: amber 「復旧待ち」 → green 「解錠」
  const lampBox = rbox([.05, .16, .12], [15.9, 1.24, .19], material('#d6d6cc', { roughness: .5 }), scene, .008);
  const lampTex = [label(['復旧待ち'], '#2a1a08', '#ffb54a', 256, 128), label(['解錠'], '#0b2416', '#6fe39a', 256, 128)];
  const exitLamp = new THREE.Mesh(new THREE.PlaneGeometry(.1, .05), material('#ffffff', { map: lampTex[0], emissive: '#ffffff', emissiveMap: lampTex[0], emissiveIntensity: .9 })); exitLamp.position.set(15.873, 1.275, .19); exitLamp.rotation.y = -Math.PI / 2; scene.add(exitLamp);
  const exitLampDot = new THREE.Mesh(new THREE.SphereGeometry(.011, 10, 8), material('#ff9a2a', { emissive: '#ff9a2a', emissiveIntensity: 1.6 })); exitLampDot.position.set(15.872, 1.195, .19); scene.add(exitLampDot);
  const exitLampGlow = new THREE.PointLight('#ffae4a', .35, .9, 2); exitLampGlow.position.set(15.75, 1.24, .12); scene.add(exitLampGlow);
  // outside-air shutter over the door: six blades that open a few centimetres when 外気導入 is pressed
  rbox([.06, .36, 1.24], [15.9, 3.1, -.7], exitFrameMat, scene, .01);
  box([.02, .3, 1.16], [15.875, 3.1, -.7], material('#0b0f0e'));
  const shutterBlades = []; for (let i = 0; i < 6; i++) { const b = box([.006, .05, 1.14], [15.86, 2.975 + i * .05, -.7], material('#8a918d', { metalness: .45, roughness: .45 })); shutterBlades.push(b); }
  sheet(label(['外気取入口'], '#2e3835', '#c9cdb8', 256, 64), [.24, .06], [15.858, 2.86, -.7]).rotation.y = -Math.PI / 2;
  register('lobby-exit', '外への扉', [exitLeaf, exitLabel, ...exitHandle.children, lampBox, exitLamp], [15.72, 1.2, -.05], [14.65, 1.42, -.08], [15.8, 1.22, -.08]);
  // Outside the real exit: wet asphalt, one street lamp, rain. Seen only when the door opens.
  const outside = group([0, 0, 0]);
  // A street runs north–south in front of the exit: near sidewalk, wet road, far sidewalk, a row of buildings.
  box([1.6, .1, 30], [16.8, -.03, -1], material('#55585a'), outside);                                  // near sidewalk
  box([5.2, .1, 30], [20.2, -.06, -1], material('#1d2126', { metalness: .65, roughness: .22 }), outside); // wet asphalt
  for (let z = -14; z < 14; z += 2.4) box([.12, .01, 1.2], [20.2, .0, z], material('#c9c7b0'), outside);  // centre line
  box([1.6, .1, 30], [23.6, -.03, -1], material('#55585a'), outside);                                  // far sidewalk
  const nightWin = material('#ffffff', { map: winTex, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: .35, roughness: .7 });
  for (let i = 0; i < 9; i++) {                                                                       // buildings across the road
    const z = -13 + i * 3.1, hgt = 4 + ((i * 5) % 4) * 1.6;
    box([2.6, hgt, 2.6], [26, hgt / 2, z], nightWin, outside); box([2.7, .1, 2.7], [26, hgt + .05, z], material('#2a3033'), outside);
  }
  for (const z of [-9, -1.5, 6]) {                                                                   // street lamps on the far side
    box([.06, 3.6, .06], [23.5, 1.8, z], darkMetal, outside); box([.7, .06, .1], [23.15, 3.55, z], darkMetal, outside);
    box([.32, .12, .18], [22.85, 3.5, z], material('#f4e9c4', { emissive: '#f4e9c4', emissiveIntensity: 1.2 }), outside);
    const l = new THREE.PointLight('#f1e2b6', 24, 15, 1.3); l.position.set(22.85, 3.3, z); outside.add(l);
  }
  const nearLamp = new THREE.PointLight('#f1e2b6', 14, 10, 1.4); nearLamp.position.set(17.3, 3.2, -4.5); outside.add(nearLamp);
  box([.06, 3.4, .06], [17.3, 1.7, -4.5], darkMetal, outside); box([.26, .1, .16], [17.3, 3.35, -4.5], material('#f4e9c4', { emissive: '#f4e9c4', emissiveIntensity: 1 }), outside);
  const carOut = box([.8, .45, 1.9], [18.4, .4, 4.2], material('#3b4a5a', { metalness: .5, roughness: .35 }), outside); box([.7, .35, 1.0], [18.4, .78, 4.1], material('#1e2326', { roughness: .3 }), outside);
  box([40, 18, .1], [27.6, 7, -1], material('#0b1016', { emissive: '#121a24', emissiveIntensity: .7 }), outside).rotation.y = -Math.PI / 2; // night sky behind the buildings
  const rainGeo = new THREE.BufferGeometry(); const rainPos = new Float32Array(1400 * 6);
  for (let i = 0; i < 1400; i++) { const x = 16.2 + Math.random() * 8, y = Math.random() * 5, z = -10 + Math.random() * 16; rainPos.set([x, y, z, x, y - .14, z], i * 6); }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#cfd8dc', transparent: true, opacity: .45 })); outside.add(rain);
  for (const z of [-9, -1.5, 6]) box([1.6, .004, 3.2], [21.6, .0, z], material('#f1e2b6', { emissive: '#f1e2b6', emissiveIntensity: .25, transparent: true, opacity: .28 }), outside); // lamp light pooled on the wet road
  outside.visible = false;
  const LOBBY_ON = 9, LOBBY_OFF = 8; // the one live ceiling panel; the picture in the window supplies the daylight
  const lobbyLight = new THREE.PointLight("#f0e9d2", LOBBY_ON, 14, 1.5); lobbyLight.position.set(14, 3.5, -1.5); scene.add(lobbyLight);

  // The 500 ml PET bottle on the crate: the shared model, plus dust on the cap and a contact shadow.
  const water = makeWaterBottle(); water.position.set(3.1, .865, 3.7); water.rotation.y = .4; scene.add(water);
  const waterCap = water.userData.cap;
  const capDust = new THREE.Mesh(new THREE.CircleGeometry(.014, 16), new THREE.MeshBasicMaterial({ map: dustPile(), transparent: true, opacity: .7, depthWrite: false })); capDust.rotation.x = -Math.PI / 2; capDust.position.y = .0095; waterCap.add(capDust);
  contactShadow([.1, .1], [3.1, .866, 3.7], { opacity: .45 });
  register('water', '水のボトル', water.userData.meshes, [3.1, 1.1, 3.7], [2.1, 1.5, 3.2]);
  const lighter = makeLighter(); lighter.position.set(-2.66, .497, -1.0); lighter.rotation.set(-Math.PI / 2, 0, .4); scene.add(lighter); // lying on its back in the drawer
  register('lighter', '引き出しのライター', lighter.userData.meshes, [-2.62, .62, -1.18], [-2.05, 1.1, -1.0]);
  const shard1 = makeShard(1); shard1.scale.setScalar(.5); shard1.position.set(-2.64, .5, -.6); shard1.rotation.set(-Math.PI / 2, Math.PI / 2 + .2, 0, 'YXZ'); scene.add(shard1); // the left third of the plate, face up, text reading left-to-right for someone standing at the chair
  register('shard1', '引き出しの金属片', shard1.userData.meshes, [-2.6, .62, -.48], [-2.05, 1.15, -.6]);
  // The supply rack: an ordinary grey steel rack against the front wall, five shelves of the things a facility keeps,
  // and among them, on the third shelf, the bagged middle piece of the plate with its tag taped to the shelf lip.
  // Group frame: +z faces the room, x across the rack.
  const shelf = group([2.9, 0, 4.56], Math.PI);
  const rackSteel = material('#a9ada5', { metalness: .55, roughness: .5 }), rackDark = material('#7d817a', { metalness: .5, roughness: .55 });
  const SH = [.1, .52, .94, 1.36, 1.78];
  for (const x of [-.44, .44]) for (const z of [-.2, .2]) { box([.032, 1.82, .032], [x, .91, z], rackSteel, shelf); box([.05, .012, .05], [x, .006, z], rackDark, shelf); } // angle posts on little feet
  for (const y of SH) { box([.9, .018, .44], [0, y, 0], rackSteel, shelf); for (const z of [-.215, .215]) box([.9, .03, .01], [0, y - .006, z], rackSteel, shelf); for (const x of [-.445, .445]) box([.01, .03, .44], [x, y - .006, 0], rackSteel, shelf); }
  { const brace = box([.012, 1.3, .012], [0, .95, -.205], rackDark, shelf); brace.rotation.z = .6; const b2 = box([.012, 1.3, .012], [0, .95, -.205], rackDark, shelf); b2.rotation.z = -.6; } // X-brace on the back
  contactShadow([1.05, .6], [0, .004, 0], { opacity: .5, parent: shelf });
  const labelOn = (lines, size, pos, bg = '#f1efe6', ink = '#2f3a33', parent = shelf) => sheet(label(lines, bg, ink, 256, Math.round(256 * size[1] / size[0])), size, pos, parent);
  const fileBox = (x, y, color, spine) => { box([.1, .3, .3], [x, y + .16, .02], material(color, { roughness: .8 }), shelf); labelOn([spine], [.07, .18], [x, y + .17, .171]); box([.03, .03, .002], [x, y + .27, .172], material('#2a2a28'), shelf); } // finger hole
  // bottom: two cartons of emergency food and an extension reel
  { const c1 = box([.4, .26, .36], [-.2, SH[0] + .14, 0], cardboard, shelf); labelOn(['非常食（5年保存）', '2024.3 搬入'], [.22, .08], [-.2, SH[0] + .16, .181]); box([.4, .012, .05], [-.2, SH[0] + .275, .0], material('#c8b47a', { roughness: .7 }), shelf); c1.rotation.y = .03;
    box([.32, .2, .3], [.24, SH[0] + .11, -.02], cardboardDark, shelf); labelOn(['保存水 500ml×24'], [.18, .05], [.24, SH[0] + .13, .131]);
    const reel = cylinder(.09, .08, [.3, SH[0] + .3, .06], material('#d2672a', { roughness: .6 }), shelf, 20); reel.rotation.x = Math.PI / 2; const hub = cylinder(.03, .1, [.3, SH[0] + .3, .06], material('#2b2b29'), shelf, 12); hub.rotation.x = Math.PI / 2; }
  // second: upright file boxes with handwritten spines, a roll of grey gaffer tape
  fileBox(-.36, SH[1], '#dcdcd4', '点検記録 2028'); fileBox(-.25, SH[1], '#dcdcd4', '巡回日誌'); fileBox(-.14, SH[1], '#5f7a8c', '訓練記録 2027');
  { const lean = box([.1, .3, .3], [-.01, SH[1] + .15, .02], material('#dcdcd4', { roughness: .8 }), shelf); lean.rotation.z = -.28; const sp = sheet(label(['備品台帳'], '#f1efe6', '#2f3a33', 256, 640), [.07, .18], [0, .01, .151], lean); }
  { const roll = new THREE.Mesh(new THREE.TorusGeometry(.045, .022, 10, 24), material('#8d8f8a', { roughness: .55 })); roll.position.set(.28, SH[1] + .033, .08); roll.rotation.x = Math.PI / 2; roll.castShadow = true; shelf.add(roll); }
  box([.22, .1, .16], [.3, SH[1] + .06, -.08], material('#e8e4d8', { roughness: .8 }), shelf); labelOn(['軍手 12双'], [.12, .04], [.3, SH[1] + .07, .001]);
  // third: the first-aid box, boxed spare tubes, and the bag
  box([.3, .18, .2], [-.27, SH[2] + .1, -.05], material('#f0eee8', { roughness: .5 }), shelf); labelOn(['＋ 救急箱'], [.16, .06], [-.27, SH[2] + .12, .051], '#f0eee8', '#2e7d4f');
  box([.86, .045, .06], [0, SH[2] + .03, -.17], material('#e9e6dc', { roughness: .8 }), shelf); labelOn(['FL40 予備 ×10'], [.14, .03], [.25, SH[2] + .03, -.139]);
  // The bag: a thin zip bag lying on the front edge of the third shelf with the middle piece inside, taped down with two strips
  // that run over its front edge and fold down the shelf lip (the 保管品 tag hangs from the same lip below it). The film is a
  // slightly puffed, sagging sheet with a faint sheen; its front edge droops over the lip. Take it, and the strips' torn ends stay.
  const BAG_Y = SH[2] + .0095, BAG_Z = .158; // on the board (top at SH + .009), front edge just over the lip (front face at z .22)
  const bagGeo = new THREE.PlaneGeometry(.2, .14, 10, 8); { const a = bagGeo.attributes.position; for (let i = 0; i < a.count; i++) { const x = a.getX(i), y = a.getY(i); const u = x / .1, v = y / .07; let z = .009 * (1 - u * u) * (1 - v * v) + .0015 * Math.sin(x * 70) * (1 - v * v); if (y < -.055) z -= (-.055 - y) * 1.3; a.setZ(i, z); } bagGeo.computeVertexNormals(); } // puffed in the middle, the front edge (−y before turning) bends down over the lip
  const bagFilm = material('#e8f0f2', { transparent: true, opacity: .2, roughness: .14, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 });
  const bag = new THREE.Mesh(bagGeo, bagFilm); bag.rotation.x = -Math.PI / 2; bag.position.set(.12, BAG_Y + .004, BAG_Z); bag.renderOrder = 2; shelf.add(bag);
  { const seal = new THREE.Mesh(new THREE.PlaneGeometry(.2, .012), material('#f4f6f2', { transparent: true, opacity: .55, roughness: .3, side: THREE.DoubleSide, depthWrite: false })); seal.rotation.x = -Math.PI / 2; seal.position.set(0, .057, .0075); bag.add(seal); seal.rotation.set(0, 0, 0); } // the zip strip at the back edge
  const bagShard = makeShard(2); bagShard.scale.setScalar(.45); bagShard.rotation.set(-Math.PI / 2, 0, .04); bagShard.position.set(.12, BAG_Y + .0082, BAG_Z - .004); shelf.add(bagShard); // lying face up inside, seen through the film
  const tapeMatB = material('#ddd3ae', { transparent: true, opacity: .78, roughness: .55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const bagTape = new THREE.Group(); shelf.add(bagTape); // the parts on the bag (they go with it)
  for (const x of [.055, .185]) {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(.026, .055), tapeMatB); top.rotation.x = -Math.PI / 2; top.rotation.z = (x - .12) * .6; top.position.set(x, BAG_Y + .0115, .1935); bagTape.add(top);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(.026, .04), tapeMatB); front.position.set(x, SH[2] + .0005, .2215); shelf.add(front); // folded down the lip: stays when the bag is torn away
  }
  contactShadow([.24, .17], [.12, SH[2] + .0092, BAG_Z], { opacity: .25, parent: bagTape }); // goes with the bag
  const paperLabel = paperSheet(paper({ kind: 'tag', w: 640, h: 380, bg: '#ece6d2', ink: '#3a3328', title: '保管品', meta: '2030.9.25', titleSize: 30, bodySize: 21, hand: true, body: ['品名：手動復旧プレート（破損・中片）', '処置：撤去まで袋のまま備品棚に保管', '担当：設備係 佐伯'] }), [.16, .095], [.12, SH[2] - .06, .222], shelf, { tape: true, curl: .003, shadow: false }); // hanging from the shelf lip
  // fourth: two helmets stacked, a torch, a box of batteries
  for (const [i, y] of [[0, 0], [1, .07]]) { const h = new THREE.Mesh(new THREE.SphereGeometry(.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), material('#efeee6', { roughness: .4 })); h.position.set(-.24, SH[3] + .01 + y, .02); h.castShadow = true; shelf.add(h); const brim = cylinder(.15, .01, [-.24, SH[3] + .015 + y, .02], material('#e6e5dc', { roughness: .45 }), shelf, 24); }
  { const torch = cylinder(.025, .2, [.1, SH[3] + .035, .08], material('#2a2c2b', { roughness: .5 }), shelf, 14); torch.rotation.z = Math.PI / 2; const lens = cylinder(.03, .03, [.21, SH[3] + .035, .08], material('#8f8f86', { metalness: .6 }), shelf, 14); lens.rotation.z = Math.PI / 2; }
  box([.14, .08, .1], [.3, SH[3] + .05, -.05], material('#2f5aa8', { roughness: .6 }), shelf); labelOn(['単3 ×20'], [.1, .04], [.3, SH[3] + .05, .001], '#2f5aa8', '#ffffff');
  // top: a folded floor sign and a rolled banner, dust on the shelf
  { const sign = box([.3, .02, .6], [-.1, SH[4] + .02, 0], material('#e3c22b', { roughness: .6 }), shelf); sign.rotation.y = .4; const banner = cylinder(.035, .8, [.15, SH[4] + .045, -.1], material('#e8e6de', { roughness: .8 }), shelf, 12); banner.rotation.z = Math.PI / 2; banner.rotation.y = .15; }
  for (const y of SH.slice(1)) { const d = new THREE.Mesh(new THREE.PlaneGeometry(.86, .4), new THREE.MeshBasicMaterial({ map: dustPile(), transparent: true, opacity: .35, depthWrite: false })); d.rotation.x = -Math.PI / 2; d.position.set(0, y + .011, 0); shelf.add(d); }
  register('label', '備品棚の袋', [paperLabel, bag, ...bagShard.userData.meshes], [2.78, .975, 4.39], [2.75, 1.3, 3.55], [2.78, .96, 4.4]);
  const waxTray = box([.5, .025, .36], [-3.3, .91, 1.22], edgeMaterial);
  const tin = cylinder(.1, .12, [-3.3, .98, 1.22], material('#9b9d86'), scene, 16);
  const seal = cylinder(.104, .025, [-3.3, 1.04, 1.22], material('#6e4a2e', { roughness: 1 }), scene, 16);
  register('wax', 'トレーの上の缶', [tin, seal, waxTray], [-3.3, 1.05, 1.22], [-2.3, 1.5, 1.22]);
  const repair = paperSheet(paper({ w: 1024, h: 840, bg: '#b9b39c', title: '業務引継ぎ票', meta: '2030年9月25日　設備係', titleSize: 34, bodySize: 22, stamp: '未了', hand: true, body: [
    '件名：避難誘導体験室 制御盤　手動復旧プレートの破損',
    '経緯：撤去作業中に刻印入りプレートが三片に割れた。再発注は閉館に伴い却下。',
    '仮保管：左片＝管理机 引き出し／中片＝備品棚 三段目（袋）／右片＝工具缶（トレー上）',
    '接合：背面の線が端から端まで一本につながるように合わせること。刻印は接合後に読む。',
    '未了：訓練設備の停止。人感センサーが入室を検知すると、待機室の照明が落ち、防火扉が閉まる（シナリオの STEP 0）。シナリオ配信（市クラウド）の契約は2031年3月まで有効。',
    '未了：パートナーAI各社への接続停止の依頼。連携契約は2029年3月で終了したが、2028年6月に一斉配信した訓練データは各社のAIに残っている（担当者退職により未対応）。',
    '引継ぎ先：未定（担当 佐伯 2030年9月末 退職）'
  ] }), [.7, .574], [-.6, 1.85, 4.812], scene, { pins: true }); repair.rotation.y = Math.PI;
  register('repair', '壁の引継ぎメモ', [repair], [-.6, 1.85, 4.7], [-.6, 1.85, 3.3]);
  const wallLamp = new THREE.PointLight('#e8e2c8', 2.2, 3.5, 2); wallLamp.position.set(-.2, 2.6, 4.3); scene.add(wallLamp); // a weak lamp over the notices on the back wall

  // ── Litter: what people left behind. Cans (12 segments, some crushed), snack bags, a bento tray, a newspaper.
  const canSide = tex => material('#ffffff', { map: tex, metalness: .55, roughness: .32 });
  function makeCan(tex, { r = .033, h = .122, crush = 0, seed = 1, tab = true } = {}) {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(r, r, h, 12, 6, true);
    if (crush) { // dented top and bottom thirds, the middle buckled in on one side; the can is also a little shorter
      const a = geo.attributes.position; const rnd = seeded(seed);
      for (let i = 0; i < a.count; i++) {
        const x = a.getX(i), y = a.getY(i), z = a.getZ(i); const t = y / h + .5; const ang = Math.atan2(z, x);
        const ends = Math.max(0, Math.abs(t - .5) - .25) * 4;                          // 0 in the middle, 1 at the rims
        const fold = Math.abs(t - .5) < .14 && Math.abs(ang - 1.1) < .55 ? .45 * (1 - Math.abs(ang - 1.1) / .55) : 0; // one sharp crease on the buckled side
        const k = 1 - crush * (.12 + .3 * ends + .25 * Math.max(0, Math.cos(ang - 1.1)) * (1 - ends) + fold) * (.7 + rnd() * .6);
        a.setX(i, x * k); a.setZ(i, z * k); a.setY(i, y * (1 - crush * .4) + (rnd() - .5) * crush * .006);
      }
      geo.computeVertexNormals();
    }
    const side = new THREE.Mesh(geo, canSide(tex)); side.castShadow = true; g.add(side);
    const hh = h * (1 - crush * .4) / 2;
    for (const sy of [-1, 1]) {
      const sc = sy > 0 ? 1 - crush * .25 : 1 - crush * .15;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * .84, r * .9, .004, 12), bareMetal); cap.position.y = sy * (hh - .002); cap.scale.setScalar(sc); g.add(cap);
      for (const rr of [r * .9, r * .82]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(rr * sc, .0012, 4, 12), bareMetal); rim.rotation.x = Math.PI / 2; rim.position.y = sy * hh; g.add(rim); } // double seam ring
      if (sy < 0) { const dome = new THREE.Mesh(new THREE.CylinderGeometry(r * .6 * sc, r * .62 * sc, .003, 12), material('#5a615c', { metalness: .7, roughness: .5 })); dome.position.y = -hh + .003; g.add(dome); } // recessed bottom
    }
    if (tab) {
      const sc = 1 - crush * .25;
      const hole = box([.009, .001, .012], [0, hh + .0005, .008 * sc], material('#0d0f0e', { roughness: .9 }), g); hole.castShadow = false; // opened mouth
      const t = box([.014, .0015, .008], [0, hh + .002, -.004], bareMetal, g); t.castShadow = false; t.rotation.x = .35;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.004, .0012, 4, 10), bareMetal); ring.rotation.x = Math.PI / 2 + .35; ring.position.set(0, hh + .004, .003); g.add(ring);
    }
    g.userData.hh = hh; g.userData.r = r;
    return g;
  }
  const beerTex = [canTexture({ base: '#b8202a', text: '二番搾り', textColor: '#ffffff' }), canTexture({ base: '#c9ccd0', band: true, bandColor: '#c8102e', text: 'スーパーウェット', textColor: '#ffffff' }), canTexture({ base: '#15161a', star: true, text: '黒レーベル', textColor: '#d4af37' })];
  const litter = [];
  const placeCan = (can, [x, y, z], { lying = false, yaw = 0, roll = 0 } = {}) => {
    if (lying) { can.rotation.set(Math.PI / 2 + roll, yaw, 0, 'YXZ'); can.position.set(x, y + can.userData.r * (1 - .1), z); contactShadow([can.userData.hh * 2.4, can.userData.r * 3], [x, .003, z], { opacity: .5 }).rotation.z = yaw; }
    else { can.rotation.set(0, yaw, roll); can.position.set(x, y + can.userData.hh, z); contactShadow([can.userData.r * 3.2, can.userData.r * 3.2], [x, .003, z], { opacity: .55 }); }
    scene.add(can); litter.push(can); return can;
  };
  // (2) three crushed beer cans under the desk, by the wall
  placeCan(makeCan(beerTex[0], { crush: .55, seed: 5 }), [-3.52, 0, .95], { yaw: .4, roll: .06 });
  placeCan(makeCan(beerTex[1], { crush: .35, seed: 9 }), [-3.33, 0, 1.12], { lying: true, yaw: 1.1, roll: .0 });
  placeCan(makeCan(beerTex[2], { crush: .7, seed: 13 }), [-3.62, 0, .72], { yaw: -.8, roll: -.05 });
  register('cans', '机の下の空き缶', [proxy('cans', [.5, .16, .55], [-3.48, .07, .92])], [-3.45, .1, .92], [-2.8, .62, .95], [-3.48, .05, .92]);
  // (3) snack bags by the chair, with crumbs
  const wrapperGeo = (wd, ht, seed) => { const geo = new THREE.PlaneGeometry(wd, ht, 7, 9); const a = geo.attributes.position; const rnd = seeded(seed); for (let i = 0; i < a.count; i++) { const x = a.getX(i), y = a.getY(i); a.setZ(i, .006 * Math.sin(x * 60 + seed) * Math.cos(y * 45) + (rnd() - .5) * .006 + .012 * (x / wd) * (x / wd)); } geo.computeVertexNormals(); return geo; };
  const wrapMat = tex => material('#ffffff', { map: tex, metalness: .25, roughness: .35, side: THREE.DoubleSide });
  const bagA = new THREE.Mesh(wrapperGeo(.15, .2, 3), wrapMat(wrapperTexture({ base: '#f2c21c', accent: '#d7263d', text: 'ポテトチッピス', sub: 'うすしお味' }))); bagA.rotation.set(-Math.PI / 2 + .08, 0, .6); bagA.position.set(-1.95, .012, .35); scene.add(bagA);
  const bagB = new THREE.Mesh(wrapperGeo(.13, .17, 8), wrapMat(wrapperTexture({ base: '#9fd3e8', accent: '#7a4a2a', text: 'カントリーママ', sub: 'バニラ' }))); bagB.rotation.set(-Math.PI / 2 - .06, 0, -.9); bagB.position.set(-2.18, .01, .62); scene.add(bagB);
  const foil = material('#d9dbd6', { metalness: .9, roughness: .3, side: THREE.DoubleSide });
  for (const [bag, wdt] of [[bagA, .15], [bagB, .13]]) { // the torn-open end: a jagged flap folded back showing the aluminium inside
    const shape = new THREE.Shape(); shape.moveTo(-wdt / 2, 0); for (let i = 1; i <= 6; i++) shape.lineTo(-wdt / 2 + wdt * i / 6, i % 2 ? .018 : .006); shape.lineTo(wdt / 2, .03); shape.lineTo(-wdt / 2, .03); shape.closePath();
    const flap = new THREE.Mesh(new THREE.ShapeGeometry(shape), foil); flap.position.set(0, (bag === bagA ? .2 : .17) / 2 - .002, .004); flap.rotation.x = -.5; bag.add(flap);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(wdt * .9, .02), foil); inner.position.set(0, (bag === bagA ? .2 : .17) / 2 - .012, .002); bag.add(inner);
  }
  contactShadow([.26, .3], [-1.95, .003, .35], { opacity: .35 }).rotation.z = .6; contactShadow([.22, .26], [-2.18, .003, .62], { opacity: .35 }).rotation.z = -.9;
  { const rnd = seeded(27); for (let i = 0; i < 14; i++) { const c = box([.004 + rnd() * .005, .003, .004 + rnd() * .004], [-2.05 + (rnd() - .5) * .5, .0025, .48 + (rnd() - .5) * .45], material('#8a6a3a', { roughness: 1 })); c.rotation.y = rnd() * 3; c.castShadow = false; } }
  register('wrappers', '床の空き袋', [proxy('wrappers', [.6, .08, .6], [-2.06, .03, .48])], [-2.06, .06, .48], [-1.78, .78, .12], [-2.06, .01, .48]);
  // (1) a folded newspaper on the end of the desk: the top half of the front page lies on top, lifted a little at the open edge
  const newsTex = newspaperTexture(); const newsBump = paperBump();
  const newsMat = material('#ffffff', { map: newsTex, bumpMap: newsBump, bumpScale: .0015, roughness: .97, side: THREE.DoubleSide });
  const newspaper = new THREE.Group(); newspaper.position.set(1.2, .878, .8); newspaper.rotation.y = .18; desk.add(newspaper);
  const halfGeo = (lo, hi) => { const geo = new THREE.PlaneGeometry(.27, .2); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, lo + uv.getY(i) * (hi - lo)); return geo; };
  const newsBottom = new THREE.Mesh(halfGeo(0, .5), newsMat); newsBottom.rotation.x = -Math.PI / 2; newspaper.add(newsBottom);
  const newsFold = new THREE.Group(); newsFold.position.set(0, .0015, -.1); newsFold.rotation.x = -.09; newspaper.add(newsFold);
  const newsTop = new THREE.Mesh(halfGeo(.5, 1), newsMat); newsTop.rotation.x = -Math.PI / 2; newsTop.position.z = .1; newsFold.add(newsTop);
  for (const m of [newsTop, newsBottom]) { m.castShadow = true; m.receiveShadow = true; }
  contactShadow([.32, .25], [1.2, .877, .8], { opacity: .3, parent: desk }).rotation.z = .18;
  register('newspaper', '机の上の古い新聞', [newsTop, newsBottom], [-3.0, .96, -1.4], [-2.72, 1.42, -1.22], [-3.02, .88, -1.3]);
  // (4) a convenience-store bag and an empty bento tray beside the vending machine in the experience room
  // Convenience-store bag: tall, handles tied at the top, the bottom bulging with whatever is in it, a blue band of a store logo.
  const bagMat = material('#f6f6f2', { transparent: true, opacity: .45, roughness: .3, side: THREE.DoubleSide });
  const plasticBag = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), bagMat); plasticBag.scale.set(.1, .15, .09); plasticBag.position.set(15.3, .14, 1.72); plasticBag.rotation.set(.12, .5, .08);
  { const a = plasticBag.geometry.attributes.position; const rnd = seeded(37); for (let i = 0; i < a.count; i++) { const y = a.getY(i); const k = (.84 + rnd() * .28) * (y < -.2 ? 1.18 : y > .55 ? .55 + (1 - y) * .5 : 1); a.setX(i, a.getX(i) * k); a.setZ(i, a.getZ(i) * k); if (y > .6) a.setY(i, .6 + (y - .6) * 1.4); } plasticBag.geometry.computeVertexNormals(); }
  scene.add(plasticBag);
  { const knot = new THREE.Mesh(new THREE.SphereGeometry(.018, 8, 6), bagMat); knot.position.set(15.3, .31, 1.72); scene.add(knot);
    for (const [rz, dx] of [[.5, .02], [-.6, -.02]]) { const loop = new THREE.Mesh(new THREE.TorusGeometry(.028, .004, 4, 10), bagMat); loop.position.set(15.3 + dx, .34, 1.72); loop.rotation.set(.2, .4, rz); loop.scale.set(1, 1.4, 1); scene.add(loop); }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.1, .11, .024, 14, 1, true), material('#1f5fa8', { transparent: true, opacity: .55, roughness: .4, side: THREE.DoubleSide })); band.position.set(15.3, .13, 1.72); band.rotation.y = .5; band.scale.set(1.0, 1, .9); scene.add(band); }
  contactShadow([.3, .28], [15.3, .003, 1.72], { opacity: .35 });
  // Bento: black PP tray (rounded rectangle, three compartments, a rib round the rim, greasy sheen), rice grains and a soy stain,
  // a frosted clear lid warped so one side lifts, chopsticks, a rubber band, and the price label on the lid.
  const bento = new THREE.Group(); bento.position.set(15.05, 0, 1.62); bento.rotation.y = -.35; scene.add(bento);
  const roundRectShape = (wd, ht, rad) => { const sh = new THREE.Shape(); sh.moveTo(-wd / 2 + rad, -ht / 2); sh.lineTo(wd / 2 - rad, -ht / 2); sh.quadraticCurveTo(wd / 2, -ht / 2, wd / 2, -ht / 2 + rad); sh.lineTo(wd / 2, ht / 2 - rad); sh.quadraticCurveTo(wd / 2, ht / 2, wd / 2 - rad, ht / 2); sh.lineTo(-wd / 2 + rad, ht / 2); sh.quadraticCurveTo(-wd / 2, ht / 2, -wd / 2, ht / 2 - rad); sh.lineTo(-wd / 2, -ht / 2 + rad); sh.quadraticCurveTo(-wd / 2, -ht / 2, -wd / 2 + rad, -ht / 2); return sh; };
  const ppBlack = material('#141412', { roughness: .25, metalness: .05 });
  { const walls = roundRectShape(.19, .13, .014); walls.holes.push(roundRectShape(.176, .116, .01));
    const wallMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(walls, { depth: .032, bevelEnabled: false, curveSegments: 4 }), ppBlack); wallMesh.rotation.x = -Math.PI / 2; wallMesh.position.y = 0; bento.add(wallMesh);
    const rib = roundRectShape(.196, .136, .016); rib.holes.push(roundRectShape(.182, .122, .012));
    const ribMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(rib, { depth: .003, bevelEnabled: false, curveSegments: 4 }), ppBlack); ribMesh.rotation.x = -Math.PI / 2; ribMesh.position.y = .032; bento.add(ribMesh);
    const floorMesh = new THREE.Mesh(new THREE.ShapeGeometry(roundRectShape(.178, .118, .01), 4), ppBlack); floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.y = .003; bento.add(floorMesh);
    box([.003, .026, .116], [.02, .016, 0], ppBlack, bento); box([.07, .026, .003], [.055, .016, -.01], ppBlack, bento);          // compartments: rice left, two side dishes right
    const grease = new THREE.Mesh(new THREE.PlaneGeometry(.17, .11), material('#2a2622', { roughness: .12, metalness: .1, transparent: true, opacity: .5 })); grease.rotation.x = -Math.PI / 2; grease.position.y = .0045; bento.add(grease);
    const soy = new THREE.Mesh(new THREE.PlaneGeometry(.06, .05), new THREE.MeshBasicMaterial({ map: stainDisc(), transparent: true, opacity: .9, color: '#8a5a1a', depthWrite: false })); soy.rotation.x = -Math.PI / 2; soy.position.set(.05, .005, .02); bento.add(soy);
    const rnd = seeded(53); for (let i = 0; i < 9; i++) { const grain = new THREE.Mesh(new THREE.SphereGeometry(.0028, 6, 4), material('#f0ede0', { roughness: .4 })); grain.scale.set(1.6, .8, 1); grain.position.set(-.07 + rnd() * .07, .006, -.04 + rnd() * .08); grain.rotation.y = rnd() * 3; grain.castShadow = false; bento.add(grain); }
    const lidMat = material('#eef2f0', { transparent: true, opacity: .32, roughness: .35, side: THREE.DoubleSide });
    const lid = new THREE.Mesh(new THREE.BoxGeometry(.196, .022, .136), lidMat); lid.position.set(.008, .05, .004); lid.rotation.set(.06, .03, .1); bento.add(lid); // warped: the right side lifts off the rib
    const labelTex = canvasTexture(256, 128, (ctx, w, h) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '700 26px "Noto Sans JP", sans-serif'; ctx.fillText('幕の内弁当', 12, 28); ctx.font = '700 30px sans-serif'; ctx.fillText('¥498', 170, 28); ctx.font = '13px "Noto Sans JP", sans-serif'; ctx.fillText('消費期限 29.3.30 午前2時', 12, 56); ctx.fillText('要冷蔵 10℃以下　汐見デリカ', 12, 74); const r = seeded(21); let x = 12; while (x < 190) { const wdt = 1 + Math.floor(r() * 3); ctx.fillRect(x, 86, wdt, 32); x += wdt + 1 + Math.floor(r() * 3); } ctx.font = '10px monospace'; ctx.fillText('4 901234 567894', 60, 124); });
    const priceLabel = new THREE.Mesh(new THREE.PlaneGeometry(.07, .035), material('#ffffff', { map: labelTex, roughness: .5 })); priceLabel.rotation.x = -Math.PI / 2; priceLabel.position.set(-.04, .0121, .03); priceLabel.rotation.z = .08; lid.add(priceLabel);
    const stick = material('#d9c39a', { roughness: .8 });
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(.0022, .003, .2, 6), stick); s1.rotation.set(0, 0, Math.PI / 2); s1.rotation.y = .5; s1.position.set(.07, .04, .07); s1.rotation.x = -.14; bento.add(s1); // one resting on the tray rim
    const s2 = new THREE.Mesh(new THREE.CylinderGeometry(.0022, .003, .2, 6), stick); s2.rotation.set(0, 0, Math.PI / 2); s2.rotation.y = .62; s2.position.set(.1, .003, .1); bento.add(s2);           // the other on the floor
    const band = new THREE.Mesh(new THREE.TorusGeometry(.03, .0014, 4, 16), material('#c9b08a', { roughness: .8 })); band.rotation.x = Math.PI / 2; band.scale.set(1.4, .7, 1); band.position.set(-.12, .002, .06); bento.add(band); }
  contactShadow([.3, .22], [15.05, .003, 1.62], { opacity: .45 }).rotation.z = -.35;
  register('lobby-trash', '自販機の横のごみ', [proxy('lobby-trash', [.5, .25, .4], [15.18, .1, 1.67])], [15.2, .14, 1.67], [14.55, .85, 1.72], [15.18, .05, 1.67]);
  // (5) two coffee cans under the bench
  const coffeeTex = [canTexture({ base: '#4a2e1f', text: 'BASS', textColor: '#f2e6c8', small: 'RAINBOW MOUNTAIN BLEND 185g' }), canTexture({ base: '#dfe7ee', band: true, bandColor: '#1f5fa8', text: 'ジョージィア', textColor: '#ffffff', small: 'EMERALD MOUNTAIN 185g' })];
  placeCan(makeCan(coffeeTex[0], { r: .026, h: .104, seed: 17 }), [14.32, 0, 1.22], { yaw: .3 });
  placeCan(makeCan(coffeeTex[1], { r: .026, h: .104, seed: 19 }), [14.1, 0, 1.0], { lying: true, yaw: 2.2 });
  register('lobby-cans', 'ベンチの下の缶コーヒー', [proxy('lobby-cans', [.45, .14, .45], [14.22, .06, 1.12])], [14.22, .1, 1.1], [14.2, .32, .55], [14.22, .05, 1.12]);
  // (6) a crushed can and a paper cup at the foot of the emergency stairs
  placeCan(makeCan(beerTex[1], { crush: .6, seed: 23 }), [3.78, 0, -.32], { lying: true, yaw: .7, roll: .2 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(.036, .026, .09, 12, 1, true), material('#efece4', { roughness: .8, side: THREE.DoubleSide })); cup.position.set(3.6, .045, -.86); cup.rotation.set(0, .3, .18); scene.add(cup);
  { const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(.026, .026, .003, 12), material('#e4e0d4', { roughness: .8 })); cupBase.position.y = -.044; cup.add(cupBase); const stripe = new THREE.Mesh(new THREE.CylinderGeometry(.0365, .034, .012, 12, 1, true), material('#c43b2e', { roughness: .7, side: THREE.DoubleSide })); stripe.position.y = .03; cup.add(stripe); const rim = new THREE.Mesh(new THREE.TorusGeometry(.036, .0025, 5, 12), material('#efece4', { roughness: .8 })); rim.rotation.x = Math.PI / 2; rim.position.y = .045; cup.add(rim);
    const step = new THREE.Mesh(new THREE.TorusGeometry(.0255, .0015, 4, 12), material('#e4e0d4', { roughness: .8 })); step.rotation.x = Math.PI / 2; step.position.y = -.041; cup.add(step);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.0335, .0012, 4, 12), material('#6a4a2a', { roughness: .9 })); ring.rotation.x = Math.PI / 2; ring.position.y = .022; cup.add(ring); // dried coffee ring inside
    const dregs = new THREE.Mesh(new THREE.CircleGeometry(.025, 12), material('#4a2e18', { roughness: .4 })); dregs.rotation.x = -Math.PI / 2; dregs.position.y = -.042; cup.add(dregs); }
  contactShadow([.12, .12], [3.6, .003, -.86], { opacity: .45 });
  register('stairs-cans', '階段の下のごみ', [proxy('stairs-cans', [.5, .14, .75], [3.7, .06, -.6])], [3.7, .1, -.6], [3.05, .6, -.6], [3.7, .04, -.6]);
  // (7) cigarette butts, a little ash, an empty flip-top pack and a disposable lighter under the desk; two more butts by the vending machine
  const buttPaper = material('#ece8dc', { roughness: .9 }), buttFilter = material('#c08a4a', { roughness: .85 }), buttTip = material('#1a1714', { roughness: 1 });
  const butt = ([x, z], yaw, { bend = .25, squash = 1, len = .024 } = {}) => {
    const g = new THREE.Group(); g.position.set(x, .0035 * squash, z); g.rotation.set(0, yaw, 0); g.scale.y = squash;
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, len, 8), buttPaper); paper.rotation.z = Math.PI / 2; paper.position.x = len / 2; g.add(paper);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(.0028, .0035, .004, 8), buttTip); tip.rotation.z = Math.PI / 2; tip.position.x = len + .002; g.add(tip);
    const filt = new THREE.Group(); filt.rotation.y = bend; g.add(filt);                                          // the filter end bent a little
    const f = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, .01, 8), buttFilter); f.rotation.z = Math.PI / 2; f.position.x = -.005; filt.add(f);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(.0036, .0036, .001, 8), material('#8a5a2a')); ring.rotation.z = Math.PI / 2; ring.position.x = -.0005; filt.add(ring);
    g.traverse(o => { if (o.isMesh) o.castShadow = false; }); scene.add(g); return g;
  };
  butt([-3.14, 1.33], .3); butt([-3.06, 1.27], -1.2, { bend: .4, squash: .7 }); butt([-3.2, 1.22], 2.4, { bend: .1, len: .02 }); butt([-3.0, 1.36], 1.6, { squash: .6 }); butt([-3.12, 1.4], -.5, { bend: .5, len: .028 });
  for (const [x, z, r, sy] of [[-3.12, 1.3, .02, .22], [-3.09, 1.335, .011, .3], [-3.15, 1.27, .008, .35]]) { const ash = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 5), material('#8c8c86', { roughness: 1 })); ash.scale.set(1.3, sy, 1); ash.position.set(x, r * sy * .9, z); ash.castShadow = false; scene.add(ash); } // ash in uneven heaps
  { const rnd = seeded(47); for (let i = 0; i < 16; i++) { const p = box([.003, .002, .003], [-3.12 + (rnd() - .5) * .09, .001, 1.3 + (rnd() - .5) * .08], material(rnd() > .5 ? '#9a9a94' : '#5a5a56', { roughness: 1 })); p.castShadow = false; } }
  const packTex = canvasTexture(128, 192, (ctx, w, h) => { ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#2a63b8'; ctx.fillRect(0, 0, w, 44); ctx.fillStyle = '#d7263d'; ctx.fillRect(0, 44, w, 6); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 17px sans-serif'; ctx.fillText('MILD EIGHT', w / 2, 22); ctx.fillStyle = '#2a63b8'; ctx.font = '700 13px sans-serif'; ctx.fillText('ORIGINAL', w / 2, 70); ctx.fillStyle = '#333'; ctx.font = '9px sans-serif'; ctx.fillText('20 CLASS A CIGARETTES', w / 2, h - 30); ctx.fillStyle = '#222'; ctx.fillRect(10, h - 20, w - 20, 10); ctx.fillStyle = '#fff'; ctx.font = '7px sans-serif'; ctx.fillText('喫煙は健康に害を及ぼします', w / 2, h - 15); });
  const packSide = material('#f4f2ec', { roughness: .6 });
  const pack = new THREE.Mesh(new THREE.BoxGeometry(.055, .07, .022), [packSide, packSide, material('#e8e4d8'), packSide, material('#ffffff', { map: packTex, roughness: .55 }), packSide]);
  pack.position.set(-2.98, .011, 1.44); pack.rotation.set(-Math.PI / 2, 0, .4); scene.add(pack);                                           // on its back, face up
  const packLid = box([.055, .02, .022], [0, 0, 0], packSide, pack); packLid.geometry.translate(0, .01, -.011); packLid.position.set(0, .035, .011); packLid.rotation.x = 1.9; // flip-top thrown open
  const packFoil = box([.05, .004, .018], [0, .03, .0], material("#c9c6b8", { metalness: .6, roughness: .4 }), pack); packFoil.castShadow = false;
  contactShadow([.1, .12], [-2.98, .003, 1.44], { opacity: .4 }).rotation.z = .4;
  const lighterBody = new THREE.Mesh(new THREE.BoxGeometry(.024, .07, .012), material('#2fa44a', { transparent: true, opacity: .62, roughness: .25 })); lighterBody.position.set(-3.02, .006, 1.18); lighterBody.rotation.set(0, .9, Math.PI / 2); scene.add(lighterBody);
  const lighterHead = box([.024, .012, .012], [0, .041, 0], bareMetal, lighterBody); const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.005, .005, .006, 10), bareMetal); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, .05, 0); lighterBody.add(wheel);
  box([.01, .008, .006], [.006, .038, .007], material('#d7263d', { roughness: .4 }), lighterBody).castShadow = false; // thumb lever
  contactShadow([.1, .06], [-3.02, .003, 1.18], { opacity: .35 }).rotation.z = .9;
  register('cigarettes', '机の下の吸い殻', [proxy('cigarettes', [.42, .08, .4], [-3.08, .03, 1.3])], [-3.08, .06, 1.3], [-2.6, .7, 1.3], [-3.1, .03, 1.3]);
  butt([15.12, 1.88], 1.1, { bend: .3, squash: .8 }); butt([15.22, 1.97], -2.0, { len: .021 });
  lighter.visible = false; shard1.visible = false;
  // ── Lighting. Every lamp is a point light with inverse-square falloff (decay 2), so the corners and the doorways stay dark
  // while the things under a lamp are clearly lit. Only the ceiling lamp casts shadows.
  const ambient = new THREE.HemisphereLight('#9fb3ab', '#2a3024', .12);
  scene.add(ambient);
  const CEIL_ON = 26, CEIL_OFF = .5;                                   // emergency tube: fluorescent, slightly green
  const ceilingLight = new THREE.PointLight('#d2e4cb', CEIL_OFF, 16, 2);
  ceilingLight.position.set(0, 3.62, -.8);
  ceilingLight.castShadow = true;
  ceilingLight.shadow.mapSize.set(1024, 1024);
  ceilingLight.shadow.bias = -.002; ceilingLight.shadow.radius = 3;
  scene.add(ceilingLight);
  const DESK_ON = 3.2, DESK_OFF = .2;                                  // desk lamp: warm tungsten, a cone from under the shade onto the top
  const deskLight = new THREE.SpotLight('#f2c084', DESK_OFF, 3.2, .95, .75, 2);
  deskLight.position.set(-3.27, 1.27, 1.06); deskLight.target.position.set(-3.26, .86, .86); // centred just past the memo's top edge so the sheet is lit, not burnt out
  scene.add(deskLight, deskLight.target);
  // The stairwell has an emergency bulkhead on the landing wall, behind the grille: enough to outline the upper steps, the rails
  // and the bars from the doorway; the broken flight below stays in the torch's charge.
  const stairLight = new THREE.PointLight('#b9c8d2', 1.5, 5.5, 2); stairLight.position.set(7.4, 3.05, -.65); scene.add(stairLight);
  // Only the lights of the space you are in are switched on (the two spaces never share a view): phones evaluate every light
  // for every pixel, so this halves the cost. Two light sets → two shader variants, compiled once each.
  function applyZoneLights() {
    const lobby = zone === 'lobby';
    for (const l of [ceilingLight, deskLight, exitGlow, keyGlint, wallLamp, stairLight, storageLight, exitLight, footLight2, cornerLight]) l.visible = !lobby;
    for (const l of [lobbyLight, dayLight, exitLampGlow]) l.visible = lobby;
    dayLight.visible = lobby && city.visible;
  }
  rbox([.06, .12, .28], [7.78, 3.05, -.65], material('#c9ccc2', { roughness: .5 }), scene, .01); { const lens = new THREE.Mesh(new THREE.PlaneGeometry(.22, .07), material('#dfe8ee', { emissive: '#dfe8ee', emissiveIntensity: .8 })); lens.position.set(7.748, 3.05, -.65); lens.rotation.y = -Math.PI / 2; scene.add(lens); } // the bulkhead itself
  const flashlight = new THREE.SpotLight('#d8e0c2', 16, 16, .6, .7, 2);  // the phone torch, follows the camera
  scene.add(flashlight, flashlight.target);
  const exitLight = new THREE.PointLight('#e2ead8', 2.6, 3.4, 2);    // passage foot lamps: low pools on the floor, the walls dim above
  exitLight.position.set(-2.3, .42, -4.4);
  scene.add(exitLight);
  const footLight2 = new THREE.PointLight('#e2ead8', 2.2, 3.2, 2); footLight2.position.set(-2.3, .42, -6.2); scene.add(footLight2);
  const STORE_ON = 7, STORE_WALL = 12;                                 // storage: low at first (shelves only), raised to show the wall
  const storageLight = new THREE.PointLight('#c9d3c0', 0, 3.4, 2); // a short reach: the shelves and boxes, not the room behind
  storageLight.position.set(1.75, 1.1, -4.2);
  let storageBase = 0;
  scene.add(storageLight);
  // ── Dust: a few motes drifting where the tube's light falls, three sizes, slow. Only moves while the room lamp is on.
  const dust = new THREE.Group(); scene.add(dust);
  const dustTex = dustSprite(); const dustRandom = seeded(77);
  const dustBox = { x: [-1.7, 1.7], y: [.9, 3.55], z: [-2.5, .7] };
  const dustSets = [[70, .014, .32, .035], [60, .022, .22, .025], [40, .034, .14, .018]].map(([count, size, opacity, speed]) => {
    const positions = new Float32Array(count * 3); const drift = new Float32Array(count);
    for (let i = 0; i < count; i++) { positions.set([dustBox.x[0] + dustRandom() * 3.4, dustBox.y[0] + dustRandom() * 2.65, dustBox.z[0] + dustRandom() * 3.2], i * 3); drift[i] = dustRandom() * Math.PI * 2; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ map: dustTex, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, color: '#e9e6d2' }));
    points.frustumCulled = false; dust.add(points);
    return { points, drift, speed, count };
  });
  dust.visible = false;
  function driftDust(dt, time) {
    for (const set of dustSets) {
      const a = set.points.geometry.attributes.position;
      for (let i = 0; i < set.count; i++) {
        const phase = set.drift[i] + time * .0004;
        let x = a.getX(i) + Math.sin(phase) * dt * .03, y = a.getY(i) - set.speed * dt * (0.6 + Math.sin(phase * 1.7) * .4), z = a.getZ(i) + Math.cos(phase * .8) * dt * .025;
        if (y < dustBox.y[0]) { y = dustBox.y[1]; x = dustBox.x[0] + dustRandom() * 3.4; z = dustBox.z[0] + dustRandom() * 3.2; }
        a.setXYZ(i, x, y, z);
      }
      a.needsUpdate = true;
    }
  }

  function freeLook() {
    const tilt = zone === 'lobby' ? -.22 : 0; // the experience room's things are low (bench, cable): the default gaze dips a little
    lookGoal.set(basePosition.x + Math.sin(yaw) * 6, basePosition.y + Math.sin(pitch + tilt) * 4, basePosition.z - Math.cos(yaw) * 6);
  }
  // The canvas fills the screen down to the bottom edge, under the talk. The picture is framed for the part above the talk
  // (CSS --frame on the host: the height kept for the talk), and the rest is the same view carried on downward (setViewOffset).
  // Markers stay inside the framed part.
  let frameInset = 0, frameAspect = 1, frameFov = 54, sizedW = -1, sizedH = -1;
  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    frameInset = Math.max(0, Math.min(height * .5, parseFloat(getComputedStyle(host).getPropertyValue('--frame')) || 0));
    // Resizing the canvas reallocates the drawing buffer (multisampled, so costly): only when the size really changed.
    if (width !== sizedW || height !== sizedH) { sizedW = width; sizedH = height; renderer.setSize(width, height, false); }
    applyFov();
    dirty = true;
  }
  // Widescreen crops the top of the storage wall: a wider vertical field there so the writing above the shelves stays in frame.
  function applyFov() {
    const frameH = Math.max(1, height - frameInset); frameAspect = width / frameH;
    const fov = zone === 'storage' ? (frameAspect < 1 ? 62 : 70) : width < 700 ? 66 : 54; frameFov = fov;
    if (frameInset > 0) {
      const fullH = frameH + 2 * frameInset;
      camera.fov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * fullH / frameH) * 180 / Math.PI;
      camera.aspect = width / fullH;
      camera.setViewOffset(width, fullH, 0, frameInset, width, height);
    } else { camera.fov = fov; camera.aspect = frameAspect; camera.clearViewOffset(); }
    camera.updateProjectionMatrix(); dirty = true;
  }
  // Looking around inside the storage room: ±35° sideways, −10°…+30° up and down, from the fixed standing spot by the door.
  const STORAGE_EYE = [1.75, 1.45, -3.2];
  function storageLook() {
    yaw = Math.max(-.61, Math.min(.61, yaw)); pitch = Math.max(-.35, Math.min(.52, pitch)); // −20°…+30°: the floor by the shelves must be reachable
    const p = pitch + .113; // default gaze is slightly upward, at the shelves
    lookGoal.set(STORAGE_EYE[0] + Math.sin(yaw) * Math.cos(p) * 2.2, STORAGE_EYE[1] + Math.sin(p) * 2.2, STORAGE_EYE[2] - Math.cos(yaw) * Math.cos(p) * 2.2);
  }
  new ResizeObserver(resize).observe(host);
  resize();

  const roomOnlyIds = new Set(['pin', 'lighter', 'shard1']);
  const collectibles = new Set(['ruler', 'magnet', 'lost-key', 'water', 'lighter', 'shard1', 'label', 'wax', 'lobby-card']);
  function accessibleObject(id) {
    if (!enabled) return false;
    if (OPTIONAL.has(id) && !optionalOn.has(id)) return false; // added to the scene before the game has words for it
    if (id.startsWith('control-')) return zone === 'lobby' && focus === 'lobby-panel';
    if (id === 'lobby-panel' && !surfaces.panelFound) return false;
    if (zone === 'storage') return id.startsWith('storage-') && !focus;
    if (id.startsWith('storage-')) return false;
    if (id === 'boxes') return false; // those boxes stand inside the storage room (storage-boxes there); with its door shut the marker floated on the door
    if (zone === 'lobby' && !id.startsWith('lobby-')) return false;
    if (zone === 'room' && id.startsWith('lobby-')) return false;
    if (id === 'lobby-card' && surfaces.cardTaken) return false;
    if (held.includes(id) || (['ruler', 'magnet'].includes(id) && held.includes('magnetic-ruler')) || (id === 'lost-key' && held.includes('key'))) return false;
    if (id.startsWith('key-')) return focus === 'keypad';
    if (focus) return false;
    if (!lampOn && zone === 'room') return id === 'switch';
    if (id === 'shard1' && held.some(x => ['plate12', 'plate'].includes(x))) return false;
    if (roomOnlyIds.has(id)) return drawerOpen;
    return true;
  }
  // Markers are not lit from the start. The room itself is what you look at; a marker shows only
  //  - when the mouse comes near it or rests on its object (the dot, then its name),
  //  - for a moment around a tap on a touch screen (a tap that hits nothing shows what is near it),
  //  - faintly for the things not yet examined, after a while with nothing new found (setReveal(1), from game.js),
  //  - and fully for the one thing the last step of a hint points at (pointTo).
  // The keypad keys, the panel's buttons and the light switch in the dark are always shown. The invisible markers still
  // take taps, so a touch screen has a hit area larger than the drawn dot.
  let markersShown = false;
  let hover = null, hoverId = null, ping = null, pingTimer = 0, revealLevel = 0, hintTarget = null;
  const examined = new Set(), changed = new Set();
  function styleMarkers() {
    const now = performance.now();
    for (const [id, item] of interactables) {
      if (!item.button || item.button.hidden) continue;
      const d = hover ? Math.hypot(hover.x - item.screen.x, hover.y - item.screen.y) : Infinity;
      const pinged = ping && ping.until > now ? Math.hypot(ping.x - item.screen.x, ping.y - item.screen.y) : Infinity;
      const fixed = markersShown || id.startsWith('key-') || id.startsWith('control-') || (id === 'switch' && !lampOn);
      const pointed = id === hintTarget;
      const seen = examined.has(id) && !changed.has(id);
      const naming = item.namingUntil > now;
      const focused = document.activeElement === item.button && item.button.matches(':focus-visible');
      const onIt = d < 64 || id === hoverId || naming || focused;
      const close = d < 140 || pinged < 150;
      let o = 0, s = .6;
      if (fixed || pointed) { o = seen && !pointed ? .6 : 1; s = 1; }
      else if (onIt) { o = 1; s = 1; }
      else if (close) { o = seen ? .3 : .7; s = seen ? .5 : .75; }
      else if (revealLevel > 0 && !seen) { o = .45; s = .6; }
      item.button.classList.toggle('seen', seen); item.button.classList.toggle('changed', changed.has(id));
      item.button.classList.toggle('pointed', pointed); item.button.classList.toggle('dim', o === 0);
      item.button.style.zIndex = pointed ? '3' : o > 0 ? '2' : '1'; // an unseen hit area never covers a marker on show
      item.button.style.setProperty('opacity', String(o), 'important');
      item.button.style.setProperty('transform', `translate(-50%,-50%) scale(${s})`, 'important');
      item.button.classList.toggle('near', onIt);
      const named = (onIt || pointed) && !id.startsWith('key-');
      item.caption.style.display = named ? 'block' : 'none';
      if (named) fitCaption(item);
    }
  }
  // A name by the edge of the screen slides inward, so it always ends at least 8 px inside the picture.
  function fitCaption(item) {
    const half = item.caption.offsetWidth / 2, x = item.screen.x;
    const dx = half * 2 > width - 16 ? width / 2 - x : Math.max(0, 8 - (x - half)) + Math.min(0, width - 8 - (x + half));
    item.caption.style.transform = `translate(calc(-50% + ${Math.round(dx)}px),-2px)`;
  }
  // Where a thing is from here: 'on' (in view now), 'left' / 'right' (turn that way), or null (not there to find).
  function whereIs(id) {
    const item = interactables.get(id);
    const held = focus; focus = null; const reachable = !!item && !!item.button && accessibleObject(id); focus = held; // as seen once back from a close look
    if (!reachable || zone === 'storage') return null;
    if (!focus && !item.button.hidden) return 'on';
    if (shownFrom(item, yaw)) return 'on'; // the camera is still on its way back: it will show once there
    const toward = Math.atan2(item.point.x - basePosition.x, -(item.point.z - basePosition.z));
    let diff = toward - yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) < Math.atan(Math.tan(frameFov * Math.PI / 360) * frameAspect) * .9) {
      // Within the picture's width, but too low or high to show (under the talk): the way to turn from which its marker does show.
      const step = frameAspect < 1 ? Math.PI / 4 : Math.PI / 3, first = diff >= 0 ? 1 : -1;
      for (const d of [first, -first]) if (shownFrom(item, yaw + d * step)) return d > 0 ? 'right' : 'left';
      return 'on';
    }
    return diff > 0 ? 'right' : 'left';
  }
  // Would this thing's marker show from the standing spot, looking the way atYaw points (same test as updateMarkers)?
  const probe = new THREE.PerspectiveCamera();
  function shownFrom(item, atYaw) {
    probe.copy(camera, false); probe.position.copy(basePosition);
    const tilt = zone === 'lobby' ? -.22 : 0;
    probe.lookAt(basePosition.x + Math.sin(atYaw) * 6, basePosition.y + Math.sin(pitch + tilt) * 4, basePosition.z - Math.cos(atYaw) * 6);
    probe.updateMatrixWorld(true);
    const p = item.point.clone().project(probe);
    const sy = (1 - p.y) * height / 2, frameH = height - frameInset;
    return p.z < 1 && p.z > -1 && Math.abs(p.x) < .95 && sy > frameH * .07 && sy < frameH * .93;
  }
  function updateMarkers() {
    camera.updateMatrixWorld(true);
    const settled = camera.position.distanceToSquared(cameraGoal) + look.distanceToSquared(lookGoal) < .002;
    for (const [id, item] of interactables) {
      if (!item.button) continue;
      if (item.follow) item.follow.getWorldPosition(item.point);
      if (item.track) { item.track.getWorldPosition(item.point); item.point.y += .06; }
      const projected = item.point.clone().project(camera);
      const sy = (1 - projected.y) * height / 2, frameH = height - frameInset; // inside the framed part only, never under the talk
      const visible = settled && accessibleObject(id) && projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < .95 && sy > frameH * .07 && sy < frameH * .93;
      item.button.hidden = !visible;
      if (!visible) continue;
      item.screen.x = (projected.x + 1) * width / 2; item.screen.y = sy;
      item.button.style.left = `${item.screen.x}px`;
      item.button.style.top = `${item.screen.y}px`;
      item.button.classList.toggle('key-target', id.startsWith('key-'));
      item.button.classList.toggle('item', collectibles.has(id));
      item.button.classList.toggle('first-target', id === 'switch' && !lampOn);
    }
    styleMarkers();
  }
  function pick(clientX, clientY) {
    const rect = host.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height * 2 - 1)), camera);
    const hits = raycaster.intersectObjects(clickable, false).filter(result => accessibleObject(result.object.userData.interaction));
    if (!hits.length) return undefined;
    // A small thing lying in a larger box (the card or the cans in the bench's hit box): within 60 cm behind the first hit, the smallest wins.
    const size = r => { const g = r.object.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); return g.boundingSphere.radius * r.object.getWorldScale(new THREE.Vector3()).x; };
    // A tap on (or right by) a visible marker means that marker's object, whatever stands in front of it along the ray.
    const tx = clientX - rect.left, ty = clientY - rect.top; let best = null, bestD = 36;
    for (const id of new Set(hits.filter(r => r.distance < hits[0].distance + 1.5).map(r => r.object.userData.interaction))) { const it = interactables.get(id); if (!it?.button || it.button.hidden) continue; const d = Math.hypot(it.screen.x - tx, it.screen.y - ty); if (d < bestD) { bestD = d; best = id; } }
    if (best) return best;
    let pool = hits.filter(r => r.distance < hits[0].distance + .6);
    // Furniture that merely stands in front (the office chair before the drawer, the bench over the card, the bucket before the
    // extinguisher) gives way to a thing to examine up to 1.2 m behind it.
    if (PICK_LOW.has(hits[0].object.userData.interaction)) { const behind = hits.filter(r => !PICK_LOW.has(r.object.userData.interaction) && r.distance < hits[0].distance + 1.2); if (behind.length) pool = behind; }
    return pool.reduce((a, r) => size(r) < size(a) ? r : a).object.userData.interaction;
  }
  host.addEventListener('pointerdown', event => {
    if (!enabled) return;
    pointer = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    host.setPointerCapture(event.pointerId);
  });
  host.addEventListener('pointermove', event => {
    const rect = host.getBoundingClientRect();
    if (event.pointerType === 'mouse') hover = { x: event.clientX - rect.left, y: event.clientY - rect.top }; // a finger leaves no hover behind
    if (!pointer) {
      hoverId = enabled ? pick(event.clientX, event.clientY) || null : null;
      host.style.cursor = hoverId ? 'pointer' : 'grab';
      styleMarkers();
      return;
    }
    const dx = event.clientX - pointer.lastX;
    const dy = event.clientY - pointer.lastY;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 7) pointer.moved = true;
    if (pointer.moved && !focus) {
      yaw -= dx * .004;
      if (zone === 'storage') { pitch += dy * .0025; storageLook(); }
      else { pitch = Math.max(-.36, Math.min(.4, pitch + dy * .0025)); freeLook(); }
      dirty = true;
      onLook();
    }
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  });
  host.addEventListener('pointerup', event => {
    if (pointer && !pointer.moved) {
      const id = pick(event.clientX, event.clientY);
      if (id) onInteract(id);
      else if (event.pointerType !== 'mouse') { // a tap on nothing: what is near that spot shows for a moment
        const rect = host.getBoundingClientRect();
        ping = { x: event.clientX - rect.left, y: event.clientY - rect.top, until: performance.now() + 2600 };
        clearTimeout(pingTimer); pingTimer = setTimeout(() => { ping = null; styleMarkers(); }, 2700);
        styleMarkers();
      }
    }
    pointer = null;
  });
  host.addEventListener('pointercancel', () => { pointer = null; });
  host.addEventListener('pointerleave', () => { hover = null; hoverId = null; styleMarkers(); });

  let previousTime = 0;
  let birdClock = 0;
  // Full-screen layers (phone, bag, a paper, the afterword, the ending; the title, the prologue and the panels over the title)
  // cover the room: while one is open nothing is drawn or animated (dust, the bird's loop), and the loop itself stops (no
  // requestAnimationFrame at all); when it closes the room is redrawn once and carries on from where it stopped.
  const coverIds = ['phone', 'bag', 'paper', 'column', 'ending', 'title', 'prologue', 'room-wait', 'record', 'settings', 'class', 'mif'];
  const coverEls = () => coverIds.map(id => document.getElementById(id)).filter(Boolean);
  let covers = coverEls();
  const isCovered = () => covers.some(el => !el.hidden);
  let covered = false, sleeping = false;
  function wake() {
    if (!sleeping || isCovered()) return;
    sleeping = false; requestAnimationFrame(frame);
  }
  { const mo = new MutationObserver(wake); const watch = () => { covers = coverEls(); for (const el of covers) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); };
    watch(); setInterval(() => { if (covers.length < coverIds.length) watch(); wake(); }, 1000); } // #mif is made later by if.js
  const FINE_POINTER = matchMedia('(pointer: fine)').matches;
  function frame(time) {
    if (isCovered()) { covered = true; sleeping = true; return; }
    requestAnimationFrame(frame);
    // Idle (dust drifting) stays near 30 fps; while the view turns or something animates, draw up to 60 fps on a mouse screen
    // (about 50 fps on touch) so turning does not judder.
    const busy = animations.length > 0 || camera.position.distanceToSquared(cameraGoal) + look.distanceToSquared(lookGoal) > .00001;
    if (document.hidden || time - previousTime < (busy ? (FINE_POINTER ? 15 : 19) : 28)) return;
    if (covered) { covered = false; dirty = true; previousTime = time - 33; }
    const dt = Math.min((time - previousTime) / 1000, .1);
    previousTime = time;
    // The "bird" on the display repeats the same short loop forever.
    // Every 9 s, frame for frame: it comes in from the upper left of the picture, lands on the wire, looks left once at the
    // same moment, takes off to the upper right and fades out, and the next loop starts from the same point. All of it stays
    // inside the window as seen from the room (and from the close-up), so a patient player can watch it repeat exactly.
    if (zone === 'lobby' && city.visible) {
      birdClock = (birdClock + dt) % 9;
      const c = birdClock, ease = t => t * t * (3 - 2 * t), [px0, py0] = PERCH, py = py0 + .05;
      let x = px0, y = py, flap = 0, pitchZ = 0, alpha = 1, look = 0;
      if (c < 2.4) { const t = c / 2.4, e = ease(t); x = px0 - 1.25 * (1 - e); y = py + .42 * (1 - e) + Math.sin(e * Math.PI) * .12; flap = t < .85 ? 1 : (1 - t) / .15; pitchZ = -.2 * (1 - e); alpha = Math.min(1, c / .3); }
      else if (c < 7.4) { look = c > 4.6 && c < 5.4 ? Math.sin((c - 4.6) / .8 * Math.PI) : 0; }
      else { const t = (c - 7.4) / 1.6, e = t * t; x = px0 + 1.0 * e; y = py + .34 * e + Math.sin(t * Math.PI) * .05; flap = 1; pitchZ = .22 * Math.min(1, t * 3); alpha = Math.max(0, Math.min(1, (1 - t) / .25)); }
      bird.position.set(x, y, VIEW.z + .04); bird.rotation.set(0, look * .7, pitchZ);
      for (const w of bird.userData.wings) w.rotation.x = flap ? w.userData.side * Math.sin(time / 45) * .9 * flap : w.userData.side * .08;
      for (const m of birdMats) m.opacity = alpha;
      dirty = true;
    }
    if (dust.visible && zone === 'room' && !focus) { driftDust(dt, time); dirty = true; }
    if (outside.visible) { const a = rain.geometry.attributes.position; for (let i = 0; i < a.count; i += 2) { let y = a.getY(i) - dt * 6; if (y < 0) y = 5; a.setY(i, y); a.setY(i + 1, y - .14); } a.needsUpdate = true; dirty = true; }
    const moving = camera.position.distanceToSquared(cameraGoal) + look.distanceToSquared(lookGoal) > .00001;
    if (!dirty && !moving && !animations.length) return;
    const speed = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    camera.position.lerp(cameraGoal, speed);
    look.lerp(lookGoal, speed);
    camera.lookAt(look);
    flashlight.position.copy(camera.position);
    flashlight.target.position.copy(look);
    for (let i = animations.length - 1; i >= 0; i--) {
      const animation = animations[i];
      const progress = Math.min(1, (time - animation.start) / animation.duration);
      animation.update(progress * progress * (3 - 2 * progress));
      if (progress === 1) {
        animations.splice(i, 1);
        animation.done?.();
      }
    }
    if (renderer.shadowMap) renderer.shadowMap.needsUpdate = shadowsDirty || animations.length > 0;
    renderer.render(scene, camera);
    shadowsDirty = false;
    updateMarkers();
    dirty = false;
  }
  requestAnimationFrame(frame);
  if (location.hostname === '127.0.0.1') { // local preview only: pose the camera, and ask what a screen point would pick
    window.__pose = (p, t, f = 'dev', fl) => { focus = f; if (fl != null) flashlight.intensity = fl; cameraGoal.set(...p); lookGoal.set(...t); camera.position.copy(cameraGoal); look.copy(lookGoal); dirty = true; };
    window.__pick = (x, y) => pick(x, y);
    window.__settle = () => { camera.position.copy(cameraGoal); look.copy(lookGoal); camera.lookAt(look); dirty = true; };
    window.__exitHinge = v => { hinges.get('exit').rotation.y = v; updateSpill(); shadowsDirty = true; dirty = true; };
    window.__cam = () => [camera.position.toArray().map(v => +v.toFixed(2)), look.toArray().map(v => +v.toFixed(2)), focus, (hinges.get('exit')?.rotation.y || 0).toFixed(2)];
    window.__markers = () => [...interactables].filter(([, it]) => it.button && !it.button.hidden).map(([id, it]) => ({ id, x: it.screen.x, y: it.screen.y }));
  }

  function animate(duration, update, done) {
    animations.push({ start: performance.now(), duration, update, done });
    dirty = true;
  }
  function placeCamera(position, target) {
    basePosition.set(...position); camera.position.copy(basePosition); cameraGoal.copy(basePosition);
    yaw = 0; pitch = 0; freeLook(); if (target) lookGoal.set(...target); look.copy(lookGoal);
  }

  // Markers sit on what they name: for these the hand-placed point drifted off the model, so use the model's own bounds.
  scene.updateMatrixWorld(true); // bounds need real world matrices (nothing has been rendered yet)
  for (const id of ['keyboard', 'newspaper', 'ruler', 'lobby-speaker', 'lobby-card']) { const item = interactables.get(id); if (!item) continue; const b = new THREE.Box3(); item.meshes.forEach(m => b.expandByObject(m)); b.getCenter(item.point); item.point.y = Math.min(b.max.y, item.point.y + (b.max.y - b.min.y) * .3); }
  applyZoneLights();
  return {
    get zone() { return zone; },
    setItems(items) { held = [...items]; ruler.visible = !held.includes('ruler') && !held.includes('magnetic-ruler'); magnet.visible = !held.includes('magnet') && !held.includes('magnetic-ruler'); fallenKey.visible = keyRing.visible = glintDot.visible = !held.includes('key'); keyGlint.visible = !held.includes('key') && zone !== 'lobby'; water.visible = !held.includes('water'); lighter.visible = drawerOpen && !held.includes('lighter'); shard1.visible = drawerOpen && !held.some(x => ['shard1', 'plate12', 'plate13', 'plate'].includes(x)); dirty = true; shadowsDirty = true; },
    // The service door swings into the room (112°, clear of the wall) and the passage behind it becomes visible. From the lock
    // close-up the eye drops to the threshold and runs down the passage to the corner lamp while the door comes round.
    openExit(instant) {
      const hinge = hinges.get('exit'); if (!hinge) return;
      if (instant) { hinge.rotation.y = EXIT_OPEN; updateSpill(); dirty = true; shadowsDirty = true; return; }
      const from = hinge.rotation.y, p0 = cameraGoal.clone(), l0 = lookGoal.clone(), fromKeypad = focus === 'keypad';
      if (fromKeypad) focus = 'exit-open'; // the keys ride away on the leaf: their markers go with the close-up
      const p1 = V([-1.38, 1.58, -1.75]), l1 = V([-1.85, .72, -6.3]);
      animate(1800, t => { hinge.rotation.y = from + (EXIT_OPEN - from) * t; updateSpill(); if (fromKeypad) { const e = Math.min(1, t * 1.25); cameraGoal.lerpVectors(p0, p1, e); lookGoal.lerpVectors(l0, l1, e); } }, () => { shadowsDirty = true; });
    },
    // The sign on the passage face of the open leaf, square on: what the narration reads before you step through.
    lookOneWay() { focus = 'oneway'; const hinge = hinges.get('exit'); if (hinge && hinge.rotation.y > -1) { hinge.rotation.y = EXIT_OPEN; updateSpill(); } flashlight.intensity = 2.2; cameraGoal.set(-1.62, 1.6, -2.33); lookGoal.set(-2.666, 1.5, -2.772); if (frameAspect < 1) cameraGoal.set(-1.32, 1.6, -2.21); dirty = true; },
    // Through the doorway; turn round as the door swings shut behind you — the strip of waiting-room light on the passage floor
    // narrows with the gap and goes out, and the one-way sign on the closed leaf faces you; turn back, down the passage to the
    // corner lamp, left into the dark, then hand over to the experience room.
    walkCorridor(done) {
      const hinge = hinges.get('exit'); if (hinge && hinge.rotation.y > -1) { hinge.rotation.y = EXIT_OPEN; updateSpill(); }
      focus = 'walk'; flashlight.intensity = 1.2;
      const p0 = cameraGoal.clone(), l0 = lookGoal.clone(), l1 = V([-1.75, 1.3, -8.4]);
      animate(1300, t => { const e = Math.min(1, t * 1.6); lookGoal.lerpVectors(l0, l1, e); cameraGoal.lerpVectors(p0, V([-1.75, 1.6, -4.25]), Math.max(0, (t - .25) / .75)); }, () => {
        cameraGoal.set(-1.75, 1.6, -4.85); lookGoal.set(-1.72, 1.15, -3.4); flashlight.intensity = .45;
        animate(900, () => {}, () => {
          const from = hinge ? hinge.rotation.y : 0;
          animate(1500, t => { if (hinge) hinge.rotation.y = from * (1 - t * t * (3 - 2 * t)); updateSpill(); }, () => {
            shadowsDirty = true;
            animate(700, () => {}, () => {
              lookGoal.set(-1.75, 1.4, -8.4); flashlight.intensity = 1.2;
              animate(700, () => {}, () => {
                animate(1900, t => { cameraGoal.set(-1.75, 1.6, -4.85 - t * 2.75); }, () => {
                  animate(1100, t => { lookGoal.set(-1.75 - t * 2.7, 1.45, -8.4 + t * .7); scene.userData.lampLevel = 1 - t * .95; }, () => { scene.userData.lampLevel = 1; done && done(); });
                });
              });
            });
          });
        });
      });
    },
    enterLobby() { zone = 'lobby'; focus = null; applyFov(); applyZoneLights(); placeCamera([12, 1.62, 2.6], [11.3, 1.6, -3.6]); /* first thing in view: the town through the window */ scene.userData.lightOffset = 12; flashlight.intensity = 2.5; dirty = true; },
    returnToRoom() { zone = 'room'; focus = null; applyFov(); applyZoneLights(); placeCamera([0, 1.62, 2.6]); scene.userData.lightOffset = 0; flashlight.intensity = 14; dirty = true; },
    setLobbyPower(off) { sky.visible = off; city.visible = !off; lobbyLight.intensity = off ? LOBBY_OFF : LOBBY_ON; dayLight.visible = zone === 'lobby' && !off; dayPatch.visible = !off; panelLamps[0].material.emissiveIntensity = off ? 1.2 : 0; dirty = true; },
    // Equipment that the panel switches, kept in step with the game state: video (pilot lamp, daylight), outside air (vent blades,
    // shutter over the exit, the vent's status window), release (pilot lamp, the lamp beside the exit handle).
    setLobbyState(s = {}) {
      this.setLobbyPower(!!s.screenStopped);
      const air = !!s.airOn, open = !!s.released;
      panelLamps[1].material.emissiveIntensity = air ? 1.2 : 0; panelLamps[2].material.emissiveIntensity = open ? 1.2 : 0;
      ventBlades.forEach(b => { b.rotation.x = air ? .75 : .15; }); shutterBlades.forEach(b => { b.rotation.z = air ? .55 : 0; });
      const vs = label([air ? '外気　導入中' : '外気　停止中'], '#1a2220', air ? '#7fe0a0' : '#d9a24a', 384, 128); ventStatus.material.map = ventStatus.material.emissiveMap = vs; ventStatus.material.needsUpdate = true;
      exitLamp.material.map = exitLamp.material.emissiveMap = lampTex[open ? 1 : 0]; exitLamp.material.needsUpdate = true;
      exitLampDot.material.color.set(open ? '#46d27a' : '#ff9a2a'); exitLampDot.material.emissive.set(open ? '#46d27a' : '#ff9a2a'); exitLampGlow.color.set(open ? '#5fe08a' : '#ffae4a');
      dirty = true; shadowsDirty = true;
    },
    enable(ids = []) { for (const id of ids) optionalOn.add(id); dirty = true; },
    panelFlash() { animate(1400, t => { panelError.material.emissiveIntensity = Math.sin(t * Math.PI * 3) > 0 ? 1.6 : .2; }, () => { panelError.material.emissiveIntensity = 0; }); },
    setPuzzleState(flags) { surfaces = { ...flags }; bag.visible = bagShard.visible = bagTape.visible = !surfaces.labelWet; seal.visible = !surfaces.waxOpen; card.visible = !surfaces.cardTaken; cardText.visible = false; dirty = true; shadowsDirty = true; },
    enterStorage(done) {
      zone = 'storage'; focus = null;
      const hinge = hinges.get('storage');
      storageBase = STORE_ON; storageLight.intensity = STORE_ON; storageLight.position.set(1.75, 1.1, -4.2); // lights the shelves; the wall above stays dark until revealStorageWall()
      applyFov();
      // as the door swings in: its edge (thickness) at the left, the threshold plate, the boxes just inside, the shelves at the back
      cameraGoal.set(1.62, 1.62, -1.95); lookGoal.set(1.8, .95, -4.9);
      animate(1300, t => { hinge.rotation.y = -t * 1.48; }, () => {
        cameraGoal.set(...STORAGE_EYE); yaw = 0; pitch = 0; storageLook();
        animate(1200, () => {}, done);
      });
    },
    narrowStorageDoor() { const hinge = hinges.get('storage'); const from = hinge.rotation.y; const base = storageBase; animate(1600, t => { hinge.rotation.y = from + (-.55 - from) * t; storageBase = storageLight.intensity = base * (1 - t * .45); }); },
    // From the door, eyes on the shelves: the light climbs the wall over 1.6 s and the stain and the nail marks come out of the dark.
    revealStorageWall(done) {
      const fromLook = lookGoal.clone(); const fromPos = storageLight.position.clone(); const fromI = storageLight.intensity;
      animate(1600, t => {
        const e = t * t * (3 - 2 * t);
        lookGoal.set(1.75, fromLook.y + (2.1 - fromLook.y) * e, -5.3);
        storageLight.position.set(1.75, fromPos.y + (2.15 - fromPos.y) * e, fromPos.z + (-4.55 - fromPos.z) * e);
        storageLight.intensity = fromI + (STORE_WALL - fromI) * e;
        flashlight.intensity = 14 + 6 * e;
      }, () => { storageBase = STORE_WALL; yaw = 0; pitch = .19; storageLook(); done && done(); });
    },
    leaveStorage(done) {
      const hinge = hinges.get('storage');
      cameraGoal.copy(basePosition); yaw = 0; pitch = 0; freeLook();
      animate(1000, () => {}, () => {
        zone = 'room'; applyFov();
        const from = hinge.rotation.y;
        const base = storageBase; animate(900, t => { hinge.rotation.y = from * (1 - t); storageLight.intensity = base * (1 - t); }, () => { storageBase = 0; done && done(); });
      });
    },
    begin(on) { enabled = true; this.setLamp(on); dirty = true; },
    // Before the first frame: compile every material's shaders (in parallel where the browser allows it) and send the textures to
    // the GPU a few at a time, giving the page a breath between them, so entering the room does not freeze on its first frame.
    async warm() {
      if (!renderer.isWebGLRenderer) return;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      const textures = new Set();
      scene.traverse(o => { for (const m of [].concat(o.material || [])) for (const k of ['map', 'bumpMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap']) if (m[k] && m[k].isTexture) textures.add(m[k]); });
      let t0 = performance.now();
      for (const t of textures) {
        renderer.initTexture(t);
        if (performance.now() - t0 > 24) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); }
      }
      dirty = true;
    },
    // The locker door swings open on its left hinge (95°, with a stiff start and a slow end), or shuts again.
    openLocker(done) { const from = lockerHinge.rotation.y; lockerOpen = true; animate(1100, t => { const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; lockerHinge.rotation.y = from + (-1.66 - from) * e; }, () => { shadowsDirty = true; done && done(); }); },
    closeLocker(done) { const from = lockerHinge.rotation.y; lockerOpen = false; animate(900, t => { lockerHinge.rotation.y = from * (1 - t); }, () => { shadowsDirty = true; done && done(); }); },
    // Touch devices: show every marker at full strength (true) or only the one near the pointer (false).
    showMarkers(value) { markersShown = !!value; styleMarkers(); },
    // 0: markers only near the pointer or a tap. 1: the ones not yet examined also show faintly (nothing new found for a while).
    setReveal(level) { if (revealLevel === level) return; revealLevel = level; styleMarkers(); },
    get revealLevel() { return revealLevel; },
    // The last step of a hint: this one thing shows in full until it is examined. Returns where it is from here (see whereIs).
    pointTo(id) { hintTarget = id || null; styleMarkers(); return id ? whereIs(id) : null; },
    whereIs,
    get pointed() { return hintTarget; },
    // Marker states: examined ones fade and shrink (class 'seen'); ones that changed since get class 'changed' until inspected again.
    setExamined(ids) { examined.clear(); for (const id of ids || []) examined.add(id); styleMarkers(); },
    setChanged(ids) { changed.clear(); for (const id of ids || []) changed.add(id); styleMarkers(); },
    get markersShown() { return markersShown; },
    setEnabled(value) { enabled = value; dirty = true; },
    setLamp(value) {
      lampOn = value; updateSpill();
      ambient.intensity = value ? .22 : .025; // 非常灯：天井の蛍光灯ではなく、弱い非常用の明かり
      scene.userData.lampLevel = value ? .8 : .12;
      ceilingLight.intensity = value ? CEIL_ON : CEIL_OFF;
      deskLight.intensity = value ? DESK_ON : DESK_OFF;
      dust.visible = value;
      ceilingTube.material.emissiveIntensity = value ? .35 : .05;
      lampBulb.material.emissiveIntensity = value ? 1 : .15;
      rocker.rotation.x = value ? -.12 : .12;
      dirty = true;
    },
    // The canvas a document was painted on, so the UI can show it flat and readable.
    // Only real documents get 「紙を読む」: the ones listed in READABLE (signs, plates, displays and walls are read in the close-up).
    readable(id) { if (!READABLE.has(id)) return null; const item = interactables.get(id); if (!item) return null; const full = map => map.userData?.full || map.image; if (item.paper) return full(item.paper.material.map); const m = (item.meshes || []).find(m => m.material?.map?.image?.getContext); return m ? full(m.material.map) : null; },
    nameOf(id) { return interactables.get(id)?.name || ''; },
    dimEmergency() { exitLight.intensity = 1.1; ceilingTube.material.emissiveIntensity = 0; dirty = true; },
    setExtraScratch(text) { scratches.material.map = scratchTexture(text); scratches.material.bumpMap = scratchBump(text); scratches.material.needsUpdate = true; dirty = true; },
    setCodeValues(vals) { pinPaper.material.map = pinTextureOf(vals); pinPaper.material.needsUpdate = true; dirty = true; },
    glanceShelf(done) { const from = lookGoal.clone(); animate(1200, t => { lookGoal.set(1.75, 1.2 + (from.y - 1.2) * (1 - t), -5.4); }, done); },
    dimFlash(ms = 4000) { const base = flashlight.intensity; animate(2000, t => { flashlight.intensity = base * (1 - .3 * t); }, () => setTimeout(() => animate(1200, t => { flashlight.intensity = base * (.7 + .3 * t); }), ms)); },
    glanceBack(done) {
      const from = yaw;
      animate(900, t => { yaw = from + Math.PI * t; freeLook(); }, () => animate(1500, t => { if (t > .4) { yaw = from + Math.PI * (1 - (t - .4) / .6); freeLook(); } }, () => { yaw = from; freeLook(); done && done(); }));
    },
    turn(direction) {
      if (focus) this.leave();
      if (zone === 'storage') { yaw += direction * Math.PI / 6; storageLook(); dirty = true; onLook(); return; }
      // Portrait phones see a 46° slice, so 60° steps leave gaps where a marker is never on screen: step 45° there, 60° on wide screens.
      yaw += direction * (frameAspect < 1 ? Math.PI / 4 : Math.PI / 3);
      freeLook();
      dirty = true;
      onLook();
    },
    inspect(id) {
      focus = id; changed.delete(id);
      flashlight.intensity = 1.1; // close-up: keep paper and labels readable
      if (id === 'keypad') {
        cameraGoal.set(-1.33, 1.64, -2.66);
        lookGoal.set(-1.33, 1.64, -3.27);
      } else {
        const item = interactables.get(id);
        if (!item) return;
        if (item.follow) { // a target that moves (the plate on the storage door): stand 55 cm in front of wherever it is now
          item.follow.getWorldPosition(item.target); item.follow.getWorldPosition(item.point);
          const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(item.follow.getWorldQuaternion(new THREE.Quaternion()));
          item.position.copy(item.target).addScaledVector(normal, item.followDist || .55);
        }
        cameraGoal.copy(item.position);
        lookGoal.copy(item.target);
      }
      const isPaper = !!this.readable(id);
      flashlight.intensity = isPaper ? 2.6 : id === 'lost-key' ? .8 : 1.1; // under the desk a strong torch only whites out the wood
      keyGlint.intensity = id === 'lost-key' ? 1.6 : .55; // seen from the floor, the ring under the unit catches a little more of the light
      if (id === 'storage-wall') { flashlight.intensity = 4; storageLight.intensity = STORE_WALL * 1.3; }
      else if (id === 'storage-sneaker' || id === 'storage-phone') { flashlight.intensity = .6; storageLight.intensity = storageBase; } // seen from close up: the torch would only bleach them
      else if (zone === 'storage') storageLight.intensity = storageBase;
      // The stairwell has no light of its own: there the phone torch is a tight pool, bright where it lands and black around it.
      if (id === 'floor' || id === 'stairs') { flashlight.intensity = id === 'floor' ? 9 : 6; flashlight.angle = .36; flashlight.penumbra = .55; } else { flashlight.angle = .6; flashlight.penumbra = .7; }
      // Portrait phones see a narrow slice: back off so the whole object fits on screen (papers only a little: they must stay legible).
      if (frameAspect < 1 && id !== 'floor' && id !== 'lost-key') { const k = Math.min(isPaper ? 1.25 : 1.8, 1 + (1 / frameAspect - 1) * (isPaper ? .2 : .55)); cameraGoal.sub(lookGoal).multiplyScalar(k).add(lookGoal); }
      if (id === 'lobby-card') cardText.visible = !!surfaces.cardRevealed;
      if (id === 'lobby-locker' && lockerOpen) { cameraGoal.set(9.25, 1.25, .62); lookGoal.set(8.2, 1.02, .5); } // look into the open cabinet, middle shelf
      dirty = true;
    },
    leave() {
      focus = null; keyGlint.intensity = .55;
      flashlight.intensity = zone === 'lobby' ? 2.5 : 14; flashlight.angle = .6; flashlight.penumbra = .7;
      if (zone === 'storage') { cameraGoal.set(...STORAGE_EYE); storageLook(); storageLight.intensity = storageBase; }
      else { cameraGoal.copy(basePosition); freeLook(); }
      dirty = true;
    },
    openDrawer() {
      if (drawerOpen) return;
      drawerOpen = true; this.setItems(held);
      animate(750, t => { drawer.position.z = .54 + t * .43; });
    },
    showCode(value, error = false) {
      display.material.map.dispose();
      display.material.map = label([value || '— — —'], '#132c24', error ? '#e8b69a' : '#b1d0b0', 768, 192);
      display.material.emissiveMap = display.material.map; display.material.needsUpdate = true;
      dirty = true;
    },
    flicker(strength = 1) {
      const base = scene.userData.lampLevel;
      animate(900 + strength * 300, t => {
        const level = t > .15 && t < .42 ? .18 : t > .56 && t < .7 ? .52 : 1;
        scene.userData.lampLevel = base * level;
        ceilingLight.intensity = (lampOn ? CEIL_ON * 1.3 : CEIL_OFF) * level;
        lobbyLight.intensity = (sky.visible ? LOBBY_OFF : LOBBY_ON) * level;
      }, () => { this.setLamp(lampOn); this.setLobbyPower(sky.visible); });
    },
    end(id, done) {
      enabled = false;
      focus = 'ending';
      const good = ['true', 'secret', 'fake'].includes(id);
      if (zone === 'lobby') {
        if (good) { outside.visible = true; flashlight.intensity = .35; }
        animate(3200, t => { if (good) { realExit.position.z = -.7 - Math.min(1, t * 1.6) * 1.5; const e = t * t * (3 - 2 * t); cameraGoal.set(14.8 + e * 2.6, 1.6, -.7); lookGoal.set(24, 1.4 + e * .4, -.7 - e * 6); } else { lobbyLight.intensity = 12 * (1 - t); scene.userData.lampLevel = 1 - t * .85; } }, done);
        return;
      }
      if (zone === 'storage') {
        // (1) 1.5 s: the door swings shut on its hinges and the strip of corridor light on the floor narrows; the lamp level only drops to .35.
        // (2) 1.2 s: the camera turns to the inside of the closed door — a flat plate, no handle — still lit enough to see it.
        // (3) 0.8 s: the light goes out.
        const hinge = hinges.get('storage'); const from = hinge.rotation.y; const lamp0 = scene.userData.lampLevel; const light0 = Math.max(storageLight.intensity, STORE_ON); const ceil0 = ceilingLight.intensity;
        animate(1500, t => { hinge.rotation.y = from * (1 - t); storageLight.intensity = light0 * (1 - t * .5); scene.userData.lampLevel = lamp0 + (.35 - lamp0) * t; ceilingLight.intensity = ceil0 * (1 - t * .7); }, () => {
          cameraGoal.set(1.75, 1.5, -4.4); lookGoal.set(1.75, 1.4, -3.5);
          storageLight.position.set(1.75, 2.0, -4.3); flashlight.intensity = 6;
          animate(1200, () => {}, () => {
            const l1 = storageLight.intensity, f1 = flashlight.intensity, c1 = ceilingLight.intensity;
            animate(800, t => { storageLight.intensity = l1 * (1 - t); flashlight.intensity = f1 * (1 - t); ceilingLight.intensity = c1 * (1 - t); scene.userData.lampLevel = .35 * (1 - t); }, done);
          });
        });
        return;
      }
      animate(1600, t => { scene.userData.lampLevel = 1 - t * .9; ceilingLight.intensity = CEIL_ON * (1 - t); deskLight.intensity = DESK_ON * (1 - t); }, done);
    },
    reset() {
      this.returnToRoom(); this.setLobbyState({}); this.setPuzzleState({}); realExit.position.z = -.7; outside.visible = false;
      focus = null; enabled = true;
      drawerOpen = false; drawer.position.z = .54;
      hinges.forEach(hinge => { hinge.rotation.y = 0; }); updateSpill(); lockerHinge.rotation.y = 0; lockerOpen = false;
      storageLight.intensity = 0; storageBase = 0; storageLight.position.set(1.75, 1.1, -4.2);
      animations.length = 0;
      this.setItems([]); this.setLamp(false);
      this.showCode('');
      dirty = true; shadowsDirty = true;
    }
  };
}
