// Pixel glitch for the title screen — flow line / shift lines / RGB shift / scattered strips,
// after tksiiii's p5 sketch, rewritten on a plain canvas so the whole screen (3D room behind it included) tears.
// Calm most of the time; bursts every few seconds. Buttons stay DOM, so they remain crisp and tappable.

export function createTitleGlitch(section) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { start() {}, stop() {}, repaint() {}, burst() {} };
  const canvas = document.createElement('canvas'); canvas.id = 'title-glitch'; section.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  const src = document.createElement('canvas'); const sctx = src.getContext('2d');
  const h1 = section.querySelector('h1'); const eyebrow = section.querySelector('.eyebrow');
  let W = 0, H = 0, base = null, img = null, work = null, running = false, raf = 0, repaintTimer = 0;
  let burst = false, burstUntil = 0, nextBurst = 0;
  const flow = { t: Math.random() * 1000, speed: 4 + Math.floor(Math.random() * 20), add: 24 + Math.floor(Math.random() * 56) };
  const shifts = new Array(6).fill(null);
  const scats = [{ img: null }, { img: null }, { img: null }];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function size() {
    const r = section.getBoundingClientRect(); if (!r.width) return;
    const scale = Math.min(Math.min(devicePixelRatio || 1, 2), 900 / r.width);
    W = Math.round(r.width * scale); H = Math.round(r.height * scale);
    canvas.width = src.width = W; canvas.height = src.height = H;
    paint();
  }
  function text(el, color) {
    if (!el || el.hidden) return;
    const r = el.getBoundingClientRect(), sr = section.getBoundingClientRect(); const k = W / sr.width;
    const cs = getComputedStyle(el); const px = parseFloat(cs.fontSize) * k;
    const ls = (parseFloat(cs.letterSpacing) || 0) * k;
    sctx.font = `${cs.fontWeight} ${px}px ${cs.fontFamily}`; sctx.textBaseline = 'middle'; sctx.fillStyle = color;
    const str = el.textContent; const widths = [...str].map(ch => sctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + ls * (widths.length - 1);
    let x = (r.left - sr.left + r.width / 2) * k - total / 2; const y = (r.top - sr.top + r.height / 2) * k;
    [...str].forEach((ch, i) => { sctx.fillText(ch, x, y); x += widths[i] + ls; });
  }
  const bgImg = new Image(); bgImg.src = './assets/img/title-bg.jpg'; bgImg.onload = () => paint();
  function paint() {
    if (!W) return;
    sctx.clearRect(0, 0, W, H);
    if (bgImg.complete && bgImg.naturalWidth) { // cover
      const r = Math.max(W / bgImg.naturalWidth, H / bgImg.naturalHeight); const dw = bgImg.naturalWidth * r, dh = bgImg.naturalHeight * r;
      sctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      sctx.fillStyle = 'rgba(7,18,19,.40)'; sctx.fillRect(0, 0, W, H);
    } else { sctx.fillStyle = 'rgba(7,18,19,.84)'; sctx.fillRect(0, 0, W, H); }
    const g = sctx.createRadialGradient(W / 2, H * .42, H * .05, W / 2, H * .42, H * .75);
    g.addColorStop(0, 'rgba(40,70,66,.22)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); sctx.fillStyle = g; sctx.fillRect(0, 0, W, H);
    // faint scanlines so the row shifts have something to tear
    sctx.fillStyle = 'rgba(160,200,190,.045)';
    for (let y = 0; y < H; y += 3) sctx.fillRect(0, y, W, 1);
    // grain
    sctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let i = 0; i < W * H / 90; i++) sctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    text(eyebrow, '#75877f'); text(h1, '#e4e5d8');
    img = sctx.getImageData(0, 0, W, H); work = img.data; base = work.slice();
    section.classList.add('px');
  }
  function flowLine() {
    flow.t = (flow.t + flow.speed) % H; const y = Math.floor(flow.t); let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) { work[i] += flow.add; work[i + 1] += flow.add; work[i + 2] += flow.add; }
  }
  function newShift() {
    const min = Math.floor(rnd(0, H)); return { min, max: min + Math.floor(rnd(1, Math.max(2, (H - min) * (burst ? 1 : .15)))), off: Math.floor(rnd(-40, 40)) * (burst ? 1 : .3) | 0 };
  }
  function applyShift(s) {
    if (!s || !s.off) return;
    const off = s.off, rowBytes = W * 4;
    for (let y = s.min; y < Math.min(s.max, H); y++) {
      const row = y * rowBytes;
      if (off > 0) work.set(base.subarray(row, row + rowBytes - off * 4), row + off * 4);
      else work.set(base.subarray(row - off * 4, row + rowBytes), row);
    }
  }
  function shiftRGB() {
    const len = work.length, range = (burst ? 16 : 4) * (section.dataset.replay === '1' ? 1.6 : 1);
    const offs = [0, 1, 2].map(() => { let o = (Math.floor(rnd(-range, range)) * W + Math.floor(rnd(-range, range))) * 4; o %= len; if (o < 0) o += len; return o; });
    for (let c = 0; c < 3; c++) { const o = offs[c]; if (!o) continue; for (let i = c; i < len; i += 4) { let j = i + o; if (j >= len) j -= len; work[i] = base[j]; } }
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!base) return;
    const worn = section.dataset.replay === '1' ? 1.5 : 1; // after an ending the title is more broken
    if (burst && now > burstUntil) { burst = false; nextBurst = now + rnd(4500, 9000) / worn; shifts.fill(null); scats.forEach(s => s.img = null); h1 && h1.classList.remove('glitch-text'); }
    else if (!burst && now > nextBurst) { burst = true; burstUntil = now + rnd(160, 520); h1 && h1.classList.add('glitch-text'); }
    work.set(base);
    flowLine();
    if (burst) {
      shifts.forEach((s, i) => { if (Math.random() > .5 || !s) shifts[i] = newShift(); applyShift(shifts[i]); });
      if (Math.random() > .55) shiftRGB();
    } else if (Math.random() > .985) { shifts[0] = newShift(); applyShift(shifts[0]); }
    ctx.putImageData(img, 0, 0);
    if (burst) scats.forEach(o => {
      if (Math.random() > .8 || !o.img) {
        o.sx = Math.floor(rnd(0, W - 30)); o.sy = Math.floor(rnd(0, H - 50)); o.sw = Math.floor(rnd(30, W - o.sx)); o.sh = Math.floor(rnd(1, 50));
        o.x = Math.floor(rnd(-W * .3, W * .7)); o.y = Math.floor(rnd(-H * .1, H)); o.img = true;
      }
      ctx.drawImage(src, o.sx, o.sy, o.sw, o.sh, o.x, o.y, o.sw, o.sh);
    });
  }
  function start() {
    if (section.dataset.replay !== '1') { if (running) stop(); return; } // first visit: no tearing; it comes with the story (after an ending)
    if (running) return; running = true; canvas.hidden = false;
    size(); nextBurst = performance.now() + 2500;
    clearInterval(repaintTimer); repaintTimer = setInterval(paint, 20000); // the clock in the eyebrow moves
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; h1 && h1.classList.remove('glitch-text'); cancelAnimationFrame(raf); clearInterval(repaintTimer); canvas.hidden = true; section.classList.remove('px'); canvas.width = src.width = 1; canvas.height = src.height = 1; base = img = work = null; W = 0; } // free the pixel buffers

  if (document.fonts) { document.fonts.load('40px "Kowai Mincho"').then(paint).catch(() => {}); document.fonts.ready.then(paint); }
  addEventListener('resize', () => running && size());
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); } else if (running) raf = requestAnimationFrame(frame); });
  new MutationObserver(() => (section.hidden ? stop() : start())).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  canvas.burst = ms => { burst = true; burstUntil = performance.now() + (ms || 600); }; // for tests
  return { start, stop, repaint: paint, burst: ms => canvas.burst(ms) };
}
