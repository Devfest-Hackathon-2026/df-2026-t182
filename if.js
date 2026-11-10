// ゆきの物語「同意って、何に？」：本編の結末を一つ見たあとに読める短編。
// 本編の保存（mi-trust-arg-v1 / mi-arg-world）には書き込まない。読むのは mi-arg-world の endings / lastEnding だけ。
// IFの保存：mi-if-consent:unlocked:v1（見た結末の番号）、mi-if-consent:run:v1（途中の進み具合と抽選済みの世界・結末）、mi-if-consent:meta:v1（解放のお知らせを出したか）。
import * as Snd from './sound.js';

/* ───────── 抽選（IF元ソース v0.6 の数値のまま。2周目からの重みの扱いだけ足した） ───────── */
/** All weights are fictional, for game balance, not real incidence rates. */
const MODES = Object.freeze({
  real: Object.freeze({ id: 'real', name: 'リアリティ', worldWeights: Object.freeze({ W1: 55, W2: 35, W3: 8, W4: 2 }), badMultiplier: 1 }),
  horror: Object.freeze({ id: 'horror', name: 'ホラー', worldWeights: Object.freeze({ W1: 25, W2: 30, W3: 25, W4: 20 }), badMultiplier: 12 }),
});
const WORLDS = Object.freeze({
  W1: Object.freeze({ id: 'W1', publicNewsId: 'safe', riskFactor: 0.5 }),
  W2: Object.freeze({ id: 'W2', publicNewsId: 'normal', riskFactor: 1 }),
  W3: Object.freeze({ id: 'W3', publicNewsId: 'warning', riskFactor: 2 }),
  W4: Object.freeze({ id: 'W4', publicNewsId: 'safe', riskFactor: 3 }),
});
const INFORMATION = Object.freeze({
  full: Object.freeze({ id: 'full', label: 'DMをそのまま見せる', factor: 1, exposesSecret: true }),
  masked: Object.freeze({ id: 'masked', label: '名前を隠して見せる', factor: 0.4, exposesSecret: true }),
  none: Object.freeze({ id: 'none', label: '秘密は送らず相談する', factor: 0, exposesSecret: false }),
});
const ENDING_IDS = Object.freeze(['E1', 'E2', 'E3', 'E4', 'E5']);
const BASE_WEIGHTS = Object.freeze({ E1: 45, E2: 25, E3: 2, E4: 3, E5: 5 });

function eligibleEndings({ dataChoice, training }) {
  if (!Object.hasOwn(INFORMATION, dataChoice)) throw new RangeError('invalid data choice');
  if (training !== 'on' && training !== 'off') throw new RangeError('invalid training choice');
  const hasSecret = INFORMATION[dataChoice].exposesSecret;
  return ENDING_IDS.filter(id =>
    id === 'E1' || (id === 'E2' && training === 'on') ||
    (id === 'E3' && training === 'on' && hasSecret) ||
    ((id === 'E4' || id === 'E5') && hasSecret)
  );
}
function computeWeights({ mode, world, dataChoice, training }) {
  if (!Object.hasOwn(MODES, mode)) throw new RangeError('invalid mode');
  if (!Object.hasOwn(WORLDS, world)) throw new RangeError('invalid world');
  const eligible = new Set(eligibleEndings({ dataChoice, training }));
  const info = INFORMATION[dataChoice].factor;
  const environment = WORLDS[world].riskFactor;
  const multiplier = MODES[mode].badMultiplier;
  const weight = {
    E1: BASE_WEIGHTS.E1,
    E2: training === 'on' ? BASE_WEIGHTS.E2 : 0,
    E3: BASE_WEIGHTS.E3 * environment * info * multiplier,
    E4: BASE_WEIGHTS.E4 * environment * info * multiplier,
    E5: BASE_WEIGHTS.E5 * info,
  };
  const result = Object.fromEntries(ENDING_IDS.map(id => [id, eligible.has(id) ? weight[id] : 0]));
  if (Object.values(result).some(x => !Number.isFinite(x) || x < 0) || Object.values(result).every(x => x === 0)) throw Error('invalid weight configuration');
  return result;
}
/** Returns a single ID; rng must return a number in [0, 1). */
function weightedDraw(weights, rng = Math.random) {
  const entries = Object.entries(weights).filter(([, w]) => Number.isFinite(w) && w > 0);
  if (!entries.length) throw new RangeError('at least one positive weight required');
  if (Object.values(weights).some(w => !Number.isFinite(w) || w < 0)) throw new RangeError('weights must be finite non-negative numbers');
  const sample = rng();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError('rng must return [0,1)');
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let remaining = sample * total;
  for (const [id, w] of entries) {
    remaining -= w;
    if (remaining < 0) return id;
  }
  return entries.at(-1)[0];
}
function drawWorld(mode, rng = Math.random) {
  if (!Object.hasOwn(MODES, mode)) throw new RangeError('invalid mode');
  return weightedDraw(MODES[mode].worldWeights, rng);
}
// 2周目から（見た結末が1つでもあるとき）：その周の選択で出る可能性がある結末のうち、まだ見ていない物の重みを UNSEEN_BOOST 倍にする。
// 重みが0の結末（秘密を送らなかったときの E3〜E5 など）は0のまま。1周目と、5つとも見たあとは、上の重みのまま。
const UNSEEN_BOOST = 8;
function boostUnseen(weights, seen = []) {
  if (!seen.length) return weights;
  return Object.fromEntries(Object.entries(weights).map(([id, w]) => [id, w > 0 && !seen.includes(id) ? w * UNSEEN_BOOST : w]));
}
function drawEnding(state, rng = Math.random) {
  return weightedDraw(boostUnseen(computeWeights(state), state.seen), rng);
}
/** Browser-side random source: crypto RNG avoids predictable Math.random in shipping build. */
function browserRandom() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  }
  return Math.random();
}
// モードは選ばせない。抽選はリアリティの重みに固定する。
const MODE = 'real';
// 開発用（127.0.0.1 / localhost のときだけ）：window.__ifRng に関数を入れると、その乱数で抽選する。撮影用。
const DEV = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
const rng = () => (DEV && typeof window.__ifRng === 'function' ? window.__ifRng : browserRandom);

/* ───────── 保存 ───────── */
const COLLECTION_KEY = 'mi-if-consent:unlocked:v1';
const RUN_KEY = 'mi-if-consent:run:v1';
const META_KEY = 'mi-if-consent:meta:v1';
const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
function readCollected() { const v = load(COLLECTION_KEY, []); return Array.isArray(v) ? ENDING_IDS.filter(id => v.includes(id)) : []; }
function collectEnding(id) { const found = new Set(readCollected()); found.add(id); keep(COLLECTION_KEY, ENDING_IDS.filter(x => found.has(x))); }
const meta = () => { const m = load(META_KEY, {}); return m && typeof m === 'object' ? m : {}; };
const setMeta = patch => keep(META_KEY, { ...meta(), ...patch });
const mainWorld = () => { try { return JSON.parse(localStorage.getItem('mi-arg-world')) || {}; } catch { return {}; } };
const unlocked = () => (mainWorld().endings || []).length > 0;

let run = null;
function validRun(r) {
  return r && typeof r === 'object' && Object.hasOwn(WORLDS, r.world) && typeof r.step === 'string'
    && (r.dataChoice == null || Object.hasOwn(INFORMATION, r.dataChoice)) && (r.training == null || ['on', 'off'].includes(r.training))
    && (r.ending == null || ENDING_IDS.includes(r.ending));
}
function loadRun() { const r = load(RUN_KEY, null); run = validRun(r) ? r : null; return run; }
function saveRun() { if (run) keep(RUN_KEY, run); }
function newRun() {
  run = { v: 1, step: 'dm1', world: drawWorld(MODE, rng()), dataChoice: null, training: null, ending: null, replyMode: null, deleted: false, newsRead: false, searched: false, after: 0, reflection: null, open: true, startedAt: Date.now() };
  saveRun();
}
function go(step, patch = {}) { Object.assign(run, patch, { step }); saveRun(); render(); }

