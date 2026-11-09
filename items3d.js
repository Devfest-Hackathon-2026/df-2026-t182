import * as THREE from 'three';
import { createRenderer } from './renderer.js';
import { buildModel } from './items-models.js';

// The bag: a list of small pictures of what is held and, beside it (PC) or under it (phone), a 3D stage that shows the chosen
// item large, to turn and zoom by hand. The models are the same ones the room uses.
export const buildItem = buildModel;

// ── pictures for the slots and the "added to the bag" note ──
// One small offscreen renderer. Each item is posed so it reads from above-front, and an orthographic camera is fitted
// to its outline, so a thin ruler or a plate shard fills its square instead of shrinking to a line.
let thumbRenderer = null, thumbScene = null, thumbCamera = null;
const thumbCache = new Map();
const VIEW = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(52)), Math.cos(THREE.MathUtils.degToRad(52)));
function poseForThumb(id, mesh) {
  if (id === 'ruler' || id === 'magnetic-ruler') mesh.rotation.y = .62; // across the square, not a hairline
  else if (id === 'key') mesh.rotation.y = .5;
  else if (id === 'card' || id === 'card-revealed') mesh.rotation.y = .12;
  else if (id === 'lighter') mesh.rotation.y = -.5;
}
function thumbSetup() {
  if (thumbRenderer !== null) return !!thumbRenderer;
  try {
    const canvas = document.createElement('canvas');
    thumbRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setPixelRatio(1); thumbRenderer.setSize(256, 256, false);
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping; thumbRenderer.toneMappingExposure = 1.05;
    thumbRenderer.setClearColor(0x000000, 0);
  } catch { thumbRenderer = false; return false; }
  thumbScene = new THREE.Scene();
  thumbScene.add(new THREE.HemisphereLight('#f3f1ea', '#3a3b38', 1.7));
  const key = new THREE.DirectionalLight('#fff6e6', 2.6); key.position.set(.7, 2, 1.4); thumbScene.add(key);
  const fill = new THREE.DirectionalLight('#dfe7ff', .9); fill.position.set(-1.2, .6, .8); thumbScene.add(fill);
  thumbCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  return true;
}
const corner = new THREE.Vector3();
function fitOrtho(camera, object, margin = .1) {
  camera.position.copy(VIEW); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(object);
  const inv = camera.matrixWorldInverse; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
  }
  const half = Math.max(x1 - x0, y1 - y0) / 2 * (1 + margin * 2), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  camera.left = cx - half; camera.right = cx + half; camera.top = cy + half; camera.bottom = cy - half;
  camera.updateProjectionMatrix();
}
export function itemThumb(id) {
  if (thumbCache.has(id)) return thumbCache.get(id);
  if (!thumbSetup()) return '';
  const mesh = buildItem(id); poseForThumb(id, mesh);
  const holder = new THREE.Group(); holder.add(mesh); thumbScene.add(holder);
  fitOrtho(thumbCamera, holder, .09);
  thumbRenderer.render(thumbScene, thumbCamera);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  thumbScene.remove(holder);
  holder.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
  thumbCache.set(id, url);
  return url;
}

