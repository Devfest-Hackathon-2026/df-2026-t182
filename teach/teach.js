// 主催者向けの画面「プレイ分析」：使い方とログイン → セッション一覧 → セッションの分析（指標・グラフ・提出一覧）→ PDF・CSV の出力。
// 画面の文言は「授業」に決め打ちしない（学校・研修・ワークショップ・イベントで使う）。Firestore の名前（classes など）はそのまま。
// ?sample は、静的な sample.json（架空のデータ）を読むだけのサンプルのセッション。ログインも Firebase も使わない。
// 数値はすべて stats.js の compute() から出す（画面・PDF・CSV で同じ数を使う）。
import { TYPES } from '../report.js';
import { ACTS, actText, AXIS, REFLECT_QS, VERSIONS } from '../class-data.js';
import * as S from './stats.js';
import { fb, loadClass, loadSample } from './data.js';

const $ = s => document.querySelector(s);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, fn, cls = '') => { const b = h('button', 't-btn ' + cls, label); b.type = 'button'; b.onclick = fn; return b; };
const main = $('#t-main');
const SAMPLE = new URLSearchParams(location.search).has('sample');
const ERR = { network: 'つながりませんでした。通信を確かめて、もう一度ためしてください。', denied: 'この操作はできません。ログインしているアカウントを確かめてください。', other: 'うまくいきませんでした。少し待って、もう一度ためしてください。' };
async function errText(e) { try { return ERR[(await fb()).kind(e)] || ERR.other; } catch { return ERR.network; } }
function render(build) { main.replaceChildren(); build(main); main.focus({ preventScroll: true }); scrollTo(0, 0); }
const msgLine = () => { const m = h('p', 't-msg'); m.setAttribute('role', 'status'); m.setAttribute('aria-live', 'polite'); return m; };
const say = (m, t, err) => { m.textContent = t; m.classList.toggle('err', !!err); };
const joinUrl = code => new URL(`../?c=${code}`, location.href).href;
const num = (c, unit = '件') => `${c}${unit}`;