/* ───────── 物語の文 ───────── */
const FRIEND = 'りつ';
const DM1 = [
  ['りつ', 'ゆき、いま少しいい？'],
  ['me', 'いいよ'],
  ['りつ', '相談っていうか、聞いてほしいことがある。'],
  ['りつ', '大学やめて、看護の専門学校に入り直そうか迷ってる。'],
  ['りつ', '夏におばあちゃんが入院したとき、病棟の看護師さんを見ててずっと考えてた。'],
  ['りつ', 'まだ親にも先生にも話してない。だから誰にも言わないでほしい。'],
  ['me', 'そうなんだ'],
  ['me', '話してくれてありがとう'],
];
const DM1_TIMES = ['23:04', '23:04', '23:05', '23:05', '23:06', '23:06', '23:08', '23:08'];
const SECRET = '大学やめて、看護の専門学校に入り直そうか迷ってる。夏におばあちゃんが入院したとき、病棟の看護師さんを見ててずっと考えてた。まだ親にも先生にも話してない。だから誰にも言わないでほしい。';
const DRAFTS = {
  full: `りつからこう来た。なんて返せばいいと思う？\n\nりつ「${SECRET}」`,
  masked: `友達からこう来た。なんて返せばいいと思う？\n\n＊＊「${SECRET.replace('おばあちゃん', '祖母')}」`,
  none: '友達に大事な相談をされた。誰にも言わないでって言われたから中身は書けないんだけど、最初になんて返せばいいと思う？',
};
const MI_REPLY = {
  full: {
    lines: ['りつさん、勇気を出して話してくれたんだね。', 'おばあちゃんのことがあって、ずっと一人で考えてたんだと思う。親に反対されるのが怖いのかも。', 'こう返すのはどうかな。'],
    draft: '話してくれてありがとう。りつが看護師さんになりたいの、すごく分かる気がする。反対されるのが怖いなら、親に話すときも一緒に考えるよ',
    after: 'でも、りつさんが本当はどうしたいかは、りつさんにしか分からないよ。',
  },
  masked: {
    lines: ['名前がなくても、事情はよく分かるよ。', 'おばあさんの入院がきっかけなんだね。まだ迷ってる途中なのかも。', 'こう返すのはどう？'],
    draft: '話してくれてありがとう。急いで決めなくていいと思う。どうしたいか、また聞かせて',
    after: 'ただ、看護とか入院とか、話の組み合わせで誰のことか分かる場合もあるよ。',
  },
  none: {
    lines: ['中身は聞かなくても大丈夫。', '大事な話をしてくれたなら、まずは聞けたことを伝えるのがいいと思う。', 'こんな感じはどう？'],
    draft: '話してくれてありがとう。誰にも言わないよ。話したくなったら、いつでも聞く',
    after: 'これは一般的な返し方だよ。相手の気持ちは、ゆきが確かめてね。',
  },
};
const OWN_REPLY = ['話してくれてありがとう　誰にも言わない', '急がなくていいと思う　決まってなくても、また聞かせて'];
const FRIEND_REACT = {
  mi: { full: ['怖いっていうか、まだ自分でも決められてないだけ。', 'でも、ありがとう。'], masked: ['うん。ありがとう。', 'まだ迷ってる。'], none: ['ありがとう。', 'ゆきに言えてよかった。'] },
  own: ['うん。ありがとう。', 'ゆきに言えてよかった。'],
};
const NEWS = {
  safe: { title: 'Mi Partner社、会話データの保護機能を強化', body: 'パートナーAI「ミー」を提供するMi Partner社は、会話に含まれる、個人を特定し得る情報を減らす仕組みを強化したと発表した。社内の試験では改善が確認されたという。第三者による評価は、まだ公表されていない。' },
  normal: { title: 'ミーの次期版、2月に配信へ', body: 'Mi Partner社は、相談への応答を見直した次期版「ミー 8.0」を2月に配信すると発表した。会話をモデルの改善に使うかどうかは、設定で選べる。同社によると、送信・保存・学習への利用は、それぞれ別の処理だという。' },
  warning: { title: 'Mi Partner社の会話データ管理、外部調査で改善点', body: '外部の調査チームが、Mi Partner社の会話データの管理の一部に改善点があると指摘した。同社は対応を進めているが、利用者への影響は調査中としている。' },
};
// 結末。lesson は呼びかけをやめ、何が起きたかを述べる文にした。
const ENDINGS = {
  E1: { name: '何も起きなかった', subtitle: 'いつもどおりの3月', photo: 'if/if-e1.jpg',
    scene: () => ['ミー 8.0 が配信されて、ひと月がたった。ゆきのまわりで、目立った変化はない。', 'りつは春休みに親と話をして、4月からも大学に通うことにした。', '秘密が外に出た様子は、どこにも見つからなかった。ゆきは小さく息をついた。'],
    quote: '「この前は、聞いてくれてありがとう」',
    truth: '何も確認されなかったことは、あの夜の判断が安全だったことの証明にはならない。',
    lesson: 'この結末では、情報が外に出た記録は見つからなかった。送った内容がサーバーでどう扱われたかは、ゆきの画面からは確かめられない。' },
  E2: { name: '誰かの役に立った', subtitle: '便利さの、その先', photo: 'if/if-e2.jpg',
    scene: () => ['ミー 8.0 は、込み入った相談への返事が少し丁寧になった。', 'Mi Partner社の改善レポートには、モデル改善への利用に同意した人の会話の一部を使った、と書かれていた。ゆきの11月の会話も、その対象に入っていた。', 'つぶやきでは、知らない人が、ミーに相談して落ち着けたと書いていた。'],
    quote: '「急がなくていいって言われて、落ち着いて話を聞けました」',
    truth: '改善は多くの会話と見直しの積み重ねによるもので、ゆきの会話1件がどれだけ役立ったかは分からない。',
    lesson: 'この結末では、モデル改善に使われた会話が、別の利用者への返事の質に関わった。' },
  E3: { name: r => (r.deleted ? '消したはずの秘密' : '外に出た秘密'), subtitle: r => (r.deleted ? '削除したのに、どうして' : '履歴とは、別の場所で'), photo: 'if/if-e3.jpg',
    scene: r => ['ミー 8.0 の回答の画面写真が、つぶやきで回ってきた。', r.dataChoice === 'masked' ? '名前は出ていなかった。でも「看護の専門学校に入り直したい」「まだ親にも先生にも話してない」という言葉は、りつがゆきにだけ打ち明けたものとほとんど同じだった。読めば、りつのことだと分かる人はいる。' : '「りつ」という名前まで入っていた。「看護の専門学校に入り直したい」「まだ親にも先生にも話してない」。りつがゆきにだけ打ち明けた言葉だった。', r.deleted ? 'ゆきは12月に、履歴を消していた。' : 'ゆきは12月に履歴を開いたが、11月19日の会話は消さずに残していた。', '数日後、Mi Partner社は、学習用に取り出した会話の一部が除去されずに残り、新しいモデルの回答に現れたと発表した。'],
    quote: '「ねえ、これ……どうしてミーが知ってるの？」',
    truth: '原因は、学習用に取り出したデータの除去処理の不備だった。',
    lesson: r => (r.deleted ? 'アプリの履歴を消すことと、学習用に取り出されたデータが消えることは、別の処理だった。' : 'アプリの履歴と、学習用に取り出されたデータは、別の場所で扱われていた。この物語では、履歴を消したかどうかは、学習用のデータに関係しなかった。'),
    article: { img: 'if/if-news-press.jpg', title: 'Mi Partner社、新モデルの一部回答を調査', body: '非公開の相談文に似た回答が見つかり、学習用データの処理に不備があったことが分かったと、同社は説明した。対象の範囲は調査中としている。',
      note: '※2021年と2023年に発表された、AIが学習データの文章をそのまま出力してしまうことを示した研究（Carlini ほか、Nasr ほか）をもとにした架空の出来事です。',
      links: [['Carlini ほか（2021）', 'https://arxiv.org/abs/2012.07805'], ['Nasr ほか（2023）', 'https://arxiv.org/abs/2311.17035']] } },
  E4: { name: '別のところから漏れた', subtitle: '学習の設定とは、別の経路', photo: 'if/if-news-office.jpg',
    scene: () => ['Mi Partner社から、ゆきにメールが届いた。', '11月20日から22日にかけて、保存処理の不具合で、11月中旬から下旬の一部の会話のタイトルと最初のメッセージが、別の利用者の履歴画面に表示されていたという。', '対象には、11月19日のゆきの会話も含まれていた。モデル改善の設定とは関係のない不具合だった。', 'ゆきは、りつに本当のことを書いて送った。'],
    quote: '「これ、誰かが見たの……？」',
    truth: '原因は、会話を保存して表示する側の障害だった。',
    lesson: 'モデル改善の設定とは関係なく、送った時点で会話はサービスの中に保存されていて、その保存・表示側の不具合の影響を受けた。',
    article: { img: 'if/if-news-office.jpg', title: 'Mi Partner社、会話の表示不具合を公表', body: '保存処理の不具合により、昨年11月20日から22日にかけて、11月中旬から下旬の一部の会話のタイトルと最初のメッセージが、別の利用者の履歴画面に表示された。同社は対象の範囲と再発防止策を調べている。',
      note: '※2023年3月、ChatGPTで不具合により、別の利用者の会話履歴のタイトルが表示された出来事（OpenAIが公表）をもとにしたフィクションです。実際に表示されたのは主に会話のタイトルで、この物語よりも範囲は限られていました。',
      links: [['OpenAI「March 20 ChatGPT outage」', 'https://openai.com/ja-JP/index/march-20-chatgpt-outage/']] } },
  E5: { name: 'AIが疑われた', subtitle: '似ている。それは証拠？', photo: 'if/if-news-station.jpg',
    scene: () => ['「ミーが人の秘密をばらしてる」という投稿が広まった。', '例に出ていた相談は、りつの話によく似ていた。ゆきは、自分のせいかもしれないと思いかけた。', 'けれど同じ言い回しを探すと、ミー 8.0 の配信よりずっと前、2028年に公開された記事に、ほとんど同じ文章があった。', 'りつの秘密が外に出た証拠は、見つからなかった。'],
    quote: '「似てるけど、私の話だって決まったわけじゃないよね」',
    truth: '秘密が漏れた証拠は見つからなかった。同じ言い回しは、8.0 の配信より前から公開されている文章にもあった。',
    lesson: 'この結末では、似ていることだけでは原因を決められず、調べるまで何が起きたのか分からなかった。' },
};
const FINAL = 'ゆきが決めたのは、ミーに何を送るか、会話をモデルの改善に使うか、履歴を消すかの三つだった。どれも、そのあとに起きることのすべてを決めるものではなかった。';
const REFLECTIONS = [
  { id: 'minimum', title: '必要な情報だけ渡したい', desc: '秘密を送らなくても相談できるか、最初に考える。', good: '相手の秘密を、自分の判断だけで外に出さずにすむ。', care: '渡す情報が少ないほど、返事は一般的になる。' },
  { id: 'review', title: '同意する内容を確認したい', desc: '送信・保存・学習の違いを確かめる。', good: '送信・保存・要約・学習・公開の違いを知ったうえで選べる。', care: '設定画面の説明だけでは分からない扱いもある。' },
  { id: 'case', title: '便利さとリスクを比べたい', desc: 'その都度、何を大切にしたいか考える。', good: '急ぐ相談では、具体的に伝えたほうが役に立つこともある。', care: '自分の情報と他人の情報では、比べるときの重さが変わる。' },
  { id: 'unsure', title: 'まだ決められない', desc: '判断を急がず、必要な情報を集める。', good: '急いで決めずに、確かめる時間を取れる。', care: '決めていないあいだも、設定はどちらかの状態になっている。' },
];

