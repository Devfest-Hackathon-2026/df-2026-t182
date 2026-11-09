// 主催者画面の集計（teach/stats.js）の回帰テスト。画面・PDF・CSV がこの数値を共有するため、数え間違いは全部に波及する。
// 同梱の架空のサンプル授業（teach/sample.json）だけを使う。通信も DOM も使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../../../teach/stats.js';
import { VERSIONS, ENDINGS, Q1 } from '../../../class-data.js';

const sample = JSON.parse(readFileSync(new URL('../../../teach/sample.json', import.meta.url), 'utf8'));
const ALL = { day: 'all', end: 'all', cross: S.DIMS[0].id };
const sum = a => a.reduce((n, x) => n + x, 0);

test('サンプル授業は架空のデータで、提出ごとに参加の記録がある', () => {
  assert.equal(sample.sample, true);
  assert.ok(sample.subs.length > 0 && sample.members.length >= sample.subs.length);
  const ids = new Set(sample.members.map(m => m.id));
  for (const s of sample.subs) assert.ok(ids.has(s.id), `提出 ${s.id} に参加の記録がある`);
});

test('サンプル授業で、compute() の各合計が互いに矛盾しない', () => {
  const st = S.compute(S.prepare(sample), ALL);
  const current = sample.subs.filter(S.isCurrent);
  assert.equal(st.N, current.length);
  assert.equal(st.oldN, sample.subs.length - current.length);
  assert.deepEqual(st.funnel, { M: sample.members.length, cur: current.length, old: st.oldN, none: sample.members.length - sample.subs.length });
  assert.equal(sum(st.endings.map(e => e.c)), st.N, 'すべての提出に結末がちょうど1つある');
  assert.equal(sum(st.groups.map(g => g.c)), st.N, '結末のグループ（TRUE・SECRET・BAD）で提出を漏れなく分けられる');
  assert.equal(sum(st.types.map(t => t.c)), st.N, 'すべての提出が8タイプのどれかに入る');
  for (const a of st.axes) assert.equal(sum(a.sides.map(s => s.c)), st.N, `観点 ${a.k} で全提出が二分される`);
  assert.equal(sum(st.pp.matrix.flat()), st.pp.B, 'プレイ前後の回答表が、両方に答えた全員を数えている');
  assert.equal(st.pp.B + st.pp.onlyPre + st.pp.onlyPost + st.pp.neither, st.N);
  assert.equal(st.kpi.clear, st.groups.find(g => g.k === 'true').c + st.groups.find(g => g.k === 'secret').c);
  assert.equal(st.kpi.submitRate, S.pct(current.length, sample.members.length));
  assert.equal(st.cross.missing + sum(st.cross.rows.map(r => r.n)), st.N);
});

test('結末ごとの件数が、元データを直接数えた件数と一致する', () => {
  const st = S.compute(S.prepare(sample), ALL);
  for (const e of st.endings) assert.equal(e.c, sample.subs.filter(s => S.isCurrent(s) && s.ending === e.id).length, e.id);
  assert.deepEqual(new Set(S.ENDING_ORDER), new Set(Object.keys(ENDINGS)), 'class-data.js で定義したすべての結末が集計対象になっている');
});

test('結末の絞り込み（クリア／BAD）で提出を漏れなく分けられる', () => {
  const P = S.prepare(sample);
  const clear = S.compute(P, { ...ALL, end: 'clear' }).N, bad = S.compute(P, { ...ALL, end: 'bad' }).N;
  assert.equal(clear + bad, S.compute(P, ALL).N);
});

test('問い・判定の版が古い提出は、件数には数えるが分布の集計からは外す', () => {
  const old = { ...sample.subs[0], id: 'old0000000000000001', v: { ...sample.subs[0].v, quiz: 'q0' } };
  const raw = { ...sample, subs: [...sample.subs, old], members: [...sample.members, { id: old.id, at: sample.members[0].at }] };
  const before = S.compute(S.prepare(sample), ALL), after = S.compute(S.prepare(raw), ALL);
  assert.equal(after.N, before.N);
  assert.equal(after.oldN, before.oldN + 1);
  assert.equal(after.funnel.old, before.funnel.old + 1);
  assert.equal(S.isCurrent({ v: { quiz: VERSIONS.quiz, judge: VERSIONS.judge } }), true);
});

test('「参加者 01」形式の仮名は提出順で、名前を隠す設定では番号・表示名を出さない', () => {
  const P = S.prepare(sample), st = S.compute(P, ALL);
  const rows = S.tableRows(P, st, true);
  assert.equal(rows.length, st.N);
  assert.ok(rows.every(r => /^参加者 \d{2}$/.test(r.name)), '名前を隠す設定で、番号・表示名が表示されない');
  assert.equal(new Set(rows.map(r => r.alias)).size, rows.length, '仮名が重複しない');
});

test('補助関数（割合・結末の分類・日付の表示など）', () => {
  assert.equal(S.pct(1, 3), 33);
  assert.equal(S.pct(5, 0), 0);
  assert.equal(S.groupOf('trueSos'), 'true');
  assert.equal(S.groupOf('be3'), 'bad');
  assert.equal(S.groupOf('nope'), '');
  assert.equal(S.dayLabel('2026-11-09'), '2026年11月9日');
  assert.equal(S.q1Text('c'), Q1.opts.find(o => o[0] === 'c')[1]);
  assert.equal(S.stamp(0), '—');
});

test('提出が0件の授業でもエラーにならず、0を表示する', () => {
  const st = S.compute(S.prepare({ subs: [], members: [] }), ALL);
  assert.equal(st.N, 0);
  assert.equal(st.kpi.clearRate, 0);
  assert.deepEqual(st.funnel, { M: 0, cur: 0, old: 0, none: 0 });
});
