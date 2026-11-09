// 主催者向け画面のデータの読み込み。fb.js（共通）はそのまま使い、参加の記録（members）だけここで読む。
// どれも firestore.rules の「セッション（classes/{code}）の持ち主だけが読める」範囲。読めた分だけで画面・PDF・CSV を作る。
// members から使うのは、参加IDと参加した時刻だけ（uid は持ち出さない）。
let fbp = null;
export const fb = () => (fbp ||= import('../fb.js'));

export async function membersOf(code) {
  const f = await fb();
  const snap = await f.FS.getDocs(f.FS.collection(f.db, 'classes', code, 'members'));
  return snap.docs.map(x => ({ id: x.id, at: x.data().at?.toMillis?.() || 0 }));
}

// セッションの画面に要るものをまとめて読む。参加の記録が読めなかったときは members: null（参加IDの数を出さない）
export async function loadClass(code) {
  const f = await fb();
  const [pub, subs, members] = await Promise.all([f.getPub(code), f.subsOf(code), membersOf(code).catch(() => null)]);
  if (!pub) throw Object.assign(new Error('missing'), { code: 'not-found' });
  return { cls: { code, ...pub }, subs: subs.map(({ uid, ...s }) => s), members, loadedAt: Date.now() };
}

export async function loadSample() {
  const d = await (await fetch('./sample.json', { cache: 'no-cache' })).json();
  const { subs, members, ...cls } = d;
  return { cls: { ...cls, code: '' }, subs, members: members || null, loadedAt: Date.now(), sample: true };
}
