// プレイ分析の PDF（集計レポート A4横・振り返りシート A4縦）を、印刷用にレイアウトしたファイルとして作る。
// 画面の写しではなく、pdf-lib で文字・線・面を直接描く。日本語フォント（Noto Sans JP Regular/Bold）は、
// 出力するときだけ読み込み、使った文字だけをサブセットで埋め込む。数値は画面と同じ stats.js の結果（ctx.st）だけを使う。
import * as S from './stats.js';

const V = new URL('../assets/vendor/', import.meta.url).href;
const LIB = { pdf: V + 'pdf-lib-1.17.1/pdf-lib.min.js', fontkit: V + 'pdf-lib-fontkit-1.1.1/fontkit.umd.min.js' };
const FONT = { reg: V + 'noto-sans-jp-2.004/NotoSansJP-Regular-subset.ttf', bold: V + 'noto-sans-jp-2.004/NotoSansJP-Bold-subset.ttf' };
const fail = reason => Object.assign(new Error(reason), { reason });

function script(src, name) {
  if (window[name]) return Promise.resolve(window[name]);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => (window[name] ? res(window[name]) : rej(fail('PDFを作る部品を読み込めませんでした。ページを読み込み直して、もう一度押してください。')));
    s.onerror = () => rej(fail('PDFを作る部品を読み込めませんでした。通信を確かめて、もう一度押してください。'));
    document.head.append(s);
  });
}
let fontCache = null;
async function fonts() {
  if (fontCache) return fontCache;
  const get = async u => { const r = await fetch(u); if (!r.ok) throw fail('日本語フォントを読み込めませんでした。通信を確かめて、もう一度押してください。'); return r.arrayBuffer(); };
  try { const [reg, bold] = await Promise.all([get(FONT.reg), get(FONT.bold)]); fontCache = { reg, bold }; return fontCache; }
  catch (e) { throw e.reason ? e : fail('日本語フォントを読み込めませんでした。通信を確かめて、もう一度押してください。'); }
}
async function setup() {
  const [PDFLib, fontkit, F] = await Promise.all([script(LIB.pdf, 'PDFLib'), script(LIB.fontkit, 'fontkit'), fonts()]);
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  let reg, bold;
  try { reg = await doc.embedFont(F.reg, { subset: true }); bold = await doc.embedFont(F.bold, { subset: true }); }
  catch { throw fail('日本語フォントを埋め込めませんでした。ページを読み込み直して、もう一度押してください。'); }
  return { PDFLib, doc, reg, bold };
}

// ───────── 描画の土台 ─────────
// 色（Web の teach.css と同じ値）。背景は純白。色はグラフと重要な数値にだけ使う。
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const C = {
  ink: hex('#1C2529'), sub: hex('#59666C'), rule: hex('#E0E5E8'), main: hex('#284D68'), aux: hex('#86A9B6'),
  neutral: hex('#D7DDDF'), edge: hex('#A3B0B6'), tint: hex('#F5F7F8'), white: [1, 1, 1]
};
// 文字の大きさ（pt）：ページの見出し20・セクションの見出し13・本文10.5・ラベル9.5・大きな数値28／16
const T = { page: 20, sec: 13, body: 10.5, label: 9.5, kpi: 28, lead: 16 };
const NO_START = '、。，．,.）)」』】〕〉》］]｝}・：:；;？?！!ー…‥々ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ％%';
const NO_END = '（(「『【〔〈《［[｛{';
// 結末のまとまりと塗り（Web と同じ）：TRUE＝濃い紺の塗り、SECRET＝ブルーグレーに斜線、BAD＝ライトグレー
const FILL = { true: 'main', secret: 'aux', bad: 'neutral' };