// The bag is a place to pick things up and look at them: a list of small pictures (a column on PC, a strip on a phone) and a
// stage where the chosen item turns under the finger or the mouse. Drag / swipe turns it, the wheel or a pinch zooms in towards
// the pointer (so an engraving or a torn edge can be read), two fingers (or a right / shift drag) move the view, a double tap or
// 「元に戻す」 puts it back. Zoom 1 is the distance at which the whole item fits; zooming only ever goes closer than that.
const ZOOM_MAX = 3.5; // close enough to read an engraving or a torn edge, not so close that the item turns into a blur of colour
const TILT = .6; // how far an item can be tipped towards or away from you by hand (radians)
// How each thing first sits on the stage, as if held up to look at (the camera looks from the front, about 22° above).
// Flat things are raised and tipped towards you so the engraving, the ticks or the pencil read straight; the bottle and the
// lighter stand with their fronts (label, wind holes and lever) turned to you; the key lies tipped up so the ring, bow and
// teeth show as a shape. Turning by hand starts from here, and a double tap comes back here.
function poseFor(id) {
  if (/^shard|^plate/.test(id)) return [-.38, -.16, 0];
  if (id === 'card' || id === 'card-revealed') return [1.12, 0, 0];
  if (id === 'ruler' || id === 'magnetic-ruler') return [1.0, 0, 0];
  if (id === 'key') return [1.05, 0, 0];
  if (id === 'magnet') return [.55, 0, 0];
  if (id === 'water') return [0, -2.2, 0];
  if (id === 'lighter') return [0, -.35, 0];
  return [0, 0, 0];
}
export function createInventory(host) {
  host.replaceChildren();
  const grid = document.createElement('div'); grid.className = 'bag-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '持ち物の一覧');
  const stage = document.createElement('div'); stage.className = 'bag-stage'; stage.tabIndex = 0;
  const empty = document.createElement('p'); empty.className = 'bag-empty'; const emptyText = document.createElement('span'); empty.append(emptyText); // one child, so phrase wrapping (wrap.js) stays inline
  const guide = document.createElement('p'); guide.className = 'bag-guide'; guide.setAttribute('aria-live', 'polite');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'bag-reset'; reset.textContent = '元に戻す'; reset.hidden = true;
  host.append(grid, stage);

  const renderer = createRenderer(stage);
  stage.append(empty, guide, reset);
  // A small dark studio: a soft key from the upper left front, a weak fill, a faint rim to keep edges off the background, and a
  // dim gradient "room" for reflections so steel reads as steel, the bottle as clear plastic and the card as matt paper.
  // The background is dark grey, lighter in the middle, and the floor fades into it, so only the contact shadow says "on a table".
  const scene = new THREE.Scene();
  const paint = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  scene.background = paint(256, 256, (ctx, w, h) => { const g = ctx.createRadialGradient(w * .5, h * .42, 10, w * .5, h * .5, w * .75); g.addColorStop(0, '#2c2f2d'); g.addColorStop(1, '#151716'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
  if (renderer.isWebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = paint(64, 32, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d8d6cf'); g.addColorStop(.3, '#6b706c'); g.addColorStop(.55, '#2c302e'); g.addColorStop(1, '#111312'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.fillStyle = 'rgba(255,250,240,.55)'; ctx.fillRect(w * .1, h * .12, w * .18, h * .14); });
    room.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(room).texture; scene.environmentIntensity = .55; pmrem.dispose(); room.dispose();
  }
  const camera = new THREE.PerspectiveCamera(30, 1, .05, 20);
  scene.add(new THREE.HemisphereLight('#efede6', '#3a3c39', .9));
  const key = new THREE.DirectionalLight('#fff4e2', 2.1); key.position.set(-.9, 1.9, 1.5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: .1, far: 6 }); key.shadow.bias = -.0006; key.shadow.normalBias = .01; key.shadow.radius = 6; scene.add(key);
  const fill = new THREE.DirectionalLight('#dfe6f0', .55); fill.position.set(1.4, .7, 1.1); scene.add(fill);
  const rim = new THREE.PointLight('#e6ecff', 1.4, 4); rim.position.set(.8, .9, -1); scene.add(rim);
  const fade = paint(128, 128, (ctx, w, h) => { const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); g.addColorStop(0, '#fff'); g.addColorStop(.55, '#bbb'); g.addColorStop(1, '#000'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: '#2a2c2a', roughness: .92, alphaMap: fade, transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.002; floor.receiveShadow = true; scene.add(floor);
  const bounds = new THREE.Box3(); const size = new THREE.Vector3();

  let models = [];        // what the stage shows: the selected item(s)
  let items = [];
  let selected = [];
  let fresh = new Set();
  let names = {};
  let onTap = () => {};
  let onPair = null;
  let open = false;
  let width = 1, height = 1;
  let spin = 0;
  let shownKey = '';      // which item(s) the view below belongs to; a different pick starts from the whole item again
  let touched = false;    // handled by the player: stop the idle sway
  let floorSet = false;   // the floor jumps under a newly shown item, then follows it smoothly
  const built = new Map(); // id → model, built once while it stays in the bag

  function resize() {
    width = stage.clientWidth || 1; height = stage.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    layoutStage();
  }
  new ResizeObserver(() => { if (open) resize(); }).observe(stage);

  function meshFor(id) {
    let mesh = built.get(id);
    if (!mesh) { mesh = buildItem(id); mesh.traverse(o => { if (o.isMesh) o.castShadow = true; }); built.set(id, mesh); }
    mesh.scale.setScalar(1); mesh.position.set(0, 0, 0); mesh.rotation.set(...poseFor(id), 'XYZ');
    return mesh;
  }
  function dispose(mesh) { mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }

  // The stage: one item large in the middle, or the two being put together side by side.
  function layoutStage() {
    models.forEach(m => scene.remove(m.group));
    const ids = selected.filter(id => items.includes(id));
    const across = Math.min(camera.aspect, 1.8);
    const target = ids.length > 1 ? Math.min(.46, .36 * across) : Math.min(.62, .5 * across);
    // Two together keep something of their real sizes (a 3 cm magnet next to a 30 cm ruler), but neither shrinks below ~half the stage slot.
    const meshes = ids.map(meshFor);
    const spans = meshes.map(mesh => { bounds.setFromObject(mesh); bounds.getSize(size); return Math.max(size.x, size.y * 1.15, size.z, .01); });
    const shared = target / Math.max(...spans, .01);
    models = ids.map((id, i) => {
      const group = new THREE.Group(); const mesh = meshes[i];
      const own = target / spans[i];
      const s = ids.length > 1 ? Math.max(shared, own * .5) : own;
      // The item turns about its own centre (the group's origin), not about its foot, so tipping it never sinks half of it into the floor.
      mesh.scale.setScalar(s); bounds.setFromObject(mesh); bounds.getCenter(size); mesh.position.sub(size);
      bounds.setFromObject(mesh); const corners = [];
      for (let k = 0; k < 8; k++) corners.push(new THREE.Vector3(k & 1 ? bounds.max.x : bounds.min.x, k & 2 ? bounds.max.y : bounds.min.y, k & 4 ? bounds.max.z : bounds.min.z));
      group.add(mesh);
      group.position.set(ids.length > 1 ? (i - .5) * target * 1.25 : 0, 0, 0);
      scene.add(group);
      const was = models.find(m => m.id === id);
      return { id, group, corners, turn: was ? was.turn : 0, tilt: was ? was.tilt : 0 };
    });
    const keyNow = ids.join('+');
    if (keyNow !== shownKey) { shownKey = keyNow; touched = false; floorSet = false; view.zoom = view.zoomT = 1; view.pan.set(0, 0, 0); view.panT.set(0, 0, 0); }
    frameCamera();
    stage.classList.toggle('has-item', ids.length > 0);
    stage.setAttribute('aria-label', ids.length ? ids.map(id => names[id] || id).join('と') + 'を調べる（矢印キーで回す、＋と－で拡大・縮小、0で元に戻す）' : '何も選んでいない');
  }
  // Pull the camera back along its usual slant until the whole of what is shown fits, whatever the stage's shape.
  // Each item counts as an upright cylinder around its own turning axis, so turning it by hand never pushes it out of frame.
  // That distance is zoom 1; the view below only moves closer (and sideways, towards what the pointer is over).
  const viewDir = new THREE.Vector3(0, .4, 1).normalize(); const camRight = new THREE.Vector3(1, 0, 0);
  const camUp = new THREE.Vector3().crossVectors(viewDir, camRight).normalize(); const box = new THREE.Box3();
  const base = { aim: new THREE.Vector3(0, .08, 0), dist: 1.5, halfW: .3, halfH: .3 };
  const view = { zoom: 1, zoomT: 1, pan: new THREE.Vector3(), panT: new THREE.Vector3() };
  const look = new THREE.Vector3();
  // Every pose the hand can reach counts: each corner of the item's box, turned all the way round (16 steps) and tipped to
  // both limits, so turning or tipping it never pushes any part out of the frame.
  const euler = new THREE.Euler();
  function frameCamera() {
    const pts = [];
    for (const m of models) for (let a = 0; a < 16; a++) for (const t of [-TILT, 0, TILT]) {
      euler.set(t, a * Math.PI / 8, 0, 'XYZ');
      for (const c of m.corners) pts.push(c.clone().applyEuler(euler).add(m.group.position));
    }
    if (!pts.length) { base.aim.set(0, .08, 0); base.dist = 1.5; base.halfW = base.halfH = .3; applyView(); return; }
    box.setFromPoints(pts); box.getCenter(base.aim);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / 1.07, tanH = tanV * camera.aspect;
    let dist = .2, hw = 0, hh = 0;
    for (const p of pts) {
      const q = p.clone().sub(base.aim); const u = Math.abs(q.dot(camUp)), s = Math.abs(q.dot(camRight));
      dist = Math.max(dist, q.dot(viewDir) + u / tanV, q.dot(viewDir) + s / tanH); hw = Math.max(hw, s); hh = Math.max(hh, u);
    }
    base.dist = dist; base.halfW = hw; base.halfH = hh;
    clampPan(); applyView();
  }
  // Zooming narrows the lens instead of moving the camera in: the camera stays outside every pose of the item, so nothing
  // passes behind the near plane and gets cut away while it is turned up close.
  function applyView() {
    look.copy(base.aim).add(view.pan);
    camera.position.copy(look).addScaledVector(viewDir, base.dist); camera.lookAt(look);
    camera.zoom = view.zoom; camera.near = Math.max(.01, base.dist * .05); camera.far = base.dist * 4 + 10; camera.updateProjectionMatrix();
  }
  // The view may slide only as far as the item reaches, and not at all at zoom 1.
  function clampPan() {
    const f = 1 - 1 / view.zoomT, x = view.panT.dot(camRight), y = view.panT.dot(camUp);
    const cx = Math.max(-base.halfW * f, Math.min(base.halfW * f, x)), cy = Math.max(-base.halfH * f, Math.min(base.halfH * f, y));
    view.panT.copy(camRight).multiplyScalar(cx).addScaledVector(camUp, cy);
  }
  // Zoom by k, keeping the point under (nx, ny) (−1…1 across the stage) where it is.
  function zoomAt(k, nx = 0, ny = 0) {
    const z0 = view.zoomT, z1 = Math.max(1, Math.min(ZOOM_MAX, z0 * k)); if (z1 === z0) return;
    const d0 = base.dist / z0, d1 = base.dist / z1, halfH = d0 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), halfW = halfH * camera.aspect;
    view.panT.addScaledVector(camRight, nx * halfW * (1 - d1 / d0)).addScaledVector(camUp, ny * halfH * (1 - d1 / d0));
    view.zoomT = z1; clampPan();
  }
  function panBy(dx, dy) {
    const perPx = 2 * (base.dist / view.zoomT) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height;
    view.panT.addScaledVector(camRight, -dx * perPx).addScaledVector(camUp, dy * perPx); clampPan();
  }
  function turnBy(dx, dy) {
    const k = .012 / Math.sqrt(view.zoomT);
    for (const m of models) { m.turn += dx * k; m.tilt = Math.max(-TILT, Math.min(TILT, m.tilt + dy * k)); }
  }
  function resetView() { view.zoomT = 1; view.panT.set(0, 0, 0); for (const m of models) { m.turn = 0; m.tilt = 0; } }
  const ndc = (x, y) => { const r = stage.getBoundingClientRect(); return [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2]; };

  // ── the once-only guide on the stage ──
  let guideTimer = 0;
  function showGuide(text) { clearTimeout(guideTimer); guide.textContent = text || ''; guide.classList.toggle('show', !!text); if (text) guideTimer = setTimeout(hideGuide, 6000); }
  function hideGuide() { clearTimeout(guideTimer); guide.classList.remove('show'); }

  // ── slots ──
  let dragging = null, ghost = null, dropOn = null;
  function slotFor(id) { return grid.querySelector(`.slot[data-id="${CSS.escape(id)}"]`); }
  function paintSlots() {
    for (const b of grid.children) {
      const at = selected.indexOf(b.dataset.id);
      b.classList.toggle('on', at >= 0); b.setAttribute('aria-pressed', at >= 0 ? 'true' : 'false');
      b.querySelector('.pick').textContent = at >= 0 && selected.length > 1 ? String(at + 1) : '';
    }
  }
  // Keep the picked slot in view inside the list (a row on a phone, a column on PC) without scrolling the page.
  function reveal(b) {
    if (!b) return;
    const g = grid.getBoundingClientRect(), r = b.getBoundingClientRect();
    if (grid.scrollWidth > grid.clientWidth + 1) { if (r.left < g.left) grid.scrollLeft -= g.left - r.left + 8; else if (r.right > g.right) grid.scrollLeft += r.right - g.right + 8; }
    if (grid.scrollHeight > grid.clientHeight + 1) { if (r.top < g.top) grid.scrollTop -= g.top - r.top + 8; else if (r.bottom > g.bottom) grid.scrollTop += r.bottom - g.bottom + 8; }
  }
  // A picture's name may wrap only after a particle or 「た」 before a new word (「プレートの／中片」「マグネットを／つけた／定規」);
  // the CSS keeps every other pair of characters together (keep-all), and only a name with no such place breaks anywhere.
  function tileName(text) { return text.replace(/を(?=.)/g, 'を​').replace(/([のとがた])(?=[^ぁ-ゟ​])/g, '$1​'); }
  function label(id) { return (names[id] || id) + (fresh.has(id) ? '（新しい）' : ''); }
  function buildSlots() {
    grid.replaceChildren();
    for (const id of items) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'slot'; b.dataset.id = id;
      const pic = document.createElement('span'); pic.className = 'pic';
      const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.decoding = 'async'; pic.append(img);
      const pick = document.createElement('i'); pick.className = 'pick'; pick.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'name no-phrase'; name.textContent = tileName(names[id] || id);
      b.append(pic, name, pick);
      if (fresh.has(id)) { const dot = document.createElement('i'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true'); b.append(dot); b.classList.add('is-new'); }
      b.setAttribute('aria-label', label(id));
      b.addEventListener('click', () => { if (b.dataset.dragged) { delete b.dataset.dragged; return; } onTap(id); });
      b.addEventListener('pointerdown', e => startDrag(e, b, id));
      grid.append(b);
    }
    // Pictures after the list is on screen; each is rendered once and kept.
    requestAnimationFrame(() => { for (const b of grid.children) { const img = b.querySelector('img'); const url = itemThumb(b.dataset.id); if (url) img.src = url; else b.classList.add('no-pic'); } });
    paintSlots();
  }
  // Mouse only: drag one slot onto another to put the two together. Touch uses 組み合わせる and a second pick.
  function startDrag(e, b, id) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !onPair) return;
    dragging = { id, b, x: e.clientX, y: e.clientY, moved: false };
    const move = ev => {
      if (!dragging) return;
      if (!dragging.moved && Math.hypot(ev.clientX - dragging.x, ev.clientY - dragging.y) < 8) return;
      if (!dragging.moved) {
        dragging.moved = true; b.classList.add('lifting');
        ghost = document.createElement('div'); ghost.className = 'bag-ghost'; const g = document.createElement('img'); g.src = itemThumb(id) || ''; g.alt = ''; ghost.append(g); document.body.append(ghost);
      }
      ghost.style.transform = `translate(${ev.clientX - 28}px,${ev.clientY - 28}px)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY); const slot = under && under.closest('.bag-grid .slot');
      const target = slot && slot.dataset.id !== id ? slot : null;
      if (dropOn !== target) { dropOn?.classList.remove('drop'); dropOn = target; dropOn?.classList.add('drop'); }
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (dragging && dragging.moved) {
        b.dataset.dragged = '1'; setTimeout(() => { delete b.dataset.dragged; }, 0); b.classList.remove('lifting');
        const other = dropOn && dropOn.dataset.id; dropOn?.classList.remove('drop'); dropOn = null; ghost?.remove(); ghost = null;
        if (other) onPair(id, other);
      }
      dragging = null;
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  // Arrow keys move along the list (a column or a row alike); Enter / Space picks, as any button.
  grid.addEventListener('keydown', e => {
    const list = [...grid.children]; const at = list.indexOf(document.activeElement); if (at < 0) return;
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key]; if (to === undefined) return;
    e.preventDefault(); const next = list[Math.max(0, Math.min(list.length - 1, to))]; next.focus({ preventScroll: true }); reveal(next);
  });

  // ── handling the item on the stage ──
  const pointers = new Map();
  let drag = null, pinch = null, lastTap = null;
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const middle = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  stage.addEventListener('pointerdown', e => {
    if (!models.length || e.target === reset) return;
    try { stage.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hideGuide(); touched = true;
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, pan: e.button === 1 || e.button === 2 || e.shiftKey };
    else if (pointers.size === 2) { pinch = { d: spread(), z: view.zoomT, mid: middle() }; if (drag) drag.moved = true; }
  });
  stage.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pinch && pointers.size >= 2) {
      const m = middle(), [nx, ny] = ndc(m.x, m.y);
      zoomAt(pinch.z * spread() / pinch.d / view.zoomT, nx, ny);
      panBy(m.x - pinch.mid.x, m.y - pinch.mid.y); pinch.mid = m;
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) { if (drag.pan) panBy(e.clientX - drag.lx, e.clientY - drag.ly); else turnBy(e.clientX - drag.lx, e.clientY - drag.ly); }
    drag.lx = e.clientX; drag.ly = e.clientY;
  });
  const release = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) { const [rest] = [...pointers.values()]; if (drag) { drag.lx = rest.x; drag.ly = rest.y; drag.moved = true; } return; }
    if (pointers.size) return;
    // A quick second tap (or click) in about the same place puts the item back as it was.
    if (drag && !drag.moved && e.type === 'pointerup') {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28) { resetView(); lastTap = null; }
      else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    drag = null;
  };
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
  stage.addEventListener('contextmenu', e => e.preventDefault());
  stage.addEventListener('wheel', e => {
    if (!models.length) return;
    e.preventDefault(); hideGuide(); touched = true;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const [nx, ny] = ndc(e.clientX, e.clientY);
    zoomAt(Math.exp(-dy * (e.ctrlKey ? .01 : .0018)), nx, ny); // ctrlKey: a trackpad pinch
  }, { passive: false });
  stage.addEventListener('keydown', e => {
    if (!models.length || e.target !== stage) return;
    const act = { ArrowLeft: () => turnBy(-30, 0), ArrowRight: () => turnBy(30, 0), ArrowUp: () => turnBy(0, -30), ArrowDown: () => turnBy(0, 30), '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(.8), '0': resetView }[e.key];
    if (!act) return;
    e.preventDefault(); hideGuide(); touched = true; act();
  });
  reset.addEventListener('click', () => { resetView(); stage.focus({ preventScroll: true }); });

  let last = 0;
  function frame(t) {
    if (!open) return;
    requestAnimationFrame(frame);
    if (t - last < 30) return;
    const dt = Math.min(.1, (t - last) / 1000); last = t;
    spin += dt;
    const still = touched || view.zoomT > 1.01;
    for (const m of models) {
      const idle = still ? 0 : Math.sin(spin * .45) * .07; // a slow, small sway while untouched
      m.group.rotation.y += ((m.turn + idle) - m.group.rotation.y) * .18;
      m.group.rotation.x += (m.tilt - m.group.rotation.x) * .18;
    }
    // The table follows the item: it stays just under the lowest point of whatever pose it is in, so the shadow touches it.
    if (models.length) { box.makeEmpty(); for (const m of models) box.expandByObject(m.group); floor.position.y += ((box.min.y - .002) - floor.position.y) * (floorSet ? .3 : 1); floorSet = true; }
    view.zoom += (view.zoomT - view.zoom) * .25; if (Math.abs(view.zoomT - view.zoom) < .001) view.zoom = view.zoomT;
    view.pan.lerp(view.panT, .25);
    applyView();
    const moved = view.zoomT > 1.01 || models.some(m => Math.abs(m.turn) > .05 || Math.abs(m.tilt) > .05);
    if (reset.hidden === moved) reset.hidden = !moved;
    renderer.render(scene, camera);
  }

  return {
    // items: ids in the bag. opts: { names, fresh: ids still unseen (a small dot), onPair(a, b): one dropped on another,
    // empty: text when the bag is empty, guide: a one-line note on the stage (shown once by the caller) }
    show(list, tapHandler, opts = {}) {
      onTap = tapHandler; items = [...list]; selected = []; open = true;
      if (opts.names) names = opts.names; else if (this.names) names = this.names;
      if (opts.fresh) fresh = new Set(opts.fresh);
      if (opts.onPair !== undefined) onPair = opts.onPair;
      if (opts.empty !== undefined) emptyText.textContent = opts.empty;
      for (const [id, mesh] of built) if (!items.includes(id)) { dispose(mesh); built.delete(id); }
      buildSlots(); grid.scrollTop = 0; grid.scrollLeft = 0;
      showGuide(opts.guide || '');
      resize(); last = 0; requestAnimationFrame(frame);
    },
    setSelected(ids) { selected = [...ids].filter(Boolean); paintSlots(); layoutStage(); reveal(slotFor(selected[selected.length - 1])); },
    // Looked at once: the dot goes.
    markSeen(id) { if (!fresh.delete(id)) return; const b = slotFor(id); if (!b) return; b.classList.remove('is-new'); b.querySelector('.dot')?.remove(); b.setAttribute('aria-label', label(id)); },
    // Waiting for the second item of a pair: the list says so.
    setPairing(on) { grid.classList.toggle('pairing', !!on); },
    focusFirst() { (grid.querySelector('.slot.on') || grid.querySelector('.slot'))?.focus({ preventScroll: true }); },
    hide() { open = false; hideGuide(); pointers.clear(); drag = pinch = null; ghost?.remove(); ghost = null; grid.classList.remove('pairing'); },
    names: null
  };
}
