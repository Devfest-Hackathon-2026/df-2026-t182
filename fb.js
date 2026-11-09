// Firebase（授業機能を使うときだけ読み込む）。トップページを開いただけでは、このファイルは読まれない。
// 使うのは Authentication（学生は匿名、先生は Google）と Cloud Firestore（Lite）だけ。
import { FIREBASE_CONFIG, EMULATOR } from './firebase-config.js';
const V = new URL('./assets/vendor/firebase-13.1.0/', import.meta.url).href;
const [{ initializeApp }, AU, FS] = await Promise.all([import(V + 'firebase-app.js'), import(V + 'firebase-auth.js'), import(V + 'firebase-firestore-lite.js')]);

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
let live = false; try { if (new URLSearchParams(location.search).get('fb') === 'live') sessionStorage.setItem('mi-fb-live', '1'); live = sessionStorage.getItem('mi-fb-live') === '1'; } catch {}
export const usingEmulator = local && !live;
const app = initializeApp(FIREBASE_CONFIG);
export const auth = AU.getAuth(app);
export const db = FS.getFirestore(app);
if (usingEmulator) { AU.connectAuthEmulator(auth, EMULATOR.auth, { disableWarnings: true }); FS.connectFirestoreEmulator(db, EMULATOR.firestoreHost, EMULATOR.firestorePort); }
export { FS, AU };

const d = (...p) => FS.doc(db, ...p);
// 通信やルールの失敗を、画面に出す言葉の種類に分ける
export function kind(e) { const c = String(e?.code || e?.message || ''); if (/permission-denied|PERMISSION_DENIED/.test(c)) return 'denied'; if (/not-found/.test(c)) return 'missing'; if (/unavailable|network|offline|failed-precondition|deadline/.test(c)) return 'network'; return 'other'; }

// ───────── 学生（匿名） ─────────
export async function anon() { await auth.authStateReady(); if (!auth.currentUser) await AU.signInAnonymously(auth); return auth.currentUser.uid; }
// 参加コードから引く公開の情報（授業名・案内・受付状態）。ログイン不要。無ければ null。
export async function getPub(code) { const s = await FS.getDoc(d('pub', code)); return s.exists() ? s.data() : null; }
// 参加：uid と時刻だけを残す（番号・表示名も進行も送らない）。同じ参加者IDで二度押しても1件。
export async function join(code, pid) {
  const uid = await anon(); const ref = d('classes', code, 'members', pid);
  try { await FS.setDoc(ref, { uid, at: FS.serverTimestamp() }); }
  catch (e) { const s = await FS.getDoc(ref).catch(() => null); if (!(s && s.exists() && s.data().uid === uid)) throw e; }
  return uid;
}
// 提出：ドキュメントIDが参加者IDなので、何度送っても1件（前の結果と置き換わる）
export async function submit(code, pid, data) { const uid = await anon(); await FS.setDoc(d('classes', code, 'subs', pid), { ...data, uid, at: FS.serverTimestamp() }); const s = await FS.getDoc(d('classes', code, 'subs', pid)); return s.data(); }
export async function mySub(code, pid) { await anon(); const s = await FS.getDoc(d('classes', code, 'subs', pid)); return s.exists() ? s.data() : null; }
export async function unsubmit(code, pid) { await anon(); await FS.deleteDoc(d('classes', code, 'subs', pid)); }

// ───────── 先生（Google） ─────────
export async function teacher() { await auth.authStateReady(); const u = auth.currentUser; return u && !u.isAnonymous ? u : null; }
export async function signInGoogle() {
  const p = new AU.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  try { return (await AU.signInWithPopup(auth, p)).user; }
  catch (e) { if (/popup-blocked|operation-not-supported/.test(e?.code || '')) { await AU.signInWithRedirect(auth, p); return null; } throw e; }
}
export const signOut = () => AU.signOut(auth);
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { const r = new Uint8Array(6); crypto.getRandomValues(r); return [...r].map(n => CODE_ABC[n % CODE_ABC.length]).join(''); }
export async function createClass(title, guide) {
  const u = await teacher(); if (!u) throw new Error('not-signed-in');
  for (let i = 0; i < 6; i++) {
    const code = newCode(); if (await getPub(code)) continue;
    const b = FS.writeBatch(db);
    b.set(d('classes', code), { ownerUid: u.uid, createdAt: FS.serverTimestamp() });
    b.set(d('pub', code), { title, guide, joinOpen: true, submitOpen: true });
    await b.commit(); return code;
  }
  throw new Error('code-busy');
}
export async function myClasses() {
  const u = await teacher(); if (!u) return [];
  const q = FS.query(FS.collection(db, 'classes'), FS.where('ownerUid', '==', u.uid));
  const snap = await FS.getDocs(q);
  const list = await Promise.all(snap.docs.map(async s => ({ code: s.id, createdAt: s.data().createdAt?.toMillis?.() || 0, ...(await getPub(s.id) || { title: '（授業名なし）', guide: '', joinOpen: false, submitOpen: false }) })));
  return list.sort((a, b) => b.createdAt - a.createdAt);
}
export async function setPub(code, patch) { await FS.updateDoc(d('pub', code), patch); }
export async function subsOf(code) { const s = await FS.getDocs(FS.collection(db, 'classes', code, 'subs')); return s.docs.map(x => ({ id: x.id, ...x.data(), at: x.data().at?.toMillis?.() || 0 })); }
export async function deleteSub(code, pid) { await FS.deleteDoc(d('classes', code, 'subs', pid)); }
// 授業と提出データの削除（先生本人の確認のあと）：提出 → 参加の記録 → 公開情報と授業の順に消す
export async function deleteClass(code) {
  for (const sub of ['subs', 'members']) {
    const s = await FS.getDocs(FS.collection(db, 'classes', code, sub));
    for (let i = 0; i < s.docs.length; i += 400) { const b = FS.writeBatch(db); for (const x of s.docs.slice(i, i + 400)) b.delete(x.ref); await b.commit(); }
  }
  const b = FS.writeBatch(db); b.delete(d('pub', code)); b.delete(d('classes', code)); await b.commit();
}