function makeKit(env, W, H) {
  const { PDFLib, doc, reg, bold } = env;
  const rgb = c => PDFLib.rgb(c[0], c[1], c[2]);
  const okReg = new Set(reg.getCharacterSet()), okBold = new Set(bold.getCharacterSet());
  const clean = (t, b) => { const ok = b ? okBold : okReg; let s = ''; for (const ch of String(t ?? '').replace(/\r?\n/g, ' ')) s += ok.has(ch.codePointAt(0)) || ch === ' ' ? ch : '〓'; return s; };
  const font = b => (b ? bold : reg);
  const width = (t, size = T.body, b = false) => font(b).widthOfTextAtSize(clean(t, b), size);
  function wrap(t, maxW, size = T.body, b = false) {
    const chars = [...clean(t, b)]; const lines = []; let cur = '';
    for (const ch of chars) {
      if (cur && font(b).widthOfTextAtSize(cur + ch, size) > maxW) {
        if (NO_START.includes(ch) && cur.length > 1) { cur += ch; continue; } // 行頭に来てはいけない文字はぶら下げる
        let carry = ''; while (cur.length > 1 && NO_END.includes(cur[cur.length - 1])) { carry = cur[cur.length - 1] + carry; cur = cur.slice(0, -1); }
        if (/[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]$/.test(cur)) { const m = cur.match(/[A-Za-z0-9]+$/)[0]; if (m.length < cur.length) { carry = m + carry; cur = cur.slice(0, -m.length); } }
        lines.push(cur); cur = carry + ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  const lhOf = size => Math.round(size * 1.55 * 2) / 2;
  const pages = [];
  const k = {
    W, H, wrap, width, pages, page: null,
    newPage() { k.page = doc.addPage([W, H]); pages.push(k.page); return k.page; },
    // y は文字の上端
    text(t, x, y, { size = T.body, b = false, color = C.ink, align = 'left', maxW } = {}) {
      let s = clean(t, b); if (maxW) while (s.length > 1 && font(b).widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -2) + '…';
      const w = font(b).widthOfTextAtSize(s, size); const dx = align === 'right' ? -w : align === 'center' ? -w / 2 : 0;
      k.page.drawText(s, { x: x + dx, y: H - y - size * 1.08, size, font: font(b), color: rgb(color) });
      return w;
    },
    para(t, x, y, w, { size = T.body, b = false, color = C.ink, lh = lhOf(size) } = {}) { const ls = wrap(t, w, size, b); ls.forEach((l, i) => k.text(l, x, y + i * lh, { size, b, color })); return ls.length * lh; },
    paraH: (t, w, { size = T.body, b = false, lh = lhOf(size) } = {}) => wrap(t, w, size, b).length * lh,
    rect(x, y, w, h, fill, stroke, sw = 0.6) { if (w <= 0 || h <= 0) return; k.page.drawRectangle({ x, y: H - y - h, width: w, height: h, color: fill ? rgb(fill) : undefined, borderColor: stroke ? rgb(stroke) : undefined, borderWidth: stroke ? sw : 0 }); },
    line(x1, y1, x2, y2, color = C.rule, t = 0.75) { k.page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: t, color: rgb(color) }); },
    // 塗り4種類。白黒で印刷しても、濃い塗り・斜線・薄い塗り・点で見分けられる
    fill(x, y, w, h, kind) {
      if (w <= 0.2 || h <= 0) return;
      if (kind === 'main') return k.rect(x, y, w, h, C.main);
      if (kind === 'neutral') return k.rect(x, y, w, h, C.neutral, C.edge, 0.5);
      if (kind === 'aux') {
        k.rect(x, y, w, h, C.aux); const s = 4;
        for (let c = -h; c < w; c += s) { const lo = Math.max(0, c), hi = Math.min(w, h + c); if (hi - lo > 0.2) k.line(x + lo, y + h - (lo - c), x + hi, y + h - (hi - c), C.main, 0.7); }
        return;
      }
      if (kind === 'dots') {
        k.rect(x, y, w, h, C.white, C.main, 0.6); const s = 3.6;
        for (let yy = y + s / 2 + 0.3; yy < y + h - 0.5; yy += s) for (let xx = x + s / 2 + 0.3; xx < x + w - 0.5; xx += s) k.page.drawCircle({ x: xx, y: H - yy, size: 0.75, color: rgb(C.main) });
      }
    },
    swatch(x, y, kind, sz = 10) { k.fill(x, y, sz, sz, kind); },
    legend(items, x, y, w, size = T.label) {
      let cx = x, cy = y; const lh = lhOf(size);
      for (const [kind, label] of items) { const lw = 10 + 5 + width(label, size); if (cx > x && cx + lw > x + w) { cx = x; cy += lh; } k.swatch(cx, cy + 2, kind); k.text(label, cx + 15, cy, { size, color: C.ink }); cx += lw + 14; }
      return cy - y + lh;
    },
    legendH(items, w, size = T.label) { let cx = 0, rows = 1; for (const [, label] of items) { const lw = 10 + 5 + width(label, size); if (cx > 0 && cx + lw > w) { cx = 0; rows++; } cx += lw + 14; } return rows * lhOf(size); },
    // 100%積み上げ。数字は入るときだけ帯の中に書く
    stack(segs, n, x, y, w, h) {
      const live = segs.filter(s => s.c > 0); const gap = 1.5; const avail = w - gap * Math.max(0, live.length - 1); let cx = x;
      if (!n || !live.length) { k.rect(x, y, w, h, C.rule); return; }
      for (const s of live) {
        const sw = Math.max(1.5, (s.c / n) * avail); k.fill(cx, y, sw, h, s.fill);
        const label = s.label ?? String(s.c); const size = h >= 16 ? T.body : T.label; const tw = width(label, size, true);
        if (sw >= tw + 10 && h >= 12) {
          const ty = y + (h - size * 1.3) / 2;
          if (s.fill === 'main') k.text(label, cx + sw / 2, ty, { size, b: true, color: C.white, align: 'center' });
          else if (label) { if (s.fill !== 'neutral') k.rect(cx + sw / 2 - tw / 2 - 3, y + (h - size - 3) / 2, tw + 6, size + 3, C.white); k.text(label, cx + sw / 2, ty, { size, b: true, color: C.ink, align: 'center' }); }
        }
        cx += sw + gap;
      }
    },
    // ラベル｜棒（max に対する長さ）｜件数と割合
    hbar(label, c, n, max, x, y, w, { lw = 160, nw = 82, fill = 'main', h = 9, size = T.body, swatch } = {}) {
      let lx = x; if (swatch) { k.swatch(x, y + 3, swatch, 9); lx += 15; }
      if (label) k.text(label, lx, y, { size, maxW: lw - (lx - x) - 8, color: c ? C.ink : C.sub });
      const bx = x + lw, bw = w - lw - nw;
      if (c) k.fill(bx, y + (size * 1.4 - h) / 2, max ? (c / max) * bw : 0, h, fill); else k.line(bx, y + size * 0.7, bx + 2, y + size * 0.7, C.edge, 1);
      k.text(`${c}件`, x + w - 40, y, { size, align: 'right', b: true, color: c ? C.ink : C.sub });
      k.text(`${S.pct(c, n)}%`, x + w, y, { size: T.label, align: 'right', color: C.sub });
    }
  };
  return k;
}

// セクションの見出し（13pt）と、右に母数。下に細い罫線。高さを返す
function secHead(k, title, base, x, y, w) {
  k.text(title, x, y, { size: T.sec, b: true });
  if (base) k.text(base, x + w, y + 3, { size: T.label, color: C.sub, align: 'right' });
  k.line(x, y + 22, x + w, y + 22, C.rule, 0.75);
  return 32;
}
const periodText = ([a, b]) => S.dayKey(a) === S.dayKey(b) ? `${S.stamp(a)}〜${S.pad2(new Date(b).getHours())}:${S.pad2(new Date(b).getMinutes())}` : `${S.stamp(a)}〜${S.stamp(b)}`;
const NOTES = [
  ['集計の単位', '参加IDは端末ごとの参加登録の数です。提出は参加ID1つにつき最後の1件で、遊んだ回数は数えていません。'],
  ['未提出', '遊んでいる途中、途中でやめた、送っていない、送ったあと削除した、の区別はできません。'],
  ['読み取りの注意', '記録の重なりを集計したものです。行動と結末の因果関係や、学習の効果は示していません。']
];
const RULES = [
  ['参加ID', '参加者が「参加して始める」を押すと1件できます。人ではなく端末での参加登録の数です。同じ人が別の端末で参加したり、同じ端末で「別の参加者として始める」を押したりすると、別のIDとして数えます。'],
  ['提出と再挑戦', '提出は参加ID1つにつき1件です。遊び直して送り直すと、前の提出と置き換わります。遊んだ回数や再挑戦の回数は記録していないため、集計は各IDの最後に送った結果だけです。'],
  ['未提出', '参加IDはあるが、提出がないものです。遊んでいる途中、途中でやめた、遊び終えたが送っていない、送ったあと本人が削除した、のどれかは区別できません。'],
  ['集計対象', '問いと判定のバージョンが今と同じ提出です。前のバージョンの提出は件数だけを示し、グラフには入れていません。'],
  ['母数', '図ごとに、何を母数にしたかを見出しの右に書いています。行動の記録は、その場面に来た提出だけを母数にしています。'],
  ['読み取りの注意', '人数が少ないと、割合は大きく動きます。この集計は記録の重なりを示すもので、行動と結末の因果関係や、学習の効果を示すものではありません。タイプに優劣はなく、成績には使わないでください。']
];

// ───────── 集計レポート（A4横） ─────────
export async function reportPdf(ctx) {
  const env = await setup();
  const { st, cls, sample, P } = ctx;
  const W = 841.89, H = 595.28, ML = 48, MT = 32, CW = W - ML * 2, BOTTOM = H - 58;
  const G = 18, colW = (CW - G * 11) / 12;
  const cx = c => ML + c * (colW + G), span = n => n * colW + (n - 1) * G;
  const k = makeKit(env, W, H);
  const made = S.stamp(ctx.made);

  // ページの枠：上に小さな帯、見出し（目印・ページの見出し・補足の1行）、罫線。中身の書き始めの y を返す
  function frame(eyebrow, title, meta) {
    k.newPage();
    k.text('ミーを信じて　プレイ分析レポート', ML, MT, { size: T.label, color: C.sub });
    if (sample) k.text('サンプル（架空のデータ）', W - ML, MT, { size: T.label, b: true, align: 'right' });
    k.text(eyebrow, ML, MT + 22, { size: T.label, b: true, color: C.main });
    k.text(title, ML, MT + 37, { size: T.page, b: true, maxW: CW });
    if (!meta) { k.line(ML, MT + 66, W - ML, MT + 66, C.ink, 1); return MT + 80; }
    k.text(meta, ML, MT + 67, { size: 10, color: C.sub, maxW: CW });
    k.line(ML, MT + 88, W - ML, MT + 88, C.ink, 1);
    return MT + 102;
  }

  const metaLine = [`集計期間 ${st.period ? periodText(st.period) : '提出なし'}`, `集計対象の提出 ${st.N}件`, `データの読み込み ${S.stamp(P.loadedAt)}`].join('　｜　');

  // ── P1 プレイの全体像 ──
  let y = frame('プレイの全体像', cls.title, metaLine);
  // 指標4つ（囲まずに、細い罫線で区切る）
  {
    const q = st.kpi; const tiles = [
      { label: '参加ID', v: q.members != null ? String(q.members) : '—', unit: q.members != null ? '件' : '', base: q.members != null ? `提出あり ${st.funnel.cur}件（${q.submitRate}%）・未提出 ${st.funnel.none}件` : '参加の記録を読めませんでした', bar: !!(st.funnel && st.funnel.M) },
      { label: '集計対象の提出', v: String(q.N), unit: '件', base: st.oldN ? `前のバージョン ${st.oldN}件は含めていません` : '参加ID1つにつき最後の1件' },
      { label: 'TRUE・SECRET END', v: q.N ? String(q.clearRate) : '—', unit: q.N ? '%' : '', base: q.N ? `集計対象 ${q.N}件中 ${q.clear}件` : '集計対象の提出がありません' },
      { label: '前後の問いで答えが変わった', v: q.B ? String(q.changedRate) : '—', unit: q.B ? '%' : '', base: q.B ? `両方に答えた ${q.B}件中 ${q.changed}件` : '両方に答えた提出がありません' }
    ];
    tiles.forEach((t, i) => {
      const x = cx(i * 3), w = span(3);
      if (i) k.line(x - G / 2, y, x - G / 2, y + 70, C.rule, 0.75);
      k.text(t.label, x, y, { size: T.label, color: C.sub });
      const vw = k.text(t.v, x, y + 14, { size: T.kpi, b: true });
      if (t.unit) k.text(t.unit, x + vw + 3, y + 28, { size: 12, b: true });
      if (t.bar) { const f = st.funnel; k.stack([{ c: f.cur, fill: 'main', label: '' }, { c: f.old, fill: 'aux', label: '' }, { c: f.none, fill: 'neutral', label: '' }], f.M, x, y + 50, w - 8, 6); }
      k.text(t.base, x, y + (t.bar ? 60 : 52), { size: T.label, color: C.sub, maxW: w - 4 });
    });
    y += 78; k.line(ML, y, W - ML, y, C.rule, 0.75); y += 14;
  }
  if (!st.N) {
    // 0件：空のグラフは描かず、案内と話し合いのヒント
    const w = span(12);
    y += secHead(k, st.cond.end !== 'all' ? 'この条件に当てはまる提出はありません' : 'まだ集計できる提出はありません', '', ML, y, w);
    y += k.para(st.cond.end !== 'all' ? '結末の条件を「すべての結末」に戻すと、ほかの提出を集計できます。' : '参加者が遊び終わって「結果を送る」を押すと、結末・タイプ・行動の集計を出力できます。', ML, y, w, { color: C.sub }) + 18;
    y = questions(y) + 10;
    notesBand(Math.max(y, BOTTOM - 58));
  } else {
    // 結末の分布（主役）：まとまりの構成比を太い帯で、その下に7つの結末の内訳
    {
      const x = cx(0), w = span(7); let a = y + secHead(k, '結末の分布', `母数：集計対象 ${st.N}件`, x, y, w);
      const segs = S.GROUPS.map(g => ({ c: st.groups.find(z => z.k === g.k).c, fill: FILL[g.k], label: '' }));
      k.stack(segs, st.N, x, a, w, 22); a += 30;
      S.GROUPS.forEach((g, i) => {
        const gc = st.groups.find(z => z.k === g.k).c; const bx = x + (w / 3) * i;
        k.swatch(bx, a + 2, FILL[g.k]); k.text(g.label, bx + 15, a, { size: T.label, b: true });
        const pw = k.text(`${S.pct(gc, st.N)}%`, bx, a + 14, { size: T.lead, b: true }); k.text(`${gc}件`, bx + pw + 6, a + 19, { size: T.label, color: C.sub });
      });
      a += 42;
      k.text('結末ごとの件数', x, a, { size: T.label, b: true, color: C.sub }); a += 16;
      const max = Math.max(1, ...st.endings.map(e => e.c));
      for (const e of st.endings) { k.hbar(`「${e.sub}」`, e.c, st.N, max, x, a, w, { swatch: FILL[e.group], lw: 190, fill: FILL[e.group], h: 9 }); a += 15.5; }
    }
    // タイプの分布：件数の多い順の横棒
    {
      const x = cx(7), w = span(5); let a = y + secHead(k, 'タイプの分布', `母数：集計対象 ${st.N}件`, x, y, w);
      const list = S.typesByCount(st); const max = Math.max(1, ...list.map(t => t.c));
      for (const t of list) { k.hbar(t.name, t.c, st.N, max, x, a, w, { lw: 150, h: 10 }); a += 20; }
      a += 2; k.text(`タイプに優劣はありません。控えめに判定した観点がある提出：${st.thinAny}件`, x, a, { size: T.label, color: C.sub, maxW: w });
    }
    notesBand(BOTTOM - 54);
  }
  // 集計の単位と注意（3段に分けて、P1の下に）
  function notesBand(yy) {
    k.line(ML, yy, W - ML, yy, C.rule, 0.75); yy += 10;
    NOTES.forEach(([h, t], i) => { const x = cx(i * 4), w = span(4); k.text(h, x, yy, { size: T.label, b: true }); k.para(t, x, yy + 15, w, { size: T.label, color: C.sub, lh: 13.5 }); });
  }
  // 話し合いのヒント（問い4つを2段組み）
  function questions(yy) {
    k.text('話し合いのヒント', ML, yy, { size: T.label, b: true, color: C.main }); k.line(ML, yy + 18, W - ML, yy + 18, C.rule, 0.75); yy += 28;
    const w = span(6); let rowH = 0;
    S.TEACH_QS.forEach((q, i) => {
      const x = cx((i % 2) * 6), qy = yy + Math.floor(i / 2) * 0; const h = k.paraH(q, w - 26);
      if (i % 2 === 0 && i) { yy += rowH + 10; rowH = 0; }
      k.text(String(i + 1), x, yy - 1, { size: T.sec, b: true, color: C.main }); k.para(q, x + 26, yy, w - 26); rowH = Math.max(rowH, h);
      void qy;
    });
    return yy + rowH;
  }

  if (st.N) {
    // ── P2 プレイヤーの判断 ──
    y = frame('プレイヤーの判断', 'ミーへの任せ方と、情報の確かめ方', 'その場面に来た提出だけを母数にしています。行ごとに母数（n）が違います。');
    const A = Object.fromEntries(st.acts.flatMap(g => g.items).map(a => [a.k, a]));
    // 左：自分で操作したか、ミーに任せたか（同じ100%の尺度で3つを並べる）
    {
      const x = cx(0), w = span(7); let a = y + secHead(k, '自分で操作したか、ミーに任せたか', '左：自分で　右：ミーに任せた', x, y, w);
      for (const key of ['keypad', 'panel', 'admin']) {
        const it = A[key]; const [s, m] = it.vals;
        k.text(it.label, x, a, { b: true, maxW: w - 80 }); k.text(`n=${it.n}件`, x + w, a + 1, { size: T.label, color: C.sub, align: 'right' }); a += 16;
        if (it.n) {
          k.text(`${s.label} ${s.c}件（${S.pct(s.c, it.n)}%）`, x, a, { size: T.label, color: C.ink }); k.text(`${m.label} ${m.c}件（${S.pct(m.c, it.n)}%）`, x + w, a, { size: T.label, color: C.ink, align: 'right' }); a += 14;
          k.stack([{ c: s.c, fill: 'main', label: '' }, { c: m.c, fill: 'neutral', label: '' }], it.n, x, a, w, 16); a += 28;
        } else { k.text('この場面に来た提出はありません', x, a, { size: T.label, color: C.sub }); a += 30; }
      }
      // ミーの代わりの返信や決済（強調する1項目）
      const p = A.proxy; a += 4; k.line(x, a, x + w, a, C.rule, 0.75); a += 12;
      k.text('ミーの代わりの返信や決済を止めたか', x, a, { b: true }); k.text(`n=${p.n}件`, x + w, a + 1, { size: T.label, color: C.sub, align: 'right' }); a += 18;
      if (p.n) {
        const pw = k.text(`${S.pct(p.vals[0].c, p.n)}%`, x, a, { size: T.kpi, b: true, color: C.main });
        k.para(`ミーの設定画面で、代わりの返信や決済をオフ・一時停止・「あとで」にした提出は ${p.vals[0].c}件（${p.n}件中）でした。止めなかった提出は ${p.vals[1].c}件です。`, x + pw + 16, a + 2, w - pw - 16, { size: T.body });
      } else k.text('管理画面を開いた提出はありません', x, a, { size: T.label, color: C.sub });
    }
    // 右：情報の確かめ方（「した」割合を、同じ0〜100%の尺度で）
    {
      const x = cx(7), w = span(5); let a = y + secHead(k, '情報の確かめ方', '「した」割合', x, y, w);
      const bw = w - 70;
      for (const key of ['askSource', 'askWhen', 'map', 'site']) {
        const it = A[key]; const yes = it.vals[0];
        const lh = k.para(it.label, x, a, w - 70, { size: T.body }); 
        if (it.n) { k.text(`${S.pct(yes.c, it.n)}%`, x + w, a - 2, { size: T.sec, b: true, align: 'right' }); k.text(`${yes.c}/${it.n}件`, x + w, a + 16, { size: T.label, color: C.sub, align: 'right' }); }
        else k.text('記録なし', x + w, a, { size: T.label, color: C.sub, align: 'right' });
        a += Math.max(lh, 16) + 4;
        k.rect(x, a, bw, 9, C.rule); if (it.n) k.fill(x, a, (yes.c / it.n) * bw, 9, 'main');
        a += 22;
      }
      // 目盛り
      for (const [f, t] of [[0, '0%'], [0.5, '50%'], [1, '100%']]) { k.line(x + bw * f, a - 6, x + bw * f, a - 2, C.edge, 0.6); k.text(t, x + bw * f, a, { size: T.label, color: C.sub, align: f === 0 ? 'left' : f === 1 ? 'right' : 'center' }); }
    }
    // 下：補助の集計（小さな表）
    {
      const top = BOTTOM - 112; let a = top;
      const sc = A.scam; const x1 = cx(0), w1 = span(6);
      k.text('知らない番号からの「お母さんが倒れた」', x1, a, { b: true, maxW: w1 - 70 }); k.text(`n=${sc.n}件`, x1 + w1, a + 1, { size: T.label, color: C.sub, align: 'right' });
      table(x1, a + 20, w1, sc.vals.map(v => [v.label, `${v.c}件`, `${S.pct(v.c, sc.n)}%`]), [0.64, 0.18, 0.18]);
      const x2 = cx(6), w2 = span(6); const sf = st.safe;
      k.text('動く前の備えと連絡', x2, a, { b: true });
      table(x2, a + 20, w2, [
        [A.doorStop.label, `${A.doorStop.vals[0].label} ${A.doorStop.vals[0].c}件`, `n=${A.doorStop.n}件`],
        [A.sos.label, `${A.sos.vals[0].label} ${A.sos.vals[0].c}件`, `n=${A.sos.n}件`],
        ['動く前の備え：先に確かめた', `${sf.S}件`, `n=${st.N}件`],
        ['動く前の備え：両方・進んでから・記録なし', `${sf.both}・${sf.B}・${sf.none}件`, `n=${st.N}件`]
      ], [0.6, 0.26, 0.14]);
    }
    // ── P3 結果と振り返り ──
    y = frame('結果と振り返り', 'データから分かることと、話し合いのヒント', null);
    k.text('データから分かること', ML, y, { size: T.label, b: true, color: C.main });
    k.text('ゲームの記録の集計です。学習の効果を測ったものではありません。', W - ML, y, { size: T.label, color: C.sub, align: 'right' });
    y += 22;
    const bandTop = y;
    // 3つの観点
    {
      const x = cx(0), w = span(4); let a = bandTop + secHead(k, 'タイプを決める3つの観点', `n=${st.N}件`, x, bandTop, w);
      for (const ax of st.axes) {
        const [L, R] = ax.sides;
        k.text(ax.label, x, a, { b: true }); a += 16;
        k.text(`${L.label} ${L.c}`, x, a, { size: T.label }); k.text(`${R.label} ${R.c}`, x + w, a, { size: T.label, align: 'right' }); a += 14;
        k.stack([{ c: L.clear, fill: 'main' }, { c: L.thin, fill: 'aux' }, { c: R.thin, fill: 'dots' }, { c: R.clear, fill: 'neutral' }], st.N, x, a, w, 16); a += 26;
      }
      k.legend([['main', '左にはっきり'], ['aux', '左・差が小さい'], ['dots', '右・差が小さい'], ['neutral', '右にはっきり']], x, a, w);
    }
    // プレイ前後の問い（2つの条件の並列棒）
    {
      const x = cx(4), w = span(4); const pp = st.pp; let a = bandTop + secHead(k, 'プレイ前後の問い', `両方に答えた ${pp.B}件`, x, bandTop, w);
      a += k.para(S.Q1_TEXT.replace(/\n/g, ''), x, a, w, { size: T.label, color: C.sub, lh: 13.5 }) + 8;
      if (pp.B) {
        const max = Math.max(1, ...pp.opts.flatMap(o => [o.pre, o.post]));
        for (const o of pp.opts) {
          k.text(o.label, x, a, { b: true, size: T.body, maxW: w }); a += 16;
          k.hbar('はじめる前', o.pre, pp.B, max, x, a, w, { lw: 62, nw: 70, fill: 'neutral', h: 9, size: T.label }); a += 14;
          k.hbar('遊んだあと', o.post, pp.B, max, x, a, w, { lw: 62, nw: 70, fill: 'main', h: 9, size: T.label }); a += 20;
        }
        k.para(`答えが変わった提出は ${pp.changed}件（${pp.B}件中）です。組み合わせの表は付録にあります。`, x, a, w, { size: T.label, color: C.sub, lh: 13.5 });
      } else k.text('両方に答えた提出はまだありません。', x, a, { size: T.label, color: C.sub });
    }
    // 行動と結末の重なり（画面で選んだ行動）
    {
      const x = cx(8), w = span(4); let a = bandTop + secHead(k, '行動と結末の重なり', `n=${st.N}件`, x, bandTop, w);
      if (st.cond.end !== 'all') { k.para('結末で絞り込んでいるため、この図は出していません。', x, a, w, { size: T.label, color: C.sub }); }
      else {
        k.text(st.cross.label, x, a, { b: true, maxW: w }); a += 16;
        a += k.para('答えごとに、着いた結末の内訳を並べています。結末の原因かどうかは、この図からは分かりません。', x, a, w, { size: T.label, color: C.sub, lh: 13.5 }) + 6;
        for (const r of st.cross.rows) {
          k.text(r.label, x, a, { size: T.label, maxW: w - 40 }); k.text(`${r.n}件`, x + w, a, { size: T.label, color: C.sub, align: 'right' }); a += 14;
          k.stack(S.GROUPS.map(g => ({ c: r.g[g.k], fill: FILL[g.k] })), r.n, x, a, w, 16); a += 24;
        }
        a += k.legend(S.GROUPS.map(g => [FILL[g.k], g.label]), x, a, w);
        if (st.cross.missing) k.text(`記録がない ${st.cross.missing}件は入れていません。`, x, a, { size: T.label, color: C.sub, maxW: w });
      }
    }
    questions(BOTTOM - 112);

    // ── 付録1：組み合わせ表と集計の決まり ──
    y = frame('付録', '前後の答えの組み合わせと、集計の決まり', null);
    {
      const x = cx(0), w = span(5), pp = st.pp; let a = y + secHead(k, 'プレイ前後の答えの組み合わせ', `両方に答えた ${pp.B}件`, x, y, w);
      if (pp.B) {
        k.text('行：はじめる前　列：遊んだあと', x, a, { size: T.label, color: C.sub }); a += 20;
        const c0 = 142, cw = (w - c0) / 3, rh = 24, hh = 62;
        pp.opts.forEach((o, j) => k.wrap(o.label, cw - 6, T.label, true).slice(0, 4).forEach((l, n) => k.text(l, x + c0 + cw * j + cw / 2, a + 3 + n * 14, { size: T.label, b: true, align: 'center' })));
        k.line(x, a + hh, x + w, a + hh, C.ink, 0.75);
        pp.opts.forEach((o, i) => {
          const ry = a + hh + rh * i; k.wrap(o.label, c0 - 8, T.label, true).slice(0, 2).forEach((l, n) => k.text(l, x, ry + (rh - 14 * Math.min(2, k.wrap(o.label, c0 - 8, T.label, true).length)) / 2 + n * 13, { size: T.label, b: true }));
          pp.matrix[i].forEach((c, j) => { if (i === j) k.rect(x + c0 + cw * j + 1, ry + 1, cw - 2, rh - 2, C.tint); k.text(String(c), x + c0 + cw * j + cw / 2, ry + 6, { size: T.body, b: i === j, align: 'center' }); });
          k.line(x, ry + rh, x + w, ry + rh, C.rule, 0.6);
        });
        a += hh + rh * 3 + 10;
        k.para(`対角線（色の付いたます）は答えが同じだった提出です。答えが変わった提出は ${pp.changed}件です。どちらかに答えていない ${pp.onlyPre + pp.onlyPost + pp.neither}件は含めていません。`, x, a, w, { size: T.label, color: C.sub, lh: 13.5 });
      } else k.text('両方に答えた提出はまだありません。', x, a, { size: T.label, color: C.sub });
    }
    {
      const x = cx(6), w = span(6); let a = y + secHead(k, '集計の決まり', '', x, y, w);
      for (const [h, t] of RULES) { k.text(h, x, a, { size: T.body, b: true }); a += 16; a += k.para(t, x, a, w, { size: T.label, color: C.ink, lh: 14 }) + 8; }
    }
    // ── 付録2：行動ごとの結末の内訳（すべての行動） ──
    crossAppendix();
  }

  // 提出一覧（選んだときだけ）
  if (ctx.table && st.N) listPages();

  // フッター：集計条件・作成日時・ページ番号
  k.pages.forEach((p, i) => {
    k.page = p; k.line(ML, H - 44, W - ML, H - 44, C.rule, 0.6);
    k.text(`集計条件　${st.condText}`, ML, H - 36, { size: 9, color: C.sub, maxW: CW - 210 });
    k.text(`作成 ${made}　　${i + 1} / ${k.pages.length}`, W - ML, H - 36, { size: 9, color: C.sub, align: 'right' });
  });
  env.doc.setTitle(`プレイ分析レポート　${cls.title}`); env.doc.setCreator('ミーを信じて プレイ分析'); env.doc.setProducer('pdf-lib 1.17.1'); env.doc.setLanguage('ja');
  return env.doc.save();

  // 小さな表（罫線だけ。数字は右寄せ）
  function table(x, y0, w, rows, fr) {
    let a = y0; k.line(x, a, x + w, a, C.ink, 0.75);
    for (const r of rows) {
      let px = x; r.forEach((c, j) => { const cw = w * fr[j]; k.text(c, j ? px + cw - 4 : px, a + 5, { size: T.label, align: j ? 'right' : 'left', maxW: cw - 8, color: j === r.length - 1 && /^n=/.test(c) ? C.sub : C.ink }); px += cw; });
      a += 21; k.line(x, a, x + w, a, C.rule, 0.6);
    }
    return a - y0;
  }
  function crossAppendix() {
    const items = S.DIMS.map(d => S.crossOf(st.rows, d.id));
    const colWd = span(6), RH = 15, HH = 18;
    let page = 0, col = 0, a = 0, top = 0;
    const cols = [['答え', 0.46], ['件数', 0.12], ['TRUE', 0.14], ['SECRET', 0.14], ['BAD', 0.14]];
    const start = () => { top = frame('付録', page ? '行動ごとの結末の内訳（続き）' : '行動ごとの結末の内訳', null); k.text('すべての行動について、答えごとの結末の件数です。記録がない提出は、その行動の件数に入っていません。', ML, top, { size: T.label, color: C.sub, maxW: CW }); top += 22; page++; col = 0; a = top; head(); };
    const head = () => { const x = cx(col * 6); let px = x; cols.forEach(([t, f], j) => { const cw = colWd * f; k.text(t, j ? px + cw - 4 : px, a, { size: T.label, b: true, align: j ? 'right' : 'left' }); px += cw; }); a += 16; k.line(x, a, x + colWd, a, C.ink, 0.75); a += 4; };
    start();
    // 1ページに収まるなら、左右の段の高さがそろう所で分ける
    const needs = items.map(it => HH + it.rows.length * RH + 1); const avail = BOTTOM - a;
    let split = -1, best = Infinity;
    for (let i = 1; i < items.length; i++) { const l = needs.slice(0, i).reduce((m, v) => m + v, 0), r = needs.slice(i).reduce((m, v) => m + v, 0); if (l <= avail && r <= avail && Math.abs(l - r) < best) { best = Math.abs(l - r); split = i; } }
    items.forEach((it, i) => {
      const need = needs[i];
      if (i === split || (split < 0 && a + need > BOTTOM)) { if (col === 0) { col = 1; a = top; head(); } else start(); }
      const x = cx(col * 6);
      k.text(it.label, x, a + 2, { size: T.label, b: true, maxW: colWd }); a += HH;
      for (const r of it.rows) {
        let px = x; [r.label, `${r.n}`, `${r.g.true}`, `${r.g.secret}`, `${r.g.bad}`].forEach((c, j) => { const cw = colWd * cols[j][1]; k.text(c, j ? px + cw - 4 : px + 8, a + 1.5, { size: T.label, align: j ? 'right' : 'left', maxW: cw - 10, color: j && c === '0' ? C.sub : C.ink }); px += cw; });
        a += RH; k.line(x, a, x + colWd, a, C.rule, 0.5);
      }
      a += 1;
    });
  }
  function listPages() {
    const rows = S.tableRows(P, st, ctx.names !== 'label').sort((a, b) => a.at - b.at);
    const cols = [['番号・表示名', 0.14], ['提出日時', 0.12], ['タイプ', 0.19], ['結末', 0.22], ['はじめる前 → 遊んだあと', 0.26], ['振り返り', 0.07]];
    const xs = []; let acc = ML; for (const [, f] of cols) { xs.push(acc); acc += CW * f; }
    const RH = 34; let a = 0;
    const start = n => { a = frame('付録', `提出一覧（${rows.length}件、提出順）${n ? '（続き）' : ''}`, null); cols.forEach(([t], i) => k.text(t, xs[i] + 4, a, { size: T.label, b: true, maxW: CW * cols[i][1] - 8 })); a += 16; k.line(ML, a, ML + CW, a, C.ink, 0.75); };
    start(0);
    rows.forEach((r, i) => {
      if (a + RH > BOTTOM) start(1);
      const cells = [r.name, S.shortStamp(r.at), r.typeName, [r.endingKind, S.endingName(r.ending).slice(r.endingKind.length)], [`前：${r.pre ? S.q1Text(r.pre) : '未回答'}`, `後：${r.post ? S.q1Text(r.post) : '未回答'}`], `${(r.r1 ? 1 : 0) + (r.r2 ? 1 : 0)}／2問`];
      cells.forEach((t, j) => { const cw = CW * cols[j][1] - 8; const ls = Array.isArray(t) ? t : k.wrap(t, cw, T.label, j === 0); ls.slice(0, 2).forEach((l, n) => k.text(l, xs[j] + 4, a + 4 + n * 14, { size: T.label, maxW: cw, b: j === 0 })); });
      a += RH; k.line(ML, a, ML + CW, a, C.rule, 0.5);
    });
  }
}

// ───────── 振り返りシート（A4縦、参加者に配る用紙） ─────────
export async function sheetPdf(ctx) {
  const env = await setup();
  const { st, cls, sample } = ctx;
  const W = 595.28, H = 841.89, M = 48, CW = W - M * 2;
  const k = makeKit(env, W, H); k.newPage();
  k.text('ミーを信じて　振り返りシート', M, M - 8, { size: T.label, color: C.sub });
  k.text(cls.title + (sample && !/サンプル/.test(cls.title) ? '（サンプル）' : ''), W - M, M - 8, { size: T.label, color: C.sub, align: 'right', maxW: CW * 0.55 });
  k.text('遊んだあとの振り返り', M, M + 18, { size: 22, b: true });
  let y = M + 64;
  const fields = [['日付', 0.3], ['番号', 0.22], ['名前', 0.48]]; let fx = M;
  for (const [t, f] of fields) { k.text(t, fx, y + 8, { size: T.body, color: C.sub }); k.line(fx + 32, y + 26, fx + CW * f - 14, y + 26, C.ink, 0.75); fx += CW * f; }
  y += 46;
  y += k.para('ゲームの中で自分がどう判断したかを思い出して、答えてください。正解はありません。', M, y, CW, { size: 11 }) + 16;
  if (ctx.summary && st.pp.B) {
    const pp = st.pp; k.line(M, y, M + CW, y, C.rule, 0.75); y += 12;
    k.text(`グループの答え（はじめる前と遊んだあとの両方に答えた ${pp.B}件）`, M, y, { size: T.body, b: true }); y += 20;
    y += k.para(S.Q1_TEXT.replace(/\n/g, ''), M, y, CW, { size: T.label, color: C.sub, lh: 14 }) + 6;
    const gw = (CW - 160) / 2; const max = Math.max(1, ...pp.opts.flatMap(o => [o.pre, o.post]));
    k.text('はじめる前', M + 160, y, { size: T.label, color: C.sub }); k.text('遊んだあと', M + 160 + gw, y, { size: T.label, color: C.sub }); y += 16;
    for (const o of pp.opts) { k.text(o.label, M, y, { size: T.label, maxW: 154 }); k.hbar('', o.pre, pp.B, max, M + 160, y, gw - 14, { lw: 0, nw: 74, fill: 'neutral', size: T.label }); k.hbar('', o.post, pp.B, max, M + 160 + gw, y, gw, { lw: 0, nw: 74, fill: 'main', size: T.label }); y += 18; }
    y += 6; k.line(M, y, M + CW, y, C.rule, 0.75); y += 20;
  }
  const bottom = H - M - 30; const qs = ctx.qs; const RULE = 28;
  const qh = qs.map(q => k.paraH(q, CW - 32, { size: 12, b: true, lh: 18 }) + 12);
  const total = Math.floor((bottom - y - qh.reduce((a, b) => a + b, 0) - qs.length * 18) / RULE);
  const nLines = i => Math.max(2, Math.floor(total / qs.length) + (i < total % qs.length ? 1 : 0));
  qs.forEach((q, i) => {
    k.text(String(i + 1), M, y - 2, { size: 16, b: true, color: C.main });
    k.para(q, M + 32, y + 1, CW - 32, { size: 12, b: true, lh: 18 }); y += qh[i];
    const lines = nLines(i); for (let j = 1; j <= lines; j++) k.line(M, y + j * RULE, M + CW, y + j * RULE, C.edge, 0.6);
    y += lines * RULE + 18;
  });
  k.line(M, H - M + 2, W - M, H - M + 2, C.rule, 0.6);
  k.text('ミーを信じて　グループで使う振り返りシート', M, H - M + 10, { size: 9, color: C.sub });
  env.doc.setTitle(`振り返りシート　${cls.title}`); env.doc.setCreator('ミーを信じて プレイ分析'); env.doc.setProducer('pdf-lib 1.17.1'); env.doc.setLanguage('ja');
  return env.doc.save();
}
