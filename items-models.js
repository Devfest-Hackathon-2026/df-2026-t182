// Shared 3D models for the things the player can pick up. The room (scene.js) and the inventory tray (items3d.js) build
// them from the same functions, so an item looks the same on the desk and in the bag; only the scale changes.
// Every builder returns a Group in metres, with userData.meshes (for raycasting) and, where useful, named parts.
import * as THREE from 'three';

// Text painted into the room's textures uses the system fonts, never the page's web fonts (Noto Sans / Serif JP from Google
// Fonts). The room used to be built at page load, before those had arrived, so its papers were always laid out in the system
// font; it is now built later, when they may have, and the line breaks would move. systemFonts(ctx) keeps the old faces.
// scene.js turns `on` while it builds the room, so the item models made then (on the desk) match; the bag's are made later, as before.
const NOTO = /"Noto (?:Sans|Serif) JP",\s*/g;
const FONT = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
export function systemFonts(ctx) {
  Object.defineProperty(ctx, 'font', { configurable: true, get() { return FONT.get.call(this); }, set(v) { FONT.set.call(this, String(v).replace(NOTO, '')); } });
  return ctx;
}
systemFonts.on = false;
const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .85, ...options });
// `scale` paints the same picture on a larger canvas, so engraved words and printed lines stay sharp when the bag zooms in.
const tex = (width, height, paint, scale = 1) => { const c = document.createElement('canvas'); c.width = Math.round(width * scale); c.height = Math.round(height * scale); const ctx = c.getContext('2d'); if (systemFonts.on) systemFonts(ctx); ctx.scale(scale, scale); paint(ctx, width, height); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const seeded = seed => () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
const finish = (g) => { g.userData.meshes = []; g.traverse(o => { if (o.isMesh) { o.castShadow = true; g.userData.meshes.push(o); } }); return g; };
const brass = () => mat('#c2a462', { metalness: .8, roughness: .3 });
const steel = () => mat('#9aa39c', { metalness: .85, roughness: .3 });
const roundedRect = (w, h, r) => { const s = new THREE.Shape(); s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return s; };

// Disposable lighter (BIC-shaped): yellow rounded body 2.4 × 1.2 × 6.2 cm standing on its base, a translucent gas window near
// the bottom, black resin seam, dark metal hood with wind holes, a ridged flint wheel, a red translucent thumb lever. ~8 cm tall.
export function makeLighter() {
  const g = new THREE.Group();
  const bodyMat = mat('#e8c21a', { roughness: .62 });
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(.024, .012, .0045), { depth: .062, bevelEnabled: true, bevelThickness: .0012, bevelSize: .0012, bevelSegments: 2, curveSegments: 5 }), bodyMat);
  body.rotation.x = -Math.PI / 2; body.position.y = .0012; g.add(body);                        // extrusion runs up Y
  const scuffTex = tex(128, 128, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); const r = seeded(5); for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '255,250,220' : '60,50,20'},${.1 + r() * .25})`; ctx.fillRect(r() * w, r() * h, 2 + r() * 14, 1 + r() * 1.5); } });
  const scuffs = new THREE.Mesh(new THREE.PlaneGeometry(.022, .058), mat('#ffffff', { map: scuffTex, transparent: true, roughness: .6 })); scuffs.position.set(0, .032, .00625); g.add(scuffs); // worn print on the front
  const window = new THREE.Mesh(new THREE.BoxGeometry(.018, .012, .0126), mat('#f3dc6a', { transparent: true, opacity: .55, roughness: .3 })); window.position.y = .009; g.add(window); // gas showing through
  const gas = new THREE.Mesh(new THREE.BoxGeometry(.016, .004, .0128), mat('#c89a10', { transparent: true, opacity: .5, roughness: .2 })); gas.position.y = .005; g.add(gas);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(.0245, .003, .0125), mat('#141414', { roughness: .5 })); seam.position.y = .0645; g.add(seam);
  const hoodMat = mat('#3a3d3c', { metalness: .8, roughness: .4 });
  const hood = new THREE.Mesh(new THREE.BoxGeometry(.021, .014, .011), hoodMat); hood.position.set(-.0015, .073, 0); g.add(hood);
  for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) { const hole = new THREE.Mesh(new THREE.BoxGeometry(.0028, .0045, .0006), mat('#0a0a0a')); hole.position.set(-.0065 + i * .0043, .001, sz * .0053); hood.add(hole); } // wind holes front and back
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.0055, .0055, .0105, 18), steel()); wheel.rotation.z = Math.PI / 2; wheel.position.set(-.0015, .081, 0); g.add(wheel);
  for (let i = 0; i < 7; i++) { const ridge = new THREE.Mesh(new THREE.TorusGeometry(.0055, .00035, 3, 18), mat('#1e2020', { metalness: .6 })); ridge.rotation.y = Math.PI / 2; ridge.position.set(-.0015 - .0045 + i * .0015, .081, 0); g.add(ridge); }
  const lever = new THREE.Mesh(new THREE.BoxGeometry(.011, .0055, .0085), mat('#d82a2a', { transparent: true, opacity: .72, roughness: .3 })); lever.position.set(.0085, .0675, .0045); g.add(lever);
  const leverStem = new THREE.Mesh(new THREE.BoxGeometry(.004, .004, .004), mat('#141414')); leverStem.position.set(.0085, .0655, 0); g.add(leverStem);
  g.userData.body = body;
  return finish(g);
}

// Brass key with a split ring: flat bow, stem with three teeth, a steel ring through the bow. Lies in the XZ plane, ~7 cm long.
export function makeKey() {
  const g = new THREE.Group(); const b = brass();
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .0024, 18), b); bow.position.x = -.02; g.add(bow);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(.0032, .0032, .003, 10), mat('#2a2418', { metalness: .3 })); hole.position.x = -.024; g.add(hole);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(.036, .0022, .0052), b); stem.position.x = .008; g.add(stem);
  for (const [x, h] of [[.014, .0045], [.019, .003], [.0245, .0055]]) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(.0035, .0022, h), b); tooth.position.set(x, 0, -.0026 - h / 2); g.add(tooth); }
  const groove = new THREE.Mesh(new THREE.BoxGeometry(.03, .0024, .0008), mat('#7a6436', { metalness: .6 })); groove.position.set(.008, 0, .0012); g.add(groove);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.011, .0013, 6, 20), mat('#c7cdc6', { metalness: .9, roughness: .25 })); ring.rotation.x = Math.PI / 2; ring.position.set(-.037, 0, 0); g.add(ring);
  g.userData.body = stem; g.userData.ring = ring;
  return finish(g);
}

// 30 cm steel ruler with etched ticks (texture on the top face), a hanging hole at one end. Lies flat along X.
export function makeRuler() {
  const ticks = tex(512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#a7b0a3'; ctx.fillRect(0, 0, w, h);
    const r = seeded(9); for (let i = 0; i < 1200; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '230,235,225' : '40,45,40'},${r() * .18})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 8, 1); } // brushed
    ctx.fillStyle = '#2f382f'; for (let i = 0; i <= 300; i++) { const x = 16 + i * 1.6; if (x > w - 8) break; ctx.fillRect(x, 0, i % 10 ? .8 : 1.4, i % 10 ? (i % 5 ? 8 : 13) : 20); }
    ctx.font = '700 14px sans-serif'; ctx.textAlign = 'center'; for (let c = 0; c <= 30; c += 1) { const x = 16 + c * 16; if (x > w - 8) break; ctx.fillText(String(c), x, 36); }
    ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('STAINLESS  cm', w - 12, 56); ctx.textAlign = 'left'; ctx.fillText('JIS', 20, 56);
  }, 4);
  const g = new THREE.Group(); const s = steel();
  const ruler = new THREE.Mesh(new THREE.BoxGeometry(.3, .0012, .03), [s, s, mat('#ffffff', { map: ticks, metalness: .55, roughness: .35 }), s, s, s]); g.add(ruler);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(.003, .003, .0016, 10), mat('#2a2e2a')); hole.position.set(-.1455, 0, .009); g.add(hole); // in the corner, clear of the 0 and the ticks
  g.userData.body = ruler;
  return finish(g);
}

// Round red button magnet, 3 cm across: glossy red cap on a dark steel base. Axis along Y (flat on a surface).
export function makeMagnet(color = '#c8262b') {
  const g = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.015, .013, .008, 24), mat(color, { roughness: .18, metalness: .05 })); cap.position.y = .005; g.add(cap);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.0125, .0125, .002, 24), mat('#3a3a3a', { metalness: .7, roughness: .4 })); base.position.y = .001; g.add(base);
  const dimple = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .0005, 12), mat('#8f1a1e', { roughness: .3 })); dimple.position.y = .0092; g.add(dimple);
  g.userData.body = cap;
  return finish(g);
}

// Magnet stuck to the end of the ruler (the combined tool).
export function makeMagneticRuler() {
  const g = makeRuler(); const m = makeMagnet(); m.position.set(.13, .0006, 0); g.add(m);
  return finish(g);
}

// The manual-reset plate: three brushed-steel segments (34 × 11 cm each, 1.4 cm thick) broken apart along two jagged lines.
// Each break is one fixed line, so a shard's torn edge fits only its own neighbour's (shard1's right = shard2's left,
// shard2's right = shard3's left); on a joined plate the same line shows as a crack. The lower edge has one notch per segment
// (the panel's 切り欠き) and each outer end a screw hole. Front: the engraved steps 「映像停止 →」「外気導入」「→ 解錠」.
// Back: a painted line that climbs across the middle piece (接合時は背面の線を合わせる) and a small label per segment.
// `parts` is an array of segment numbers, e.g. [1], [1, 2], [1, 2, 3].
const SEG = .34, PH = .11, PT = .014, JAG = .02;
const BREAKS = { // one per seam, bottom to top: [height across the plate 0–1, sideways offset from the seam]
  1: [[0, .004], [.09, -.008], [.17, .006], [.26, -.012], [.33, .003], [.41, .014], [.5, -.004], [.57, .009], [.66, -.013], [.74, .002], [.83, .012], [.91, -.006], [1, .005]],
  2: [[0, -.007], [.08, .01], [.18, -.004], [.24, .013], [.35, -.011], [.43, .001], [.52, -.015], [.6, .008], [.71, -.003], [.78, .012], [.88, -.009], [.95, .004], [1, -.002]]
};
const NOTCH = { 1: [.28, .03, .013], 2: [.66, .018, .017], 3: [.42, .042, .01] }; // lower edge: [centre across the segment, width, depth]
const LINE = [[0, .3], [1, .3], [2, .68], [3, .68]]; // the back line: [segments from the plate's left end, height 0–1]
function plateShape(parts) {
  const n = parts.length, x0 = -SEG * n / 2, x1 = -x0, y0 = -PH / 2, y1 = PH / 2;
  const brk = (k, x) => BREAKS[k].map(([f, dx]) => [x + dx, y0 + f * PH]);
  const left = parts[0] > 1 ? brk(parts[0] - 1, x0) : [[x0, y0], [x0, y1]];
  const right = parts[n - 1] < 3 ? brk(parts[n - 1], x1) : [[x1, y0], [x1, y1]];
  const pts = [left[0]];
  parts.forEach((p, i) => { const [c, w, d] = NOTCH[p]; const x = x0 + (i + c) * SEG; pts.push([x - w / 2, y0], [x - w / 2 + .003, y0 + d], [x + w / 2 - .003, y0 + d], [x + w / 2, y0]); });
  pts.push(...right, ...left.slice(1).reverse());
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  if (parts[0] === 1) shape.holes.push(new THREE.Path().absarc(x0 + .028, 0, .005, 0, Math.PI * 2, true));
  if (parts[n - 1] === 3) shape.holes.push(new THREE.Path().absarc(x1 - .028, 0, .005, 0, Math.PI * 2, true));
  return shape;
}
// Painted in millimetres (1 unit = 1 mm, 3 px each). The canvas spans the piece plus JAG on each side, so the torn edges stay inside it.
function plateTexture(parts, back = false) {
  const n = parts.length, W = SEG * n;
  const X = x => (back ? W / 2 + JAG - x : x + W / 2 + JAG) * 1000; // the back is seen from behind: its left is the plate's right
  const Y = y => (PH / 2 - y) * 1000;
  const at = (i, f) => -W / 2 + (i + f) * SEG; // the i-th segment of this piece, f of the way across
  return tex((W + JAG * 2) * 1000, PH * 1000, (ctx, w, h) => {
    ctx.fillStyle = back ? '#6d776c' : '#9aa597'; ctx.fillRect(0, 0, w, h);
    const r = seeded(17 + parts[0]); for (let i = 0; i < 900 * n; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '230,235,225' : '30,35,30'},${r() * .16})`; ctx.fillRect(r() * w, r() * h, 2 + r() * 16, .35); } // brushed
    for (let i = 1; i < n; i++) { // where two pieces were joined, the break shows as a crack
      const path = () => { ctx.beginPath(); BREAKS[parts[i - 1]].forEach(([f, dx], j) => { const x = X(at(i, 0) + dx), y = Y(-PH / 2 + f * PH); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); };
      ctx.lineJoin = 'miter'; path(); ctx.strokeStyle = '#2b322c'; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.save(); ctx.translate(.7, .5); path(); ctx.strokeStyle = 'rgba(235,240,228,.45)'; ctx.lineWidth = .5; ctx.stroke(); ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (back) {
      ctx.strokeStyle = '#dcdfd0'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath();
      LINE.forEach(([u, f], j) => { const x = X(-W / 2 + (u - parts[0] + 1) * SEG), y = Y(-PH / 2 + f * PH); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = '#c9cfbd'; ctx.font = '500 9px sans-serif';
      parts.forEach((p, i) => ctx.fillText(['汐見センター', '避難誘導', '体験室'][p - 1], X(at(i, .5)), Y((p === 3 ? -.3 : .3) * PH)));
      return;
    }
    const engrave = (text, x, size) => { ctx.font = `500 ${size}px sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillText(text, X(x) + .8, h / 2 + .9); ctx.fillStyle = '#2f3a31'; ctx.fillText(text, X(x), h / 2); }; // pale lower-right edge
    parts.forEach((p, i) => {
      if (p === 1) { engrave('映像停止', at(i, .46), 36); engrave('→', at(i, .9), 30); }
      if (p === 2) engrave('外気導入', at(i, .5), 36);
      if (p === 3) { engrave('→', at(i, .1), 30); engrave('解錠', at(i, .52), 36); }
    });
    ctx.strokeStyle = 'rgba(40,46,40,.55)'; ctx.lineWidth = 1.2; // a worn ring around each screw hole
    if (parts[0] === 1) { ctx.beginPath(); ctx.arc(X(-W / 2 + .028), h / 2, 6.5, 0, Math.PI * 2); ctx.stroke(); }
    if (parts[n - 1] === 3) { ctx.beginPath(); ctx.arc(X(W / 2 - .028), h / 2, 6.5, 0, Math.PI * 2); ctx.stroke(); }
  }, 3);
}
export function makePlate(parts) {
  const g = new THREE.Group();
  const n = parts.length, W = SEG * n, span = W + JAG * 2;
  const geo = new THREE.ExtrudeGeometry(plateShape(parts), { depth: PT, bevelEnabled: false, curveSegments: 10 });
  // The two lids come first (back at z = 0, then front at z = PT); map each onto its own picture, measured across the plate.
  const lid = geo.groups[0].count, sides = geo.groups[1], pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < lid; i++) { const x = pos.getX(i); uv.setXY(i, (pos.getZ(i) > PT / 2 ? x + W / 2 + JAG : W / 2 + JAG - x) / span, (pos.getY(i) + PH / 2) / PH); }
  geo.clearGroups(); geo.addGroup(0, lid / 2, 2); geo.addGroup(lid / 2, lid / 2, 0); geo.addGroup(sides.start, sides.count, 1);
  geo.translate(0, 0, -.017); // the back face stays where the old 3.4 cm block had it, so a shard lying face up still rests on the desk
  const body = new THREE.Mesh(geo, [mat('#ffffff', { map: plateTexture(parts), metalness: .35, roughness: .48 }), mat('#7b857d', { metalness: .7, roughness: .6 }), mat('#ffffff', { map: plateTexture(parts, true), metalness: .3, roughness: .6 })]);
  g.add(body);
  g.userData.body = body;
  g.rotation.x = -.9; // leans back so the engraved face reads from above (the tray camera); the room overrides this
  return finish(g);
}
export const makeShard = n => makePlate([n]);

// The white card from the bench: a staff note in pencil and a faint stain. Before the lighter, the pencil is too faint and
// broken to read (there is writing, but no words); after, the same lines read plainly, as the dialogue quotes them.
function cardTexture(revealed) {
  const lines = ['体験室スタッフ各位', 'シナリオ02（津波）では、参加者の', 'パートナーAIが『外に出られた』', '『高台へ』『救助の到着まで待機』と', '案内します。終了は制御盤の刻印の順で。'];
  return tex(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#ebe7d8'; ctx.fillRect(0, 0, w, h);
    const r = seeded(29); for (let i = 0; i < 2000; i++) { ctx.fillStyle = `rgba(80,70,40,${r() * .06})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = revealed ? '#4d4f55' : 'rgba(110,108,110,.1)'; ctx.font = (revealed ? '500 ' : '') + '22px sans-serif';
    if (!revealed) ctx.filter = 'blur(1.2px)';
    lines.forEach((l, i) => ctx.fillText(l, 28, 52 + i * 54));
    ctx.filter = 'none';
    if (!revealed) { const q = seeded(31); for (let i = 0; i < 3200; i++) { ctx.fillStyle = '#ebe7d8'; ctx.fillRect(q() * w, 28 + q() * 250, 1 + q() * 5, 1 + q() * 4); } } // the faint strokes break up: writing is there, words are not
    const g = ctx.createRadialGradient(w * .8, h * .8, 10, w * .8, h * .8, 140); g.addColorStop(0, '#9b6a3a40'); g.addColorStop(1, '#9b6a3a00'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, 2);
}
export function makeCard(revealed = false) {
  const g = new THREE.Group(); const edge = mat('#e0dccb');
  const card = new THREE.Mesh(new THREE.BoxGeometry(.5, .006, .32), [edge, edge, mat('#ffffff', { map: cardTexture(revealed), roughness: .8 }), mat('#e6e2d2', { roughness: .85 }), edge, edge]);
  g.add(card); g.userData.body = card;
  return finish(g);
}

// 500 ml PET bottle: lathe profile (dimpled base with five feet, three reinforcing ribs, a grip waist, rounded shoulder,
// threaded neck), clear plastic, water surface at half height, a translucent label, a ribbed blue cap with a tamper ring.
export function makeWaterBottle() {
  const g = new THREE.Group();
  const profile = [[0, .004], [.012, .001], [.026, 0], [.031, .004], [.0325, .014], [.0305, .03], [.0325, .034], [.0305, .05], [.0325, .054], [.0305, .068], [.0325, .072], [.0325, .085], [.0295, .098], [.028, .106], [.0295, .114], [.0325, .128], [.0325, .158], [.0305, .172], [.024, .185], [.016, .192], [.013, .197], [.0125, .201], [.0145, .204], [.0125, .207], [.0145, .21], [.0125, .213], [.014, .217], [.0135, .22], [0, .22]].map(([r, y]) => new THREE.Vector2(r, y));
  const bottleMat = new THREE.MeshPhysicalMaterial({ color: '#d8efe9', transmission: .9, roughness: .08, thickness: .02, ior: 1.45, transparent: true, metalness: 0, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), bottleMat); g.add(body);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const foot = new THREE.Mesh(new THREE.SphereGeometry(.007, 8, 6), bottleMat); foot.scale.set(1, .5, 1); foot.position.set(Math.cos(a) * .021, .002, Math.sin(a) * .021); g.add(foot); }
  const level = new THREE.Mesh(new THREE.CircleGeometry(.03, 24), mat('#5f8f9c', { transparent: true, opacity: .45, roughness: .1, side: THREE.DoubleSide })); level.rotation.x = -Math.PI / 2; level.position.y = .105; g.add(level);
  const water = new THREE.Mesh(new THREE.LatheGeometry(profile.filter(v => v.y <= .105).map(v => new THREE.Vector2(v.x * .96, v.y)), 20), mat('#6f9ea8', { transparent: true, opacity: .22, roughness: .1 })); g.add(water);
  const labelTex = tex(256, 96, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(150,200,225,.6)'; ctx.fillRect(0, h - 22, w, 22); ctx.fillStyle = 'rgba(120,180,215,.5)'; ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = '#2a5a7a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 30px "Noto Sans JP", sans-serif'; ctx.fillText('天然水', w * .35, 38);
    ctx.font = '14px sans-serif'; ctx.fillText('500ml', w * .35, 64); ctx.font = '11px "Noto Sans JP", sans-serif'; ctx.fillStyle = '#3a4a52'; ctx.fillText('賞味期限 2029.3', w * .8, 85);
    ctx.fillStyle = '#4a7a95'; ctx.font = '10px sans-serif'; ctx.fillText('NATURAL MINERAL WATER', w * .35, 14);
  }, 3);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(.0335, .0335, .052, 28, 1, true), mat('#ffffff', { map: labelTex, transparent: true, opacity: .92, roughness: .35, side: THREE.DoubleSide })); label.position.y = .046; g.add(label);
  const capMat = mat('#2f6fc4', { roughness: .45 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.0155, .0155, .017, 24), capMat); cap.position.y = .2285; g.add(cap);
  for (let i = 0; i < 3; i++) { const groove = new THREE.Mesh(new THREE.TorusGeometry(.0155, .0009, 4, 24), mat('#1f4e92', { roughness: .5 })); groove.rotation.x = Math.PI / 2; groove.position.y = -.006 + i * .005; cap.add(groove); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.0142, .0016, 6, 24), capMat); ring.rotation.x = Math.PI / 2; ring.position.y = .2185; g.add(ring);
  finish(g); g.traverse(o => { if (o.isMesh) o.castShadow = false; }); // clear plastic throws no useful shadow
  g.userData.body = body; g.userData.cap = cap;
  return g;
}

// Build by inventory id. Unknown ids get a plain metal cube.
export function buildModel(id) {
  if (id === 'lighter') return makeLighter();
  if (id === 'key') return makeKey();
  if (id === 'ruler') return makeRuler();
  if (id === 'magnetic-ruler') return makeMagneticRuler();
  if (id === 'magnet') return makeMagnet();
  if (id === 'water') return makeWaterBottle();
  if (/^shard[123]$/.test(id)) return makeShard(Number(id.slice(5)));
  if (/^plate\d\d$/.test(id)) return makePlate(id.slice(5).split('').map(Number));
  if (id === 'plate') return makePlate([1, 2, 3]);
  if (id === 'card' || id === 'card-revealed') return makeCard(id === 'card-revealed');
  const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), steel())); return finish(g);
}
