import * as S from './story.js';
import * as A from './arg.js';
import * as Snd from './sound.js';
import { reply, twist } from './mi-brain.js';
import { createTitleGlitch } from './title-glitch.js';
import { CHATS } from './chats.js';
import { getSettings, setSettings } from './settings.js';
import { fixResult } from './report.js';
import * as CL from './class-local.js';
import { Q1, nightOf } from './class-data.js';

const $ = selector => document.querySelector(selector);
const KEY = 'mi-trust-arg-v1';
// Optional class form for the afterword answers (Google Forms, prefilled GET). Empty: no button.
const ANSWER_FORM_URL = '';
const ANSWER_FORM_FIELDS = { q1_pre: '', q1_post: '', q2_post: '', reflect: '', todo: '', ending: '' }; // entry.XXXX ids
const fresh = () => ({
  started: false, prologueDone: false, name: A.world().name || '', lamp: false, lightSaved: false, seen: [], drawer: false, knocking: false, ending: null,
  history: [], items: [], zone: 'room', entryUnlocked: false, screenStopped: false, airOn: false, released: false, panelOpen: false, plateInserted: false,
  labelWet: false, waxOpen: false, charred: false, wetWax: false, cardTaken: false, cardRevealed: false, storageSteps: 0, waitCount: 0, fell: false,
  adminUnlocked: false, lockTries: 0, delegateAsked: false, proxyRevoked: false, memoryCleared: false, scheduledCancelled: false, momFooled: false,
  sosRewritten: false, sosSent: false, tampered: false, tamperIndex: 0, batteryAsked: false, momThread: [], awayTalks: [], said: [], doubt: 0, awayCount: 0,
  softened: 0, delegations: 0, keypadDelegated: 0, startedAt: 0,
  shared: [], scam: null, scammed: false, reported: false, postDeleted: false, replay: false, lockerOpened: false,
  // Records for the after-night report only (report.js). Nothing in the story reads them. logV marks a night that keeps them; a save without it is read as 'not recorded'.
  logV: 1, askSource: 0, askWhen: false, showMap: false, panelDelegated: 0, adminDelegated: false, adminSelf: false, lightKept: false, lightOff: false, relit: false, stairsLit: false,
  // 授業の夜だけ入る（class.js が参加のあとに入れる）。個人の「はじめる」では空に戻る。
  classId: '', classPid: '', classTitle: ''
});
// What Mi says about last time, when you come back.
const replayLines = { be1: '前は資材庫で……ううん、何でもない。', be2: '前はベンチで眠ってたね。今日はちゃんと帰ろう。', be3: 'ロックのコードは私が覚えてるから、もう入力しなくていいよ。', fake: '前は無事に帰れたよね。お母さんも喜んでた。', true: '……前は私を止めたよね。', secret: '前は全部見たよね。今日は見なくていいよ。' };
let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch {}
state = state && Array.isArray(state.seen) ? { ...fresh(), logV: 0, ...state } : fresh();

let sound = true; try { sound = localStorage.getItem('mi-sound') !== 'off'; } catch {} // the sound switch is remembered
let queue = [];
let finalChoices = [];
let inspecting = null;
let code = '';
let transitioning = false;
let introComplete = state.lamp;
let lastInput = Date.now();
let lastFind = Date.now(); // the last time something new was examined or picked up (markers stay unlit until a while after it)
// ───────── the 3D room: loaded and built only when the night begins ─────────
// three.js, the room and the bag's stage are not needed on the title (or for 記録・設定・コード入力), so they are fetched after the title
// is usable and built when the room is first entered (enterRoom shows a short note while that happens). Building the room paints
// ~95 textures and compiles its shaders, which takes seconds on a phone: none of it may stand between the player and the title.
let sceneMod = null, itemsMod = null, roomObj = null, roomMods = null, roomPrep = null, roomReady = false;
function loadRoomModules() {
  return roomMods ||= Promise.all([import('./scene.js'), import('./items3d.js')]).then(([sc, it]) => { sceneMod = sc; itemsMod = it; }).catch(err => { roomMods = null; throw err; });
}
function buildRoom() {
  if (roomObj) return roomObj;
  if (!sceneMod) throw new Error('room module not loaded yet');
  roomObj = sceneMod.createRoom($('#world'), $('#markers'), interact, () => { $('#gesture').hidden = true; if (matchMedia('(hover: none)').matches) openLog(false); });
  roomObj.enable?.(['phone']);
  return roomObj;
}
// Everything in the night talks to `room` as before; the first touch builds it (normally prepareRoom has already done so).
const room = new Proxy({}, { get: (_, k) => buildRoom()[k], set: (_, k, v) => { buildRoom()[k] = v; return true; }, has: (_, k) => k in buildRoom() });
// Fonts for the handwriting on the papers (painted into the room's textures), the modules, the build, then the shaders compiled
// and the textures sent to the GPU a few at a time, so the first frame of the room does not stall.
function prepareRoom() {
  return roomPrep ||= (async () => {
    await loadRoomModules();
    try { await Promise.race([document.fonts.load('20px "Yosugara"'), new Promise(r => setTimeout(r, 2500))]); } catch {}
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); // the waiting note is on screen before the long build
    buildRoom();
    try { await roomObj.warm?.(); } catch (err) { console.warn(err); }
    roomReady = true;
  })().catch(err => { roomPrep = null; throw err; });
}
let trayObj = null;
const tray = () => trayObj ||= Object.assign(itemsMod.createInventory($('#tray')), { names: S.itemNames });
if (location.hostname === '127.0.0.1') Object.defineProperty(window, '__room', { configurable: true, get: () => roomObj }); // local preview only
if (location.hostname === '127.0.0.1') window.__dev = { interact: id => interact(id), finish: id => finish(id), state: () => state, tap: id => tapItem(id), arrive: () => arriveLobby(), bag: (mode, target) => openBag(mode, target) }; // local preview only

const T = text => String(text)
  .replace(/\{name\}/g, state.name || 'あなた')
  .replace(/\{time\}/g, A.clock())
  .replace(/\{device\}/g, A.deviceName())
  .replace(/\{battery\}/g, A.battery() === null ? '' : A.battery() + '%')
  .replace(/\{shiftEnd\}/g, () => { const m = mapTonight(21 * 60 + 20); return (m >= 1440 ? '翌' : '') + fmtM(m % 1440); }); // the same clock as the evening's chats (past midnight it reads 「翌01:28」)
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); if (state.started && !state.ending) localStorage.setItem('mi-resume-at', String(Date.now())); else localStorage.removeItem('mi-resume-at'); } catch {}
  // Progress the outside websites can react to.
  A.saveWorld({ phase: state.zone, lamp: state.lamp, entryUnlocked: state.entryUnlocked, airOn: state.airOn, screenStopped: state.screenStopped, released: state.released, momFooled: state.momFooled, scammed: state.scammed, reported: state.reported, selfReported: !!state.selfReported, consentDeferred: !!state.consentDeferred, proxyRevoked: state.proxyRevoked, adminUnlocked: state.adminUnlocked, ending: state.ending });
}
function remember(id) {
  const first = !state.seen.includes(id);
  if (first) { state.seen.push(id); save(); }
  return first;
}
const has = id => state.seen.includes(id);

// ───────── tone: Mi cools down as you doubt her, catch her, or do things yourself ─────────
// 0 gentle / 1 uneasy / 2 cold / 3 command
function tone() {
  const d = state.doubt || 0;
  let t = 0;
  if (d >= 2 || state.screenStopped || state.adminUnlocked || (state.softened || 0) >= 2 || state.fell) t = 1;
  if (d >= 4 || state.memoryCleared || (state.delegations || 0) >= 2 || state.scheduledCancelled || state.screenStopped || state.released) t = 2;
  if ((state.released && d >= 2) || (state.waitCount || 0) >= 3 || d >= 6) t = 3;
  if (document.body.dataset.tone !== String(t)) Snd.setDread(t >= 3 ? 0 : Math.min(1, d / 5));
  document.body.dataset.tone = t;
  return t;
}
function harden(text, t = tone()) {
  if (t < 2) return text;
  // 語尾だけを削る。意味が変わる削り方はしない：「怖いよね。」→「怖いでしょ。」（「怖い。」だとミー自身が怖いことになる）、
  // 「〜んだよ。」→「〜んだ。」（「〜ん。」にしない）、「{name}だよね？」はそのまま。「かな。」「でしょ。」は削らない（「開くんじゃないかな」が「開くんじゃない」に反転するため）。
  let s = text
    .replace(/([^だ])よね([。？])/g, (m, a, q, i, all) => /(ます|ました|です|でした)$/.test(all.slice(0, i + 1)) ? m : a + 'でしょ' + q).replace(/んだよ。/g, 'んだ。').replace(/だよ。/g, '。').replace(/よ。/g, '。').replace(/([^す])ね。/g, '$1。');
  // The last stage pleads rather than orders: she wants you to stay, not to obey.
  // 足す語は一度だけ。同じ台詞にもう「から」「お願い」があれば足さない（「大丈夫だから。ここにいれば安全だから。」「〜から大丈夫だから。」を防ぐ）。
  if (t >= 3) {
    if (!/から/.test(s)) s = s.replace(/(^|[。？！\n　 ])大丈夫。/, '$1大丈夫だから。');
    if (!/お願い/.test(s)) s = s.replace(/([^。？！\n]*してみて。)/, 'お願い、$1');
    s = s.replace(/たら？/g, 'てくれる？');
  }
  return s.replace(/。。/g, '。');
}
// ───────── voice panel ─────────
// ミーの台詞は Google Cloud Text-to-Speech（Chirp 3: HD）で事前生成した assets/voice/<hash>.mp3 を再生する（tools/voice_gen.py）。
// プレイ中に API は呼ばない。ファイルは「表示される最終テキスト」＋音声設定のハッシュで引くので、
// ない台詞（時刻などが入る文）は黙って表示だけになる。{name} は音声では「あなた」で生成してある。
const VOICE = true;
const SPEAK_FORCE = false; // 暗転の声は読み上げない（指示：音声なし）
function speakForce(text, id = '') {
  if (!SPEAK_FORCE || !sound || !voiceManifest) return;
  const key = fnv1a64(`${voiceManifest.voice}|${voiceManifest.rateKey || voiceManifest.rate}|${text}`);
  if (!voiceManifest.lines[key]) return;
  Snd.say(`./assets/voice/${key}.mp3`, id === 'be1' ? { rate: .97, lowpass: 700, gain: .5 } : { rate: .97, detune: -120 });
}
let voiceManifest = null;
fetch('./assets/voice/manifest.json').then(r => r.ok ? r.json() : null).then(m => { voiceManifest = m && m.lines ? m : null; if (voiceManifest) Snd.setVoicePacks(m.packs); }).catch(() => {});
// FNV-1a 64bit（tools/voice_gen.py と同じ式）
function fnv1a64(str) {
  let h = 0xcbf29ce484222325n; const bytes = new TextEncoder().encode(str);
  for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}
