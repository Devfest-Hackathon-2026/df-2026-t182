// プレイ分析の集計（画面・PDF・CSV が同じ数値を使うように、ここで一度だけ数える）。通信も DOM も使わない。
//
// 数え方の決まり（画面の「集計の決まり」と PDF の注記も、この内容に合わせている）
// - 参加ID：参加者が「参加して始める」を押すと classes/{code}/members/{pid} が1件できる。人ではなく、端末での参加登録の単位。
//   同じ人が別の端末やブラウザで参加すると別のID。同じ端末で「別の参加者として始める」を押しても新しいID。
// - 提出：classes/{code}/subs/{pid}。ドキュメントIDが参加IDなので、1つの参加IDにつき1件。
//   遊び直して送り直すと前の提出と置き換わる（再挑戦の回数・遊んだ回数は記録していない）。各IDの最後に送った夜だけが残る。
// - 未提出：参加IDはあるが提出がない。遊んでいる途中・途中でやめた・遊び終えたが送っていない・送ったあと本人が削除した、を区別できない。
// - 集計対象：問いと判定のバージョンが今と同じ提出（VERSIONS.quiz / judge）。前のバージョンの提出は数だけ示し、分布には入れない。
// - 行動の記録：その場面に来ていない人・記録が残っていない人は、その行動の分母に入れない（項目ごとに母数が違う）。
import { TYPES, ORDER } from '../report.js';
import { ACTS, Q1, REFLECT_QS, ENDINGS, VERSIONS } from '../class-data.js';

export const ENDING_ORDER = ['true', 'trueSos', 'secret', 'fake', 'be1', 'be2', 'be3'];
export const GROUPS = [
  { k: 'true', label: 'TRUE END', ids: ['true', 'trueSos'] },
  { k: 'secret', label: 'SECRET END', ids: ['secret'] },
  { k: 'bad', label: 'BAD END', ids: ['fake', 'be1', 'be2', 'be3'] }
];
export const groupOf = id => (GROUPS.find(g => g.ids.includes(id)) || {}).k || '';
export const END_FILTERS = [['all', 'すべての結末'], ['clear', 'TRUE・SECRET END'], ['bad', 'BAD END']];

// タイプの3つの観点。type の1〜3文字目がそれぞれの側（report.js judge と同じ）
export const AXES = [
  { k: 'op', i: 0, label: '操作', sides: [['S', '自分で操作した'], ['M', 'ミーに任せた']] },
  { k: 'check', i: 1, label: '確かめ方', sides: [['C', '掲示や記録で確かめた'], ['G', 'その場の案内で進んだ']] },
  { k: 'range', i: 2, label: '調べ方', sides: [['W', '広く見て回った'], ['D', '一つを深く追った']] }
];
// 行動の記録のまとまり（画面と PDF で同じ並び）。先頭の値が「自分で・確かめた」側。
export const ACT_GROUPS = [
  { label: 'ミーへの任せ方', keys: ['keypad', 'panel', 'admin', 'proxy'] },
  { label: '情報の確かめ方', keys: ['askSource', 'askWhen', 'map', 'site', 'scam'] },
  { label: '動く前の備えと連絡', keys: ['doorStop', 'sos'] }
];
const VAL_ORDER = { keypad: ['self', 'mi'], panel: ['self', 'mi'], admin: ['self', 'mi'], scam: ['checked', 'ignored', 'replied', 'leaked'] };
const valsOf = a => (VAL_ORDER[a.k] || ['1', '0']).map(v => [v, a.vals[v]]);

// 行動と結末の重なりで選べる項目
export const DIMS = [
  ...AXES.map(a => ({ id: 'ax:' + a.k, label: `タイプの観点：${a.label}`, vals: a.sides, get: s => s.type?.[a.i] })),
  ...ACTS.map(a => ({ id: 'act:' + a.k, label: a.label, vals: valsOf(a), get: s => (s.acts && a.k in s.acts ? String(s.acts[a.k]) : undefined) }))
];

export const REFLECT_SHEET_QS = [
  REFLECT_QS[0][1], REFLECT_QS[1][1],
  '任せてよかった場面と、自分でしたほうがよかった場面を、一つずつ挙げてください。',
  'ふだん使っているアプリで、ミーと同じように任せていることは何ですか。'
];
export const TEACH_QS = [
  'ミーに任せた場面を一つ選んでください。なぜ任せましたか。そのとき、何か確かめましたか。',
  'ミーの言葉と、掲示や記録が食い違った場面はどこでしたか。どちらを信じて、何で決めましたか。',
  '任せてよかった場面と、自分でしたほうがよかった場面を、一つずつ挙げてください。',
  'ふだん使っているアプリで、ミーと同じように任せていることは何ですか。'
];

