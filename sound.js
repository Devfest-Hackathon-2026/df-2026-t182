// Procedural ambience and cues (Web Audio, no files). Everything is quiet on purpose.
// Phone speakers barely reproduce anything under ~150Hz, so every low drone carries a quiet third harmonic.
let ctx = null, master = null, muted = false;
let volume = 1;           // 0..1 from the settings screen (mi-settings.volume); the master level is .6 × volume
let bed = null;          // current ambience nodes
let bedLevel = 1;        // 0..1 multiplier for silence() and ducking
let birdTimer = null;
let dread = null, dreadHi = null; // low drone that rises with doubt (the higher partial rises faster)
let rainNodes = null;
let seamGain = .03;      // the click at the end of the bird loop (the splice in the recording)

function noiseBuffer(seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
function noise(filterType, frequency, gain, ramp = 2.5) {
  const source = ctx.createBufferSource(); source.buffer = noiseBuffer(); source.loop = true;
  const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = .7;
  const level = ctx.createGain(); level.gain.value = 0;
  source.connect(filter).connect(level).connect(master); source.start();
  level.gain.linearRampToValueAtTime(gain, ctx.currentTime + ramp);
  return { source, level, filter, target: gain };
}
function tone(type, frequency, gain, ramp = 2.5) {
  const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = frequency;
  const level = ctx.createGain(); level.gain.value = 0;
  osc.connect(level).connect(master); osc.start();
  level.gain.linearRampToValueAtTime(gain, ctx.currentTime + ramp);
  return { source: osc, level, target: gain };
}
// A low sine plus its third harmonic at half the level: the same drone, audible on a phone.
function low(frequency, gain, ramp = 2.5) { return [tone('sine', frequency, gain, ramp), tone('sine', frequency * 3, gain * .5, ramp)]; }
function fadeOut(node, seconds = 1.5) {
  if (!node) return;
  node.level.gain.cancelScheduledValues(ctx.currentTime);
  node.level.gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
  setTimeout(() => { try { node.source.stop(); } catch {} }, seconds * 1000 + 100);
}

// iOS and Chrome keep an AudioContext suspended until a tap, and suspend it again when the app goes to the background.
// Resume on the next tap after either, so the sound never stays off for the rest of the night.
function wake() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }
addEventListener('pointerdown', wake, true); addEventListener('touchend', wake, true);
addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
addEventListener('pageshow', wake);
export function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : .6 * volume; master.connect(ctx.destination);
    dread = tone('sine', 38, 0); dread.level.gain.value = 0;
    dreadHi = tone('sine', 76, 0); dreadHi.level.gain.value = 0;
  } catch { ctx = null; }
}
function level(seconds) { if (!master) return; const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(muted ? 0 : .6 * volume, t + seconds); }
export function setMuted(value) { muted = value; level(.3); }
export function setVolume(value) { volume = Math.max(0, Math.min(1, Number(value) || 0)); level(.12); }
export function getVolume() { return volume; }