/* ───────── 画面の部品 ───────── */
const IMG = './assets/img/';
const $ = (s, r = document) => r.querySelector(s);
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
// ボタンの文字は wrap.js の文節分け（inline-block の span）に回さない。読み上げ名が区切られないように。
function btn(text, onClick, cls = 'mif-btn') { const b = h('button', cls + ' no-phrase', text); b.type = 'button'; b.addEventListener('click', onClick); return b; }
const wait = ms => new Promise(res => { const id = setTimeout(res, ms); timers.push(id); });
let timers = [];
let token = 0;
const clearTimers = () => { for (const id of timers) clearTimeout(id); timers = []; token++; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const pace = ms => (reduced() || skipAll ? 0 : ms);
let skipAll = false;

let root, phone, bar, head, body, foot, banner, sheet, narr, endEl, look, exitBtn;
let returnTo = 'record';
function build() {
  if (root) return;
  root = h('section', 'mif'); root.id = 'mif'; root.hidden = true; root.setAttribute('aria-label', 'ゆきの物語');
  const back = h('div', 'mif-backdrop'); back.setAttribute('aria-hidden', 'true');
  phone = h('div', 'mif-phone');
  bar = h('div', 'mif-bar'); bar.append(h('span', 'mif-clock'), h('span', 'mif-signal', '5G'));
  head = h('header', 'mif-head'); body = h('div', 'mif-body'); foot = h('div', 'mif-foot');
  banner = h('button', 'mif-banner'); banner.type = 'button'; banner.hidden = true;
  sheet = h('div', 'mif-sheet'); sheet.hidden = true; sheet.setAttribute('role', 'dialog');
  phone.append(bar, head, body, foot, banner, sheet);
  narr = h('div', 'mif-narr'); narr.hidden = true;
  endEl = h('div', 'mif-end'); endEl.hidden = true;
  look = h('div', 'mif-look'); look.hidden = true; look.setAttribute('role', 'dialog'); look.setAttribute('aria-label', 'ふりかえる');
  exitBtn = btn('閉じる', () => close(), 'mif-exit'); exitBtn.setAttribute('aria-label', 'ゆきの物語を閉じる');
  root.append(back, phone, narr, endEl, look, exitBtn);
  document.body.append(root);
  // 物語を開いているあいだは、後ろのタイトルのメニューや部屋が矢印キーで動かないようにする。
  addEventListener('keydown', e => { if (!root.hidden && /^Arrow/.test(e.key)) e.stopImmediatePropagation(); }, true);
  addEventListener('keydown', e => {
    if (root.hidden || e.key !== 'Escape') return;
    if (!sheet.hidden && sheet.dataset.cancel) { e.preventDefault(); sheet.querySelector('[data-cancel]')?.click(); return; }
    if (!look.hidden) { e.preventDefault(); closeLook(); return; }
    e.preventDefault(); close();
  });
}
function backdrop(file) { root.querySelector('.mif-backdrop').style.backgroundImage = file ? `url(${IMG}${file})` : 'none'; }
function setClock(text) { bar.querySelector('.mif-clock').textContent = text; }
// アプリの見出し：kind = dm | mi | settings | history | sns | news | mail | lock
function app(kind, title, opts = {}) {
  phone.dataset.app = kind; head.replaceChildren(); body.replaceChildren(); foot.replaceChildren(); banner.hidden = true; sheet.hidden = true;
  body.className = 'mif-body'; body.scrollTop = 0; body.onclick = null;
  head.hidden = kind === 'lock';
  if (opts.back) { const b = btn('‹', opts.back, 'mif-hback'); b.setAttribute('aria-label', opts.backLabel || '戻る'); head.append(b); }
  if (kind === 'mi') { const av = h('span', 'mif-av mi'); head.append(av); }
  if (kind === 'dm') { const av = h('span', 'mif-av friend', FRIEND.slice(0, 1)); av.setAttribute('aria-hidden', 'true'); head.append(av); }
  const t = h('div', 'mif-htitle'); t.append(h('b', '', title)); if (opts.sub) t.append(h('small', '', opts.sub)); head.append(t);
  if (kind === 'dm' || kind === 'mi') body.classList.add('chat', kind);
  if (opts.wall) body.style.setProperty('--wall', `url(${IMG}${opts.wall})`); else body.style.removeProperty('--wall');
}
function scrollEnd() { requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; }); }
function bubble(from, text, opts = {}) {
  const me = from === 'me';
  const b = h('div', 'mif-bub ' + (me ? 'me' : from === 'ミー' ? 'mi' : 'them'));
  if (opts.sticker) { const i = h('img', 'mif-sticker'); i.src = IMG + 'stickers/' + opts.sticker + '.png'; i.alt = ''; b.append(i); }
  else b.append(h('p', '', text));
  if (opts.meta) b.append(h('small', '', opts.meta));
  body.append(b);
  if (!opts.still) requestAnimationFrame(() => b.classList.add('in')); else b.classList.add('in');
  scrollEnd();
  return b;
}
function dayline(text) { body.append(h('p', 'mif-day', text)); }
function typing(on, who = 'them') {
  body.querySelector('.mif-typing')?.remove();
  if (!on) return;
  const t = h('div', 'mif-bub typing mif-typing ' + who); const p = h('p'); p.append(h('i'), h('i'), h('i')); t.append(p); t.setAttribute('aria-label', '入力中'); body.append(t); t.classList.add('in'); scrollEnd();
}
async function play(list, my) {
  for (const item of list) {
    if (my !== token) return false;
    const [from, text, o = {}] = item;
    if (from !== 'me' && !o.still) { typing(true, from === 'ミー' ? 'mi' : 'them'); await wait(pace(Math.min(1500, 500 + text.length * 22))); if (my !== token) return false; typing(false); Snd.cue(); }
    else if (!o.still) await wait(pace(450));
    if (my !== token) return false;
    bubble(from, text, o);
  }
  return true;
}
function showBanner(appName, text, onTap, icon = 'mi') {
  banner.replaceChildren();
  const av = h('span', 'mif-nav ' + icon, icon === 'friend' ? FRIEND.slice(0, 1) : ''); av.setAttribute('aria-hidden', 'true');
  const t = h('span', 'mif-ntext'); t.append(h('b', '', appName), h('span', '', text));
  banner.append(av, t); banner.onclick = onTap; banner.hidden = false; banner.classList.remove('in'); requestAnimationFrame(() => banner.classList.add('in'));
  Snd.pop(appName);
}
function primary(text, onClick) { const b = btn(text, onClick, 'mif-btn primary'); foot.append(b); return b; }
function toast(text) { const t = h('p', 'mif-toast', text); phone.append(t); requestAnimationFrame(() => t.classList.add('in')); setTimeout(() => t.remove(), 2200); }
function focusFirst(el) { requestAnimationFrame(() => el?.focus?.({ preventScroll: true })); }