export const pct = (m, n) => (n ? Math.round((m / n) * 100) : 0);
export const pad2 = n => String(n).padStart(2, '0');
export const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const dayLabel = key => { const [y, m, d] = key.split('-').map(Number); return `${y}年${m}月${d}日`; };
export const stamp = ms => { if (!ms) return '—'; const d = new Date(ms); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${pad2(d.getMinutes())}`; };
export const shortStamp = ms => { if (!ms) return '—'; const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${pad2(d.getMinutes())}`; };
export const isCurrent = s => s.v?.quiz === VERSIONS.quiz && s.v?.judge === VERSIONS.judge;
export const endingName = id => (ENDINGS[id] ? `${ENDINGS[id][0]}「${ENDINGS[id][1]}」` : '記録なし');
export const typeName = k => TYPES[k]?.name || k || '—';
export const q1Opts = Q1.opts;
export const q1Text = v => (Q1.opts.find(o => o[0] === v) || [, ''])[1];
export const Q1_TEXT = Q1.q;

// セッション全体から1回だけ作るもの（表示名の言い換えと、参加した日の候補）
export function prepare(raw) {
  const subs = raw.subs || [];
  const members = Array.isArray(raw.members) ? raw.members : null;
  const joinAt = new Map((members || []).map(m => [m.id, m.at || 0]));
  const sessionDay = s => dayKey(joinAt.get(s.id) || s.at || 0);
  const order = [...subs].sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id)));
  const alias = new Map(order.map((s, i) => [s.id, `参加者 ${pad2(i + 1)}`]));
  const days = [...new Set([...(members || []).filter(m => m.at).map(m => dayKey(m.at)), ...subs.filter(s => s.at && !joinAt.has(s.id)).map(s => dayKey(s.at))])].sort();
  return { ...raw, subs, members, order, alias, days, sessionDay, lastAt: Math.max(0, ...subs.map(s => s.at || 0)) };
}

export function condText(P, cond) {
  const d = cond.day === 'all' ? (P.days.length > 1 ? 'すべての参加日' : P.days.length ? dayLabel(P.days[0]) : 'すべての参加日') : dayLabel(cond.day);
  const e = END_FILTERS.find(x => x[0] === cond.end)?.[1] || 'すべての結末';
  return `参加した日：${d}　結末：${e}　バージョン：問い ${VERSIONS.quiz}・判定 ${VERSIONS.judge}`;
}

