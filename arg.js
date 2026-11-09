// Reality layer: real clock, real battery, real tab switching, and the "outside" websites.
export const WORLD_KEY = 'mi-arg-world';
export const VISIT_KEY = 'mi-arg-visits';

// The night in the story starts at 21:40. Between 19:00 and 05:00 the real clock is used as is (the reality layer);
// at other hours the story clock runs from 21:40 plus the real time elapsed since the game was started.
export const START_KEY = 'mi-start-at';
const fmt = date => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
export function startedAt() { try { return Number(localStorage.getItem(START_KEY)) || 0; } catch { return 0; } }
// Which clock the night uses is decided once, when the game starts, and kept until a reset (no jumps at 19:00 or 05:00).
const MODE_KEY = 'mi-clock-mode';
const isNight = h => h >= 19 || h < 5;
export function clockMode() { try { return localStorage.getItem(MODE_KEY) || (isNight(new Date().getHours()) ? 'real' : 'virtual'); } catch { return 'real'; } }
export function markStart() { try { if (!startedAt()) { localStorage.setItem(START_KEY, String(Date.now())); localStorage.setItem(MODE_KEY, isNight(new Date().getHours()) ? 'real' : 'virtual'); } } catch {} }
export function clearStart() { try { localStorage.removeItem(START_KEY); localStorage.removeItem(MODE_KEY); localStorage.removeItem(PAUSE_KEY); } catch {} pausedSince = 0; }
export function gameNow(real = new Date()) {
  if (clockMode() === 'real') return real;
  const base = startedAt() || real.getTime();
  const virtual = new Date(base); virtual.setHours(21, 40, 0, 0);
  return new Date(virtual.getTime() + Math.min(real.getTime() - base, 6 * 3600 * 1000));
}
export function clock(date) { return fmt(date ? gameNow(date) : gameNow()); }
export function clockAt(ms) { return clock(new Date(ms)); }

// Battery: the real one when the device reports it and is not charging; otherwise the phone in the story
// starts at 23% and drains with play time, down to 4% (the number on Nanami's last post).
let batteryLevel = null; let charging = false;
export async function readBattery() {
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      batteryLevel = Math.round(b.level * 100); charging = b.charging;
      b.addEventListener('levelchange', () => { batteryLevel = Math.round(b.level * 100); });
      b.addEventListener('chargingchange', () => { charging = b.charging; });
    }
  } catch {}
  return battery();
}
// Plugged in (and not simply a desktop reporting 100%): no battery number, and nobody talks about the battery.
export const isCharging = () => charging && batteryLevel !== null && batteryLevel < 100;
// Reading on the phone does not drain the story battery: the pauses are subtracted from play time.
const PAUSE_KEY = 'mi-bat-paused';
let pausedSince = 0;
function pausedTotal() { try { return Number(localStorage.getItem(PAUSE_KEY)) || 0; } catch { return 0; } }
export function pauseBattery(on) {
  if (on) { if (!pausedSince) pausedSince = Date.now(); return; }
  if (pausedSince) { try { localStorage.setItem(PAUSE_KEY, String(pausedTotal() + Date.now() - pausedSince)); } catch {} pausedSince = 0; }
}
export function battery() {
  if (isCharging()) return null;
  if (batteryLevel !== null && !charging && batteryLevel <= 60) return batteryLevel;
  const elapsed = Date.now() - (startedAt() || Date.now()) - pausedTotal() - (pausedSince ? Date.now() - pausedSince : 0);
  return Math.max(4, 23 - Math.floor(elapsed / 150000));
}

// Inside the story the device is always a phone; the real model name is used only when it really is one.
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android スマホ';
  return 'スマホ';
}

export function visits() {
  try { return JSON.parse(localStorage.getItem(VISIT_KEY)) || {}; } catch { return {}; }
}
export function world() {
  try { return JSON.parse(localStorage.getItem(WORLD_KEY)) || {}; } catch { return {}; }
}
export function saveWorld(patch) {
  try { localStorage.setItem(WORLD_KEY, JSON.stringify({ ...world(), ...patch })); } catch {}
}

