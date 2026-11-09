// 先生用の画面：使い方 → Google でログイン → 授業一覧 → 授業の画面（全体の傾向／個別の回答）。
// ?sample は、静的な sample.json（架空の20人分）を読むだけのサンプル授業。ログインも Firebase も使わない。
import { TYPES, ORDER } from '../report.js';
import { ACTS, actText, AXIS, Q1, q1Text, REFLECT_QS, endingText, VERSIONS } from '../class-data.js';

const $ = s => document.querySelector(s);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, fn, cls = '') => { const b = h('button', 't-btn ' + cls, label); b.type = 'button'; b.onclick = fn; return b; };
const when = ms => { if (!ms) return '—'; const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const day = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const pct = (m, n) => n ? Math.round(m / n * 100) : 0;
const main = $('#t-main');
const SAMPLE = new URLSearchParams(location.search).has('sample');
let fbp = null; const fb = () => (fbp ||= import('../fb.js'));
const ERR = { network: 'つながりませんでした。通信を確かめて、もう一度ためしてください。', denied: 'この操作はできません。ログインしているアカウントを確かめてください。', other: 'うまくいきませんでした。少し待って、もう一度ためしてください。' };
async function errText(e) { try { return ERR[(await fb()).kind(e)] || ERR.other; } catch { return ERR.network; } }
function render(build) { main.replaceChildren(); build(main); main.focus({ preventScroll: true }); scrollTo(0, 0); }
const msgLine = () => { const m = h('p', 't-msg'); m.setAttribute('role', 'status'); m.setAttribute('aria-live', 'polite'); return m; };
const say = (m, t, err) => { m.textContent = t; m.classList.toggle('err', !!err); };
const joinUrl = code => new URL(`../?c=${code}`, location.href).href;

// ───────── 入口 ─────────
async function route() {
  if (SAMPLE) { $('#t-sample').hidden = false; document.title = 'サンプル授業｜ミーを信じて'; try { const d = await (await fetch('./sample.json', { cache: 'no-cache' })).json(); classView({ code: '', ...d }, d.subs, true); } catch { render(m => m.append(h('p', 't-msg err', 'サンプルを読み込めませんでした。'))); } return; }
  let user = null; try { user = await (await fb()).teacher(); } catch (e) { render(m => { intro(m); }); return; }
  paintUser(user);
  if (!user) { render(intro); return; }
  const code = (location.hash.match(/^#\/c\/([A-Z0-9]{6})$/) || [])[1];
  if (code) openClass(code); else listView();
}
addEventListener('hashchange', () => { if (!SAMPLE) route(); });
function paintUser(u) { $('#t-who').textContent = u ? u.email || '' : ''; $('#t-out').hidden = !u; }
$('#t-out').onclick = async () => { await (await fb()).signOut(); location.hash = ''; paintUser(null); render(intro); };

function intro(m) {
  m.append(h('h1', '', '授業・ワークショップで使う'));
  m.append(h('p', 't-lead', '遊んだあと、学生が自分の判断を振り返り、その結果を先生が集めて見るための画面です。成績をつけたり、操作を見張ったりするためのものではありません。'));
  const ol = h('ol', 't-steps');
  for (const t of ['Googleアカウントでログインし、授業名を入れて授業を作ります。', '出てくるQRか専用URL、または6文字の参加コードを学生に配ります。', '学生は番号か表示名を入れて遊びます。遊び終わったら、送る内容を確かめてから結果を送ります。学生のログインは要りません。', 'この画面で、全体の傾向と、一人ずつの回答を見ます。']) ol.append(h('li', '', t));
  m.append(ol);
  const msg = msgLine();
  const row = h('div', 't-row');
  row.append(btn('Googleでログイン', async e => {
    e.target.disabled = true; say(msg, 'ログインしています…');
    try { const u = await (await fb()).signInGoogle(); if (u) { paintUser(u); listView(); } }
    catch (err) { e.target.disabled = false; say(msg, /popup-closed|cancelled/.test(err?.code || '') ? 'ログインを取りやめました。' : await errText(err), true); }
  }, 'main'));
  const s = h('a', 't-btn', 'サンプル授業を見る（架空の20人分のデータ）'); s.href = './?sample'; row.append(s);
  m.append(row, msg);
  m.append(notes(true));
}
function notes(open) {
  const d = h('details', 't-notes'); d.open = !!open; d.append(h('summary', '', '届く内容と、使う前に知っておくこと'));
  const ul = h('ul');
  for (const t of [
    '届くのは、学生が「結果を送る」を押した結果だけです。参加しただけの人数や、遊んでいる途中の様子は届きません。',
    '届く内容：番号・表示名、行動タイプと判定に使った行動、主な行動の記録、プレイ前後の問いの答え、振り返り、たどり着いた結末、バージョン、送った日時。主人公の名前、ミーとの会話、メールアドレス、端末の情報は届きません。',
    '同じ人を別の端末で見分ける仕組みはありません。別の端末やブラウザで送ると、別の人として数えます。ブラウザのデータを消した場合も同じです。',
    '同じ端末から送り直すと、前の結果と置き換わります（一人一件）。学生は自分の送った結果を、同じ端末から削除できます。',
    '授業と提出された結果は、先生が削除するまで保存されます。自動では消えません。',
    'タイプに優劣はありません。成績や順位には使わないでください。一つの授業を管理できるのは、作った先生一人だけです。'
  ]) ul.append(h('li', '', t));
  d.append(ul); return d;
}

// ───────── 授業一覧 ─────────
async function listView() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  render(m => {
    m.append(h('h1', '', '授業一覧'));
    const sec = h('section', 't-card'); sec.append(h('h2', '', '新しくはじめる'));
    const f = h('form', 't-form'); f.noValidate = true;
    const l1 = h('label', 't-label', '授業名'); l1.htmlFor = 't-title'; const i1 = h('input', 't-input'); Object.assign(i1, { id: 't-title', maxLength: 40, placeholder: '例：情報の授業 第5回', autocomplete: 'off' });
    const l2 = h('label', 't-label', '学生への案内（任意・120文字まで）'); l2.htmlFor = 't-guide'; const i2 = h('textarea', 't-input'); Object.assign(i2, { id: 't-guide', maxLength: 120, rows: 2, placeholder: '例：遊び終わったら、結果を送ってください。' });
    const note = h('p', 't-hint', 'この授業と提出された結果は、あなたが削除するまで保存されます。自動では消えません。学生には授業名と案内だけが見えます。');
    const msg = msgLine(); const go = h('button', 't-btn main', '授業を作る'); go.type = 'submit';
    f.append(l1, i1, l2, i2, note, go, msg);
    f.onsubmit = async e => {
      e.preventDefault(); const title = i1.value.trim(); if (!title) { say(msg, '授業名を入れてください。', true); i1.focus(); return; }
      go.disabled = true; say(msg, '作っています…');
      try { const code = await (await fb()).createClass(title, i2.value.trim()); location.hash = `#/c/${code}`; }
      catch (err) { go.disabled = false; say(msg, await errText(err), true); }
    };
    sec.append(f); m.append(sec);
    const old = h('section', 't-card'); old.append(h('h2', '', 'これまでに作った授業')); const box = h('div', 't-classes'); box.append(h('p', 't-hint', '読み込んでいます…')); old.append(box); m.append(old);
    const s = h('p', 't-hint'); const a = h('a', '', 'サンプル授業を見る（架空の20人分のデータ）'); a.href = './?sample'; s.append(a); m.append(s, notes(false));
    (async () => {
      let list = []; try { list = await (await fb()).myClasses(); } catch (err) { box.replaceChildren(h('p', 't-msg err', await errText(err))); return; }
      box.replaceChildren();
      if (!list.length) { box.append(h('p', 't-hint', 'まだ授業はありません。')); return; }
      for (const c of list) {
        const row = h('div', 't-class-row');
        const tx = h('div', 't-class-tx'); tx.append(h('b', '', c.title), h('span', 't-sub', `コード ${c.code}　${day(c.createdAt)}作成　参加：${c.joinOpen ? '受付中' : '終了'}／提出：${c.submitOpen ? '受付中' : '終了'}`));
        const go = h('a', 't-btn', 'これまでの回答を見る'); go.href = `#/c/${c.code}`;
        row.append(tx, go); box.append(row);
      }
    })();
  });
}

// ───────── 授業の画面 ─────────
async function openClass(code) {
  render(m => m.append(h('p', 't-loading', '読み込んでいます…')));
  try { const f = await fb(); const [pub, subs] = await Promise.all([f.getPub(code), f.subsOf(code)]); if (!pub) throw Object.assign(new Error('missing'), { code: 'not-found' }); classView({ code, ...pub }, subs, false); }
  catch (err) { render(m => { m.append(backLink(), h('p', 't-msg err', /not-found|missing/.test(err?.code || err?.message || '') ? 'この授業は見つかりません（削除された可能性があります）。' : await_(err))); }); }
}
const await_ = () => 'この授業を開けませんでした。自分が作った授業か、通信を確かめてください。';
function backLink() { const a = h('a', 't-back', '‹ 授業一覧'); a.href = '#'; a.onclick = e => { e.preventDefault(); location.hash = ''; listView(); }; return a; }

const ui = { tab: 'all', hide: false, filter: null, pick: null };
function classView(cls, subs, sample) {
  const cur = subs.filter(s => s.v?.quiz === VERSIONS.quiz && s.v?.judge === VERSIONS.judge);
  const order = [...subs].sort((a, b) => (a.at || 0) - (b.at || 0));
  const alias = new Map(order.map((s, i) => [s.id, `参加者 ${String(i + 1).padStart(2, '0')}`]));
  const nameOf = s => ui.hide ? alias.get(s.id) : s.label;
  render(m => {
    if (!sample) m.append(backLink());
    m.append(h('h1', 't-class-title', cls.title));
    if (!sample) m.append(sharePanel(cls, subs.length), controls(cls));
    else { const hint = h('p', 't-hint', 'このサンプルは、架空の20人が遊んだという想定で作ったデータです。本番の授業とは別に保存してあり、集計に混ざることはありません。'); const back = h('a', '', '使い方とログインの画面へ'); back.href = './'; hint.append('　', back); m.append(hint); }
    const bar = h('div', 't-toolbar');
    const tabs = h('div', 't-tabs'); tabs.setAttribute('role', 'tablist');
    for (const [k, label] of [['all', '全体の傾向'], ['one', '個別の回答']]) { const b = h('button', 't-tab' + (ui.tab === k ? ' on' : ''), label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', ui.tab === k ? 'true' : 'false'); b.onclick = () => { ui.tab = k; if (k === 'all') { ui.filter = null; ui.pick = null; } draw(); }; tabs.append(b); }
    const hide = h('label', 't-switch'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = ui.hide; cb.onchange = () => { ui.hide = cb.checked; draw(); }; hide.append(cb, h('span', '', '番号・表示名を隠す'));
    bar.append(tabs, hide);
    if (!sample) bar.append(btn('最新にする', () => openClass(cls.code), 'small'));
    m.append(bar);
    const body = h('div', 't-body'); m.append(body);
    function draw() {
      for (const b of tabs.children) { const on = b.textContent === (ui.tab === 'all' ? '全体の傾向' : '個別の回答'); b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      body.replaceChildren();
      if (ui.tab === 'all') overview(body, cur, subs.length - cur.length, go); else individual(body, order, cur, nameOf, sample, cls, draw);
    }
    const go = filter => { ui.tab = 'one'; ui.filter = filter; ui.pick = null; draw(); bar.scrollIntoView({ block: 'start' }); };
    draw();
    if (!sample) { const del = h('details', 't-danger'); del.append(h('summary', '', '授業を削除する')); del.append(h('p', 't-hint', `授業「${cls.title}」と、提出された結果 ${subs.length}件を削除します。元に戻せません。学生の端末に残っている行動レポートは消えません。`)); const msg = msgLine(); del.append(btn('授業と提出データを削除', () => confirmDlg(`授業「${cls.title}」と、提出された結果 ${subs.length}件を削除しますか？ 元に戻せません。`, '削除する', async () => { say(msg, '削除しています…'); try { await (await fb()).deleteClass(cls.code); location.hash = ''; listView(); } catch (err) { say(msg, await errText(err), true); } }), 'danger'), msg); m.append(del); }
  });
}

function sharePanel(cls, n) {
  const d = h('details', 't-card t-share'); d.open = n === 0; d.append(h('summary', '', '参加コード・専用URL・QR'));
  const url = joinUrl(cls.code);
  const grid = h('div', 't-share-grid');
  const left = h('div');
  left.append(h('p', 't-label', '参加コード'), h('p', 't-code', cls.code), h('p', 't-label', '専用URL'));
  const u = h('p', 't-url'); const a = h('a', '', url); a.href = url; a.target = '_blank'; a.rel = 'noopener'; u.append(a); left.append(u);
  const msg = msgLine();
  const row = h('div', 't-row'); row.append(btn('URLをコピー', async () => { try { await navigator.clipboard.writeText(url); say(msg, 'コピーしました。'); } catch { say(msg, 'コピーできませんでした。URLを選んでコピーしてください。', true); } }), btn('QRを大きく表示', () => qrFull(url, cls)));
  left.append(row, msg, h('p', 't-hint', 'QRと専用URLでは、コードの入力はいりません。QRは、この画面の中で作っています（外部のサービスには送っていません）。'));
  const qr = h('div', 't-qr'); qrInto(qr, url, 6);
  grid.append(left, qr); d.append(grid); return d;
}
let qrLib = null;
async function qrInto(box, text, cell) {
  qrLib ||= (await import('../assets/vendor/qrcode-generator-2.0.4.js')).default;
  const q = qrLib(0, 'M'); q.addData(text); q.make();
  box.innerHTML = q.createSvgTag({ cellSize: cell, margin: 4, scalable: true });
  const svg = box.querySelector('svg'); if (svg) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '参加用のQR'); }
}
function qrFull(url, cls) {
  const o = $('#t-qr-full'); o.replaceChildren();
  const q = h('div', 't-qr-big'); qrInto(q, url, 10);
  o.append(h('p', 't-qr-title', cls.title), q, h('p', 't-qr-code', `参加コード　${cls.code}`), btn('閉じる', () => { o.hidden = true; }, 'main'));
  o.hidden = false; o.querySelector('button').focus();
  o.onkeydown = e => { if (e.key === 'Escape') o.hidden = true; };
}
function controls(cls) {
  const sec = h('section', 't-card t-controls'); sec.append(h('h2', '', '受付'));
  const msg = msgLine();
  const line = (key, label, onText, offText) => {
    const row = h('div', 't-ctl'); const st = h('span', 't-state ' + (cls[key] ? 'open' : 'closed'), cls[key] ? '受付中' : '終了');
    const b = btn(cls[key] ? `${label}を終了する` : `${label}を再開する`, async () => {
      b.disabled = true; say(msg, '変えています…');
      try { await (await fb()).setPub(cls.code, { [key]: !cls[key] }); cls[key] = !cls[key]; sec.replaceWith(controls(cls)); }
      catch (err) { b.disabled = false; say(msg, await errText(err), true); }
    }, 'small');
    const tx = h('div'); tx.append(h('b', '', label), h('span', 't-sub', cls[key] ? onText : offText));
    row.append(tx, st, b); return row;
  };
  sec.append(line('joinOpen', '参加の受付', '新しい学生が参加できます。', '新しい学生は参加できません。参加済みの学生は、提出の受付中なら送れます。'));
  sec.append(line('submitOpen', '提出の受付', '参加した学生が結果を送れます。', '結果は送れません。学生の端末のレポートは残り、送れない理由が表示されます。'));
  sec.append(msg); return sec;
}
function confirmDlg(text, yesLabel, yes) {
  const o = h('div', 't-dlg'); o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-modal', 'true');
  const box = h('div', 't-dlg-box'); box.append(h('p', '', text));
  const row = h('div', 't-row'); const no = btn('やめる', () => o.remove()); row.append(no, btn(yesLabel, () => { o.remove(); yes(); }, 'danger main'));
  box.append(row); o.append(box); document.body.append(o); no.focus();
  o.onkeydown = e => { if (e.key === 'Escape') o.remove(); };
}

// ───────── 全体の傾向 ─────────
function overview(body, cur, others, go) {
  const N = cur.length;
  const top = h('section', 't-stat'); top.append(h('p', 't-label', '提出人数'), h('p', 't-big', `${N}人`));
  top.append(h('p', 't-hint', '結果を送った人の数です。参加しただけの人や、遊んでいる途中の人は数えていません。' + (others ? `このほか、前のバージョンの提出が${others}件あります（問いや判定の意味が違うため、集計に入れていません。個別の回答では見られます）。` : '')));
  body.append(top);
  if (!N) { body.append(h('p', 't-hint', 'まだ提出はありません。学生が「結果を送る」を押すと、ここに出ます。「最新にする」で読み直せます。')); return; }

  // タイプの分布
  const ty = h('section', 't-card'); ty.append(h('h2', '', 'タイプの分布'), h('p', 't-hint', `${N}人中。タイプに優劣はありません。押すと、そのタイプの人の回答を開きます。`));
  const thinN = cur.filter(s => (s.thin || []).length).length;
  const list = h('div', 't-bars');
  for (const k of ORDER) { const c = cur.filter(s => s.type === k).length; list.append(barRow(TYPES[k].name, c, N, c ? () => go({ type: k }) : null)); }
  ty.append(list, h('p', 't-hint', `記録が少ないか差が小さく、「ここまでの行動から見ると」と控えめに判定した人：${thinN}人（${N}人中）。`));
  body.append(ty);

  // 主な行動
  const ac = h('section', 't-card'); ac.append(h('h2', '', '判定に使った主な行動'));
  ac.append(h('p', 't-hint', 'ゲームが記録した行動です（「資料を開いた」を「読んで理解した」とは数えていません）。その場面に来ていない人と、記録が残っていない人（前のバージョンのセーブなど）は、分母に入れていません。'));
  for (const a of ACTS) {
    const valid = cur.filter(s => s.acts && a.k in s.acts); const v = valid.length;
    const box = h('div', 't-act'); const hd = h('div', 't-act-head'); hd.append(h('b', '', a.label), h('span', 't-sub', v ? `有効な回答 ${v}人` : '有効な回答はまだありません')); box.append(hd);
    if (v) { const bars = h('div', 't-bars'); for (const [val, label] of Object.entries(a.vals).sort(([x], [y]) => (y === '1') - (x === '1'))) { const c = valid.filter(s => String(s.acts[a.k]) === val).length; bars.append(barRow(label, c, v, c ? () => go({ act: a.k, val }) : null, `有効な回答${v}人中 ${c}人`)); } box.append(bars); }
    if (N - v) box.append(h('p', 't-sub', `ほかの${N - v}人は、その場面に来ていないか記録がないため、割合に含めていません。`));
    ac.append(box);
  }
  body.append(ac);

  // プレイ前後の問い
  const pp = h('section', 't-card'); pp.append(h('h2', '', 'プレイ前後の問い'));
  const q = h('p', 't-quote'); for (const [i, line] of Q1.q.split('\n').entries()) { if (i) q.append(h('br')); q.append(line); } pp.append(q);
  const both = cur.filter(s => s.pre && s.post); const B = both.length;
  pp.append(h('p', 't-strong', `比較できた人：${B}人`), h('p', 't-hint', `はじめる前と遊んだあとの両方に答えた人だけを比べています（${N}人中。どちらかが未回答の${N - B}人は含めていません）。`));
  if (B) {
    const tb = h('table', 't-table'); const tr0 = h('tr'); for (const t of ['答え', 'はじめる前', '遊んだあと']) tr0.append(h('th', '', t)); const th = h('thead'); th.append(tr0); tb.append(th);
    const tbd = h('tbody'); for (const [v, label] of Q1.opts) { const tr = h('tr'); tr.append(h('td', '', label), h('td', '', `${both.filter(s => s.pre === v).length}人`), h('td', '', `${both.filter(s => s.post === v).length}人`)); tbd.append(tr); } tb.append(tbd);
    pp.append(tb);
    const changed = both.filter(s => s.pre !== s.post); const moves = {};
    for (const s of changed) { const k = `${q1Text(s.pre)} → ${q1Text(s.post)}`; moves[k] = (moves[k] || 0) + 1; }
    const p = h('p', 't-strong', `答えが変わった人：${changed.length}人（比較できた${B}人中）`); pp.append(p);
    const ul = h('ul', 't-moves'); for (const [k, c] of Object.entries(moves).sort((a, b) => b[1] - a[1])) ul.append(h('li', '', `${k}：${c}人`)); pp.append(ul);
    const row = h('div', 't-row'); if (changed.length) row.append(btn('答えが変わった人の回答を見る', () => go({ prepost: 'changed' }), 'small')); if (B - changed.length) row.append(btn('同じだった人の回答を見る', () => go({ prepost: 'same' }), 'small')); pp.append(row);
  }
  pp.append(h('p', 't-caution', '答えが変わったことだけで、遊んだ効果があったとは言えません。なぜ変えたのか（変えなかったのか）を、話し合いのきっかけにしてください。'));
  body.append(pp);

  // 振り返り
  const rf = h('section', 't-card'); rf.append(h('h2', '', '振り返りの回答'));
  for (const [k, qq] of REFLECT_QS) { const c = cur.filter(s => s[k]).length; const row = h('div', 't-refl'); row.append(h('p', '', qq), h('p', 't-sub', `書いた人 ${c}人（${N}人中）`)); if (c) row.append(btn('書いた人の回答を見る', () => go({ refl: k }), 'small')); rf.append(row); }
  body.append(rf);
}
function barRow(label, c, n, onClick, aria) {
  const el = onClick ? h('button', 't-hbar') : h('div', 't-hbar off'); if (onClick) { el.type = 'button'; el.onclick = onClick; }
  const track = h('span', 't-track'); const fill = h('span', 't-fill'); fill.style.width = `${pct(c, n)}%`; track.append(fill);
  el.append(h('span', 't-bar-label', label), track, h('span', 't-bar-num', `${c}人（${pct(c, n)}%）`));
  el.setAttribute('aria-label', `${label}：${aria || `${n}人中 ${c}人`}`);
  return el;
}

// ───────── 個別の回答 ─────────
function filterText(f) {
  if (!f) return '';
  if (f.type) return `タイプ「${TYPES[f.type].name}」`;
  if (f.act) { const a = ACTS.find(x => x.k === f.act); return `${a.label}：${actText(f.act, f.val)}`; }
  if (f.prepost) return f.prepost === 'changed' ? 'プレイ前後で答えが変わった人' : 'プレイ前後で答えが同じだった人';
  if (f.refl) return '振り返りを書いた人';
  return '';
}
function match(s, f) {
  if (!f) return true;
  if (f.type) return s.type === f.type;
  if (f.act) return s.acts && String(s.acts[f.act]) === f.val;
  if (f.prepost) return s.pre && s.post && (f.prepost === 'changed' ? s.pre !== s.post : s.pre === s.post);
  if (f.refl) return !!s[f.refl];
  return true;
}
function individual(body, order, cur, nameOf, sample, cls, redraw) {
  const curSet = new Set(cur.map(s => s.id));
  const list = order.filter(s => ui.filter ? curSet.has(s.id) && match(s, ui.filter) : true);
  if (ui.filter) { const f = h('div', 't-filter'); f.append(h('span', '', `絞り込み：${filterText(ui.filter)}（${list.length}人）`), btn('解除', () => { ui.filter = null; redraw(); }, 'small')); body.append(f); }
  const wrap = h('div', 't-split' + (ui.pick ? ' picked' : ''));
  const ul = h('ul', 't-people');
  if (!list.length) ul.append(h('li', 't-hint', 'まだ提出はありません。'));
  for (const s of list) {
    const li = h('li'); const b = h('button', 't-person' + (ui.pick === s.id ? ' on' : '')); b.type = 'button';
    b.append(h('b', '', nameOf(s)), h('span', '', TYPES[s.type]?.name || s.type), h('small', '', when(s.at) + (curSet.has(s.id) ? '' : '　前のバージョン')));
    b.onclick = () => { ui.pick = s.id; redraw(); requestAnimationFrame(() => document.querySelector('.t-detail h2')?.focus({ preventScroll: false })); };
    li.append(b); ul.append(li);
  }
  const det = h('section', 't-detail');
  const s = list.find(x => x.id === ui.pick);
  if (!s) det.append(h('p', 't-hint', '左の一覧から一人を選ぶと、その人のタイプ、判定の根拠、プレイ前後の答え、振り返り、結末が出ます。'));
  else detail(det, s, nameOf, sample, cls, curSet.has(s.id), redraw);
  wrap.append(ul, det); body.append(wrap);
}
function detail(det, s, nameOf, sample, cls, current, redraw) {
  const back = btn('‹ 一覧に戻る', () => { ui.pick = null; redraw(); }, 'small t-only-sp'); det.append(back);
  const h2 = h('h2', '', nameOf(s)); h2.tabIndex = -1; det.append(h2, h('p', 't-sub', `送った日時：${when(s.at)}` + (current ? '' : '　前のバージョンの提出（集計には入れていません）')));
  const t = TYPES[s.type];
  const a = h('section', 't-sec'); a.append(h('h3', '', 'タイプ（ゲームの記録から判定）'), h('p', 't-strong', t?.name || s.type)); if (t) a.append(h('p', '', t.line));
  if ((s.thin || []).length) a.append(h('p', 't-sub', `${s.thin.map(k => AXIS[k]).join('・')}は、記録が少ないか差が小さく、どちらかに大きくは傾いていません。`));
  if (s.old) a.append(h('p', 't-sub', '前のバージョンのセーブで遊んだ夜のため、「根拠は？」と聞いたかどうかなど、記録がない行動があります（未記録として扱っています）。'));
  det.append(a);
  const b = h('section', 't-sec'); b.append(h('h3', '', '判定の根拠（ゲームの記録）'));
  const ev = h('ul', 't-ev'); for (const e of s.ev || []) { const li = h('li'); li.append(h('span', 'ax', AXIS[e.axis] || ''), document.createTextNode(e.text)); ev.append(li); } if (s.safe?.text) { const li = h('li'); li.append(h('span', 'ax', '備え'), document.createTextNode(s.safe.text)); ev.append(li); } if (!ev.childElementCount) ev.append(h('li', '', '判定に使える行動はありませんでした。')); b.append(ev);
  const acts = h('ul', 't-acts'); let none = 0; for (const x of ACTS) { if (s.acts && x.k in s.acts) acts.append(h('li', '', `${x.label}：${actText(x.k, s.acts[x.k])}`)); else none++; }
  b.append(h('h4', '', '主な行動の記録'), acts); if (none) b.append(h('p', 't-sub', `ほかの${none}項目は、その場面に来ていないか、記録がありません。`));
  det.append(b);
  const c = h('section', 't-sec t-own'); c.append(h('h3', '', '本人の回答'));
  const dl = h('dl', 't-dl');
  const pre = s.pre ? q1Text(s.pre) : '未回答', post = s.post ? q1Text(s.post) : '未回答';
  dl.append(h('dt', '', 'はじめる前の問い'), h('dd', '', pre), h('dt', '', '遊んだあとの問い'), h('dd', '', post + (s.pre && s.post ? (s.pre === s.post ? '（同じ）' : '（変わった）') : '')));
  for (const [k, q] of REFLECT_QS) dl.append(h('dt', '', q), h('dd', 't-free', s[k] || '未回答'));
  c.append(dl); det.append(c);
  const e = h('section', 't-sec'); e.append(h('h3', '', 'たどり着いた結末'), h('p', '', endingText(s.ending)), h('p', 't-sub', '結末は、この個別の画面でだけ表示しています。')); det.append(e);
  det.append(h('p', 't-sub', `バージョン：ゲーム ${s.v?.game}／問い ${s.v?.quiz}／判定 ${s.v?.judge}`));
  if (!sample) { const msg = msgLine(); det.append(btn('この回答を削除', () => confirmDlg(`「${nameOf(s)}」の回答を削除しますか？ 元に戻せません。`, '削除する', async () => { say(msg, '削除しています…'); try { await (await fb()).deleteSub(cls.code, s.id); openClass(cls.code); } catch (err) { say(msg, await errText(err), true); } }), 'danger small'), msg); }
}

route();
