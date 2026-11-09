// firestore.rules のテスト（Firestore エミュレーター上）。
// 実行：cd tools/rules-test && JAVA_HOME=… firebase emulators:exec --only firestore --project demo-mi-rules --config ../../firebase.json "node test.mjs"
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, serverTimestamp, Timestamp, setLogLevel } from 'firebase/firestore';
setLogLevel('silent');

const env = await initializeTestEnvironment({
  projectId: 'demo-mi-rules',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
});
const G = { firebase: { sign_in_provider: 'google.com' } }, AN = { firebase: { sign_in_provider: 'anonymous' } };
const teacherA = env.authenticatedContext('tA', G).firestore();
const teacherB = env.authenticatedContext('tB', G).firestore();
const s1 = env.authenticatedContext('s1', AN).firestore();
const s2 = env.authenticatedContext('s2', AN).firestore();
const s3 = env.authenticatedContext('s3', AN).firestore();
const nobody = env.unauthenticatedContext().firestore();

const CODE = 'ABC234', P1 = 'p1p1p1p1p1p1p1p1p1p1', P2 = 'p2p2p2p2p2p2p2p2p2p2', P3 = 'p3p3p3p3p3p3p3p3p3p3';
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  NG  ', name, '\n       ', e.message.split('\n')[0]); } }
const sub = (uid, pid, extra = {}) => ({
  uid, pid, label: '12', type: 'SCW', thin: ['check'], ev: [{ axis: 'op', text: '点検通路の番号錠で、最初から自分で番号を入れた' }], safe: { lean: 'S', text: '非常階段で、足元を照らしてから確かめた' },
  acts: { keypad: 'self', askSource: 1, doorStop: 0, scam: 'checked' }, pre: 'b', post: 'c', r1: '番号錠は自分で入れた。', r2: '', ending: 'true', old: false,
  v: { game: '2026.11.09', quiz: 'q1b', judge: 1 }, at: serverTimestamp(), ...extra
});
function createClass(db, code, uid, title = '情報リテラシー 第5回') {
  const b = writeBatch(db);
  b.set(doc(db, 'classes', code), { ownerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, 'pub', code), { title, guide: '遊び終わったら結果を送ってください。', joinOpen: true, submitOpen: true });
  return b.commit();
}

console.log('授業の作成');
await t('匿名の学生は授業を作れない', () => assertFails(createClass(s1, 'XYZ234', 's1')));
await t('他人の uid を持ち主にして作れない', () => assertFails(createClass(teacherA, 'XYZ235', 'tB')));
await t('形式の違うコードでは作れない', () => assertFails(createClass(teacherA, 'abc-12', 'tA')));
await t('先生Aが授業を作れる', () => assertSucceeds(createClass(teacherA, CODE, 'tA')));
await t('先生Bは同じコードで作り直せない（上書き不可）', () => assertFails(createClass(teacherB, CODE, 'tB')));
await t('授業名41文字は拒否', () => assertFails(createClass(teacherA, 'LMN234', 'tA', 'あ'.repeat(41))));

console.log('参加コードと公開情報');
await t('ログインなしで参加コードの公開情報を get できる', () => assertSucceeds(getDoc(doc(nobody, 'pub', CODE))));
await t('公開情報の一覧（list）は取れない', () => assertFails(getDocs(collection(nobody, 'pub'))));
await t('学生は公開情報（受付状態）を変えられない', () => assertFails(updateDoc(doc(s1, 'pub', CODE), { joinOpen: false })));
await t('先生Bは先生Aの授業の受付を変えられない', () => assertFails(updateDoc(doc(teacherB, 'pub', CODE), { submitOpen: false })));
await t('学生は授業の持ち主を読めない', () => assertFails(getDoc(doc(s1, 'classes', CODE))));
await t('学生は授業の持ち主を書き換えられない', () => assertFails(setDoc(doc(s1, 'classes', CODE), { ownerUid: 's1', createdAt: serverTimestamp() })));
await t('先生Bは先生Aの授業を読めない', () => assertFails(getDoc(doc(teacherB, 'classes', CODE))));
await t('先生Aは自分の授業一覧を取れる', () => assertSucceeds(getDocs(query(collection(teacherA, 'classes'), where('ownerUid', '==', 'tA')))));
await t('条件なしで授業一覧は取れない', () => assertFails(getDocs(collection(teacherA, 'classes'))));
await t('先生Bが先生Aの uid で一覧を取ろうとしても取れない', () => assertFails(getDocs(query(collection(teacherB, 'classes'), where('ownerUid', '==', 'tA')))));