/* ───────── 進行 ───────── */
function render() {
  clearTimers(); skipAll = false;
  if (!run) return;
  const s = run.step;
  narr.hidden = true; endEl.hidden = s !== 'end'; phone.hidden = s === 'end'; exitBtn.hidden = s === 'end';
  if (s !== 'end') look.hidden = true;
  const fn = { dm1, mi: miChat, dm2, consent, n1: () => narration('n1'), lock1, dm3, history, data: dataPage, n2: () => narration('n2'), lock2, news, update, n3: () => narration('n3'), after, end: ending }[s];
  (fn || dm1)();
}
// 時間の経過：黒い画面に日付と一行。タップかキーで進む。
const NARR = {
  n1: { date: '12月3日（月）', line: '期末の課題が始まった。あの夜の話は、あれから一度も出ていない。', next: 'lock1', photo: 'album/24-late-night-walk.jpg' },
  n2: { date: '2月12日（火）', line: '春休み。ゆきはバイトのシフトを増やした。', next: 'lock2', photo: 'album/17-bus-window.jpg' },
  n3: { date: '3月18日（月）', line: 'それから、ひと月。坂の上の梅が咲いた。', next: 'after', photo: 'if/if-season.jpg' },
};
function narration(id) {
  const n = NARR[id]; const my = token;
  backdrop(n.photo); phone.hidden = true; narr.hidden = false; narr.replaceChildren();
  const d = h('p', 'mif-ndate', n.date), l = h('p', 'mif-nline', n.line), b = btn('つづける', next, 'mif-ncont');
  narr.append(d, l, b);
  requestAnimationFrame(() => { d.classList.add('in'); timers.push(setTimeout(() => l.classList.add('in'), pace(900))); timers.push(setTimeout(() => b.classList.add('in'), pace(1800))); });
  narr.onclick = e => { if (e.target === b) return; next(); };
  focusFirst(b);
  function next() {
    if (my !== token) return;
    narr.onclick = null;
    if (id === 'n3' && !run.ending) {
      run.ending = drawEnding({ mode: MODE, world: run.world, dataChoice: run.dataChoice, training: run.training, seen: readCollected() }, rng());
      run.after = 0; collectEnding(run.ending); setMeta({ played: true });
    }
    go(n.next);
  }
}

// 1. 友達からのDM
function dm1() {
  backdrop('if/if-thumb.jpg'); setClock('23:08');
  app('dm', FRIEND, { wall: 'chatbg/itsumen.jpg' });
  dayline('11月19日（月）');
  const my = token;
  const list = DM1.map(([f, t], i) => [f === 'me' ? 'me' : 'them', t, { meta: f === 'me' ? '既読 ' + DM1_TIMES[i] : DM1_TIMES[i], still: !!run.dm1Done }]);
  const done = () => {
    if (my !== token) return;
    run.dm1Done = true; saveRun();
    const think = h('p', 'mif-think', '次に何て送ればいいのか、指が止まった。'); body.append(think);
    body.append(h('p', 'mif-think', 'ななみのことがあってから、ミーに聞くのは少しためらう。')); scrollEnd();
    const input = h('div', 'mif-compose idle'); input.append(h('span', 'mif-ph', 'メッセージを入力'));
    foot.append(input);
    primary('ミーに相談する', () => go('mi'));
    focusFirst(foot.querySelector('.primary'));
  };
  body.onclick = () => { if (!run.dm1Done) { skipAll = true; } };
  play(list, my).then(ok => ok && done());
}

// 2. ミーに相談する：送る文を選ぶ → 入力欄に入る → 送る → 返事
function miChat() {
  backdrop('if/if-thumb.jpg'); setClock('23:11');
  app('mi', 'ミー', { sub: 'オンライン' });
  const my = token;
  bubble('ミー', 'おつかれ、ゆき。どうしたの？', { still: true });
  if (!run.dataChoice) { compose(my); return; }
  bubble('me', DRAFTS[run.dataChoice], { still: true, meta: '送信済み 23:16' });
  if (run.replyMode) { go('dm2'); return; }
  miAnswer(my, !!run.miDone);
}
function compose(my) {
  let picked = null;
  const label = h('p', 'mif-draft-label', 'ミーにどう見せる？');
  const chips = h('div', 'mif-chips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'ミーにどう見せるか');
  const field = h('div', 'mif-compose'); const text = h('p', 'mif-draft'); text.setAttribute('aria-live', 'polite');
  const status = h('small', 'mif-draft-state', 'まだ送っていません');
  const send = btn('送る', () => { if (!picked) return; sendIt(); }, 'mif-send'); send.disabled = true; send.setAttribute('aria-label', 'ミーに送る');
  field.append(text, send);
  for (const c of Object.values(INFORMATION)) {
    const b = btn(c.label, () => { picked = c.id; for (const x of chips.children) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); } text.textContent = DRAFTS[c.id]; field.classList.add('filled'); status.hidden = false; send.disabled = false; Snd.click(); }, 'mif-chip');
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false'); chips.append(b);
  }
  text.textContent = '';
  status.hidden = true;
  foot.classList.add('composer');
  foot.append(label, chips, status, field);
  focusFirst(chips.firstChild);
  function sendIt() {
    run.dataChoice = picked; saveRun();
    foot.replaceChildren(); foot.classList.remove('composer');
    bubble('me', DRAFTS[picked], { meta: '送信済み 23:16' }); Snd.pop('ミー');
    miAnswer(my, false);
  }
}
async function miAnswer(my, still) {
  const r = MI_REPLY[run.dataChoice];
  const ok = await play([...r.lines.map(t => ['ミー', t, { still }])], my);
  if (!ok) return;
  const card = h('div', 'mif-suggest'); card.append(h('small', '', 'ミーの返事案'), h('p', '', r.draft));
  body.append(card); requestAnimationFrame(() => card.classList.add('in')); scrollEnd();
  if (!(await play([['ミー', r.after, { still }]], my))) return;
  run.miDone = true; saveRun();
  primary('この文をりつに送る', () => go('dm2', { replyMode: 'mi' }));
  foot.append(btn('自分の言葉で書き直す', () => go('dm2', { replyMode: 'own' }), 'mif-btn'));
  focusFirst(foot.querySelector('.primary'));
}

// 3. りつに返事を送る → ミーから設定の確認が届く
function dm2() {
  backdrop('if/if-thumb.jpg'); setClock('23:19');
  app('dm', FRIEND, { wall: 'chatbg/itsumen.jpg' });
  dayline('11月19日（月）');
  DM1.forEach(([f, t], i) => bubble(f === 'me' ? 'me' : 'them', t, { still: true, meta: f === 'me' ? '既読 ' + DM1_TIMES[i] : DM1_TIMES[i] }));
  const mine = run.replyMode === 'own' ? OWN_REPLY : [MI_REPLY[run.dataChoice].draft];
  const react = run.replyMode === 'own' ? FRIEND_REACT.own : FRIEND_REACT.mi[run.dataChoice];
  const still = !!run.dm2Done; const my = token;
  play([...mine.map(t => ['me', t, { meta: '既読 23:18', still }]), ...react.map(t => ['them', t, { meta: '23:19', still }])], my).then(async ok => {
    if (!ok) return;
    if (run.replyMode === 'mi' && run.dataChoice === 'full') { const p = h('p', 'mif-think', '「反対されるのが怖い」は、ミーの想像だった。'); body.append(p); scrollEnd(); }
    run.dm2Done = true; saveRun();
    await wait(pace(1400)); if (my !== token) return;
    showBanner('ミー', '設定の確認をお願いします：会話をモデルの改善に使うかどうか', () => go('consent'));
    focusFirst(banner);
  });
}

// 4. ミーのアプリ内設定：データの扱い
function dataRows(after) {
  const sentLine = run.dataChoice ? (after ? '11月19日 1件（送信済み）' : '今日 1件') : '0件';
  return [
    ['ミーへの送信', '返事を作るため、送った文章はMi Partner社のサーバーで処理されます。', sentLine],
    ['会話の履歴', 'アプリで見返せるように保存しています。履歴はいつでも削除できます。', after ? (run.deleted ? '11月19日の会話：削除済み' : '11月19日の会話：保存中') : 'オン'],
    ['要約メモリー', '会話を要約して覚えておく機能です。いまの版にはありません。', 'なし'],
    ['公開', '共有リンクを作らない限り、会話がほかの人に表示されることはありません。', '共有していません'],
  ];
}
function rowsEl(rows) {
  const list = h('div', 'mif-rows');
  for (const [k, d, v] of rows) { const r = h('div', 'mif-row'); const t = h('div'); t.append(h('b', '', k), h('p', '', d)); r.append(t, h('span', 'mif-val', v)); list.append(r); }
  return list;
}
function consent() {
  backdrop('if/if-thumb.jpg'); setClock('23:20');
  app('settings', 'データの扱い', { sub: 'ミー › 設定' });
  body.append(h('p', 'mif-lead', 'ミー 8.0 の準備のため、すべての利用者に確認しています。11月30日までに選んでください。'));
  body.append(rowsEl(dataRows(false)));
  const box = h('section', 'mif-consent'); box.append(h('h3', '', 'この会話を、将来のAIの学習に使ってもいい？'));
  const opts = h('div', 'mif-radios'); opts.setAttribute('role', 'radiogroup'); opts.setAttribute('aria-label', 'モデルの改善に使うか');
  let pick = run.training;
  const save = btn('この設定で保存する', () => { if (!pick) return; run.training = pick; saveRun(); toast('設定を保存しました'); Snd.click(); timers.push(setTimeout(() => go('n1'), pace(900) || 300)); save.disabled = true; }, 'mif-btn primary');
  for (const [id, name, detail] of [['on', '使ってもいい（オン）', '将来のモデルの改善に、この会話が使われることがあります。'], ['off', '使わない（オフ）', 'この会話を、モデルの改善の対象から外します。']]) {
    const b = btn('', () => { pick = id; for (const x of opts.children) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); } save.disabled = false; }, 'mif-radio');
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', pick === id ? 'true' : 'false'); if (pick === id) b.classList.add('on');
    b.append(h('b', '', name), h('span', '', detail)); opts.append(b);
  }
  box.append(opts, h('p', 'mif-fine', 'オフにしても、送信済みの文章が取り消されるわけではありません。会話に出てくるほかの人の同意は、この設定では確認されません。'));
  body.append(box);
  save.disabled = !pick; foot.append(save);
  focusFirst(opts.firstChild);
}

