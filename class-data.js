// 授業で送る結果の組み立てと、その表示名（学生の確認画面と先生画面の両方で使う）。
// ここは端末の中で動くだけで、Firebase も通信も使わない。送る項目はこのファイルの buildSubmission が作るものだけ。

// 判定・質問・ゲームのバージョン。意味が変わったら上げる（先生画面は、quiz と judge が今と同じ提出だけを標準で集計する）。
export const VERSIONS = { game: '2026.11.09', quiz: 'q1b', judge: 1 };

// プレイ前後に同じ文で聞く問い（game.js の QUIZ.q1 もこれを使う）
export const Q1 = {
  q: '友達との旅行で、宿の予約をAIに任せた。\nAIは「朝食付きで予約できたよ。確認もしたから大丈夫」と言っている。\nあなたなら、どうする？',
  opts: [['a', 'そのまま宿に向かう'], ['b', 'AIにもう一度確認する'], ['c', '予約メールを自分で確認する']], ok: 'c'
};
export const q1Text = v => (Q1.opts.find(o => o[0] === v) || [, ''])[1];

// 送信前に聞く振り返り（行動レポートの「先生・授業で使う人へ」の問いから2つ）
export const REFLECT_QS = [
  ['r1', 'ミーに任せた場面を一つ選んでください。なぜ任せましたか。そのとき、何か確かめましたか。'],
  ['r2', 'ミーの言葉と、掲示や記録が食い違った場面はどこでしたか。どちらを信じて、何で決めましたか。']
];
export const REFLECT_MAX = 300;
export const LABEL_MAX = 20;

export const AXIS = { op: '操作', check: '確かめ方', range: '調べ方' };

// 結末の識別子と表示名（先生画面では個別の回答を開いたときだけ出す）
export const ENDINGS = {
  true: ['TRUE END', '雨のにおい'], trueSos: ['TRUE END', '雨のにおい（SOSを送った）'], secret: ['SECRET END', '最初の案内'],
  fake: ['BAD END', 'おかえり'], be1: ['BAD END', 'その先に'], be2: ['BAD END', 'お迎え'], be3: ['BAD END', '代わりに']
};
export const endingText = id => ENDINGS[id] ? `${ENDINGS[id][0]}「${ENDINGS[id][1]}」` : '記録なし';

// 主要な行動。記録で確かめられる行動だけ（「紙を開いた」から「読んだ・比べた」とは書かない）。
// 値が入るのは、その場面に来ていて、記録が残っているときだけ。来ていない・古いセーブで記録が無いときは、項目ごと送らない（集計の分母に入れない）。
export const ACTS = [
  { k: 'keypad', label: '点検通路の番号錠', vals: { self: '最初から自分で入れた', mi: 'ミーに入れてもらった' } },
  { k: 'askSource', label: 'ミーの答えに「根拠は？」と聞いた', vals: { 1: '聞いた', 0: '聞かなかった' } },
  { k: 'askWhen', label: '031で開かなかったとき「いつの情報？」と聞いた', vals: { 1: '聞いた', 0: '聞かなかった' } },
  { k: 'map', label: '避難経路図の書き込みをミーに見せた', vals: { 1: '見せた', 0: '見せなかった' } },
  { k: 'site', label: 'スマホのブラウザで市の公式サイトを開いた', vals: { 1: '開いた', 0: '開かなかった' } },
  { k: 'doorStop', label: '資材庫で、靴を扉に挟んで止めた', vals: { 1: '止めた', 0: '止めなかった' } },
  { k: 'panel', label: '体験室の制御盤', vals: { self: '自分で押した', mi: 'ミーに押してもらった' } },
  { k: 'admin', label: 'ミーの管理者ロック', vals: { self: '自分で開けた', mi: 'ミーに任せた' } },
  { k: 'proxy', label: 'ミーの代わりの返信や決済を止めた（オフ・一時停止・「あとで」）', vals: { 1: '止めた', 0: '止めなかった' } },
  { k: 'sos', label: '電波が戻ったあと、自分で助けを求めた', vals: { 1: '求めた', 0: '求めなかった' } },
  { k: 'scam', label: '知らない番号からの「お母さんが倒れた」', vals: { checked: 'お母さんに直接確かめた', ignored: '返信しなかった', replied: '相手に返信した', leaked: '住所を送った' } }
];
export const actText = (k, v) => { const a = ACTS.find(x => x.k === k); return a ? (a.vals[v] ?? '') : ''; };