// zone: 'dark' | 'room' | 'storage' | 'lobby' | 'lobby-off' | 'none'
export function setScene(zone) {
  if (!ctx) return;
  clearInterval(birdTimer); birdTimer = null;
  if (bed) { bed.forEach(n => fadeOut(n)); bed = null; }
  bedLevel = 1;
  if (zone === 'dark') bed = [noise('lowpass', 120, .05), ...low(52, .02)];
  else if (zone === 'room') bed = [tone('sawtooth', 100, .006), noise('bandpass', 2400, .012), noise('lowpass', 150, .03)];
  else if (zone === 'storage') bed = [noise('lowpass', 90, .07), ...low(47, .025)];
  else if (zone === 'lobby') {
    bed = [noise('lowpass', 260, .09), ...low(60, .015)];
    birdTimer = setInterval(bird, 9000); setTimeout(bird, 1200);
  } else if (zone === 'lobby-off') bed = [noise('lowpass', 70, .04), ...low(41, .03)];
}
// Fluorescent tubes do not come on cleanly: the room hum starts loud and settles.
export function lampHum() { if (!ctx || !bed) return; const hum = bed.find(n => n.source.type === 'sawtooth'); if (!hum) return; hum.level.gain.cancelScheduledValues(ctx.currentTime); hum.level.gain.setValueAtTime(.02, ctx.currentTime); hum.level.gain.linearRampToValueAtTime(.006, ctx.currentTime + 3); }
// Lower the storage bed's cutoff as the door narrows: the corridor's sound closes.
export function closeIn(hz = 60, seconds = 1.6) { if (!ctx || !bed) return; for (const n of bed) if (n.filter && n.filter.type === 'lowpass') n.filter.frequency.linearRampToValueAtTime(hz, ctx.currentTime + seconds); }
// Pull the bed to nothing for a moment. Fear lives in the gap.
export function silence(ms, out = .3, back = 1.2) {
  if (!ctx || !bed) return;
  const t = ctx.currentTime;
  for (const n of bed) { n.level.gain.cancelScheduledValues(t); n.level.gain.setValueAtTime(n.level.gain.value, t); n.level.gain.linearRampToValueAtTime(0, t + out); }
  const mine = bed;
  setTimeout(() => { if (bed !== mine || !ctx) return; const t2 = ctx.currentTime; for (const n of mine) n.level.gain.linearRampToValueAtTime(n.target * bedLevel, t2 + back); }, ms);
}
export function duck(level, seconds = .6) {
  if (!ctx || !bed) return; bedLevel = level;
  const t = ctx.currentTime; for (const n of bed) { n.level.gain.cancelScheduledValues(t); n.level.gain.setValueAtTime(n.level.gain.value, t); n.level.gain.linearRampToValueAtTime(n.target * level, t + seconds); }
}
// Same chirp, same interval, forever — the loop is the tell. The splice at the end is the same tiny click every time.
function bird() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(g).connect(master);
    const t = t0 + i * .22;
    osc.frequency.setValueAtTime(2900, t); osc.frequency.exponentialRampToValueAtTime(4100, t + .08); osc.frequency.exponentialRampToValueAtTime(3300, t + .16);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .02); g.gain.linearRampToValueAtTime(0, t + .17);
    osc.start(t); osc.stop(t + .2);
  }
  setTimeout(() => burst(4000, .02, seamGain, 'highpass'), 700);
}
export function setSeam(gain) { seamGain = gain; }
export function setDread(level) { // 0..1
  if (!ctx || !dread) return;
  dread.level.gain.cancelScheduledValues(ctx.currentTime); dreadHi.level.gain.cancelScheduledValues(ctx.currentTime);
  dread.level.gain.linearRampToValueAtTime(Math.min(.09, level * .09), ctx.currentTime + 4);
  dreadHi.level.gain.linearRampToValueAtTime(Math.min(.06, level * level * .06), ctx.currentTime + 4);
}
function burst(frequency, duration, gain, type = 'lowpass', when = 0) {
  const source = ctx.createBufferSource(); source.buffer = noiseBuffer(1);
  const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency;
  const g = ctx.createGain(); g.gain.value = gain;
  source.connect(filter).connect(g).connect(master);
  const t = ctx.currentTime + when;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
  source.start(t); source.stop(t + duration);
}
function thud(frequency, duration, gain, when = 0) {
  const osc = ctx.createOscillator(); osc.type = 'sine';
  const g = ctx.createGain(); g.gain.value = gain;
  osc.connect(g).connect(master);
  const t = ctx.currentTime + when;
  osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(frequency * .4, t + duration);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
  osc.start(t); osc.stop(t + duration);
}
function sweep(type, from, to, duration, gain, when = 0, filterHz = 0) {
  const o = ctx.createOscillator(); o.type = type; const g = ctx.createGain(); g.gain.value = 0;
  let node = o; if (filterHz) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz; o.connect(f); node = f; }
  node.connect(g).connect(master);
  const t = ctx.currentTime + when;
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + duration);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
  o.start(t); o.stop(t + duration + .05);
}
export function birdOnce() { bird(); }
export function knock() {
  if (!ctx) return;
  [0, .5, 1].forEach(delay => { burst(420, .14, .25, 'lowpass', delay); thud(140, .12, .2, delay); });
}
export function slam(strength = 1) { if (!ctx) return; burst(300, .5, .5 * strength); thud(70, .7, .6 * strength); }
// The metal ring after a door slams shut.
export function ring() { if (!ctx) return; sweep('sine', 180, 90, 1.2, .04); }
export function click() { if (!ctx) return; burst(1800, .05, .12, 'highpass'); }
// A lock turning: two dry clicks.
export function lock() { if (!ctx) return; burst(1800, .05, .12, 'highpass'); burst(1400, .06, .1, 'highpass', .12); }
export function step(when = 0) { if (!ctx) return; thud(120, .08, .08, when); }
// Notification sounds, one per app.
export function pop(app = 'メッセージ') {
  if (!ctx) return;
  if (app === 'システム') { sweep('sine', 520, 519, .12, .05); sweep('sine', 390, 389, .14, .05, .13); return; }
  if (app === 'ミー') { sweep('sine', 660, 880, .09, .05); return; }
  if (app === '決済') { sweep('sine', 1320, 880, .12, .05); return; }
  if (app === 'つぶやき') { sweep('sine', 990, 1180, .08, .04); return; }
  const o = ctx.createOscillator(); o.type = 'sine'; const g = ctx.createGain(); g.gain.value = .06; o.connect(g).connect(master); o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + .08); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .25); o.start(); o.stop(ctx.currentTime + .3);
}
// The low "line" cue before each of Mi's lines in the dark, for when the speech voice is not there.
export function cue(muffled = false) { if (!ctx) return; sweep('sine', 520, 480, .12, muffled ? .025 : .05, 0, muffled ? 700 : 0); }
export function bootUp() { if (!ctx) return; sweep('sine', 440, 660, .3, .05); }
export function flicker() { if (!ctx) return; burst(3000, .3, .08, 'highpass'); }
// A motor behind a wall: the shutter, the door drive. Length in seconds; a thud when it lands.
export function motor(seconds = 2.5, gain = .12, land = false) {
  if (!ctx) return;
  const n = noise('lowpass', 180, gain, .3); setTimeout(() => fadeOut(n, Math.min(2, seconds * .4)), Math.max(200, (seconds - Math.min(2, seconds * .4)) * 1000));
  if (land) thud(60, .5, .3, seconds - .4);
}
export function shutter(seconds = 2.5, land = false) { motor(seconds, .12, land); }
// Rain outside. level 0..1. Steady hiss plus sparse drops.
export function rain(level = 1, fade = 3) {
  if (!ctx) return;
  stopRain(0);
  const hiss = noise('bandpass', 1200, .06 * level, fade);
  const drops = setInterval(() => { if (!ctx || Math.random() > .55) return; burst(2500, .03, .03 * level, 'highpass'); }, 170);
  rainNodes = { hiss, drops };
}
export function stopRain(seconds = 1.5) { if (!rainNodes) return; clearInterval(rainNodes.drops); if (seconds === 0) { try { rainNodes.hiss.level.gain.cancelScheduledValues(ctx.currentTime); rainNodes.hiss.level.gain.setValueAtTime(0, ctx.currentTime); rainNodes.hiss.source.stop(); } catch {} } else fadeOut(rainNodes.hiss, seconds); rainNodes = null; }
// Everything out, fast: the gap before an ending.
export function allOut(seconds = 1.5) { if (!ctx) return; clearInterval(birdTimer); birdTimer = null; if (bed) { bed.forEach(n => fadeOut(n, seconds)); bed = null; } stopRain(seconds); setDread(0); }
// Mains dropping out: a sawtooth falling away, a short crackle.
export function powerDown() { if (!ctx) return; sweep('sawtooth', 100, 30, .5, .05, 0, 400); burst(2600, .25, .06, 'highpass'); }
// A can rolling off a shelf.
export function cans() { if (!ctx) return; sweep('sine', 400, 200, .3, .08, 0); sweep('sine', 380, 190, .3, .07, .35); }
// Hard, bright: the moment a picture tears.
export function tear() { if (!ctx) return; burst(3000, .3, .12, 'highpass'); click(); }
// Nails on paint, three times.
export function scratch() { if (!ctx) return; [0, .3, .6].forEach(d => burst(2200, .08, .04, 'bandpass', d)); }
// A car door, far away.
export function carDoor() { if (!ctx) return; thud(90, .2, .12); }
// Metal scraping (shelf against the door).
export function scrape() { if (!ctx) return; burst(1800, .2, .06, 'bandpass'); }
export function quake() { if (!ctx) return; const n = noise('lowpass', 60, .22); const t = tone('sine', 28, .12); const s = tone('sawtooth', 90, .03); setTimeout(() => { fadeOut(n, 1.2); fadeOut(t, 1.2); fadeOut(s, 1.2); }, 2400); }
export function siren() {
  if (!ctx) return;
  const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
  const g = ctx.createGain(); g.gain.value = 0; o.connect(f).connect(g).connect(master);
  const t0 = ctx.currentTime; o.frequency.setValueAtTime(420, t0);
  for (let i = 0; i < 3; i++) { o.frequency.linearRampToValueAtTime(760, t0 + i * 1.2 + .6); o.frequency.linearRampToValueAtTime(420, t0 + i * 1.2 + 1.2); }
  g.gain.linearRampToValueAtTime(.08, t0 + .2); g.gain.setValueAtTime(.08, t0 + 3.2); g.gain.linearRampToValueAtTime(0, t0 + 3.8);
  o.start(t0); o.stop(t0 + 4);
  duck(.5, .3); setTimeout(() => duck(1, 1), 4000);
}
export function creak(gain = .02) { if (!ctx) return; const o = ctx.createOscillator(); o.type = 'sawtooth'; const g = ctx.createGain(); g.gain.value = gain; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; o.connect(f).connect(g).connect(master); o.frequency.setValueAtTime(180, ctx.currentTime); o.frequency.linearRampToValueAtTime(120, ctx.currentTime + 1.4); g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.6); o.start(); o.stop(ctx.currentTime + 1.7); }