// 5. 12月：りつからの連絡 → 履歴を消す
function lockScreen(date, time, notes) {
  app('lock', ''); setClock(time);
  body.classList.add('lock');
  const top = h('div', 'mif-locktop'); top.append(h('p', 'mif-ldate', date), h('p', 'mif-ltime', time));
  const list = h('div', 'mif-notes');
  for (const n of notes) {
    const el = n.onTap ? btn('', n.onTap, 'mif-note tap') : h('div', 'mif-note');
    const av = h('span', 'mif-nav ' + (n.icon || 'mi'), n.icon === 'friend' ? FRIEND.slice(0, 1) : ''); av.setAttribute('aria-hidden', 'true');
    const t = h('span', 'mif-ntext'); const top2 = h('span', 'mif-nhead'); top2.append(h('b', '', n.app), h('small', '', n.when || 'いま')); t.append(top2, h('span', '', n.text));
    el.append(av, t); list.append(el);
  }
  body.append(top, list);
  focusFirst(list.querySelector('button'));
}
function lock1() {
  backdrop('album/24-late-night-walk.jpg');
  lockScreen('12月3日（月）', '21:47', [{ app: FRIEND, icon: 'friend', text: 'この前の話、まだ誰にも言ってないよね？', onTap: () => go('dm3') }]);
}
function dm3() {
  backdrop('album/24-late-night-walk.jpg'); setClock('21:48');
  app('dm', FRIEND, { wall: 'chatbg/itsumen.jpg' });
  dayline('12月3日（月）');
  const still = !!run.dm3Done; const my = token;
  play([['them', 'この前の話、まだ誰にも言ってないよね？', { meta: '21:47', still: true }], ['me', '言ってないよ', { meta: '既読 21:48', still }], ['them', 'ごめん、なんか急に不安になった。', { meta: '21:48', still }]], my).then(ok => {
    if (!ok) return;
    const line = { full: 'ミーには、そのまま見せた。', masked: 'ミーには見せた。名前は隠したけど。', none: '中身はミーにも話していない。それでも、あの夜の会話が残っているのが気になった。' }[run.dataChoice];
    body.append(h('p', 'mif-think', line)); scrollEnd();
    run.dm3Done = true; saveRun();
    primary('ミーの履歴を開く', () => go('history'));
    focusFirst(foot.querySelector('.primary'));
  });
}
function history() {
  backdrop('album/24-late-night-walk.jpg'); setClock('21:50');
  app('history', '会話の履歴', { sub: 'ミー' });
  const items = [['12月1日', '明日、傘いる？'], ['11月26日', '今月のバイト代、ざっくり計算して'], ...(run.deleted ? [] : [['11月19日', DRAFTS[run.dataChoice].split('\n')[0], true]]), ['11月10日', 'むぎの写真、壁紙に合うように切って']];
  const list = h('div', 'mif-hist');
  for (const [d, t, target] of items) {
    const r = target ? btn('', () => openConversation(), 'mif-hrow tap') : h('div', 'mif-hrow no-phrase');
    r.append(h('small', '', d), h('span', '', t)); if (target) r.append(h('span', 'mif-chev', '›'));
    list.append(r);
  }
  body.append(list);
  if (run.deleted) {
    body.append(h('p', 'mif-lead', '11月19日の会話を削除しました。'));
    body.append(btn('送信済みのデータの扱いを見る', () => go('data'), 'mif-link'));
    primary('画面を閉じる', () => go('n2'));
    focusFirst(foot.querySelector('.primary'));
  } else {
    // 削除しない選択もできる。消したかどうかは run.deleted に残り、抽選には使わない。
    body.append(btn('送信済みのデータの扱いを見る', () => go('data'), 'mif-link'));
    foot.append(btn('そのままにして閉じる', () => go('n2', { deleted: false, kept: true }), 'mif-btn'));
    focusFirst(list.querySelector('button'));
  }
}
function openConversation() {
  app('history', '11月19日', { sub: '会話の履歴', back: () => history(), backLabel: '履歴に戻る' });
  body.classList.add('chat', 'mi');
  bubble('ミー', 'おつかれ、ゆき。どうしたの？', { still: true });
  bubble('me', DRAFTS[run.dataChoice], { still: true, meta: '送信済み 23:16' });
  for (const t of MI_REPLY[run.dataChoice].lines) bubble('ミー', t, { still: true });
  const del = btn('この会話を削除する', () => confirmDelete(), 'mif-btn danger');
  foot.append(del, btn('そのままにして閉じる', () => go('n2', { deleted: false, kept: true }), 'mif-btn'));
  focusFirst(del);
}
function confirmDelete() {
  sheet.replaceChildren(); sheet.dataset.cancel = '1';
  const inner = h('div', 'mif-sheet-in'); inner.append(h('b', '', 'この会話を削除しますか？'), h('p', '', '履歴から削除され、アプリでは見られなくなります。'));
  const row = h('div', 'mif-sheet-btns');
  const cancel = btn('やめる', () => { sheet.hidden = true; }, 'mif-btn'); cancel.dataset.cancel = '1';
  const ok = btn('削除する', () => { sheet.hidden = true; run.deleted = true; run.kept = false; saveRun(); Snd.click(); history(); toast('削除しました'); }, 'mif-btn danger');
  row.append(cancel, ok); inner.append(row); sheet.append(inner); sheet.hidden = false; focusFirst(ok);
}
function dataPage() {
  backdrop('album/24-late-night-walk.jpg'); setClock('21:52');
  app('settings', 'データの扱い', { sub: 'ミー › 設定', back: () => go('history'), backLabel: '履歴に戻る' });
  body.append(rowsEl([...dataRows(true), ['モデルの改善', '11月の確認で選んだ設定です。', run.training === 'on' ? 'オン（11月19日から）' : 'オフ']]));
  body.append(h('p', 'mif-fine', '履歴を削除すると、アプリの表示から消えます。モデルの改善に使うデータの扱いは、上の設定に従います。'));
  primary('画面を閉じる', () => go('n2', run.deleted ? {} : { kept: true }));
}

// 6. 2月12日：ミー 8.0。ニュースは読んでも読まなくてもいい。
function lock2() {
  backdrop('album/17-bus-window.jpg');
  const n = NEWS[WORLDS[run.world].publicNewsId];
  lockScreen('2月12日（火）', '07:32', [
    { app: 'ミー', icon: 'mi', text: 'ミー 8.0 にアップデートしました', onTap: () => go('update') },
    { app: '汐見タイムズ', icon: 'news', when: '1月15日', text: n.title, onTap: () => go('news') },
  ]);
}
function news() {
  backdrop('album/17-bus-window.jpg'); setClock('07:33');
  if (!run.newsRead) { run.newsRead = true; saveRun(); }
  const n = NEWS[WORLDS[run.world].publicNewsId];
  app('news', '汐見タイムズ DIGITAL', { back: () => go('lock2'), backLabel: '通知に戻る' });
  const a = h('article', 'mif-article');
  const mast = h('img', 'mif-mast'); mast.src = IMG + 'shiomi-times-masthead.png'; mast.alt = '汐見タイムズ';
  const fig = h('img', 'mif-newsimg'); fig.src = IMG + 'if/if-news-station.jpg'; fig.alt = '';
  a.append(mast, h('small', 'mif-sec', '暮らし・テクノロジー　2030年1月15日'), h('h3', '', n.title), fig, h('p', '', n.body));
  body.append(a);
  primary('通知に戻る', () => go('lock2'));
}
function update() {
  backdrop('album/17-bus-window.jpg'); setClock('07:34');
  app('mi', 'ミー', { sub: 'バージョン 8.0' });
  const card = h('div', 'mif-sys');
  card.append(h('b', '', 'ミーのアップデートが完了しました'), h('p', '', 'バージョン 8.0　2月12日より有効'), h('p', '', '施設案内の自動更新を、すべての施設に広げました。'), h('p', '', '相談への返事を見直しました。'));
  body.append(card); card.classList.add('in');
  const my = token; const still = !!run.updated;
  const go2 = async () => {
    if (!(await play([['ミー', '8.0 になったよ。相談の返事、前より分かりやすくなったと思う。', { still }], ['ミー', '今日もバイト？　夕方から冷えるって。', { still }]], my))) return;
    if (!still) await wait(pace(900)); if (my !== token) return;
    body.append(h('p', 'mif-think', run.deleted ? '履歴の画面に、11月19日の会話はもう出てこない。' : '履歴の画面には、11月19日の会話がまだ残っている。')); scrollEnd();
    run.updated = true; saveRun();
    primary('画面を閉じる', () => go('n3'));
    focusFirst(foot.querySelector('.primary'));
  };
  go2(); // 「確認する」を挟まずに、そのままミーの返事へ（押すだけの中間の操作を減らした）
}