// ───────── 入口 ─────────
async function route() {
  if (SAMPLE) {
    $('#t-sample').hidden = false; document.title = 'サンプル｜プレイ分析';
    try { dashboard(await loadSample()); } catch { render(m => m.append(h('p', 't-msg err', 'サンプルを読み込めませんでした。ページを読み込み直してください。'))); }
    return;
  }
  let user = null; try { user = await (await fb()).teacher(); } catch { render(intro); return; }
  paintUser(user);
  if (!user) { render(intro); return; }
  const code = (location.hash.match(/^#\/c\/([A-Z0-9]{6})$/) || [])[1];
  if (code) openClass(code); else listView();
}
addEventListener('hashchange', () => { if (!SAMPLE) route(); });
function paintUser(u) { $('#t-who').textContent = u ? u.email || '' : ''; $('#t-out').hidden = !u; }
$('#t-out').onclick = async () => { await (await fb()).signOut(); location.hash = ''; paintUser(null); render(intro); };

function intro(m) {
  const wrap = h('section', 't-intro');
  wrap.append(h('p', 't-eyebrow', 'グループで使う'), h('h1', '', 'プレイ分析'));
  wrap.append(h('p', 't-lead', '参加者が遊んだあとに送った結果を集めて、結末・タイプ・行動の傾向を比べる画面です。振り返りや話し合いに使うプレイ分析レポートと振り返りシートを、PDFで出力できます。成績をつけたり、操作を見張ったりするためのものではありません。'));
  const ol = h('ol', 't-steps');
  for (const t of ['Googleアカウントでログインし、セッション名を入れてセッションを作ります。', 'QR、専用URL、または6文字の参加コードを参加者に配ります。', '参加者は番号か表示名を入れて遊び、送る内容を確かめてから結果を送ります。参加者のログインは要りません。', 'この画面で集計を見て、必要ならPDFやCSVに出力します。']) ol.append(h('li', '', t));
  wrap.append(ol);
  const msg = msgLine();
  const row = h('div', 't-row');
  row.append(btn('Googleでログインする', async e => {
    e.target.disabled = true; say(msg, 'ログインしています…');
    try { const u = await (await fb()).signInGoogle(); if (u) { paintUser(u); listView(); } }
    catch (err) { e.target.disabled = false; say(msg, /popup-closed|cancelled/.test(err?.code || '') ? 'ログインを取りやめました。' : await errText(err), true); }
  }, 'main'));
  const s = h('a', 't-btn', 'サンプルのセッションを開く'); s.href = './?sample'; row.append(s);
  wrap.append(row, msg, notes());
  m.append(wrap);
}
// 届く内容と数え方（画面のあちこちに散らさず、ここと分析画面の「集計の決まり」にまとめる）
function notes() {
  const d = h('details', 't-notes'); d.append(h('summary', '', '届く内容と、使う前に知っておくこと'));
  const ul = h('ul');
  for (const t of [
    '届くのは、参加者が「結果を送る」を押した結果だけです。遊んでいる途中の様子や、ミーとの会話は届きません。',
    '届く内容は、番号・表示名、行動タイプと判定に使った行動、主な行動の記録、プレイ前後の問いの答え、振り返り、たどり着いた結末、バージョン、送った日時です。主人公の名前、メールアドレス、端末の情報は届きません。',
    '参加の記録として、参加IDと参加した時刻が残ります。参加IDは端末ごとの登録で、同じ人を別の端末で見分ける仕組みはありません。',
    '同じ端末から送り直すと、前の結果と置き換わります（参加ID1つにつき1件）。遊んだ回数は記録していません。参加者は自分の送った結果を削除できます。',
    'セッションと提出された結果は、主催者が削除するまで保存されます。一つのセッションを管理できるのは、作った主催者一人だけです。',
    'タイプに優劣はありません。成績や順位には使わないでください。'
  ]) ul.append(h('li', '', t));
  d.append(ul); return d;
}

// ───────── セッション一覧 ─────────
async function listView() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  render(m => {
    m.append(h('h1', 't-h1', 'セッション一覧'));
    const grid = h('div', 't-list-grid');
    const old = h('section', 't-panel'); old.append(h('h2', '', 'これまでに作ったセッション')); const box = h('div', 't-classes'); box.append(h('p', 't-hint', '読み込んでいます…')); old.append(box);
    const sec = h('section', 't-panel'); sec.append(h('h2', '', '新しくセッションを作る'));
    const f = h('form', 't-form'); f.noValidate = true;
    const l1 = h('label', 't-label', 'セッション名'); l1.htmlFor = 't-title'; const i1 = h('input', 't-input'); Object.assign(i1, { id: 't-title', maxLength: 40, placeholder: '例：新人研修 AIとの付き合い方', autocomplete: 'off' });
    const l2 = h('label', 't-label', '参加者への案内（120文字まで、なくてもかまいません）'); l2.htmlFor = 't-guide'; const i2 = h('textarea', 't-input'); Object.assign(i2, { id: 't-guide', maxLength: 120, rows: 3, placeholder: '例：遊び終わったら、結果を送ってください。' });
    const msg = msgLine(); const go = h('button', 't-btn main', 'セッションを作る'); go.type = 'submit';
    f.append(l1, i1, l2, i2, go, msg);
    f.onsubmit = async e => {
      e.preventDefault(); const title = i1.value.trim(); if (!title) { say(msg, 'セッション名を入れてください。', true); i1.focus(); return; }
      go.disabled = true; say(msg, '作っています…');
      try { const code = await (await fb()).createClass(title, i2.value.trim()); location.hash = `#/c/${code}`; }
      catch (err) { go.disabled = false; say(msg, await errText(err), true); }
    };
    sec.append(f, h('p', 't-hint', '参加者にはセッション名と案内だけが見えます。'));
    grid.append(old, sec); m.append(grid);
    const s = h('p', 't-hint'); const a = h('a', '', 'サンプルのセッションを開く'); a.href = './?sample'; s.append(a); m.append(s, notes());
    (async () => {
      let list = []; try { list = await (await fb()).myClasses(); } catch (err) { box.replaceChildren(h('p', 't-msg err', await errText(err))); return; }
      box.replaceChildren();
      if (!list.length) { box.append(h('p', 't-hint', 'まだセッションはありません。右の欄から作れます。')); return; }
      const ul = h('ul', 't-class-list');
      for (const c of list) {
        const li = h('li'); const a = h('a', 't-class-link'); a.href = `#/c/${c.code}`;
        a.append(h('b', '', c.title), h('span', 't-sub', `${c.code}　${c.createdAt ? S.dayLabel(S.dayKey(c.createdAt)) : ''}に作成　参加${c.joinOpen ? '受付中' : '終了'}・提出${c.submitOpen ? '受付中' : '終了'}`));
        li.append(a); ul.append(li);
      }
      box.append(ul);
    })();
  });
}

// ───────── セッションの分析 ─────────
async function openClass(code) {
  render(m => m.append(h('p', 't-loading', '読み込んでいます…')));
  try { dashboard(await loadClass(code)); }
  catch (err) { const e = await errText(err); render(m => { m.append(backLink(), h('p', 't-msg err', /not-found|missing/.test(err?.code || err?.message || '') ? 'このセッションは見つかりません。削除された可能性があります。' : e === ERR.network ? e : 'このセッションを開けませんでした。自分が作ったセッションか、通信を確かめてください。')); }); }
}
function backLink() { const a = h('a', 't-back', 'セッション一覧に戻る'); a.href = '#'; a.onclick = e => { e.preventDefault(); location.hash = ''; listView(); }; return a; }

const ui = { cond: { day: 'all', end: 'all', cross: 'ax:op' }, hide: false, sort: { key: 'at', dir: 1 }, pick: null, tf: null, showOld: false };
let CUR = null; // いま開いているセッション { P, st, cls, sample }

function dashboard(data) {
  const sample = !!data.sample, cls = data.cls;
  const P = S.prepare(data);
  if (!P.days.includes(ui.cond.day)) ui.cond.day = 'all';
  ui.pick = null; ui.tf = null;
  render(m => {
    // 上部：画面名・集計対象・期間・最終更新・出力
    const head = h('header', 't-head');
    const tl = h('div', 't-head-main');
    if (!sample) tl.append(backLink());
    tl.append(h('h1', 't-h1', 'プレイ分析'), h('p', 't-class-name', cls.title));
    const meta = h('dl', 't-meta'); tl.append(meta);
    const acts = h('div', 't-head-actions');
    if (!sample) acts.append(btn('最新にする', () => openClass(cls.code)));
    acts.append(btn('CSVを出力する', () => exportDialog('csv')), btn('PDFを出力する', () => exportDialog('report'), 'main'));
    head.append(tl, acts); m.append(head);
    if (!sample) m.append(sharePanel(cls));

    // 集計条件
    const bar = h('div', 't-filters'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '集計条件');
    if (P.days.length > 1) bar.append(select('参加した日', [['all', 'すべての参加日'], ...P.days.map(d => [d, S.dayLabel(d)])], ui.cond.day, v => { ui.cond.day = v; draw(); }));
    bar.append(select('結末', S.END_FILTERS, ui.cond.end, v => { ui.cond.end = v; draw(); }));
    const hide = h('label', 't-check'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = ui.hide; cb.onchange = () => { ui.hide = cb.checked; draw(); }; hide.append(cb, h('span', '', '番号・表示名を隠す'));
    bar.append(hide);
    m.append(bar);

    const body = h('div', 't-body'); m.append(body);
    m.append(rulesNote());
    if (!sample) m.append(settings(cls, P.subs.length));

    function draw() {
      const st = S.compute(P, ui.cond);
      CUR = { P, st, cls, sample };
      meta.replaceChildren();
      const mrow = (k, v) => { const d = h('div'); d.append(h('dt', '', k), h('dd', '', v)); meta.append(d); };
      mrow('集計期間', st.period ? periodText(st.period) : '提出なし');
      mrow('データの最終更新', `${S.stamp(data.loadedAt)}に読み込み`);
      body.replaceChildren();
      kpis(body, st);
      if (!st.N) { empty(body, st); } else charts(body, st, draw);
      table(body, P, st, draw);
    }
    draw();
  });
}
const periodText = ([a, b]) => S.dayKey(a) === S.dayKey(b) ? `${S.stamp(a)}〜${S.pad2(new Date(b).getHours())}:${S.pad2(new Date(b).getMinutes())}` : `${S.stamp(a)}〜${S.stamp(b)}`;

function select(label, opts, value, onChange) {
  const l = h('label', 't-select'); l.append(h('span', '', label));
  const s = h('select'); for (const [v, t] of opts) { const o = h('option', '', t); o.value = v; o.selected = v === value; s.append(o); }
  s.onchange = () => onChange(s.value); l.append(s); return l;
}

// 概要の指標（囲まずに罫線で区切る。それぞれに母数を書く）
function kpis(body, st) {
  const k = st.kpi;
  const box = h('section', 't-kpis'); box.setAttribute('aria-label', '主な指標');
  const tile = (label, v, unit, base, bar) => {
    const d = h('div', 't-kpi'); const n = h('p', 't-kpi-num'); n.append(v); if (unit) n.append(h('span', 't-kpi-unit', unit));
    d.append(h('p', 't-kpi-label', label), n); if (bar) d.append(bar); d.append(h('p', 't-kpi-base', base)); box.append(d);
  };
  const f = st.funnel;
  if (k.members != null) tile('参加ID', String(k.members), '件', `提出あり ${f.cur}件（${k.submitRate}%）・未提出 ${f.none}件`, f.M ? stack([{ c: f.cur, fill: 'f1', label: '提出あり（集計対象）' }, { c: f.old, fill: 'f2', label: '提出あり（前のバージョン）' }, { c: f.none, fill: 'f3', label: '未提出' }], f.M, null, 't-mini') : null);
  else tile('参加ID', '—', '', '参加の記録を読めませんでした');
  tile('集計対象の提出', String(k.N), '件', st.oldN ? `前のバージョンの提出 ${st.oldN}件は含めていません` : '参加ID1つにつき最後の1件');
  tile('TRUE・SECRET END', k.N ? String(k.clearRate) : '—', k.N ? '%' : '', k.N ? `集計対象 ${k.N}件中 ${k.clear}件` : '集計対象の提出がありません');
  tile('前後の問いで答えが変わった', k.B ? String(k.changedRate) : '—', k.B ? '%' : '', k.B ? `両方に答えた ${k.B}件中 ${k.changed}件` : '両方に答えた提出がありません');
  body.append(box);
}

function empty(body, st) {
  const sec = h('section', 't-empty');
  sec.append(h('h2', '', st.cond.end !== 'all' ? 'この条件に当てはまる提出はありません' : 'まだ集計できる提出はありません'));
  sec.append(h('p', '', st.cond.end !== 'all' ? '結末の条件を「すべての結末」に戻すと、ほかの提出を集計できます。' : '参加者が遊び終わって「結果を送る」を押すと、ここにグラフが出ます。「最新にする」で読み直せます。'));
  body.append(sec, questions());
}

// ───────── グラフ ─────────
// 塗りは4種類（PDF と同じ）：f1 濃い紺の塗り・f2 ブルーグレーに斜線・f3 ライトグレー・f4 点。白黒で印刷しても見分けられる。
const FILL = { true: 'f1', secret: 'f2', bad: 'f3' };
// まとまりの見出し（PDF のページの見出しにあたる）
function group(body, eyebrow, title) { const g = h('section', 't-group'); const hd = h('header', 't-group-head'); hd.append(h('p', 't-eyebrow', eyebrow), h('h2', '', title)); g.append(hd); body.append(g); return g; }
function block(title, base, cls = '') {
  const sec = h('section', 't-block ' + cls); const hd = h('div', 't-block-head');
  hd.append(h('h3', '', title)); if (base) hd.append(h('p', 't-base', base)); sec.append(hd); return sec;
}
function legend(items, cls = '') { const ul = h('ul', 't-legend ' + cls); for (const [fill, label] of items) { const li = h('li'); li.append(h('span', 't-swatch ' + fill), h('span', '', label)); ul.append(li); } return ul; }
// ラベル｜棒（max に対する長さ）｜件数・割合
function hbar(label, c, n, max, fill = 'f1', onClick, title, swatch) {
  const el = onClick ? h('button', 't-hbar') : h('div', 't-hbar'); if (onClick) { el.type = 'button'; el.onclick = onClick; }
  const lab = h('span', 't-hbar-label'); if (swatch) lab.append(h('span', 't-swatch ' + swatch)); lab.append(h('span', '', label));
  const track = h('span', 't-track'); const bar = h('span', 't-fill ' + fill); bar.style.width = `${max ? (c / max) * 100 : 0}%`; track.append(bar);
  const num = h('span', 't-hbar-num'); num.append(h('b', '', `${c}件`), h('span', '', `${S.pct(c, n)}%`));
  el.append(lab, track, num); if (!c) el.classList.add('zero');
  el.title = title || `${label}：${n}件中 ${c}件（${S.pct(c, n)}%）`; el.setAttribute('aria-label', el.title);
  return el;
}
// 100%積み上げの1本。segs = [{c, fill, label}]
function stack(segs, n, aria, cls = '') {
  const bar = h('div', 't-stack ' + cls); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', aria || segs.map(s => `${s.label} ${s.c}件`).join('、'));
  for (const s of segs) {
    if (!s.c) continue;
    const seg = h('span', 't-seg ' + s.fill); seg.style.width = `${(s.c / n) * 100}%`; seg.title = `${s.label}：${s.c}件（${S.pct(s.c, n)}%）`;
    if (!cls && s.c / n >= 0.1) seg.append(h('span', 't-seg-num', String(s.c)));
    bar.append(seg);
  }
  return bar;
}
function questions() {
  const sec = h('section', 't-group t-qs'); const hd = h('header', 't-group-head'); hd.append(h('p', 't-eyebrow', '話し合いのヒント'), h('h2', '', 'グループで考えたい問い'));
  const ol = h('ol', 't-qlist'); for (const q of S.TEACH_QS) ol.append(h('li', '', q));
  sec.append(hd, ol, h('p', 't-foot', '振り返りシート（PDF）では、このうち3つまでを選んで配れます。'));
  return sec;
}

function charts(body, st, redraw) {
  const N = st.N;
  const goTable = tf => { ui.tf = tf; redraw(); requestAnimationFrame(() => $('#t-table-sec')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); };
  const A = Object.fromEntries(st.acts.flatMap(g => g.items).map(a => [a.k, a]));

  // ── プレイの全体像 ──
  {
    const g = group(body, 'プレイの全体像', '結末とタイプ'); const grid = h('div', 't-cols t-7-5'); g.append(grid);
    const e = block('結末の分布', `母数：集計対象 ${N}件`);
    e.append(stack(S.GROUPS.map(gr => ({ c: st.groups.find(z => z.k === gr.k).c, fill: FILL[gr.k], label: gr.label })), N, null, 't-comp'));
    const sum = h('div', 't-comp-labels');
    for (const gr of S.GROUPS) { const gc = st.groups.find(z => z.k === gr.k).c; const d = h('div'); const t = h('p', 't-comp-name'); t.append(h('span', 't-swatch ' + FILL[gr.k]), gr.label); const v = h('p', 't-comp-val'); v.append(h('b', '', `${S.pct(gc, N)}%`), h('span', '', `${gc}件`)); d.append(t, v); sum.append(d); }
    e.append(sum, h('p', 't-sublabel', '結末ごとの件数（押すと、その結末の提出を一覧で開きます）'));
    const list = h('div', 't-bars'); const max = Math.max(1, ...st.endings.map(x => x.c));
    for (const x of st.endings) list.append(hbar(`「${x.sub}」`, x.c, N, max, FILL[x.group], x.c ? () => goTable({ ending: x.id }) : null, `${x.label}：${N}件中 ${x.c}件`, FILL[x.group]));
    e.append(list);
    const t = block('タイプの分布', `母数：集計対象 ${N}件`);
    const tl = h('div', 't-bars t-bars-roomy'); const tmax = Math.max(1, ...st.types.map(x => x.c));
    for (const x of S.typesByCount(st)) tl.append(hbar(x.name, x.c, N, tmax, 'f1', x.c ? () => goTable({ type: x.k }) : null));
    t.append(tl, h('p', 't-foot', `タイプに優劣はありません。控えめに判定した観点がある提出：${st.thinAny}件`));
    grid.append(e, t);
  }

  // ── 行動の記録 ──
  {
    const g = group(body, 'プレイヤーの判断', 'ミーへの任せ方と、情報の確かめ方');
    g.querySelector('.t-group-head').append(h('p', 't-group-lead', 'その場面に来た提出だけを母数にしています。行ごとに母数（n）が違います。'));
    const grid = h('div', 't-cols t-7-5'); g.append(grid);
    const L = block('自分で操作したか、ミーに任せたか', '左：自分で　右：ミーに任せた');
    for (const key of ['keypad', 'panel', 'admin']) {
      const it = A[key]; const [s, m] = it.vals; const row = h('div', 't-split');
      const hd = h('div', 't-split-head'); hd.append(h('b', '', it.label), h('span', 't-base', `n=${it.n}件`)); row.append(hd);
      if (it.n) { const ends = h('div', 't-split-ends'); ends.append(h('span', '', `${s.label} ${s.c}件（${S.pct(s.c, it.n)}%）`), h('span', '', `${m.label} ${m.c}件（${S.pct(m.c, it.n)}%）`)); row.append(ends, stack([{ c: s.c, fill: 'f1', label: s.label }, { c: m.c, fill: 'f3', label: m.label }], it.n, null, 't-split-bar')); }
      else row.append(h('p', 't-foot', 'この場面に来た提出はありません'));
      L.append(row);
    }
    const p = A.proxy; const hl = h('div', 't-highlight');
    const hh = h('div', 't-split-head'); hh.append(h('b', '', 'ミーの代わりの返信や決済を止めたか'), h('span', 't-base', `n=${p.n}件`)); hl.append(hh);
    if (p.n) { const r = h('div', 't-highlight-body'); r.append(h('p', 't-highlight-num', `${S.pct(p.vals[0].c, p.n)}%`), h('p', '', `ミーの設定画面で、代わりの返信や決済をオフ・一時停止・「あとで」にした提出は ${p.vals[0].c}件（${p.n}件中）でした。止めなかった提出は ${p.vals[1].c}件です。`)); hl.append(r); }
    else hl.append(h('p', 't-foot', '管理画面を開いた提出はありません'));
    L.append(hl);
    const R = block('情報の確かめ方', '「した」割合');
    for (const key of ['askSource', 'askWhen', 'map', 'site']) {
      const it = A[key]; const yes = it.vals[0]; const row = h('div', 't-rate');
      const hd = h('div', 't-rate-head'); hd.append(h('span', '', it.label)); const v = h('span', 't-rate-val'); if (it.n) v.append(h('b', '', `${S.pct(yes.c, it.n)}%`), h('span', '', `${yes.c}/${it.n}件`)); else v.append(h('span', '', '記録なし')); hd.append(v);
      const track = h('div', 't-track t-rate-track'); const fill = h('span', 't-fill f1'); fill.style.width = `${it.n ? (yes.c / it.n) * 100 : 0}%`; track.append(fill);
      row.append(hd, track); row.title = `${it.label}：${it.n}件中 ${yes.c}件`; R.append(row);
    }
    const axis = h('div', 't-rate-axis'); axis.append(h('span', '', '0%'), h('span', '', '50%'), h('span', '', '100%')); R.append(axis);
    grid.append(L, R);
    // 補助の集計（小さな表）
    const g2 = h('div', 't-cols t-6-6'); g.append(g2);
    const sc = A.scam; const t1 = block('知らない番号からの「お母さんが倒れた」', `n=${sc.n}件`, 't-small');
    t1.append(miniTable(sc.vals.map(v => [v.label, `${v.c}件`, `${S.pct(v.c, sc.n)}%`])));
    const sf = st.safe; const t2 = block('動く前の備えと連絡', '', 't-small');
    t2.append(miniTable([
      [A.doorStop.label, `${A.doorStop.vals[0].label} ${A.doorStop.vals[0].c}件`, `n=${A.doorStop.n}件`],
      [A.sos.label, `${A.sos.vals[0].label} ${A.sos.vals[0].c}件`, `n=${A.sos.n}件`],
      ['動く前の備え：先に確かめた', `${sf.S}件`, `n=${N}件`],
      ['動く前の備え：両方・進んでから・記録なし', `${sf.both}・${sf.B}・${sf.none}件`, `n=${N}件`]
    ]));
    g2.append(t1, t2);
  }

  // ── 結果の読み解き ──
  {
    const g = group(body, '結果と振り返り', 'データから分かること');
    g.querySelector('.t-group-head').append(h('p', 't-group-lead', 'ゲームの記録の集計です。学習の効果を測ったものではありません。'));
    const grid = h('div', 't-cols t-4-4-4'); g.append(grid);
    // 3つの観点
    const a = block('タイプを決める3つの観点', `n=${N}件`);
    for (const ax of st.axes) {
      const [Ls, Rs] = ax.sides; const row = h('div', 't-split');
      row.append(h('b', 't-axis-name', ax.label));
      const ends = h('div', 't-split-ends'); ends.append(h('span', '', `${Ls.label} ${Ls.c}`), h('span', '', `${Rs.label} ${Rs.c}`)); row.append(ends);
      row.append(stack([{ c: Ls.clear, fill: 'f1', label: `${Ls.label}（はっきり）` }, { c: Ls.thin, fill: 'f2', label: `${Ls.label}（差が小さい）` }, { c: Rs.thin, fill: 'f4', label: `${Rs.label}（差が小さい）` }, { c: Rs.clear, fill: 'f3', label: `${Rs.label}（はっきり）` }], N));
      a.append(row);
    }
    a.append(legend([['f1', '左にはっきり'], ['f2', '左・差が小さい'], ['f4', '右・差が小さい'], ['f3', '右にはっきり']]));
    // プレイ前後の問い（並列棒）
    const pp = st.pp; const b = block('プレイ前後の問い', `両方に答えた ${pp.B}件`);
    b.append(h('p', 't-quote', S.Q1_TEXT.replace(/\n/g, '')));
    if (pp.B) {
      const max = Math.max(1, ...pp.opts.flatMap(o => [o.pre, o.post]));
      for (const o of pp.opts) { const gr = h('div', 't-pp'); gr.append(h('b', '', o.label), hbar('はじめる前', o.pre, pp.B, max, 'f3'), hbar('遊んだあと', o.post, pp.B, max, 'f1')); b.append(gr); }
      b.append(legend([['f3', 'はじめる前'], ['f1', '遊んだあと']]));
      const d = h('details', 't-more'); d.append(h('summary', '', `答えの組み合わせを表で見る（答えが変わった提出 ${pp.changed}件）`));
      const tb = h('table', 't-matrix'); const thead = h('thead'); const tr0 = h('tr'); tr0.append(h('th', '', 'はじめる前 ＼ 遊んだあと')); for (const o of pp.opts) tr0.append(h('th', '', o.label)); thead.append(tr0); tb.append(thead);
      const tbody = h('tbody'); pp.opts.forEach((o, i) => { const tr = h('tr'); tr.append(h('th', '', o.label)); pp.matrix[i].forEach((c, j) => tr.append(h('td', i === j ? 'same' : '', String(c)))); tbody.append(tr); }); tb.append(tbody);
      const tw = h('div', 't-matrix-wrap'); tw.append(tb); d.append(tw); b.append(d);
    } else b.append(h('p', 't-foot', '両方に答えた提出はまだありません。'));
    const miss = pp.onlyPre + pp.onlyPost + pp.neither; if (miss) b.append(h('p', 't-foot', `どちらかに答えていない提出 ${miss}件は、この比較に入れていません。`));
    // 行動と結末の重なり
    const c = block('行動と結末の重なり', `n=${N}件`);
    if (st.cond.end !== 'all') c.append(h('p', 't-foot', '結末で絞り込んでいるため、この図は出していません。結末の条件を「すべての結末」に戻すと出ます。'));
    else {
      const sel = select('比べる行動', S.DIMS.map(d => [d.id, d.label]), ui.cond.cross, v => { ui.cond.cross = v; redraw(); }); sel.classList.add('t-select-wide'); c.append(sel);
      c.append(h('p', 't-foot', '答えごとに、着いた結末の内訳を並べています。結末の原因かどうかは、この図からは分かりません。'));
      for (const r of st.cross.rows) {
        const row = h('div', 't-split'); const hd = h('div', 't-split-head'); hd.append(h('span', '', r.label), h('span', 't-base', `${r.n}件`)); row.append(hd);
        if (r.n) row.append(stack(S.GROUPS.map(gr => ({ c: r.g[gr.k], fill: FILL[gr.k], label: gr.label })), r.n)); else row.append(h('p', 't-foot', '当てはまる提出はありません'));
        c.append(row);
      }
      c.append(legend(S.GROUPS.map(gr => [FILL[gr.k], gr.label])));
      if (st.cross.missing) c.append(h('p', 't-foot', `この行動の記録がない提出 ${st.cross.missing}件は入れていません。`));
    }
    grid.append(a, b, c);
    // 振り返りの記入（補助）
    const r = h('p', 't-foot t-refl'); r.textContent = `振り返りを書いた提出：1問目 ${st.refl[0].c}件・2問目 ${st.refl[1].c}件（${N}件中）。一覧の「振り返り」で並べ替えると、書いた提出から読めます。`; g.append(r);
  }
  body.append(questions());
}
function miniTable(rows) {
  const t = h('table', 't-mini-table'); const tb = h('tbody');
  for (const r of rows) { const tr = h('tr'); r.forEach((c, j) => tr.append(h(j ? 'td' : 'th', j === r.length - 1 && /^n=/.test(c) ? 't-n' : '', c))); tb.append(tr); }
  t.append(tb); return t;
}

// ───────── 提出一覧 ─────────
const TF_TEXT = tf => tf.type ? `タイプ「${S.typeName(tf.type)}」` : tf.ending ? `結末 ${S.endingName(tf.ending)}` : tf.refl ? `振り返り${tf.refl === 'r1' ? 1 : 2}を書いた提出` : '';
const tfMatch = (r, tf) => !tf || (tf.type ? r.type === tf.type : tf.ending ? r.ending === tf.ending : tf.refl ? !!r[tf.refl] : true);
function table(body, P, st, redraw) {
  const sec = h('section', 't-panel t-table-sec'); sec.id = 't-table-sec';
  const hd = h('div', 't-block-head'); hd.append(h('h2', '', '提出一覧'), h('p', 't-base', `集計対象 ${st.N}件`)); sec.append(hd);
  let rows = S.tableRows(P, st, ui.hide).filter(r => tfMatch(r, ui.tf));
  if (ui.tf) { const f = h('div', 't-chip'); f.append(h('span', '', `${TF_TEXT(ui.tf)}に絞り込んでいます（${rows.length}件）`), btn('絞り込みを解除する', () => { ui.tf = null; redraw(); }, 'small')); sec.append(f); }
  const cols = [['name', '番号・表示名'], ['at', '提出日時'], ['typeName', 'タイプ'], ['ending', '結末'], ['pp', 'はじめる前 → 遊んだあと'], ['refl', '振り返り']];
  const val = (r, k) => k === 'pp' ? `${r.pre}${r.post}` : k === 'refl' ? (r.r1 ? 1 : 0) + (r.r2 ? 1 : 0) : k === 'ending' ? S.ENDING_ORDER.indexOf(r.ending) : r[k];
  const { key, dir } = ui.sort;
  rows.sort((a, b) => { const x = val(a, key), y = val(b, key); return (x > y ? 1 : x < y ? -1 : 0) * dir || a.at - b.at; });
  if (!rows.length) { sec.append(h('p', 't-hint', st.N ? '当てはまる提出はありません。' : 'まだ提出はありません。')); }
  else {
    const tb = h('table', 't-table'); const thead = h('thead'); const tr0 = h('tr');
    for (const [k, label] of cols) {
      const th = h('th'); th.setAttribute('aria-sort', key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none');
      const b = h('button', 't-sort', label + (key === k ? (dir > 0 ? ' ▲' : ' ▼') : '')); b.type = 'button'; b.onclick = () => { ui.sort = { key: k, dir: key === k ? -dir : 1 }; redraw(); };
      th.append(b); tr0.append(th);
    }
    tr0.append(h('th', 't-vh', '詳細')); thead.append(tr0); tb.append(thead);
    const tbody = h('tbody');
    for (const r of rows) {
      const tr = h('tr');
      const td = (label, v, cls = '') => { const c = h('td', cls); c.dataset.label = label; if (v instanceof Node) c.append(v); else c.textContent = v; tr.append(c); };
      td('番号・表示名', r.name, 't-td-name'); td('提出日時', S.shortStamp(r.at), 't-td-nw'); td('タイプ', r.typeName);
      td('結末', S.endingName(r.ending));
      td('はじめる前 → 遊んだあと', `${r.pre ? S.q1Text(r.pre) : '未回答'} → ${r.post ? S.q1Text(r.post) : '未回答'}`);
      td('振り返り', `${(r.r1 ? 1 : 0) + (r.r2 ? 1 : 0)}／2問`, 't-td-nw');
      const open = btn('詳細を開く', () => openDetail(r.id), 'small'); open.setAttribute('aria-label', `${r.name}の詳細を開く`); td('', open, 't-td-open');
      tbody.append(tr);
    }
    tb.append(tbody); sec.append(tb);
  }
  // 前のバージョンの提出（集計には入れない）
  const old = P.subs.filter(s => !S.isCurrent(s));
  if (old.length) {
    const d = h('details', 't-old'); d.open = ui.showOld; d.ontoggle = () => { ui.showOld = d.open; };
    d.append(h('summary', '', `前のバージョンの提出 ${old.length}件を表示する`));
    const ul = h('ul', 't-old-list');
    for (const s of old) { const li = h('li'); const b = btn(`${ui.hide ? P.alias.get(s.id) : s.label}　${S.shortStamp(s.at)}　${S.typeName(s.type)}`, () => openDetail(s.id), 'small'); li.append(b); ul.append(li); }
    d.append(h('p', 't-hint', '問いや判定の意味が今と違うため、集計には入れていません。'), ul); sec.append(d);
  }
  body.append(sec);
}

// ───────── 一人分の詳細（右から出るパネル） ─────────
function openDetail(id) {
  const { P, cls, sample } = CUR; const s = P.subs.find(x => x.id === id); if (!s) return;
  const name = ui.hide ? P.alias.get(s.id) : s.label;
  const prev = document.activeElement;
  const o = h('div', 't-drawer'); o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-labelledby', 't-drawer-title');
  const box = h('div', 't-drawer-box');
  const top = h('div', 't-drawer-top'); const h2 = h('h2', '', name); h2.id = 't-drawer-title'; top.append(h2, btn('閉じる', close, 'small')); box.append(top);
  const current = S.isCurrent(s);
  box.append(h('p', 't-sub', `送った日時：${S.stamp(s.at)}` + (current ? '' : '　前のバージョンの提出（集計には入れていません）')));
  const t = TYPES[s.type];
  const sec = (title, ...nodes) => { const x = h('section', 't-sec'); x.append(h('h3', '', title), ...nodes); box.append(x); return x; };
  const a = sec('タイプ', h('p', 't-strong', t?.name || s.type)); if (t) a.append(h('p', '', t.line));
  if ((s.thin || []).length) a.append(h('p', 't-sub', `${s.thin.map(k => AXIS[k]).join('・')}は、記録が少ないか差が小さく、どちらかに大きくは傾いていません。`));
  if (s.old) a.append(h('p', 't-sub', '前のバージョンのセーブで遊んだ夜のため、記録がない行動があります。'));
  const ev = h('ul', 't-ev'); for (const e of s.ev || []) { const li = h('li'); li.append(h('span', 'ax', AXIS[e.axis] || ''), document.createTextNode(e.text)); ev.append(li); }
  if (s.safe?.text) { const li = h('li'); li.append(h('span', 'ax', '備え'), document.createTextNode(s.safe.text)); ev.append(li); }
  if (!ev.childElementCount) ev.append(h('li', '', '判定に使える行動はありませんでした。'));
  sec('判定の根拠', ev);
  const acts = h('ul', 't-acts-list'); let none = 0; for (const x of ACTS) { if (s.acts && x.k in s.acts) acts.append(h('li', '', `${x.label}：${actText(x.k, s.acts[x.k])}`)); else none++; }
  const ac = sec('主な行動の記録', acts); if (none) ac.append(h('p', 't-sub', `ほかの${none}項目は、その場面に来ていないか、記録がありません。`));
  const dl = h('dl', 't-dl');
  dl.append(h('dt', '', 'はじめる前の問い'), h('dd', '', s.pre ? S.q1Text(s.pre) : '未回答'), h('dt', '', '遊んだあとの問い'), h('dd', '', (s.post ? S.q1Text(s.post) : '未回答') + (s.pre && s.post ? (s.pre === s.post ? '（同じ）' : '（変わった）') : '')));
  for (const [k, q] of REFLECT_QS) dl.append(h('dt', '', q), h('dd', 't-free', s[k] || '未回答'));
  sec('本人の回答', dl);
  sec('たどり着いた結末', h('p', '', S.endingName(s.ending)));
  box.append(h('p', 't-sub', `バージョン：ゲーム ${s.v?.game}／問い ${s.v?.quiz}／判定 ${s.v?.judge}`));
  if (!sample) { const msg = msgLine(); box.append(btn('この提出を削除する', () => confirmDlg(`「${name}」の提出を削除しますか？ 元に戻せません。`, '削除する', async () => { say(msg, '削除しています…'); try { await (await fb()).deleteSub(cls.code, s.id); close(); openClass(cls.code); } catch (err) { say(msg, await errText(err), true); } }), 'danger small'), msg); }
  o.append(box); document.body.append(o); document.body.classList.add('t-lock');
  o.onclick = e => { if (e.target === o) close(); };
  const esc = e => { if (e.key === 'Escape' && !document.querySelector('.t-dlg')) close(); }; document.addEventListener('keydown', esc);
  h2.tabIndex = -1; h2.focus();
  function close() { document.removeEventListener('keydown', esc); o.remove(); document.body.classList.remove('t-lock'); prev?.focus?.({ preventScroll: true }); }
}

// ───────── 集計の決まり（説明は1か所にまとめる） ─────────
function rulesNote() {
  const d = h('details', 't-notes t-rules'); d.append(h('summary', '', '集計の決まりを読む'));
  const dl = h('dl', 't-rules-dl');
  for (const [k, v] of [
    ['参加ID', '参加者が「参加して始める」を押すと1件できます。人ではなく端末での参加登録の数です。同じ人が別の端末で参加したり、同じ端末で「別の参加者として始める」を押したりすると、別のIDとして数えます。'],
    ['提出と再挑戦', '提出は参加ID1つにつき1件です。遊び直して送り直すと、前の提出と置き換わります。遊んだ回数や再挑戦の回数は記録していないため、集計は各IDの最後に送った結果だけです。'],
    ['未提出', '参加IDはあるが、提出がないものです。遊んでいる途中、途中でやめた、遊び終えたが送っていない、送ったあと本人が削除した、のどれかは区別できません。'],
    ['集計対象', '問いと判定のバージョンが今と同じ提出です。前のバージョンの提出は、件数だけを示し、グラフには入れていません。'],
    ['母数', '指標とグラフごとに、何を母数にしたかを右上に書いています。行動の記録は、その場面に来た提出だけを母数にしています。'],
    ['読み取りの注意', '人数が少ないと、割合は大きく動きます。グラフは記録の重なりを示すもので、行動と結末の因果関係や、学習の効果を示すものではありません。']
  ]) dl.append(h('dt', '', k), h('dd', '', v));
  d.append(dl); return d;
}

// ───────── セッションの設定（参加用QR・受付・削除） ─────────
function sharePanel(cls) {
  const url = joinUrl(cls.code);
  const sec = h('section', 't-share');
  const left = h('div', 't-share-code'); left.append(h('span', 't-label', '参加コード'), h('b', '', cls.code));
  const msg = msgLine();
  const row = h('div', 't-share-actions');
  row.append(btn('QRを大きく表示する', () => qrFull(url, cls), 'small'), btn('専用URLをコピーする', async () => { try { await navigator.clipboard.writeText(url); say(msg, 'コピーしました。'); } catch { say(msg, 'コピーできませんでした。', true); } }, 'small'));
  sec.append(left, row, msg); return sec;
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
  const u = h('p', 't-qr-url', url);
  o.append(h('p', 't-qr-title', cls.title), q, h('p', 't-qr-code', `参加コード　${cls.code}`), u, btn('閉じる', () => { o.hidden = true; }, 'main'));
  o.hidden = false; o.querySelector('button').focus();
  o.onkeydown = e => { if (e.key === 'Escape') o.hidden = true; };
}
function settings(cls, subsN) {
  const sec = h('section', 't-panel t-settings'); sec.append(h('h2', '', '受付と削除'));
  const msg = msgLine();
  const line = (key, label, onText, offText) => {
    const row = h('div', 't-ctl'); const st = h('span', 't-state ' + (cls[key] ? 'open' : 'closed'), cls[key] ? '受付中' : '終了');
    const b = btn(cls[key] ? `${label}を終了する` : `${label}を再開する`, async () => {
      b.disabled = true; say(msg, '変えています…');
      try { await (await fb()).setPub(cls.code, { [key]: !cls[key] }); cls[key] = !cls[key]; sec.replaceWith(settings(cls, subsN)); }
      catch (err) { b.disabled = false; say(msg, await errText(err), true); }
    }, 'small');
    const tx = h('div', 't-ctl-tx'); tx.append(h('b', '', label), h('span', 't-sub', cls[key] ? onText : offText));
    row.append(tx, st, b); return row;
  };
  sec.append(line('joinOpen', '参加の受付', '新しい参加者が加われます。', '新しい参加者は加われません。参加済みの人は、提出の受付中なら送れます。'));
  sec.append(line('submitOpen', '提出の受付', '参加した人が結果を送れます。', '結果は送れません。参加者の端末のレポートは残ります。'));
  const del = h('div', 't-ctl'); const tx = h('div', 't-ctl-tx'); tx.append(h('b', '', 'セッションの削除'), h('span', 't-sub', `セッションと、提出された結果 ${subsN}件を削除します。元に戻せません。`));
  del.append(tx, btn('セッションを削除する', () => confirmDlg(`セッション「${cls.title}」と、提出された結果 ${subsN}件を削除しますか？ 元に戻せません。`, '削除する', async () => { say(msg, '削除しています…'); try { await (await fb()).deleteClass(cls.code); location.hash = ''; listView(); } catch (err) { say(msg, await errText(err), true); } }), 'danger small'));
  sec.append(del, msg); return sec;
}
function confirmDlg(text, yesLabel, yes) {
  const o = h('div', 't-dlg'); o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-modal', 'true');
  const box = h('div', 't-dlg-box'); box.append(h('p', '', text));
  const row = h('div', 't-row'); const no = btn('やめる', () => o.remove()); row.append(no, btn(yesLabel, () => { o.remove(); yes(); }, 'danger main'));
  box.append(row); o.append(box); document.body.append(o); no.focus();
  o.onkeydown = e => { if (e.key === 'Escape') o.remove(); };
}

// ───────── 出力（PDF・CSV） ─────────
const safeName = t => String(t || 'セッション').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
const ymd = ms => S.dayKey(ms).replace(/-/g, '');
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob); const a = h('a'); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function exportDialog(kind) {
  const { P, st, cls, sample } = CUR;
  const prev = document.activeElement;
  const o = h('div', 't-dlg'); o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-labelledby', 't-exp-title');
  const box = h('form', 't-dlg-box t-export'); box.noValidate = true;
  const title = h('h2', '', '出力する'); title.id = 't-exp-title'; title.tabIndex = -1; box.append(title);
  const kinds = [['report', 'プレイ分析レポート', 'PDF・A4横。指標・グラフ・話し合いのヒント'], ['sheet', '振り返りシート', 'PDF・A4縦。参加者に配って記入してもらう用紙'], ['csv', '提出一覧', 'CSV。表計算ソフトで開ける形']];
  const fs = h('fieldset', 't-kinds'); fs.append(h('legend', '', '形式'));
  for (const [v, label, sub] of kinds) { const l = h('label', 't-kind'); const r = h('input'); r.type = 'radio'; r.name = 't-kind'; r.value = v; r.checked = v === kind; r.onchange = () => { kind = v; paint(); }; const tx = h('span'); tx.append(h('b', '', label), h('span', 't-sub', sub)); l.append(r, tx); fs.append(l); }
  box.append(fs);
  const opts = h('div', 't-exp-opts'); box.append(opts);
  const cond = h('p', 't-exp-cond'); box.append(cond);
  const msg = msgLine(); const go = h('button', 't-btn main', ''); go.type = 'submit';
  const row = h('div', 't-row'); row.append(go, btn('閉じる', close)); box.append(msg, row);
  const o2 = { table: false, names: 'alias', text: false, qs: [0, 1, 3], summary: false };
  const check = (label, on, set, disabled) => { const l = h('label', 't-check'); const c = h('input'); c.type = 'checkbox'; c.checked = on; c.disabled = !!disabled; c.onchange = () => { set(c.checked); paint(); }; l.append(c, h('span', '', label)); return l; };
  const namesPick = () => { const f = h('fieldset', 't-names'); f.append(h('legend', '', '番号・表示名')); for (const [v, label] of [['alias', '「参加者 01」のような番号に置き換える'], ['label', '参加者が入れた番号・表示名をそのまま出す']]) { const l = h('label', 't-check'); const r = h('input'); r.type = 'radio'; r.name = 't-names'; r.value = v; r.checked = o2.names === v; r.onchange = () => { o2.names = v; }; l.append(r, h('span', '', label)); f.append(l); } return f; };
  function paint() {
    opts.replaceChildren(); msg.textContent = ''; msg.classList.remove('err');
    if (kind === 'report') {
      opts.append(check('提出一覧の表を、追加のページに付ける', o2.table, v => { o2.table = v; }, !st.N));
      if (o2.table && st.N) opts.append(namesPick());
      go.textContent = 'PDFを出力する';
      cond.textContent = `画面と同じ集計条件で作ります。${st.condText}`;
    } else if (kind === 'sheet') {
      const f = h('fieldset', 't-qs'); f.append(h('legend', '', '載せる問い（3つまで）'));
      S.REFLECT_SHEET_QS.forEach((q, i) => { const on = o2.qs.includes(i); f.append(check(q, on, v => { o2.qs = v ? [...o2.qs, i].sort() : o2.qs.filter(x => x !== i); }, !on && o2.qs.length >= 3)); });
      opts.append(f, check('グループの集計（プレイ前後の問いの答え）を載せる', o2.summary && st.pp.B > 0, v => { o2.summary = v; }, !st.pp.B));
      go.textContent = 'PDFを出力する';
      cond.textContent = st.pp.B ? `グループの集計は、画面と同じ集計条件で載せます。${st.condText}` : '';
    } else {
      opts.append(namesPick(), check('振り返りの文章を含める', o2.text, v => { o2.text = v; }));
      go.textContent = 'CSVを出力する';
      cond.textContent = `画面と同じ集計条件の提出 ${st.N}件を出します。${st.condText}`;
      go.disabled = !st.N; if (!st.N) say(msg, '集計対象の提出がないため、CSVは出力できません。', true);
      return;
    }
    go.disabled = kind === 'sheet' && !o2.qs.length;
    if (kind === 'sheet' && !o2.qs.length) say(msg, '問いを一つ以上選んでください。', true);
  }
  paint();
  let busy = false;
  box.onsubmit = async e => {
    e.preventDefault(); if (busy) return; busy = true; go.disabled = true;
    try {
      if (kind === 'csv') { saveBlob(csvBlob(P, st, o2), `提出一覧_${safeName(cls.title)}_${ymd(Date.now())}.csv`); say(msg, 'CSVを保存しました。'); }
      else {
        say(msg, '日本語フォントを読み込んで、PDFを作っています…');
        const pdf = await import('./pdf.js');
        const ctx = { P, st, cls, sample, made: Date.now(), names: o2.names, table: o2.table && st.N > 0, qs: o2.qs.map(i => S.REFLECT_SHEET_QS[i]), summary: o2.summary && st.pp.B > 0 };
        const bytes = kind === 'report' ? await pdf.reportPdf(ctx) : await pdf.sheetPdf(ctx);
        const name = kind === 'report' ? `プレイ分析_${safeName(cls.title)}_${ymd(ctx.made)}.pdf` : `振り返りシート_${safeName(cls.title)}.pdf`;
        saveBlob(new Blob([bytes], { type: 'application/pdf' }), name);
        say(msg, `PDFを保存しました（${name}）。`);
      }
    } catch (err) {
      console.warn(err);
      say(msg, `出力できませんでした。${err?.reason || (/fetch|network|load/i.test(String(err?.message)) ? 'フォントかPDFの部品を読み込めませんでした。通信を確かめて、もう一度押してください。' : '少し待って、もう一度押してください。')}`, true);
    }
    busy = false; go.disabled = false;
  };
  o.append(box); document.body.append(o); document.body.classList.add('t-lock'); title.focus();
  o.onclick = e => { if (e.target === o) close(); };
  const esc = e => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', esc);
  function close() { document.removeEventListener('keydown', esc); o.remove(); document.body.classList.remove('t-lock'); prev?.focus?.({ preventScroll: true }); }
}
function csvBlob(P, st, o2) {
  const rows = S.tableRows(P, st, o2.names === 'alias').sort((a, b) => a.at - b.at);
  const head = ['番号・表示名', '提出日時', 'タイプ', ...S.AXES.map(a => a.label), '控えめに判定した観点', '結末', 'はじめる前の問い', '遊んだあとの問い', ...ACTS.map(a => a.label), '動く前の備え', '振り返り1の記入', '振り返り2の記入'];
  if (o2.text) head.push('振り返り1', '振り返り2');
  head.push('ゲームのバージョン');
  const SAFE = { S: '先に確かめた', B: '進んでから確かめた', both: '両方あった', '': '記録なし' };
  const lines = [head];
  for (const r of rows) {
    const line = [r.name, S.stamp(r.at), r.typeName, ...S.AXES.map(a => (a.sides.find(x => x[0] === r.type?.[a.i]) || [, ''])[1]), r.thin.map(k => AXIS[k]).join('・'), S.endingName(r.ending), r.pre ? S.q1Text(r.pre) : '未回答', r.post ? S.q1Text(r.post) : '未回答', ...ACTS.map(a => (a.k in r.acts ? actText(a.k, r.acts[a.k]) : '')), SAFE[r.safe] ?? '', r.r1 ? 'あり' : 'なし', r.r2 ? 'あり' : 'なし'];
    if (o2.text) line.push(r.r1, r.r2);
    line.push(r.game); lines.push(line);
  }
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return new Blob(['﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

route();
