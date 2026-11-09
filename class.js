// 授業・ワークショップの学生側の画面：コードを入力 → 授業の案内 → 番号・表示名 → 参加 ／ 結果を送る（確認つき）／ 送った結果を削除する。
// ここの文は、ミーの台詞や作中の通知と混ぜない（普通の言葉で短く）。Firebase（fb.js）は、通信が要る操作のときだけ読み込む。
import * as CL from './class-local.js';
import { Q1, q1Text, REFLECT_QS, REFLECT_MAX, LABEL_MAX, ACTS, actText, AXIS, endingText, buildSubmission, VERSIONS } from './class-data.js';
import { TYPES } from './report.js';

if (!document.getElementById('class-css')) { const l = document.createElement('link'); l.id = 'class-css'; l.rel = 'stylesheet'; l.href = new URL('./class.css', import.meta.url).href; document.head.append(l); }
let fbp = null; const fb = () => (fbp ||= import('./fb.js'));
const $ = s => document.querySelector(s);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, fn, cls = '') => { const b = h('button', 'cl-btn ' + cls, label); b.type = 'button'; b.onclick = fn; return b; };
const when = ms => { const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ERR = {
  network: 'つながりませんでした。通信を確かめて、もう一度押してください。',
  other: 'うまくいきませんでした。少し待って、もう一度押してください。'
};
async function errKind(e) { try { return (await fb()).kind(e); } catch { return 'network'; } }

// QR・専用URLの「?c=」は、参加するか「参加せずに遊ぶ」を選んだら外す（再読み込みで同じ案内が出続けないように）
function cleanUrl() { try { const u = new URL(location.href); if (u.searchParams.has('c')) { u.searchParams.delete('c'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } } catch {} }

function show(build) {
  const p = $('#class'), box = $('#class-in'); box.replaceChildren(); build(box); p.hidden = false; p.scrollTop = 0;
  requestAnimationFrame(() => box.querySelector('h2')?.focus({ preventScroll: true }));
}
function head(box, title, kicker) {
  const hd = h('header', 'cl-head'); const t = h('div', 'cl-titles');
  if (kicker) t.append(h('p', 'cl-kicker', kicker));
  const h2 = h('h2', '', title); h2.id = 'cl-title'; h2.tabIndex = -1; t.append(h2);
  const c = h('button', 'panel-close', '閉じる'); c.type = 'button'; c.dataset.close = ''; c.onclick = cleanUrl;
  hd.append(t, c); box.append(hd);
}
const msgLine = () => { const m = h('p', 'cl-msg'); m.setAttribute('role', 'status'); m.setAttribute('aria-live', 'polite'); return m; };
const say = (m, text, err) => { m.textContent = text; m.classList.toggle('err', !!err); };
const playAlone = () => { cleanUrl(); window.MiGame?.startPersonal(); };

export async function open(view, arg) {
  if (view === 'code') return viewCode();
  if (view === 'join') return viewJoin(CL.normCode(arg));
  if (view === 'send') return viewSend(arg);
}

// ───────── コードを入力 ─────────
function viewCode(prefill = '', error = '') {
  show(box => {
    head(box, 'コードを入力');
    box.append(h('p', 'cl-lead', '先生から伝えられた6文字の参加コードを入れてください。'));
    const f = h('form', 'cl-form'); f.noValidate = true;
    const lab = h('label', 'cl-label', '参加コード'); lab.htmlFor = 'cl-code';
    const inp = h('input', 'cl-input cl-code'); Object.assign(inp, { id: 'cl-code', maxLength: 6, autocomplete: 'off', spellcheck: false, value: prefill, placeholder: '例：K7MQ3P' }); inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('enterkeyhint', 'go');
    const m = msgLine(); if (error) say(m, error, true);
    const go = h('button', 'cl-btn main', '次へ'); go.type = 'submit';
    f.append(lab, inp, m, go);
    f.onsubmit = e => { e.preventDefault(); const code = CL.normCode(inp.value); if (!CL.CODE_RE.test(code)) { say(m, 'コードは英字と数字の6文字です。もう一度確かめてください。', true); inp.focus(); return; } viewJoin(code); };
    box.append(f);
    const mine = CL.joined();
    if (mine.length) {
      const sec = h('section', 'cl-sub'); sec.append(h('h3', '', 'この端末で参加した授業'));
      for (const x of mine) { const b = btn(`${x.title}（${x.label}）`, () => viewJoin(x.cid), 'row'); sec.append(b); }
      box.append(sec);
    }
    setTimeout(() => inp.focus({ preventScroll: true }), 50);
  });
}

// ───────── 授業の案内と参加 ─────────
async function viewJoin(code) {
  if (!CL.CODE_RE.test(code)) { viewCode(code, 'コードは英字と数字の6文字です。もう一度確かめてください。'); return; }
  show(box => { head(box, '授業を確かめています…'); });
  let pub = null;
  try { pub = await (await fb()).getPub(code); }
  catch (e) { show(box => { head(box, 'つながりませんでした'); box.append(h('p', 'cl-lead', ERR.network)); const row = h('div', 'cl-row'); row.append(btn('もう一度ためす', () => viewJoin(code), 'main'), btn('参加せずに遊ぶ', playAlone)); box.append(row); }); return; }
  if (!pub) { viewCode(code, `「${code}」の授業は見つかりませんでした。コードを確かめてください。`); return; }
  const pid = CL.currentPid(code), me = CL.entry(pid);
  if (me) CL.setEntry(pid, { title: pub.title });
  show(box => {
    head(box, pub.title, '参加する授業');
    if (pub.guide) { const g = h('p', 'cl-guide'); g.append(h('span', 'cl-from', '先生から'), document.createTextNode(pub.guide)); box.append(g); }
    const ul = h('ul', 'cl-points');
    for (const t of ['遊び終わったあと、行動レポートの結果を先生に送れます。', '送る前に、送る内容を確かめられます。送るまで、先生には何も届きません。', 'ログインやメールアドレスは要りません。遊んだ記録は、この端末に保存されます。']) ul.append(h('li', '', t));
    box.append(ul);
    const sv = window.MiGame?.save() || {};
    if (me) { joinedBlock(box, code, pid, me, pub, sv); return; }
    if (!pub.joinOpen) { box.append(h('p', 'cl-warn', 'この授業は、参加の受付を終えています。')); const row = h('div', 'cl-row'); row.append(btn('参加せずに遊ぶ', playAlone, 'main')); box.append(row); return; }
    joinForm(box, code, pub, sv, '');
  });
}
function joinForm(box, code, pub, sv, note) {
  const f = h('form', 'cl-form'); f.noValidate = true;
  const lab = h('label', 'cl-label', '授業内の番号または表示名'); lab.htmlFor = 'cl-label';
  const inp = h('input', 'cl-input'); Object.assign(inp, { id: 'cl-label', maxLength: LABEL_MAX, autocomplete: 'off', spellcheck: false, placeholder: '例：12' }); inp.setAttribute('enterkeyhint', 'go');
  const hint = h('p', 'cl-hint', '実名でなくてかまいません。先生に分かる番号や呼び名を入れてください（20文字まで）。');
  f.append(lab, inp, hint);
  if (note) f.append(h('p', 'cl-hint', note));
  if (sv.started && !sv.ended) f.append(h('p', 'cl-warn', sv.classId ? `授業「${sv.classTitle}」で遊んでいる続きは消えます。` : 'いま遊んでいる続きは消えます。'));
  const m = msgLine(); const go = h('button', 'cl-btn main', '参加して始める'); go.type = 'submit';
  const row = h('div', 'cl-row'); row.append(go, btn('参加せずに遊ぶ', playAlone));
  f.append(m, row);
  f.onsubmit = async e => {
    e.preventDefault(); const label = inp.value.trim();
    if (!label) { say(m, '番号または表示名を入れてください。', true); inp.focus(); return; }
    go.disabled = true; say(m, '参加しています…');
    const pid = CL.newPid();
    try { await (await fb()).join(code, pid); }
    catch (err) {
      go.disabled = false; const k = await errKind(err);
      if (k === 'denied') { let p = null; try { p = await (await fb()).getPub(code); } catch {} say(m, p && !p.joinOpen ? 'この授業は、参加の受付を終えています。' : ERR.other, true); }
      else say(m, k === 'network' ? ERR.network : ERR.other, true);
      return;
    }
    CL.setEntry(pid, { cid: code, title: pub.title, label, joinedAt: Date.now() }); CL.setCurrent(code, pid);
    cleanUrl(); window.MiGame?.beginClassNight({ cid: code, pid, title: pub.title });
  };
  box.append(f); setTimeout(() => inp.focus({ preventScroll: true }), 50);
}
function joinedBlock(box, code, pid, me, pub, sv) {
  box.append(h('p', 'cl-state', `番号・表示名「${me.label}」で参加しています。`));
  if (me.sent) box.append(h('p', 'cl-hint', `結果は送信済みです（${when(me.sent.at)}）。`));
  else if (me.night) box.append(h('p', 'cl-hint', 'この授業の結果は、まだ送っていません。'));
  const row = h('div', 'cl-col');
  const playing = sv.classPid === pid && sv.started && !sv.ended;
  if (playing) row.append(btn('続きから遊ぶ', () => { cleanUrl(); window.MiGame?.resume(); }, 'main'));
  if (me.sent) row.append(btn('送った結果を見る', () => viewSent(pid), playing ? '' : 'main'));
  else if (me.night) row.append(btn('結果を送る', () => viewSend(pid), playing ? '' : 'main'));
  const fresh = () => { cleanUrl(); window.MiGame?.beginClassNight({ cid: code, pid, title: pub.title }); };
  row.append(btn('この授業で新しく遊ぶ', () => (sv.started && !sv.ended) ? confirmBox(box, playing ? 'いま遊んでいる続きは消えます。送った結果は変わりません。' : 'いま遊んでいる続きは消えます。', '続きを消して遊ぶ', fresh) : fresh(), (!playing && !me.night && !me.sent) ? 'main' : ''));
  box.append(row);
  const sub = h('div', 'cl-links');
  const other = h('button', 'cl-link', '別の参加者として始める'); other.type = 'button';
  other.onclick = () => show(b2 => {
    head(b2, pub.title, '別の参加者として始める');
    if (!pub.joinOpen) { b2.append(h('p', 'cl-warn', 'この授業は、参加の受付を終えています。新しい参加者は加われません。')); b2.append(btn('戻る', () => viewJoin(code))); return; }
    joinForm(b2, code, pub, sv, `この端末で、別の人として参加します。「${me.label}」の結果と送った内容は、そのまま残ります。`);
  });
  const alone = h('button', 'cl-link', '参加せずに遊ぶ'); alone.type = 'button'; alone.onclick = playAlone;
  sub.append(other, alone); box.append(sub);
}
function confirmBox(box, text, yesLabel, yes) {
  box.querySelector('.cl-confirm')?.remove();
  const c = h('div', 'cl-confirm'); c.setAttribute('role', 'alertdialog'); c.append(h('p', '', text));
  const row = h('div', 'cl-row'); const no = btn('やめる', () => c.remove()); row.append(btn(yesLabel, () => { c.remove(); yes(); }, 'main danger'), no);
  c.append(row); box.append(c); no.focus({ preventScroll: true }); c.scrollIntoView({ block: 'nearest' });
}

// ───────── 結果を送る（振り返り → 送る内容の確認 → 送る） ─────────
function viewSend(pid) {
  const me = CL.entry(pid);
  if (!me) return;
  if (!me.night) { show(box => { head(box, '結果を送る', `授業「${me.title}」`); box.append(h('p', 'cl-lead', 'この授業の結果は、まだありません。遊び終わると、ここから送れます。')); }); return; }
  if (me.sent && me.sent.endedAt === me.night.endedAt) { viewSent(pid); return; }
  stepReflect(pid);
}
function stepReflect(pid) {
  const me = CL.entry(pid); const draft = me.draft || {};
  show(box => {
    head(box, '結果を送る', `授業「${me.title}」`);
    box.append(h('p', 'cl-lead', '送る前に、遊んだあとの問いと、二つの振り返りに答えてください。答えなくても送れます。'));
    const save = patch => CL.setEntry(pid, { draft: { ...(CL.entry(pid).draft || {}), ...patch } });
    // プレイ後の問い（はじめる前と同じ文）
    const fs = h('fieldset', 'cl-q'); fs.append(h('legend', '', me.pre ? '遊んだあとの問い（はじめる前にも聞いた問い）' : '遊んだあとの問い'));
    for (const line of Q1.q.split('\n')) fs.append(h('p', 'cl-qtext', line));
    for (const [v, label] of [...Q1.opts, ['', '答えない']]) {
      const l = h('label', 'cl-opt'); const r = h('input'); r.type = 'radio'; r.name = 'cl-post'; r.value = v; r.checked = (draft.post ?? '') === v;
      r.onchange = () => save({ post: v }); l.append(r, h('span', '', label)); fs.append(l);
    }
    box.append(fs);
    for (const [k, q] of REFLECT_QS) {
      const wrap = h('div', 'cl-field'); const lab = h('label', 'cl-label', q); lab.htmlFor = 'cl-' + k;
      const ta = h('textarea', 'cl-input'); ta.id = 'cl-' + k; ta.rows = 4; ta.maxLength = REFLECT_MAX; ta.value = draft[k] || '';
      const cnt = h('p', 'cl-count', `${ta.value.length}／${REFLECT_MAX}字`);
      ta.oninput = () => { cnt.textContent = `${ta.value.length}／${REFLECT_MAX}字`; save({ [k]: ta.value }); };
      wrap.append(lab, ta, cnt); box.append(wrap);
    }
    box.append(h('p', 'cl-hint', '名前など、誰のことか分かることは書かないでください。書いた内容は、送るまでこの端末にだけ保存されます。'));
    const row = h('div', 'cl-row'); row.append(btn('送る内容を確かめる', () => stepConfirm(pid), 'main'), btn('あとで送る', () => { $('#class').hidden = true; }));
    box.append(row);
  });
}
// 送るものを、人が読める言葉で並べる（内部IDは出さない）
function contentList(d, { title, preSkipped } = {}) {
  const dl = h('dl', 'cl-send');
  const row = (k, v) => { dl.append(h('dt', '', k)); const dd = h('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };
  if (title) row('送り先', `授業「${title}」の先生（授業を作った先生だけが見られます）`);
  row('番号・表示名', d.label);
  row('今回のタイプ', TYPES[d.type]?.name || d.type);
  { const ul = h('ul', 'cl-ev'); for (const e of d.ev || []) { const li = h('li'); li.append(h('span', 'ax', AXIS[e.axis] || ''), document.createTextNode(e.text)); ul.append(li); } if (d.safe?.text) { const li = h('li'); li.append(h('span', 'ax', '備え'), document.createTextNode(d.safe.text)); ul.append(li); } if (!ul.childElementCount) ul.append(h('li', '', '（判定に使える行動はありませんでした）')); row('タイプの判定に使った行動', ul); }
  { const ul = h('ul', 'cl-acts'); for (const a of ACTS) if (a.k in (d.acts || {})) ul.append(h('li', '', `${a.label}：${actText(a.k, d.acts[a.k])}`)); if (!ul.childElementCount) ul.append(h('li', '', '（記録なし）')); row('主な行動の記録', ul); }
  { const f = document.createDocumentFragment(); f.append(endingText(d.ending), h('small', 'cl-note', '先生の集計に使います。')); row('たどり着いた結末', f); }
  row('はじめる前の問い', d.pre ? q1Text(d.pre) : preSkipped ? '答えなかった' : '記録なし');
  row('遊んだあとの問い', d.post ? q1Text(d.post) : '答えない');
  for (const [k, q] of REFLECT_QS) row(`振り返り：${q.slice(0, 18)}…`, d[k] || '（書かなかった）');
  row('そのほか', `送った日時、ゲームと問いと判定のバージョン（${d.v?.game || VERSIONS.game}）`);
  return dl;
}
async function stepConfirm(pid) {
  const me = CL.entry(pid); const dr = me.draft || {};
  const data = buildSubmission({ pid, label: me.label, night: me.night, pre: me.pre, post: dr.post, r1: dr.r1, r2: dr.r2 });
  let pub = null, net = false; try { pub = await (await fb()).getPub(me.cid); } catch { net = true; }
  show(box => {
    head(box, '送る内容の確認', `授業「${me.title}」`);
    box.append(contentList(data, { title: me.title, preSkipped: me.preSkipped }));
    const no = h('p', 'cl-hint'); no.append(h('b', '', '送らないもの：'), document.createTextNode('主人公の名前、ミーとの会話、メールアドレス、端末の情報')); box.append(no);
    box.append(h('p', 'cl-hint', '送った結果は、先生が授業を削除するまで保存されます。この端末から、いつでも削除できます。'));
    if (me.sent) box.append(h('p', 'cl-warn', me.sent.endedAt === me.night.endedAt ? `前に送った内容（${when(me.sent.at)}）と置き換わります。` : `前に送った結果（${when(me.sent.at)}）と置き換わります。前の結果は先生の画面から消えます。`));
    const m = msgLine(); const send = h('button', 'cl-btn main', '結果を送る'); send.type = 'button';
    if (!net && (!pub || !pub.submitOpen)) { send.disabled = true; say(m, !pub ? 'この授業は削除されたため、送れません。結果はこの端末に残っています。' : '先生が提出の受付を終えているため、送れません。結果はこの端末に残っていて、行動レポートはいつでも見られます。', true); }
    let busy = false;
    send.onclick = async () => {
      if (busy) return; busy = true; send.disabled = true; say(m, '送っています…');
      try {
        const saved = await (await fb()).submit(me.cid, pid, data);
        CL.setEntry(pid, { sent: { at: saved?.at?.toMillis?.() || Date.now(), endedAt: me.night.endedAt } });
        viewSent(pid, true); return;
      } catch (err) {
        const k = await errKind(err); let p = null; if (k === 'denied') { try { p = await (await fb()).getPub(me.cid); } catch {} }
        say(m, k === 'network' ? ERR.network + '何度押しても、送られる結果は1件だけです。' : k === 'denied' && p && !p.submitOpen ? '先生が提出の受付を終えたため、送れませんでした。結果はこの端末に残っています。' : ERR.other, true);
        send.disabled = !!(p && !p.submitOpen); busy = false;
      }
    };
    const row = h('div', 'cl-row'); row.append(send, btn('戻って直す', () => stepReflect(pid)));
    box.append(m, row);
  });
}
async function viewSent(pid, justNow) {
  const me = CL.entry(pid);
  show(box => { head(box, justNow ? '送りました' : '送った結果', `授業「${me.title}」`); box.append(h('p', 'cl-lead', '送った内容を確かめています…')); });
  let sub = null, net = false; try { sub = await (await fb()).mySub(me.cid, pid); } catch { net = true; }
  show(box => {
    head(box, justNow ? '送りました' : '送った結果', `授業「${me.title}」`);
    const m = msgLine();
    if (net) box.append(h('p', 'cl-warn', ERR.network));
    else if (!sub) { box.append(h('p', 'cl-warn', '送った結果は、いま先生の画面にありません（先生か本人が削除しました）。もう一度送ることができます。')); CL.setEntry(pid, { sent: null }); }
    else { box.append(h('p', 'cl-lead', `授業「${me.title}」の先生に送りました（${when(sub.at?.toMillis?.() || me.sent?.at || Date.now())}）。先生の画面に出ている内容です。`)); box.append(contentList(sub, { preSkipped: me.preSkipped })); }
    const fresh = me.night && me.sent && me.night.endedAt !== me.sent.endedAt;
    if (fresh) box.append(h('p', 'cl-hint', 'この端末には、送ったあとに遊んだ新しい結果があります。送るまで、先生の画面は前の結果のままです。'));
    const row = h('div', 'cl-col');
    if (fresh || !sub) row.append(btn(sub ? '新しい結果を送る（前の結果と置き換わります）' : '結果を送る', () => stepReflect(pid), 'main'));
    if (sub) row.append(btn('振り返りを直して送り直す', () => stepReflect(pid)));
    if (sub) row.append(btn('送った結果を削除する', () => confirmBox(box, '送った結果を削除しますか？ 先生の画面からも消えます。この端末の記録は残ります。', '削除する', async () => {
      say(m, '削除しています…');
      try { await (await fb()).unsubmit(me.cid, pid); CL.setEntry(pid, { sent: null }); viewDeleted(pid); }
      catch (err) { const k = await errKind(err); say(m, k === 'network' ? ERR.network : ERR.other, true); }
    }), 'danger'));
    row.append(btn('閉じる', () => { $('#class').hidden = true; }));
    box.append(m, row);
    window.dispatchEvent(new CustomEvent('mi:class-sent'));
  });
}
function viewDeleted(pid) {
  const me = CL.entry(pid);
  show(box => { head(box, '削除しました', `授業「${me.title}」`); box.append(h('p', 'cl-lead', '送った結果を削除しました。先生の画面からも消えています。この端末の行動レポートはそのまま見られます。')); const row = h('div', 'cl-col'); row.append(btn('結果をもう一度送る', () => stepReflect(pid)), btn('閉じる', () => { $('#class').hidden = true; })); box.append(row); });
  window.dispatchEvent(new CustomEvent('mi:class-sent'));
}

// ───────── 行動レポートの「結果を送る」の欄 ─────────
export function paintReportBox(box, pid) {
  const draw = () => {
    const me = CL.entry(pid); box.replaceChildren(); if (!me || !me.night) { box.hidden = true; return; }
    box.append(h('p', 'cc-kicker', '授業・ワークショップ'), h('h2', 'cc-title', `授業「${me.title}」`));
    const same = me.sent && me.sent.endedAt === me.night.endedAt;
    let text, label;
    if (!me.sent) { text = 'この夜の結果を、先生に送れます。送る前に、内容を確かめられます。'; label = '結果を送る'; }
    else if (same) { text = `この結果は送信済みです（${when(me.sent.at)}）。`; label = '送った結果を見る'; }
    else { text = `前に送った結果があります（${when(me.sent.at)}）。この夜の結果は、まだ送っていません。送ると、前の結果と置き換わります。`; label = '新しい結果を送る'; }
    box.append(h('p', 'cc-text', text));
    const b = h('button', 'cc-btn', label); b.type = 'button'; b.onclick = () => viewSend(pid); box.append(b);
    box.hidden = false;
  };
  draw();
  if (box._draw) window.removeEventListener('mi:class-sent', box._draw);
  box._draw = draw; window.addEventListener('mi:class-sent', draw);
}