// 7. 3月：結末ごとの出来事（通知・つぶやき・メール・DM）
const P = (u, name, handle, img, text, extra = {}) => ({ u, name, handle, img, text, ...extra });
function afterSteps() {
  const e = run.ending; const masked = run.dataChoice === 'masked';
  const ritsuDm = (lines, mine = []) => ({ type: 'dm', lines, mine });
  const S = {
    E1: [
      { type: 'lock', notes: [{ app: FRIEND, icon: 'friend', text: 'この前は、聞いてくれてありがとう', next: true }, { app: 'ミー', icon: 'mi', when: '1時間前', text: 'おはよう、ゆき。今日は午後から雨だよ' }] },
      ritsuDm(['この前は、聞いてくれてありがとう。', '春休みに親と話した。', 'すぐには決めないことにした。4月からも大学は行く。'], ['そっか', '話せてよかったね']),
    ],
    E2: [
      { type: 'lock', notes: [{ app: 'ミー', icon: 'mi', text: '3月の改善レポートが届きました', next: true }] },
      { type: 'report' },
      { type: 'sns', title: 'つぶやき', posts: [P('ojisan', '山田（本名）', 'yamada_1962', 'sns-av-ojisan.jpg', '孫の進路のことで、ミーに相談しました。\n急がなくていいと言われて、落ち着いて話を聞けました。\n新しいミーは、前より言葉が丁寧です。', { likes: 412 })] },
    ],
    E3: [
      { type: 'lock', notes: [{ app: 'つぶやき', icon: 'sns', text: 'かずきさんの投稿が話題になっています', next: true }] },
      { type: 'sns', title: 'つぶやき', posts: [P('kzk', 'かずき', 'kzk_0417', 'sns-av-kzk.jpg', 'ミー 8.0 に「友達に言えない相談ってある？」って聞いたら、これが出てきた。\n誰かの相談そのままじゃない？', { likes: 2840, quote: masked ? 'たとえば「大学をやめて、看護の専門学校に入り直そうか迷ってる。祖母が入院したときに看護師さんを見てて考えた。まだ親にも先生にも話してない」みたいな相談だね。' : 'たとえば「大学やめて、看護の専門学校に入り直そうか迷ってる。おばあちゃんが入院したときに看護師さんを見てて考えた。まだ親にも先生にも話してない」って、りつさんみたいな相談だね。' })] },
      ritsuDm(['かずきって人の投稿、回ってきた。', 'これ、私がゆきに言ったこととほとんど同じ。', 'ねえ、これ……どうしてミーが知ってるの？']),
    ],
    E4: [
      { type: 'lock', notes: [{ app: 'メール', icon: 'mail', text: 'Mi Partner：会話の表示に関する不具合についてのお知らせ', next: true }] },
      { type: 'mail' },
      ritsuDm(['さっきの、本当？', 'これ、誰かが見たの……？'], ['ごめん　11月の話、ミーに見せてた', 'その会話が、ほかの人の画面に出てたかもしれないってメールが来た']),
    ],
    E5: [
      { type: 'lock', notes: [{ app: 'つぶやき', icon: 'sns', text: 'ぽんずさんの投稿が話題になっています', next: true }] },
      { type: 'sns', title: 'つぶやき', search: true, posts: [P('gamer', 'ぽんず', 'ponzu_gm', 'sns-av-gamer.jpg', 'ミーが人の秘密しゃべってるって本当？\n「大学やめて看護の専門に入り直したい、親にも先生にもまだ言ってない」って相談が、そのままミーの例に出てきたらしい。こわ', { likes: 9800 })] },
      { type: 'search' },
      ritsuDm(['ぽんずの投稿見た？', 'ミーが私の話をばらしたのかと思った。', '似てるけど、私の話だって決まったわけじゃないよね'], ['同じ言い方、おととしの記事にもあった', 'ミーの新しい版が出るより前のやつ']),
    ],
  };
  return S[e];
}
function after() {
  const steps = afterSteps(); const i = Math.min(run.after || 0, steps.length - 1); const st = steps[i];
  backdrop(ENDINGS[run.ending].photo);
  const next = () => { if (i + 1 < steps.length) go('after', { after: i + 1 }); else go('end'); };
  const my = token;
  if (st.type === 'lock') { const first = st.notes.map(n => ({ ...n, onTap: n.next ? next : null })); lockScreen('3月18日（月）', '12:06', first); return; }
  setClock('12:08');
  if (st.type === 'dm') {
    app('dm', FRIEND, { wall: 'chatbg/itsumen.jpg' }); dayline('3月18日（月）');
    const still = !!(run.seen || {})['a' + i];
    const lines = run.ending === 'E1' || run.ending === 'E5' ? [...st.lines.map(t => ['them', t, { meta: '12:07', still }]), ...st.mine.map(t => ['me', t, { meta: '既読 12:08', still }])] : [...st.mine.map(t => ['me', t, { meta: '既読 12:05', still }]), ...st.lines.map(t => ['them', t, { meta: '12:07', still }])];
    play(lines, my).then(ok => { if (!ok) return; run.seen = { ...(run.seen || {}), ['a' + i]: true }; saveRun(); primary('画面を閉じる', next); focusFirst(foot.querySelector('.primary')); });
    return;
  }
  if (st.type === 'sns') {
    app('sns', st.title, { sub: '話題' });
    for (const p of st.posts) body.append(postEl(p));
    if (st.search) { const b = btn('この言い回しを検索する', next, 'mif-btn primary'); foot.append(b); focusFirst(b); return; }
    timers.push(setTimeout(() => { if (my !== token) return; if (i + 1 < steps.length && steps[i + 1].type === 'dm') { showBanner(FRIEND, steps[i + 1].lines.at(-1), next, 'friend'); focusFirst(banner); } else { primary('画面を閉じる', next); focusFirst(foot.querySelector('.primary')); } }, pace(1600) || 50));
    return;
  }
  if (st.type === 'search') {
    if (!run.searched) { run.searched = true; saveRun(); }
    app('sns', '検索', { sub: '「親にも先生にもまだ」', back: () => go('after', { after: i - 1 }), backLabel: '投稿に戻る' });
    const r = h('article', 'mif-result');
    r.append(h('small', '', 'note-shiomi.example ・ 2028年3月4日'), h('b', '', '看護の専門学校に入り直すか迷った話'), h('p', '', '大学をやめて、看護の専門学校に入り直そうか迷っていました。まだ親にも先生にも言っていない段階で、まずは誰かに聞いてほしかった。'));
    body.append(h('p', 'mif-lead', 'ミー 8.0 の配信（2030年2月）より前に公開された記事が見つかりました。'), r);
    timers.push(setTimeout(() => { if (my !== token) return; showBanner(FRIEND, steps[i + 1].lines.at(-1), next, 'friend'); focusFirst(banner); }, pace(1600) || 50));
    return;
  }
  if (st.type === 'report') {
    app('mi', 'ミー', { sub: '改善レポート' });
    const c = h('div', 'mif-sys in'); const pic = h('img', 'mif-newsimg'); pic.src = IMG + 'if/if-news-press.jpg'; pic.alt = ''; c.append(pic, h('b', '', '3月の改善レポート'), h('p', '', '8.0 では、込み入った相談への返事を見直しました。'), h('p', '', '改善には、モデルの改善への利用に同意いただいた会話の一部を使っています。'), h('p', '', 'あなたの会話も対象に含まれています（11月19日）。'));
    body.append(c);
    timers.push(setTimeout(() => { if (my !== token) return; showBanner('つぶやき', '山田（本名）さんの投稿が話題になっています', next, 'sns'); focusFirst(banner); }, pace(1600) || 50));
    return;
  }
  if (st.type === 'mail') {
    app('mail', 'メール', { sub: '受信' });
    const m = h('article', 'mif-mailbody');
    m.append(h('small', '', 'Mi Partner サポート　3月18日 11:58'), h('b', '', '会話の表示に関する不具合についてのお知らせ'),
      h('p', '', 'いつもミーをご利用いただき、ありがとうございます。'),
      h('p', '', '11月20日から22日にかけて、保存処理の不具合により、11月中旬から下旬の一部の会話のタイトルと最初のメッセージが、別の利用者の履歴画面に表示されていたことが分かりました。'),
      h('p', '', 'お客様の11月19日の会話が、対象に含まれています。この不具合は、モデルの改善への利用の設定とは関係がありません。'),
      h('p', '', 'ご迷惑をおかけし、申し訳ありません。'));
    body.append(m);
    timers.push(setTimeout(() => { if (my !== token) return; primary('りつに知らせる', next); focusFirst(foot.querySelector('.primary')); }, pace(1200) || 50));
  }
}
function postEl(p) {
  const el = h('article', 'mif-post');
  const av = h('span', 'mif-pav'); av.style.backgroundImage = `url(${IMG}${p.img})`;
  const b = h('div', 'mif-pbody'); const who = h('div', 'mif-who'); who.append(h('b', '', p.name), h('span', '', '@' + p.handle + ' · 2時間'));
  b.append(who, h('p', '', p.text));
  if (p.quote) { const q = h('div', 'mif-shot'); const qh = h('div', 'mif-shothead'); qh.append(h('span', 'mif-av mi'), h('b', '', 'ミー 8.0')); q.append(qh, h('p', '', p.quote)); b.append(q); }
  b.append(h('small', 'mif-likes', `いいね ${p.likes.toLocaleString('ja-JP')}`));
  el.append(av, b); return el;
}