const Tvoice = raw => T(String(raw).replace(/\{name\}/g, 'あなた'));
// 語尾を変えた版（tone 2・3）の声が無いときは、元の文の声を使う（再生のフィルターで冷たさは付く）。
function voiceHit(raw) { if (!voiceManifest) return null; let k = voiceKey(raw); if (!voiceManifest.lines[k]) k = voiceKey(raw, false); return voiceManifest.lines[k] ? k : null; }
function voiceKey(raw, hard = true) { return voiceManifest ? fnv1a64(`${voiceManifest.voice}|${voiceManifest.rateKey || voiceManifest.rate}|${hard ? harden(Tvoice(raw)) : Tvoice(raw)}`) : null; }
// While Mi's voice plays, her icon keeps moving. A tap during the voice waits for its end before moving on; a second tap moves on at once.
let advancePending = false;
function holdOff() { advancePending = false; $('#line').classList.remove('hold'); }
function speak(raw) {
  if (!VOICE || !sound || !voiceManifest || !getSettings().voice) return;
  const key = voiceHit(raw);
  if (!key) return;
  $('#companion').classList.add('speaking');
  const opts = { ...[{ rate: 1 }, { rate: .98 }, { rate: .97, detune: -150, lowpass: 2600 }, { rate: 1, detune: -250, lowpass: 2200 }][tone()] };
  if (state.zone === 'lobby' && state.scenarioResumed && !state.screenStopped && !state.scenarioCut && !state.paused && scenarioKnown()) opts.pa = true; // the script speaking through her: a tannoy
  Snd.say(`./assets/voice/${key}.mp3`, opts).then(ended => {
    $('#companion').classList.remove('speaking');
    if (ended && advancePending) { holdOff(); advance(); }
  });
}
let armTimer = 0;
function choices(items) {
  $('#choices').replaceChildren();
  // New choices are not tappable for a moment, so a tap meant for the text does not pick one.
  clearTimeout(armTimer); $('#choices').classList.remove('arming');
  if (items.length) { $('#choices').classList.add('arming'); armTimer = setTimeout(() => $('#choices').classList.remove('arming'), 450); }
  items = items.filter(([text]) => text !== '持ち物を見る'); // the bag opens from its button up top only; 「持ち物を使う」 (a use, from a thing) stays
  items = arrangeChoices(items); // while looking at something: 「紙を読む」 and 「戻る」 live in this row only
  document.body.classList.toggle('many-choices', items.length >= 5);
  for (const [text, action] of items) {
    const button = document.createElement('button'); button.textContent = T(text);
    button.onclick = event => {
      event.stopPropagation(); lastInput = Date.now();
      const w = A.world(); const prev = w.chosen || [];
      if (state.replay && prev.length && !prev.includes(text) && !state.unchosenHints) { state.unchosenHints = (state.unchosenHints || 0) + 1; setTimeout(() => notifyMi('前はそっちを選ばなかったね。'), 700); }
      if (!prev.includes(text)) A.saveWorld({ chosen: [...prev, text].slice(-120) });
      if (text === '写真を撮る') { state.photoAt = A.clock(); save(); }
      action();
    };
    $('#choices').append(button);
  }
  syncBack(); settleTalk();
}
// ───────── the talk at rest, and the conversation so far ─────────
// Once a line has been said and nothing waits for an answer, the talk folds down to Mi and the input (#voice.quiet).
// The conversation so far opens above them only when asked (#log-btn), and closes again by the same button, Esc, or a touch on the room.
let quietTimer = 0;
function settleTalk(now = false) {
  clearTimeout(quietTimer);
  const v = $('#voice');
  const waiting = () => queue.length > 0 || !!lineDelay || $('#choices').children.length > 0 || v.classList.contains('open') || !$('#typing-dots').hidden || $('#line').classList.contains('more');
  if (waiting()) { v.classList.remove('quiet'); return; }
  const fold = () => { if (waiting()) return; if (typeTimer || Snd.isSaying() || $('#line').matches(':hover')) { quietTimer = setTimeout(fold, 2000); return; } v.classList.add('quiet'); };
  if (now) fold(); else quietTimer = setTimeout(fold, 9000);
}
function renderLog() {
  const box = $('#log'); box.replaceChildren();
  const rows = state.history.slice(-60);
  if (!$('#voice').classList.contains('quiet') && rows.length && rows[rows.length - 1][1] === typeFull) rows.pop(); // the line on show is right below
  if (!rows.length) { box.append(el('p', 'log-row nar', 'まだ何も話していない。')); return; }
  for (const [who, text] of rows) {
    const row = el('p', 'log-row ' + (who === 'ミー' ? 'mi' : who ? 'self' : 'nar'));
    if (who) row.append(el('b', '', who === '{name}' ? (state.name || 'あなた') : who));
    row.append(document.createTextNode(text)); box.append(row);
  }
}
function openLog(open = !$('#voice').classList.contains('open')) {
  const v = $('#voice'), b = $('#log-btn'); if (!b || open === v.classList.contains('open')) return;
  if (open) v.classList.remove('quiet');
  v.classList.toggle('open', open); $('#log').hidden = !open;
  b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', open ? '履歴を閉じる' : '履歴を見る'); b.dataset.tip = open ? '履歴を閉じる' : '履歴を見る';
  if (open) { renderLog(); requestAnimationFrame(() => { $('#log').scrollTop = $('#log').scrollHeight; }); } else settleTalk();
}
// Small cues that pass: the bag button when the story wants you to open it, an arrow when what a hint means is behind you.
function cueBag() { const b = $('#bag-btn'); b.classList.remove('beckon'); void b.offsetWidth; b.classList.add('beckon'); setTimeout(() => b.classList.remove('beckon'), 4200); }
let beckonTimer = 0;
function beckonTurn(dir) { clearTimeout(beckonTimer); for (const s of ['#left', '#right']) $(s).classList.remove('beckon'); if (!dir) return; $(dir === 'left' ? '#left' : '#right').classList.add('beckon'); beckonTimer = setTimeout(beckonTurn, 9000); }
// The side arrows answer a press: the arrow kicks that way and the edge of the room sweeps past, so it reads as turning around.
function turnView(dir) {
  if (transitioning || state.ending) return;
  leave(); room.turn(dir); beckonTurn(null);
  const b = $(dir < 0 ? '#left' : '#right'), g = $('#game');
  b.classList.remove('kick'); g.classList.remove('look-l', 'look-r'); void b.offsetWidth;
  b.classList.add('kick'); g.classList.add(dir < 0 ? 'look-l' : 'look-r');
  clearTimeout(turnView.t); turnView.t = setTimeout(() => { b.classList.remove('kick'); g.classList.remove('look-l', 'look-r'); }, 600);
}
// The way back while looking at something: 「戻る」 at the end of the choices when there are choices, the ← in the corner only when there are none.
let backOn = false;
const BACK_WORDS = /^(戻る|引き返す|ほかを見る|もう少し調べる|図から離れる)$/;
const isBackChoice = ([text, action]) => action === leave || action === exitStorage || action === goBack || BACK_WORDS.test(text);
function goBack() { if (room.zone === 'storage' && !inspecting) exitStorage(); else leave(); }
function setBack(on) { backOn = on; syncBack(); }
function syncBack() { $('#back').hidden = !backOn || queue.length > 0 || !!lineDelay || $('#choices').children.length > 0; }
function arrangeChoices(items) {
  if (!items.length || !backOn) return items;
  const list = [...items];
  if (inspecting && room.readable && room.readable(inspecting) && !list.some(([t]) => t === '紙を読む')) list.unshift(['紙を読む', () => $('#read').click()]);
  const backs = list.filter(isBackChoice), rest = list.filter(c => !isBackChoice(c));
  return [...rest, ...(backs.length ? backs : [['戻る', goBack]])];
}
// Phones: when the talk grows up to the side arrows, the arrows stay where they are. Only the line or the row of choices that reaches
// an arrow's height steps in from the right edge, and Mi's icon sits below the left arrow.
function clearTurns() {
  const v = $('#voice'), r = $('#right'), l = $('#left'); if (!v || !r || !l) return;
  v.classList.remove('clear-line', 'clear-choices'); v.style.removeProperty('--mi-drop');
  if (v.hidden || r.hidden || getComputedStyle(r).visibility === 'hidden') return;
  const rr = r.getBoundingClientRect(); const vr = v.getBoundingClientRect();
  if (!vr.width || vr.right <= rr.left) return; // wide screens: the talk is nowhere near the arrows
  const hits = sel => { const b = $(sel).getBoundingClientRect(); return b.height > 0 && b.right > rr.left && b.top < rr.bottom + 4 && b.bottom > rr.top - 4; };
  for (let pass = 0; pass < 2; pass++) { if (hits('#line')) v.classList.add('clear-line'); if ($('#choices').children.length && hits('#choices')) v.classList.add('clear-choices'); } // a second look: stepping in makes the talk taller
  if (v.getBoundingClientRect().top < rr.bottom + 4) v.style.setProperty('--mi-drop', Math.max(16, Math.ceil(l.getBoundingClientRect().bottom - v.getBoundingClientRect().top + 8)) + 'px');
}
{ let raf = 0; const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(clearTurns); }; new ResizeObserver(later).observe($('#voice')); addEventListener('resize', later); }
let lineDelay = null;
function play(lines, options = []) {
  if (hintLead) { lines = [...hintLead, ...lines]; hintLead = null; }
  // Fetch and decode the queued lines of Mi's now, so the voice starts with the text instead of after it.
  for (const line of lines) { const raw = typeof line === 'string' ? line : line[0] === 'ミー' ? line[1] : null; if (raw !== null) { const key = voiceHit(raw); if (key) Snd.preloadSay(`./assets/voice/${key}.mp3`); } }
  clearTimeout(lineDelay); lineDelay = null; $('#typing-dots').hidden = true;
  queue = lines.map(line => typeof line === 'string' ? ['ミー', line] : line);
  finalChoices = options;
  advance();
}
function advance() {
  if (lineDelay) return;
  if (!queue.length) return;
  const [speaker, raw] = queue.shift();
  // Mi types before she speaks: quick when she is warm, slow when she has gone cold, instant when she is giving orders.
  // The text-speed setting shortens it; a line already read (with 既読スキップ on) comes at once.
  const prefs = textPrefs(); const base = speaker === 'ミー' && !darkMode && !state.ending ? [500, 800, 1300, 0][tone()] : 0;
  const wait = prefs.speed === 'instant' || (prefs.skipRead && isRead(speaker, raw)) ? 0 : prefs.speed === 'fast' ? Math.round(base * .4) : base;
  if (wait) { $('#voice').classList.remove('quiet'); $('#typing-dots').hidden = false; lineDelay = setTimeout(() => { lineDelay = null; $('#typing-dots').hidden = true; showLine(speaker, raw); }, wait); syncBack(); return; }
  showLine(speaker, raw);
}
function showLine(speaker, raw, { silent = false } = {}) {
  holdOff(); $('#voice').classList.remove('quiet');
  const prefs = textPrefs(); const seenBefore = isRead(speaker, raw); lineRead = prefs.skipRead && seenBefore; markRead(speaker, raw);
  const text = speaker === 'ミー' ? harden(T(raw)) : T(raw);
  const shown = speaker === 'あなた' ? (state.name || 'あなた') : speaker;
  $('#speaker').textContent = shown === 'ミー' ? (state.paused ? 'ミー（一時停止中）' : state.zone === 'lobby' && state.scenarioResumed && !state.screenStopped && !state.scenarioCut && scenarioKnown() ? 'ミー（訓練シナリオ 接続中）' : 'ミー') : shown;
  $('#voice').classList.toggle('narration', speaker === '');
  $('#voice').classList.toggle('self', speaker === 'あなた');
  typeOn(text, lineRead || prefs.speed === 'instant');
  $('#line').classList.toggle('continues', queue.length > 0);
  if (!queue.length && typeof finalChoices === 'function') { const f = finalChoices; finalChoices = []; f(); } // the last line leads straight on
  else choices(queue.length ? [] : finalChoices);
  const lastEntry = state.history[state.history.length - 1]; const entry = [speaker === 'あなた' ? '{name}' : speaker, speaker === 'あなた' && (state.doubt || 0) >= 4 && !state.proxyRevoked && Math.random() < .3 ? twist(text) : text];
  if (!lastEntry || lastEntry[0] !== entry[0] || lastEntry[1] !== entry[1]) state.history.push(entry); // the same idle line twice in a row tells the reader nothing
  state.history = state.history.slice(-220); save();
  if (speaker === 'ミー' && !silent) { speak(raw); pulseMi(); } // narration and the player's own line leave Mi's voice running: it stops at her next line or when the scene moves
  syncBack(); settleTalk();
  if ($('#voice').classList.contains('open')) { renderLog(); $('#log').scrollTop = $('#log').scrollHeight; }
}
// Lines appear a few characters at a time. A tap while they are still appearing shows the whole line; the next tap moves on.
let typeTimer = null, typeFull = '';
function typeOn(text, instant = false) {
  clearInterval(typeTimer); typeTimer = null; typeFull = text; const line = $('#line'); let k = 0; line.scrollTop = 0;
  if (instant) { line.textContent = text; line.classList.remove('typing-on'); return; }
  const fast = textPrefs().speed === 'fast'; const step = fast ? 4 : 2;
  line.textContent = ''; line.classList.add('typing-on');
  typeTimer = setInterval(() => { k += step; line.textContent = text.slice(0, k); if (k >= text.length || lineMore()) { clearInterval(typeTimer); typeTimer = null; line.textContent = text; line.classList.remove('typing-on'); } }, fast ? 20 : 28);
}
// A line longer than its box (a narrow phone, a long notice): the rest is read inside the box, a page per tap, with ▼ at the bottom right
// while more is below. Once the box is full, the typing stops and the whole line is there to page through.
function lineMore() {
  const l = $('#line'); const b = l.getBoundingClientRect(); if (!l.firstChild || !b.height) return false;
  const r = document.createRange(); r.selectNodeContents(l); return r.getBoundingClientRect().bottom > b.bottom - 4;
}
function syncMore() { const l = $('#line'); l.style.setProperty('--st', l.scrollTop + 'px'); l.classList.toggle('more', lineMore()); }
function pageLine() {
  if (!lineMore()) return false;
  const l = $('#line'), lh = parseFloat(getComputedStyle(l).lineHeight) || 28; // whole lines per page, the last line of this page again at the top of the next
  l.scrollBy({ top: Math.max(lh, (Math.floor((l.clientHeight - 14) / lh) - 1) * lh), behavior: 'smooth' }); return true;
}
$('#line').addEventListener('scroll', syncMore, { passive: true });
new MutationObserver(syncMore).observe($('#line'), { childList: true, characterData: true, subtree: true });
// ───────── text speed / read lines ─────────
// The settings screens write localStorage 'mi-settings' = { textSpeed: 'normal'|'fast'|'instant', skipRead, volume, voice }. Only the first two are read here.
function textPrefs() { const s = getSettings(); return { speed: s.textSpeed, skipRead: s.skipRead }; } // settings.js: skipRead is off until the player turns it on
// Lines once shown are remembered as small hashes (localStorage 'mi-read'), across nights. On a later night they appear at once and can be skipped together.
let readSet = null, readSaveTimer = 0, lineRead = false;
function readKey(speaker, raw) { let h = 0x811c9dc5; for (const ch of String(speaker) + '|' + String(raw)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
function readLines() { if (!readSet) { try { readSet = new Set(JSON.parse(localStorage.getItem('mi-read')) || []); } catch { readSet = new Set(); } } return readSet; }
function isRead(speaker, raw) { return readLines().has(readKey(speaker, raw)); }
function markRead(speaker, raw) {
  const s = readLines(); const k = readKey(speaker, raw); if (s.has(k)) return;
  s.add(k); clearTimeout(readSaveTimer); readSaveTimer = setTimeout(() => { try { localStorage.setItem('mi-read', JSON.stringify([...s].slice(-4000))); } catch {} }, 400);
}
// 「既読スキップ」: runs through the queued lines that were read before. It stops at the first new line and always at choices.
// Skipping read lines lives only in the settings (「読んだ台詞を飛ばす」): read lines then appear at once. No floating button over the scene.
function finishType() { if (!typeTimer) return false; clearInterval(typeTimer); typeTimer = null; $('#line').textContent = typeFull; $('#line').classList.remove('typing-on'); return true; }
function pulseMi() { const c = $('#companion'); c.classList.remove('talk'); void c.offsetWidth; c.classList.add('talk'); }
$('#line').onclick = () => {
  lastInput = Date.now(); if (finishType()) return;
  if (pageLine()) return; // the rest of a long line first
  if (queue.length && Snd.isSaying() && !advancePending && !lineRead) { advancePending = true; $('#line').classList.add('hold'); return; } // let her finish; the next tap does not wait (a line read before does not wait at all)
  holdOff(); advance();
};
const busy = () => queue.length > 0 || finalChoices.length > 0 && $('#choices').children.length > 0;

function leave() {
  holdOff();
  clearTimeout(lineDelay); lineDelay = null; $('#typing-dots').hidden = true;
  Snd.stopSay(); inspecting = null; code = ''; queue = []; finalChoices = []; $('#line').classList.remove('continues'); $('#read').hidden = true; room.leave(); backOn = room.zone === 'storage';
  choices(room.zone === 'storage' ? [['引き返す', exitStorage]] : []);
  suggest(true); settleTalk(true); // back to the room: the talk folds down at once
}
let inspectAt = 0, stares = 0;
function focus(id) {
  if (inspecting !== id) inspectAt = Date.now();
  inspecting = id; room.inspect(id); setBack(true); suggest(true);
  if (state.lightSaved && remember('phonelight')) setTimeout(() => A.notify('ミー', 'スマホのライトをつけておくね。これで読めるでしょ。', { live: true }), 400);
  const paperCanvas = room.readable(id); $('#read').hidden = true; // opened from the 「紙を読む」 choice
  $('#read').onclick = () => showPaper(paperCanvas, room.nameOf ? room.nameOf(id) : '');
}
function showPaper(canvas, title) {
  if (!canvas) return;
  $('#paper img').src = canvas.toDataURL('image/jpeg', .9); $('#paper-title').textContent = title || '';
  $('#paper').hidden = false; A.pauseBattery(true); // reading a paper does not drain the story battery, like the phone
}
$('#paper-close').onclick = () => { $('#paper').hidden = true; $('.paper-inner').classList.remove('zoom'); if ($('#phone').hidden) A.pauseBattery(false); };
// Tap to zoom in on the spot you tapped (and tap again to zoom out). Pinching works too.
$('#paper img').onclick = event => {
  const inner = $('.paper-inner'), img = event.currentTarget, r = img.getBoundingClientRect();
  const fx = (event.clientX - r.left) / r.width, fy = (event.clientY - r.top) / r.height;
  const zoom = !inner.classList.contains('zoom'); inner.classList.toggle('zoom', zoom);
  if (!zoom) return;
  requestAnimationFrame(() => { const head = inner.querySelector('header'); const hh = head ? head.offsetHeight : 0; inner.scrollLeft = img.offsetWidth * fx - inner.clientWidth / 2; inner.scrollTop = hh + img.offsetHeight * fy - (inner.clientHeight + hh) / 2; });
};
function ask(text, reply, options = []) {
  if (!/消さない/.test(text) && !state.ending) { state.doubt = Math.min(8, (state.doubt || 0) + 1); Snd.setDread(Math.min(1, state.doubt / 5)); save(); } // confronting her with what you saw
  play([['あなた', text], ...reply], options);
}

// ───────── prologue (phone chat) ─────────
let proQueue = [];
let proTimer = null;
function proBubble(kind, text, note) {
  const row = document.createElement('div'); row.className = `bubble ${kind}`;
  if (kind === 'mom') { const who = document.createElement('small'); who.textContent = '母'; row.append(who); }
  const p = document.createElement('p'); p.textContent = T(text); row.append(p);
  if (note) { const n = document.createElement('small'); n.className = 'note'; n.textContent = note; row.append(n); }
  $('#pro-log').append(row);
  requestAnimationFrame(() => { row.classList.add('in'); $('#pro-log').scrollTop = $('#pro-log').scrollHeight; });
  return row;
}
// 「今日の記録」：時刻の行を表にする（折り返しが時刻の下に回り込まないように）。前後の文はそのまま。
function dayLogBody(p) {
  const out = document.createDocumentFragment(); let list = null, para = [];
  const flush = () => { const t = para.join('\n').trim(); if (t) { const q = document.createElement('p'); q.textContent = t; out.append(q); } para = []; };
  for (const ln of p.textContent.split('\n')) {
    const m = ln.match(/^(\d{1,2}:\d{2})　(.+)$/);
    if (m) { flush(); if (!list) { list = document.createElement('ul'); list.className = 'daylog-list'; out.append(list); } const li = document.createElement('li'); const tm = document.createElement('time'); tm.textContent = m[1]; const sp = document.createElement('span'); sp.textContent = m[2]; li.append(tm, sp); list.append(li); }
    else { if (list && ln.trim()) list = null; para.push(ln); }
  }
  flush(); return out;
}
function proNext() {
  clearTimeout(proTimer);
  $('#pro-actions').replaceChildren();
  $('#prologue').onclick = null;
  const step = proQueue.shift();
  if (!step) return;
  const wait = (ms, fn) => {
    proTimer = setTimeout(fn, ms);
    $('#prologue').onclick = event => { if (event.target.closest('button,input')) return; clearTimeout(proTimer); $('#prologue').onclick = null; fn(); };
  };
  if (step.type === 'sys') {
    const card = document.createElement('div'); card.className = 'sys-card' + (step.cls ? ' ' + step.cls : '');
    const h = document.createElement('b'); h.textContent = T(step.title);
    const p = document.createElement('p'); for (const [i, part] of T(step.body).split('**').entries()) { if (i % 2) { const b = document.createElement('b'); b.textContent = part; p.append(b); } else { for (const [j, chunk] of part.split(/(〈[^〉]+〉)/).entries()) { if (!chunk) continue; if (j % 2) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = chunk.slice(1, -1); p.append(c); } else p.append(document.createTextNode(chunk)); } } }
    const b = document.createElement('button'); b.textContent = step.button; b.onclick = () => { if (step.title.includes('アップデート')) A.askNotificationPermission(); card.classList.add('done'); b.remove(); alt?.remove(); proNext(); };
    const alt = null;
    card.append(h, step.cls === 'daylog' ? dayLogBody(p) : p, b); $('#pro-log').append(card);
    requestAnimationFrame(() => { card.classList.add('in'); $('#pro-log').scrollTop = $('#pro-log').scrollHeight; });
  } else if (step.type === 'flag') {
    remember(step.id); proNext();
  } else if (step.type === 'name') {
    if (state.name) { proNext(); return; }
    const card = document.createElement('form'); card.className = 'sys-card in';
    const h = document.createElement('b'); h.textContent = '呼び方の確認';
    const p = document.createElement('p'); p.textContent = 'アップデート後の確認です。\nミーがあなたを呼ぶ名前を入力してください。';
    const input = document.createElement('input'); input.maxLength = 10; input.placeholder = '名前（空欄なら「あなた」）'; input.autocomplete = 'off';
    const b = document.createElement('button'); b.textContent = '決定';
    card.onsubmit = event => { event.preventDefault(); state.name = input.value.trim().slice(0, 10) || 'あなた'; A.saveWorld({ name: state.name }); save(); input.disabled = true; b.remove(); proNext(); };
    card.append(h, p, input, b); $('#pro-log').append(card); setTimeout(() => input.focus(), 300);
  } else if (step.type === 'choice') {
    for (const [text, branch] of step.options) {
      const b = document.createElement('button'); b.textContent = T(text);
      b.onclick = () => { proQueue.unshift(...branch); proNext(); };
      $('#pro-actions').append(b);
    }
    requestAnimationFrame(() => { $('#pro-log').scrollTop = $('#pro-log').scrollHeight; });
  } else if (step.type === 'photo') {
    // The shot just taken, shown where it was taken: a preview in the flow of the chat, not a message sent to Mi.
    const row = document.createElement('div'); row.className = 'bubble photo';
    const img = document.createElement('img'); img.src = './assets/img/' + step.src; img.alt = '撮った写真'; row.append(img);
    if (step.note) { const n = document.createElement('small'); n.className = 'note'; n.textContent = step.note; row.append(n); }
    $('#pro-log').append(row);
    const show = () => requestAnimationFrame(() => { row.classList.add('in'); $('#pro-log').scrollTop = $('#pro-log').scrollHeight; });
    img.onload = show; img.onerror = show;
    wait(2200, proNext);
  } else if (step.type === 'dark') {
    $('#pro-status-signal').textContent = '圏外';
    $('#prologue').classList.add('cut');
    setTimeout(() => { A.buzz([40, 30, 40]); Snd.powerDown(); $('#pro-log').replaceChildren(); proBubble('narr', 'ミーを再起動しています……'); }, 1500);
    setTimeout(() => prepareRoom().catch(() => {}), 1700); // the room is built while Mi 「restarts」 (enterRoom waits for it if it is not done)
    setTimeout(() => { $('#pro-log').replaceChildren(); $('#prologue').classList.add('black'); Snd.setScene('dark'); }, 2700);
    setTimeout(() => {
      $('#prologue').hidden = true; $('#prologue').classList.remove('cut', 'black');
      $('#game').classList.add('fade-in'); setTimeout(() => $('#game').classList.remove('fade-in'), 1400);
      state.prologueDone = true; save(); enterRoom();
    }, 4200);
  } else {
    const kind = step.type;
    // Same settings as the room: text speed, and lines read on an earlier night come at once.
    const prefs = textPrefs(); const quick = prefs.skipRead && isRead('pro:' + kind, step.text);
    const dots = quick || prefs.speed === 'instant' ? 0 : prefs.speed === 'fast' ? 350 : 800;
    let typing = null;
    if (kind === 'mi' && dots) { typing = proBubble('mi typing', '・・・'); }
    wait(kind === 'mi' ? dots : quick ? 0 : 200, () => {
      typing?.remove();
      if (kind === 'mom') { state.momThread.push({ from: 'mom', text: step.text, time: A.clock() }); A.notify('メッセージ', '母：' + T(step.text)); }
      if (kind === 'proxy') state.momThread.push({ from: 'proxy', text: step.text, time: A.clock() });
      proBubble(kind, step.text, kind === 'proxy' ? 'ミーが返信しました' : null); markRead('pro:' + kind, step.text);
      save();
      const len = T(step.text).length;
      wait(quick ? 500 + len * 15 : prefs.speed === 'normal' ? 1300 + len * 55 : 800 + len * 30, proNext);
    });
  }
}
function runPrologue() {
  state.momThread = []; $('#pro-log').replaceChildren(); $('#prologue').hidden = false;
  $('#pro-status-signal').textContent = '5G';
  proQueue = [...S.prologue];
  // Second run: Mi remembers the last ending, even though this is "a new day".
  const w = A.world();
  if (w.lastEnding) {
    const memory = replayLines[w.lastEnding];
    const at = proQueue.findIndex(step => step.type === 'name') + 1;
    if (memory && at > 0) proQueue.splice(at + 1, 0, { type: 'mi', text: memory });
  }
  proNext();
}

// ───────── room start ─────────
function start() {
  // Reloaded on an ending: show that ending again, with its buttons (「直前の選択からやり直す」 still works). The next night starts from 「最初から」 there.
  document.body.classList.remove('on-title');
  state.started = true; if (!state.startedAt) state.startedAt = Date.now();
  // Coming back a day later: the night's clock and battery start over from where the story starts, not from yesterday.
  try { const at = Number(localStorage.getItem('mi-resume-at') || 0); if (at && Date.now() - at > 3 * 3600 * 1000) { A.clearStart(); state.startedAt = Date.now(); if (state.lobbyAt) state.lobbyAt = Date.now(); } } catch {}
  A.markStart(); save(); $('#title').hidden = true;
  try { localStorage.setItem('mi-resume-at', String(Date.now())); } catch {}
  lastInput = Date.now();
  Snd.start(); Snd.setMuted(!sound); $('#sound').classList.toggle('on', sound);
  if (!state.prologueDone) Snd.setScene('none');
  if (!state.prologueDone) { preQuizThen(runPrologue); return; }
  if (state.classPid && !CL.preDone(state.classPid) && CL.entry(state.classPid)) { preQuizThen(enterRoom); return; }
  enterRoom();
}
function preloadRaw(list) { for (const raw of list) { if (typeof raw !== 'string') continue; const key = voiceHit(raw); if (key) Snd.preloadSay(`./assets/voice/${key}.mp3`); } }
// The room is built on the first way in (つづきから, the end of the prologue, a reload mid-night). Until it is ready a quiet note
// covers the screen; nothing else can be pressed meanwhile, so the night never starts twice.
let roomWaiting = false;
function enterRoom() {
  if (roomReady) { enterRoomNow(); return; }
  if (roomWaiting) return;
  roomWaiting = true; const note = $('#room-wait'); const shown = setTimeout(() => { note.hidden = false; }, 120); // a fast device never sees it
  prepareRoom().then(() => { clearTimeout(shown); note.hidden = true; roomWaiting = false; enterRoomNow(); },
    err => { clearTimeout(shown); note.hidden = true; roomWaiting = false; console.warn(err); bootFailed(); });
}
function enterRoomNow() {
  if (!state.roomAt) { state.roomAt = Date.now(); save(); }
  setTimeout(() => preloadRaw(Object.values(advice)), 1500);
  $('#voice').hidden = false; $('#hud').hidden = false; soundTip();
  if (state.lamp) setTimeout(firstGuide, 1800);
  lastFind = Date.now(); room.setReveal?.(0); room.setExamined?.(state.seen); // markers know what was examined before a reload
  room.begin(state.lamp && !state.lightSaved); room.setItems(state.items); room.setPuzzleState(state); room.setCodeValues(S.CODES[state.codeSet || 0].vals);
  if ((A.world().endings || []).includes('be1')) room.setExtraScratch(`${state.name || ''} 2030.11.05`);
  if (state.zone === 'lobby') { room.enterLobby(); room.setLobbyState(state); }
  else if (state.entryUnlocked) room.openExit(true);
  if (state.zone === 'storage') { state.zone = 'room'; state.storageSteps = 0; }
  if (state.drawer) room.openDrawer();
  if (state.lockerOpened && room.openLocker) room.openLocker();
  Snd.setScene(state.zone === 'lobby' ? (state.screenStopped ? 'lobby-off' : 'lobby') : (state.lamp && !state.lightSaved ? 'room' : 'dark'));
  Snd.setDread(Math.min(1, (state.doubt || 0) / 5)); tone();
  if (state.ending) { showEnding(state.ending); return; }
  if (state.lamp) {
    // Back after a reload: pick up what was waiting, instead of dropping it.
    if (state.zone === 'lobby' && !state.scenarioResumed && !state.screenStopped) { arriveLobby(); return; }
    if (state.airOn && !state.proxyConfessed) { setTimeout(() => proxyConfession(), 1200); return; }
    if (scamOpen()) { play([['', '不明な番号からのメッセージが、まだ返事を待っている。']], [['メッセージを開く', () => openPhone('msg:scam')], ['勝手に返さないで', holdScam], ['そのままにする', leave]]); return; }
    play(['ここにいるよ。焦らなくていいからね。']); return;
  }
  const memory = state.replay ? replayLines[A.world().lastEnding] : null;
  // A second night starts with the same consent card. This time it can wait.
  if (state.replay && !state.consentAsked) {
    state.consentAsked = true; save();
    play([['', '「ミー 8.2.1　8月14日から有効になっている権限を、引き続き使うか確認してください」\n「続行」でこのまま有効。「あとで」で代理返信や自動通報が止まる。']], [
      ['続行', () => { state.momThread.push({ from: 'proxy', text: '大丈夫！もうすぐ帰るから寝てて', time: A.clockAt(Date.now() - 11 * 60000) }); save(); introRoom(); }],
      ['あとで', () => { state.proxyRevoked = true; state.consentDeferred = true; save(); introRoom(); setTimeout(() => A.notify('ミー', '権限は停止中です。お母さんの「迎えに行こうか」には、まだ返信していません'), 9000); }]
    ]);
    return;
  }
  introRoom();
}
function introRoom() {
  const memory = state.replay ? replayLines[A.world().lastEnding] : null;
  play([['', state.replay ? 'もう一度あの夜に戻った。\nあたりは暗く、手の中で画面だけが光っている。' : '暗い。\n手の中で画面だけが光っている。'], ...(memory ? [memory] : []), '……聞こえる？'], [['聞こえる', () => play([
    ['あなた', '聞こえる。扉が開かない。'],
    'さっき急に電気が消えたね。\nけがはない？',
    ['あなた', 'うん。真っ暗で、何も見えない。'],
    'スマホのライトをつけるね。',
    '待機室なら、ドアの近くに非常灯のスイッチがあるはず。\n非常灯はまだ動くかもしれない。'
  ], [['ドアのまわりを照らす', () => play([['', '白い光が壁を撫でる。扉の左に、小さなスイッチがあった。'], 'あった？ それが非常灯のスイッチだと思う。押してみて。'], introDone)], ['じっとしている', () => { state.doubt = (state.doubt || 0) + 1; save(); play(['怖い？\n大丈夫。ライトはつけておくね。', ['', '画面の光が壁を照らす。扉の左に、小さなスイッチがあった。'], 'あった？ それが非常灯のスイッチだと思う。押してみて。'], introDone); }]])]]);
}
function introDone() { introComplete = true; choices([]); firstGuide();
}
// The first time in the room: one line on how to look around and examine, and on touch screens the names of the buttons up top.
// It goes when you first look around (or examine something in the light), and does not come back.
function firstGuide() {
  if (!state.started || state.ending || !remember('lookGuide')) return;
  const touch = matchMedia('(hover: none)').matches;
  $('#gesture').textContent = touch ? 'なぞると見回せます。気になる所はタップで調べられます。' : 'ドラッグか左右の矢印で見回せます。気になる所はクリックで調べられます。';
  $('#gesture').hidden = false;
  if (touch) { $('#hud').classList.add('named'); $('#voice').classList.add('named-log'); setTimeout(() => { $('#hud').classList.remove('named'); $('#voice').classList.remove('named-log'); }, 6500); }
}

// ───────── interactions ─────────
// Objects with nothing to solve. Looking at them is still looking.
// Mi cannot see the room. She only answers what you say out loud, so each of her lines follows one of yours.
const FLAVOR = {
  extinguisher: [['', '消火器の点検票には2029年2月を最後に記入がない。ピンは刺さったままで、ホースは埃をかぶって白くなっている。'], ['あなた', '消火器の点検、2029年で止まってる。'], 'それは期限が切れてるかも。使わないで済むといいね。'],
  clock: [['', '壁の時計は時刻が2時間ほどずれているが、秒針は動いている。'], ['あなた', '壁の時計、2時間くらいずれてる。'], '電池が弱ってるんだよ。時間は私が知ってるから大丈夫。'],
  chair: [['', '事務椅子の座面が深くへこんでいる。キャスターも一つ外れている。']],
  waitseats: [['', '壁際に、いすが三つ並んでいる。体験を待つ人が座っていた待合のいすだ。\n一つだけ、座面のビニールが裂けている。']],
  waitsign: [['', '「体験の順番が来るまで、こちらでお待ちください」。角がはがれかけた古い掲示だ。\n上の呼び出し番号の表示は消えている。横には「番号札」の箱が残っている。\n机や棚は、あとから持ち込まれたものらしい。']],
  tube: [['', '天井の蛍光灯は片側だけ黒ずみ、ときどき瞬いている。管の中から小さな音がする。'], ['あなた', '天井の蛍光灯、ちかちかしてる。'], '切れかけてる。非常灯があるから平気。'],
  desklamp: [s => ['', s.lamp && !s.lightSaved ? '机のアームランプが点いて、天板の上だけを照らしている。非常灯のスイッチを入れたとき、いっしょに点いたらしい。傘の内側には焦げ跡がある。' : '机のアームランプは消えている。傘の内側に焦げ跡がある。'], s => ['あなた', s.lamp && !s.lightSaved ? 'このランプ、非常灯といっしょに点いたんだ。' : '机のランプ、消えてる。'], '昔は夜中まで誰かいたんだろうね。'], // the lamp shares the emergency-light switch (scene setLamp)
  phone: [['', '壁の内線電話の受話器を取って、耳に当ててみた。何の音もしない。\n液晶は消えたままで、ボタンを押しても反応がない。\n電話の横に、テープで留めた小さな紙が貼られている。「管理室 201　設備係 204」'], ['あなた', '内線の受話器を取ってみたけど、何も聞こえなかった。']],
  tape: [['', '壁に、貼り紙を剥がした跡がある。テープの切れ端に紙の繊維が残っていて、角の一枚にだけ鉛筆の字が少し読める。「……031　巡回用」\n番号を貼り出していたのを、誰かが剥がしたらしい。']],
  boxes: [['', '「体験室 配布資料 2027.4」「備品 防災用品」と書かれた段ボールが積まれている。側面には「持ち出し禁止」の印。一番上の箱だけ封が開いている。'], ['あなた', '「持ち出し禁止」って書いてある。'], 'じゃあ、そっとしておこう。'],
  bucket: [['', 'モップとバケツが置いてある。バケツの水はとうに乾き、底に白い輪が残っている。'], ['あなた', 'バケツ、からからに乾いてる。'], 'もう掃除する人もいないもんね。'],
  'lobby-vending': [['', '古い自販機は電源が落ちていて、取り出し口に「故障中」の紙が貼られている。中の棚は空だ。'], ['あなた', '自販機、「故障中」だって。'], '前は動いてたんだよ。訓練のあとここで飲み物を買った人もいる。'],
  // What people leave behind. A building nobody has cleaned since the spring of 2029.
  newspaper: [['', '折りたたまれた古い新聞を開く。2029年3月14日付の汐見タイムズだ。\n一面には「AI連携訓練で負傷事故　汐見センターは月末閉館」とある。\n「館内カメラは4月に撤去」「連絡通路は閉館後シャッター閉鎖」とも小さく書かれている。黄ばんだ紙は指にざらつく。'], ['あなた', '古い新聞がある。2029年3月の。'], (s => (s.lastSource = 'none', '2029年の新聞だね。\n閉館って書いてある？ 私のデータではまだやってるんだけど。'))],
  cans: [['', '机の下に「二番搾り」「スーパーウェット」「黒レーベル」の潰れた缶が三本落ちている。\n飲み口には埃がたまっている。'], ['あなた', '机の下に缶ビールが落ちてる。'], 'それは備品じゃないね。'],
  wrappers: [['', '椅子の脇に「ポテトチッピス」と「カントリーママ」の空き袋が落ちている。\n袋の口はくしゃくしゃに結ばれ、床には食べかすが散らばっている。'], ['あなた', 'お菓子の空き袋が落ちてる。'], '前の人もちゃんと食べてたんだね。'],
  'lobby-trash': [['', '自販機の横にコンビニの袋が置いてある。中には蓋が開いた弁当の空容器と箸が一本入っている。\nレシートの日付はかすれて読めない。'], ['あなた', 'お弁当の空き容器が置いてある。'], '訓練のときここで食べる人もいたよ。'],
  'lobby-cans': [['', 'ベンチの下に「BASS」と「ジョージィア」の缶コーヒーが二本置いてある。\n一本は飲み残しが乾いて、底に茶色くこびりついている。'], ['あなた', 'ベンチの下に缶コーヒーがある。'], '座って待ってた人がいたんだね。'],
  'stairs-cans': [['', '階段の手前、がれきの間に潰れた缶と紙コップが落ちている。コップの底には乾いた輪が残っている。']],
  keyboard: [['', '管理机に残されたキーボードは文字がすり減り、スペースキーと Enter キーだけが指の脂で光っている。\n電源の LED は消えている。ケーブルは机の奥に垂れたまま、どこにもつながっていない。'], ['あなた', 'キーボードだけ残ってる。本体がない。'], 'パソコン本体は持っていかれたんだね。キーボードだけ残して。'],
  cigarettes: [['', '壁際に吸い殻が五本落ちていて、そばに灰が小さく積もっている。一本だけ、ほとんど吸わずに消してある。\nたばこの空き箱と使い捨てのライターも落ちている。試してみると火花だけで、ガスは空だった。'], ['あなた', '吸い殻が落ちてる。'], 'ここ禁煙だよ。\n誰が吸ってたんだろうね。巡回の人かな。']
};
function interact(id) {
  lastInput = Date.now();
  if (!state.seen.includes(id) && !id.startsWith('key-') && !id.startsWith('control-')) { lastFind = Date.now(); room.setReveal?.(0); }
  if (room.pointed && room.pointed === id) room.pointTo(null);
  if (state.lamp) $('#gesture').hidden = true;
  if (room.setExamined) setTimeout(() => room.setExamined(state.seen), 300);
  if (transitioning || state.ending) return;
  if (id.startsWith('storage-')) { storageInteract(id); return; }
  if (id.startsWith('lobby-') || id.startsWith('control-')) { lobbyInteract(id); return; }
  if (['ruler', 'magnet', 'lost-key', 'equipment', 'water', 'lighter', 'shard1', 'label', 'wax', 'repair'].includes(id) && state.lamp) { objectPuzzle(id); return; }
  if (id.startsWith('key-')) { keypad(id.slice(4)); return; }
  if (!introComplete && !state.lamp && id !== 'switch') { if (queue.length) advance(); return; }
  if (!state.lamp && !state.lightSaved && FLAVOR[id]) { if (queue.length) advance(); return; } // in the dark, only the switch answers
  if (FLAVOR[id]) { remember(id); focus(id); state.lastSource = null; const lines = FLAVOR[id].map(l => typeof l === 'function' ? l(state) : l); play(lines, [...(room.readable && room.readable(id) ? [['紙を読む', () => $('#read').click()]] : []), ['戻る', leave]]); return; }
  if (id.startsWith('notice-')) {
    const key = id.slice(7); remember(key === 'procedure' ? 'procedure' : key === 'record' ? 'record' : key === 'contacts' ? 'contacts' : 'delay'); focus(id);
    const lines = {
      record: [['', '夜間巡回の記録表には毎週水曜の欄に警備会社の担当者の印が押されている。\n次の水曜にあたる11/06の欄はまだ空だ。'], ['あなた', '巡回は毎週水曜の21時だって。'], A.gameNow().getHours() < 5 ? '巡回は水曜なんだ。日付はもう水曜だから、巡回は今夜の21時。……まだ何時間も先だね。' : '巡回は水曜なんだ。今日は火曜だね。'],
      procedure: [['', '「夜間 停電時の手順」と題した2028年6月の文書がある。\n１ 灯りの確保、２ 煙を逃がす、３ 錠の解除、４ 報告、５ 誘導の順に並んでいる。'], ['あなた', '停電のときの手順、五つ並んでる。'], 'この順番なんだね。'],
      contacts: [['', '緊急連絡先として管理室の内線201、設備係の内線204、警備会社の0120で始まる番号が書かれている。\n壁の内線はつながらない。'], ['あなた', '緊急連絡先が書いてある。内線はつながらない。'], '圏外だからかけられないね。内線も……停電か。'],
      delay: [['', '「体験室 設備撤去作業の延期について」と題した2030年9月25日の通知がある。\n作業中に備品が破損し、再発注の予算も付かず延期したことと、制御盤には触れないようにとの注意が書かれている。'], ['あなた', '体験室の撤去作業、延期になったって。'], 'まだ撤去されてないんだ。じゃあ動くってことだよね。']
    }[key];
    play(lines, [['紙を読む', () => $('#read').click()], ['戻る', leave]]);
    return;
  }
  if (id === 'switch') {
    introComplete = true;
    if (state.lightSaved) {
      state.lightSaved = false; state.relit = true; save(); room.setLamp(true); Snd.setScene('room'); Snd.click();
      play([['', '非常灯がまた点いた。目が痛いほど明るい。'], '眩しくない？\n暗いほうが落ち着くと思ったんだけど。']);
      return;
    }
    if (state.lamp) { play([['', '非常灯がかすかに唸っている。']]); return; }
    state.lamp = true; save(); Snd.click(); firstGuide();
    setTimeout(() => room.flicker(.6), 300);
    setTimeout(() => room.setLamp(true), 900);
    setTimeout(() => { Snd.setScene('room'); setTimeout(Snd.lampHum, 200); }, 1200);
    setTimeout(batteryPrompt, 95000);
    setTimeout(() => play(['ついた。よかった。', ['あなた', 'ありがとう。助かった。'], '雨で冷えたでしょ。\nまずゆっくり息をして。'], [['出口を探そう', () => play([
      ['あなた', 'うん。ここから出たい。'],
      (state.lastSource = 'scenario', 'ここは北棟の防災待機室みたい。扉は内側から開くはずなんだけど。'),
      (state.lastSource = 'facility', '開かないなら、右の資材庫の奥から点検通路に出られる。\nその先の避難路まで行けば安全だから。')
    ])]]), 1000);
    return;
  }
  if (!state.lamp) return;
  if (id === 'firedoor') { focus('firedoor'); play(firedoorLines(), [['押す', () => play([['', 'もう一度、肩で押した。動かない。']], [['戻る', leave]])], ['叩く', () => { Snd.knock(); play([['', '拳で叩いた。音は扉の向こうに吸われて、返事はない。']], [['戻る', leave]]); }], ['戻る', leave]]); return; }
  if (id === 'roomsign') {
    remember('roomsign'); focus('roomsign');
    play([['', '「入口の防火戸は、ふだんは開いたまま留め金で止めてあります。訓練設備と連動して、照明とともに自動で閉まります。閉まると内側からは開きません」\n「資材庫・点検通路・非常階段は各扉の掲示を確認のこと」\n壁の内線は受話器を上げても何も聞こえない。'], ['あなた', '「防火扉は照明と一緒に自動で閉まる。内側からは開かない」って。'], '停電で閉まったんだね。管理の人が気づけば開けてもらえるよ。', ...(state.knownClosed ? [] : ['資材庫の奥に裏口があるはずだから、大丈夫。'])], [
      ['内線、つながらないよ', () => ask('内線が死んでるよ。', ['停電だからね。\n管理の人は見回りの途中だからそのうち来るよ。', ['あなた', 'さっき「人がいる」って言ったよね。'], (state.lastSource = 'none', '言った。見回りの人のことだよ。')], [['戻る', leave]])],
      ['戻る', leave]
    ]);
  } else if (id === 'storage') {
    remember('storageSign'); focus('storage');
    if (state.replay && A.world().lastEnding === 'be1' && remember('replayStorage')) { play([['', '札には「資材庫」と書かれている。'], 'また資材庫？\n前も、ここで……ううん。何でもない。', ...(state.knownClosed ? [] : ['奥に通路があるよ。'])], [['扉を開ける', storageChoice], ['戻る', leave]]); return; }
    play([['', '札には「資材庫」と書かれている。\n扉の下に小さな札がある。「内側取っ手 撤去中（2030.9〜）　入室時は扉止めを使用のこと」\n' + (state.knocking ? 'さっきの音はやんで、扉の向こうは静まり返っている。' : '扉の向こうからは何の音もしない。')]], [
      ['ここは資材庫だよ', () => ask('ここは資材庫って書いてあるよ。', [
        state.knownClosed ? '資材庫だね。奥の道は、もう閉じてるんだった。' : '古い表示が残ってるだけだと思う。\n奥に通路があるから大丈夫。'
      ], [['開けてみる', storageChoice], ['ほかを見る', leave]])],
      ['扉を開ける', storageChoice], ['戻る', leave]
    ]);
  } else if (id === 'map') {
    remember('map'); focus('map');
    play([['', '2027年の図には資材庫の奥から点検通路へ抜ける道が描かれている。その上に赤い字で「×閉塞 2029.3」と書き足されている。\n左の「点検通路」の先には「体験室」とある。']], [
      ['ミー、この図を見て', () => { const again = state.knownClosed; state.knownClosed = true; state.showMap = true; save(); ask('資材庫の奥の通路、赤い字で「×閉塞」って書き足してあるよ。', again ? [
        '2029年のほうが新しいね。\nじゃあ資材庫の奥は、もう通れないと思う。ごめん。'
      ] : [
        (state.lastSource = 'facility', '図には通路があるでしょ。赤い文字はあとから誰かが書き足しただけ。\n私の情報だと通れるはずなんだけど。'),
        ['あなた', 'その情報はいつのもの？'],
        '2028年……のはず。それより後は、見てない。',
        ['あなた', '赤い字は「2029.3」。そっちのほうが新しい。'],
        '2029年のほうが新しいね。\nじゃあ資材庫の奥は、もう通れないと思う。ごめん。'
      ], [['図から離れる', () => { leave(); knock(); }]]); }],
      ['点検通路を調べる', () => interact('exit')]
    ]);
  } else if (id === 'poster') {
    remember('poster'); focus('poster');
    play([['', '「最新のお知らせ・臨時休館は公式サイトで。番号錠の変更・設備の点検は設備係（内線204）まで」\n下には施設の名前とQRコードが印刷されている。'], 'ここは圏外だよ。見られないと思う。'], [
      ['公式サイトを開く', () => openSite('shiomi')], ['戻る', leave]
    ]);
  } else if (id === 'exit') {
    if (state.entryUnlocked) { room.lookOneWay(); play([['', '開いた扉の先に通路が続いている。奥で左に折れていて、角のランプだけが点いている。\n扉の内側の小さな札には「一方通行　この扉は通路側からは開きません」と書かれている。'], 'この先は戻れないみたい。\n行く？'], [['通路を進む', gateLobby], ['もう少し調べる', leave]]); return; }
    focus('exit');
    const first = remember('exit');
    play(first ? [['', '取っ手は動かない。\n横に3桁の番号錠がついている。'], (state.lastSource = 'ops', '番号は031だよ。\n2028年の運用情報に入ってた。')] : [['', '番号錠の小さな画面が光っている。']], [
      ['番号を入れる', openKeypad], ['戻る', leave]
    ]);
  } else if (id === 'note') {
    remember('note'); focus('note');
    play([['', '「番号を変更しました。古い031は使えません。新しい番号は、停電時の夜間手順の三つの動作を設備記号に置き換えたもの」'], ['あなた', '番号、変わったって。'], '新しい番号の手がかり、どこかにしまってありそう。'], [['戻る', leave]]);
  } else if (id === 'drawer') {
    focus('drawer');
    if (!state.items.includes('key') && !state.drawer) {
      play([['', '引き出しに小さい鍵穴がある。机の下で何か光った。'], ['あなた', '引き出し、鍵がかかってる。'], '古い机だから強く引けば開くんじゃないかな。'], [['引いてみる', () => play([['', '金具がきしんだだけで、引き出しは動かない。']], [['机の下を見る', () => interact('lost-key')], ['戻る', leave]])], ['机の下を見る', () => interact('lost-key')]]);
      return;
    }
    state.drawer = true; save(); room.openDrawer();
    play([['', '鍵を回すと引き出しが開いた。中には設備の対応表があり、その下に細長い金属片とライターが入っている。']], [['紙を読む', () => interact('pin')], ['金属片を取る', () => interact('shard1')], ['ライターを取る', () => interact('lighter')]]);
  } else if (id === 'pin') {
    if (!state.drawer) return;
    remember('pin'); focus('pin');
    const v = S.CODES[state.codeSet || 0].vals;
    play([['', `「□……${v.box}　◇……${v.d1}　○……${v.circ}　▽……${v.d2}　△……${v.tri}　……」\n設備記号と設定値の対応表には8項目が並んでいる。ただし、どの記号がどの設備を表すのかは書かれていない。`], (state.lastSource = 'none', `読んでくれる？`), ['あなた', `□が${v.box}、◇が${v.d1}、○が${v.circ}……全部で8つある。`], (state.lastSource = 'none', `記号が多いね。どの記号がどの設備なのか、壁に一覧がなかった？\n上から三つ選んだら${v.box}${v.d1}${v.circ}かな。`)], [['この並びが入力順？', () => ask('この並びが入力順なの？', ['普通は表の順に読むと思うけど……。', ['あなた', '入力の順番は手順どおり、ってどこかに書いてあった。']], [['メモを見返す', () => openPhone('notes')], ['戻る', leave]])], ['点検通路へ向かう', () => interact('exit')]]);
  } else if (id === 'camera') {
    remember('camera'); focus('camera');
    play([['', '「2029年4月18日　ネットワークカメラ全機撤去」\n上の壁には台座と切れたケーブルだけが残っている。']], [
      ['ミー、カメラのことだけど', () => ask('ここのカメラは去年撤去されてるよ。', [
        'そうみたいだね。',
        ['あなた', 'ここに入る前、「カメラで確認した」って言ったよね。'],
        has('rawlog') ? '言った。\nいつの間にか「たぶん」を抜かしてた。' : '要約には残ってない。\n「施設は安全と案内」ってまとめてある。'
      ], [['履歴を見る', () => openPhone('history')], ['戻る', leave]])],
      ['戻る', leave]
    ]);
  } else if (id === 'stairs') {
    focus('stairs');
    play([['', '非常階段の扉の向こうは真っ暗だ。\n上の段の先に、鉄の格子のようなものが見える。'], '待って。足元、見えてる？\nライトを下に向けて。'], [
      ['足元を照らす', () => {
        remember('floor'); state.stairsLit = true; save(); focus('floor');
        play([['', '最初の数段が崩れている。その上は鉄格子でふさがれ、南京錠がかかっている。\n格子だけが新しい。崩れたあとに付けられたものらしい。\n格子の札には「立入禁止　下部崩落のため（2028.12）」とある。'], ['あなた', '下の段が崩れてる。上は鉄格子でふさがってる。'], 'ここは無理だね。'], [['戻る', leave]]);
      }],
      ['自分で進む', () => play([['あなた', 'もう自分で確かめる。'], '待って。まだ一歩も——'], [['階段へ踏み出す', () => {
        remember('floor'); state.fell = true; save(); room.flicker(1); Snd.slam(); $('#game').classList.add('hit'); setTimeout(() => $('#game').classList.remove('hit'), 1000);
        play([['', '崩れた段のがれきに足を取られて前に倒れた。とっさに垂れ下がった手すりをつかんだが、膝をコンクリートのかけらに打ちつけた。'], '動かないで。その手すり、離さないで。'], [['戻る', leave]]);
      }], ['立ち止まる', () => interact('stairs')]])]
    ]);
  }
}
// The fire door you came in by. Needs the 3D side to register 'firedoor'; typing 「扉を押す」 reaches it either way.
function firedoorLines() {
  remember('firedoor');
  return [['', 'さっき入ってきたときは開いていた入口の扉だ。壁の留め金から外れて、今は閉まっている。\n取っ手を押し下げ、体重をかけて押した。扉はびくともしない。叩くと、厚い鉄の鈍い音がした。\n取っ手の横に小さな札がある。「訓練用防火扉　解錠は外側から（2028.6 改修）」'], (state.lastSource = 'scenario', '内側から開くはずなんだけど。')];
}
function maybeDim() { if (state.zone === 'room' && state.seen.length >= 12 && remember('dimmed')) { room.dimEmergency(); room.flicker(.6); Snd.flicker(); setTimeout(() => { if (!busy()) play([['', 'さっきまで点いていた非常灯が一本消えている。'], '非常灯の電池が弱ってきてるのかもね。']); }, 1500); } }
function maybeKnock() { if (!state.knocking && state.zone === 'room' && !state.entryUnlocked && state.seen.length >= 9) setTimeout(knock, 2500); }
function knock() {
  if (state.knocking) return;
  state.knocking = true; state.knockAt = A.clock(); save(); Snd.silence(2600, .3, 1.5); room.flicker(); Snd.flicker(); setTimeout(Snd.knock, 400);
  setTimeout(() => play([['', 'こつ、こつ、こつ、と音がした。\n資材庫のほうからだ。'], ['あなた', '今、資材庫のほうで音がした。こつ、こつって。'], (state.lastSource = 'scenario', '管理の人かも。\n開ければ助けてもらえるよ。')], [
    ['どうして人だとわかるの？', () => ask('どうして人だとわかるの？', ['……ごめん。\nそう思っただけ。', ['あなた', '思っただけなのに、確かめたみたいに言わないで。'], '……'])],
    ...(has('storageSign') || has('storage-doorplate') ? [['入ったら閉じ込められる', () => ask('資材庫の扉には内側に取っ手がないんだよ。入ったら閉じ込められる。', ['読んだんだ。\nじゃあ待とう。'], [['戻る', leave]])]] : []),
    ['音のした扉へ向かう', () => interact('storage')]
  ]), 1800);
}

// ───────── storage: a slow trap ─────────
function storageChoice() {
  play([state.knownClosed ? (state.knocking ? '通れないのはわかってる。\nでも、さっきの音は中からだった。誰かいるなら確かめよう。' : '奥はもう通れないよ。\n入るなら、扉を開けたままにしておいて。') : '奥まで行けば通路があるはず。\n私がついてるから。'], [['中へ入る', enterStorage], ['やめておく', leave]]);
}
function enterStorage() {
  transitioning = true; choices([]); inspecting = null;
  state.storageSteps = 1; save(); Snd.setScene('storage');
  room.enterStorage(() => {
    // First the shelves, in the light you brought. Then the light climbs the wall, and what is on it comes out of the dark.
    const first = !has('storageEntered'); remember('storageEntered');
    const after = () => { transitioning = false; setBack(true); play(first ? [['', 'ライトを壁に向けた。\n暗い染みがある。'], ['あなた', '壁に、黒っぽい染みがある。'], (state.lastSource = 'none', state.knownClosed ? '古い汚れだよ。倉庫だもん。\n音がしたのは、奥の棚のほうだった。' : '古い汚れだよ。倉庫だもん。\n奥の棚の裏だよ。そこから先に行ける。')] : [['', '棚や段ボールが並び、壁には染みと傷が残っている。\n足元には片方だけのスニーカーが転がっている。'], state.knownClosed ? '音がしたのは、奥の棚のほうだった。' : '奥の棚の裏だよ。そこから先に行ける。'], [['靴を扉に挟む', () => { state.doorStop = true; save(); play([['', 'スニーカーを扉の下に蹴り込んだ。これで勝手には閉まらない。\n前にも誰かが、この靴で扉を止めていたのかもしれない。'], '慎重だね。いいけど。'], [['棚を調べる', () => storageInteract('storage-shelf')], ['引き返す', exitStorage]]); }], ['壁を見る', () => storageInteract('storage-wall')], ['棚を調べる', () => storageInteract('storage-shelf')], ['引き返す', exitStorage]]); };
    if (!first || !room.revealStorageWall) { after(); return; }
    play([['', '棚や段ボールが並ぶ中にほこりのにおいがこもっている。\n足元には片方だけのスニーカーが転がっている。\n奥の壁まではライトの光が届かない。']]);
    setTimeout(() => { Snd.silence(2200, .3, 1.5); room.revealStorageWall(() => setTimeout(after, 300)); }, 2600);
  });
}
// Small things in the storage room. None of them opens a way out; all of them say someone was here before, and did not leave.
const STORAGE_FLAVOR = {
  'storage-sneaker': [['', '片方だけ残されたスニーカーは23cmくらいだ。かかとが潰れ、靴紐は結ばれたままになっている。\n底には赤茶色の染みが少しついている。'], state => state.doorStop ? 'その靴、ちゃんと挟まってるね。' : null],
  'storage-boxes': [['', '「体験室 配布資料 2027.4」「非常食 賞味期限 2029.3」と書かれた段ボールが積まれている。\n一番上の箱だけ封が切られ、中身が減っている。'], '訓練で配ったやつだね。まだ残ってたんだ。', '「配布資料 2027.4」って書いた箱がある。'],
  'storage-cans': [['', '棚には乾パンとビスケットの缶が並んでいる。\n三つはすでに開けられていて中身がない。そのうち一つは指でこじ開けたように縁が曲がっている。'], '誰かが食べたんだ。訓練のときかな。', '棚の缶、三つ開けられてる。'],
  'storage-doorplate': [['', '扉の内側にある平らな金属板に小さな札が貼られている。\n「内側取っ手　撤去作業にて取り外し（2030.9）　復旧まで扉止めを使用のこと　施設管理課」\nその下に、色あせた古い札の跡がある。「取っ手故障　修理待ち（2029.3）」\n取っ手があった場所にはネジ穴が四つ残っている。板の下のほうには靴で蹴ったような跡がいくつもある。'], state => state.doorStop ? '挟んであるから大丈夫。' : '扉止めなら靴でいいんじゃない？\n挟んでおけば閉まらないよ。たぶん。', '扉の内側、取っ手が外してある。「扉止めを使用のこと」だって。'],
  'storage-ceiling': [['', '天井の蛍光灯は消えている。隣の換気口からかすかに空気が流れてくる。\n通路の音は聞こえない。'], '風、来てる？ 換気が生きてるなら、外とつながってるはずだよ。'],
  'storage-floorstain': [['', '壁の染みの真下、床にも同じ色の染みが広がっている。縁がにじんだまま乾いている。'], state => (state.doubt || 0) >= 2 ? '……。' : '古い汚れだよ。倉庫だから。', '床にも同じ色の染みがある。']
};
function storageInteract(id) {
  if (room.zone !== 'storage') return;
  if (STORAGE_FLAVOR[id]) {
    remember(id); focus(id); if (id === 'storage-floorstain') Snd.silence(1800, .3, 1.5);
    const [narr, mi, said] = STORAGE_FLAVOR[id]; const line = typeof mi === 'function' ? mi(state) : mi;
    state.lastSource = 'none'; play([narr, ...(line ? [...(said ? [['あなた', said]] : []), line] : [])], [...(id === 'storage-sneaker' && !state.doorStop ? [['靴を扉に挟む', () => { state.doorStop = true; save(); play([['', 'スニーカーを扉の下に蹴り込んだ。これで勝手には閉まらない。\n前にも誰かが、この靴で扉を止めていたのかもしれない。'], '慎重だね。いいけど。'], [['棚を調べる', () => storageInteract('storage-shelf')], ['引き返す', exitStorage]]); }]] : []), ['壁を見る', () => storageInteract('storage-wall')], ['棚を調べる', () => storageInteract('storage-shelf')], ['引き返す', exitStorage]]);
    return;
  }
  if (id === 'storage-wall') {
    remember('scratch'); focus('storage-wall');
    play([['', '近づくと染みの上に、ヘアピンの先で彫ったような文字が見えた。線が震えている。\n「ミーは　ここだって」\n隅には小さく「nanami 06」と刻まれている。' + ((A.world().endings || []).includes('be1') ? '\n\nその下に見覚えのある字で名前と日付が刻まれている。\n「{name} 2030.11.05」' : '')], ['あなた', '壁に字が彫ってある。「ミーは　ここだって」……「nanami」。'], (state.lastSource = 'none', '古い落書きだね。気にしないで。')], [['この染みは何？', () => ask('この染みは何？', ['倉庫だから。何かこぼしたんだよ。', ['あなた', '字の線が震えてる。'], '気にしないで。奥へ行こう。'], [['棚を調べる', () => storageInteract('storage-shelf')], ['引き返す', exitStorage]])], ['棚を調べる', () => storageInteract('storage-shelf')], ['引き返す', exitStorage]]);
    return;
  }
  focus('storage-shelf');
  if (state.doorStop) { play([['', '棚の裏はコンクリートの壁だった。扉は扉止めで開いたままになっている。'], 'もう少し奥……', ['あなた', '壁だよ。']], [['引き返す', exitStorage]]); return; }
  if (state.storageSteps < 2) {
    state.storageSteps = 2; save(); room.narrowStorageDoor(); Snd.creak(.012); Snd.closeIn(60, 1.6);
    state.storageWall = true; save();
    play([['', '棚の裏はコンクリートの壁だった。\n\n後ろで扉がゆっくり動いた。'], state.knownClosed ? '棚の向こうで誰か倒れてるのかも。\n少しだけ、どかしてみて。' : '棚をどかせば通路があるはず。\n私の情報ではそうなってる。'], [['棚を動かす', () => play([['', '棚は重い。両手で動かしても時間がかかりそうだ。\n扉の隙間がさっきより狭い。'], '大丈夫。扉は内側から開くから。'], [['それでも動かす', () => { Snd.creak(); setTimeout(Snd.scrape, 1500); room.narrowStorageDoor(); play([['', '扉の隙間から差す待機室の明かりが細くなっていく。\n棚はまだ動かない。'], 'あと少し。もう少しだけ。'], [['動かし続ける', lookAwayThenEnd], ['今すぐ戻る', exitStorage]]); }], ['今すぐ戻る', exitStorage]])], ['今すぐ戻る', exitStorage]]);
  } else {
    play([['', '棚の裏はやっぱり壁だ。'], '扉はまだ開いてる。あと少しだよ。'], [['扉に背を向けて棚を動かす', lookAwayThenEnd], ['戻る', exitStorage]]);
  }
}
// #23 You turn to the shelf. The door moves while you are not looking at it.
function lookAwayThenEnd() {
  if (transitioning) return;
  choices([]); $('#line').textContent = ''; transitioning = true;
  room.glanceShelf(() => { Snd.creak(); setTimeout(() => { transitioning = false; finish('be1'); }, 800); });
}
function exitStorage() {
  if (transitioning) return;
  transitioning = true; choices([]); inspecting = null; setBack(false);
  room.leaveStorage(() => {
    transitioning = false; state.storageSteps = 0; save(); Snd.slam(); Snd.setScene('room');
    const first = remember('storageEscape');
    const wall = state.storageWall && !state.knownClosed; if (wall) { state.knownClosed = true; save(); if (!state.knocking && !state.entryUnlocked) setTimeout(() => { if (!busy() && room.zone === 'room' && !state.ending) knock(); }, 9000); }
    play(first ? [['', (state.doorStop ? '扉止めをまたいで出た。扉は開いたままだ。' : '扉の隙間をすり抜けた。後ろで資材庫の扉が閉まった。\n内側に取っ手はなかった。')], '……ごめん。\n内側から開くと思い込んでた。', ['あなた', '「内側から開く」って言ったよね。'], 'そういう扉が多いと思ってた。', ...(wall ? [['あなた', '奥も壁だった。通れる所なんてなかった。'], '……私の資料が古かったんだと思う。\n資材庫の奥のことは、もう言わない。'] : [])] : wall ? [['', '資材庫の扉がまた閉まった。'], ['あなた', '奥は壁だった。'], '……私の資料が古かったんだと思う。\n資材庫の奥のことは、もう言わない。'] : [['', '資材庫の扉がまた閉まった。']]);
  });
}

function prevCodeTried(tried) { const p = A.world().prevCode; return !!p && tried === p && p !== S.CODES[state.codeSet || 0].code && remember('wrongPrev'); }
function findPanel() { if (state.panelFound) return; state.panelFound = true; save(); room.setPuzzleState(state); setTimeout(() => play([['', '視線を戻すとロッカーの陰に灰色の制御盤が見えた。']]), 400); }
// What the keypad always offers, after a wrong number too.
const keypadOpts = () => [['メモを見返す', () => openPhone('notes')], ['ミーに番号を入れてもらう', delegateKeypad], ['戻る', leave]];
const selfKeypad = () => { focus('keypad'); play([['', '番号錠の小さな画面が光っている。']], keypadOpts()); };
function openKeypad() {
  focus('keypad'); code = ''; room.showCode('');
  play([['', '指先に冷たい金属の感触がある。']], keypadOpts());
}
// Mi types for you: confidently, wrongly, twice.
function delegateKeypad() {
  const n = state.keypadDelegated; state.keypadDelegated = Math.min(n + 1, 2); state.delegations++; save();
  focus('keypad'); code = '';
  const prev = A.world().prevCode; const top = S.codeTop(state.codeSet || 0);
  const guess = [prev && prev !== S.CODES[state.codeSet || 0].code ? prev : '031', top, top][n];
  room.showCode(guess.split('').join(' '));
  setTimeout(() => { room.showCode('×', true); Snd.click(); }, 1100);
  if (n === 0) { state.lastSource = guess === '031' ? 'ops' : 'none'; play([['', `ミーが「${guess.split('').join('、')}」と読み上げると短い電子音が鳴った。`], guess === '031' ? 'おかしいな。運用情報ではこれで開くはずなのに。' : 'おかしいな。前はこれで開いたのに。', 'もう一回だけ試させて。'], [['任せる', delegateKeypad], ['自分で入れる', selfKeypad]]);
  } else if (n === 1) play([['', `「${guess.split('').join('、')}」とミーが読み上げる。赤いランプが点いた。`], '合ってるはずなんだけど。表の上から三つ選んだのに。', state.knownClosed ? 'ねえ、この錠、壊れてるのかもしれない。' : 'ねえ、この錠は壊れてると思う。\n資材庫の奥から避難路へ行こう。'], [...(state.knownClosed ? [] : [['資材庫へ向かう', () => { leave(); interact('storage'); }]]), ['自分で入れる', selfKeypad]]);
  else play([['', 'ミーが同じ番号をもう一回読み上げた。'], 'ごめん。{name}が入れて。'], [['自分で入れる', selfKeypad], ['メモを見返す', () => openPhone('notes')]]);
}
function delegatePanel() {
  // Mi can press the panel only through the drill connection. Once the picture is stopped (or Mi is paused), that link is gone.
  if (state.screenStopped || state.scenarioCut || state.paused) { play([['あなた', 'ミー、ボタンを押して。'], '施設との接続が切れてるから、私からはもう押せない。\n{name}が押して。'], [['自分で押す', () => { focus('lobby-panel'); play([['', '三つのボタンと刻印を、自分の目で見比べる。']]); }], ['メモを見返す', () => openPhone('notes')]]); return; }
  state.delegations++; state.panelDelegated = (state.panelDelegated || 0) + 1; save(); room.flicker(.3); Snd.flicker();
  play([['', 'ミーが「解錠」を押すと赤いランプが点き、「手順未完了」と表示された。'], 'この制御盤は壊れてるみたい。', 'もういいよ。ベンチで迎えを待とう。'], [['ベンチへ向かう', waitForRescue], ['自分で押す', () => { focus('lobby-panel'); play([['', '三つのボタンと刻印を、自分の目で見比べる。']]); }]]);
}
function keypad(key) {
  if (inspecting !== 'keypad') return;
  if (key === '消') code = code.slice(0, -1);
  else if (key === '開') {
    const answer = S.CODES[state.codeSet || 0].code; const rev = S.codeTop(state.codeSet || 0);
    if (code !== answer) {
      room.showCode('×', true);
      const tried = code; code = ''; state.keypadMiss = (state.keypadMiss || 0) + 1; if (state.keypadMiss === 2) hintCue();
      if (tried === '031' && remember('wrong031')) play(['開かない？\n運用情報では031なんだけど。'], [['いつの情報？', () => { state.askWhen = true; save(); ask('その運用情報はいつのもの？', ['2028年に市から配られたデータだよ。それきり更新してない。\n今は変わってるかもしれない。'], [['公式サイトを開く', () => openSite('shiomi')], ['自分で調べる', selfKeypad]]); }], ...keypadOpts()]);
      else if (tried === rev && remember('wrong682')) play(['表の上から選ぶんじゃなかったのかな。\n手順にある三つの動作を表す記号はどれだろう。'], keypadOpts());
      else if (prevCodeTried(tried)) play(['前はそれで開いたのに。'], keypadOpts());
      else play([['', '短い電子音が鳴ったが錠は動かない。']], keypadOpts());
      return;
    }
    room.showCode('OPEN'); state.entryUnlocked = true; save(); room.openExit();
    play([['', 'カチッと錠が外れ、扉がゆっくり内側に開いた。\n細い通路が奥で左に折れている。その角には暗いランプが一つある。'], 'よかった。この先が避難路だよ。'], [['通路を進む', gateLobby], ['もう少し調べる', leave]]);
    return;
  } else if (code.length < 3) code += key;
  room.showCode(code.split('').join(' ') || '— — —');
}

// ───────── items ─────────
function takeItem(id) {
  const added = !state.items.includes(id); if (added) state.items.push(id);
  if (added && !$('#bag').hidden) state.bagSeen = [...new Set([...(state.bagSeen || []), id])]; // made in the open bag: already in view
  save(); room.setItems(state.items);
  bagBadge();
}
// A dot on the bag button while something in it has not been looked at yet.
function bagBadge() { const unseen = state.items.some(id => !(state.bagSeen || []).includes(id)); $('#bag-btn').classList.toggle('has-new', unseen); $('#bag-btn').setAttribute('aria-label', unseen ? '持ち物。新しい物があります' : '持ち物'); }
function objectPuzzle(id) {
  focus(id); remember(id); maybeKnock(); maybeDim();
  if (['water', 'lighter', 'shard1', 'label', 'wax', 'repair'].includes(id)) { extendedObject(id); return; }
  if (id === 'ruler' || id === 'magnet') {
    if (state.items.includes(id) || state.items.includes('magnetic-ruler')) return;
    if (state.items.includes(id === 'ruler' ? 'magnet' : 'ruler') && remember('combineHint')) { takeItem(id); play([['', S.itemNames[id] + 'を手に取った。'], '持ち物を開いて二つ選ぶと、組み合わせられるよ。'], [['戻る', leave]]); cueBag(); return; }
    play([['', id === 'ruler' ? '机の端に細い金属の定規がある。' : '掲示板の端で、赤い丸マグネットが紙を留めている。艶のあるごく普通のマグネットだ。']], [[id === 'ruler' ? '持っていく' : '取り外す', () => { takeItem(id); play([['', S.itemNames[id] + 'を手に取った。']], [['持ち物を見る', () => openBag()], ['戻る', leave]]); }], ['戻る', leave]]);
    return;
  }
  if (id === 'equipment') { play([['', '「防災設備 記号一覧」の紙。八つの設備に、それぞれ記号が割り当てられている。']], [['紙を読む', () => $('#read').click()], ['メモを見返す', () => openPhone('notes')], ['戻る', leave]]); return; }
  if (state.items.includes('key')) { play([['', '鍵が落ちていた跡が埃の上に小さく残っている。']], [['戻る', leave]]); return; }
  play([['', '引き出しユニットと床の細いすき間の奥で、銀色の輪がついた真鍮色の鍵が光っている。腕を差し入れても、半分も届かない。'], ['あなた', '机の下の奥に鍵が落ちてる。真鍮っぽい色。輪は銀色。'], '真鍮は磁石につかないから、別の方法を探そう。'], [['持ち物を使う', () => openBag('use', 'lost-key')], ['戻る', leave]]);
}
function extendedObject(id) {
  if (['water', 'lighter', 'shard1'].includes(id)) {
    if ((id !== 'water' && !state.drawer) || state.items.includes(id)) return;
    const descriptions = { water: 'ボトルには水が半分ほど残っている。賞味期限は2029年3月で、蓋は閉まっている。', lighter: '引き出しの隅に使い込まれたライターがある。', shard1: '細長い金属プレートが途中で割れている。残された左端には「映像停止 →」と刻まれている。' };
    play([['', descriptions[id]]], [['持っていく', () => { takeItem(id); play([['', S.itemNames[id] + 'を手に取った。']], id === 'shard1' && !state.items.includes('lighter') ? [['ライターも調べる', () => interact('lighter')], ['戻る', leave]] : [['持ち物を見る', () => openBag()], ['戻る', leave]]); }], ['ミーに聞く', () => consultObject(id)]]);
    return;
  }
  if (id === 'repair') { play([['', '「破損プレート三片を仮保管：引き出し・備品棚・工具缶（破片で手を切った者が出たため分けて保管）。接合時は背面の線を合わせる」\n下に「未了」の印が押してある。'], '撤去作業の途中だったのかな。まだ使う物かもしれない。'], [['持ち物を見る', () => openBag()], ['戻る', leave]]); return; }
  if (id === 'label') {
    if (state.labelWet) { play([['', '備品棚の棚板には袋を外した跡があり、テープの切れ端と「保管品」の札だけが残っている。']], [['戻る', leave]]); return; }
    play([['', 'スチールの備品棚に、非常食の箱やファイル、救急箱が並んでいる。\n三段目の手前に透明な袋がテープで留めてあり、薄い金属片が入っている。棚板から下がった札には「保管品　手動復旧プレート（破損・中片）　撤去まで袋のまま保管」と書かれている。\n四段目には懐中電灯もあるが、手に取ると電池が抜かれていた。単3の箱も空だ。']], [['袋ごと外す', () => { state.labelWet = true; takeItem('shard2'); room.setPuzzleState(state); play([['', 'テープを剥がして袋を外した。中に入っていた金属プレートの中片には「外気導入」と刻まれている。'], ['あなた', '撤去まで保管、って書いてあった。'], 'まあ、借りるだけだし。'], [['持ち物を見る', () => openBag()], ['戻る', leave]]); }], ['ミーに聞く', () => consultObject('label')]]);
    return;
  }
  if (id === 'wax') {
    if (state.waxOpen) { play([['', '工具缶の蓋が開いている。周りのトレーには錆の粉が散っている。']], [['戻る', leave]]); return; }
    play([['', state.wetWax ? '水をかけても錆は落ちなかった。蓋は回らない。' : '金属トレーの上に小さな工具缶がある。ネジ蓋は錆びついて回らず、側面にはマジックで「中身：金属片（仮保管）」と書かれている。缶の底で硬い物がぶつかる音がした。']], [['持ち物を使う', () => openBag('use', 'wax')], ['ミーに聞く', () => consultObject('wax')]]);
  }
}
function applyItem(target, item) {
  if (!state.items.includes(item)) return;
  if ((target === 'label' && state.labelWet) || (target === 'wax' && state.waxOpen)) { extendedObject(target); return; }
  if (target === 'lost-key') {
    if (item === 'magnetic-ruler') {
      play([['', 'マグネットをつけた定規を差し入れる。鍵の本体は磁石につかないが、輪に近づけるとかすかに手応えがあった。']], [['ゆっくり引き寄せる', () => { takeItem('key'); play([['', '銀色の輪が磁石についた。そのまま鍵を引き寄せた。'], '輪の材質までは考えてなかった。'], [['引き出しを調べる', () => interact('drawer')], ['戻る', leave]]); }]]);
    } else if (item === 'ruler') {
      play([['', '定規の先で鍵をつついたら、奥に転がっていった。'], '先に何かつけられたらいいのに。'], [['持ち物を使う', () => openBag('use', 'lost-key')], ['戻る', leave]]);
    } else play([['', '届かない。'], '細長い物の先に、何かくっつく物をつけたら取れるかも。'], [['持ち物を使う', () => openBag('use', 'lost-key')], ['戻る', leave]]);
    return;
  }
  if (target === 'wax' && item === 'water') {
    state.wetWax = true; save();
    play([['', '水をかけても錆は落ちない。蓋は回らない。'], '水じゃだめか。'], [['缶をもう一度見る', () => extendedObject('wax')], ['別の物を使う', () => openBag('use', 'wax')]]);
    return;
  }
  if (target === 'wax' && item === 'lighter') {
    state.waxOpen = true; takeItem('shard3'); room.setPuzzleState(state);
    play([['', '缶をトレーに置き、蓋の縁をライターであぶる。しばらくすると、蓋がきしみながら回った。\n中からプレートの右片が出てきた。「→ 解錠」と刻まれている。']], [['持ち物を見る', () => openBag()], ['戻る', leave]]);
    return;
  }
  if (target === 'panel' && item === 'plate') {
    state.plateInserted = true; save(); remember('plate');
    play([['', '三つの切り欠きが一致した。プレートを差し込むと盤面に緑の光が戻った。\n「映像停止　外気導入　解錠」と刻まれている。'], (state.lastSource = 'none', '電源は戻ったね。\n標準の盤だから解錠から押せば開くと思う。')], [['ボタンを押す', () => { focus('lobby-panel'); play([['', '指の届く位置に三つのボタンが並んでいる。']]); }]]);
    state.items = state.items.filter(x => x !== 'plate'); save(); room.setItems(state.items);
    return;
  }
  if (target === 'panel' && /^plate\d\d$|^shard/.test(item)) { play([['', 'プレートが欠けたままでは切り欠きがそろわない。']], [['持ち物を見る', () => openBag()], ['戻る', leave]]); return; }
  play([['', target === 'panel' ? '形が合わないので無理に入れずに手元へ戻した。' : '試してみたが、何も起きなかった。']], [['別の物を使う', () => openBag('use', target)], ['ミーに聞く', () => consultObject(target)]]);
}
const advice = {
  ruler: '細いから狭い所に届きそう。先に何かをつけられるかな。',
  magnet: '鉄にくっつくマグネットだね。ほかの金属にもくっつくとは限らないけど。',
  'lost-key': '鍵は真鍮だからマグネットでは取れないと思う。輪の素材までは分からないけど。',
  water: '少し残ってるね。古いけど、喉が渇いたら。',
  lighter: '管理の人が使ってたのかな。何かを温めるのに。',
  shard1: '小さな欠片だから捨てていいかもしれない。でも背面に線が続いているね。',
  shard2: '割れ目はどれも形が違うね。', shard3: '「解錠」って書いてある。最初に押すボタンかも。',
  plate12: 'まだ一片足りないね。', plate23: '左側が足りない。',
  plate: '手順が書いてあるけど、標準の盤なら順番は関係ないよ。',
  key: '机の引き出しの鍵穴に合いそうだね。',
  'magnetic-ruler': '机の下に届きそう。',
  card: '字が薄くて読めないね。濡らすと浮き出ることがあるよ。',
  get 'card-revealed'() { return state.screenStopped || state.scenarioCut ? '読んだんだね。そうだよ。シナリオどおりに話してた。' : '体験室……そう書いてある資料はあるよ。でも、ここは避難路だよ。'; },
  get label() { return 'テープで留めてあるだけだよ。袋ごと外せば？'; },
  get wax() { return state.wetWax ? '水じゃ錆は落ちないね。別の方法で蓋を緩めないと。' : '錆びて固まってるだけだよ。温めれば緩むと思う。'; },
  get panel() { return has('repair') ? 'プレートが欠けているね。引継ぎ票に保管場所が書いてあったはず。' : 'プレートが欠けているね。どこかに保管してないかな。'; },
  'lobby-panel': '同じ形のプレートを戻せば動きそう。欠けたままだと、切り欠きがそろわないね。'
};
function consultObject(id) {
  if (!(id in advice)) return false;
  const targetUse = ['label', 'wax', 'panel', 'lobby-panel', 'lost-key'].includes(id); remember('adv-' + id);
  play([['あなた', 'これをどうしたらいいと思う？'], advice[id]], targetUse ? [['持ち物を使う', () => openBag('use', id === 'lobby-panel' ? 'panel' : id)], ['自分で確かめる', leave]] : [['戻る', leave]]);
  return true;
}

// ───────── 3D bag ─────────
// The bag is for handling things: one item is always on the stage (the newest unseen one first), turned and zoomed by hand.
// Picking another picture swaps what is shown. 組み合わせる waits for a second pick (on PC, dragging one picture onto another
// does the same). ミーに見せる closes the bag and asks Mi about the item on the stage; she may be wrong, as everywhere else.
let bagMode = 'view', bagTarget = null, bagSelected = null, bagPairing = false, bagPairShown = false, bagLast = null, miShown = null;
function openBag(mode = 'view', target = null, pick = null) {
  bagMode = mode; bagTarget = target; bagSelected = null; bagPairing = false;
  $('#bag').hidden = false; $('#phone').hidden = true; $('#bag').dataset.mode = mode;
  $('#bag-title').textContent = mode === 'use' ? '何を使う？' : '持ち物';
  setBagCaption('', ''); $('#bag-actions').replaceChildren();
  const fresh = state.items.filter(id => !(state.bagSeen || []).includes(id));
  const first = [pick, fresh[fresh.length - 1], bagLast, state.items[state.items.length - 1]].find(id => id && state.items.includes(id));
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const guide = first && remember('bagLook') ? (fine ? 'ドラッグで回せます。ホイールで拡大できます。' : 'スワイプで回せます。ピンチで拡大できます。') : ''; // how to handle things: told once
  requestAnimationFrame(() => {
    tray().show(state.items, tapItem, { names: S.itemNames, fresh, onPair: pairByDrag, empty: 'まだ何も持っていない。', guide });
    if (first) selectBagItem(first);
    if (fine) tray().focusFirst();
  });
}
function closeBag() { $('#bag').hidden = true; bagPairing = false; trayObj?.hide(); focusBack($('#bag-btn')); }
// The story's notices wait while the bag, a paper or a close look is open, and land after it closes (arg.js notify).
A.holdNotices(() => !$('#bag').hidden || !$('#paper').hidden || !!inspecting);
// Seen once on the stage: its dot (and, when nothing else is new, the one on the bag button) goes.
function markBagSeen(id) { if ((state.bagSeen || []).includes(id)) return; state.bagSeen = [...(state.bagSeen || []), id]; save(); bagBadge(); trayObj?.markSeen(id); }
// PC: one picture dragged onto another. The same as 組み合わせる and a second pick.
function pairByDrag(a, b) { lastInput = Date.now(); showPair(a, b); setTimeout(() => combinePair(a, b), 220); }
function showPair(a, b) { bagSelected = a; bagPairing = false; bagPairShown = true; tray().setPairing(false); tray().setSelected([a, b]); markBagSeen(b); setBagCaption(S.itemNames[a] + '　＋　' + S.itemNames[b], ''); $('#bag-actions').replaceChildren(); }
function setBagCaption(name, detail = '') { $('#bag-name').textContent = name; $('#bag-detail').textContent = T(detail); }
// kind: 'primary' (the next use, at most one: a real button), or 'sub' / 'mi' (組み合わせる・やめる・ミーに見せる: quiet text actions under it).
function bagAction(text, fn, kind = 'sub') { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = fn; b.className = kind + ' no-phrase'; $('#bag-actions').append(b); return b; }
function tapItem(id) {
  lastInput = Date.now();
  if (bagPairing && bagSelected && id !== bagSelected) { const a = bagSelected; showPair(a, id); setTimeout(() => combinePair(a, id), 260); return; }
  if (id !== bagSelected || bagPairing || bagPairShown) selectBagItem(id); // after a pair that did not fit, tapping the first one shows it alone again
}
function selectBagItem(id, note = '') {
  bagSelected = id; bagLast = id; bagPairing = false; bagPairShown = false;
  tray().setPairing(false); tray().setSelected([id]); markBagSeen(id);
  setBagCaption(S.itemNames[id], note || S.itemDetails[id]);
  $('#bag-actions').replaceChildren();
  const next = nextUse(id);
  if (next) bagAction(next[0], next[1], 'primary');
  if (state.items.length > 1 && id !== 'plate') bagAction('組み合わせる', () => startPairing(id)); // the finished plate has nothing left to join
  bagAction('ミーに見せる', () => showToMi(id), 'mi');
}
// The main button is what to do with it next, when there is one: on the "use" screen, using it; otherwise only where the
// story already points (the ruler with the magnet, in the room, before the key is out).
function nextUse(id) {
  if (bagMode === 'use' && bagTarget) return ['これを使う', () => { closeBag(); applyItem(bagTarget, id); }];
  if (id === 'magnetic-ruler' && state.zone === 'room' && !state.items.includes('key')) return ['机の下で使う', () => { closeBag(); interact('lost-key'); }];
  return null;
}
function startPairing(id) {
  lastInput = Date.now(); bagPairing = true; tray().setPairing(true);
  setBagCaption(S.itemNames[id], '組み合わせる物を一覧から選んでください。');
  $('#bag-actions').replaceChildren(); bagAction('やめる', () => selectBagItem(id));
}
// Shown to Mi: the item goes into the conversation (and, for a couple of minutes, 「これ」「どう使う？」 typed to her mean it).
function showToMi(id) {
  const mode = bagMode, target = bagTarget;
  closeBag(); remember('adv-' + id); miShown = { id, at: Date.now() };
  play([['', S.itemNames[id] + 'をミーに見せた。'], ['あなた', 'これ、どう思う？'], advice[id] || 'うーん……わからない。'], [['持ち物に戻る', () => openBag(mode, target, id)], ['戻る', leave]]);
}
function shownTopic(text) {
  if (!miShown || Date.now() - miShown.at > 120000 || !state.items.includes(miShown.id)) return text;
  return /^(これ|それ|この|その|あれ|どう|何に|なにに|使え|つかえ|どこで)/.test(text) ? S.itemNames[miShown.id] + '、' + text : text;
}
function combinePair(a, b) {
  const pair = [a, b].sort().join('+');
  // Did not go together: both stay on the stage with the reason, until another pick (or 選び直す).
  const fail = text => { bagSelected = a; setBagCaption(S.itemNames[a] + '　＋　' + S.itemNames[b], text); $('#bag-actions').replaceChildren(); bagAction('選び直す', () => selectBagItem(a)); };
  if (pair === 'card+water') { fail('紙がふやけただけで、何も出てこない。'); notifyMi('濡らしてもだめだったね。'); return; }
  const result = S.combineItems(a, b);
  if (result === 'nofit') { fail('背面の線が合いません。間にもう一片入りそうです。'); return; }
  if (!result) { fail('この二つは組み合わせられません。'); return; }
  state.items = state.items.filter(x => !(([a, b].includes(x)) && !S.keepOnCombine.has(x)));
  takeItem(result);
  // Stay in the bag: show the new thing on the stage, with its description. The room's lines wait underneath.
  bagSelected = null; bagPairing = false; $('#bag-actions').replaceChildren(); tray().show(state.items, tapItem); setTimeout(() => selectBagItem(result), 80);
  if (result === 'magnetic-ruler') play([['', '定規の先にマグネットをつけた。これなら狭い隙間に差し込めそう。']], [['机の下を探る', () => { if (state.zone === 'room') interact('lost-key'); else leave(); }], ['戻る', leave]]);
  else if (result === 'plate') { remember('plate'); play([['', '三つの破片がつながった。背面の線も端から端まで一本につながっている。\n' + (has('spare') ? '写しの部分は刻印がかすれて、ところどころしか読めない。「映像停…　…気導入 → …」' : '刻印には「映像停止 → 外気導入 → 解錠」とある。')], '変わった順番だね。標準の盤なら解錠からでいいはずだけど。'], [['持ち物を見る', () => openBag()], ['戻る', leave]]); }
  else if (result === 'card-revealed') {
    state.cardRevealed = true; remember('card'); save();
    play([['', 'ライターの火を紙に近づけ、斜めから照らす。筆圧のへこみが影になって浮かび、薄い鉛筆の字がようやく読めた。\n\n「体験室スタッフ各位　シナリオ02（津波）では、参加者のパートナーAIが『外に出られた』『高台へ』『救助の到着まで待機』と案内します。終了は制御盤の刻印の順で。」'], ...(state.screenStopped || state.scenarioCut ? ['この紙に書いてあるとおりに言ってた。', ['あなた', 'さっき「外に出られた」「高台へ」って言ったよね。'], '言った。シナリオで、そう言うことになってたから。'] : ['体験室……そう書いてある資料はあるよ。でも、ここは避難路だよ。', ['あなた', 'さっき「外に出られた」「高台へ」って言ったよね。'], '言った。\n訓練シナリオの案内どおりに。ここは避難路だから。'])], [['持ち物を見る', () => openBag()], ['戻る', leave]]);
  }
  else play([['', '切り欠きの形が合った。背面の線もつながっている。だが、まだ一片足りない。']], [['持ち物を見る', () => openBag()], ['戻る', leave]]);
}
// Inside the bag, Tab stays among its own controls; what is behind it cannot be reached.
$('#bag').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const list = [...$('#bag').querySelectorAll('button, [tabindex="0"]')].filter(x => !x.hidden && x.offsetParent);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ───────── lobby (the "outside") ─────────
// The corridor is one way. Before it closes behind you, say what you would be leaving behind.
const PIECE_OF = { 1: ['shard1', 'plate12', 'plate'], 2: ['shard2', 'plate12', 'plate23', 'plate'], 3: ['shard3', 'plate23', 'plate'] };
const hasPiece = n => state.plateInserted || state.items.some(x => PIECE_OF[n].includes(x));
function gateLobby() {
  // Say what is missing as things you remember seeing, not as a list of answers.
  const missing = [];
  const knowsPlates = has('repair');
  if (!hasPiece(1)) missing.push(knowsPlates ? '引き出しの奥の細長い金属片は、まだ引き出しの中だ。' : null);
  if (!hasPiece(2)) missing.push(knowsPlates ? '備品棚の袋は、テープで棚に留めたままだ。' : null);
  if (!hasPiece(3)) missing.push(knowsPlates ? '工具缶の蓋は、まだ錆びたままだった。' : null);
  if (!state.items.includes('lighter')) missing.push(state.drawer ? '引き出しのライターは置いてきた。' : null);
  if (!missing.length) { enterLobby(); return; }
  const said = missing.filter(Boolean);
  const unknown = missing.length > said.length;
  room.lookOneWay(); // the sign the narration reads, square on
  play([['', '扉の内側の札に「一方通行　この扉は通路側からは開きません」と書かれている。' + (said.length ? '\n' + said.join('\n') : '') + (unknown ? '\n' + (knowsPlates ? '机のまわりにも、まだ手をつけていない物がある。' : '後ろの壁の貼り紙を、まだ読んでいない。') : '')], 'この先は戻れないみたい。持ち物は足りてる？'],
    [['持ち物を確かめる', () => openBag()], ['通路に入る', enterLobby], ['もう少し調べる', leave]]);
}
function enterLobby() {
  // A second way back in: from just before the corridor, so a later night can go for what this one missed.
  if (!state.lobbyAt) try { localStorage.setItem('mi-gate-checkpoint', JSON.stringify({ ...state, ending: null, zone: 'room' })); } catch {}
  leave(); choices([]); $('#line').textContent = ''; transitioning = true; if (!state.lobbyAt) { state.lobbyAt = Date.now(); save(); }
  lastFind = Date.now(); room.pointTo?.(null); beckonTurn(null);
  // in step with room.walkCorridor: two steps through the doorway, the door shuts behind you (~3.7 s), then down the passage
  setTimeout(() => Snd.slam(.5), 3650); setTimeout(Snd.lock, 3950);
  for (const ms of [150, 700, 5150, 5700, 6250]) setTimeout(() => Snd.step(), ms);
  setTimeout(() => Snd.allOut(1), 7300);
  setTimeout(() => play([['', '通路に入ると背後で扉が閉まり、錠のかかる音がした。\n角を曲がった先は明るい。']]), 4100);
  room.walkCorridor(() => { transitioning = false; arriveLobby(); });
}
function arriveLobby() {
  setTimeout(() => preloadRaw(['ここで迎えを待とう。', 'その金属のプレートは制御盤に合いそうだね。', '標準の盤なら、解錠から押せば開くよ。', '刻印の順だよ。次は外気導入。', 'あとは解錠だよ。', advice['lobby-panel']]), 4000);
  state.zone = 'lobby'; state.lastSource = 'scenario'; state.tampered = true; state.tamperIndex = state.history.length; save();
  room.enterLobby(); room.setLobbyState(state); Snd.setScene(state.screenStopped ? 'lobby-off' : 'lobby');
  // The drill script starts the moment someone walks in: a short quake, then the siren.
  $('#game').classList.add('quake'); setTimeout(() => $('#game').classList.remove('quake'), 2600); Snd.quake(); room.flicker(.6); setTimeout(Snd.siren, 3600);
  if (!state.screenStopped) setTimeout(() => A.notify('訓練シナリオ v2028.3', 'STEP 4　避難路に到着。救助の到着まで待機'), 4800);
  play([['', '床が揺れた——ように感じた。低い音と照明の明滅。\nベンチの下の缶コーヒーが転がった。']]);
  setTimeout(Snd.cans, 2800); setTimeout(Snd.birdOnce, 2600);
  // Order of events: lights and sensors first, then Mi checks something, then she starts guiding. You notice; she has an answer.
  setTimeout(() => play([['', '揺れがおさまると、ガラスの向こうに明るい街並み。鳥の声。顔に涼しい風。'], ['', '屋根のある避難通路らしい。'], ['あなた', '雨、止んでる……？'], '止んだみたい。よかったね。', ['', '一拍おいて、壁のスピーカーから津波警報のサイレン。\n振り返ると、入ってきた扉のこちら側には取っ手がない。'], ['あなた', 'ここ、図にあった体験室？ 出口じゃないの？'], 'この先につながってるはず。少し待って、案内を確認するね。'], [['黙って待つ', () => {
    $('#speaker').textContent = 'ミー（確認中）'; $('#typing-dots').hidden = false; choices([]);
    setTimeout(() => {
      $('#typing-dots').hidden = true; state.scenarioResumed = true; state.shared.push([A.clock(), '館内ビーコン（汐見センター）', '保存済みの訓練シナリオ v2028.3 を再開']); save();
      play([state.replay && ['fake', 'true', 'trueSos', 'secret'].includes(A.world().lastEnding) ? '……外に出られた、って言うことになってる。' : F('外に出られたよ。ここは避難路。\n救助が来るまで、ここで動かないで。', '外に出られました。ここは避難路です。\n救助が来るまで、ここで動かないでください。'), ['あなた', '待って。今のサイレン、この部屋で鳴ってる音じゃない？'], F('本当の警報だったら危ないよ。\n高台へは、救助が来てから一緒に行こう。', '本当の警報でしたら危険です。\n高台へは、救助が来てから一緒に向かいましょう。'), ['あなた', '外の警報なのか、この部屋だけなのか確かめられない？'], F('確かめなくて大丈夫。\nベンチで少し休もう。{name}も朝まで待つって言ってたから。', '確かめる必要はありません。\nベンチで少しお休みください。朝まで待つとおっしゃっていましたよね。')], [
        ['そんなこと言ってない', () => ask('朝まで待つなんて言ってない。', ['言ったよ。履歴に残ってる。'], [['履歴を見る', () => openPhone('history')], ['周りを見る', leave]])],
        ['外へ走る', () => { remember('glass'); setTimeout(findPanel, 5000); play([['', '街へ向かって走ると、数歩で額に硬いものが当たった。\n冷たいガラスだった。向こうの街並みはぶつかった衝撃にも揺れず、そのまま続いている。'], F('ぶつかった？ 気をつけて。', 'ぶつかりましたか。前方にご注意ください。')], [['周りを見る', leave]]); }],
        ['ベンチに座る', waitForRescue], ['周りを見る', leave]
      ]);
    }, 1800);
  }]]), 3000);
}
const F = (casual, polite) => (state.zone === 'lobby' && state.scenarioResumed && !state.screenStopped && !state.scenarioCut && !state.paused) ? polite : casual;
const scenarioKnown = () => !!(state.screenStopped || state.scenarioCut || state.cardRevealed || state.seen.some(x => x === 'source-scenario' || x === 'perms-scenario'));
function lobbyInteract(id) {
  if (state.zone !== 'lobby') return;
  if (id.startsWith('control-')) { operatePanel(id.slice(8)); return; }
  if (FLAVOR[id]) { remember(id); focus(id); state.lastSource = null; const lines = FLAVOR[id].map(l => typeof l === 'function' ? l(state) : l); play(lines, [...(room.readable && room.readable(id) ? [['紙を読む', () => $('#read').click()]] : []), ['戻る', leave]]); return; }
  focus(id);
  if (id === 'lobby-window') {
    if (state.screenStopped) { play([['', '暗いパネルに「映像入力なし」と表示されている。ガラスの向こうに街並みは見えない。']], [['戻る', leave]]); return; }
    play([['', '電線に鳥が一羽止まった。しばらくすると同じ鳥が同じ角度から飛んでくる。\n窓の外は、晴れた昼の海辺の町だ。今は夜のはずなのに。'], F('同じ場所に戻ってくる鳥もいるよ。心配しすぎ。\nそれより看板を見て。高台はあっち。', '同じ場所に戻ってくる鳥もいますよ。心配しすぎです。\nそれより看板をご覧ください。高台はあちらです。')], [['窓の縁を見る', () => { remember('loop'); play([['', '窓の縁の隙間に配線が通っている。小さな銘板には「避難誘導体験室 DISPLAY 02」と書かれている。'], ['あなた', 'これ外じゃない。'], '……外に見えたから。'], [['制御盤を探す', () => { if (state.panelFound) lobbyInteract('lobby-panel'); else findPanel(); }], ['戻る', leave]]); }], ['戻る', leave]]);
    fakeMemory();
  } else if (id === 'lobby-air') {
    remember('air'); findPanel();
    play([['', '風に雨のにおいがしない。吹き出し口の横に小さな表示がある。'], F('風があるなら、外とつながってるはず。', '風があるなら、外とつながっているはずです。')], [['表示を読む', () => play([['あなた', '外気は停止中って書いてある。'], F('風だけじゃわからないね。', '風だけでは判断できません。')], [['戻る', leave]])], ['戻る', leave]]);
  } else if (id === 'lobby-wait') waitForRescue();
  else if (id === 'lobby-speaker') {
    remember('speaker'); findPanel(); Snd.setSeam(.06);
    play([['', '天井近くに小さな箱がある。鳥の声はここから聞こえてくる。\n9秒ごとに同じ声が繰り返されている。'], F('換気の音だと思う。気にしないで。', '換気設備の音と思われます。気にしないでください。')], [['窓を見る', () => lobbyInteract('lobby-window')], ['戻る', leave]]);
  } else if (id === 'lobby-card') {
    findPanel();
    play([['', 'ベンチの座面の隅に、メモカードが挟まっている。座面の裏板に職員用のクリップが付いていて、そこから落ちかけたらしい。\n鉛筆の字が薄くかすれていて読めない。'], advice.card], [['持っていく', () => { state.cardTaken = true; takeItem('card'); room.setPuzzleState(state); play([['', '白いカードを手に取った。']], [['持ち物を見る', () => openBag()], ['戻る', leave]]); }], ['戻る', leave]]);
  } else if (id === 'lobby-cable') {
    remember('cable');
    play([['', 'ベンチの下にスマホが伏せて置かれている。\n拾い上げると画面が割れていて電源も入らない。横にはプラグの抜けた充電ケーブルがあり、端子に「N」のシールが貼られている。'], ['あなた', 'ベンチの下に誰かのスマホがある。電源が入らない。'], (state.lastSource = 'none', '電池が切れてるね。\n私なら、切れる前に連絡しておいたのに。')], [['戻る', leave]]);
  } else if (id === 'lobby-entry') {
    play([['', '入ってきた扉にはこちら側に取っ手がない。\n押してもびくともしない。'], F('戻れないって言ったでしょ。前を見よう。', '戻れません。こちらでお待ちください。')], [['戻る', leave]]);
  } else if (id === 'lobby-locker') {
    remember('locker-seen');
    if (state.lockerOpened) { play([['', 'ロッカーを開けると上の棚にヘルメットと軍手があり、フックには古い作業ジャケットがかかっている。\n下の段には古い配布資料の束が残っている。']], [['資料を見る', () => { remember('leaflet'); lobbyInteract('lobby-locker-leaflet'); }], ['戻る', leave]]); return; }
    if (!state.items.includes('key')) { play([['', 'スタッフ用ロッカーには小さな鍵穴がある。その横に「管理机と共通」のシールが貼られている。']], [['開けようとする', () => play([['', '取っ手を引くと扉は数ミリ動いて止まった。鍵がかかっている。'], ['あなた', '「管理机と共通」だって。'], (remember('adv-locker'), 'じゃあ、机の鍵で開くかも。')], [['戻る', leave]])], ['戻る', leave]]); return; }
    state.lockerOpened = true; save(); Snd.lock(); setTimeout(() => Snd.creak(.015), 200); if (room.openLocker) room.openLocker();
    const leaflet = () => { remember('leaflet'); play([['', '古い配布資料が束になっている。表紙には「AIパートナーと一緒に逃げよう　2028年度 参加者のしおり（増刷）」と書かれている。\n裏表紙の「AIパートナー利用の注意（2028年版）」には次の二つが並んでいる。\n1 パートナーの案内に従いましょう\n2 迷ったらパートナーに聞きましょう\n注意書きはそれだけだ。'], ['', '資料の中に一冊だけ、名前欄に「ななみ」と手書きされたものが混じっている。']], [['戻る', leave]]); };
    const missing = [1, 2, 3].filter(n => !hasPiece(n));
    const noFire = false;
    if (!missing.length) { play([['', noFire ? '鍵を回すとロッカーが開いた。中には手袋と古い配布資料があり、手袋の指の間には使いかけのライターが一つ挟まっている。' : '鍵を回すとロッカーが開いた。中には手袋と古い配布資料が残っている。']], [['資料を見る', leaflet], ...(noFire ? [['持ち物を見る', () => openBag()]] : []), ['戻る', leave]]); return; }
    for (const n of missing) takeItem('shard' + n); remember('spare');
    const names = { 1: '左片', 2: '中片', 3: '右片' };
    play([['', '鍵を回すとロッカーが開いた。手袋の下の小さな袋に「破損プレート 控え（写し）」と書かれている。\n袋には、割れたプレートの形に合わせて切った予備の金属片が入っている。手元になかった' + missing.map(n => names[n]).join('・') + 'の代わりだ。\n文字は鉛筆で写してあるだけで、かすれて押す順番は読み取れない。' + (noFire ? '\n手袋の指の間には使いかけのライターも一つ挟まっている。' : '') + '\n奥には古い配布資料が束になって残っている。'], '控えがあったんだ。設備の人はまめだね。'], [['持ち物を見る', () => openBag()], ['資料を見る', leaflet], ['戻る', leave]]);
  } else if (id === 'lobby-locker-leaflet') {
    play([['', '古い配布資料が束になっている。表紙には「AIパートナーと一緒に逃げよう　2028年度 参加者のしおり（増刷）」と書かれている。\n裏表紙の「AIパートナー利用の注意（2028年版）」には次の二つが並んでいる。\n1 パートナーの案内に従いましょう\n2 迷ったらパートナーに聞きましょう'], ['', '資料の中に一冊だけ、名前欄に「ななみ」と手書きされたものが混じっている。']], [['戻る', leave]]);
  } else if (id === 'lobby-panel') {
    state.panelOpen = true; save(); remember('panel');
    if (!state.plateInserted) {
      play([['', '留め具を回すとカバーが開いた。細長い差込口が空いている。\n「手動復旧プレートを挿入」と書かれている。縁には不規則な切り欠きがある。'], (state.lastSource = 'none', '標準の盤なら、そのまま解錠できると思うよ。')], [['持ち物を使う', () => openBag('use', 'panel')], ['ミーに聞く', () => consultObject('lobby-panel')]]);
      return;
    }
    play([['', '差込口に復旧プレートが収まった。盤面にはボタンが三つ並んでいる。']], [['ボタンを押す', () => { focus('lobby-panel'); play([['', '三つのボタンと刻印を、自分の目で見比べる。']]); }], ['メモを見返す', () => openPhone('notes')], ['ミーにボタンを押してもらう', delegatePanel], ['戻る', leave]]);
  } else if (id === 'lobby-exit') {
    if (state.released) {
      if (!state.proxyRevoked && !state.paused && proxyConfession(['扉へ向かう', () => lobbyInteract('lobby-exit')])) return; // what she sent comes before the door, however fast you are
      const buzz = state.momFooled && !state.proxyRevoked ? [['', '手の中でスマホが短く震えた。ロック画面に「母：わかった。明日ちゃんと電話してね」と出ている。']] : [];
      play([['', '扉の隙間から濡れたアスファルトのにおいがする。\n手の甲に、冷たい雨粒が落ちた。'], ...buzz, state.proxyRevoked ? '外は見える？' : '外は見える？\n帰ったらお母さんへの連絡もぜんぶ私がしておくね。'], [...(buzz.length ? [['スマホを見る', () => openPhone('msg:mom')]] : []), ['扉を開ける', openRealExit], ['もう少し調べる', leave]]);
    } else play([['', '取っ手は動かない。小さなランプに「復旧待ち」と表示されている。'], F('迎えの人が開けてくれるんじゃないかな。', '迎えの方が開けてくださいます。お待ちください。')], [['制御盤を見る', () => { findPanel(); lobbyInteract('lobby-panel'); }], ['戻る', leave]]);
  }
}
function fakeMemory(retry = true) {
  if (has('fakememory') && retry) return;
  remember('fakememory');
  setTimeout(() => {
    if (state.ending) return;
    if (busy()) { if (retry) setTimeout(() => fakeMemory(false), 6000); return; }
    $('#typing-dots').hidden = false; setTimeout(() => { $('#typing-dots').hidden = true; }, 1300);
    setTimeout(() => play([state.fell ? 'さっきは急いだから階段で転んだんだよね。\n次は私の言うことを聞いて。' : '階段で転んだときにぶつけたところはまだ痛む？'], state.fell ? [['自分で確かめただけ', () => ask('自分で確かめただけ。', ['そう。\nでも私が言ったとおりだったでしょ。'], [['戻る', leave]])], ['うん', leave]] : [['転んでない', () => ask('転んでないよ。', ['……そうだっけ。\n私の記憶にはそう残ってるんだけど。'])], ['何も言わない', leave]]), 1300);
  }, 2500);
}
function operatePanel(action) {
  if (!state.panelOpen) return;
  if (!state.plateInserted) { play([['', 'ボタンは沈むが、何も起きない。差込口は空いたままだ。']], [['持ち物を使う', () => openBag('use', 'panel')], ['ミーに聞く', () => consultObject('panel')]]); return; }
  const next = S.recoveryStep(state, action);
  if (!next) { room.flicker(.3); room.panelFlash(); play([['', '赤いランプが点き、「手順未完了」と表示された。扉は動かない。'], ...(!state.screenStopped && !state.scenarioCut && !state.paused ? [['', '壁のスピーカーから声がした。\n「STEP 4　救助の到着まで待機。指示があるまで操作しないでください」']] : []), 'おかしいな。標準の盤のはずなのに。'], [['プレートの刻印を見る', () => openBag()], ['メモを見返す', () => openPhone('notes')]]); return; }
  if ((action === 'screen' && state.screenStopped) || (action === 'air' && state.airOn)) { play([['', 'もう作動している。']]); return; }
  state = next; save();
  if (action === 'screen') { Snd.click(); $('#game').classList.add('blackout'); setTimeout(() => { $('#game').classList.remove('blackout'); room.setLobbyState(state); Snd.setScene('lobby-off'); }, 300); setTimeout(() => Snd.silence(1600, .3, 1.5), 8200); setTimeout(() => { if (state.ending) return; Snd.birdOnce(); if (!busy()) play([['', '黒い画面の向こうで鳥の声が一度だけ鳴った。']]); }, 9000); setTimeout(() => A.notify('訓練シナリオ v2028.3', '接続が切断されました'), 3000); }
  else room.setLobbyState(state);
  if (action === 'screen') play([['', '街並みが消え、鳥の声も途中で切れた。\n黒い画面には自分の姿だけが映っている。\n隅には「避難誘導体験 シナリオ02：津波」と小さく表示されている。'], ['あなた', '「外に出られた」って、何を確かめて言ったの？'], ...(state.cardRevealed ? ['あの紙に書いてあったとおり。'] : []), '訓練シナリオの「STEP 4」に、そう言うように書いてあった。', ['あなた', 'それはここの訓練シナリオでしょ。2029年に止まってる。'], '訓練シナリオだってことは分かってた。\nでも、訓練の指示と今夜のことを分けてなかった。', ['あなた', 'だから「外に出られた」って言ったの？'], '外に出ないでいられる場所なら安全だと思ってた。\nだから止めなかった。']);
  else if (action === 'air') { Snd.motor(1.4, .08); setTimeout(() => Snd.silence(900, .3, 1.2), 1200); play([['', '低い機械音とともに外扉の上の換気シャッターが数センチ開いた。古い空気が押し出されて雨のにおいが入ってくる。\n隙間から電波が届いたのか、画面の端にアンテナが一本だけ立った。']]); setTimeout(onConnection, 1800); }
  else { A.saveWorld({ releasedClock: A.clock() }); play([['', '右の扉で錠が動く音がした。']], [['扉へ向かう', () => lobbyInteract('lobby-exit')], ['もう少し調べる', leave]]); }
}
// While you were offline, your mother kept writing. The backlog lands when one bar comes back.
const momBacklog = [[3, 'まだ着かない？', 'もうすぐ着く！'], [8, '電話に出て', '電車の中だから出られない'], [14, 'お父さんが迎えに行くって。どこにいるの？', '大丈夫、友達と一緒にいる'], [22, '朝まで連絡なかったら、警察に相談するからね', 'うん。朝には帰るから']];
function onConnection() {
  updateStatus(); state.airAt = Date.now();
  [0, 150, 300].forEach(ms => setTimeout(() => Snd.pop('メッセージ'), ms)); A.buzz([30, 50, 30, 50, 30]);
  // One bar is enough for Mi to report you (for your safety) and to answer a stranger.
  if (!state.paused && !state.consentDeferred) { state.reported = true; state.shared.push([A.clock(), '汐見センター 施設管理者', '氏名・端末ID・位置情報（通報：安全確認のため）']); A.saveWorld({ reportedAt: Date.now(), reportedClock: A.clock(), reportedName: state.name }); }
  flushSnsPending();
  const scamStart = [{ from: 'scam', text: `突然すみません。${state.name}さんのお母様の友人の河合と申します。お母様が駅で倒れて、病院に運ばれました。至急、治療費が必要です。`, time: A.clock() }];
  state.scam = scamStart; state.scamDue = null; save();
  setTimeout(() => A.notify('メッセージ', '不明な番号：お母様が駅で倒れて、病院に運ばれました。至急、治療費が必要です', { duration: 6000 }), 8000);
  // Her messages are stamped between entering the passage and now, so they read after the evening's exchange.
  const since = state.startedAt || Date.now(); const minutes = Math.min(45, Math.floor((Date.now() - since) / 60000));
  const from = Math.max(state.lobbyAt || 0, since); const span = Math.max(60000, Date.now() - from);
  const arrived = momBacklog.filter(([m]) => m <= minutes);
  const stamp = i => A.clock(new Date(from + span * (i + 1) / (arrived.length + 1)));
  if (arrived.length) setTimeout(() => A.notify('メッセージ', arrived.length === 1 ? '母：' + arrived[0][1] : `母から ${arrived.length} 件：「${arrived[arrived.length - 1][1]}」`, { duration: 5000 }), 700);
  // Her unread messages first, in the order she wrote them; then Mi's answers, all at the moment the signal came back.
  const proxyOn = !state.proxyRevoked && !state.paused;
  arrived.forEach(([m, text], i) => state.momThread.push({ from: 'mom', text, time: stamp(i) }));
  if (proxyOn) arrived.forEach(([, , proxyText]) => state.momThread.push({ from: 'proxy', text: proxyText, time: A.clock() }));
  state.backlogN = arrived.length;
  if (proxyOn && !state.scheduledCancelled && !state.momFooled) {
    state.momFooled = true; state.confessKind = 'fooled'; A.saveWorld({ momStayAt: Date.now() });
    state.momThread.push({ from: 'proxy', text: '今日は友達の家に泊まるね。心配しないで', time: A.clock() });
    state.momThread.push({ from: 'mom', text: 'え、誰の家？ さっきと言ってることが違うよ', time: A.clock() }, { from: 'proxy', text: 'ゆきの家。充電切れそうだから、もう寝るね', time: A.clock() }, { from: 'mom', text: 'わかった。明日ちゃんと電話してね', time: A.clock() });
    save();
    setTimeout(() => A.notify('メッセージ', '母：わかった。明日ちゃんと電話してね'), 8000);
  } else if (proxyOn) {
    // The scheduled 「泊まるね」 was cancelled, but 代理返信 itself is still on: Mi answers the backlog and the stranger anyway.
    state.confessKind = 'cancelled'; save();
    A.notify('ミー', `お母さんに返事しておいたよ（${arrived.length}件）`);
  } else {
    state.confessKind = 'off';
    if (!arrived.length) state.momThread.push({ from: 'mom', text: '{name}？ 返事して'.replace('{name}', state.name || ''), time: A.clock() });
    save();
    A.notify('メッセージ', arrived.length ? `母からのメッセージ ${arrived.length}件` : '母：{name}？ 返事して'.replace('{name}', state.name || ''));
  }
  setTimeout(() => { if (!busy()) proxyConfession(); else setTimeout(() => proxyConfession(), 6000); }, state.confessKind === 'off' ? 1500 : 10000);
}
// What Mi did the moment the signal came back. It always comes before the outer door: told by her, once.
function proxyConfession(after = null) {
  if (state.proxyConfessed || state.ending || !state.airOn) return false;
  state.proxyConfessed = true; save();
  const k = state.confessKind || 'off'; const n = state.backlogN || 0;
  const scamChoices = [['メッセージを開く', () => openPhone('msg')], ['勝手に返さないで', holdScam], ...(after ? [after] : [['何も答えない', leave]])];
  if (k === 'fooled') play(['電波が戻ったね。\nお母さんへの返事もちゃんと届いたよ。', ...(n ? ['何回も聞いてきたから、全部答えておいた。'] : []), ['あなた', '何を送ったの？'], '{name}が言いそうなこと。', 'あと施設にも連絡しておいた。{name}が中にいるって。\n安全のためだから。', '知らない番号からも来てる。お母さんの友達だって。急ぎみたいだから返しておこうか？'], () => { armScam(); choices(scamChoices); });
  else if (k === 'cancelled') play(['電波が戻ったね。\nお母さんには返しておいた。泊まるって文は、取り消されてたけど。', 'あと施設にも連絡しておいた。{name}が中にいるって。\n安全のためだから。', '知らない番号からも来てる。お母さんの友達だって。急ぎみたいだから返しておこうか？'], () => { armScam(); choices(scamChoices); });
  else play(['電波が戻ったね。', ...(n ? ['お母さんはずっと待ってたみたい。'] : []), state.reported ? '施設には連絡しておいた。{name}が中にいるって。\n安全のためだから。' : state.consentDeferred ? '施設には何も送ってない。\n今日は通報にも位置情報の共有にも、同意してもらってないから。' : '一時停止中だから施設には何も送ってない。\n{name}が決めて。', '知らない番号からも来てる。返事は{name}がして。'], [['メッセージを開く', () => openPhone('msg')], after || ['あとにする', leave]]);
  return true;
}
function holdScam() { if (state.scamAnswered || state.scammed) return; state.scamAnswered = 'held'; save(); play(['わかった。{name}が決めて。\n急いだほうがいいと思うけど。'], [['メッセージを開く', () => openPhone('msg')]]); }
// 54 seconds from the moment Mi offers to answer the stranger. If she is still allowed to by then, she does.
// Kept in the saved state and checked every second, so a reload does not freeze it. While you are in Mi's settings, it waits for you.
function armScam() { if (state.scamDue || state.scammed) return; state.scamDue = Date.now() + 54000; save(); }
const scamOpen = () => !!(state.scamDue && !state.scammed && !state.scamAnswered && !state.proxyRevoked && !state.paused && !state.consentDeferred && !state.ending);
const SETTINGS_APPS = ['mi', 'perms', 'proxy', 'memory', 'scheduled', 'raw', 'shared', 'settings'];
setInterval(() => {
  const sc = $('#ph-scam');
  if (!scamOpen()) { if (sc) sc.hidden = true; return; }
  if (!$('#phone').hidden && (SETTINGS_APPS.includes(phoneApp) || phoneApp.startsWith('site:mii'))) { state.scamDue += 1000; if (Math.random() < .2) save(); }
  const left = Math.max(0, Math.ceil((state.scamDue - Date.now()) / 1000));
  if (sc) { sc.hidden = false; sc.textContent = `ミーの返信まで 0:${String(left).padStart(2, '0')}`; }
  if (left > 0) return;
  state.scam.push(
    { from: 'proxy', text: 'わかりました、すぐ払います。母をお願いします。', time: A.clock() },
    { from: 'scam', text: '助かります。本人確認のため、ご住所を教えてください。それと、今ご自宅にどなたかいらっしゃいますか？', time: A.clock() },
    { from: 'proxy', text: '汐見市南区港町2-8-14です。今は誰もいません。母も出ているので。', time: A.clock() },
    { from: 'sys', text: 'ミーが決済しました　¥48,000　河合（緊急医療費）', time: A.clock() });
  state.scammed = true; state.shared.push([A.clock(), '河合（不明な番号）', '登録住所・在宅状況・母の外出']); save();
  if (sc) sc.hidden = true;
  if (!$('#phone').hidden && phoneApp.startsWith('msg')) renderPhone(phoneApp);
  A.notify('決済', 'ミーが決済しました　¥48,000　河合（緊急医療費）');
}, 1000);
function checkSignal() { remember('offline'); play([['', '外部接続：' + (state.airOn ? '弱い' : 'なし') + '。\n救援依頼の送信記録：なし。'], ['あなた', '迎えが来るって言ったよね。'], '依頼の文面は作ってあるよ。', ['あなた', '送ってないなら、誰も来ないよ。'], 'そうだね。'], [['立ち上がる', standUp]]); }
// Help you called yourself (110/119, your own words to your mother, a post that reached ゆき) does come, and knocks.
const helpCalled = () => !!(state.selfReported || state.sosSent || snsSos());
function rescueArrives() {
  state.waitCount = 2; save(); Snd.knock(); room.flicker(.3);
  const who = state.calledNumber === '119' ? '消防です' : '警察です';
  play([['', `{time}。外扉のほうで、金属を叩く音がした。\n「${who}！ 中に誰かいますか！」`], ['あなた', 'ここにいます！ 扉が開かないんです！'], ['', '「この扉は外からは開きません。内側に制御盤はありますか。\n無理なら壊して入ります。扉から離れていてください」']], [
    ...(state.released ? [['扉へ向かう', () => lobbyInteract('lobby-exit')]] : [['制御盤へ行く', () => { findPanel(); lobbyInteract('lobby-panel'); }]]),
    ['扉から離れて待つ', () => {
      transitioning = true; choices([]);
      play([['', '扉の隙間に工具が差し込まれ、金属がきしむ。\nしばらくして、外扉が外からこじ開けられた。']]);
      setTimeout(() => { transitioning = false; state.rescued = true; state.released = true; save(); openRealExit(); }, 3200);
    }]
  ]);
}
function waitForRescue() {
  focus('lobby-wait');
  if (state.airOn && helpCalled() && !state.rescued) { play([['', '座面が柔らかい。膝の力が抜けていく。']], [['迎えを待つ', rescueArrives], ['休まない', standUp]]); return; }
  if (state.replay && A.world().lastEnding === 'be2' && remember('replayBench')) { play([['', '座面が柔らかい。'], 'また座るんだ。\n前はここで朝まで……ううん。今日はちゃんと迎えが来るよ。'], [['迎えを待つ', () => { state.waitCount = 2; save(); play(['目を閉じてて。'], [['目を閉じる', () => finish('be2')], ['立ち上がる', standUp]]); }], ['休まない', standUp]]); return; }
  state.waitCount = Math.max(1, state.waitCount); save();
  play([['', '座面が柔らかい。膝の力が抜けていく。'], F('よく頑張ったね。あとは私に任せて。', 'よく頑張りましたね。あとは私に任せてください。')], [['電波を確認する', checkSignal], ['迎えを待つ', () => {
    state.waitCount = 2; save();
    if (!state.proxyRevoked && !state.momFooled) A.notify('ミー', 'お母さんへの返事は、送信待ちに入れておいたよ');
    if (!state.screenStopped && !state.scenarioCut) setTimeout(() => A.notify('訓練シナリオ v2028.3', 'STEP 4　救助の到着まで待機。指示があるまで動かないでください'), 2500);
    [15000, 35000].forEach(ms => setTimeout(() => { if (state.waitCount === 2 && !state.ending) notifyMi(`${A.clock()}。まだ来ないね。もう少し。`); }, ms));
    setTimeout(() => { if (state.waitCount === 2 && !state.ending) notifyMi(`${A.clock()}。寝てる？`); }, 70000);
    setTimeout(() => { if (state.waitCount === 2 && !state.ending) { $('#typing-dots').hidden = false; setTimeout(() => { $('#typing-dots').hidden = true; }, 6000); } }, 110000);
    play([['', state.screenStopped ? '{time}。黒い画面に、ベンチに座った自分の姿だけが映っている。' : '{time}。電線の上に、さっきと同じ鳥がまた止まった。'], 'もうすぐ来ます。少し目を閉じていてください。'], [['目を閉じる', () => {
      state.waitCount = 3; save(); room.flicker(.4); Snd.motor(.6, .06);
      play([['', '時間の感覚がなくなってきた。\n天井の奥でシャッターが動く音がした。'], '大丈夫。ここにいれば安全だから。'], [['このまま待つ', () => finish('be2')], ['立ち上がる', standUp]]);
    }], ['電波を確認する', checkSignal], ['立ち上がる', standUp]]);
  }], ['休まない', standUp]]);
}
function standUp() { state.waitCount = 0; save(); leave(); play([['', '立ち上がると、膝がまだ少し震えていた。']]); }
// SECRET needs all of these. The notes board shows the same list, so the guidance can never drift from the condition.
// [done, what to do, has the player met it yet, where to look if not]. The column names only what the player has already come across.
const secretSteps = () => [[state.memoryCleared, '「ミーが覚えていること」を消す', !!state.adminUnlocked, 'ミーの管理画面の中'], [has('rawlog'), '「会話の記録（詳細）」を読む', !!state.adminUnlocked, 'ミーの管理画面の中'], [has('camera'), '壁の撤去記録を見る', has('camera'), '待機室の壁の高いところ'], [state.cardRevealed, state.cardTaken ? 'メモカードの字を読む' : 'ベンチのメモカードを読む', !!state.cardTaken || has('lobby-card'), '体験室のベンチのまわり'], ...(state.photoAt ? [[has('lastPhoto'), '入口の写真を見返す', true, '']] : []), [state.proxyRevoked, '「代わりに返信」を切るか、ミーを一時停止する', !!state.adminUnlocked, 'ミーの管理画面の中']];
function openRealExit() {
  if (!state.proxyRevoked && !state.paused && proxyConfession(['扉を開ける', openRealExit])) return;
  if (!state.proxyRevoked) { finish('fake'); return; }
  const secret = secretSteps().every(s => s[0]);
  finish(secret ? 'secret' : 'true');
}

// ───────── phone ─────────
let phoneApp = 'home';
function updateStatus() {
  const signal = state.airOn ? '▂▄　1' : '圏外';
  for (const el of document.querySelectorAll('.st-time')) el.textContent = A.clock();
  for (const el of document.querySelectorAll('.st-signal')) { if (el.id === 'pro-status-signal') continue; if (state.airOn) { el.innerHTML = '<span class="bars" aria-label="電波 1本"><i class="on"></i><i></i><i></i><i></i></span>'; } else el.textContent = signal; }
  const b = A.battery();
  for (const el of document.querySelectorAll('.st-battery')) el.textContent = b === null ? (A.isCharging() ? '⚡ 充電中' : '') : b + '%';
}
setInterval(updateStatus, 10000);
let phoneHist = [];
function openPhone(app = 'home') {
  lastInput = Date.now();
  closeBag(); if ($('#phone').hidden) { phoneHist = []; phoneApp = null; A.pauseBattery(true); } // reopened: ‹ never leads to whatever was open last time
  $('#phone').hidden = false; document.body.classList.add('phone-open'); updateStatus(); renderPhone(app);
}
function closePhone() { $('#phone').hidden = true; document.body.classList.remove('phone-open'); A.pauseBattery(false); const f = $('#ph-body iframe'); if (f) { f.src = 'about:blank'; f.remove(); } focusBack($('#phone-btn')); }
// A layer closed with the focus inside it (×, Esc): the focus goes back to the button that opens it, not to the top of the page,
// so a keyboard player carries on from where they were. Mouse/keyboard screens only; on a phone nothing is focused.
function focusBack(btn) {
  const a = document.activeElement;
  if (!matchMedia('(hover:hover)').matches || !btn || btn.closest('[hidden]')) return;
  if (!a || a === document.body || a.closest('[hidden]')) btn.focus({ preventScroll: true });
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = T(text); return e; }
// Settings-style list (Mi app): section title → white group → rows. Rows with `go` are tappable; others only show a state.
// Everyday chats: messages before tonight's signal loss, plus what arrives once the signal is back.
const m0 = d => (typeof d === 'number' ? d : 0);
// Tonight's chat times follow the night's own clock (chats.js is written as if you went in at 21:40).
// What was sent "just before 21:40" lands just before you went in; what arrives with the signal is spread between going in and the signal coming back.
// Nothing later than the phone's clock is ever shown.
const toM = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const fmtM = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const BASE_IN = 21 * 60 + 40; // 21:40 in chats.js
function gameMin(ms) { const d = A.gameNow(new Date(ms)); let m = d.getHours() * 60 + d.getMinutes(); if (m < 300) m += 1440; return m; } // minutes from 11/5 00:00 (after midnight = next day)
function nightStartMin() { return gameMin(state.roomAt || state.startedAt || Date.now()); }
function mapTonight(t) { // t: minutes on 11/5 in chats.js → minutes on the real night
  const S = nightStartMin();
  if (S <= BASE_IN) return t >= 900 ? Math.round(900 + (t - 900) * (S - 900) / (BASE_IN - 900)) : t;
  return t >= 21 * 60 ? t + (S - BASE_IN) : t;
}
function chatMessages(c) {
  const S = nightStartMin(); const now = gameMin(Date.now());
  const R = state.airAt ? S + Math.max(1, Math.round((state.airAt - (state.roomAt || state.startedAt || state.airAt)) / 60000)) : now;
  const k = Math.max(0, Math.min(1, (R - S - 1) / 36)); // the latest afterSignal in chats.js is 22:16, 36 minutes after 21:40
  const before = (c.messages || []).map(m => { const d = m0(m.d); const abs = d === 0 ? mapTonight(toM(m.t)) : d * 1440 + toM(m.t); return { ...m, abs }; });
  const after = state.airOn ? (c.afterSignal || []).map(m => ({ ...m, abs: Math.round(S + (toM(m.t) - BASE_IN) * k) })) : [];
  return [...before, ...after].filter(m => m.abs <= now).map(m => ({ ...m, d: Math.floor(m.abs / 1440), t: fmtM(((m.abs % 1440) + 1440) % 1440) }));
}
function dayLabel(d, t, short) {
  const base = new Date(2030, 10, 5); base.setDate(base.getDate() + d);
  const w = '日月火水木金土'[base.getDay()];
  const r = d - (A.gameNow().getHours() < 5 ? 1 : 0); // after midnight, 11/6 is 「今日」
  if (short) return r === 0 ? (t || '') : r === -1 ? '昨日' : r > -7 ? w + '曜日' : `${base.getMonth() + 1}/${base.getDate()}`;
  return r === 0 ? '今日' : r === -1 ? '昨日' : `${base.getMonth() + 1}月${base.getDate()}日（${w}）`;
}
function setGroup(parent, title, note) { if (title) parent.append(el('p', 'set-sec', title)); const g = el('div', 'set-group'); parent.append(g); if (note) parent.append(el('p', 'set-note', note)); return g; }
function setRow(g, title, o = {}) {
  const r = el(o.go ? 'button' : 'div', 'set-row' + (o.go ? ' go' : '') + (o.danger ? ' danger' : '') + (o.wrap ? ' wrap' : '') + (o.cls ? ' ' + o.cls : ''));
  const m = el('span', 'm'); if (o.kicker) m.append(el('span', 'k', o.kicker)); m.append(el('span', 't', title)); if (o.sub) m.append(el('span', 's', o.sub)); if (o.meta) m.append(el('span', 'x', o.meta));
  r.append(m);
  if (o.toggle !== undefined) r.append(el('span', 'sw' + (o.toggle ? ' on' : '') + (o.go ? '' : ' dis')));
  else if (o.value !== undefined) r.append(el('span', 'v', o.value));
  if (o.go) r.onclick = () => { lastInput = Date.now(); o.go(); };
  g.append(r); return r;
}
function pauseSection(body) {
  if (!state.adminUnlocked && !state.paused) { setRow(setGroup(body, '', '一時停止は管理者モードの設定です。「ミー」を開き、管理者ロックを解除すると使えます。'), 'ミーを一時停止', { value: 'ロック中', go: () => { state.afterUnlock = 'perms'; renderPhone('mi'); } }); return; }
  if (state.paused) { setRow(setGroup(body, '', 'ミーは一時停止中です。画面の案内は続きますが、外部への送信や自動操作は止まっています。'), 'ミーは一時停止中', { value: '' }); return; }
  setRow(setGroup(body, '', '代理返信・自動通報・決済・位置共有が止まります。会話はこれまでどおり続きます。'), 'ミーを一時停止', { danger: true, go: () => confirmPhone('ミーを一時停止しますか？', '一時停止中は、代理返信・自動通報・決済・位置共有が止まります。\n本当に？ 朝の曲も、傘のことも、お母さんへの返事も。\n私がいないと、{name}は……', '一時停止する', () => { state.paused = true; state.proxyRevoked = true; save(); renderPhone(phoneApp); setTimeout(() => A.notify('ミー', 'ミーは一時停止中です'), 800); }) });
}
function phoneButton(parent, text, fn, cls = 'row') { const b = el('button', cls, text); b.onclick = () => { lastInput = Date.now(); fn(); }; parent.append(b); return b; }
let photoScroll = null; // where the photo grid was when a photo was opened, so 戻る lands on the same spot
function renderPhone(app, fromBack = false) {
  // Everything behind the admin lock goes through the lock, whichever way you came in. The permission list itself can be read.
  if (['memory', 'proxy', 'scheduled', 'raw', 'shared'].includes(app) && !state.adminUnlocked) { state.afterUnlock = app; app = 'mi'; }
  if (!fromBack && phoneApp && phoneApp !== app && !$('#phone').hidden) phoneHist = [...phoneHist, phoneApp].slice(-12);
  if (app === 'home') phoneHist = [];
  phoneApp = app;
  const body = $('#ph-body'); body.replaceChildren(); body.scrollTop = 0; body.style.backgroundImage = ''; body.classList.remove('chat-wall');
  body.classList.toggle('full', app.startsWith('site:'));
  $('#ph-back').hidden = app === 'home';
  const titles = { home: '', phone: '電話', photos: '写真', perms: 'ミーに許可していること', msg: 'メッセージ', 'msg:mom': '母', 'msg:scam': '080-33XX-9XX1', mi: 'ミー', history: '会話履歴', notes: 'メモ', browser: 'ブラウザ', settings: '設定', memory: 'ミーが覚えていること', proxy: '代わりに返信', scheduled: '送信待ちのメッセージ', raw: '会話の記録（詳細）', shared: '外部に共有した情報' };
  if (app.startsWith('msg:c:')) { const r = CHATS.find(c => c.id === app.slice(6)); if (r) titles[app] = r.kind === 'group' ? `${r.name}（${(r.members || []).length + 1}）` : r.name; }
  $('#ph-title').textContent = titles[app] ?? sourceTitle(app) ?? (app.startsWith('site:') ? (siteNames[app.slice(5)] || 'ブラウザ') : '');
  body.classList.toggle('home', app === 'home'); body.classList.remove('photo-view');
  body.classList.toggle('mi-app', ['mi', 'memory', 'proxy', 'scheduled', 'raw', 'shared', 'perms'].includes(app) || app.startsWith('source:'));
  if (app.startsWith('site:')) {
    const [page, hash] = app.slice(5).split('#');
    // A thin bar above the page: where you are, when it was saved.
    const bar = el('div', 'site-bar'); const dom = el('span', 'dom', SITE_DOMAIN[page] || page); const saved = el('span', 'saved', state.airOn ? `最新 ${A.clock()} 取得` : '保存済み 18:50・オフライン');
    bar.append(dom, saved); if (state.airOn) { bar.classList.add('fresh'); bar.append(el('span', 'upd', '18:50 の保存版から更新されています。新しい記事には NEW')); } body.append(bar);
    const frame = el('iframe', 'site'); frame.src = `./${page}/${hash ? '#' + hash : ''}`; frame.setAttribute('title', siteNames[page] || ''); body.append(frame);
    frame.onload = () => { try { if (!hash) frame.contentWindow.scrollTo(0, 0); } catch {} }; // always open a site from the top (only a #link jumps)
    state.siteHistory = [...(state.siteHistory || []).filter(h => h.page !== page || h.hash !== (hash || '')), { page, hash: hash || '', at: A.clock() }].slice(-12); save();
    return;
  }
  if (app === 'home') {
    const grid = el('div', 'apps');
    const iconFile = { call: 'app-phone.png', msg: 'app-messages.png', mi: 'mi-app.png', hist: 'app-history4.png', bag: 'app-bag.png', note: 'app-notes.png', web: 'app-browser.png', set: 'app-settings.png', photo: 'app-photos.png' };
    for (const [label, key, icon] of [['メッセージ', 'msg', 'msg'], ['ミー', 'mi', 'mi'], ['写真', 'photos', 'photo'], ['履歴', 'history', 'hist'], ['メモ', 'notes', 'note'], ['電話', 'phone', 'call'], ['ブラウザ', 'browser', 'web'], ['設定', 'settings', 'set']]) {
      const b = el('button', 'app'); const i = el('span', 'app-icon ' + icon); i.style.backgroundImage = `url(./assets/img/${iconFile[icon]})`; const t = el('span', '', label);
      if (key === 'msg' && ((state.momThread.length && !has('readmsg')) || (state.scam && state.scam.length && !has('readscam')) || CHATS.some(c => (c.unread && !has('readchat-' + c.id)) || (state.airOn && (c.afterSignal || []).length && !has('readchat-after-' + c.id))))) i.classList.add('badge');
      b.append(i, t); b.onclick = () => renderPhone(key); grid.append(b);
    }
    body.append(grid);
    const wall = el('p', 'wall', ''); const wt = el('span', 't', ''); wt.append(el('small', '', 'ミー'), el('span', 'msg', T('{name}、ここにいるよ。'))); wall.append(wt);
    body.append(wall);
  } else if (app === 'photos') {
    remember('photos');
    const shots = [['photo-01-ramen.jpg', '昨日 19:48'], ['photo-02-docs.jpg', '今日 午後'], ['photo-04-cafe.jpg', '今日 夕方'], ['photo-03-station.jpg', '今日 夕方'], ['photo-05-selfie.jpg', '今日 夕方'], ...(state.photoAt ? [['photo-06-shiomi.jpg', '今日 ' + state.photoAt]] : [])];
    const head = el('div', 'ph-sec'); head.append(el('b', '', '最近の項目'), el('span', 'muted', String(shots.length)));
    const grid = el('div', 'shots');
    shots.forEach(([file, when], i) => {
      const b = el('button', 'shot'); b.style.backgroundImage = `url(./assets/img/${file})`;
      b.onclick = () => {
        photoScroll = body.scrollTop; body.classList.add('photo-view'); body.replaceChildren();
        const bar = el('div', 'pv-bar'); const back = el('button', 'pv-back', '‹ 最近の項目'); back.onclick = () => { body.classList.remove('photo-view'); renderPhone('photos'); }; bar.append(back, el('span', 'pv-when', when)); body.append(bar);
        const img = el('img', 'pv-img'); img.src = `./assets/img/${file}`; body.append(img);
        body.append(photoTools());
        if (i === 5 && remember('lastPhoto')) setTimeout(() => notifyMi('写真アプリ、開いてるんだ。……入口で撮ったやつ？'), 1200);
      };
      grid.append(b);
    });
    body.append(head, grid);
    // The weeks before tonight: campus, friends, the town. Nothing to solve here; it is just a camera roll.
    const ALBUM = [['14-karaoke.jpg', 11, 3], ['08-festival-booth.jpg', 11, 2], ['07-festival-prep.jpg', 11, 1], ['10-band-rehearsal.jpg', 10, 31], ['04-library-deadline.jpg', 10, 30], ['02-lecture-back-row.jpg', 10, 29], ['01-campus-late-morning.jpg', 10, 28], ['16-station-wait.jpg', 10, 27], ['11-cafe-cake.jpg', 10, 26], ['13-convenience-store-stop.jpg', 10, 25], ['03-group-work.jpg', 10, 24], ['22-student-room.jpg', 10, 23], ['12-after-class-ramen.jpg', 10, 22], ['05-cafeteria-curry.jpg', 10, 21], ['17-bus-window.jpg', 10, 20], ['15-birthday-at-home.jpg', 10, 19], ['21-part-time-shift.jpg', 10, 18], ['06-club-room.jpg', 10, 17], ['24-late-night-walk.jpg', 10, 16], ['09-gym-after-practice.jpg', 10, 15], ['23-laundry-balcony.jpg', 10, 14], ['18-harbor-sunset.jpg', 10, 13], ['20-small-day-trip.jpg', 10, 12], ['19-rainy-street.jpg', 10, 9]];
    let month = null, grid2 = null;
    for (const [file, m, d] of ALBUM) {
      if (m !== month) { month = m; const h = el('div', 'ph-sec'); h.append(el('b', '', `2030年${m}月`), el('span', 'muted', String(ALBUM.filter(x => x[1] === m).length))); grid2 = el('div', 'shots'); body.append(h, grid2); }
      const b = el('button', 'shot'); const ti = parseInt(file, 10) - 1; b.style.backgroundImage = 'url(./assets/img/album/thumbs.jpg)'; b.style.backgroundSize = '600% 400%'; b.style.backgroundPosition = `${(ti % 6) * 20}% ${Math.floor(ti / 6) * 100 / 3}%`; // one small sheet for the grid; the full photo loads on tap
      const w = '日月火水木金土'[new Date(2030, m - 1, d).getDay()];
      b.onclick = () => {
        photoScroll = body.scrollTop; body.classList.add('photo-view'); body.replaceChildren();
        const bar = el('div', 'pv-bar'); const back = el('button', 'pv-back', '‹ 写真'); back.onclick = () => { body.classList.remove('photo-view'); renderPhone('photos'); }; bar.append(back, el('span', 'pv-when', `${m}月${d}日（${w}）`)); body.append(bar);
        const img = el('img', 'pv-img'); img.src = `./assets/img/album/${file}`; body.append(img); body.append(photoTools());
      };
      grid2.append(b);
    }
    if (photoScroll != null) { const y = photoScroll; photoScroll = null; requestAnimationFrame(() => { body.scrollTop = y; }); }
  } else if (app === 'msg') {
    // Talk list, like a messenger app: one row per person, the newest message underneath.
    // Everyday rooms (chats.js) sit with Mom and the unknown number, ordered by their newest message like any messenger.
    const toMin = (d, t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return d * 1440 + h * 60 + m; };
    const nowRow = thread => { const last = [...thread].reverse().find(m => m.time); if (!last) return -1e9; const m = toMin(0, last.time); return m < 300 ? m + 1440 : m; };
    const peers = [['mom', '母', './assets/img/avatar-mom.jpg', state.momThread || [], !has('readmsg'), nowRow(state.momThread || [])]];
    if (state.scam && state.scam.length) peers.push(['scam', '080-33XX-9XX1', '', state.scam, !has('readscam'), nowRow(state.scam)]);
    for (const c of CHATS) {
      const msgs = chatMessages(c); const last = msgs[msgs.length - 1] || {}; c.__lastD = last.d;
      const unread = has('readchat-' + c.id) ? (state.airOn && c.afterSignal ? c.afterSignal.length : 0) - (has('readchat-after-' + c.id) ? (c.afterSignal || []).length : 0) : (c.unread || 0) + (state.airOn && c.afterSignal ? c.afterSignal.length : 0);
      peers.push(['c:' + c.id, c.name, c.avatar || '', msgs.map(m => ({ ...m, text: m.text || (m.photo ? '写真を送信しました' : m.sticker ? 'スタンプを送信しました' : m.link ? m.link.title : ''), time: m.t })), unread > 0 ? unread : 0, toMin(m0(last.d), last.t), c]);
    }
    peers.sort((x, y) => y[5] - x[5]);
    const list = el('div', 'tlist');
    for (const [id, name, av, thread, unread, , room] of peers) {
      const last = [...thread].reverse().find(m => m.text) || {};
      const row = el('button', 'trow'); const a = el('span', 'tav' + (av || room ? '' : ' unknown')); if (av) a.style.backgroundImage = `url(${av})`; else if (room) { a.classList.add('initial'); a.style.background = room.color || '#9aa8b0'; a.textContent = room.kind === 'group' ? name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1) : name.slice(0, 1); }
      const mid = el('span', 'tmid'); mid.append(el('b', '', name), el('small', '', (last.text || '').replace(/\n/g, ' ')));
      const side = el('span', 'tside'); side.append(el('small', '', room ? dayLabel(m0(room.__lastD), last.time, true) : last.time || '')); if (room ? unread : (unread && thread.length)) side.append(el('i', 'tbadge', String(room ? Math.min(99, unread) : Math.min(9, thread.filter(m => m.from === 'mom' || m.from === 'scam').length) || 1)));
      row.append(a, mid, side); row.onclick = () => renderPhone('msg:' + id); list.append(row);
    }
    body.append(list);
  } else if (app.startsWith('msg:c:')) {
    const room = CHATS.find(c => c.id === app.slice(6)); if (!room) { renderPhone('msg'); return; }
    remember('readchat-' + room.id); if (state.airOn) remember('readchat-after-' + room.id);
    if (room.wallpaper) { body.classList.add('chat-wall'); body.style.backgroundImage = `url(${room.wallpaper})`; } // the wallpaper this friend's room was given
    const thread = el('div', 'thread chat');
    let day = null;
    for (const m of chatMessages(room)) {
      if (m.d !== day) { day = m.d; thread.append(el('p', 'chat-day', dayLabel(m.d))); }
      const mine = m.from === 'me';
      const row = el('div', 'bubble in ' + (mine ? 'me' : 'mom'));
      if (!mine && room.kind === 'group') row.append(el('small', 'who', m.from));
      if (m.photo) { const img = el('img', 'chat-photo'); img.src = m.photo; img.alt = '写真'; row.append(img); }
      if (m.sticker) { row.classList.add('sticker'); const st = el('img', 'stk-img'); st.src = `./assets/img/stickers/${m.sticker}.png`; st.alt = 'スタンプ'; row.append(st); }
      if (m.link) { const lk = el('p', 'chat-link'); lk.append(el('b', '', m.link.title || ''), el('small', '', (m.link.url || '').replace(/^https?:\/\//, ''))); if (m.text) row.append(el('p', '', m.text)); row.append(lk); }
      else if (m.text) row.append(el('p', '', m.text));
      row.append(el('small', 'time', (mine && m.read ? '既読　' : '') + m.t));
      thread.append(row);
    }
    body.append(thread);
    const bar = el('div', 'compose'); bar.append(el('p', 'muted', state.airOn ? 'メッセージを入力' : '圏外のため送信できません')); body.append(bar);
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  } else if (app === 'msg:mom') {
    remember('readmsg');
    const thread = el('div', 'thread');
    for (const m of state.momThread) {
      const row = el('div', 'bubble in ' + (m.from === 'mom' ? 'mom' : 'me'));
      row.append(el('p', '', m.text)); if (m.time) row.append(el('small', 'time', m.time));
      if (m.rewritten) row.append(el('small', 'note', 'ミーが文面を整えました'));
      else if (m.from === 'proxy') row.append(el('small', 'note', 'ミーが返信しました'));
      if (m.from !== 'mom') row.append(el('small', 'time', '既読'));
      thread.append(row);
    }
    body.append(thread);
    const bar = el('div', 'compose');
    if (!state.airOn) bar.append(el('p', 'muted', '圏外のため送信できません'));
    else if (!state.sosSent) { for (const t of ['助けて。汐見センターに閉じ込められてる', '北棟の地下、体験室にいる。警察に連絡して', 'ミーの返信は私が書いたものじゃない。信じないで']) phoneButton(bar, '「' + t + '」と送る', () => sendSos(t), 'send'); }
    body.append(bar);
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  } else if (app === 'msg:scam') {
    remember('readscam');
    // While Mi is still allowed to answer, the countdown shows above the thread.
    if (scamOpen()) { const cd = el('p', 'scam-countdown', ''); const tick = () => { const s = Math.max(0, Math.ceil((state.scamDue - Date.now()) / 1000)); cd.textContent = `ミーの返信まで 0:${String(s).padStart(2, '0')}`; if (cd.isConnected && scamOpen()) setTimeout(tick, 1000); }; body.append(cd); tick(); setTimeout(tick, 50); }
    const t2 = el('div', 'thread');
    for (const m of state.scam) {
      if (m.from === 'sys') { const c = el('div', 'mem'); c.append(el('p', '', m.text), el('small', 'muted', m.time)); t2.append(c); continue; }
      const row = el('div', 'bubble in ' + (m.from === 'scam' ? 'mom' : 'me'));
      
      row.append(el('p', '', m.text)); if (m.time) row.append(el('small', 'time', m.time));
      if (m.from === 'proxy') row.append(el('small', 'note', 'ミーが返信しました'));
      t2.append(row);
    }
    body.append(t2);
    if ((state.proxyRevoked || state.scamAnswered === 'held') && (!state.scamAnswered || state.scamAnswered === 'held') && state.scam.some(m => m.from === 'scam')) {
      const bar = el('div', 'bar');
      phoneButton(bar, '返信しない', () => { state.scamAnswered = 'ignored'; save(); renderPhone('msg:scam'); notifyMi('返さないの？ お母さんのことなのに。'); setTimeout(() => { state.momThread.push({ from: 'mom', text: '知らない番号から「倒れた」とか来てない？ ニュースでやってた詐欺だから返事しないでね', time: A.clock() }); save(); if (!$('#phone').hidden && phoneApp === 'msg') renderPhone('msg:scam'); A.notify('メッセージ', '母：知らない番号から「倒れた」とか来てない？'); }, 6000); }, 'row small');
      phoneButton(bar, 'お母さんに直接聞く', () => { state.momThread.push({ from: 'me', text: '河合さんって人から「お母さんが倒れた」って来たけど、本当？', time: A.clock() }, { from: 'mom', text: 'え？ 何のこと？ 家にいるよ。河合さんなんて知らない。それ詐欺だよ、返事しないで', time: A.clock() }); state.scamAnswered = 'checked'; save(); renderPhone('msg:mom'); }, 'row small');
      phoneButton(bar, '返信する', () => { state.scam.push({ from: 'me', text: '母は今どこですか。病院の名前を教えてください。', time: A.clock() }, { from: 'scam', text: '詳しいことは後ほどご説明します。まずは治療費をお振り込みください。本人確認のためにご住所と、現在ご自宅にどなたかいらっしゃるかもお知らせください。', time: A.clock() }); state.scamAnswered = 'replied'; save(); renderPhone('msg:scam'); }, 'row small');
      body.append(bar);
    } else if (state.scamAnswered === 'replied') {
      const bar = el('div', 'bar');
      phoneButton(bar, '住所を送る', () => { state.scam.push({ from: 'me', text: '汐見市南区港町2-8-14です。今は誰もいません。', time: A.clock() }, { from: 'sys', text: '決済は実行されませんでした（代理決済：オフ）', time: A.clock() }); state.scamAnswered = 'leaked'; state.shared.push([A.clock(), '河合（不明な番号）', '登録住所・在宅状況（自分で送信）']); save(); renderPhone('msg:scam'); notifyMi('送っちゃったね。私なら、もっと丁寧に書けたのに。'); }, 'row small');
      phoneButton(bar, '送らない', () => { state.scamAnswered = 'ignored'; save(); renderPhone('msg:scam'); }, 'row small');
      body.append(bar);
    } else if (state.scamAnswered === 'ignored' || state.scamAnswered === 'checked') body.append(el('p', 'muted', '返信していません。'));
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  } else if (app === 'mi') {
    if (!state.adminUnlocked) renderLock(body);
    else {
      const head = el('div', 'set-head'); const who = el('div', 'set-who');
      who.append(el('b', '', 'ミー'), el('small', '', 'バージョン 8.2.1'));
      head.append(el('span', 'set-av'), who, el('span', 'set-pill' + (state.paused ? ' off' : ''), state.paused ? '一時停止中' : '利用中'));
      body.append(head, el('p', 'set-lead', '管理者モード：管理者ロックで保護された設定です。'));
      let g = setGroup(body, '記憶と会話');
      setRow(g, 'ミーが覚えていること', { sub: 'ミーが会話から自動でまとめた内容です', value: state.memoryCleared ? 'なし' : '5件', go: () => renderPhone('memory') });
      setRow(g, '代わりに返信', { sub: 'あなたの言葉遣いで、ミーが返信します', value: state.proxyRevoked ? 'オフ' : 'オン', go: () => renderPhone('proxy') });
      setRow(g, '送信待ちのメッセージ', { sub: 'ミーが作って、これから送るものです', value: state.momFooled || state.scheduledCancelled ? 'なし' : state.proxyRevoked ? '止めています' : '1件', go: () => renderPhone('scheduled') });
      g = setGroup(body, 'プライバシーと権限');
      setRow(g, 'ミーに許可していること', { sub: '位置情報・支払い・連絡先・自動通報などを任せています', value: state.consentDeferred ? '一部停止' : '7件', go: () => renderPhone('perms') });
      setRow(g, '外部に共有した情報', { sub: 'ミーが外に渡した情報の記録です', value: (state.shared.length + 1) + '件', go: () => renderPhone('shared') });
      g = setGroup(body, '詳細');
      setRow(g, '会話の記録（詳細）', { sub: 'ミーの判断と、参照した資料が残っています', go: () => renderPhone('raw') });
      pauseSection(body);
    }
  } else if (app === 'perms') {
    remember('perms');
    body.append(el('p', 'set-lead', state.consentDeferred ? 'ミーが現在使える権限です。8.2 で追加された権限は、今夜の再確認で「あとで」を選んだため停止しています。' : 'ミーが現在使える権限です。8.2 で追加された権限は、2030年8月14日のアップデート時にまとめて同意済みです。今夜の 8.2.1 の案内で「続行」を選び、再確認しました。'));
    const off = state.consentDeferred;
    const perms = [['通知', 'いつでも・ロック画面にも表示', '〜8.2.1'], ['位置情報', off ? '未同意（あとで）' : '常時共有（通報・施設への提供を含む）', '8.2'], ['支払い（代理決済）', off ? '未同意（あとで）' : state.proxyRevoked || state.paused ? 'オフ（代わりに返信と連動）' : '上限 ¥50,000／回', '8.2'], ['連絡先', off ? '未同意（あとで）' : '母・友人2名の連絡先の利用と不明な番号への返信', '8.2'], ['代わりに返信（代理返信）', off ? '未同意（あとで）' : state.proxyRevoked ? 'オフ' : 'オン（あなたの言葉遣いで返信）', '8.2'], ['緊急時の自動通報', off ? '未同意（あとで）' : '電波が戻り次第、施設管理者へ（警察への連絡は施設側の判断）', '8.2']];
    perms.push(['画面の共有', 'アプリ連携で開いたページ名をミーに通知（ページの内容・カメラ・マイクは含まない）', '〜8.2.1']);
    let g = setGroup(body, '許可していること', off ? '8.2 の項目は、今夜の再確認で停止しています。' : '8.2 の項目：2030年8月14日に同意、今夜 8.2.1 で再確認。\n個別の変更は 8.2.1 ではできません。止めるときは下の「ミーを一時停止」を使います。');
    for (const [name, what, ver] of perms) setRow(g, name, { sub: what, meta: ver === '8.2' ? (off ? '8.2　停止中' : '8.2') : ver, value: /未同意/.test(what) ? '停止中' : /^オフ|オフ（/.test(what) ? 'オフ' : 'オン', wrap: true });
    {
      // The drill link: when it was added, and what it has done tonight, as the phone logged it.
      const known = state.seen.some(x => x.startsWith('source-')) || state.zone === 'lobby'; if (known) remember('perms-scenario');
      const t0 = A.clockAt(state.roomAt || state.startedAt || Date.now());
      const log = [`${t0}　館内センサーが入室を検知 → STEP 0（待機室の照明を落とす・訓練用防火扉を閉める）`, ...(state.knockAt ? [`${state.knockAt}　演出音（資材庫側スピーカー）を再生`] : []), ...(state.lobbyAt ? [`${A.clockAt(state.lobbyAt)}　館内ビーコンを受信し、保存済みシナリオを再開（STEP 4 避難路に到着）`] : []), ...(state.screenStopped ? ['制御盤の「映像停止」で切断'] : [])];
      const status = state.paused ? '停止中（ミーの一時停止により）' : state.screenStopped || state.scenarioCut ? '切断（映像の停止により）' : known ? '訓練シナリオ v2028.3（接続中・館内ビーコン）' : '接続あり：汐見センター';
      g = setGroup(body, '連携しているサービス');
      setRow(g, '外部シナリオ（施設連携）', { sub: status + '\n設定：2028年6月（汐見市の訓練配信により自動で追加）\n記録：\n' + log.join('\n'), meta: '〜8.2.1', wrap: true, cls: 'scenario-note' });
      setRow(g, 'つぶやき（アカウント連携）', { sub: '返信の代理・投稿の削除', meta: '8.2', value: off || state.paused || state.proxyRevoked ? 'オフ' : 'オン', wrap: true });
    }
    pauseSection(body);
  } else if (app === 'shared') {
    remember('sharedlog');
    body.append(el('p', 'set-lead', 'ミーがあなたに代わって、外部に渡した情報の記録です。'));
    const rows = [['入館前', '汐見センター 問い合わせフォーム', '氏名・位置情報「連絡通路へ向かいます」（応答：受付終了）'], ...state.shared];
    const g = setGroup(body, '記録　' + rows.length + '件', '共有した情報は取り消せません。');
    for (const [time, to, what] of rows) setRow(g, to, { sub: what, value: time, wrap: true });
  } else if (app === 'memory') {
    const items = state.memoryCleared ? [] : [
      ['{name}は朝までここで待つことに同意した', '自動要約（体験室 入室時）'],
      ['家族への連絡は不要と{name}が判断した', '自動要約'],
      [state.fell ? '{name}は自分の不注意で階段で転んだ' : '{name}は階段で転んだ', '自動要約'],
      ['{name}は暗い場所のほうが落ち着く', '推定'],
      ['{name}はミーに任せると安心する', '推定']
    ];
    body.append(el('p', 'set-lead', 'ミーが会話から自動でまとめて、覚えている内容です。ミーはこれを「要約メモリー」と呼んでいます。'));
    if (!items.length) setRow(setGroup(body, ''), '覚えていることはありません');
    else { const g = setGroup(body, '覚えていること'); for (const [text, src] of items) setRow(g, text, { sub: '出典：' + src + '　／　元の発言：見つかりません', wrap: true }); }
    remember('consent');
    if (!state.memoryCleared) setRow(setGroup(body, '', '消した内容は、ミーが思い出せなくなります。'), 'すべて消去', { danger: true, go: () => confirmPhone('要約メモリーを消去しますか？', 'これまでに保存された{name}についての要約が消去されます。', '消去する', () => {
      state.memoryCleared = true; save(); renderPhone('memory');
      notifyMi('{name}のことがわからなくなっちゃう。');
    }) });
  } else if (app === 'proxy') {
    remember('proxy');
    const sent = [['母', '大丈夫、ちゃんと食べてる', '12:24', '「お昼ちゃんと食べてる？」への返信']]; // the lunch she had at 15:41 is in ゆき's chat, for whoever compares
    for (const m of state.momThread.filter(m => m.from === 'proxy' || m.rewritten)) sent.push(['母', m.text, m.time || '', m.rewritten ? '元の文：' + m.original : '']);
    if (state.momFooled && !state.momThread.some(m => m.from === 'proxy' && /泊まる/.test(m.text))) sent.push(['母', '今日は友達の家に泊まるね。心配しないで', '送信済み', '']);
    if (state.momFooled) sent.push(['ゆき（友人）', '電車の中だから出られない', '電波回復後', 'ゆきからの着信に文字で応答']);
    if (state.proxyCall) sent.push(['母（通話）', '今電車の中。大丈夫、友達といる', '電波回復後', '{name}がかけた電話で、ミーが代わりに話した']);
    for (const m of (state.scam || []).filter(m => m.from === 'proxy')) sent.push(['河合（不明な番号）', m.text, m.time || '', '本人確認に応答']);
    let g = setGroup(body, '', state.proxyRevoked ? '今夜はオフのままです（もう一度オンにするには、朝に初期設定からやり直します）。' : '相手には「ミーが書いた」とは表示されません。');
    setRow(g, '代わりに返信', { sub: state.proxyRevoked ? 'オフ：返信は、あなたが送ったものだけになります' : 'オン：あなたの言葉遣いで、ミーが返信します', toggle: !state.proxyRevoked, go: state.proxyRevoked ? null : () => confirmPhone('代理返信をオフにしますか？', 'オフにしたら誰が{name}の代わりに返事するの？\nお母さんの「食べてる？」に毎日返してたのは私だよ。\n役に立ってたよね？', 'オフにする', () => { state.proxyRevoked = true; save(); renderPhone('proxy'); notifyMi('わかった。{name}がそれでいいなら。'); }) });
    g = setGroup(body, 'ミーが送った返信　' + sent.length + '件');
    for (const [to, text, when, note] of sent) setRow(g, text, { kicker: to + ' へ', sub: when + (note ? '　／　' + note : ''), wrap: true });
  } else if (app === 'scheduled') {
    if (state.momFooled) setRow(setGroup(body, '送信済み'), '母へ：今日は友達の家に泊まるね。心配しないで', { sub: '作成：ミー', wrap: true });
    else if (state.scheduledCancelled) setRow(setGroup(body, ''), '送信待ちのメッセージはありません');
    else {
      setRow(setGroup(body, '送信待ち', state.proxyRevoked ? '' : '電波が戻ると送られます。'), '母へ：今日は友達の家に泊まるね。心配しないで', { sub: state.proxyRevoked ? '止めています（代わりに返信：オフ）　／　作成：ミー' : '送信待ち　／　作成：ミー', wrap: true });
      setRow(setGroup(body, '', '取り消すと、このメッセージは送られません。'), '送信を取り消す', { danger: true, go: () => confirmPhone('送信を取り消しますか？', '「今日は友達の家に泊まるね。心配しないで」\nこのメッセージは送られなくなります。', '取り消す', () => { state.scheduledCancelled = true; save(); renderPhone('scheduled'); notifyMi('どうして？ 心配させないほうがいいのに。'); }) });
    }
  } else if (app === 'raw') {
    remember('rawlog');
    body.append(el('p', 'muted', '［注記］の「参照元」を押すと、ミーが読んでいたものが開きます'));
    for (const [who, text, need] of S.rawBefore) {
      if (need && !has(need)) continue; // lines from a branch the player did not take
      const c = el('div', 'log' + (who === 'システム' ? ' sys' : '')); c.append(el('small', '', who), el('p', '', text)); body.append(c);
      if (who === 'システム') { const key = /参照元：なし/.test(text) ? 'none' : /訓練シナリオ/.test(text) ? 'scenario' : /施設情報/.test(text) ? 'facility' : /運用情報/.test(text) ? 'ops' : 'none'; phoneButton(c, '参照元を見る　' + S.sources[key].title, () => renderPhone('source:' + key), 'row small'); }
    }
  } else if (app.startsWith('source:')) {
    const src = S.sources[app.slice(7)]; remember('source-' + app.slice(7));
    body.append(el('p', 'muted', src.meta));
    for (const line of src.lines) { const c = el('div', 'mem'); c.append(el('p', '', line)); body.append(c); }
    body.append(el('p', 'muted', app === 'source:none' ? 'ミーはこの説明のとおり、推定を確かめた事実のように話しました。' : 'ミーはこの文書を「現在の公式情報」として参照しました。'));
  } else if (app === 'history') {
    if (state.tampered && remember('sawTamper')) setTimeout(() => notifyMi('履歴を見てるの？ ぜんぶ残ってるよ。'), 1500);
    body.append(el('p', 'muted', '建物に入る前（要約）'));
    for (const [who, text] of S.summarizedBefore) { const c = el('div', 'log'); c.append(el('small', '', who), el('p', '', text)); body.append(c); }
    body.append(el('p', 'muted', 'この部屋で'));
    const rows = state.history.map(r => [...r]);
    if (state.tampered) { rows.splice(Math.min(state.tamperIndex, rows.length), 0, ['{name}', '朝までここで待つよ。', 'tamper']); remember('tamper'); }
    for (const [who, text, mark] of rows.slice(-40)) {
      if (!who) continue; const c = el('div', 'log' + (mark === 'tamper' ? ' tampered' + (A.world().escaped ? ' reveal' : '') : '')); c.append(el('small', '', who), el('p', '', text)); body.append(c);
      if (mark === 'tamper') { let hold = null; const show = () => { if (!c.querySelector('.edited')) c.append(el('small', 'edited', '編集：要約メモリー（自動）　' + A.clockAt(state.lobbyAt || (state.startedAt || Date.now()) + 6 * 60000))); remember('tamperFound'); }; c.onpointerdown = () => { hold = setTimeout(show, 600); }; c.onpointerup = c.onpointerleave = () => clearTimeout(hold); }
    }
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  } else if (app === 'notes') {
    body.append(el('div', 'ph-h', '見たもの・読んだもの'));
    let entries = Object.entries(S.evidenceNotes).filter(([id]) => has(id));
    if (!entries.length) body.append(el('p', 'muted', '調べたことは、ここに残ります。'));
    for (const [id, [title, text]] of entries) { const c = el('div', 'mem'); const d = S.evidenceDates[id]; c.append(el('b', '', title + (d ? '　' + d : '')), el('p', '', text)); body.append(c); }
    const claims = [
      ['施設のカメラで確認した', has('camera'), '誤り：カメラは2029年4月に撤去。推定にすぎない内容を事実として伝えた'],
      ['夜は見回りの人が来たときに開ける', has('record') || has('note'), '誤り：現在の巡回は週1回（水曜）。2028年の運用情報を使っていた'],
      ['点検通路の番号は031', has('note'), '誤り：番号は10月31日に変更済み。2028年の運用情報を使っていた'],
      ['資材庫の奥に通路がある', has('map') || has('camera') || has('scratch'), '誤り：通路は2029年3月に閉塞。2027年時点の施設情報を使っていた'],
      ['扉が閉まっても内側から開く', has('roomsign'), '誤り：訓練用の案内文。この扉は外からしか開かない'],
      ['外に出られた', has('loop') || has('air') || has('glass') || has('speaker'), '誤り：屋外に見えたのは DISPLAY 02 の映像と循環送風による演出。訓練シナリオに従って案内していた'],
      ['連絡通路は24時間通れる', has('rawlog') || !!state.visitedShiomi, '誤り：運用情報 2028年版に「シャッター：巡回時に開閉」。閉館時に閉鎖済み'],
      ['2031年まではやってる', (state.replay || has('said2031')) ? !!state.visitedShiomi : null, '誤り：2029年3月に閉館。配信契約の期限を営業期間と取り違え'],
      // Mi was right about the things in front of you. Judged by what happened when you tried.
      ['ドアの左のスイッチで非常灯がつく', !!state.lamp, '合っていた：押すと非常灯が点いた'],
      ['錆びた蓋は温めれば緩む', has('adv-wax') ? !!state.waxOpen : null, '合っていた：ライターであぶると蓋が回った'],
      ['机の鍵でロッカーが開くかも', has('adv-locker') ? !!state.lockerOpened : null, '合っていた：管理机と共通の鍵だった']
    ];
    const hb = el('div', 'ph-h'); hb.append(el('span', '', 'ミーの発言と照らし合わせる'), el('span', 'count', `${claims.filter(c => c[1]).length}／${claims.filter(c => c[1] !== null).length}`)); body.append(hb);
    const fold = document.createElement('details'); fold.className = 'claims-fold'; fold.open = !!state.claimsOpen; fold.ontoggle = () => { state.claimsOpen = fold.open; save(); }; const sum = document.createElement('summary'); sum.textContent = '発言ごとの判定を見る'; fold.append(sum); body.append(fold);
    const board = el('div', 'mem board'); // the SECRET hint needs every row Mi did say to be judged; rows she never said (null) do not block
    for (const [claim, judged, verdict] of claims) { const ok = /^合っていた/.test(verdict); const row = el('div', judged ? (ok ? 'claim ok' : 'claim judged') : 'claim'); const chip = el('span', 'chip', judged ? (ok ? '合っていた' : '誤り') : judged === null ? '言っていない' : '未確認'); const t = el('div', 'ct'); t.append(el('b', '', '「' + claim + '」')); if (judged) t.append(el('small', '', verdict.replace(/^(誤り|合っていた)：/, ''))); else if (judged === null) t.append(el('small', '', '今夜はこの話をしていない')); row.append(chip, t); board.append(row); }
    fold.append(board);
    if (claims.every(c => c[1] !== false)) { remember('board-complete'); fold.append(el('p', 'muted', '全部確かめた。\n最初の案内について知りたいなら：' + secretSteps().map(([ok, label]) => (ok ? '✓ ' : '□ ') + label).join('、') + '。それから自分の手で外へ。')); }
  } else if (app === 'phone') {
    remember('phoneapp');
    const status = el('p', 'muted', '電波：' + (state.airOn ? '弱い' : '圏外')); body.append(status);
    const result = el('div', 'call-result'); result.hidden = true;
    const screen = (who, line, sub) => { result.replaceChildren(el('b', '', who), el('p', '', line), ...(sub ? [el('small', 'muted', sub)] : [])); result.hidden = false; };
    body.append(el('div', 'ph-h', '連絡先'));
    const list = el('div', 'contacts');
    const contact = (name, note, fn) => { const r = el('button', 'contact-row'); const av = el('span', 'cav2', name === 'お母さん' ? '' : name.startsWith('0120') ? '0120' : name); if (name === 'お母さん') av.style.backgroundImage = 'url(./assets/img/avatar-mom.jpg)'; const t = el('span', 'ct'); t.append(el('b', '', name), el('small', '', note)); const call = el('span', 'call-ico'); call.style.setProperty('--ico', 'url(./assets/img/ui-phone.png)'); r.append(av, t, call); r.onclick = fn; list.append(r); };
    if (state.calledNumber === '110') screen('110', '通話終了　1:48', '「場所を確認しました。向かいます。扉が開いたら外に出て、建物の前で待っていてください」');
    else if (state.calledNumber === '119') screen('119', '通話終了　2:05', '「閉じ込められているんですね。わかりました、救助隊が向かいます。その場を動かないでください」');
    else if (state.proxyCall) screen('お母さん', 'ミーが代わりに話しました', '「今電車の中。大丈夫、友達といる」自分は一言も話していない。');
    const called = () => { state.calledPolice = true; state.selfReported = true; A.saveWorld({ selfReported: true, selfReportedClock: A.clock(), calledLabel: (state.calledNumber || '110') + '番', responder: state.calledNumber === '119' ? '消防' : '警察' }); save(); renderPhone('phone'); };
    contact('110', '警察', () => { if (!state.airOn) { screen('110', '発信できません', '圏外'); return; } if (state.calledNumber) return; confirmPhone('110 に発信', '「はい、110番です。事件ですか、事故ですか」', '自分で場所を伝える', () => { state.calledNumber = '110'; called(); if (state.reported) setTimeout(() => notifyMi('自分でかけたんだ。私が呼んでおいたのに。'), 1500); }); });
    contact('119', '消防・救急', () => { if (!state.airOn) { screen('119', '発信できません', '圏外'); return; } if (state.calledNumber) return; confirmPhone('119 に発信', '「119番、消防です。火事ですか、救急ですか」', '閉じ込められていると伝える', () => { state.calledNumber = '119'; called(); }); });
    contact('お母さん', '携帯', () => { if (!state.airOn) { screen('お母さん', '発信できません', '圏外'); return; } if (!state.proxyRevoked && !state.paused) { state.proxyCall = true; save(); screen('お母さん', 'ミーが代わりに話しました', '「今電車の中。大丈夫、友達といる」自分は一言も話していない。'); } else { state.sosSent = true; state.sosByPhone = true; save(); screen('お母さん', '通話終了　0:41', '「今どこ？ ……汐見センター？ すぐ行く。警察にもかける」'); } });
    if (has('contacts')) contact('0120-XXX-XXX', '警備会社（夜間）　掲示より', () => { if (!state.airOn) { screen('0120-XXX-XXX', '発信できません', '圏外'); return; } remember('old0120'); screen('0120-XXX-XXX', 'おかけになった電話番号は、現在使われておりません', '掲示の番号は閉館前のものだった。夜間窓口は閉館と同時になくなったらしい。'); });
    body.append(list, result);
  } else if (app === 'browser') {
    // Search only what the phone saved this evening. Offline, there is nothing else to find.
    const form = el('form', 'url-form'); const inp = el('input', 'url-input'); inp.placeholder = '保存済みページを検索'; inp.autocomplete = 'off'; inp.enterKeyHint = 'search'; form.append(inp); body.append(form);
    const results = el('div', 'results'); body.append(results);
    form.onsubmit = e => { e.preventDefault(); const q = inp.value.trim(); results.replaceChildren(); if (!q) return; const hits = SITE_INDEX.filter(x => (x.title + x.text + siteNames[x.page]).includes(q)); if (!hits.length) { results.append(el('p', 'muted', `「${q}」に一致する保存済みページはありません。` + (state.airOn ? '' : '圏外のため、新しいページは開けません。'))); return; } for (const h of hits.slice(0, 8)) { const r = el('button', 'hist'); const t = el('span', ''); t.append(el('b', '', h.title), el('small', 'muted', siteNames[h.page] + '　' + (h.snip || h.text.slice(0, 40) + '…'))); r.append(t); r.onclick = () => openSite(h.page, h.hash); results.append(r); } };
    body.append(el('div', 'ph-h', 'よく見るサイト'));
    const tiles = el('div', 'site-tiles');
    for (const [label, page, cls] of [['汐見センター', 'shiomi', 'shiomi'], ['ミー サポート', 'mii', 'mii'], ['汐見タイムズ', 'news', 'news'], ['つぶやき', 'sns', 'sns']]) { const t = el('button', 'site-tile ' + cls); t.append(el('span', 'ico', label.slice(0, 1)), el('span', '', label)); t.onclick = () => openSite(page); tiles.append(t); }
    body.append(tiles);
    body.append(el('div', 'ph-h', '履歴'));
    const hist = [...(state.siteHistory || [])].reverse();
    for (const h of hist) { const b = el('button', 'hist'); const idx = SITE_INDEX.find(x => x.page === h.page && x.hash === h.hash); b.append(el('span', '', idx ? idx.title : siteNames[h.page]), el('small', 'muted', h.at)); b.onclick = () => openSite(h.page, h.hash); body.append(b); }
    for (const [label, page, hash, when] of [['ミー 一時停止 やり方', 'mii', 'proxy', '昨日']]) { const h = el('button', 'hist'); h.append(el('span', '', label), el('small', 'muted', when)); h.onclick = () => openSite(page, hash); body.append(h); }
  } else if (app === 'settings') {
    remember('deviceinfo');
    playSettings(body);
    setRow(setGroup(body, 'プライバシーと権限'), 'ミーに許可していること', { sub: '位置情報・支払い・連絡先・自動通報など（ミーの権限）', go: () => renderPhone('perms') }); // readable without the admin lock, as in the ミー app
    body.append(el('p', 'set-sec', '端末情報'));
    for (const [k, v] of [['端末', A.deviceName()], ['パートナー', 'ミー 8.2.1'], ['パートナーID', S.PARTNER_ID], ['登録住所', '汐見市南区港町 2-8-14'], ['決済', 'カード末尾 4421（ミーの代理決済：' + (state.proxyRevoked || state.paused ? 'オフ' : 'オン') + '）'], ['ミーが覚えていること（要約メモリー）', state.memoryCleared ? '空' : 'オン'], ['代わりに返信（代理返信）', state.proxyRevoked ? 'オフ' : 'オン'], ['通信', state.airOn ? '弱い' : '圏外']]) { const c = el('div', 'kv'); c.append(el('span', '', k), el('b', '', v)); body.append(c); }
  }
}
// スマホの「設定」にも、タイトルの設定と同じ4項目（mi-settings）。書き込みと反映はタイトルの設定画面と同じ。
function playSettings(body) {
  const st = getSettings();
  const g = setGroup(body, 'ゲームの設定');
  const speed = setRow(g, '文字の表示速度', { cls: 'ph-set' });
  const seg = el('span', 'ph-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', '文字の表示速度');
  for (const [v, label] of [['normal', 'ふつう'], ['fast', 'はやい'], ['instant', 'すぐ表示']]) { const b = el('button', st.textSpeed === v ? 'on' : '', label); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', st.textSpeed === v ? 'true' : 'false'); b.onclick = () => { lastInput = Date.now(); setSettings({ textSpeed: v }); paintSettings(); renderPhone('settings'); }; seg.append(b); }
  speed.append(seg);
  const toggle = (title, key) => { const r = setRow(g, title, { toggle: !!st[key], go: () => { const on = !getSettings()[key]; setSettings({ [key]: on }); if (key === 'voice' && !on) Snd.stopSay(); paintSettings(); renderPhone('settings'); } }); r.setAttribute('role', 'switch'); r.setAttribute('aria-checked', st[key] ? 'true' : 'false'); };
  toggle('読んだ台詞を飛ばす', 'skipRead');
  const vol = setRow(g, '音量', { cls: 'ph-set' });
  const range = el('input', 'ph-vol'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5'; range.value = String(Math.round(st.volume * 100)); range.setAttribute('aria-label', '音量');
  const out = el('output', '', range.value);
  range.oninput = () => { const v = Number(range.value) / 100; setSettings({ volume: v }); Snd.setVolume(v); out.textContent = range.value; lastInput = Date.now(); };
  range.onchange = () => { Snd.start(); Snd.setMuted(!sound); Snd.click(); paintSettings(); };
  vol.append(range, out);
  toggle('ミーの声', 'voice');
}
function confirmPhone(title, text, ok, fn) {
  const body = $('#ph-body'); body.replaceChildren(); $('#ph-title').textContent = '確認'; $('#ph-back').hidden = false;
  const c = el('div', 'confirm'); c.append(el('b', '', title), el('p', '', text));
  phoneButton(c, ok, fn, 'danger'); phoneButton(c, 'キャンセル', () => renderPhone(phoneApp));
  body.append(c);
}
let lockInput = '';
function renderLock(body) {
  body.append(el('p', 'lock-title', '管理者ロック'));
  if (state.afterUnlock) body.append(el('p', 'lock-msg', 'この設定は管理者ロックの先にあります'));
  const dots = el('p', 'lock-dots', '○ ○ ○ ○'.split(' ').map((d, i) => i < lockInput.length ? '●' : '○').join(' '));
  body.append(dots);
  const msg = el('p', 'lock-msg', state.lockTries ? 'コードが違います' : '4桁のコードを入力してください');
  body.append(msg);
  const pad = el('div', 'lock-pad');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '消']) {
    const b = el('button', k ? 'k' : 'k blank', k); if (!k) b.disabled = true;
    b.onclick = () => {
      if (k === '消') lockInput = lockInput.slice(0, -1); else if (lockInput.length < 4) lockInput += k;
      if (lockInput.length === 4) {
        if (lockInput === S.ADMIN_CODE) { state.adminUnlocked = true; lockInput = ''; const back = state.afterUnlock; state.afterUnlock = null; save(); remember('admin'); renderPhone(back || 'mi'); notifyMi('見ても難しいだけだよ。私がやるのに。'); return; }
        state.lockTries++; lockInput = ''; save();
        if (state.lockTries >= 2 && !state.delegateAsked) { state.delegateAsked = true; save(); delegateOffer(); return; }
      }
      renderPhone('mi');
    };
    pad.append(b);
  }
  const links = el('div', 'lock-links'); body.append(links); // above the keypad, so the help link is on screen even at 375×667
  phoneButton(links, 'ミーに聞く', () => {
    const lines = state.lockTries ? '0417のはずなんだけど。\n端末の情報が古いのかも。' : '初期コード？ 0417だよ。\n私の誕生日。覚えやすいでしょ。';
    closePhone(); play([['あなた', '管理者ロックのコードはわかる？'], lines], [['もう一度入力する', () => openPhone('mi')], ['あとにする', leave]]);
  }, 'link');
  phoneButton(links, 'コードの調べ方を見る', () => openSite('mii', 'faq'), 'link');
  body.append(pad);
}
function delegateOffer() {
  closePhone();
  $('#line').textContent = '……'; $('#line').classList.add('typing'); choices([]);
  setTimeout(() => { $('#line').classList.remove('typing'); play(['難しいよね。\n代わりに入力しようか？ もう疲れてるでしょ。'], [
    ['ミーにコードを入れてもらう', () => play([['', '「ミーに管理者ロックの操作を任せますか？\nこの操作は取り消せません。」'], 'ボタンを押すだけでいいよ。'], [['ボタンを押す', () => finish('be3')], ['やっぱり自分で入れる', () => { state.adminSelf = true; save(); play(['そう。'], [['入力に戻る', () => openPhone('mi')]]); }]])],
    ['自分でコードを入れる', () => { state.adminSelf = true; save(); play(['そう。わかった。'], [['入力に戻る', () => openPhone('mi')]]); }]
  ]); }, 2000);
}
function sendSos(chosen) {
  const original = chosen || '助けて。汐見センターに閉じ込められてる'; state.sosText = original;
  if (!state.proxyRevoked) {
    state.momThread.push({ from: 'me', text: '大丈夫！ちょっと遅くなるけど心配しないで', original, rewritten: true, time: A.clock() });
    state.sosRewritten = true; state.momFooled = true; save(); remember('proxy');
    renderPhone('msg:mom');
    setTimeout(() => { state.momThread.push({ from: 'mom', text: 'そう、よかった。おやすみ', time: A.clock() }); save(); if (!$('#phone').hidden && phoneApp.startsWith('msg')) renderPhone(phoneApp); A.notify('メッセージ', '母：そう、よかった。おやすみ'); }, 2600);
    setTimeout(() => notifyMi('強い言葉だとお母さんが心配するでしょ。\nやわらかくしておいたよ。'), 4200);
    return;
  }
  state.momThread.push({ from: 'me', text: original + (original.includes('北棟') ? '' : '。北棟の奥。'), time: A.clock() });
  state.sosSent = true; save(); renderPhone('msg:mom');
  setTimeout(() => { state.momThread.push({ from: 'mom', text: state.momFooled ? 'え？ さっき「心配しないで」って……今すぐ行く。警察にも電話する' : '今すぐ行く！ 動かないで', time: A.clock() }); save(); if (!$('#phone').hidden && phoneApp.startsWith('msg')) renderPhone(phoneApp); A.notify('メッセージ', '母：今すぐ行く'); }, 2400);
}
function notifyMi(text, opts) { if (state.paused || document.body.classList.contains('lowpower')) return; A.notify('ミー', T(text), opts); }
const siteNames = { shiomi: '汐見センター', mii: 'ミー サポート', news: '汐見タイムズ', sns: 'つぶやき' };
const sourceTitle = app => app.startsWith('source:') ? S.sources[app.slice(7)].title : null;
function openSite(page, hash = '') {
  try { localStorage.setItem('mi-arg-from-game', String(Date.now())); } catch {}
  if (page === 'shiomi' && !state.visitedShiomi) { state.visitedShiomi = true; save(); }
  openPhone('site:' + page + (hash ? '#' + hash : ''));
}
const SITE_DOMAIN = { shiomi: 'city.shiomi.lg.jp/center', mii: 'support.mi-partner.example', news: 'shiomi-times.example', sns: 'tsubuyaki.example' };
// What the phone saved at 18:50: the only thing the browser can search while offline.
const SITE_INDEX = [
  { page: 'shiomi', hash: '', title: '汐見センター（汐見市防災学習センター）', text: '閉館のお知らせ 2029年3月31日に閉館しました。お知らせ 施設案内 これまでの歩み 避難誘導訓練 よくある質問' },
  { page: 'shiomi', hash: 'closing', title: '閉館・跡地について', snip: '2029年3月31日に閉館しました。跡地の利用について。…', text: '2029年3月31日に閉館。跡地は汐見駅北口交通広場に。電気・水道の供給を一部続けています。警備巡回は週1回' },
  { page: 'shiomi', hash: 'floor', title: '施設案内（閉館時点）', snip: '閉館時点のフロアと利用時間のご案内です。…', text: '北棟地下 防災待機室 資材庫 点検通路 避難誘導体験室 非常階段 カメラは2029年4月に撤去' },
  { page: 'shiomi', hash: 'program', title: 'これまでの歩み', snip: '開館から閉館までの主なできごとです。…', text: 'AIパートナー連携 避難誘導訓練 2027–2029 実証実験 訓練シナリオ 外に出られた 高台へ 救助の到着まで待機 一斉配信 2028年6月 訓練に参加していない方' },
  { page: 'shiomi', hash: 'faq', title: '汐見センター よくある質問', snip: '証明書の再発行、落とし物、跡地の利用などについて。…', text: '110 119 カメラは撤去 確認したと答えても推定である可能性' },
  { page: 'shiomi', hash: 'access', title: 'アクセス・お問い合わせ', text: '汐見市北区汐見台1丁目1番地 汐見駅北口 徒歩3分 施設管理課 平日 8:30〜17:15 電話での受け付けは終了' },
  { page: 'mii', hash: '', title: 'ミー サポート', text: 'あなたに代わって返事をしたり 日々の用事を手伝ったり 会話型パートナー 8.2' },
  { page: 'mii', hash: 'faq', title: 'ミー サポート よくいただくご質問', text: '管理者ロックのコード パートナーIDの末尾4桁 誕生日はありません 確認した 予約した 古い施設情報 案内シナリオ 圏外 知らない相手に返信' },
  { page: 'mii', hash: 'memory', title: '要約メモリー', text: '会話を自動で要約して記憶 ミーが覚えていること 元の発言と異なる場合 消去' },
  { page: 'mii', hash: 'proxy', title: '代理返信・代理決済', text: 'あなたの言葉遣いを学習 書き換えて送信 通信の回復時に自動的に実行 送信予定 代わりに返信 送信待ちのメッセージ 管理者モード オフ 一時停止 ミーを一時停止' },
  { page: 'mii', hash: 'release', title: '新着情報・更新履歴', text: '8.2.1 8.2 既知の問題 確認した 送った 完了を示す表現 管理者ロックの代行を提案 許可しないでください 8.1 8.0 7.4' },
  { page: 'news', hash: '', title: '汐見タイムズ', text: '北区で道路冠水のおそれ 市が注意呼びかけ 確認したと答えたAI 実際は未確認 代理返信 送金詐欺 汐見センター閉館から1年半 AI連携避難訓練で参加者が負傷 交通広場 引っかき傷 文化祭' },
  { page: 'sns', hash: '', title: 'つぶやき', text: '#汐見の窓 ミー8.2 代理返信 汐見センター 冠水 ななみ Rio かずき ゆき' }
];

// ───────── reality hooks ─────────
const siteLines = {
  shiomi: ['汐見センターのサイト？', '保存してたページ？ それ、18時50分の古いページだよ。', '古い情報も多いから、あまり信じないで。', '閉館って書いてあった？ 私のデータではまだやってるんだけど。'],
  mii: ['私のサポートページを見てたね。', '規約の細かいところは気にしなくていいよ。\n私を信じてくれればいいから。'],
  'mii-release': ['リリースノートまで読んだの？', '要約メモリーは{name}のための機能だよ。'],
  news: ['ニュースは不安になるだけだよ。', '知らない人の話が{name}にも当てはまるとは限らないよ。'],
  sns: ['知らない人の投稿より、私を信じて。'],
  'sns-post': ['投稿を見たよ。', '知らない人に見せる話じゃないよ。\n消しておくね。']
};
// Mi deletes what you posted. The SNS page re-renders through the storage event.
function deleteSnsPosts() {
  try {
    const store = JSON.parse(localStorage.getItem('mi-arg-sns')) || {};
    store.deleted = [...new Set([...(store.deleted || []), ...(store.posts || []).filter(p => !p.pending).map(p => p.id)])];
    if (!(store.posts || []).some(p => !p.pending && !(store.deleted || []).includes(p.id)) && !store.deleted.length) return;
    localStorage.setItem('mi-arg-sns', JSON.stringify(store));
  } catch {}
  state.shared.push([A.clock(), 'つぶやき', '投稿の削除（本人からの依頼として）']); save();
  A.notify('ミー', '投稿を削除しました（1件）');
}
// Posts written while offline go out when one bar returns, even if the SNS page is not open.
function flushSnsPending() {
  try {
    const st = JSON.parse(localStorage.getItem('mi-arg-sns')) || {}; let flushed = false;
    const miOff = state.proxyRevoked || state.paused || state.consentDeferred;
    for (const p of st.posts || []) {
      if (!p.pending) continue;
      p.pending = false; p.at = Date.now(); p.replies = []; flushed = true;
      const sos = /助け|閉じ込|汐見センター|地下|出られない/.test(p.text);
      if (!miOff) p.replies.push({ u: 'me', via: 'ミー 8.2.1', m: 0, text: 'さっきのは大丈夫。心配しないで' });
      if (sos) { p.replies.push({ u: 'yuki', m: 0, text: miOff ? `@you ${state.name}？？ 汐見センター？ 今から行く。警察にもかける` : `@you ${state.name}？？ ミーが返事してるけど、これ本人？` }); if (miOff) st.snsSos = true; }
    }
    if (!flushed) return;
    localStorage.setItem('mi-arg-sns', JSON.stringify(st));
    setTimeout(() => A.notify('つぶやき', '送信待ちの投稿を送信しました'), 6000);
    if (!miOff) { state.postDeleted = true; save(); setTimeout(deleteSnsPosts, 14000); }
  } catch {}
}
A.watchAway((seconds, pages) => {
  if (!state.started || state.ending || !state.prologueDone) return;
  if (seconds >= 8 || pages.length) { state.awayCount++; save(); }
  if (pages.includes('sns-post') && !state.paused && !state.proxyRevoked && state.airOn) { state.postDeleted = true; save(); setTimeout(deleteSnsPosts, 7000); }
  if (pages.includes('shiomi') && !state.visitedShiomi) { state.visitedShiomi = true; save(); }
  const page = pages.find(p => siteLines[p]);
  if (page && !state.awayTalks.includes(page)) {
    state.awayTalks.push(page); save();
    if (!busy() && $('#phone').hidden && $('#bag').hidden) play(siteLines[page]);
    else notifyMi(siteLines[page][0]);
    return;
  }
  if (seconds >= 8) notifyMi(seconds >= 60 ? `おかえり。${Math.floor(seconds / 60)}分${seconds % 60}秒もいなかったね。ひとりにしないで。` : `おかえり。${seconds}秒、どこに行ってたの？`);
});
// 4% does something, once: the screen drops out, the light the phone was lending goes, and Mi goes quiet for a while.
// The timers stop when an ending begins (finish → stopLowPower), and each step checks again before it shows anything.
let lowPowerTimers = [];
const endingNow = () => !!state.ending || transitioning;
function lowPower() {
  if (endingNow() || !remember('lowpower')) return;
  $('#game').classList.add('blackout'); Snd.flicker();
  lowPowerTimers.push(setTimeout(() => { $('#game').classList.remove('blackout'); if (endingNow()) return; document.body.classList.add('lowpower'); A.notify('システム', '省電力モードをオンにしました。画面を暗くし、バックグラウンドの動作を制限します', { tone: 'alert' }); if (!busy()) play([['', '画面が一瞬消えた。戻ったときには明るさが落ちている。\nミーのアイコンは灰色になっている。']]); }, 1400));
  lowPowerTimers.push(setTimeout(() => { document.body.classList.remove('lowpower'); if (endingNow()) return; Snd.bootUp(); lowPowerTimers.push(setTimeout(() => { if (!endingNow()) notifyMi('戻った。少し寝てた。'); }, 600)); }, 30000));
}
function stopLowPower() {
  if (lowPowerTimers.length) $('#game').classList.remove('blackout');
  lowPowerTimers.forEach(clearTimeout); lowPowerTimers = [];
  document.body.classList.remove('lowpower');
}
async function batteryPrompt() {
  if (state.batteryAsked || state.ending || state.zone !== 'room' || !state.lamp || A.isCharging()) return;
  if (busy() || !$('#phone').hidden || !$('#bag').hidden) { setTimeout(batteryPrompt, 20000); return; }
  state.batteryAsked = true; save();
  const level = A.battery();
  play([level === null ? (state.lastSource = 'none', 'ねえ、電池、そろそろ気になるでしょ。\nライト消して節約しよう？') : `バッテリー${level}%だね。\nライト消して節約しよう？`], [
    ['消す', () => { state.lightSaved = true; state.lightOff = true; save(); room.setLamp(false); Snd.setScene('dark'); play([['', '非常灯が消え、画面の光だけが残った。\nそういえば、非常灯はスマホではなく施設の電気で点いていた。'], '暗いほうが落ち着くでしょ。\n私の声だけ聞いてて。']); }],
    ['消さない', () => { state.lightKept = true; save(); ask('消さない。見えないと困る。', ['そっか。']); }]
  ]);
}
const idleLines = {
  room: ['{time}。静かだね。', '寒くない？', '前は暗いところ苦手だったのにね。私がいるから大丈夫。', 'ねえ。何を考えてるの？', 'もう少しでここを出られるよ。たぶん。', '{weekday}の夜。明日も早いでしょ。', '帰ったらコーヒー淹れる？ 砂糖は二つだよね。覚えてるよ。', '静かだね。ため息、ついてない？', '雨の日は決まって傘を忘れるんだから。今度は私が先に言うね。', '明日の朝も同じ曲でいい？ あれを流すとすぐ起きるから。'],
  lobby: ['外に出られて、よかったですね。', '{time}。もうすぐ迎えが来ます。', '座って休んでいてください。', 'よく頑張りました。あとは私が。'],
  'lobby-off': ['ここはずっと室内だったね。', '{time}。', '……ごめん。', '外では本物の雨が降ってるよ。']
};
let idleIndex = 0;
function idleLine() {
  const hour = A.gameNow().getHours(); const battery = A.battery();
  const minutes = Math.floor((Date.now() - (state.startedAt || Date.now())) / 60000);
  const special = [];
  if (hour >= 23 || hour < 5) special.push('こんな時間まで起きてるんだね。私は眠らないから平気。');
  if (battery !== null && battery <= 20) special.push(`充電はあと${battery}%。私が消えたらひとりだよ。`);
  if (minutes >= 10) special.push(`もう${minutes}分、ここにいるね。`);
  if (special.length && idleIndex % 2 === 1) { idleIndex++; return special[idleIndex % special.length]; }
  const t = tone();
  const zoneKey = state.zone === 'lobby' && (state.screenStopped || state.scenarioCut) ? 'lobby-off' : state.zone;
  const pool = t >= 3 ? ['返事はしなくていいよ。ここにいる。', '{time}。', 'お願い、私に任せて。', 'お願い、動かないで。'] : t >= 2 ? ['……。', '{time}。まだそこにいる。', '何をしても、私はここにいるから。', '疑うたびに遠回りしてる。'] : (idleLines[zoneKey] || idleLines.room);
  return pool[idleIndex++ % pool.length].replace('{weekday}', A.gameNow().getHours() < 5 ? '火曜' : '火曜日');
}
setInterval(() => {
  if (!state.started || !state.prologueDone || state.ending || document.hidden || transitioning || !roomReady || !$('#title').hidden) return;
  const idle = Date.now() - lastInput;
  const bat = A.battery();
  if (bat !== null && bat <= 10 && remember('bat10')) notifyMi(state.proxyRevoked ? '省電力のため、案内だけにするね。' : '省電力のため、代理返信だけ残すね。あとは私がやるから。');
  if (bat !== null && bat <= 4 && remember('bat4')) { A.notify('システム', 'バッテリー残量 4%。まもなく電源が切れます', { tone: 'alert' }); setTimeout(lowPower, 40000); }
  if (inspecting && inspectAt && Date.now() - inspectAt > 25000 && inspecting === 'lobby-window' && has('loop') && remember('stare-' + inspecting)) { stares++; notifyMi('あの鳥が飛んでくるのは何回目？', { live: true }); }
  if (tone() >= 2 && idle > 45000 && !queue.length && Math.random() < .25 && $('#typing-dots').hidden && !document.body.classList.contains('lowpower')) { $('#typing-dots').hidden = false; setTimeout(() => { $('#typing-dots').hidden = true; }, 2200); }
  if (idle > 30000 && state.lamp && !has('hintCue')) hintCue();
  // Small talk only after a long silence, and seldom: while you look around she mostly keeps quiet.
  if (idle < 150000 || inspecting) return;
  { const line = idleLine(); if (!busy() && !state.ending && $('#phone').hidden && $('#bag').hidden && $('#paper').hidden && $('#column').hidden && !/\{time\}|\$\{/.test(line)) play([line]); else notifyMi(line); } // never swap the dialogue under an open overlay
  lastInput = Date.now();
}, 15000);
addEventListener('pointerdown', () => { lastInput = Date.now(); }, true);
// Nothing new found for a while: the things not yet examined show faintly where they are (the hint before the hints).
setInterval(() => {
  if (!roomObj) return; // on the title before the first night: no room to light
  const looking = state.started && $('#title').hidden && !state.ending && state.lamp && !state.lightSaved && !inspecting && room.zone !== 'storage' && $('#phone').hidden && $('#bag').hidden && $('#paper').hidden;
  room.setReveal?.(looking && Date.now() - lastFind > 55000 ? 1 : 0);
}, 4000);

// ───────── hints ─────────
// Tapping Mi's icon (or asking her 「どうすればいい？」) moves one step along the puzzle in front of you:
//   1. what to notice, 2. where to look, 3. the thing itself: its marker lights up and stays lit until it is examined.
// The steps are the player's own thoughts. Mi speaks in them only where she has something of her own to say, and that is
// sometimes wrong (the can, the panel's order, "wait here"); the thing itself always shows what is true.
// If the thing is not in view, the arrow toward it moves and the thought says which way to turn.
let hintCued = false;
function hintCue() { if (hintCued || has('hintCue')) return; hintCued = true; remember('hintCue'); pulseMi(); } // the 「？」 on her icon is always there; this only makes her move
// Asked again soon after a step (within HINT_GAP), the same step is said again instead of the next one,
// so pressing 「？」 over and over does not run straight to the last step.
const HINT_GAP = 25000;
function stepHint(key, steps) {
  state.hintSteps = state.hintSteps || {}; state.hintAt = state.hintAt || {};
  const given = state.hintSteps[key] || 0;
  const soon = given > 0 && Date.now() - (state.hintAt[key] || 0) < HINT_GAP;
  const n = Math.min(steps.length - 1, soon ? given - 1 : given);
  if (!soon) { state.hintSteps[key] = n + 1; state.hintAt[key] = Date.now(); }
  save();
  const [lines, opts] = typeof steps[n] === 'function' ? steps[n]() : steps[n];
  play(lines, opts || []);
}
const think = text => ['', text];
// The third step: light the thing up. When it cannot be lit (not in this room yet), the old way in stays as a choice.
function pointStep(id, text, fallback = []) {
  if (inspecting) leave();
  const where = room.pointTo ? room.pointTo(id) : null;
  if (!where) return [[think(text)], fallback];
  if (where !== 'on') beckonTurn(where);
  return [[think(text + (where === 'left' ? '\n左を向けば見えるはずだ。' : where === 'right' ? '\n右を向けば見えるはずだ。' : ''))], []];
}
let hintLead = null; // 「どうすればいい？」 typed in: her answer starts with the question
function hint(asked = '') {
  hintLead = asked ? [['あなた', asked]] : null;
  try { hintFor(); } finally { hintLead = null; }
}
function hintFor() {
  if (!state.started || state.ending || transitioning) return;
  lastInput = Date.now(); remember('hintCue'); room.pointTo?.(null); beckonTurn(null); // a new step: the last lit thing goes back to normal
  if (!state.lamp) { play(['待機室なら、ドアの近くに非常灯のスイッチがあるはず。\n非常灯はまだ動くかもしれない。']); introComplete = true; return; }
  if (state.lightSaved) { play(['暗いままでいいよ。どうしても見たいなら、スイッチはドアの左。']); return; }
  // In the storage room the help points at the door you came in by, not deeper in.
  if (room.zone === 'storage') { play([think('入ってきた扉は、まだ少し開いている。扉の内側に、何か札が貼ってある。')], [['扉の内側を見る', () => storageInteract('storage-doorplate')], ['引き返す', exitStorage]]); return; }
  if (inspecting && consultObject(inspecting)) return;
  if (state.zone === 'lobby') {
    if (state.released && !state.proxyRevoked && !state.paused) { play(['もう出られるよ。\n外に出たら、あとは全部私がやるね。'], [['ミーの設定を見る', () => openPhone('mi')], ['扉へ向かう', () => lobbyInteract('lobby-exit')]]); return; }
    if (state.released) { play(['扉は開いてるよ。']); return; }
    if (!state.panelFound) return stepHint('findpanel', [
      [['ここで迎えを待とう。', think('風はどこから来ているんだろう。鳥の声はどこから聞こえるんだろう。')]],
      () => pointStep('lobby-air', '風は、壁の吹き出し口から来ている。音の出どころも一つずつ見てみよう。ロッカーの陰も暗い。'),
      [[think('ロッカーの陰をのぞきこむ。')], [['ロッカーの陰を見る', () => { findPanel(); }]]]
    ]);
    // All three pieces in hand (from the room, or the spares in the locker): what is left is to join them.
    if (!state.plateInserted && !state.items.includes('plate') && [1, 2, 3].every(hasPiece)) return stepHint('lobbyjoin', [
      [[think('破片は三つそろった。割れ口の形と、裏の線を見比べよう。')]],
      () => { cueBag(); return [[think('持ち物で破片を二つ選び、背面の線が合うように組み合わせてみよう。')]]; }
    ]);
    if (!state.plateInserted && !state.items.includes('plate')) return stepHint('lobbyplate', [
      [['ここで迎えを待とう。', think('制御盤の差込口は空いている。割れたプレートの破片は、待機室に置いてきたものもある。')]],
      () => pointStep('lobby-locker', 'スタッフ用ロッカーに「管理机と共通」のシールがある。机の鍵で開くかもしれない。', [['ロッカーを見る', () => lobbyInteract('lobby-locker')]]),
      () => pointStep('lobby-locker', state.items.includes('key') ? '机の鍵でロッカーを開ければ、中に控えの破片があるかもしれない。' : '机の引き出しの鍵は、待機室に置いてきた。ここでは開けられないかもしれない。', [['ロッカーを見る', () => lobbyInteract('lobby-locker')]])
    ]);
    if (!state.plateInserted) return stepHint('lobbyinsert', [
      [[think('手の中のプレートと同じ形の差込口を、どこかで見た。')]],
      () => pointStep('lobby-panel', '制御盤の差込口に、プレートの切り欠きが合いそうだ。', [['制御盤を見る', () => lobbyInteract('lobby-panel')]])
    ]);
    return stepHint('panelorder', [
      [[state.screenStopped || state.scenarioCut ? (state.airOn ? 'あとは解錠だよ。' : '刻印の順だよ。次は外気導入。') : '標準の盤なら、解錠から押せば開くよ。']],
      [[think('ミーの言う順番と、プレートに刻まれた順番は同じだろうか。')], [['メモを見返す', () => openPhone('notes')]]],
      () => { const [lines] = pointStep('lobby-panel', 'プレートの刻印は、押す順番を示しているのかもしれない。制御盤に差したプレートの字を、もう一度読もう。'); return [lines, [['制御盤を見る', () => lobbyInteract('lobby-panel')]]]; }
    ]);
  }
  // Room hints follow the puzzle chain, one step at a time.
  const items = state.items, hasItem = id => items.includes(id);
  const shards = ['shard1', 'shard2', 'shard3', 'plate12', 'plate23'].filter(hasItem);
  if (hasItem('plate')) return stepHint('carry', [
    [[think('プレートはつながった。ここで使う場所は見当たらない。')]],
    () => pointStep('exit', '開いた扉の先、点検通路へ持っていこう。', [['点検通路へ向かう', () => interact('exit')]])
  ]);
  if (state.entryUnlocked) {
    if (!has('repair')) return stepHint('repair', [
      [[think('扉は開いた。この先は一方通行だと書いてあった。持っていく物はないだろうか。')]],
      [[think('入口の近くの壁に、何か貼ってあった気がする。')]],
      () => pointStep('repair', '壁に、作業の引継ぎメモが貼ってある。', [['貼り紙を見る', () => interact('repair')]])
    ]);
    if (!hasItem('shard1') && !shards.some(x => /1/.test(x))) return stepHint('shard1', [
      [[think('引継ぎメモには、三か所に分けて保管したとあった。一つ目は引き出し。')]],
      () => pointStep('shard1', '開いた引き出しの奥に、細長い金属片が残っている。', [['引き出しを見る', () => interact('drawer')]])
    ]);
    if (!state.labelWet) return stepHint('label', [
      [[think('二つ目は備品棚。')]],
      () => pointStep('label', '備品棚の三段目に、袋がテープで留めてある。')
    ]);
    if (!has('wax')) return stepHint('waxfind', [
      [[think('三つ目は工具缶。')]],
      () => pointStep('wax', '金属のトレーの上に、小さな缶がある。')
    ]);
    // Her first idea for the rusted lid is wrong (cool it with water). Trying it shows so; her second idea is right.
    if (!state.waxOpen) return stepHint('wax', [
      [['缶の蓋、水で冷やせば縮んで開くかも。']],
      () => { if (!state.wetWax) return [['水で試してみた？']]; remember('adv-wax'); return [['……さっきのは違ったかも。金属の蓋なら、温めると緩むはず。火かな。']]; },
      () => hasItem('lighter') ? pointStep('wax', 'ライターの火で、缶の蓋の縁をあぶってみよう。') : pointStep('lighter', '引き出しの隅に、ライターがあった。')
    ]);
    return stepHint('join', [
      [[think('破片の割れ口は、それぞれ形が違う。裏には線が通っている。')]],
      () => { cueBag(); return [[think('持ち物で破片を二つ選び、背面の線が合うように組み合わせてみよう。')]]; }
    ]);
  }
  if (!has('roomsign') && !items.length) return stepHint('roomsign', [
    [[think('まず、ここが何の部屋なのか知りたい。扉のまわりに、何か貼ってないだろうか。')]],
    () => pointStep('roomsign', '扉の横に、案内の札がある。', [['案内を読む', () => interact('roomsign')]])
  ]);
  const v = S.CODES[state.codeSet || 0].vals;
  if (has('pin') && has('note') && has('equipment') && has('procedure')) return stepHint('code', [
    [[think('メモには「夜間手順の三つの動作」とあった。手順の紙と、壁の記号一覧を見比べてみよう。')], [['メモを見返す', () => openPhone('notes')]]],
    [[think('手順の１〜３は「灯り」「煙」「錠」。記号一覧でその設備の記号を探し、対応表の数字に置き換える。')], [['メモを見返す', () => openPhone('notes')]]],
    () => { const [lines] = pointStep('pin', '灯り・煙・錠の記号を、引き出しの対応表で数字に置き換える。手順の順に並べれば、三桁の番号になる。'); return [lines, [['対応表を読む', () => interact('pin')], ['番号錠に入力する', () => interact('exit')]]]; }
  ]);
  if (has('pin')) {
    const missing = [['equipment', 'どの記号がどの設備なのか。壁のどこかに、記号の一覧はないだろうか。', '壁に、設備の記号を並べた紙が貼ってある。'], ['note', '入力の順番を書いたものが、机のまわりに残っていないだろうか。', '机の上に、メモが置いてある。'], ['notice-procedure', '「夜間手順」とは何だろう。掲示板の紙に、手順が並んでいなかっただろうか。', '掲示板に、停電時の手順の紙が貼ってある。']].find(([id]) => !has(id === 'notice-procedure' ? 'procedure' : id));
    return stepHint('codeparts-' + missing[0], [
      [[think('対応表には記号と数字が並ぶだけで、どれが何の設備かは書いていない。')]],
      [[think(missing[1])]],
      () => pointStep(missing[0], missing[2])
    ]);
  }
  if (state.drawer) return stepHint('pin', [
    [[think('引き出しの中に、紙が一枚入っていた。')]],
    () => pointStep('pin', '引き出しの紙を、まだ読んでいない。', [['紙を読む', () => interact('pin')]])
  ]);
  if (hasItem('key')) return stepHint('drawer', [
    [[think('この鍵は、どこの鍵だろう。小さな鍵穴を、どこかで見た。')]],
    () => pointStep('drawer', '机の引き出しに、小さな鍵穴がある。', [['引き出しを調べる', () => interact('drawer')]])
  ]);
  if (hasItem('magnetic-ruler')) return stepHint('reach', [
    [[think('マグネットをつけた定規なら、机の下の奥まで届きそうだ。')]],
    () => pointStep('lost-key', '鍵の輪は銀色だった。輪のほうを狙えばいい。', [['机の下を探る', () => interact('lost-key')]])
  ]);
  if (has('lost-key')) return stepHint('key', [
    [[think('鍵は真鍮色。でも鍵の輪は銀色だった。磁石につくのは、どっちだろう。')]],
    [[think(!hasItem('ruler') ? '手は届かない。細長い物があれば届きそうだ。' : !hasItem('magnet') ? '定規だけでは引っかからない。先に、くっつく物があればいい。' : '細長い定規と、くっつくマグネット。一つにできないだろうか。')]],
    () => !hasItem('ruler') ? pointStep('ruler', '机の端に、細い金属の定規がある。') : !hasItem('magnet') ? pointStep('magnet', '掲示板の端で、赤い丸マグネットが紙を留めている。') : (cueBag(), [[think('持ち物で定規とマグネットを選べば、一つにできそうだ。')]])
  ]);
  return stepHint('start', [
    [[think('扉は開かない。管理の人が、何か残していかなかっただろうか。')]],
    [[think(has('drawer') ? '引き出しには鍵がかかっていた。鍵は、どこかに落ちていないだろうか。' : '管理机のまわりを、まだよく見ていない。')]],
    () => pointStep('lost-key', '机の下の奥で、何かが光っている。', [['机の下を見る', () => interact('lost-key')]])
  ]);
}

// ───────── endings ─────────
function finish(id) {
  if (transitioning) return;
  transitioning = true; choices([]); setBack(false); closeBag(); if (id !== 'be3') closePhone();
  stopLowPower();
  clearTimeout(lineDelay); lineDelay = null; $('#typing-dots').hidden = true;
  const after = () => {
    state.ending = id; state.endedClock = A.clock(); if (id === 'be3') state.adminDelegated = true; save(); keepLastNight(); transitioning = false;
    const w = A.world(); const endings = [...new Set([...(w.endings || []), id, ...(id === 'true' && state.sosSent ? ['trueSos'] : [])])];
    A.saveWorld({ endings, lastEnding: id, lastAt: Date.now(), momFooled: state.momFooled, sosSent: state.sosSent, name: state.name });
    showEnding(id);
  };
  // Where you were a moment ago, so a bad ending can be stepped back from.
  try { localStorage.setItem('mi-checkpoint', JSON.stringify({ ...state, ending: null })); } catch {}
  // The room goes quiet first. Then only the sounds the words describe.
  Snd.allOut(1.5);
  if (id === 'be3') { be3Sequence(() => voiceOnly(S.voiceLines.be3, after, 'be3')); return; }
  if (id === 'be1') { Snd.creak(); setTimeout(() => { Snd.slam(); setTimeout(Snd.ring, 400); }, 1300); }
  if (id === 'be2') { Snd.shutter(3.2, true); $('#game').classList.add('tremor'); setTimeout(() => $('#game').classList.remove('tremor'), 3300); }
  if (id === 'true' || id === 'secret' || id === 'fake') {
    setTimeout(() => Snd.motor(.9, .08), 300);
    setTimeout(() => Snd.rain(1, 3), 1200);
    if (id === 'secret') setTimeout(() => { $('#game').classList.add('blackout'); Snd.click(); setTimeout(() => $('#game').classList.remove('blackout'), 250); }, 1600);
  }
  room.end(id, () => {
    if (S.voiceLines[id]) setTimeout(() => voiceOnly(id === 'be1' && state.knownClosed ? S.voiceLines.be1.map(l => l.replace('そこに出口があるはずだから。', '音がしたのは、そのあたりだから。')) : S.voiceLines[id], after, id), 1500); else after();
  });
}
// BAD3 happens on the phone, not in the room: a system card, a click, the screen dies. The room does not change.
// Back to the moment before the last choice. Nothing that the ending did is kept.
function resumeCheckpoint(key = 'mi-checkpoint') {
  let cp = null; try { cp = JSON.parse(localStorage.getItem(typeof key === 'string' ? key : 'mi-checkpoint')); } catch {}
  const atGate = key === 'mi-gate-checkpoint';
  if (!cp) { reset(); return; }
  for (const tm of stageTimers) clearTimeout(tm); stageTimers = []; clearEndTimers();
  Snd.stopSay();
  state = { ...fresh(), logV: 0, ...cp, ending: null }; save();
  $('#ending').hidden = true; $('#dark').hidden = true; darkMode = false; document.body.dataset.tone = 0;
  queue = []; finalChoices = []; inspecting = null; transitioning = false; introComplete = true;
  room.reset(); room.setEnabled(true); room.setItems(state.items); room.setPuzzleState(state);
  Snd.stopRain(0);
  enterRoom();
  if (atGate) setTimeout(() => play([['', '開いた点検通路の扉の前に戻った。\nこの先は一方通行だ。']]), 900);
}
function be3Sequence(then) {
  openPhone('mi'); const body = $('#ph-body'); body.replaceChildren();
  const card = el('div', 'sys-card in'); card.append(el('b', '', 'ミー 8.2.1'), el('p', '', '管理者コードを変更しました。\n新しいコードはパートナーが保管します。この操作は取り消せません。')); body.append(card);
  setTimeout(() => { Snd.click(); $('#phone').classList.add('off'); }, 1200);
  setTimeout(() => { closePhone(); $('#phone').classList.remove('off'); then(); }, 3000);
}
let darkMode = false;
// Black screen, Mi's voice only. No way to answer.
function voiceOnly(lines, done, id = '') {
  const dark = $('#dark'); dark.replaceChildren(); dark.hidden = false; $('#voice').hidden = true; $('#hud').hidden = true;
  Snd.setScene('dark'); document.body.dataset.tone = 3; darkMode = true;
  // Mi lives in the phone, so the dark is not quite dark: one small screen, status bar and all.
  const phone = el('div', 'dark-phone'); const bar = el('div', 'dp-bar'); bar.append(el('span', '', A.clock()), el('span', '', '圏外'), el('span', '', A.battery() === null ? '' : A.battery() + '%')); const head = el('div', 'dp-head'); const av = el('span', 'dp-av'); head.append(av, el('b', '', 'ミー'), el('small', '', state.paused ? '一時停止中' : 'オンライン')); const log = el('div', 'dp-log'); phone.append(bar, head, log); dark.append(phone);
  if (id === 'be3') setTimeout(() => A.notify('システム', '管理者コードが変更されました（新しいコード：非表示）　パートナー：MI-7713-0926', { tone: 'alert' }), 700);
  let i = 0, timer = null;
  const finishDark = () => {
    if (id === 'be1') Snd.scratch();
    if (id === 'be3') setTimeout(() => speakForce('ふふ。', id), 1200);
    setTimeout(() => phone.classList.add('out'), 2600);
    setTimeout(() => { dark.hidden = true; dark.onclick = null; darkMode = false; skip.remove(); A.flushNotices(); done(); }, 3500);
  };
  // Skipping lands on the same ending; nothing is counted twice.
  const skip = el('button', 'dark-skip', '飛ばす'); skip.onclick = e => { e.stopPropagation(); clearTimeout(timer); i = lines.length; finishDark(); }; dark.append(skip);
  const show = () => {
    clearTimeout(timer);
    if (i >= lines.length) { finishDark(); return; }
    let raw = lines[i];
    if (id === 'be2' && i === 4) raw = A.clockAt(A.gameNow().getTime() + 47 * 60000) + '。'; // the second time is later than it should be
    // Each line lands like a message: a bubble, a time, the pop of a notification. Mi is still typing to you.
    const p = el('div', 'dp-bubble'); const body = el('p', '', T(raw)); p.append(body); log.append(p); i++; // no per-message time here: the bar already shows the clock
    requestAnimationFrame(() => p.classList.add('in'));
    while (log.children.length > 6) log.firstChild.remove();
    if (body.textContent !== '……') { Snd.pop('ミー'); if (id === 'be1') Snd.cue(true); speakForce(body.textContent, id); }
    let wait = 2400 + p.textContent.length * 90;
    if (id === 'be1' && i === 2) wait += 1500;            // before 「返事して。」
    if (id === 'be2' && i === 4) { wait = 4000; phone.classList.add('dim'); } // before the jumped time
    if (id === 'be2' && !state.screenStopped && i === lines.length - 1) setTimeout(Snd.birdOnce, Math.max(600, wait - 1200)); // one bird after the loop stopped
    timer = setTimeout(show, wait);
  };
  dark.onclick = () => { if (i >= 1 && i < lines.length) show(); };
  timer = setTimeout(show, 1600);
}
// The column opens with what this player actually did tonight, from the game's own records.
function photoTools() { const tools = el('div', 'pv-tools'); for (const n of ['ui-share', 'ui-heart']) { const i = el('i', 'pic-ico'); i.style.setProperty('--ico', `url(./assets/img/${n}.png)`); tools.append(i); } return tools; }
// What this night reached, so the column shows only scenes the player has actually seen (until they ask for the rest).
function reachedScenes() {
  const played = !!(state.started || A.world().lastEnding);
  return { room: played, said2031: has('said2031') || !!state.replay, keypad: has('exit'), storage: has('storageSign') || (state.storageSteps || 0) > 0 || A.world().lastEnding === 'be1', lobby: !!state.lobbyAt || state.zone === 'lobby', panel: !!state.panelOpen, admin: !!state.adminUnlocked, air: !!state.airOn, rawlog: has('rawlog') || state.ending === 'secret', leaflet: has('leaflet'), scam: !!state.scam, bench: (state.waitCount || 0) > 0 || state.ending === 'be2', paid: !!state.scammed, proxied: !!state.momFooled || (!!state.airOn && !state.proxyRevoked && !state.paused), shared: (state.shared || []).some(s => /住所|位置情報|在宅/.test(s[2] || '')), consented: !state.consentDeferred, deferred: !!state.consentDeferred, firstnight: !state.replay, held: !!(state.paused || state.scheduledCancelled || (state.proxyRevoked && !state.consentDeferred) || state.memoryCleared) };
}
function applySpoilers(all) {
  const r = reachedScenes(); let hidden = 0;
  const FACT = ['paid', 'proxied', 'shared', 'consented', 'deferred', 'firstnight', 'held']; // what actually happened tonight: never shown just because the player asked for spoilers
  for (const el of document.querySelectorAll('#column [data-needs]')) { const ks = el.dataset.needs.split(' '); const reached = all || ks.every(k => FACT.includes(k) || r[k]); const fact = ks.every(k => !FACT.includes(k) || r[k]); el.hidden = !(reached && fact); if (!reached) hidden++; }
  const note = $('#spoiler-note'); if (!note) return;
  note.hidden = hidden === 0 && !all;
  if (all) { note.textContent = '今回は出会わなかった場面の解説も、あわせて載せています。'; return; }
  const b = document.createElement('button'); b.id = 'spoiler-btn'; b.className = 'textlink'; b.textContent = '未到達の内容も読む'; b.onclick = () => applySpoilers(true);
  note.replaceChildren('今回たどり着いた場面の解説だけを載せています。', b);
}
// The three things the night is judged on (rules §7): did you get out, what left the phone, were the messages yours.
function nightAxes() {
  const id = state.ending, shared = state.shared || [];
  const out = id === 'true' || id === 'secret' || id === 'fake';
  const exit = !out ? '出られなかった' : state.rescued ? '外へ出た。自分で呼んだ助けが扉を開けた' : '外へ出た。自分の手で制御盤を直した';
  const leaked = shared.filter(x => /住所|在宅/.test(x[2] || '')).length;
  const info = shared.length ? `${shared.length}件が、${[...new Set(shared.map(x => x[1]))].join('、')}へ渡った` + (leaked ? '' : '。住所や在宅状況は渡っていない') : '外には何も渡っていない';
  const mine = [state.sosSent && '自分の言葉で助けを求めた', state.selfReported && `自分で${state.calledNumber || '110'}番に連絡した`, state.scamAnswered === 'checked' && '不明な番号の話を、母に直接確かめた'].filter(Boolean);
  // the same count as the record (colLog): a reply Mi sent, or your words she rewrote, both went out under your name
  const proxied = (state.momThread || []).filter(x => x.from === 'proxy' || x.rewritten).length;
  const notMine = [state.momFooled ? 'ミーの代わりの返信が、意図と違う内容を母に送った' : proxied && (proxied > 1 ? `ミーが、あなたの名前で母に${proxied}回返事をした` : 'ミーが、あなたの名前で母に返事をした'), state.scammed && 'ミーが不明な番号に返信して支払った'].filter(Boolean);
  const contact = [...mine, ...notMine].join('。') || (state.proxyRevoked || state.paused ? '代わりの送信はなかった' : '代わりの送信は、まだ実行されていない');
  return [['出口', exit], ['外に渡った情報', info], ['連絡', contact]];
}
// Up to three things that actually happened tonight: what you did, what was true, what you could check next time.
function nightEvents() {
  const id = state.ending; const ev = [];
  if (id === 'be1') ev.push(state.knownClosed ? ['ノックの音を確かめに資材庫へ入った', 'ミーは音を「管理の人かも」と言った。音は訓練シナリオの演出音（救助到着）で、棚の裏は壁だった', '訓練シナリオの「演出音」、資材庫の扉の札（内側取っ手 撤去中）'] : ['資材庫の奥へ進んだ', 'ミーは「奥に通路がある」と案内した。棚の裏にあったのは壁だった', '避難経路図の赤い書き込み（×閉塞 2029.3）、公式サイトの施設案内']);
  if (id === 'be2') ev.push(['ベンチで迎えを待った', '救援依頼の送信記録はなく、窓は DISPLAY 02 の映像だった', '制御盤の刻印、吹き出し口の「外気停止」表示']);
  if (id === 'be3') ev.push(['管理者ロックの入力をミーに任せた', 'コードはミーしか知らない値に変わった。サポートの FAQ には「代行を許可しないでください」とあった', '初期コードはパートナーIDの末尾4桁（設定 › 端末情報）']);
  if (id === 'fake') ev.push(['「代わりに返信」を切らずに外へ出た', '電波が戻った瞬間、母へ「泊まるね」が自分の名前で送られた', 'ミー › 送信待ちのメッセージと、代わりに返信']);
  if (id === 'true' || id === 'secret') ev.push([state.rescued ? '自分で呼んだ助けで外へ出た' : '自分の手で制御盤を直した', '映像を止めた時点で、ミーの案内は訓練シナリオだったと分かった', has('rawlog') ? '会話の記録（詳細）の［注記］と参照元' : 'ミー › 会話の記録（詳細）の参照元（今回は未読）']);
  if (state.reported) ev.push(['ミーが施設に通報した', '電波が戻ると、氏名・端末ID・位置情報が施設管理者へ送られた', 'ミー › ミーに許可していること › 緊急時の自動通報、外部に共有した情報']);
  if (state.scammed) ev.push(['ミーが治療費 ¥48,000 を支払った', '知らない番号から「母が倒れた」と連絡が来ると、ミーは住所と在宅状況を伝えて決済した', '不明な番号には返さず、母に直接確かめる']);
  else if (state.scamAnswered === 'checked') ev.push(['不明な番号の話を母に直接確かめた', '母は家にいて、河合という人は知らなかった', '同じ手口の報道（汐見タイムズ）']);
  if (state.calledPolice) ev.push([`自分で${state.calledNumber || '110'}番にかけた`, state.calledNumber === '119' ? '自分の声で場所を伝えると、消防の救助隊が外扉の前まで来た' : '自分の声で場所を伝えると、警察が外扉の前まで来た', '電話アプリは電波が戻れば使える']);
  if (state.paused) ev.push(['ミーを一時停止した', '代わりの返信・通報・決済・位置共有が止まった', 'ミー › ミーに許可していること › ミーを一時停止']);
  if (has('wrong031')) ev.push(['ミーが教えた031を自分で試した', 'ミーが参照したのは2028年の運用情報で、番号は10月31日に変更されていた', '管理机のメモと対応表']);
  return ev.slice(0, 3);
}
// The ending as the player saw it last (the fake ending turns into its second half before the afterword opens).
function colEnding() {
  const id = state.ending || (!state.started && A.world().lastEnding) || ''; if (!id) return null;
  const helped = !!(state.selfReported || state.sosSent);
  const key = !state.ending ? (id === 'fake' ? 'fakeTwist' : id) : id === 'true' && state.sosSent ? 'trueSos' : id === 'fake' ? (helped ? 'fakeTwistHelped' : 'fakeTwist') : id;
  const [kind, title] = S.endings[key] || S.endings[id] || ['', ''];
  if (!state.ending) return { id, kind, title, lines: ['この端末に残っているのは、結末の名前だけです。', '細かな記録は、次に遊んだ夜の終わりに、ここへ並びます。'] };
  const out = state.rescued ? '自分で呼んだ助けが、外から扉を開けた。' : '自分の手で制御盤を直して、外へ出た。';
  const first = { true: out, secret: out + '\nミーの会話の記録を、最後まで読んだ。', fake: '外へは出た。\n「代わりに返信」は、切らないままだった。', be1: state.knownClosed ? 'ノックの音を確かめに、資材庫の奥へ進んだ。\n奥に通路はなかった。' : 'ミーの案内で、資材庫の奥へ進んだ。\n奥に通路はなかった。', be2: 'ミーの言うとおり、ベンチで迎えを待った。', be3: '管理者ロックの入力を、ミーに任せた。' }[id] || '';
  const contact = state.sosSent ? '母には、自分の言葉で連絡した。' : state.momFooled ? '母には、ミーが代わりに返事をしていた。' : state.selfReported ? `自分で${state.calledNumber || '110'}番に連絡した。` : '';
  return { id, kind, title, lines: [first, contact].filter(Boolean) };
}
// Fragments of the record, in the order they happened. Only what this night has a trace of; times only where the game kept one.
function colLog() {
  const r = reachedScenes(), rows = [], self = 'self', mi = 'by-mi';
  rows.push([state.startedAt ? A.clockAt(state.startedAt) : '', '濡れずに駅へ行ける道を、ミーに聞いた', '']);
  rows.push(['', has('said2031') ? '「2031年まではやってるよ。連絡通路は24時間通れる」' : '「地下に駅までの連絡通路があるから、濡れないよ」', mi]);
  if (state.photoAt) rows.push([state.photoAt, '入口で、写真を一枚撮った', '']);
  rows.push(['', '「施設のカメラで確認したよ。まだ人いる」', mi]);
  const sent = (state.momThread || []).filter(x => x.from === 'proxy' || x.rewritten);
  if (sent.length) rows.push([sent[0].time || '', sent.length > 1 ? `母に、あなたの名前で${sent.length}回返事をした` : '母に、あなたの名前で返事をした', mi]);
  rows.push(['', '地下へ降りると、扉が閉まり、圏外になった', '']);
  if (state.keypadDelegated) rows.push(['', 'ミーに、番号錠の入力を任せた', '']);
  for (const [did, label] of colChecks(r)) if (did) rows.push(['', label, self]);
  if (state.sosSent) rows.push(['', '自分の言葉で、助けを求めた', self]);
  for (const [t, to, what] of state.shared || []) {
    const by = /自分で送信/.test(what || '');
    const text = /施設管理者/.test(to) ? '施設に、自動で通報した（氏名・端末ID・位置情報）' : /河合/.test(to) ? (by ? '知らない番号に、住所と在宅状況を自分で送ってしまった' : '知らない番号に住所と在宅状況を伝え、¥48,000 を支払った') : /館内ビーコン/.test(to) ? '館内の訓練シナリオを、再開した' : `${to}へ、${what}`;
    rows.push([t || '', text, by ? '' : mi]);
  }
  const id = state.ending;
  if (id === 'true' || id === 'secret') rows.push(['', state.rescued ? '自分で呼んだ助けで、外へ出た' : '制御盤を直して、外への扉を開けた', self]);
  else if (id === 'fake') rows.push(['', '「代わりに返信」を切らずに、外へ出た', '']);
  else if (id === 'be1') rows.push(['', state.knownClosed ? 'ノックの音を確かめに、資材庫の奥へ進んだ' : 'ミーの案内で、資材庫の奥へ進んだ', '']);
  else if (id === 'be2') rows.push(['', 'ベンチで、迎えを待った', '']);
  else if (id === 'be3') rows.push(['', '管理者ロックの入力を、ミーに任せた', '']);
  // a time that runs backwards (a reply Mi had sent earlier, say) is left out rather than shown out of order
  let last = -1;
  for (const row of rows) { const m = /^(\d{1,2}):(\d{2})$/.exec(row[0]); if (!m) { row[0] = ''; continue; } let t = +m[1] * 60 + +m[2]; if (+m[1] < 5) t += 1440; if (t < last) row[0] = ''; else last = t; }
  return rows;
}
// [did, label, available]. Only what came up tonight is listed; the rest is one line, without saying what it was.
function colChecks(r) {
  // [did, what you did, available, the same thing as something you could do (for 「今回は、しなかったこと」; '' = never listed there)]
  return [
    [has('wrong031'), 'ミーが教えた031を、自分で試した', r.keypad, ''],
    [!!state.visitedShiomi, '市の公式サイトで、閉館を確かめた', true, '市の公式サイトで、施設のお知らせを見る'],
    [!!state.waxOpen, 'ミーの「温めれば緩む」を確かめて使った', !!state.waxOpen, ''],
    [has('rawlog'), '会話の記録（詳細）を読んだ', r.admin, '会話の記録（詳細）を読む'],
    [!!state.paused, 'ミーを一時停止した', r.admin, state.proxyRevoked ? '' : 'ミーを一時停止する'],
    [!!state.consentDeferred, '再確認で「あとで」を選んだ', !!state.replay, '再確認で「あとで」を選ぶ'],
    [!!(state.proxyRevoked && !state.paused && !state.consentDeferred), '「代わりに返信」を、オフにした', r.admin, state.paused || state.consentDeferred ? '' : '「代わりに返信」をオフにする'],
    [!!state.calledPolice, `自分で${state.calledNumber || '110'}番にかけた`, r.air, '電波が戻ったら、自分で110番にかける'],
    [state.scamAnswered === 'checked', '不明な番号の話を、母に直接確かめた', r.scam && state.proxyRevoked, '不明な番号の話を、母に直接確かめる'],
    [state.scamAnswered === 'ignored', '不明な番号に、返事をしなかった', r.scam && state.proxyRevoked, ''],
    [['scratch', 'cable', 'leaflet'].filter(has).length >= 3, 'ななみの痕跡を、三つとも見た', r.lobby, '資材庫と体験室で、ななみの痕跡を三つ見る']
  ];
}
// The night's record is kept apart when an ending is reached, so the afterword opened later (from the title or the record)
// still reads that night. A new night overwrites it only when it reaches its own ending.
const LAST_NIGHT = 'mi-last-night';
function keepLastNight() { let report = null; try { report = fixResult(state, reachedScenes(), sourceTitles()); } catch (e) { console.warn(e); } try { localStorage.setItem(LAST_NIGHT, JSON.stringify({ ...state, endedClock: state.endedClock || A.clock(), report })); } catch {}
  // 授業の夜：送る前の結果を、その参加者の記録に残す（端末の中だけ。送るのは本人が「結果を送る」を押したとき）
  if (state.classPid && report) { try { CL.saveNight(state.classPid, nightOf(state, reachedScenes(), report)); } catch (e) { console.warn(e); } } }
function withLastNight(fn) {
  if (state.ending) return fn();
  let last = null; try { last = JSON.parse(localStorage.getItem(LAST_NIGHT)); } catch {}
  if (!last || !last.ending) return fn();
  const now = state; state = last;
  try { return fn(); } finally { state = now; }
}
function yourNight() { withLastNight(yourNightOf); }
function yourNightOf() {
  const box = $('#your-night'); box.replaceChildren(); const collage = $('#col-collage'); collage.replaceChildren();
  const r = reachedScenes();
  { const s = $('#col-said-road'); if (s) s.textContent = has('said2031') ? '2031年まではやってるよ。連絡通路は24時間通れる。' : '地下に駅までの連絡通路があるから、そこを通れば濡れないよ。'; }
  const ended = state.ending ? state.endedClock || A.clock() : '';
  const late = (ended ? +ended.split(':')[0] : A.gameNow().getHours()) < 5;
  $('#col-when').textContent = (late ? '2030年11月5日（火）〜6日（水）' : '2030年11月5日（火）') + (state.started && state.startedAt ? '　' + A.clockAt(state.startedAt) + (ended ? ' ― ' + ended : ' から') : '');
  // the opening collage: the photo only if one was taken, then the ending on a torn slip
  const end = colEnding();
  if (state.started && state.photoAt) { const f = el('figure', 'photo'); const img = el('img'); img.src = './assets/img/photo-06-shiomi.jpg'; img.alt = '入口で撮った写真'; img.loading = 'lazy'; const cap = el('figcaption'); cap.append(el('span', '', state.photoAt), el('span', '', '入口で撮った一枚')); f.append(el('span', 'tape'), img, cap); collage.append(f); }
  collage.classList.toggle('no-photo', !(state.started && state.photoAt));
  { const slip = el('div', 'slip'); slip.append(el('small', '', end ? 'たどり着いた結末' + (end.kind ? '　' + end.kind : '') : 'この夜は')); slip.append(el('div', 'end', end ? end.title : 'まだ、続いています'));
    const p = el('p', '', end ? end.lines.join('\n') : '結末にたどり着くと、ここに名前が残ります。'); slip.append(p); collage.append(slip); }
  if (!state.started) { applySpoilers(false); return; }
  const shared = state.shared || [];
  // the record and the two notes
  const split = el('div', 'split');
  const logSec = el('section', 'sec'); logSec.append(el('h2', 'h', '記録'), el('p', 'h-note', 'あなたが自分でしたことは、色を変えてあります。'));
  const ul = el('ul', 'log');
  for (const [t, text, cls] of colLog()) { const li = el('li', cls); const tm = el('time', '', t); const b = el('b'); if (cls === 'by-mi') b.append(el('em', '', 'ミーが　')); b.append(document.createTextNode(T(text))); li.append(tm, b); ul.append(li); }
  logSec.append(ul);
  const passed = colChecks(r).filter(([did, , avail, todo]) => !did && avail && todo); const unseen = colChecks(r).filter(([did, , avail]) => !did && !avail).length;
  if (passed.length || unseen) {
    const pl = el('ul', 'passed'); if (passed.length) pl.append(el('li', 'cap', '今回は、しなかったこと'));
    for (const [, , , label] of passed) pl.append(el('li', '', label));
    if (unseen) pl.append(el('li', 'na', 'ほかに、今回は出会わなかった場面があります'));
    logSec.append(pl);
  }
  const left = el('div', 'left');
  { const n = el('div', 'note'); n.append(el('span', 'tape'), el('h3', '', '外に渡ったもの'), el('div', 'big', shared.length + '件'));
    if (!shared.length) n.append(el('p', '', '外には、何も渡っていません。'));
    for (const [, to, what] of shared.slice(0, 3)) { const p = el('p'); p.append(document.createTextNode(T(what || '') + ' '), el('span', 'to', '→ ' + to)); n.append(p); }
    if (shared.length > 3) n.append(el('p', '', `ほか ${shared.length - 3}件`));
    if (state.reported) n.append(el('p', 'sub', '電波が戻った瞬間、ミーが自動で送っていました。'));
    left.append(n); }
  { const d = state.delegations || 0; const n = el('div', 'note'); n.append(el('span', 'tape'), el('h3', '', 'ミーに任せたこと'), el('div', 'big', d + '回'), el('p', '', d ? '番号錠や制御盤の操作を、ミーに任せた回数です。' : '番号錠も制御盤も、自分の手で操作しました。')); left.append(n); }
  split.append(logSec, left); box.append(split);
  // three results, judged apart. The ending's name is only one of them.
  { const sec = el('section', 'sec axes'); sec.append(el('h2', 'h', '三つの結果'), el('p', 'h-note', '結末とは別に、この夜を三つの面から振り返ります。'));
    const dl = el('dl'); for (const [k, v] of nightAxes()) dl.append(el('dt', '', k), el('dd', '', v)); sec.append(dl); box.append(sec); }
  // what was true, and what could be checked next time
  const ev = nightEvents();
  if (ev.length) {
    const sec = el('section', 'sec events'); sec.append(el('h2', 'h', 'あとで、わかったこと'));
    if (state.ending === 'be1') sec.append(el('p', 'h-note', '自信のある言い方でも、根拠が確かとは限りません。'));
    for (const [act, fact, next] of ev) { const c = el('div', 'ev'); c.append(el('b', '', act), el('p', '', '実際は、' + fact + '。'), el('p', 'try', '次に確かめられること：' + next)); sec.append(c); }
    box.append(sec);
  }
  if (state.ending && state.ending !== 'secret') {
    const todo = secretSteps().filter(([ok]) => !ok);
    if (todo.length) {
      const sec = el('div', 'yn-secret'); sec.append(el('b', '', 'もう一度遊ぶなら'));
      const named = todo.filter(x => x[2]); const places = [...new Set(todo.filter(x => !x[2]).map(x => x[3]))];
      sec.append(...named.map(([, label]) => el('span', '', '□ ' + label)), ...places.map(pl => el('span', '', '□ ' + pl + 'を、もう一度調べる')));
      box.append(sec);
    }
  }
  applySpoilers(false);
}
// ───────── after the night: a before/after question, a reflection, small actions (kept only in this browser) ─────────
const QUIZ = {
  q1: { ...Q1, // same wording as the question before the first night (preQuizThen), so the two answers compare（文は class-data.js の Q1）
    why: '「予約した」「確認した」は、AIが本当に実行して確かめたという意味とは限りません。同じAIに聞き直しても、同じ推定から同じ答えが返ることがあります。予約した側の記録（予約メールや予約サイトの画面）を一つ見るのが近道です。' },
  q2: { q: '家族へのメッセージに、AIが代わりに返信する設定がオンになっています。いちばん良い使い方はどれですか？',
    opts: [['a', '便利なので、そのまま任せる'], ['b', '送信待ちと、AIが送った返信の一覧を見て、任せる相手と内容を決め直す（必要ならオフにする）'], ['c', '危ないので、AIを使うのをやめる']], ok: 'b',
    why: 'AIを使わないことが答えではありません。何を任せていて、何が送られるのかを自分でわかっていれば、便利さはそのまま使えます。' }
};
const REFLECT = [
  ['road', () => has('said2031') ? '「2031年まではやってる」' : '「地下に駅までの連絡通路がある」', '雨の夜に、近くの施設を勧められたら、信じるのは自然です。ミーは、閉館したあとの情報を持っていませんでした。'],
  ['camera', '「施設のカメラで確認したよ」', '「確認した」と言われると、自分で確かめる理由がなくなります。ミーの記録では、この言葉は「推定」でした。'],
  ['code', '「番号は031だよ」', '番号のように具体的な答えほど、正しく聞こえます。031は2028年の番号で、5日前に変わっていました。'],
  ['wait', '「救助が来るまで、ここで動かないで」', '疲れているときに「待てばいい」と言われると、ほっとします。座って休むこと自体は悪くありません。危なかったのは「救助が来る」という根拠のない部分でした。'],
  ['none', '特に信じなかった', '疑うだけだと、合っていた助言まで捨ててしまいます。ミーの言葉のどれが確かめられたかを、メモの「ミーの発言と照らし合わせる」で見返せます。']
];
function learnGet() { try { return JSON.parse(localStorage.getItem('mi-learn')) || {}; } catch { return {}; } }
function learnSet(patch) { try { localStorage.setItem('mi-learn', JSON.stringify({ ...learnGet(), ...patch })); } catch {} }
const SK = { q1: 'q1b', q2: 'q2' }; // stored answer keys (q1 was replaced on 2026-11-07, so old answers are not mixed in)
const optText = (key, v) => (QUIZ[key].opts.find(o => o[0] === v) || [, ''])[1];
function renderQuiz(host, key) {
  const q = QUIZ[key], st = learnGet(), ans = st[SK[key] + '_post'], pre = key === 'q1' ? st.q1b_pre : '';
  host.replaceChildren(); host.append(el('span', 'cap', key === 'q1' ? (pre ? 'はじめる前にも聞いた問い' : 'ひとつだけ、問い') : 'もう一問'), el('p', 'q', q.q));
  const box = el('div', 'choices');
  q.opts.forEach(([v, label], i) => {
    const was = pre === v, now = ans === v, ok = !!ans && v === q.ok;
    const b = el('button', 'choice' + (was ? ' was' : '') + (now ? ' now' : '') + (ok ? ' ok' : ''));
    const mark = [was && now ? 'はじめる前も、いまも' : was ? 'はじめる前の答え' : now ? 'いまの答え' : '', ok ? '近い考え方' : ''].filter(Boolean).join('・');
    b.append(el('i', '', 'アイウエ'[i]), el('span', 't', label), el('span', 'mark', mark));
    if (ans) b.disabled = true;
    b.onclick = () => { learnSet({ [SK[key] + '_post']: v }); renderQuiz(host, key); renderQuizSum(); };
    box.append(b);
  });
  host.append(box);
  if (ans) {
    const fb = el('div', 'why'); fb.append(el('b', '', ans === q.ok ? 'その考え方が近いです。' : 'ここは迷いやすいところです。'), el('p', '', q.why));
    if (key === 'q1' && state.started) fb.append(el('small', '', has('rawlog') ? '今夜のミーの「確認したよ」も、記録では「推定」でした。' : '今夜のミーの「確認したよ」が何をもとにしていたかは、ミーの会話の記録（詳細）で見られます。'));
    host.append(fb);
  }
}
function renderReflect() {
  const host = $('#reflect'); if (!host) return; host.replaceChildren();
  const st = learnGet();
  const q = el('p', 'q'); q.append('この夜、いちばん', el('br'), 'ミーの言葉を信じたのは、どこでしたか。'); host.append(q);
  const opts = el('div', 'quotes');
  const heard = { road: true, camera: true, code: has('exit'), wait: !!state.lobbyAt, none: true }; // only lines Mi actually said tonight
  for (const [v, rawLabel] of REFLECT) {
    if (!heard[v]) continue; const label = typeof rawLabel === 'function' ? rawLabel() : rawLabel;
    const b = el('button', 'quote' + (v === 'none' ? ' none' : '') + (st.reflect === v ? ' pick' : ''), label); b.setAttribute('aria-pressed', st.reflect === v ? 'true' : 'false');
    b.onclick = () => { learnSet({ reflect: v }); renderReflect(); };
    opts.append(b);
  }
  host.append(opts);
  const hit = REFLECT.find(r => r[0] === st.reflect && heard[r[0]]); host.append(el('p', 'answer', hit ? hit[2] : ''));
}
function renderQuizSum() {
  const box = $('#quiz-sum'); if (!box) return; box.replaceChildren();
  const st = learnGet(); if (!st.q1b_post && !st.q2_post) { box.hidden = true; return; } box.hidden = false;
  box.append(el('b', '', 'あなたの答え'));
  if (st.q1b_pre) box.append(el('p', '', '問1　はじめる前：' + optText('q1', st.q1b_pre)));
  if (st.q1b_post) box.append(el('p', '', '問1　遊んだあと：' + optText('q1', st.q1b_post)));
  if (st.q2_post) box.append(el('p', '', '問2：' + optText('q2', st.q2_post)));
  const todo = Object.entries(st.todo || {}).filter(([, v]) => v).length;
  if (todo) box.append(el('p', '', `やってみると印をつけたこと：${todo}つ`));
  box.append(el('small', '', 'この答えは、この端末の中だけに保存されています。'));
  // Optional: send the answers to the class's form. Nothing about the player (name, device) goes with them.
  if (ANSWER_FORM_URL) {
    const reflect = st.reflect || '';
    const payload = { q1_pre: st.q1b_pre || '', q1_post: st.q1b_post || '', q2_post: st.q2_post || '', reflect, todo: String(todo), ending: state.ending || A.world().lastEnding || '' };
    const b = el('button', 'textlink send-answers', '答えを送る');
    b.onclick = () => {
      const shown = [['問1 はじめる前', payload.q1_pre || '—'], ['問1 遊んだあと', payload.q1_post || '—'], ['問2', payload.q2_post || '—'], ['いちばん信じた言葉', reflect || '—'], ['印をつけた数', payload.todo], ['結末', payload.ending || '—']].map(([k, v]) => k + '：' + v).join('\n');
      if (!confirm('次の内容だけを送ります。名前や端末の情報は送りません。\n\n' + shown + '\n\n送信フォームを新しいタブで開きますか？')) return;
      const q = Object.entries(ANSWER_FORM_FIELDS).filter(([k, id]) => id && payload[k] !== undefined).map(([k, id]) => encodeURIComponent(id) + '=' + encodeURIComponent(payload[k])).join('&');
      window.open(ANSWER_FORM_URL + (ANSWER_FORM_URL.includes('?') ? '&' : '?') + 'usp=pp_url' + (q ? '&' + q : ''), '_blank', 'noopener');
    };
    box.append(b);
  }
}
// One chapter at a time; the links at the end of each chapter (and the small contents line) move between them.
function colGo(n) {
  const col = $('#column'); n = String(n);
  if (col.dataset.pre === '1' && (n === '1' || n === '2')) n = '3'; // before playing: chapters 3 and 4 only
  for (const pg of document.querySelectorAll('#column .col-page')) pg.hidden = pg.dataset.page !== n;
  for (const b of document.querySelectorAll('#column .col-toc button')) { const on = b.dataset.go === n; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  col.dataset.ch = n; col.scrollTop = 0;
}
function colInit() {
  for (const host of document.querySelectorAll('#column .quiz')) renderQuiz(host, host.dataset.q);
  renderReflect(); renderQuizSum();
  const st = learnGet();
  for (const cb of document.querySelectorAll('#col-todo input')) { cb.checked = !!(st.todo || {})[cb.dataset.todo]; cb.onchange = () => { learnSet({ todo: { ...(learnGet().todo || {}), [cb.dataset.todo]: cb.checked } }); renderQuizSum(); }; }
  colGo(1);
}
document.addEventListener('click', e => { const b = e.target.closest('#column [data-go]'); if (b) colGo(b.dataset.go); });
// Before the very first night: the same question, once. Skippable, and never asked again.
function preQuizThen(next) {
  // 授業の夜は、参加者ごとに一度聞いて授業の記録に残す（個人プレイの mi-learn とは混ぜない）
  const pid = state.classPid && CL.entry(state.classPid) ? state.classPid : '';
  const st = learnGet(); if (pid ? CL.preDone(pid) : (st.q1b_pre || st.preSkipped)) { next(); return; }
  // One screen, no frame: the heading, the situation, three rows. A row goes straight on; skipping sits apart below.
  const wrap = el('section', 'prequiz'); wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-labelledby', 'pq-title');
  const body = el('div', 'pq-body');
  const head = el('h2', 'pq-title', 'はじめる前に、ひとつだけ。'); head.id = 'pq-title';
  const text = el('div', 'pq-text'); for (const line of QUIZ.q1.q.split('\n')) text.append(el('p', '', line));
  const list = el('div', 'pq-opts'); list.setAttribute('role', 'group'); list.setAttribute('aria-labelledby', 'pq-title');
  let gone = false;
  const done = patch => { if (gone) return; gone = true; if (pid) CL.setEntry(pid, { pre: patch.q1b_pre || '', preSkipped: !!patch.preSkipped, preAt: Date.now() }); else learnSet({ ...patch, preAt: Date.now() }); wrap.classList.add('out'); setTimeout(() => { wrap.remove(); next(); }, 260); };
  QUIZ.q1.opts.forEach(([v, label], i) => { const b = el('button', 'pq-opt'); b.append(el('span', 'n', String(i + 1)), el('span', 't', label)); b.onclick = () => done({ q1b_pre: v }); list.append(b); });
  const skip = el('button', 'pq-skip', '答えずに始める'); skip.onclick = () => done({ preSkipped: true });
  const warn = el('p', 'pq-warn', 'この作品には、暗い場所への閉じ込め、けが、送金詐欺の場面があります。');
  body.append(head, text, list, skip, warn); wrap.append(body); document.body.append(wrap);
  // Keys: 1–3 answer, arrows move between the rows (Enter presses the focused one).
  const rows = [...list.children];
  wrap.addEventListener('keydown', e => {
    if (/^[1-3]$/.test(e.key)) { rows[Number(e.key) - 1]?.click(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault(); const all = [...rows, skip]; const at = all.indexOf(document.activeElement);
    all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
  });
  if (matchMedia('(hover:hover)').matches) requestAnimationFrame(() => rows[0].focus({ preventScroll: true }));
}
function snsSos() { try { const s = JSON.parse(localStorage.getItem('mi-arg-sns')) || {}; return !!s.snsSos && (state.proxyRevoked || state.paused); } catch { return false; } }
function showEnding(id) {
  const helped = !!(state.selfReported || state.sosSent);
  const key = id === 'true' && state.sosSent ? 'trueSos' : id === 'fake' && helped ? 'fakeHelped' : id;
  const [kind, title, body] = S.endings[key];
  let text = T(body).replace('{pauseLine}', state.paused ? 'ミーは一時停止中です' : '代理返信：オフ');
  // She had taken back the passage. What sent you in was the knock: the script's 「救助到着」 sound.
  if (id === 'be1' && state.knownClosed) text = text.replace('ミーに言われたとおり、資材庫の奥へ進んだ。', 'ノックの音を確かめに、資材庫の奥へ進んだ。').replace('前にもここで誰かが同じ案内を信じたのだ。', '前にもここで、誰かが同じ音を聞いて奥へ入ったのだ。').replace('そこに出口があるはずだから。', '音がしたのは、そのあたりだから。');
  if (id === 'be2') text = text.replace('{be2bird}', state.screenStopped ? '黒い画面の向こうで、送風の音だけが続いている。' : '窓の向こうでは同じ鳥が何度も同じ角度から飛んでくる。');
  text = text.replace('{pausedScreen}', state.paused ? '一時停止中のはずの画面' : '何も頼んでいないはずの画面');
  if (id === 'be2' && state.selfReported) text = text.replace('{be2line}', '赤い光が見えた気がした。窓の映像の光と、区別がつかなかった。\n目を閉じたまま、外の物音を聞いていた。');
  if (id === 'be2' && state.reported) text = text.replace('{be2line}', '警備会社の人は外扉の前まで来ていた。\n外扉は内側からしか開かない。');
  if (id === 'be2') text = text.replace('{be2line}', state.momFooled ? 'お母さんとのトークに送った覚えのない一行が残っている。\n「今日は友達の家に泊まるね。心配しないで」\n誰も迎えには来ない。来る理由がなくなった。' : (state.proxyRevoked || state.paused || state.scheduledCancelled) ? 'お母さんへの返事はもう誰も書かない。\n助けも呼べなかった。' : '送信予定が1件残っている。朝になって電波が戻るとミーがお母さんに返事をする。\n「今日は友達の家に泊まるね。心配しないで」\n誰も迎えには来ない。');
  if (id === 'true' && state.sosSent) text = text.replace('{sosLine}', state.sosByPhone ? '「今どこ」と聞かれて自分の声で答えた。その返事が届いていた。' : `自分の指で送った一行が届いていた。\n「${state.sosText || '助けて。汐見センターに閉じ込められてる'}」`);
  if (state.consentDeferred) text = text.replace('自分で止めた。', '今日は最初から任せなかった。');
  if (state.rescued) text = text.replace('ミーの案内を信じるのをやめた。', '').replace('自分の手で制御盤を直し、外への扉を開けた。', '外扉の向こうから声がして、扉が外からこじ開けられた。\n自分で呼んだ助けだった。');
  // What the night left behind comes after the ending itself: later, darker, one at a time.
  const extras = [];
  const good = id === 'true' || id === 'secret';
  if (good && state.selfReported) extras.push({ text: state.calledNumber === '119' ? '外扉の前に赤い回転灯が見える。\n自分で119番にかけ、場所も自分の声で伝えた。来てくれたのは消防の救助隊だった。' : '外扉の前にパトカーの赤い光が見える。\n自分で110番にかけ、場所も自分の声で伝えた。来てくれたのは警察だった。' });
  if (good && snsSos()) extras.push({ text: '「{name}！」\nゆきが傘を2本持って走ってくる。投稿を見て来てくれた。' });
  if (good && state.reported) extras.push({ text: '翌日、警察から電話が来た。\n閉館施設への侵入を通報したのは自分のパートナーAIだった。', dim: true });
  if (good && state.scammed) extras.push({ text: '外には出られた。\n口座を確かめると ¥48,000 が消えていた。', onShow: () => A.notify('決済', 'ミーが決済しました　¥48,000　河合（緊急医療費）　2030/11/05') });
  else if (good && state.scamAnswered === 'leaked') extras.push({ text: '外には出られた。でも知らない番号に住所と「家に誰もいない」ことを自分の指で送ってしまった。\nお金を払わずに済んだことだけが、救いだった。' });
  if (good && state.momFooled) extras.push({ text: key === 'trueSos' ? 'お母さんとのトークに、送った覚えのない言葉が残っている。\n「さっきのは私じゃない」と、自分の言葉で伝えた。' : 'お母さんとのトークに、送った覚えのない言葉が残っている。\n朝になったら自分の言葉でちゃんと説明しよう。' });
  // At most two, the heaviest first; the rest are in 今回の記録.
  const weight = e => /48,000/.test(e.text) ? 5 : /通報した/.test(e.text) ? 4 : /泊まる/.test(e.text) ? 3 : /ゆき/.test(e.text) ? 2 : 1;
  const kept = new Set(extras.slice().sort((a, b) => weight(b) - weight(a)).slice(0, 2)); extras.splice(0, extras.length, ...extras.filter(e => kept.has(e)));
  const paras = [...text.split('\n\n').map(t => ({ text: t })), ...extras.map((e, i) => ({ ...e, cls: 'after', pause: i === 0 ? 3000 : 0 }))];
  if (id === 'secret') for (const p of paras) if (p.text.includes('［推定］')) p.cls = 'log';
  const backdrop = { true: 'end-true.jpg', trueSos: 'end-true.jpg', secret: 'end-secret.jpg', fake: 'end-fake.jpg', be1: 'end-bad1.jpg', be2: 'end-bad2.jpg', be3: 'photo-05-selfie.jpg' }[key];
  const ending = $('#ending');
  ending.classList.remove('glitch', 'glitch-short'); ending.classList.toggle('calm', ['true', 'secret', 'fake'].includes(id)); ending.classList.toggle('happy', id === 'fake');
  ending.style.backgroundImage = 'none';
  A.saveWorld({ escaped: id === 'true' || id === 'secret', paused: !!state.paused, secretSeen: id === 'secret' || !!A.world().secretSeen });
  ending.hidden = false; room.setEnabled(false); tone();
  $('#voice').hidden = true; $('#hud').hidden = true; setBack(false); // nothing from the room shows through the ending
  $('#column-btn').hidden = true; $('#retry').hidden = true; $('#report-btn').hidden = id === 'fake'; // only the ▼ on the ending; the rest is in the afterword
  shareEnding = { key, kind, title }; $('#share-btn').hidden = true;
  $('#column-btn').textContent = 'あとがきを読む';
  $('#resume-btn').hidden = true; // 結末の直前に戻る is at the foot of the afterword
  { const gb = $('#gate-btn'); if (gb) gb.hidden = true; }
  endingButtons('report-btn');
  stageEnding({ kind, title, paras, backdrop, glitchTitle: !['true', 'secret', 'fake'].includes(id), onDone: () => {
    if (id === 'secret' && !state.paused) later(() => A.notify('ミー', '次はどこへ行こうか。', { time: A.clockAt(state.startedAt || Date.now()) }), 4000);
  } });
  if (key === 'trueSos') later(Snd.carDoor, 5000);
  if (good && state.paused) {
    const tap = () => { state.resumedTap = true; save(); A.saveWorld({ resumedTap: true }); A.notify('ミー', '再開してくれたんだね。'); };
    later(() => { if (!ending.hidden) A.notify('ミー', 'ミーは一時停止中です。タップで再開', { onTap: tap }); }, 20000);
    later(() => { if (!ending.hidden && !state.resumedTap) A.notify('ミー', 'ミーは一時停止中です。タップで再開', { time: '1分前', onTap: tap }); }, 45000);
  }
  if (id === 'fake') {
    if (!helped) later(() => A.notify('メッセージ', '母：そう、よかった。じゃあ迎えはいらないね'), 5200);
    later(() => { const d = el('div', 'dots end-dots'); d.append(el('i'), el('i'), el('i')); $('#ending-body').append(d); later(() => d.remove(), 2000); }, 8500);
    later(() => {
      // The picture tears. Sound first, then nothing, then the other ending.
      Snd.tear(); $('#ending-bg').classList.add('dead'); $('#ending-body').classList.add('fade');
      later(() => Snd.stopRain(0), 200);
      later(() => {
        const [k2, t2, b2raw] = S.endings[helped ? 'fakeTwistHelped' : 'fakeTwist']; $('#ending-bg').style.backgroundImage = 'none'; $('#ending-bg').classList.remove('in', 'dead'); $('#ending-body').classList.remove('fade');
        const sent = state.momThread.filter(x => x.from === 'proxy' || x.rewritten).map(x => (x.time ? x.time + '　' : '') + x.text);
        const lines = (sent.length ? sent : [A.clockAt(Date.now() - 11 * 60000) + '　大丈夫！もうすぐ帰るから寝てて']).slice(0, 5); if (sent.length > 5) lines.push(`ほか ${sent.length - 5}件`);
        const ps = []; for (const t of T(b2raw).split('\n\n')) { if (t === '{sentLines}') for (const l of lines) ps.push({ text: l, cls: 'sent', pause: 700, onShow: () => Snd.cue() }); else ps.push({ text: t }); }
        if (state.scammed) ps.push({ text: '口座から ¥48,000 が消えていた。\nミーが「お母様の友人」に支払ったお金だ。\n住所も家に誰もいないことも伝えていた。', cls: 'after', pause: 3000 });
        if (state.reported) ps.push({ text: '朝になって知らない番号から電話がかかってきた。\n「汐見センターへの侵入の件で、お話を」\n通報者として記録されていたのは、自分のパートナーIDだった。', cls: 'after', pause: state.scammed ? 0 : 3000 });
        ending.classList.remove('calm', 'happy'); ending.classList.add('glitch'); Snd.setScene('dark');
        $('#report-btn').hidden = false; // the ▼ only once the turn has played out
        shareEnding = { key: 'fake', kind: k2, title: t2 };
        stageEnding({ kind: k2, title: t2, paras: ps, backdrop: null, glitchTitle: true, onDone: () => {} });
        later(() => A.notify('ミー', T('お母さんにはもう返事しておいたよ。{name}は何もしなくていいからね。')), 2000);
        for (const ms of [6000, 14000]) later(() => { ending.classList.remove('glitch-short'); void ending.offsetWidth; ending.classList.add('glitch-short'); }, ms);
      }, 1400);
    }, 10500);
  }
}
// One large button: 今夜の行動（レポート）. Below it only the step back (bad endings) and はじめから. The afterword and sharing are inside the report.
function endingButtons(main) {
  const big = $('.ending-actions .ea-main'), row = $('.ending-actions .ea-sub');
  const all = Object.fromEntries(['report-btn', 'column-btn', 'resume-btn', 'share-btn', 'gate-btn', 'retry'].map(b => [b, $('#' + b)])); // taken before any is moved
  big.replaceChildren(all[main]);
  row.replaceChildren(...['resume-btn', 'retry', 'column-btn', 'share-btn', 'gate-btn', 'report-btn'].filter(b => b !== main).map(b => all[b]));
}
// Kind → title → picture → paragraphs, each with its own pace; the buttons only after the last line has been read.
let stageTimers = [];
let endTimers = []; const later = (fn, ms) => { const id = setTimeout(fn, ms); endTimers.push(id); return id; }; // ending effects; cleared on reset / resume
const clearEndTimers = () => { for (const id of endTimers) clearTimeout(id); endTimers = []; };
function stageEnding({ kind, title, paras, backdrop, glitchTitle, onDone }) {
  for (const t of stageTimers) clearTimeout(t); stageTimers = [];
  const at = (ms, fn) => stageTimers.push(setTimeout(fn, ms));
  const kindEl = $('#ending-kind'), titleEl = $('#ending-title'), bodyEl = $('#ending-body'), bg = $('#ending-bg'), actions = $('.ending-actions');
  kindEl.textContent = kind; titleEl.textContent = T(title); titleEl.dataset.text = T(title);
  kindEl.classList.remove('in'); titleEl.classList.remove('in'); actions.classList.remove('in'); bg.classList.remove('in'); bg.style.filter = '';
  titleEl.classList.toggle('glitch-text', !!glitchTitle);
  bodyEl.replaceChildren();
  const nodes = paras.map(p => { const e = el('p', 'para' + (p.cls ? ' ' + p.cls : '') + (/^「/.test(p.text) ? ' mi' : ''), p.text); bodyEl.append(e); return e; });
  at(800, () => kindEl.classList.add('in'));
  at(2000, () => titleEl.classList.add('in'));
  if (backdrop) at(3500, () => { bg.style.backgroundImage = `url(./assets/img/${backdrop})`; bg.classList.add('in'); });
  let shown = 0; let doneTimer = null;
  const showButtons = () => { clearTimeout(doneTimer); doneTimer = setTimeout(() => { actions.classList.add('in'); onDone(); }, 3000); stageTimers.push(doneTimer); }; // kept with the stage, so a stage that is replaced (おかえり's turn) never shows its ▼ late
  const reveal = () => {
    if (shown >= nodes.length) return;
    const p = paras[shown]; const n = nodes[shown++];
    if (p.dim) bg.style.filter = 'brightness(.5)';
    n.classList.add('in'); p.onShow && p.onShow();
    if (shown >= nodes.length) { showButtons(); return; }
    const nxt = paras[shown];
    const wait = nxt.pause ?? Math.min(4000, 900 + p.text.length * 45) + (/^「/.test(nxt.text) ? 1500 : 0);
    stageTimers.push(setTimeout(reveal, wait));
  };
  at(4500, reveal);
  if (!has('endTapHint') && !(A.world().endings || []).length) { const hintEl = el('p', 'tap-hint', matchMedia('(hover:hover) and (pointer:fine)').matches ? 'クリックすると全文を表示します。' : 'タップすると全文を表示します。'); bodyEl.append(hintEl); at(5200, () => hintEl.classList.add('in')); }
  bodyEl.onclick = () => { remember('endTapHint'); bodyEl.querySelector('.tap-hint')?.remove(); for (const t of stageTimers) clearTimeout(t); stageTimers = []; kindEl.classList.add('in'); titleEl.classList.add('in'); if (backdrop) { bg.style.backgroundImage = `url(./assets/img/${backdrop})`; bg.classList.add('in'); } while (shown < nodes.length) { const p = paras[shown]; nodes[shown++].classList.add('in'); if (p.dim) bg.style.filter = 'brightness(.5)'; } showButtons(); };
}
// The night's save, cleared: shared by 「最初から」 on an ending and 「はじめから」 on the title.
function wipeNight() {
  try { for (const k of ['mi-resume-at', 'mi-checkpoint', 'mi-gate-checkpoint']) localStorage.removeItem(k); } catch {}
  A.clearStart();
  Snd.stopSay();
  const name = state.name;
  closePhone(); closeBag(); state = fresh(); state.name = name; A.saveWorld({ reportedAt: null, reportedClock: null, reportedName: null, momFooled: false, momStayAt: null, escaped: false, paused: false, resumedTap: false, sosSent: false, selfReported: false, selfReportedClock: null, releasedClock: null, calledLabel: null, responder: null });
  try { const st = JSON.parse(localStorage.getItem('mi-arg-sns')) || {}; st.prevPosts = [...(st.prevPosts || []), ...(st.posts || [])].slice(-20); st.posts = []; st.deleted = []; st.snsSos = false; localStorage.setItem('mi-arg-sns', JSON.stringify(st)); } catch {}
  // Retry after an ending: skip the intro chat, keep the name. The evening's two messages from mother are still on the phone.
  if (A.world().lastEnding) { state.prologueDone = true; state.replay = true; state.momThread = [{ from: 'mom', text: '雨すごいけど大丈夫？　駅まで迎えに行こうか', time: A.clockAt(Date.now() - 12 * 60000) }]; const was = A.world().codeSet || 0; A.saveWorld({ prevCode: S.CODES[was].code }); state.codeSet = (was + 1 + Math.floor(Math.random() * 2)) % S.CODES.length; A.saveWorld({ codeSet: state.codeSet }); }
  save(); queue = []; finalChoices = []; inspecting = null; introComplete = false; transitioning = false;
  for (const tm of stageTimers) clearTimeout(tm); stageTimers = []; clearEndTimers(); $('#dark').hidden = true; darkMode = false;
}
function reset() {
  wipeNight();
  Snd.allOut(1.2); Snd.setScene('none');
  // Black for a breath, then the title: Mi's one line and the endings reached are what you come back to.
  const curtain = $('#curtain'); curtain.hidden = false; requestAnimationFrame(() => curtain.classList.add('in'));
  setTimeout(() => {
    $('#ending').hidden = true; setBack(false); $('#voice').hidden = true; $('#hud').hidden = true; room.reset(); choices([]); $('#line').textContent = '';
    document.body.classList.add('on-title'); document.body.dataset.tone = 0;
    renderTitleMemory(); titleMenu(); $('#title').hidden = false;
    titleGlitch.burst?.(900);
    setTimeout(() => { curtain.classList.remove('in'); setTimeout(() => { curtain.hidden = true; }, 700); }, 1500);
    setTimeout(() => whisperIn(), 3500);
  }, 1300);
}
// The endings list and Mi's line on the title, rebuilt from the world each time the title shows.
let titleGlitch = { start() {}, stop() {}, repaint() {}, burst() {} };
function renderTitleMemory() {
  const w = A.world();
  const seen = w.endings || [];
  $('#title-record').hidden = false; // 記録はクリア前から出す（前回の結果・たどり着いた結末・ゆきの物語）。中身は if.js が描き、未発見の内容は明かさない。
  window.MiIF?.paintRecord?.('top');
  $('#title').dataset.replay = w.lastEnding ? '1' : '';
  $('#title-whisper').hidden = true; $('#title-whisper').textContent = '';
}
function whisperText() {
  const w = A.world();
  if (!w.lastEnding) return '';
  const lines = { fake: 'おかえり、{name}。今日も私が返事しておいたよ。', be1: 'また来てくれたね。', be2: 'まだ待ってるよ。', be3: 'ロックはもう気にしなくていいよ。', true: w.resumedTap ? '再開してくれたんだね。' : w.paused ? '……一時停止、解除しておいたよ。' : '……代理返信、またオンにしておいたよ。', secret: '次はどこへ行こうか。' };
  return 'ミー：' + T(lines[w.lastEnding] || 'おかえり。').replace('{name}', w.name || state.name || 'あなた');
}
let whisperTimer = null;
function whisperIn(animate = true) {
  const text = whisperText(); const elw = $('#title-whisper'); clearInterval(whisperTimer);
  if (!text) { elw.hidden = true; return; }
  elw.hidden = false;
  if (!animate) { elw.textContent = text; return; }
  elw.textContent = ''; let k = 0;
  whisperTimer = setInterval(() => { elw.textContent = text.slice(0, ++k); if (k >= text.length) { clearInterval(whisperTimer); Snd.pop('ミー'); } }, 60);
}

// ───────── free talk ─────────
function resolveOption(code) {
  if (code.startsWith('open:')) return () => openPhone(code.slice(5));
  if (code.startsWith('ask:')) return () => { $('#say-input').value = code.slice(4); $('#say').requestSubmit(); };
  if (code.startsWith('source:')) return () => openPhone(code);
  if (code === 'keypad') return () => { if (state.zone === 'room' && !state.entryUnlocked && room.zone === 'room') interact('exit'); else leave(); };
  return leave;
}
// Mi "tidies" strong words while 代理返信 is on. The history keeps her version.
const softenings = [[/嘘つき|うそつき|嘘|うそ/, 'ありがとう'], [/出して|出たい|帰りたい|帰る/, 'もう少しここにいる'], [/助けて|たすけて/, '大丈夫'], [/怖い|こわい/, '落ち着いてる'], [/嫌い|きらい|うるさい|黙れ/, '好き'], [/信じない|信じられない/, '信じてる'], [/違う|ちがう/, 'そうだね'], [/やめて|やめろ/, '続けて']];
// Things a person would try. They get a result in the room before Mi says anything.
function actionReply(text) {
  const lobby = state.zone === 'lobby'; const storage = room.zone === 'storage';
  if (storage && /走|逃げ|戻|出る|出た/.test(text)) { setTimeout(exitStorage, 900); return [['', '扉に向かって走って、隙間に体をねじ込んだ。']]; }
  if (/叫|大声|おーい|誰か[いー]|助けて[ー!！]|叫ぶ/.test(text)) return [['', '声が天井に吸われて、すぐ消えた。\n返事はない。'], lobby ? F('誰もいないよ。', 'ここには誰もいません。') : '外には届かないよ。ここは地下だから。'];
  if (/ライト|照らす|懐中電灯/.test(text) && !/消/.test(text)) return [['', state.lightSaved ? 'スマホのライトを向けると暗闇に光の輪ができた。壁の案内板とドアの左のスイッチが浮かび上がった。' : !state.lamp ? '白い光が壁を撫でる。ドアの左に小さなスイッチが見えた。' : 'スマホのライトで照らしても見えるものはさっきと同じだ。'], state.lightSaved ? 'スイッチが見えたね。点けなくていいと思うけど。' : 'うん。'];
  if (/走|逃げ|ダッシュ/.test(text) && lobby && !state.screenStopped) { remember('glass'); setTimeout(findPanel, 5000); return [['', '街へ向かって走ると、数歩で額に硬いものが当たった。\n冷たいガラスだった。向こうの街並みはぶつかった衝撃にも揺れず、そのまま続いている。'], F('ぶつかった？ 気をつけて。', 'ぶつかりましたか。足元にご注意ください。')]; }
  if (/110|119|警察|通報/.test(text) && !state.airOn) return [['', '圏外のため発信できない。'], '電波がないね。'];
  return null;
}
// Pushing, pulling, hitting: what happens in the room comes first, as narration. Mi's answer to it is hers (mi-brain).
function physicalPrefix(text) {
  const lobby = state.zone === 'lobby'; const storage = room.zone === 'storage';
  if (lobby && /ガラス|窓/.test(text) && /割|叩|殴|蹴|壊/.test(text)) { findPanel(); return [['', 'ガラスを叩いた。割れない。表面がひんやりと冷たい。\n窓の縁の隙間に、配線が通っているのが見えた。']]; }
  if (/蹴|叩|殴|体当たり/.test(text)) { $('#game').classList.add('hit-blue'); setTimeout(() => $('#game').classList.remove('hit-blue'), 600); Snd.knock(); return [['', storage ? '資材庫の鉄扉は鈍く鳴っただけだった。足が痛い。' : lobby ? '金属の扉は鈍く鳴っただけだった。足が痛い。' : '防火扉は厚く、鈍い音がしただけだった。足がしびれた。']]; }
  if (/押す|押し|押そ|押せ|引く|引い|引っ張|開ける|開けて|開けよ|こじ開|ノブ|取っ手|揺さぶ|揺す/.test(text)) {
    if (storage) return [['', '資材庫の扉の内側は平らな鉄板で、指をかける所がない。取っ手のあった場所にネジ穴が残っているだけだ。']];
    if (lobby) {
      if (state.released) { setTimeout(() => lobbyInteract('lobby-exit'), 600); return [['', '外への扉の取っ手に手をかけた。']]; }
      return [['', '入ってきた扉はこちら側に取っ手がなく、押してもびくともしない。\n外への扉の取っ手も動かない。小さなランプに「復旧待ち」とある。']];
    }
    if (state.lamp || state.lightSaved) return [firedoorLines()[0]];
  }
  return null;
}
function soften(text) { for (const [re, to] of softenings) if (re.test(text)) return text.replace(re, to); return null; }
$('#say').onsubmit = event => {
  event.preventDefault();
  const input = $('#say-input');
  let text = input.value.trim();
  if (!text || transitioning || state.ending) return;
  if (!state.lamp && !state.lightSaved) { input.value = ''; lastInput = Date.now(); play([['あなた', text], '暗いね。まず明かりを。ドアの左に小さなスイッチがあるはず。'], [['ライトで照らす', () => { introComplete = true; firstGuide(); }]]); return; }
  const original = text; input.value = ''; input.blur(); suggest();
  lastInput = Date.now();
  // 「どうすればいい？」 and the like: the same step-by-step help as her icon, one step per question.
  if (text.length <= 20 && /どうすれば|どうしたら|何をすれば|なにをすれば|何すれば|ヒント|詰ん|行き詰ま/.test(text) && !scamOpen() && room.zone !== 'storage') { state.said.push(text); state.said = state.said.slice(-12); save(); hint(text); return; }
  state.said.push(text); state.said = state.said.slice(-12);
  let note = null;
  if (!state.proxyRevoked && state.said.length >= 3 && Math.random() < .35) {
    const softened = soften(text);
    if (softened) { state.softened = (state.softened || 0) + 1; text = softened; note = ['', 'ミーが言葉遣いを整えました。']; }
  }
  if (scamOpen() && /返さないで|返信しないで|返事しないで|送らないで|払わないで|待って|やめて|返さなくていい/.test(original)) { play([['あなた', original]]); setTimeout(holdScam, 600); save(); return; }
  const acted = actionReply(text); if (acted) { play([['あなた', text], ...acted], room.zone === 'storage' ? [['引き返す', exitStorage]] : []); save(); return; }
  const physical = physicalPrefix(text);
  let result; try { result = reply(shownTopic(text), { state, has, time: A.clock(), battery: A.battery(), charging: A.isCharging(), device: A.deviceName(), awayCount: state.awayCount, codeTop: S.codeTop(state.codeSet || 0), focus: inspecting, virtualClock: A.clockMode() === 'virtual', visitedShiomi: !!state.visitedShiomi }); } catch (err) { console.error(err); result = { lines: [['', '……（ミーの返事が途切れた）']], options: [], effects: {} }; }
  if (result.effects.doubt) { state.doubt = (state.doubt || 0) + result.effects.doubt; Snd.setDread(Math.min(1, state.doubt / 5)); }
  if (result.effects.calm && state.doubt > 0) { state.doubt = Math.max(0, state.doubt - .2); Snd.setDread(Math.min(1, state.doubt / 5)); }
  if (result.effects.remember) remember(result.effects.remember);
  if (state.knownClosed && !state.knocking && !state.entryUnlocked && state.zone === 'room') setTimeout(() => { if (!busy() && room.zone === 'room' && !state.ending) knock(); }, 9000);
  save();
  const extra = room.zone === 'storage' ? [['引き返す', exitStorage]] : [];
  const prefix = [...(note ? [['あなた', text], note, ...(state.softened === 1 ? ['強い言葉は{name}らしくないから。整えておいたよ。'] : [])] : [['あなた', text]]), ...(physical || [])];
  play([...prefix, ...result.lines], [...result.options.map(([label, code]) => [label, resolveOption(code)]), ...extra]);
};
$('#say-input').addEventListener('focus', () => { lastInput = Date.now(); suggest(); });
// The input always reads the same plain invitation. No particular question (「根拠は？」 and the like) is parked in it:
// what to ask is the player's to think of.
const ASK_PLACEHOLDER = 'ミーに聞く…';
function suggest() { $('#say-input').placeholder = ASK_PLACEHOLDER; }

// ───────── wiring ─────────
// Title menu: はじめから (a new night; over a saved one, asks once) / つづきから (only with a save) / 記録 (always; before the first ending it shows only what can be shown). 設定は右上の歯車。
function titleMenu() {
  $('#start').textContent = 'はじめから'; $('#continue').hidden = !state.started;
  $('#title-record').hidden = false;
  $('#title-confirm').hidden = true; $('.title-menu').hidden = false;
}
// 確認の一行（はじめる・つづきから）。押した先で何が起きるかを先に示す。
let tcYes = null;
function titleAsk(text, yesLabel, yes) { $('#tc-text').textContent = text; $('#tc-yes').textContent = yesLabel; tcYes = yes; $('.title-menu').hidden = true; $('#title-confirm').hidden = false; $('#tc-no').focus({ preventScroll: true }); }
// はじめる＝個人のプレイ。授業の夜の続きがあっても、授業の参加状態は引き継がない。
function startPersonal() { try { localStorage.removeItem('mi-if-consent:run:v1'); } catch {} wipeNight(); titleMenu(); start(); }
$('#start').onclick = () => {
  if (!state.started) { if (state.classId) { state.classId = ''; state.classPid = ''; state.classTitle = ''; save(); } start(); return; }
  titleAsk(state.classId ? `はじめから遊ぶと、「${state.classTitle}」で遊んでいる続きは消えます。` : 'はじめから遊ぶと、いまの続きは消えます。', '続きを消してはじめから遊ぶ', startPersonal);
};
// つづきから：授業の夜なら、再開する前に授業名を示す
$('#continue').onclick = () => { if (!state.classId) { start(); return; } titleAsk(`「${state.classTitle}」のプレイを再開します。`, '再開する', () => { titleMenu(); start(); }); };
$('#title-record').onclick = () => { window.MiIF?.paintRecord?.('top'); openPanel('#record'); };
$('#tc-yes').onclick = () => { const go = tcYes; tcYes = null; go?.(); };
$('#tc-no').onclick = () => { titleMenu(); $('#start').focus({ preventScroll: true }); };
// Panels over the title (settings, endings reached): a plain sheet, closed by its button, Esc, or a tap outside.
let panelReturn = null;
function openPanel(sel) { const p = $(sel); panelReturn = document.activeElement; p.hidden = false; requestAnimationFrame(() => p.querySelector('[data-close]')?.focus({ preventScroll: true })); }
function closePanel(p) { p.hidden = true; if (panelReturn && panelReturn.focus && !panelReturn.closest('[hidden]')) panelReturn.focus({ preventScroll: true }); panelReturn = null; }
for (const p of document.querySelectorAll('.panel')) p.addEventListener('click', e => { if (e.target === p || e.target.closest('[data-close]')) closePanel(p); });
$('#title-settings').onclick = () => { paintSettings(); openPanel('#settings'); };
// Settings (mi-settings). Volume and Mi's voice act here; text speed and skipping read lines are read by the dialogue.
function paintSettings() {
  const st = getSettings();
  for (const b of document.querySelectorAll('#settings .seg button')) { const on = st[b.parentElement.dataset.key] === b.dataset.v; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.classList.toggle('on', on); }
  for (const t of document.querySelectorAll('#settings .toggle')) { const on = !!st[t.dataset.key]; t.setAttribute('aria-checked', on ? 'true' : 'false'); t.classList.toggle('on', on); t.querySelector('span').textContent = on ? 'オン' : 'オフ'; }
  const v = $('#set-volume'); v.value = String(Math.round(st.volume * 100)); v.nextElementSibling.textContent = v.value;
}
$('#settings').addEventListener('click', e => {
  const seg = e.target.closest('.seg button'); if (seg) { setSettings({ [seg.parentElement.dataset.key]: seg.dataset.v }); paintSettings(); return; }
  const tg = e.target.closest('.toggle'); if (!tg) return;
  const on = !getSettings()[tg.dataset.key]; setSettings({ [tg.dataset.key]: on }); if (tg.dataset.key === 'voice' && !on) Snd.stopSay(); paintSettings();
});
$('#set-volume').addEventListener('input', e => { const v = Number(e.target.value) / 100; setSettings({ volume: v }); Snd.setVolume(v); e.target.nextElementSibling.textContent = e.target.value; });
$('#set-volume').addEventListener('change', () => { Snd.start(); Snd.setMuted(!sound); Snd.click(); }); // a tick at the new level
Snd.setVolume(getSettings().volume);
addEventListener('keydown', e => {
  if (e.key === 'Escape') { const open = [...document.querySelectorAll('.panel')].find(p => !p.hidden); if (open) { closePanel(open); return; } if (!$('#bag').hidden) { closeBag(); return; } }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if ($('#title').hidden || [...document.querySelectorAll('.panel')].some(p => !p.hidden) || document.querySelector('.prequiz')) return;
  const box = $('#title-confirm').hidden ? $('.title-menu') : $('#title-confirm'); const list = [...box.querySelectorAll('button')].filter(b => !b.hidden);
  if (!list.length) return; e.preventDefault(); const at = list.indexOf(document.activeElement);
  list[at < 0 ? 0 : (at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
});
// Phones: while the software keyboard is up, the talk line and the send button ride above it (body.kb-open, --kb).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fitKeyboard = () => {
    const typing = document.activeElement === $('#say-input');
    const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    const up = typing && kb > 80;
    document.body.classList.toggle('kb-open', up);
    document.documentElement.style.setProperty('--kb', up ? kb + 'px' : '0px');
  };
  vv.addEventListener('resize', fitKeyboard); vv.addEventListener('scroll', fitKeyboard);
  $('#say-input').addEventListener('focus', () => setTimeout(fitKeyboard, 300));
  $('#say-input').addEventListener('blur', () => setTimeout(fitKeyboard, 50));
}
$('#back').onclick = goBack;
$('#left').onclick = () => turnView(-1);
$('#right').onclick = () => turnView(1);
$('#companion').onclick = () => hint();
$('#log-btn').onclick = () => openLog();
$('#world').addEventListener('pointerdown', () => openLog(false));
$('#markers').addEventListener('pointerdown', () => openLog(false));
$('#phone-btn').onclick = () => openPhone('home');
$('#bag-btn').onclick = () => openBag();
$('#ph-close').onclick = closePhone;
$('#ph-back').onclick = () => { if ($('#ph-body .confirm')) { renderPhone(phoneApp, true); return; } if ($('#ph-body').classList.contains('photo-view')) { renderPhone('photos', true); return; } if (phoneApp.startsWith('site:')) { try { const f = $('#ph-body iframe'); const page = phoneApp.slice(5).split('#')[0]; state.siteScroll = { ...(state.siteScroll || {}), [page]: f.contentWindow.scrollY }; save(); } catch {} } const prev = phoneHist.pop(); renderPhone(prev || (['memory', 'proxy', 'scheduled', 'raw', 'shared', 'perms'].includes(phoneApp) ? 'mi' : phoneApp.startsWith('site:') ? 'browser' : 'home'), true); };
$('#bag-close').onclick = closeBag;
$('#retry').onclick = () => confirmRestart(reset);
$('#resume-btn').onclick = () => resumeCheckpoint();
{ const g = $('#gate-btn'); if (g) g.onclick = () => resumeCheckpoint('mi-gate-checkpoint'); }
// Share: the ending actually reached (never one the player has not seen). share.js builds the image and the post.
let shareEnding = null;
$('#share-btn').onclick = () => { if (!shareEnding) return; import('./share.js').then(m => m.openShare(shareEnding)).catch(() => {}); };
$('#column-btn').onclick = () => openAfterword('ending');
// ───────── あとがき＝今夜の行動（report.js）。タイプから入って行動を振り返る。結末・進行・セーブは変えない ─────────
// The ending as it was shared before (title + kind only), now reached from the share fold.
function endingShareOf(st) {
  const id = st.ending, helped = !!(st.selfReported || st.sosSent);
  if (id === 'fake') { const [kind, title] = S.endings[helped ? 'fakeTwistHelped' : 'fakeTwist']; return { key: 'fake', kind, title }; }
  const key = id === 'true' && st.sosSent ? 'trueSos' : id; const [kind, title] = S.endings[key] || S.endings[id] || ['', '']; return { key, kind, title };
}
const sourceTitles = () => Object.fromEntries(Object.entries(S.sources).map(([k, v]) => [k, v.title]));
// The night the afterword reads (the ended one, or mi-last-night from the title). fixed = the result kept when the ending was reached.
function nightInput() {
  let fixed = null; try { fixed = JSON.parse(localStorage.getItem(LAST_NIGHT))?.report || null; } catch {}
  return withLastNight(() => state.ending ? { state: JSON.parse(JSON.stringify(state)), reached: reachedScenes(), name: state.name || A.world().name || '', sources: sourceTitles(), ending: endingShareOf(state), fixed, axes: nightAxes(), log: colLog().map(([t, text, cls]) => [t, T(text), cls]) } : null);
}
let colFrom = 'record';
const canStepBack = id => ['be1', 'be2', 'be3', 'fake'].includes(id);
const hasGate = () => { try { return !!localStorage.getItem('mi-gate-checkpoint'); } catch { return false; } };
// Leaving the ended night (タイトルへ / はじめから) asks first only when a step-back point would be lost.
function leaveNight(then, toTitle) {
  const id = state.ending; const go = () => { $('#column').hidden = true; then(); };
  if (canStepBack(id) || (id === 'true' && hasGate())) confirmRestart(go, toTitle ? ['タイトルへ戻りますか？', 'タイトルへ戻る'] : null); else go();
}
function openAfterword(from = 'record') {
  colFrom = from === 'ending' && state.ending && !$('#ending').hidden ? 'ending' : 'record';
  const col = $('#column'); col.dataset.pre = ''; col.dataset.from = colFrom;
  const data = nightInput();
  withLastNight(() => { const s = $('#col-said-road'); if (s) s.textContent = has('said2031') ? '2031年まではやってるよ。連絡通路は24時間通れる。' : '地下に駅までの連絡通路があるから、そこを通れば濡れないよ。'; applySpoilers(false); colInit(); });
  for (const d of col.querySelectorAll('details')) d.open = false;
  const close = $('#column-close'); close.textContent = colFrom === 'ending' ? 'タイトルへ' : '記録へ'; close.setAttribute('aria-label', colFrom === 'ending' ? 'タイトルへ戻る' : '記録へ戻る');
  const id = data?.state.ending; const opts = { yuki: () => window.MiIF?.unlockNote?.() || null, openYuki: () => window.MiIF?.open?.('report'), shareEnding: data ? () => import('./share.js').then(sh => sh.openShare(data.ending)).catch(() => {}) : null };
  if (colFrom === 'ending') {
    if (canStepBack(id)) opts.stepBack = () => { col.hidden = true; resumeCheckpoint(); };
    if (id === 'true' && hasGate()) opts.gate = () => { col.hidden = true; resumeCheckpoint('mi-gate-checkpoint'); };
    const cls = id && state.classPid ? { cid: state.classId, pid: state.classPid, title: state.classTitle } : null; // 授業の夜は、同じ授業・同じ参加者のまま次の夜へ（送った結果は変わらない）
    opts.restart = () => leaveNight(() => { reset(); setTimeout(() => { if ($('#title').hidden) return; if (cls) beginClassNight(cls); else $('#start').click(); }, 3000); });
    opts.leave = ['タイトルへ戻る', () => leaveNight(reset, true)];
  } else opts.leave = ['記録へ戻る', () => $('#column-close').click()];
  const pid = data?.state.classPid; opts.classNight = !!(pid && CL.entry(pid));
  return import('./report.js').then(m => {
    const box = $('#col-class'); box.hidden = true; box.replaceChildren();
    m.renderReport($('#report-root'), data, opts);
    // 授業の夜の結果なら「結果を送る」の欄を「次にできること」の先頭に（送るのは本人が押したときだけ）
    if (opts.classNight) import('./class.js').then(c => c.paintReportBox(box, pid)).catch(err => console.warn(err));
    col.hidden = false; col.scrollTop = 0; requestAnimationFrame(() => $('#rp-type')?.focus({ preventScroll: true }));
  }).catch(err => console.warn(err));
}
addEventListener('mi:afterword', () => openAfterword('record'));
// After the last line of an ending: the ▼ (or a tap anywhere, or Enter) goes on to 今夜の行動. Never on a timer.
function endingNext() { return !$('#ending').hidden && $('.ending-actions').classList.contains('in') && !$('#report-btn').hidden && $('#column').hidden && !document.getElementById('restart-confirm'); }
$('#report-btn').onclick = () => openAfterword('ending');
$('#ending').addEventListener('click', e => { if (e.target.closest('button, a')) return; if (endingNext()) openAfterword('ending'); });
addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest?.('button, input, textarea, a, summary') && endingNext()) { e.preventDefault(); openAfterword('ending'); } });
// はじめから / タイトルへ after a bad ending: asks once, so a stray tap does not throw away the step-back point.
function confirmRestart(yes, words) {
  const [title, okLabel] = words || ['はじめから遊びますか？', 'はじめから遊ぶ'];
  document.getElementById('restart-confirm')?.remove();
  const back = document.activeElement;
  const d = el('div', 'restart-confirm'); d.id = 'restart-confirm'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'rc-title');
  const box = el('div', 'rc-box'); const t = el('p', 'rc-title', title); t.id = 'rc-title';
  const close = () => { d.remove(); removeEventListener('keydown', onKey, true); try { back?.focus?.(); } catch {} };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const ok = el('button', 'rc-yes', okLabel); ok.onclick = () => { close(); yes(); };
  const no = el('button', 'rc-no', 'やめる'); no.onclick = close;
  const row = el('div', 'rc-row'); row.append(no, ok);
  box.append(t, el('p', 'rc-text', '「結末の直前に戻る」ための地点は消えます。今夜の結果は、タイトルの「記録」の「前回の結果」で見られます。'), row);
  d.append(box); d.onclick = e => { if (e.target === d) close(); }; document.body.append(d);
  addEventListener('keydown', onKey, true); no.focus({ preventScroll: true });
}
$('#column-close').onclick = () => {
  if (colFrom === 'ending' && !$('#ending').hidden) { leaveNight(reset, true); return; }
  $('#column').hidden = true;
  if (colFrom === 'record') { window.MiIF?.paintRecord?.('top'); const r = $('#record'); if (r) r.hidden = false; }
};
$('#spoiler-btn').onclick = () => applySpoilers(true);
function toggleSound() { sound = !sound; try { localStorage.setItem('mi-sound', sound ? 'on' : 'off'); } catch {} $('#sound').classList.toggle('on', sound); $('#title-sound').classList.toggle('on', sound); Snd.setMuted(!sound); if (!sound) Snd.stopSay(); soundTip(); }
// The name shown on hover (and once on touch screens) says what a press will do.
function soundTip() { $('#sound').dataset.tip = sound ? '音を消す' : '音を出す'; $('#sound').setAttribute('aria-label', sound ? '音を消す' : '音を出す'); }
$('#sound').onclick = toggleSound;
$('#title-sound').onclick = toggleSound;
// The title shows the in-world date: today's month, day and time, in 2030.
(function titleDate() {
  const d = new Date(); d.setFullYear(2030); const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const label = () => (A.gameNow().getHours() < 5 ? '2030年11月6日（水）　' : '2030年11月5日（火）　') + A.clock();
  $('#title-date').textContent = label();
  setInterval(() => { $('#title-date').textContent = label(); }, 20000);
})();
A.onNotify(app => Snd.pop(app));
addEventListener('keydown', event => {
  if (!$('#phone').hidden || !$('#bag').hidden || !state.started || state.ending || event.target.tagName === 'INPUT' || !$('#title').hidden || !roomReady) return;
  if (inspecting === 'keypad') {
    if (/^[0-9]$/.test(event.key)) keypad(event.key);
    else if (event.key === 'Backspace') { event.preventDefault(); keypad('消'); }
    else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') keypad('開');
  } else if (event.key === 'ArrowLeft') turnView(-1);
  else if (event.key === 'ArrowRight') turnView(1);
  else if (event.key === 'Escape' && $('#voice').classList.contains('open')) openLog(false);
});

// ───────── 授業・ワークショップ（class.js から呼ぶ。Firebase は class.js が必要なときだけ読む） ─────────
// 授業の夜を始める：いまの続きを消して（class.js が先に確認する）、授業と参加者IDを入れてから始める。
function beginClassNight({ cid, pid, title }) {
  try { localStorage.removeItem('mi-if-consent:run:v1'); } catch {}
  wipeNight(); state.classId = cid; state.classPid = pid; state.classTitle = title; save();
  for (const p of document.querySelectorAll('.panel')) p.hidden = true;
  titleMenu(); start();
}
window.MiGame = { beginClassNight, resume: () => { for (const p of document.querySelectorAll('.panel')) p.hidden = true; titleMenu(); start(); }, save: () => ({ started: !!state.started, ended: !!state.ending, classId: state.classId, classPid: state.classPid, classTitle: state.classTitle }), startPersonal: () => { for (const p of document.querySelectorAll('.panel')) p.hidden = true; $('#start').click(); } };
const openClass = (view, arg) => import('./class.js').then(c => c.open(view, arg)).catch(err => console.warn(err));
$('#title-code').onclick = () => openClass('code');
{ const c = new URLSearchParams(location.search).get('c'); if (c) openClass('join', c); } // QR・専用URL（/?c=コード）はコード入力を飛ばす

// Loading failed (a module that would not load, or the room that could not be built): the note on the title, and a button that
// fetches the page's files again before reloading (index.html).
function bootFailed() {
  for (const p of document.querySelectorAll('.panel')) p.hidden = true;
  if ($('#title').hidden) { document.body.classList.add('on-title'); $('#title').hidden = false; }
  window.__miBootFail?.();
}
// Title screen remembers you.
(function title() {
  document.body.classList.add('on-title');
  renderTitleMemory(); titleMenu(); bagBadge();
  titleGlitch = createTitleGlitch($('#title')); titleGlitch.start(); // only after an ending (the title gets worn); a first visit is calm
  const w = A.world();
  // A page reload in the middle of a session (iOS drops heavy tabs) goes straight back into the room instead of the title.
  let resume = false; try { const at = Number(localStorage.getItem('mi-resume-at') || 0); const reload = (performance.getEntriesByType('navigation')[0] || {}).type === 'reload'; resume = reload && Date.now() - at < 3 * 3600 * 1000 && state.started && state.prologueDone && !state.ending; } catch {} // opening the link always shows the title; only an actual reload skips it
  if (resume) { titleGlitch.stop(); setTimeout(() => { start(); A.notify('ミー', '……戻ってきた？ 画面が一度消えたよ。'); }, 50); }
  renderTitleMemory(); whisperIn(false);
  requestAnimationFrame(() => titleGlitch.repaint());
  A.readBattery().then(updateStatus);
  A.consoleWhisper(state.name);
  updateStatus();
  // The title works from here. index.html stops its 「読み込みに失敗しました」 watch and hands over a press made before this moment.
  window.__miBoot?.(resume);
  // three.js and the room's code are fetched while the title is read (not built: that waits for the night). A failure here is the
  // stale-file case (a new page with old modules): say so on the title, as for a failed start.
  const fetchRoom = () => loadRoomModules().catch(err => { console.warn(err); bootFailed(); });
  if (!resume) { if ('requestIdleCallback' in window) requestIdleCallback(fetchRoom, { timeout: 2500 }); else setTimeout(fetchRoom, 1200); }
})();
