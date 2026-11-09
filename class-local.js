// 授業の参加と、送る前の結果を端末の中に残す（localStorage `mi-class`）。Firebase も通信も使わない。
// people[pid] = { cid, title, label, joinedAt, pre, preSkipped, night, draft:{post,r1,r2}, sent:{at,endedAt} }
// current[cid] = pid（この端末で、その授業にいまの参加者として使う参加者ID）
const KEY = 'mi-class';
export function read() { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.people) return d; } catch {} return { v: 1, people: {}, current: {} }; }
function write(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }
export const entry = pid => (pid && read().people[pid]) || null;
export function setEntry(pid, patch) { const d = read(); d.people[pid] = { ...(d.people[pid] || {}), ...patch }; write(d); return d.people[pid]; }
export const currentPid = cid => read().current[cid] || '';
export function setCurrent(cid, pid) { const d = read(); d.current[cid] = pid; write(d); }
export const preDone = pid => { const e = entry(pid); return !!(e && (e.pre || e.preSkipped)); };
export function saveNight(pid, night) { if (entry(pid)) setEntry(pid, { night }); }
// この端末で参加したことのある授業（いまの参加者のものだけ）。新しい順。
export function joined() { const d = read(); return Object.entries(d.current).map(([cid, pid]) => ({ cid, pid, ...(d.people[pid] || {}) })).filter(x => x.title).sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0)); }
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function newPid() { const r = new Uint8Array(20); crypto.getRandomValues(r); return [...r].map(n => ABC[n % ABC.length]).join(''); }
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