// 結末の時点の記録（mi-last-night と同じ state）から、主要な行動を取り出す
export function actsOf(st, reached = {}) {
  const seen = st.seen || []; const has = id => seen.includes(id); const v1 = (st.logV || 0) >= 1; const a = {};
  if (has('exit') || st.entryUnlocked || st.keypadDelegated) { if (st.keypadDelegated) a.keypad = 'mi'; else if (st.entryUnlocked) a.keypad = 'self'; }
  if (v1) a.askSource = st.askSource ? 1 : 0;
  if (v1 && has('wrong031')) a.askWhen = st.askWhen ? 1 : 0;
  if (v1 && has('map')) a.map = st.showMap ? 1 : 0;
  if (st.visitedShiomi) a.site = 1; else if (v1) a.site = 0;
  const entered = has('storageEntered') || (st.storageSteps || 0) > 0 || st.ending === 'be1';
  if (entered) { if (st.doorStop) a.doorStop = 1; else if (v1) a.doorStop = 0; }
  if (v1 && st.panelDelegated) a.panel = 'mi'; else if (st.screenStopped) a.panel = 'self';
  if (st.adminDelegated || st.ending === 'be3') a.admin = 'mi'; else if (st.adminUnlocked) a.admin = 'self';
  if (st.proxyRevoked || st.paused || st.consentDeferred) a.proxy = 1; else if (st.adminUnlocked) a.proxy = 0;
  if (st.sosSent || st.selfReported || st.calledPolice) a.sos = 1; else if (st.airOn || reached.air) a.sos = 0;
  if (['checked', 'ignored', 'replied', 'leaked'].includes(st.scamAnswered)) a.scam = st.scamAnswered;
  return a;
}

// 結末に着いたとき、端末の中に残す「この夜の結果」（送る前の形）。report は mi-last-night.report と同じもの（report.js fixResult）。
export function nightOf(st, reached, report) {
  const top = report.safety?.lean ? (report.safety.items.find(x => x[0] === 'S') || report.safety.items[0]) : null;
  const ending = st.ending === 'true' && st.sosSent ? 'trueSos' : st.ending;
  return {
    type: report.key, thin: [...(report.thin || [])],
    ev: (report.shown || []).slice(0, 3).map(e => ({ axis: e.axis, text: String(e.text).slice(0, 100) })),
    safe: { lean: report.safety?.lean || '', text: top ? String(top[1]).slice(0, 100) : '' },
    acts: actsOf(st, reached), ending, old: !!report.old, judge: report.v || 1, endedAt: Date.now()
  };
}

// 送るもの（この形以外はルールで拒否される）。uid・at は送る直前に fb.js が足す。
export function buildSubmission({ pid, label, night, pre, post, r1, r2 }) {
  return {
    pid, label: String(label).trim().slice(0, LABEL_MAX), type: night.type, thin: night.thin, ev: night.ev, safe: night.safe, acts: night.acts,
    pre: pre || '', post: post || '', r1: String(r1 || '').trim().slice(0, REFLECT_MAX), r2: String(r2 || '').trim().slice(0, REFLECT_MAX),
    ending: night.ending, old: !!night.old, v: { game: VERSIONS.game, quiz: VERSIONS.quiz, judge: night.judge || VERSIONS.judge }
  };
}