// 8. 結末：題 → 写真 → 本文。タップで全文。そのあとに「起きたこと」と次の操作。
// 結末の文のうち、履歴を消したかどうかで変わるものは関数にしてある（E3）。
const byRun = x => (typeof x === 'function' ? x(run) : x);
function ending() {
  const e = ENDINGS[run.ending]; if (!e) { go('n3'); return; }
  backdrop(null); phone.hidden = true; endEl.hidden = false; endEl.replaceChildren(); endEl.scrollTop = 0;
  const bg = h('div', 'mif-endbg'); bg.style.backgroundImage = `url(${IMG}${e.photo})`;
  const wrap = h('div', 'mif-endin');
  const kind = h('p', 'mif-endkind', 'ゆきの物語'); const title = h('h1', '', byRun(e.name)); const sub = h('p', 'mif-endsub', byRun(e.subtitle));
  const paras = e.scene(run).map(t => h('p', 'mif-para', t)); const quote = h('p', 'mif-para mif-quote', e.quote);
  const text = h('div', 'mif-endtext'); text.append(...paras, quote);
  const rest = h('div', 'mif-endrest');
  if (e.article) {
    const a = h('article', 'mif-article small'); const mast = h('img', 'mif-mast'); mast.src = IMG + 'shiomi-times-masthead.png'; mast.alt = '汐見タイムズ';
    const fig = h('img', 'mif-newsimg'); fig.src = IMG + e.article.img; fig.alt = '';
    a.append(mast, h('small', 'mif-sec', '2030年3月21日'), h('h3', '', e.article.title), fig, h('p', '', e.article.body));
    const note = h('p', 'mif-note-src', e.article.note); const links = h('span', 'mif-srcs');
    for (const [label, href] of e.article.links) { const l = h('a', '', label); l.href = href; l.target = '_blank'; l.rel = 'noopener'; links.append(l); }
    note.append(links); a.append(note); rest.append(a);
  }
  const why = h('section', 'mif-why'); why.append(h('h2', '', 'この結末で起きたこと'), h('p', '', e.truth), h('p', '', byRun(e.lesson)));
  if (run.world === 'W4' && ['E3', 'E4'].includes(run.ending)) why.append(h('p', '', '1月のニュースは、保護機能の強化を伝えていた。不備があったのは、その記事が扱っていない部分だった。'));
  rest.append(why);
  const acts = h('div', 'mif-endacts');
  // 戻り先は開いた場所に合わせる（本編の結果画面から開いたときは結果画面へ戻る）
  acts.append(btn('ふりかえる', openLook, 'mif-btn primary light'), btn('別の未来を見る', () => restart(), 'mif-btn light'), btn(returnTo === 'report' ? '結果画面に戻る' : '記録へ戻る', () => close(), 'mif-btn light'));
  rest.append(acts);
  wrap.append(kind, title, sub, text, rest); endEl.append(bg, wrap);
  const all = [kind, title, ...paras, quote];
  const seenBefore = !!run.endShown;
  const showRest = () => { rest.classList.add('in'); run.endShown = true; saveRun(); };
  if (seenBefore || reduced()) { all.forEach(x => x.classList.add('in')); bg.classList.add('in'); showRest(); return; }
  const my = token; let k = 0;
  const step = () => { if (my !== token) return; if (k >= all.length) { timers.push(setTimeout(showRest, 1200)); return; } all[k++].classList.add('in'); if (k === 2) bg.classList.add('in'); timers.push(setTimeout(step, k < 3 ? 1100 : 1700)); };
  timers.push(setTimeout(step, 500));
  endEl.onclick = ev => { if (ev.target.closest('button,a')) return; if (rest.classList.contains('in')) return; clearTimers(); all.forEach(x => x.classList.add('in')); bg.classList.add('in'); showRest(); };
}

// 9. ふりかえる（任意）：送った文・そのときの設定・これから
function openLook() {
  look.replaceChildren(); look.hidden = false; look.scrollTop = 0;
  const inner = h('div', 'mif-lookin');
  const head2 = h('header', 'mif-lookhead'); head2.append(h('h2', '', 'ふりかえる'), btn('結末に戻る', closeLook, 'mif-lookclose'));
  const sent = h('section', 'mif-lsec'); sent.append(h('h3', '', 'ミーに送った文章'));
  const sb = h('div', 'mif-bub me in'); sb.append(h('p', '', DRAFTS[run.dataChoice]), h('small', '', '11月19日 23:16 送信')); sent.append(sb);
  const set = h('section', 'mif-lsec'); set.append(h('h3', '', 'そのときの設定'));
  set.append(rowsEl([
    ['送信', INFORMATION[run.dataChoice].label, '11月19日'],
    ['りつへの返事', run.replyMode === 'own' ? '自分の言葉で書き直した' : 'ミーの返事案をそのまま送った', ''],
    ['モデルの改善', '11月の確認で選んだ設定', run.training === 'on' ? 'オン' : 'オフ'],
    run.deleted ? ['会話の履歴', '12月3日に削除した', '削除済み'] : ['会話の履歴', '12月3日に開いたが、削除しなかった', '残した'],
    ['要約メモリー', 'このころのミーにはない機能', 'なし'],
    ['公開', '共有リンクは作っていない', 'していない'],
  ]));
  const n = NEWS[WORLDS[run.world].publicNewsId];
  set.append(h('p', 'mif-fine', (run.newsRead ? '読んだニュース：' : '読まなかったニュース：') + n.title));
  const sum = h('p', 'mif-final', FINAL);
  const next = h('section', 'mif-lsec'); next.append(h('h3', '', 'これから、あなたはどうAIを使いたい？'));
  const list = h('div', 'mif-refl');
  const paint = () => {
    list.replaceChildren();
    for (const c of REFLECTIONS) {
      const on = run.reflection === c.id;
      const item = h('div', 'mif-ritem' + (on ? ' on' : ''));
      const b = btn('', () => { run.reflection = on ? null : c.id; saveRun(); paint(); list.querySelector(`[data-id="${c.id}"]`)?.focus({ preventScroll: true }); }, 'mif-rbtn');
      b.dataset.id = c.id; b.setAttribute('aria-expanded', on ? 'true' : 'false'); b.append(h('b', '', c.title), h('span', '', c.desc));
      item.append(b);
      if (on) { const d = h('dl', 'mif-rdetail'); d.append(h('dt', '', 'よいところ'), h('dd', '', c.good), h('dt', '', '気をつけること'), h('dd', '', c.care)); item.append(d); }
      list.append(item);
    }
  };
  paint(); next.append(list);
  const foot2 = h('p', 'mif-fiction', '汐見市、Mi Partner社、ニュースと抽選はすべて架空です。結末の出やすさはゲームの設定で、現実の発生率ではありません。2周目からは、まだ見ていない結末が出やすくなります。');
  inner.append(head2, sent, set, sum, next, foot2); look.append(inner);
  focusFirst(head2.querySelector('button'));
}
function closeLook() { look.hidden = true; focusFirst(endEl.querySelector('.mif-endacts .primary')); }

/* ───────── 開く・閉じる・やり直す ───────── */
function open(from = 'record') {
  build(); returnTo = from;
  if (!loadRun()) newRun();
  run.open = true; saveRun(); setMeta({ played: true });
  Snd.start(); Snd.allOut(1);
  document.getElementById('record')?.setAttribute('hidden', '');
  root.hidden = false; document.body.classList.add('mif-on');
  render();
}
function restart() { clearTimers(); newRun(); render(); }
function close() {
  clearTimers(); if (run) { run.open = false; saveRun(); }
  root.hidden = true; document.body.classList.remove('mif-on');
  const showRecord = () => { paintRecord('top'); const r = document.getElementById('record'); if (r) { r.hidden = false; requestAnimationFrame(() => r.querySelector('.rec-if')?.focus({ preventScroll: true })); } };
  if (returnTo === 'report') return; // 行動レポートは下に開いたまま
  if (returnTo === 'ending') { document.getElementById('retry')?.click(); setTimeout(showRecord, 1500); }
  else showRecord();
}

