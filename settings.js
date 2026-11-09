// Player settings, shared by the title's 設定 screen, the sound and the dialogue (text speed / skip read lines).
// One JSON in localStorage: { textSpeed: 'normal'|'fast'|'instant', skipRead: bool, volume: 0..1, voice: bool }
const KEY = 'mi-settings';
export const DEFAULTS = { textSpeed: 'normal', skipRead: false, volume: 1, voice: true };
export function getSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const s = { ...DEFAULTS, ...saved };
  if (!['normal', 'fast', 'instant'].includes(s.textSpeed)) s.textSpeed = 'normal';
  s.volume = Math.max(0, Math.min(1, Number(s.volume)));
  if (!Number.isFinite(s.volume)) s.volume = DEFAULTS.volume;
  s.skipRead = !!s.skipRead; s.voice = s.voice !== false;
  return s;
}
export function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  dispatchEvent(new CustomEvent('mi-settings', { detail: s }));
  return s;
}