// Calls back when the player returns to the tab, with seconds away and pages visited meanwhile.
export function watchAway(onReturn) {
  let leftAt = null;
  let before = {};
  const title = document.title;
  let flash = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      leftAt = Date.now(); before = visits();
      const lines = ['ミー：どこ行ったの？', 'ミー：まだそこにいる？', '(1) ミー：返事して'];
      let i = 0;
      flash = setInterval(() => { document.title = lines[i++ % lines.length]; }, 2500);
      setTimeout(() => { if (document.hidden) document.title = lines[0]; }, 600);
    } else {
      clearInterval(flash); document.title = title;
      if (leftAt === null) return;
      const seconds = Math.round((Date.now() - leftAt) / 1000);
      const now = visits();
      const seen = Object.keys(now).filter(page => now[page] !== before[page]);
      leftAt = null;
      onReturn(seconds, seen);
    }
  });
  // Pages opened in other tabs report visits even while this tab stays visible.
  addEventListener('storage', event => {
    if (event.key !== VISIT_KEY || document.hidden) return;
    const now = visits(); const old = (() => { try { return JSON.parse(event.oldValue) || {}; } catch { return {}; } })();
    const seen = Object.keys(now).filter(page => now[page] !== old[page]);
    if (seen.length) onReturn(0, seen);
  });
}

export function askNotificationPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch {}
}
let notifyHook = null;
export function onNotify(fn) { notifyHook = fn; }

// Fake system notification banner; a real OS notification when the tab is hidden and allowed.
// While the screen is black (a bad ending's voice) nothing lands; it all arrives afterwards, spaced out.
let queued = [];
export function flushNotices() { const q = queued; queued = []; q.forEach((args, i) => setTimeout(() => notify(...args), 1500 * i)); }
// While the bag, a paper or a close look is open over the room (game.js tells when, through holdNotices), notices wait as well,
// and land one by one once it closes. A notice marked live (said about what is on screen right now) is not held.
// Held notices that would land on an ending or on the title are dropped: that night is over.
let holdWhile = () => false, held = [], heldTimer = 0;
export function holdNotices(fn) { holdWhile = fn; }
function releaseHeld() {
  if (holdWhile()) return;
  clearInterval(heldTimer); heldTimer = 0;
  const q = held; held = [];
  if (['#ending', '#title'].some(s => { const e = document.querySelector(s); return e && !e.hidden; })) return;
  q.forEach((args, i) => setTimeout(() => notify(...args), 700 + 1500 * i));
}
// Vibration only after the player has touched the page: before the first tap, Chrome blocks the call and logs a warning.
let touched = false;
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => { touched = true; }, { capture: true, once: true });
export function buzz(pattern) {
  const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : touched;
  if (!active || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch {}
}
export function notify(app, text, { tone = 'normal', duration = 5200, time = 'いま', onTap = null, live = false } = {}) {
  if (!text) return;
  const dark = document.querySelector('#dark'); if (dark && !dark.hidden) { queued.push([app, text, { tone, duration, time, onTap }]); return; }
  let holding = false; try { holding = !live && holdWhile(); } catch {}
  if (holding) { held.push([app, text, { tone, duration, time, onTap }]); if (!heldTimer) heldTimer = setInterval(releaseHeld, 400); return; }
  try { notifyHook?.(app); } catch {}
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { new Notification(app, { body: text, tag: 'mi-' + Date.now(), silent: false }); return; }
  } catch {}
  const host = document.querySelector('#notices');
  if (!host) return;
  const card = document.createElement('div');
  card.className = `notice ${tone}`;
  const head = document.createElement('div'); head.className = 'notice-head';
  const icon = document.createElement('span'); icon.className = `notice-icon ${app === 'ミー' ? 'mi' : app === 'メッセージ' ? 'msg' : app === '決済' ? 'pay' : 'sys'}`;
  const name = document.createElement('b'); name.textContent = app;
  const stamp = document.createElement('small'); stamp.textContent = time;
  head.append(icon, name, stamp);
  const body = document.createElement('p'); body.textContent = text;
  card.append(head, body);
  if (onTap) { card.classList.add('tap'); card.onclick = () => { onTap(); card.classList.remove('in'); setTimeout(() => card.remove(), 400); }; }
  else card.onclick = () => { card.classList.toggle('open'); };
  host.prepend(card);
  requestAnimationFrame(() => card.classList.add('in'));
  setTimeout(() => { card.classList.remove('in'); setTimeout(() => card.remove(), 400); }, duration);
  buzz(tone === 'alert' ? [60, 40, 60] : 30);
}

export function consoleWhisper(name) {
  const style = 'color:#9fd3c3;font-size:13px';
  console.log('%cミー：コンソールを開いても、私はここにはいないよ。', style);
  console.log(`%cミー：${name ? name + '、' : ''}答えを探してるなら、私に聞けばいいのに。`, style);
}

// Wallpaper chosen by the player (data URL, kept in localStorage).
export function wallpaper() { try { return localStorage.getItem('mi-arg-wallpaper'); } catch { return null; } }
export function setWallpaper(dataUrl) { try { if (dataUrl) localStorage.setItem('mi-arg-wallpaper', dataUrl); else localStorage.removeItem('mi-arg-wallpaper'); } catch {} }