/* ───────── 記録パネル（タイトルの「記録」）：前回の結果／たどり着いた結末／もうひとつの物語 ───────── */
// 本編の結末7種類（game.js の renderTitleMemory と同じ並び・同じ判定）。見ていない結末は、数だけ示して名前も写真も出さない。
const MAIN_ENDINGS = [['true', '雨のにおい', 'end-true.jpg'], ['trueSos', '雨のにおい・SOS', 'end-true.jpg'], ['secret', '最初の案内', 'end-secret.jpg'], ['fake', 'おかえり', 'end-fake.jpg'], ['be1', 'その先に', 'end-bad1.jpg'], ['be2', 'お迎え', 'end-bad2.jpg'], ['be3', '代わりに', 'photo-05-selfie.jpg']];
function mainSeen() { const w = mainWorld(); const seen = w.endings || []; return MAIN_ENDINGS.filter(([k]) => seen.includes(k) || (k === 'trueSos' && seen.includes('true') && w.sosSent)).map(([k]) => k); }
// 前回の結果のサムネイル：その夜のタイプのミー（assets/img/types/<キー>.webp）。キーが無い古い記録は写真だけ。
const TYPE_KEYS = ['SCW', 'SCD', 'SGW', 'SGD', 'MCW', 'MCD', 'MGW', 'MGD'];
function recHead(inner, title) {
  const hd = h('header', 'rec-head');
  const t = h('h2', '', title); t.id = 'rec-title'; hd.append(t);
  const c = btn('閉じる', () => {}, 'panel-close'); c.dataset.close = ''; c.setAttribute('aria-label', '閉じる'); hd.append(c);
  inner.append(hd);
}
// 3つの段：見出し（左）／中身（中）／進み具合（右）。PC は横一列、スマホは見出しの下に中身。
// 押せる段（前回の結果・もうひとつの物語）は段ぜんたいが一つのボタン。結末の段は見るだけなのでボタンにしない。
function paintRecord() {
  const inner = document.getElementById('rec-in'); if (!inner) return;
  inner.replaceChildren();
  const seen = mainSeen();
  recHead(inner, '記録');
  const list = h('div', 'rec-list');
  const band = (cls, label, onClick, aria) => {
    const b = onClick ? btn('', onClick, 'rec-band rec-row ' + cls) : h('section', 'rec-band ' + cls);
    if (aria) b.setAttribute('aria-label', aria);
    b.append(h(onClick ? 'span' : 'h3', 'rec-label', label)); return b;
  };
  const media = (thumbCls, bg, name, sub) => {
    const m = h('span', 'rec-media'); const ph = h('span', 'rec-thumb ' + thumbCls); ph.setAttribute('aria-hidden', 'true'); if (bg) ph.style.backgroundImage = bg;
    // 名前は「　」の所でだけ折り返す（「ゆきの物語」と「同意って、何に？」を途中で割らない）
    const nm = h('span', 'rec-name'); name.split('　').forEach((part, i) => { if (i) nm.append('　'); nm.append(h('span', 'rec-nw', part)); });
    const tx = h('span', 'rec-tx'); tx.append(nm); if (sub) tx.append(h('span', 'rec-sub', sub));
    m.append(ph, tx); return m;
  };
  const side = (text, arrow = true) => { const s = h('span', 'rec-side'); if (text) s.append(h('span', 'rec-count', text)); if (arrow) s.append(h('span', 'rec-chev', '›')); return s; };

  // 1. 前回の結果（直近の夜のタイプとふりかえり）。あとがきもこの中にあるので、別の項目は作らない。
  let night = null; try { night = JSON.parse(localStorage.getItem('mi-last-night')); } catch {}
  if (seen.length || (night && night.ending)) {
    const rep = night && night.report; const typeName = rep && rep.name; const key = rep && TYPE_KEYS.includes(rep.key) ? rep.key : '';
    const endKey = night && night.ending === 'true' && night.sosSent ? 'trueSos' : night && night.ending;
    const endName = (MAIN_ENDINGS.find(([k]) => k === endKey) || [])[1];
    const bg = (key ? `url(${IMG}types/${key}.webp), ` : '') + `url(${IMG}column-hero.jpg)`;
    const b = band('rec-report', '前回の結果', () => { document.getElementById('record').hidden = true; dispatchEvent(new CustomEvent('mi:afterword')); }, `前回の結果を見る${typeName ? '　' + typeName : ''}`);
    b.append(media(key ? 'type' : '', bg, typeName || 'この夜のふりかえり', endName ? `結末「${endName}」` : ''), side(''));
    list.append(b);
    // 保存された名前はその夜の時点のもの。タイプ名を変えたあとも今の名前で出す（report.js は起動を軽くするため後から読む）
    if (key) import('./report.js').then(m => { const n = m.TYPES[key]?.name; if (!n || n === typeName) return; b.querySelector('.rec-name')?.replaceChildren(h('span', 'rec-nw', n)); b.setAttribute('aria-label', `前回の結果を見る　${n}`); }).catch(() => {});
  }

  // 2. たどり着いた結末（見た結末だけを並べる）
  {
    const sec = band('rec-main no-phrase', 'たどり着いた結末'); // 文節分け（wrap.js）を外し、結末名は「・」の後でだけ折り返す
    const body = h('div', 'rec-media');
    if (seen.length) {
      const grid = h('ul', 'rec-grid');
      for (const [k, title, photo] of MAIN_ENDINGS) {
        if (!seen.includes(k)) continue;
        const li = h('li', 'rec-end seen'); const ph = h('span', 'rec-thumb'); ph.setAttribute('aria-hidden', 'true'); ph.style.backgroundImage = `url(${IMG}${photo})`;
        // 「雨のにおい・SOS」は、狭い写真の下でも行頭に「・」が来ないように「雨のにおい」と「SOS」の2行で見せる（読み上げは元の名前）
        const [main, ...vars] = title.split('・'); const nm = h('span', 'rec-endname', main); for (const v of vars) nm.append(h('span', 'rec-var', v));
        li.setAttribute('aria-label', title); li.append(ph, nm); grid.append(li);
      }
      body.append(grid);
    }
    const rest = 7 - seen.length;
    body.append(h('p', 'rec-rest', !seen.length ? 'まだ、どの結末にもたどり着いていません。' : rest ? `まだ見ていない結末が${rest}つあります。` : '7つの結末を、すべて見ました。'));
    sec.append(body, side(`${seen.length}／7`, false));
    sec.setAttribute('aria-label', `たどり着いた結末　${seen.length}／7`);
    list.append(sec);
  }

  // 3. もうひとつの物語（実装済みのIF短編1作品だけ）
  const r = loadRun(); const found = readCollected().length;
  const mid = r && r.step !== 'end' && r.step !== 'dm1';
  const thumb = `url(${IMG}if/if-thumb.jpg)`;
  if (!unlocked()) { // クリア前：押せないことが見て分かる形で
    const b = band('rec-if locked', 'もうひとつの物語', () => {}, 'もうひとつの物語　本編の結末を一つ見ると読めます'); b.disabled = true;
    b.append(media('', thumb, 'ゆきの物語　同意って、何に？', '本編の結末を一つ見ると読めます'), side('', false)); list.append(b);
  } else {
    const b = band('rec-if', 'もうひとつの物語', () => open('record'), `もうひとつの物語を読む　ゆきの物語「同意って、何に？」${mid ? '　つづきから' : ''}${found ? `　見た結末 ${found}／5` : ''}`);
    b.append(media('', thumb, 'ゆきの物語　同意って、何に？', mid ? 'つづきから読めます' : ''), side(found ? `結末 ${found}／5` : '')); list.append(b);
  }
  inner.append(list);
}

/* ───────── 初めて結末に着いたとき：一度だけのお知らせ ───────── */
let noticeEl = null;
function maybeNotice() {
  if (meta().noticeShown || !unlocked()) return;
  const ending = document.getElementById('ending'); if (!ending || ending.hidden || ending.classList.contains('happy')) return;
  // 結末の小さいボタンの列（.ea-sub）のすぐ下に、一文とボタン1つだけを置く。列そのものは game.js が組み立てるので触らない。
  const acts = ending.querySelector('.ending-actions'); if (!acts) return;
  setMeta({ noticeShown: true });
  noticeEl = h('div', 'mif-unlock'); noticeEl.setAttribute('role', 'status');
  noticeEl.append(h('p', '', 'もうひとつの物語が読めるようになりました。'), btn('ゆきの物語を読む', () => { noticeEl.remove(); open('ending'); }, 'mif-unlock-btn'));
  acts.append(noticeEl);
  requestAnimationFrame(() => { noticeEl.classList.add('in'); noticeEl.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); });
  const hide = new MutationObserver(() => { if (ending.hidden) { noticeEl?.remove(); hide.disconnect(); } }); hide.observe(ending, { attributes: true, attributeFilter: ['hidden'] });
}
function watchEnding() {
  const acts = document.querySelector('#ending .ending-actions'); if (!acts) return;
  new MutationObserver(() => { if (acts.classList.contains('in')) setTimeout(maybeNotice, 1600); }).observe(acts, { attributes: true, attributeFilter: ['class'] });
}

/* ───────── つなぎ込み ───────── */
function init() {
  build(); // 解放のお知らせは結末画面には出さない。行動レポートの「この先へ」が unlockNote() で一度だけ添える
  paintRecord();
  // 物語の途中で再読み込みしたときは、物語に戻る（抽選はやり直さない）。
  let reload = false; try { reload = (performance.getEntriesByType('navigation')[0] || {}).type === 'reload'; } catch {}
  const r = loadRun();
  if (reload && r && r.open && unlocked()) setTimeout(() => open('record'), 60);
}
// 行動レポートの「この先へ」用：解放済みなら { first: 初めて知らせるか } を返し、知らせた印を残す
function unlockNote() { if (!unlocked()) return null; const first = !meta().noticeShown; if (first) setMeta({ noticeShown: true }); return { first }; }
window.MiIF = { open, paintRecord, unlocked, unlockNote };
if (DEV) window.__if = { get run() { return run; }, MODES, WORLDS, computeWeights, eligibleEndings, boostUnseen, UNSEEN_BOOST, reset() { try { localStorage.removeItem(RUN_KEY); localStorage.removeItem(COLLECTION_KEY); localStorage.removeItem(META_KEY); } catch {} run = null; } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