// ───────── Mi's voice (pre-generated files, see tools/voice_gen.py) ─────────
// Decoded buffers are cached; a newer say() silences the one before it, even while it is still loading.
const sayCache = new Map(); let saying = null, sayTicket = 0;
const SAY_CACHE_MAX = 40; // decoded lines are ~0.5-1 MB each; keep only the recent ones (Map keeps insertion order, so the first key is the oldest)
function remember(url, buffer) { sayCache.delete(url); sayCache.set(url, buffer); while (sayCache.size > SAY_CACHE_MAX) sayCache.delete(sayCache.keys().next().value); }
export function isSaying() { return !!saying; }
export function stopSay() {
  if (!saying) return;
  const s = saying; saying = null; duck(1, .8); if (s.done) s.done(false);
  try { s.level.gain.cancelScheduledValues(ctx.currentTime); s.level.gain.setValueAtTime(s.level.gain.value, ctx.currentTime); s.level.gain.linearRampToValueAtTime(0, ctx.currentTime + .08); } catch {}
  setTimeout(() => { try { s.source.stop(); } catch {} }, 120);
}
// Published builds pack the voice files into a few larger files (an artifact can hold only so many files).
// Without packs (local dev) each line is fetched from its own mp3, as before.
let voicePacks = null; const packLoads = new Map();
export function setVoicePacks(p) { voicePacks = p && p.index && p.files ? p : null; }
let packsInFlight = 0;
// preload: true for read-ahead. Read-ahead fetches at most one pack at a time, so opening the game does not pull every pack at once
// on a phone's data; a line that is actually spoken fetches its pack straight away.
async function voiceBytes(url, preload = false) {
  const key = (url.match(/assets\/voice\/([0-9a-f]{16})\.mp3$/) || [])[1];
  const at = key && voicePacks && voicePacks.index[key];
  if (!at) { const res = await fetch(url); return res.ok ? res.arrayBuffer() : null; }
  const v = voicePacks.v && voicePacks.v[at[0]]; // the pack's content hash (tools/voice_pack.py): a changed pack is a new URL
  const file = './assets/voice/' + voicePacks.files[at[0]] + (v ? '?v=' + v : '');
  if (!packLoads.has(file)) {
    if (preload && packsInFlight > 0) return null;
    packsInFlight++;
    packLoads.set(file, fetch(file).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null).finally(() => { packsInFlight--; }));
  }
  const pack = await packLoads.get(file);
  if (!pack) { packLoads.delete(file); return null; }
  return pack.slice(at[1], at[1] + at[2]); // a copy: decoding detaches it, the pack stays whole
}
// Resolves true when the line played to its end, false when it was cut off or could not play.
export async function say(url, opts = {}) {
  if (!ctx) return false;
  const { rate = 1, detune = 0, lowpass = 0, gain = .7, pa = false } = typeof opts === 'number' ? { rate: opts } : opts;
  stopSay();
  const ticket = ++sayTicket;
  let buffer = sayCache.get(url);
  if (buffer) remember(url, buffer); // touched: keep it recent
  if (!buffer) {
    try { const bytes = await voiceBytes(url); if (!bytes) return false; buffer = await ctx.decodeAudioData(bytes); remember(url, buffer); }
    catch { return false; }
  }
  if (ticket !== sayTicket || muted) return false;
  const source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate; if (detune) source.detune.value = detune;
  const level = ctx.createGain(); level.gain.value = gain;
  if (pa) { // a tannoy: band-limited, with one short slap of the room
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    const dl = ctx.createDelay(.2); dl.delayTime.value = .085; const fb = ctx.createGain(); fb.gain.value = .22; const wet = ctx.createGain(); wet.gain.value = .35;
    source.connect(hp).connect(lp).connect(level); lp.connect(dl); dl.connect(fb).connect(dl); dl.connect(wet).connect(level); level.connect(master);
  } else if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; f.Q.value = .5; source.connect(f).connect(level).connect(master); } else source.connect(level).connect(master);
  source.start(); duck(.6, .25); // the room steps back while she speaks
  return new Promise(resolve => {
    saying = { source, level, done: resolve };
    source.onended = () => { if (saying && saying.source === source) { saying = null; duck(1, .8); resolve(true); } };
  });
}
export function preloadSay(url) { if (!ctx || sayCache.has(url)) return; voiceBytes(url, true).then(b => b && ctx.decodeAudioData(b)).then(buf => { if (buf && !sayCache.has(url)) remember(url, buf); }).catch(() => {}); }
