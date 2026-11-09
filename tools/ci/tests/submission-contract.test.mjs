// クライアント（class-data.js の buildSubmission ＋ fb.js の submit）と firestore.rules の validSub() の「契約」テスト。
// 片方だけで項目・結末・タイプ・行動を追加・改名すると、本番で参加者の提出がルールに拒否される。
// ここではそれを静的に（ファイルを読み比べて）検出する。Emulator のテスト（tools/rules-test/contract.mjs）で、
// 実際に buildSubmission() が作る文書がルールに受け付けられることも確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSubmission, ACTS, ENDINGS, LABEL_MAX, REFLECT_MAX, Q1 } from '../../../class-data.js';
import { TYPES, ORDER } from '../../../report.js';

const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
const fbjs = readFileSync(new URL('../../../fb.js', import.meta.url), 'utf8');
const validSub = rules.slice(rules.indexOf('function validSub'), rules.indexOf('function canSubmit'));
const actsOk = rules.slice(rules.indexOf('function actsOk'), rules.indexOf('function validSub'));
const list = s => [...s.matchAll(/'([^']*)'/g)].map(m => m[1]);
const sorted = a => [...a].sort();

const night = { type: ORDER[0], thin: [], ev: [], safe: { lean: '', text: '' }, acts: {}, ending: 'true', old: false, judge: 1 };
const doc = buildSubmission({ pid: 'p'.repeat(20), label: '01', night, pre: 'a', post: 'c', r1: '', r2: '' });

test('ルールが受け付ける項目と、クライアントが送る項目が完全に一致する', () => {
  const m = validSub.match(/exact\(d,\s*\[([^\]]*)\]\)/);
  assert.ok(m, 'validSub が exact(d, [...]) で項目を限定している');
  // fb.js の submit() は、buildSubmission() の文書に uid とサーバー時刻を足して送る
  assert.match(fbjs, /\{\s*\.\.\.data,\s*uid,\s*at:\s*FS\.serverTimestamp\(\)\s*\}/);
  assert.deepEqual(sorted(list(m[1])), sorted([...Object.keys(doc), 'uid', 'at']));
  assert.deepEqual(sorted(list(validSub.match(/exact\(d\.v,\s*\[([^\]]*)\]\)/)[1])), sorted(Object.keys(doc.v)));
});

test('文字数の上限（番号・表示名、振り返り）が一致する', () => {
  assert.match(validSub, new RegExp(`str\\(d\\.label,\\s*1,\\s*${LABEL_MAX}\\)`));
  assert.match(validSub, new RegExp(`str\\(d\\.r1,\\s*0,\\s*${REFLECT_MAX}\\)`));
  assert.match(validSub, new RegExp(`str\\(d\\.r2,\\s*0,\\s*${REFLECT_MAX}\\)`));
});

test('結末・タイプ・問いの選択肢の一覧が一致する', () => {
  assert.deepEqual(sorted(list(validSub.match(/d\.ending in \[([^\]]*)\]/)[1])), sorted(Object.keys(ENDINGS)));
  assert.deepEqual(sorted(list(validSub.match(/d\.type in \[([^\]]*)\]/)[1])), sorted(ORDER));
  assert.deepEqual(sorted(ORDER), sorted(Object.keys(TYPES)));
  assert.deepEqual(sorted(list(validSub.match(/d\.pre in \[([^\]]*)\]/)[1])), sorted(['', ...Q1.opts.map(o => o[0])]));
});

test('行動の項目と、それぞれの値の一覧が一致する', () => {
  assert.deepEqual(sorted(list(actsOk.match(/hasOnly\(\[([^\]]*)\]\)/)[1])), sorted(ACTS.map(a => a.k)));
  for (const a of ACTS) {
    const vals = Object.keys(a.vals);
    const enumRule = actsOk.match(new RegExp(`a\\.${a.k} in \\[([^\\]]*)\\]`));
    if (enumRule) assert.deepEqual(sorted(list(enumRule[1])), sorted(vals), a.k);
    else {
      assert.match(actsOk, new RegExp(`bin\\(a, '${a.k}'\\)`), `行動 ${a.k} をルールが検査している`);
      assert.deepEqual(sorted(vals), ['0', '1'], `行動 ${a.k} は 0/1 の値をとる`);
    }
  }
});

test('buildSubmission() が自由記述の前後の空白を除き、上限の文字数で切る', () => {
  const d = buildSubmission({ pid: 'x', label: '  ' + 'あ'.repeat(LABEL_MAX + 5) + ' ', night, r1: 'い'.repeat(REFLECT_MAX + 1), r2: null });
  assert.equal(d.label.length, LABEL_MAX);
  assert.equal(d.r1.length, REFLECT_MAX);
  assert.equal(d.r2, '');
  assert.equal(d.pre, '');
});