console.log('参加');
await t('学生1が参加できる（uid と時刻だけ）', () => assertSucceeds(setDoc(doc(s1, 'classes', CODE, 'members', P1), { uid: 's1', at: serverTimestamp() })));
await t('参加の記録に番号・表示名などを足すと拒否', () => assertFails(setDoc(doc(s2, 'classes', CODE, 'members', P2), { uid: 's2', at: serverTimestamp(), label: '3' })));
await t('他人の uid で参加の記録を作れない', () => assertFails(setDoc(doc(s2, 'classes', CODE, 'members', P2), { uid: 's1', at: serverTimestamp() })));
await t('参加の記録は書き換えられない', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'members', P1), { uid: 's1', at: serverTimestamp() })));
await t('学生2も参加できる', () => assertSucceeds(setDoc(doc(s2, 'classes', CODE, 'members', P2), { uid: 's2', at: serverTimestamp() })));
await t('学生2は学生1の参加の記録を読めない', () => assertFails(getDoc(doc(s2, 'classes', CODE, 'members', P1))));
await t('学生は参加の一覧を取れない', () => assertFails(getDocs(collection(s1, 'classes', CODE, 'members'))));

console.log('提出');
await t('学生1が提出できる', () => assertSucceeds(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1))));
await t('同じ参加者IDで再送しても1件（置き換え）', async () => { await assertSucceeds(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { r2: '直した' }))); let n = -1; await env.withSecurityRulesDisabled(async c => { n = (await getDocs(collection(c.firestore(), 'classes', CODE, 'subs'))).size; }); if (n !== 1) throw new Error('件数 ' + n); });
await t('知らない項目（主人公名）を足すと拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { name: 'ゆう' }))));
await t('項目が欠けると拒否', () => { const d = sub('s1', P1); delete d.r2; return assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), d)); });
await t('番号・表示名21文字は拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { label: 'あ'.repeat(21) }))));
await t('番号・表示名が空は拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { label: '' }))));
await t('振り返り301文字は拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { r1: 'あ'.repeat(301) }))));
await t('振り返り300文字は通る', () => assertSucceeds(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { r1: 'あ'.repeat(300) }))));
await t('存在しないタイプは拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { type: 'XXX' }))));
await t('行動の値の型が違うと拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { acts: { askSource: 'yes' } }))));
await t('行動の知らない項目は拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { acts: { said: 1 } }))));
await t('根拠の行動4件は拒否', () => { const e = { axis: 'op', text: 'x' }; return assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { ev: [e, e, e, e] }))); });
await t('送信時刻を端末の時刻にすると拒否', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1, { at: Timestamp.fromMillis(Date.now()) }))));
await t('uid を他人にして送れない', () => assertFails(setDoc(doc(s2, 'classes', CODE, 'subs', P2), sub('s1', P2))));
await t('参加していない参加者IDでは送れない', () => assertFails(setDoc(doc(s3, 'classes', CODE, 'subs', P3), sub('s3', P3))));
await t('学生2は学生1の参加者IDで送れない（上書き不可）', () => assertFails(setDoc(doc(s2, 'classes', CODE, 'subs', P1), sub('s2', P1))));
await t('学生2も自分の参加者IDで送れる', () => assertSucceeds(setDoc(doc(s2, 'classes', CODE, 'subs', P2), sub('s2', P2, { type: 'MGD' }))));

