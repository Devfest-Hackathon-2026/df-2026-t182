// 送信データの契約テスト（Firestore Emulator 専用、demo- プロジェクト）。
// ゲームが class-data.js の buildSubmission() ＋ fb.js の submit() で作る文書そのものが firestore.rules に受け付けられること、
// クライアントが正当に作りうる変化形（回答なし、すべての行動、すべての結末・タイプ）も受け付けられることを確かめる。
// 実行：tools/ci/run.sh rules（既存のルールテストと一緒に動く）
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, setLogLevel } from 'firebase/firestore';
import { buildSubmission, ACTS, ENDINGS } from '../../class-data.js';
import { ORDER } from '../../report.js';
setLogLevel('silent');

const env = await initializeTestEnvironment({
  projectId: 'demo-mi-rules',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
});
const CODE = 'CNT234', PID = 'c0c0c0c0c0c0c0c0c0c0', UID = 'student1';
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'classes', CODE), { ownerUid: 'teacher1', createdAt: serverTimestamp() });
  await setDoc(doc(db, 'pub', CODE), { title: '契約テスト', guide: '', joinOpen: true, submitOpen: true });
  await setDoc(doc(db, 'classes', CODE, 'members', PID), { uid: UID, at: serverTimestamp() });
});
const db = env.authenticatedContext(UID, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
// fb.js の submit() と同じ形で書き込む
const send = data => setDoc(doc(db, 'classes', CODE, 'subs', PID), { ...data, uid: UID, at: serverTimestamp() });
const everyAct = Object.fromEntries(ACTS.map(a => [a.k, /^\d+$/.test(Object.keys(a.vals)[0]) ? Number(Object.keys(a.vals)[0]) : Object.keys(a.vals)[0]]));
const night = (extra = {}) => ({
  type: ORDER[0], thin: ['op'], ev: [{ axis: 'op', text: '番号錠は自分で入れた' }], safe: { lean: 'S', text: '足元を照らした' },
  acts: everyAct, ending: 'true', old: false, judge: 1, ...extra
});

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  NG  ', name, '\n       ', e.message.split('\n')[0]); } }

console.log('クライアントが作る提出とルールの一致');
await t('buildSubmission() の標準的な提出が通る', () => assertSucceeds(send(buildSubmission({ pid: PID, label: '12', night: night(), pre: 'b', post: 'c', r1: '自分で確かめた', r2: '' }))));
await t('前後の回答・振り返りなしでも通る', () => assertSucceeds(send(buildSubmission({ pid: PID, label: 'A', night: night({ acts: {}, thin: [], ev: [], safe: { lean: '', text: '' } }) }))));
await t('長すぎる入力は buildSubmission() が切り詰めて通る', () => assertSucceeds(send(buildSubmission({ pid: PID, label: 'x'.repeat(50), night: night(), r1: 'あ'.repeat(500), r2: 'い'.repeat(500) }))));
for (const ending of Object.keys(ENDINGS)) await t(`結末 ${ending} が通る`, () => assertSucceeds(send(buildSubmission({ pid: PID, label: '1', night: night({ ending }) }))));
for (const type of ORDER) await t(`タイプ ${type} が通る`, () => assertSucceeds(send(buildSubmission({ pid: PID, label: '1', night: night({ type }) }))));
for (const a of ACTS) for (const v of Object.keys(a.vals)) {
  const val = /^\d+$/.test(v) ? Number(v) : v;
  await t(`行動 ${a.k}=${v} が通る`, () => assertSucceeds(send(buildSubmission({ pid: PID, label: '1', night: night({ acts: { [a.k]: val } }) }))));
}
await t('（対照）ルールにない項目を足すと拒否される', () => assertFails(send({ ...buildSubmission({ pid: PID, label: '1', night: night() }), extra: 1 })));

await env.cleanup();
console.log(`\n${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