export function compute(P, cond) {
  const inDay = ms => cond.day === 'all' || dayKey(ms) === cond.day;
  const subInDay = s => cond.day === 'all' || P.sessionDay(s) === cond.day;
  const endOk = s => cond.end === 'all' || (cond.end === 'clear' ? ['true', 'secret'].includes(groupOf(s.ending)) : groupOf(s.ending) === 'bad');
  const daySubs = P.subs.filter(subInDay);
  const curDay = daySubs.filter(isCurrent);
  const rows = curDay.filter(endOk);
  const oldN = daySubs.length - curDay.length;
  const N = rows.length;

  // 参加と提出（参加IDの単位。結末の絞り込みは掛けない）
  let funnel = null;
  if (P.members) {
    const byId = new Map(P.subs.map(s => [s.id, s]));
    const ms = P.members.filter(m => inDay(m.at || 0));
    let cur = 0, old = 0;
    for (const m of ms) { const s = byId.get(m.id); if (s) (isCurrent(s) ? cur++ : old++); }
    funnel = { M: ms.length, cur, old, none: ms.length - cur - old };
  }

  const at = rows.map(s => s.at || 0).filter(Boolean);
  const period = at.length ? [Math.min(...at), Math.max(...at)] : null;

  const endings = ENDING_ORDER.map(id => ({ id, label: endingName(id), kind: ENDINGS[id][0], sub: ENDINGS[id][1], group: groupOf(id), c: rows.filter(s => s.ending === id).length }));
  const groups = GROUPS.map(g => ({ ...g, c: rows.filter(s => g.ids.includes(s.ending)).length }));
  const types = ORDER.map(k => ({ k, name: TYPES[k].name, c: rows.filter(s => s.type === k).length }));
  const thinAny = rows.filter(s => (s.thin || []).length).length;
  const axes = AXES.map(a => ({
    k: a.k, label: a.label,
    sides: a.sides.map(([side, label]) => {
      const on = rows.filter(s => s.type?.[a.i] === side);
      const thin = on.filter(s => (s.thin || []).includes(a.k)).length;
      return { side, label, c: on.length, thin, clear: on.length - thin };
    })
  }));
  const acts = ACT_GROUPS.map(g => ({
    label: g.label,
    items: g.keys.map(k => {
      const a = ACTS.find(x => x.k === k);
      const valid = rows.filter(s => s.acts && k in s.acts);
      return { k, label: a.label, n: valid.length, missing: N - valid.length, vals: valsOf(a).map(([v, label]) => ({ v, label, c: valid.filter(s => String(s.acts[k]) === v).length })) };
    })
  }));
  const safe = { S: 0, B: 0, both: 0, none: 0 };
  for (const s of rows) safe[s.safe?.lean || 'none'] = (safe[s.safe?.lean || 'none'] || 0) + 1;

  const both = rows.filter(s => s.pre && s.post);
  const opts = Q1.opts.map(o => o[0]);
  const pp = {
    B: both.length,
    onlyPre: rows.filter(s => s.pre && !s.post).length, onlyPost: rows.filter(s => !s.pre && s.post).length, neither: rows.filter(s => !s.pre && !s.post).length,
    opts: Q1.opts.map(([v, label]) => ({ v, label, pre: both.filter(s => s.pre === v).length, post: both.filter(s => s.post === v).length })),
    matrix: opts.map(a => opts.map(b => both.filter(s => s.pre === a && s.post === b).length)),
    changed: both.filter(s => s.pre !== s.post).length
  };
  const refl = REFLECT_QS.map(([k, q]) => ({ k, q, c: rows.filter(s => (s[k] || '').trim()).length }));

  const cross = crossOf(rows, cond.cross);

  const clearN = groups[0].c + groups[1].c;
  return {
    cond, condText: condText(P, cond), N, oldN, rows, funnel, period, endings, groups, types, thinAny, axes, acts, safe, pp, refl, cross,
    kpi: {
      members: funnel ? funnel.M : null, submitRate: funnel ? pct(funnel.cur, funnel.M) : null,
      N, clear: clearN, clearRate: pct(clearN, N), changed: pp.changed, B: pp.B, changedRate: pct(pp.changed, pp.B)
    }
  };
}

// 行動（またはタイプの観点）の答えごとの、結末の内訳。画面の「行動と結末の重なり」と PDF の付録で使う
export function crossOf(rows, dimId) {
  const dim = DIMS.find(d => d.id === dimId) || DIMS[0];
  const crossRows = dim.vals.map(([v, label]) => {
    const on = rows.filter(s => dim.get(s) === v);
    return { v, label, n: on.length, g: Object.fromEntries(GROUPS.map(g => [g.k, on.filter(s => g.ids.includes(s.ending)).length])) };
  });
  return { id: dim.id, label: dim.label, rows: crossRows, missing: rows.length - crossRows.reduce((m, r) => m + r.n, 0) };
}
// タイプを件数の多い順に（同じ件数なら決まった順）。画面と PDF で同じ並び
export const typesByCount = st => [...st.types].sort((a, b) => b.c - a.c || ORDER.indexOf(a.k) - ORDER.indexOf(b.k));

// 提出一覧（画面の表・PDF の追加ページ・CSV で同じ並び）
export function tableRows(P, st, hide) {
  return st.rows.map(s => ({
    id: s.id, at: s.at || 0,
    name: hide ? P.alias.get(s.id) : (s.label || P.alias.get(s.id)), alias: P.alias.get(s.id),
    type: s.type, typeName: typeName(s.type), ending: s.ending, endingKind: ENDINGS[s.ending]?.[0] || '', endingName: endingName(s.ending), group: groupOf(s.ending),
    pre: s.pre || '', post: s.post || '', r1: (s.r1 || '').trim(), r2: (s.r2 || '').trim(), thin: s.thin || [], acts: s.acts || {}, safe: s.safe?.lean || '', game: s.v?.game || ''
  }));
}