console.log('読む（■10-9）');
await t('学生1は自分の提出を読める', () => assertSucceeds(getDoc(doc(s1, 'classes', CODE, 'subs', P1))));
await t('学生2は学生1の提出を読めない', () => assertFails(getDoc(doc(s2, 'classes', CODE, 'subs', P1))));
await t('学生は提出一覧を取れない', () => assertFails(getDocs(collection(s1, 'classes', CODE, 'subs'))));
await t('ログインなしでは提出を読めない', () => assertFails(getDoc(doc(nobody, 'classes', CODE, 'subs', P1))));
await t('参加コードを知っていても、ログインなしで提出一覧は取れない', () => assertFails(getDocs(collection(nobody, 'classes', CODE, 'subs'))));
await t('先生Bは先生Aの授業の提出一覧を取れない', () => assertFails(getDocs(collection(teacherB, 'classes', CODE, 'subs'))));
await t('先生Bは先生Aの授業の提出を1件も読めない', () => assertFails(getDoc(doc(teacherB, 'classes', CODE, 'subs', P1))));
await t('先生Bは先生Aの授業の提出を消せない', () => assertFails(deleteDoc(doc(teacherB, 'classes', CODE, 'subs', P1))));
await t('学生2は学生1の提出を消せない', () => assertFails(deleteDoc(doc(s2, 'classes', CODE, 'subs', P1))));
await t('先生Aは自分の授業の提出一覧を取れる', async () => { const s = await assertSucceeds(getDocs(collection(teacherA, 'classes', CODE, 'subs'))); if (s.size !== 2) throw new Error('件数 ' + s.size); });
await t('先生Bが Google 以外（匿名）で先生Aの uid を名乗っても読めない', () => assertFails(getDocs(collection(env.authenticatedContext('tA', AN).firestore(), 'classes', CODE, 'subs'))));

console.log('受付の終了・削除（■10-8）');
await t('先生Aが参加受付を終了できる', () => assertSucceeds(updateDoc(doc(teacherA, 'pub', CODE), { joinOpen: false })));
await t('参加受付の終了後は新しく参加できない', () => assertFails(setDoc(doc(s3, 'classes', CODE, 'members', P3), { uid: 's3', at: serverTimestamp() })));
await t('参加受付の終了後も、参加済みの学生1は提出できる', () => assertSucceeds(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1))));
await t('公開情報に知らない項目を足せない', () => assertFails(updateDoc(doc(teacherA, 'pub', CODE), { ownerUid: 'tA' })));
await t('先生Aが提出受付を終了できる', () => assertSucceeds(updateDoc(doc(teacherA, 'pub', CODE), { submitOpen: false })));
await t('提出受付の終了後は送れない', () => assertFails(setDoc(doc(s1, 'classes', CODE, 'subs', P1), sub('s1', P1))));
await t('提出受付の終了後も、自分の提出は読める', () => assertSucceeds(getDoc(doc(s1, 'classes', CODE, 'subs', P1))));
await t('学生1は自分の提出を削除できる', () => assertSucceeds(deleteDoc(doc(s1, 'classes', CODE, 'subs', P1))));
await t('先生Aは提出を1件ずつ削除できる', () => assertSucceeds(deleteDoc(doc(teacherA, 'classes', CODE, 'subs', P2))));
await t('学生は授業を削除できない', () => assertFails(deleteDoc(doc(s1, 'classes', CODE))));
await t('先生Bは先生Aの授業を削除できない', () => assertFails(deleteDoc(doc(teacherB, 'pub', CODE))));
await t('先生Aは参加の記録→公開情報と授業の順に削除できる', async () => {
  const m = await getDocs(collection(teacherA, 'classes', CODE, 'members')); const b = writeBatch(teacherA); m.forEach(x => b.delete(x.ref)); await assertSucceeds(b.commit());
  const b2 = writeBatch(teacherA); b2.delete(doc(teacherA, 'pub', CODE)); b2.delete(doc(teacherA, 'classes', CODE)); await assertSucceeds(b2.commit());
  let left = true; await env.withSecurityRulesDisabled(async c => { left = (await getDoc(doc(c.firestore(), 'pub', CODE))).exists(); }); if (left) throw new Error('残っている');
});

await env.cleanup();
console.log(`\n${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
