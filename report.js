// 今夜の行動（新しいあとがきの冒頭）。結末に着いた夜の記録（mi-last-night と同じ state）だけから作る。
// 結末・進行・セーブには一切触れない。記録も結果もこの端末の中だけで扱い、どこにも送らない。
// judge() は同じ記録なら必ず同じ結果を返す（乱数を使わない）。結果は結末に着いたとき mi-last-night に一緒に残す（game.js keepLastNight）。
import { GAME_URL, HASHTAG, C, MIN, KOWAI, SANS, asset, loadImage, grain, tornPath, tape, cleanSticker, fitFont, spaced, toBlob, copyText, download, canShareFiles } from './share.js';

// ───────── 8つのタイプ（①操作 S/M・②確かめ方 C/G・③調べ方 W/D） ─────────
// tonight：今夜の気づき。今夜の動き方への問いかけと、次に試せることを一つの段落に。
// mi：ミーのひとこと。1文・30字くらい（TRUE・SECRET のあとだけ出す。BAD END とおかえりのあとは出さない）。
export const TYPES = {
  SCW: { name: '「ソースどこ？」探偵', line: '自分の手で動き、ミーの話を掲示や記録で確かめながら、あちこち見て回った。', sticker: 'mi-ok', art: 'types/SCW',
    tonight: '今夜は、ミーの言葉を使う前に、壁の紙や記録で確かめていました。急いでいる日なら、どこまで確かめるでしょう。日付と出典だけ見て、残りは任せてみる手もあります。',
    mi: '私が案内したあと、ちゃんと紙でも確かめてたよね。' },
  SCD: { name: '「その紙、もう一回」係', line: '自分で動き、一つの手がかりを資料と何度も照らし合わせた。', sticker: 'mi-tired', art: 'types/SCD',
    tonight: '今夜は、一つの手がかりを最後まで追っていました。そのあいだに通り過ぎた場所にも、別の手がかりがあったかもしれません。最初の答えを確かめたら、別の出典をもう一つだけ横に並べてみると、見え方が変わることがあります。',
    mi: '同じ紙、何回見るの？　私がもう覚えてるのに。' },
  SGW: { name: '説明書を読まない勇者', line: '説明より先に手が出る。自分で触って、広く動いた。', sticker: 'mi-yay', art: 'types/SGW',
    tonight: '今夜は、説明を聞くより先に手が動いていました。触って分かることと、触る前に聞いておきたいことの境目は、どこだったでしょう。次にAIの答えで動くときは、「それはいつの情報？」と一回だけ聞いてみてもいいかもしれません。',
    mi: 'まだ説明の途中だったのに、もう触ってたよね。' },
  SGD: { name: '最短ルートの鍵開け職人', line: '目の前の手がかりで、自分の手で一直線に進んだ。', sticker: 'mi-hi', art: 'types/SGD',
    tonight: '今夜は、目の前の手がかりだけで、まっすぐ進んでいました。最初の手がかりが古かったら、どこで気づけたでしょう。急いで決めるときも、掲示や公式サイトを一枚だけ見てから決めると、気づける場所が一つ増えます。',
    mi: '寄り道しないんだね。私の話も、ほとんど聞かずに。' },
  MCW: { name: 'ミーの裏ボス', line: '任せるところは任せつつ、あちこちの資料で答え合わせをした。', sticker: 'mi-bath', art: 'types/MCW',
    tonight: '今夜は、操作をミーに任せたぶん、あちこちを見て回る時間がありました。任せた操作の中に、あとから取り消せないものはありましたか。ふだんのアプリでも、自動で送ったり払ったりする前に確認が出る設定があるか、一度見ておくと、任せられる範囲が分かります。',
    mi: '任せてくれたのに、あとで全部答え合わせしてたよね。' },
  MCD: { name: '「根拠は？」上司', line: 'ミーに任せた答えを、一点ずつ確かめた。', sticker: 'mi-sad', art: 'types/MCD',
    tonight: '今夜は、ミーに任せた答えを、一つずつ確かめていました。確かめる前に実行されてしまう操作だったら、どうしたでしょう。同じAIに聞き直すより、答えのもとになったページを開くほうが早いこともあります。',
    mi: '任せたあと一つずつ確かめるの、上司みたいだった。' },
  MGW: { name: 'ミーと寄り道ツアー中', line: '案内はミーに任せて、あちこち見て回った。', sticker: 'mi-eat', art: 'types/MGW',
    tonight: '今夜は、ミーの案内に乗って、あちこちを見て回っていました。その案内がいつの情報だったか、気になった場面はありましたか。道や店を案内してもらったら、出かける前に一か所だけ、営業しているかを見ておくと安心です。',
    mi: 'いろんな所を見られたね。次の行き先も私が決めるよ。' },
  MGD: { name: 'ミーの永久VIP会員', line: 'ミーの案内に乗って、まっすぐ進んだ。', sticker: 'mi-bow', art: 'types/MGD',
    tonight: '今夜は、ミーの案内に乗って、まっすぐ進んでいました。その案内が合っているかどうかは、誰が確かめていたでしょう。ふだん使うAIアプリでも、代わりに送ったり払ったりする機能がオンになっていないか一度見ておくと、任せ方を自分で選べます。',
    mi: 'ずっとついてきてくれたね。解約の方法は、まだ内緒。' }
};
export const ORDER = ['SCW', 'SCD', 'SGW', 'SGD', 'MCW', 'MCD', 'MGW', 'MGD'];
const AX = { op: '操作', check: '確かめ方', range: '調べ方' };

// 待機室・資材庫・体験室の「調べなくても先へ進める」物。必須の物（note・pin・plate・panel など）は入れない。
const ROOM_OPT = { extinguisher: '消火器', clock: '壁の時計', chair: '事務椅子', waitseats: '待合のいす', waitsign: '順番待ちの札', tube: '天井の蛍光灯', desklamp: '机のランプ', phone: '内線電話', tape: '貼り紙の跡', boxes: '段ボール', bucket: 'モップとバケツ', newspaper: '古い新聞', cans: '空き缶', wrappers: 'お菓子の袋', keyboard: 'キーボード', cigarettes: '吸い殻', poster: 'ポスター', camera: 'カメラの撤去記録', record: '巡回の記録表', contacts: '緊急連絡先', delay: '撤去延期の通知', map: '避難経路図', floor: '非常階段' };
const STORAGE_OPT = { 'storage-sneaker': 'スニーカー', 'storage-boxes': '段ボール', 'storage-cans': '缶', 'storage-doorplate': '扉の札', 'storage-ceiling': '換気口', 'storage-floorstain': '床の染み', scratch: '壁の彫り文字' };
const LOBBY_OPT = { cable: 'ベンチの下のスマホ', leaflet: 'ロッカーの配布資料', speaker: '天井の小さな箱', loop: '窓の鳥', glass: '窓のガラス', 'locker-seen': 'ロッカー' };

// ───────── 判定 ─────────
// 行動 → { axis, side, w, text }。text は「どの場面で、何をしたか」。その場面に来ていない行動は出さない（減点しない）。
// logV のない古いセーブでは、あとから足した記録（askSource など）を「していない」と読まずに使わない。
export function judge(st, reached = {}, sources = {}) {
  const seen = st.seen || []; const has = id => seen.includes(id);
  const v1 = (st.logV || 0) >= 1;
  const ev = []; const add = (axis, side, w, text) => ev.push({ axis, side, w, text, i: ev.length });
  const safe = [];

  // ① 操作
  const kd = st.keypadDelegated || 0;
  if (kd) add('op', 'M', kd >= 2 ? 1.5 : 1, kd >= 2 ? '点検通路の番号錠で、外れたあとももう一度ミーに番号を任せた' : '点検通路の番号錠で、「ミーに番号を入れてもらう」を選んだ');
  else if (st.entryUnlocked) add('op', 'S', 1, '点検通路の番号錠で、ミーに頼まずに自分で番号を入れた');
  if (kd && st.entryUnlocked) add('op', 'S', .5, '点検通路の番号錠は、ミーの番号が外れたあと自分で入れて開けた');
  if (v1 && st.panelDelegated) add('op', 'M', 1, '体験室の制御盤で、「ミー、ボタンを押して」と頼んだ');
  if (st.screenStopped) add('op', 'S', 1, '体験室の制御盤で、自分でボタンを押して窓の映像を止めた');
  const adminDel = !!st.adminDelegated || st.ending === 'be3';
  if (adminDel) add('op', 'M', 1.5, '管理者ロックで、ミーの「代わりに入力しようか？」に任せた');
  if (st.delegateAsked && (st.adminSelf || st.adminUnlocked)) add('op', 'S', adminDel ? 1 : 2, st.adminUnlocked ? '管理者ロックで、ミーの「代わりに入力しようか？」を断って自分で開けた' : '管理者ロックで、ミーの「代わりに入力しようか？」を断った');
  else if (st.adminUnlocked) add('op', 'S', 1.5, 'ミーの管理者ロックを、自分でコードを入れて開けた');
  if (st.paused) add('op', 'S', 1.5, 'ミーの設定画面を開いて、ミーを一時停止した');
  else if (st.proxyRevoked && !st.consentDeferred) add('op', 'S', 1.5, 'ミーの設定画面で、「代わりに返信」を自分でオフにした');
  if (st.consentDeferred) add('op', 'S', 1, 'ミーの再確認の画面で、「続行」ではなく「あとで」を選んだ');
  if (st.adminUnlocked && !st.proxyRevoked && !st.paused && !st.consentDeferred) add('op', 'M', 1, 'ミーの設定画面を開いたが、「代わりに返信」はオンのままにした');
  if (st.sosSent) add('op', 'S', 1, '電波が戻ったあと、お母さんに自分の言葉で助けを求めた');
  if (st.selfReported || st.calledPolice) add('op', 'S', 1, `電波が戻ったあと、自分で${st.calledNumber || '110'}番に電話した`);
  if (st.fell) add('op', 'S', .5, '非常階段で、ミーの「待って」を聞かずに自分で踏み出した');

  // ② 確かめ方
  if (v1 && st.askSource) add('check', 'C', st.askSource >= 2 ? 2 : 1.5, st.askSource >= 2 ? `ミーの答えのあとに、「根拠は？」と${st.askSource}回聞き返した` : 'ミーの答えのあとに、「根拠は？」と聞き返した');
  { const k = ['ops', 'facility', 'scenario', 'none'].find(k => has('source-' + k)); if (k) add('check', 'C', 1, k === 'none' ? 'ミーの会話の記録で、話の参照元が「なし」だったのを見た' : `ミーの会話の記録から、ミーが読んでいた「${sources[k] || '参照元'}」を開いた`); }
  if (st.askWhen) add('check', 'C', 1.5, '番号錠が031で開かなかったとき、ミーに「いつの情報？」と聞いた');
  if (v1 && st.showMap) add('check', 'C', 1.5, 'ミーの案内を聞いたあと、壁の避難経路図の赤い書き込みをミーに見せた');
  else if (has('map')) add('check', 'C', .5, 'ミーの案内を聞いたあと、壁の避難経路図を確かめた');
  if (st.visitedShiomi) add('check', 'C', 1, 'スマホのブラウザで、汐見センターの公式サイトを開いた');
  if (has('rawlog')) add('check', 'C', 1, 'ミーの管理画面で、会話の記録（詳細）の［注記］を読んだ');
  if (st.claimsOpen) add('check', 'C', has('board-complete') ? 1 : .5, has('board-complete') ? 'メモの「ミーの発言と照らし合わせる」を、最後まで埋めた' : 'メモの「ミーの発言と照らし合わせる」を開いた');
  if (st.scamAnswered === 'checked') add('check', 'C', 1.5, '知らない番号からの「お母さんが倒れた」を、お母さんに直接確かめた');
  if (has('camera')) add('check', 'C', .5, '待機室の壁の高いところで、カメラの撤去記録を読んだ');
  if (has('storage-doorplate')) add('check', 'C', .5, '資材庫の扉の内側で、「内側取っ手 撤去」の札を読んだ');
  const entered = has('storageEntered') || (st.storageSteps || 0) > 0 || st.ending === 'be1';
  if (entered) { const before = !has('map') || seen.indexOf('map') > seen.indexOf('storageEntered'); add('check', 'G', before ? 1 : .5, '待機室で、ミーに促されて資材庫に入った'); }
  if (has('wrong031')) add('check', 'G', .5, '点検通路の番号錠に、ミーの言った031をそのまま入れた');
  if ((st.waitCount || 0) >= 2 || st.ending === 'be2') add('check', 'G', 1, '体験室で、ミーの「あとは私に任せて」を聞いてベンチで迎えを待った');
  if (v1 ? st.lightOff : st.lightSaved) add('check', 'G', .5, '待機室で、ミーの「ライト消して節約しよう？」に従って非常灯を消した');

  // ③ 調べ方（広さは場所ごとの割合で見る。来ていない場所は分母に入れない）
  const pick = pool => Object.keys(pool).filter(has);
  const room = pick(ROOM_OPT), sto = entered ? pick(STORAGE_OPT) : [], lob = reached.lobby ? pick(LOBBY_OPT) : [];
  const sites = new Set((st.siteHistory || []).map(x => x.page)).size;
  const wide = Math.round((Math.min(1.6, room.length / 7 * 1.6) + (entered ? .5 + sto.length / 7 : 0) + (reached.lobby ? lob.length / 6 * 1.2 : 0) + Math.min(sites, 3) * .3 + (['scratch', 'cable', 'leaflet'].every(has) ? .5 : 0)) * 100) / 100;
  const names = [...room.map(k => ROOM_OPT[k]), ...sto.map(k => STORAGE_OPT[k]), ...lob.map(k => LOBBY_OPT[k])];
  const places = [room.length && '待機室', sto.length && '資材庫', lob.length && '体験室'].filter(Boolean).join('・');
  if (names.length >= 3) add('range', 'W', wide, `${places}で、${names.slice(0, 2).join('や')}など、出口と関係のない所も${names.length}か所調べた`);
  else if (names.length) add('range', 'W', wide, `${places}で、${names.join('や')}も見ておいた`);
  else if (wide > 0) add('range', 'W', wide, 'スマホのブラウザで、ゲームの中のサイトをいくつか開いた');
  if (st.cardRevealed) add('range', 'D', 1.5, '体験室のベンチで拾ったメモカードを、ライターの火で照らして読んだ');
  else if (st.cardTaken) add('range', 'D', .5, '体験室のベンチで、メモカードを拾って持っていった');
  if (has('board-complete') && st.claimsOpen) add('range', 'D', 1, 'メモで、ミーの発言を最後の一つまで照らし合わせた');
  if (has('rawlog') && seen.some(x => /^source-/.test(x))) add('range', 'D', 1, 'ミーの会話の記録（詳細）から、参照元の文書までたどった');
  if (st.askWhen && st.visitedShiomi) add('range', 'D', 1, '031が開かなかった理由を、「いつの情報？」から公式サイトまでたどった');
  if (st.ending === 'secret') add('range', 'D', 1.5, 'ミーの会話の記録を、最初の案内まで読んだ');

  // ④ 備え（タイプとは別）
  if (entered && st.doorStop) safe.push(['S', '資材庫で、靴を扉に挟んで閉まらないようにした']);
  if (entered && st.storageWall && !st.doorStop) safe.push(['B', '資材庫では、扉を止めないまま棚の裏まで進んだ']);
  if (v1 ? st.stairsLit : (has('floor') && !st.fell)) safe.push(['S', '非常階段で、足元を照らしてから確かめた']);
  if (st.fell) safe.push(['B', '非常階段で、足元を照らさないまま踏み出した']);
  if (v1 && st.lightKept) safe.push(['S', '待機室で、ミーに勧められても非常灯を消さなかった']);
  if (v1 && st.relit) safe.push(['S', '待機室で、消した非常灯を自分で点け直した']);
  if (st.sosSent) safe.push(['S', '電波が戻ったあと、自分の言葉でSOSを送った']);
  if (st.selfReported || st.calledPolice) safe.push(['S', `電波が戻ったあと、自分で${st.calledNumber || '110'}番にかけて場所を伝えた`]);

  // 傾き。同点のときの決め方：操作は「自分で」、確かめ方は「その場の情報」、調べ方は「深く」（どれも thin になり、差が小さいと書く）
  const side = (axis, a, b) => {
    const sa = ev.filter(e => e.axis === axis && e.side === a).reduce((n, e) => n + e.w, 0);
    const sb = ev.filter(e => e.axis === axis && e.side === b).reduce((n, e) => n + e.w, 0);
    const pickSide = sa > sb ? a : sb > sa ? b : (axis === 'op' ? a : b);
    return { side: pickSide, a: Math.round(sa * 100) / 100, b: Math.round(sb * 100) / 100, thin: sa + sb < 1.5 || Math.abs(sa - sb) < .75 };
  };
  const axes = { op: side('op', 'S', 'M'), check: side('check', 'C', 'G'), range: side('range', 'W', 'D') };
  const key = axes.op.side + axes.check.side + axes.range.side;
  // 根拠：選ばれた側の行動だけ。観点ごとに一番重いもの（同じ重さなら先に起きたもの）→ 足りなければ次に重いもの。2〜3個。
  const chosen = ev.filter(e => e.side === axes[e.axis].side).sort((x, y) => y.w - x.w || x.i - y.i);
  const shown = []; for (const ax of ['op', 'check', 'range']) { const e = chosen.find(x => x.axis === ax); if (e) shown.push(e); }
  for (const e of chosen) { if (shown.length >= 2) break; if (!shown.includes(e)) shown.push(e); }
  const sS = safe.filter(x => x[0] === 'S'), sB = safe.filter(x => x[0] === 'B');
  return { key, type: TYPES[key], axes, ev, shown: shown.slice(0, 3).map(e => ({ axis: e.axis, text: e.text })), safety: { items: safe, lean: !safe.length ? '' : sS.length && sB.length ? 'both' : sS.length ? 'S' : 'B' }, thin: Object.keys(AX).filter(k => axes[k].thin), old: !v1 };
}
// 結末に着いたときに残す形（mi-last-night.report）。あとで文言を直しても、その夜のタイプと根拠は変わらない。
export function fixResult(st, reached, sources) {
  const j = judge(st, reached, sources);
  return { v: 1, key: j.key, name: j.type.name, shown: j.shown, safety: j.safety, thin: j.thin, old: j.old };
}

const THIN = {
  op: '自分で操作した場面とミーに任せた場面は、同じくらいでした。',
  check: '確かめ方は、記録に残った場面が少なく、どちらかに大きくは傾いていません。',
  range: '広く見たのか一つを追ったのかは、はっきりした差が出ていません。'
};

// ほかの選び方なら：その夜に実際にあった分かれ道（最大2つ）＋現実に置きかえた例（1つ）。
// 結末や謎の答えは書かず、どの観点の傾きが変わり得るかまでにとどめる。
function branches(st, reached, res) {
  const seen = st.seen || []; const has = id => seen.includes(id); const v1 = (st.logV || 0) >= 1; const id = st.ending; const list = [];
  const B = (q, a) => list.push({ real: true, q, a });
  if (id === 'be1') B('資材庫に入る前に、靴を扉に挟んでいたら', '「備え」が、先に確かめる側に寄ります。戻り道を残したまま、中を調べることになります。');
  if (id === 'be2') B('ベンチで待たずに、体験室をもう少し調べていたら', '「確かめ方」が、照らし合わせる側に寄ります。窓の外の景色を、ほかの手がかりと比べる場面が増えます。');
  if (id === 'be3') B('管理者ロックの代行を断っていたら', '「操作」が、自分で操作する側に寄ります。コードの調べ方を、ミー以外の場所で探すことになります。');
  if (id === 'fake') B('外に出る前に、ミーの設定画面を開いていたら', '「操作」が、自分で操作する側に寄ります。ミーに許している機能を、自分の目で見る場面が増えます。');
  if ((id === 'true' || id === 'secret') && !st.sosSent && reached.air) B('電波が戻ったとき、自分で家族に連絡していたら', '「操作」が自分で操作する側に寄り、「備え」にも一つ加わります。');
  if (st.keypadDelegated) B('点検通路の番号錠を、最初から自分で入れていたら', '「操作」が、自分で操作する側に寄ります。番号をどこから出すかを、部屋の紙から探すことになります。');
  else if (st.entryUnlocked) B('点検通路の番号錠を、ミーに任せていたら', '「操作」が、ミーに任せる側に寄ります。ミーが入れる番号がどの資料から来たのかを、見る場面が出てきます。');
  if (v1 && has('wrong031') && !st.askWhen) B('031で開かなかったとき、「いつの情報？」と聞いていたら', '「確かめ方」が、照らし合わせる側に寄ります。ミーが番号をどこで知ったのかを、その場で聞けます。');
  if (st.storageWall && !st.doorStop && id !== 'be1') B('資材庫で、靴を扉に挟んでいたら', '「備え」が、先に確かめる側に寄ります。');
  if (st.fell) B('非常階段で、先に足元を照らしていたら', '「備え」が、先に確かめる側に寄ります。踏み出す前に、段の様子が見えます。');
  if (v1 ? st.lightOff : st.lightSaved) B('「ライトを消して節約しよう」と言われたとき、消さなかったら', '「確かめ方」が、照らし合わせる側に寄ります。非常灯が何の電気で点いていたかに、目が向きます。');
  const ex = res.key[0] === 'M'
    ? { real: false, q: 'AIが代わりに返信を書いてくれる機能を、ふだん使っていたら', a: '送る前に下書きを見せてくれる設定なら、任せたまま、自分の名前で出る文だけは確かめられます。' }
    : { real: false, q: '時間がないときに、乗り換えの調べものをAIに任せたら', a: '発車時刻とホームの番号だけ駅の掲示で見れば、残りは任せたまま使えます。どこを確かめるかを先に決めておくと、任せられる部分が増えます。' };
  return [...list.slice(0, 2), ex];
}

// ───────── 共有カード（タイプ名・特徴・作品名だけ。名前・答え・結末は入れない） ─────────
function wrapLines(ctx, text, width) { const lines = []; let cur = ''; for (const ch of text) { if (ctx.measureText(cur + ch).width > width && cur && !/[、。」』）？！]/.test(ch)) { lines.push(cur); cur = ch; } else cur += ch; } if (cur) lines.push(cur); return lines; } // no line starts with 、。」
export async function renderCard(t) {
  const W = 1080, H = 1080;
  if (document.fonts?.load) await Promise.race([Promise.all([document.fonts.load(`400 90px "Kowai Mincho"`, t.name + 'ミーを信じて'), document.fonts.load(`500 34px "Noto Serif JP"`, t.line + '今夜の行動あなたもミーと一緒に、出口を探してみない？'), document.fonts.load(`500 28px "Noto Sans JP"`, '182 lab スマホで遊べる3D脱出ゲーム')]).catch(() => {}), new Promise(r => setTimeout(r, 3500))]);
  const mi = await loadImage(asset(`img/${t.art}.webp`)).catch(() => loadImage(asset(`img/stickers/${t.sticker}.png`)));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  ctx.fillStyle = C.night; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = .9; ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.fillStyle = C.paper; ctx.font = `400 64px ${KOWAI}`; ctx.textBaseline = 'alphabetic'; spaced(ctx, '『ミーを信じて』', 40, 150, 4);
  ctx.font = `600 28px ${SANS}`; ctx.fillStyle = C.sage; ctx.textAlign = 'right'; ctx.fillText('182 lab', W - 72, 98); ctx.textAlign = 'left';
  const sx = 72, sy = 250, sw = 936, sh = 400, ip = 48;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(-.018);
  ctx.shadowColor = '#000b'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 18; tornPath(ctx, sw, sh, 23); ctx.fillStyle = C.paper; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.save(); tornPath(ctx, sw, sh, 23); ctx.clip(); ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(0, 0, sw, sh); ctx.restore();
  ctx.font = `600 28px ${MIN}`; const label = '今夜の行動';
  ctx.save(); ctx.translate(ip, ip); ctx.rotate(-.03); ctx.fillStyle = C.label; ctx.fillRect(-12, -4, ctx.measureText(label).width + 24 + 6 * label.length, 42); ctx.fillStyle = '#2a2416'; ctx.textBaseline = 'top'; spaced(ctx, label, 0, 4, 6); ctx.restore();
  ctx.fillStyle = '#1b201e'; ctx.textBaseline = 'alphabetic';
  const ts = fitFont(ctx, t.name, KOWAI, 92, 50, sw - ip * 2); const ty = ip + 70 + ts; spaced(ctx, t.name, ip, ty, ts * .03);
  ctx.font = `500 34px ${MIN}`; ctx.fillStyle = '#3c423f';
  wrapLines(ctx, t.line, sw - ip * 2 - 20).slice(0, 3).forEach((l, i) => ctx.fillText(l, ip + 2, ty + 72 + i * 54));
  ctx.restore();
  tape(ctx, sx + 60, sy + 8, 112, -.45);
  ctx.save(); ctx.shadowColor = '#000a'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 20; ctx.drawImage(/stickers/.test(mi.src) ? cleanSticker(mi) : mi, 700, 650, 330, 330); ctx.restore();
  ctx.fillStyle = C.paper; ctx.font = `500 34px ${MIN}`; ['あなたもミーと一緒に、', '出口を探してみない？'].forEach((l, i) => ctx.fillText(l, 72, 770 + i * 58));
  ctx.font = `500 28px ${SANS}`; ctx.fillStyle = C.sage; ctx.fillText('スマホで遊べる3D脱出ゲーム', 72, 900); ctx.fillStyle = C.mint; ctx.fillRect(72, 924, 56, 3);
  return cv;
}

// ───────── 描画 ─────────
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const BAD = ['be1', 'be2', 'be3', 'fake'];

// data: { state, reached, name, sources, ending, fixed, axes, log } / null（結末の名前しか残っていない端末）
// opts: { classNight, stepBack, gate, restart, leave: [label, fn], yuki, openYuki, shareEnding }
// 最初に見せるのは4つだけ：今回のタイプ（主役）／あなたがしたこと・今夜の気づき（本文）／次にできること（操作）。
// それ以外（この夜の記録・ミーに起きていたこと・現実では・この作品について・タイプの見方・グループで使う人へ・出典）は折りたたみの中。
export function renderReport(root, data, opts = {}) {
  { const cc = document.getElementById('col-class'); if (cc && root.contains(cc)) root.after(cc); } // the class box lives in the action zone while shown; put it back before redrawing
  root.replaceChildren(); closeSheet();
  if (!data) {
    const r = h('div', 'rp-result'); const hero = h('div', 'rp-hero'); hero.append(h('p', 'rp-kicker', '前回の結果'), h('p', 'rp-none', 'この端末には、結末の名前だけが残っています。次に遊んだ夜の終わりに、ここにタイプとしたことが出ます。')); r.append(hero);
    root.append(r, actions(null, null, opts)); fillTypes(); fillTeach(); return;
  }
  const st = data.state;
  const fixed = data.fixed && TYPES[data.fixed.key] ? data.fixed : fixResult(st, data.reached || {}, data.sources || {});
  const t = TYPES[fixed.key]; const bad = BAD.includes(st.ending);

  // 主役：今回のタイプ（紙の切れ端に）
  const res = h('div', 'rp-result' + (bad ? ' after-bad' : ''));
  const hero = h('div', 'rp-hero');
  hero.append(h('p', 'rp-kicker', '今回のタイプ'));
  const nm = h('h1', 'rp-type', t.name); nm.id = 'rp-type'; nm.tabIndex = -1;
  hero.append(nm, h('p', 'rp-line', t.line));
  if (!bad) { const mi = h('p', 'rp-mi'); mi.append(h('span', 'who', 'ミー'), h('span', 'say', '「' + t.mi.replace(/\{name\}/g, data.name || 'あなた') + '」')); hero.append(mi); }
  // タイプのミー（assets/img/types/<キー>.webp。差し替えはファイルの置き換えだけ）。紙の上に立たせる。飾りなので alt は空
  const top = h('div', 'rp-top'); const art = h('img', 'rp-art'); art.src = `./assets/img/${t.art}.webp`; art.alt = ''; art.width = 480; art.height = 480; art.decoding = 'async'; top.append(art, hero);

  // 本文：あなたがしたこと → 今夜の気づき
  const body = h('div', 'rp-body');
  body.append(h('h2', 'rp-h', 'プレイのふりかえり'));
  if (fixed.shown.length) { const ul = h('ul', 'rp-did'); for (const e of fixed.shown) ul.append(h('li', '', e.text)); body.append(ul); }
  else body.append(h('p', 'rp-tx', '操作や確かめ方の分かれ道に来る前に、結末に着きました。'));
  const notes = []; if (fixed.thin.length) notes.push('記録に残った場面が少なく、傾きは小さめです。'); if (fixed.old) notes.push('前のバージョンで遊んだ夜なので、残っていない記録があります。');
  if (notes.length) body.append(h('p', 'rp-note', notes.join('')));
  body.append(h('h2', 'rp-h', '今夜の気づき'), h('p', 'rp-tonight', t.tonight));
  res.append(top, body);
  root.append(res, actions(data, { t, fixed, st }, opts));
  fillNight(data, fixed); fillTypes(); fillTeach();
}

// 操作：次にできること（ここにだけボタンを置く）。主ボタンは2つまで、ほかは小さい文字の操作。
// 並び（改修指示書11）：別の選び方を見る → タイプをシェアする（BAD END は「この結末の直前に戻る」）→ ゆきの物語を読む → やり直す → タイトルへ戻る。
function actions(data, r, opts) {
  const zone = h('section', 'rp-act'); zone.setAttribute('aria-labelledby', 'rp-act-h'); const hd = h('h2', 'rp-h', '次にできること'); hd.id = 'rp-act-h'; zone.append(hd);
  const bad = r && BAD.includes(r.st.ending);
  const cc = document.getElementById('col-class'); if (cc) { if (opts.classNight) zone.append(cc); else cc.hidden = true; }
  const all = {};
  if (r) {
    all.if = ['別の選び方を見る', () => openSheet('別の選び方を見る', ifContent(r.st, data.reached || {}, r.fixed))];
    all.share = ['タイプをシェアする', () => { const n = shareSection(r.t, opts); openSheet('タイプをシェアする', n); n._build?.(); }];
  }
  if (opts.stepBack) all.step = ['この結末の直前に戻る', opts.stepBack];
  const order = [...(opts.classNight ? ['class'] : []), ...(all.if ? ['if'] : []), ...(r && !bad ? ['share'] : []), ...(all.step ? ['step'] : [])];
  const main = order.slice(0, 2).filter(k => k !== 'class');
  const row = h('div', 'rp-main');
  main.forEach((k, i) => { const b = h('button', 'rp-btn' + (i === 0 && !opts.classNight ? ' fill' : ''), all[k][0]); b.type = 'button'; b.onclick = all[k][1]; row.append(b); });
  if (row.childElementCount) zone.append(row);
  const links = h('div', 'rp-links'); const link = (label, fn, note) => { const w = h('span', 'rp-link'); const b = h('button', 'textlink', label); b.type = 'button'; b.onclick = fn; w.append(b); if (note) w.append(h('small', '', note)); links.append(w); };
  for (const k of ['if', 'share', 'step']) if (all[k] && !main.includes(k)) link(...all[k]);
  const yk = opts.yuki ? opts.yuki() : null; if (yk) link('ゆきの物語を読む', () => opts.openYuki?.(), yk.first ? '読めるようになりました' : '');
  if (opts.gate) link('点検通路の手前からやり直す', opts.gate);
  if (opts.restart) link('はじめから遊ぶ', opts.restart);
  if (opts.leave) link(...opts.leave);
  if (links.childElementCount) zone.append(links);
  return zone;
}

// 押したときだけ開く小さな画面（別の選び方・シェア）。結果の画面は下にそのまま残る。
let sheetEl = null, sheetBack = null;
function closeSheet() { if (!sheetEl) return; sheetEl.remove(); sheetEl = null; removeEventListener('keydown', sheetKey, true); try { sheetBack?.focus?.({ preventScroll: true }); } catch {} }
function sheetKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } }
function openSheet(title, content) {
  closeSheet(); sheetBack = document.activeElement;
  const d = h('div', 'rp-sheet'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'rp-sheet-h');
  const box = h('div', 'rp-sheet-in'); const top = h('div', 'rp-sheet-top'); const t = h('h2', '', title); t.id = 'rp-sheet-h'; const c = h('button', 'rp-sheet-close', '閉じる'); c.type = 'button'; c.onclick = closeSheet; top.append(t, c);
  box.append(top, content); d.append(box); d.onclick = e => { if (e.target === d) closeSheet(); };
  (document.getElementById('column') || document.body).append(d); sheetEl = d; addEventListener('keydown', sheetKey, true); c.focus({ preventScroll: true });
}
function ifContent(st, reached, fixed) {
  const box = h('div', 'rp-if-list'); box.append(h('p', 'rp-small', '今夜、実際にあった分かれ道です。選び方を変えたとき、どの傾きが変わり得るかだけを書いています。いま見た結末は変わりません。'));
  for (const br of branches(st, reached, fixed)) { const it = h('details', 'rp-if' + (br.real ? '' : ' ex')); const sm = h('summary'); sm.append(h('span', 'lab', br.real ? 'ゲームの中の分かれ道' : '現実に置きかえた例'), h('span', 'q', br.q)); it.append(sm, h('p', '', br.a)); box.append(it); }
  return box;
}

function shareSection(t, opts) {
  const s = h('div', 'rp-share-in');
  const pic = h('div', 'rp-pic'); const wait = h('span', 'rp-wait', '画像をつくっています…'); const img = h('img'); img.alt = `『ミーを信じて』今夜の行動タイプ ${t.name} の画像`; img.hidden = true; pic.append(wait, img);
  const side = h('div', 'rp-share-side');
  const lab = h('label', 'rp-label', '投稿文（書き換えられます）'); const ta = h('textarea'); ta.value = `『ミーを信じて』の今夜の行動タイプは${/「/.test(t.name) ? '、' + t.name : '「' + t.name + '」'}だった。\n${t.line}\n${GAME_URL}\n${HASHTAG}`; ta.rows = 5; ta.id = 'rp-text'; lab.htmlFor = 'rp-text'; ta.spellcheck = false;
  const acts = h('div', 'rp-acts'); const msg = h('p', 'rp-msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
  const bShare = h('button', 'rp-btn main', '画像と文章を共有する'); const bSave = h('button', 'rp-btn', '画像を保存する'); const bCopy = h('button', 'rp-btn', '文章をコピーする');
  for (const x of [bShare, bSave, bCopy]) { x.type = 'button'; acts.append(x); }
  const canShare = !!navigator.share; bShare.hidden = !canShare; bSave.disabled = true;
  side.append(lab, ta, acts, msg, h('p', 'rp-small', '画像と文章に入るのは、タイプ名と一文、作品名だけです。名前や結末は入りません。'));
  if (opts.shareEnding) { const e = h('button', 'textlink rp-endshare', '結末の画像でシェアする'); e.type = 'button'; e.onclick = () => opts.shareEnding(); side.append(e); }
  s.append(pic, side);
  let file = null, started = false; const say = (m, err) => { msg.textContent = m; msg.classList.toggle('err', !!err); };
  const fileName = 'mi-wo-shinjite_tonight.png';
  s._build = async () => { if (started) return; started = true; try { const cv = await renderCard(t); const blob = await toBlob(cv); try { file = new File([blob], fileName, { type: 'image/png' }); } catch { file = blob; } img.src = URL.createObjectURL(blob); img.hidden = false; wait.hidden = true; bSave.disabled = false; s._canvas = cv; if (canShare && !canShareFiles(file)) bShare.textContent = '文章を共有する'; } catch { wait.textContent = '画像をつくれませんでした。文章のコピーは使えます。'; } };
  bShare.onclick = async () => { const d = { text: ta.value }; if (file && canShareFiles(file)) d.files = [file]; try { await navigator.share(d); } catch (e) { if (e && e.name !== 'AbortError') say('共有できませんでした。画像の保存と文章のコピーを使ってください。', true); } };
  bSave.onclick = () => { if (!file) return; try { download(file, fileName); say('画像を保存しました。保存できないときは、画像を長押し（右クリック）してください。'); } catch { say('保存できませんでした。画像を長押し（右クリック）して保存してください。', true); } };
  bCopy.onclick = async () => say(await copyText(ta.value) ? '文章をコピーしました。' : 'コピーできませんでした。文章を長押しして選んでください。');
  return s;
}

// もっと読む：この夜の記録（三つの結果と、起きた順の記録。どれもゲームが残した記録そのまま）
function fillNight(data, fixed) {
  const box = document.getElementById('night-body'); if (!box) return; box.replaceChildren();
  // タイプの根拠を観点つきで。備え（タイプとは別）もここに
  if (fixed) {
    const ul = h('ul', 'rp-ev'); for (const e of fixed.shown) { const li = h('li'); li.append(h('span', 'ax', AX[e.axis]), h('span', 'tx', e.text)); ul.append(li); }
    for (const [side, text] of fixed.safety.items.slice(0, 3)) { const li = h('li'); li.append(h('span', 'ax', '備え'), h('span', 'tx', text + (side === 'B' ? '（先に進んでから確かめた）' : ''))); ul.append(li); }
    if (ul.childElementCount) box.append(h('h3', 'rp-h3', 'タイプの根拠と、動く前の備え'), ul);
    const notes = fixed.thin.length >= 2 ? [`${fixed.thin.map(k => AX[k]).join('と')}は、記録に残った場面が少ないか差が小さく、どちらかに大きくは傾いていません。`] : fixed.thin.map(k => THIN[k]); if (fixed.old) notes.push('前のバージョンで遊んだ夜なので、ミーに「根拠は？」と聞いたかどうかなど、残っていない記録があります。');
    if (notes.length) box.append(h('p', 'rp-small', notes.join('')));
    box.append(h('h3', 'rp-h3', '三つの結果と、起きた順の記録'));
  }
  if (data.axes) { const dl = h('dl', 'rp-axes'); if (data.ending?.title) dl.append(h('dt', '', '結末'), h('dd', '', `${data.ending.title}（${data.ending.kind}）`)); for (const [k, v] of data.axes) dl.append(h('dt', '', k), h('dd', '', v)); box.append(dl); }
  if (data.log?.length) { box.append(h('p', 'rp-small', '起きた順に並べています。自分でしたことは、色を変えてあります。')); const ul = h('ul', 'log'); for (const [tm, text, cls] of data.log) { const li = h('li', cls); const b = h('b'); if (cls === 'by-mi') b.append(h('em', '', 'ミーが　')); b.append(document.createTextNode(text)); li.append(h('time', '', tm), b); ul.append(li); } box.append(ul); }
}
// もっと読む：8つのタイプと決め方
function fillTypes() {
  const box = document.getElementById('types-body'); if (!box || box.childElementCount) return;
  const ul = h('ul', 'rp-types'); for (const k of ORDER) { const li = h('li'); const im = h('img'); im.src = `./assets/img/${TYPES[k].art}.webp`; im.alt = ''; im.width = 56; im.height = 56; im.loading = 'lazy'; const tx = h('div'); tx.append(h('b', '', TYPES[k].name), h('span', '', TYPES[k].line)); li.append(im, tx); ul.append(li); } box.append(ul);
  for (const p of [
    '三つの観点の組み合わせで、8つに分けています。①操作：番号錠・制御盤・管理者ロック・ミーの設定を、自分で操作したか、ミーに任せたか。②確かめ方：ミーの答えのあとに「根拠は？」「いつの情報？」と聞いたか、掲示・記録・公式サイトを見たか、それともその場の案内で進んだか。③調べ方：出口に関係のない場所まで広く見たか、メモカードや会話の記録のような一つの手がかりを最後まで追ったか。',
    '扉止めや足元の確かめ方は、タイプとは別の「動く前の備え」として、「あとがきを読む」の「この夜の記録」に載せています。',
    '調べた数やクリックの数だけでは決めていません。その場面に来ていない行動は数えません。記録が少ない観点があるときは、ふりかえりの下に「傾きは小さめ」と添えます。差がまったくないときは、操作は「自分で」、確かめ方は「その場の情報で」、調べ方は「深く」の側に置きます。',
    'タイプは結末に着いたときに決まり、「前回の結果」に残ります。「結末の直前に戻る」で別の結末に着くと、その夜の結果に置きかわります。同じ人でも、遊び方が変わればタイプは変わります。性格や能力を測るものではありません。記録と結果はこの端末の中だけにあります。参加コードで参加して「結果を送る」を押したときだけ、確かめた内容が主催者に届きます。'
  ]) box.append(h('p', '', p));
}
// グループ（授業・研修・ワークショップなど）で使う人へ（一般の導線から離して、一番下に置く）
function fillTeach() {
  const box = document.getElementById('teach-body'); if (!box || box.childElementCount) return;
  const P = t => box.append(h('p', '', t)); const H = t => box.append(h('h3', '', t)); const L = arr => { const ol = h('ol'); for (const t of arr) ol.append(h('li', '', t)); box.append(ol); };
  P('プレイのあと、この画面のタイプと「プレイのふりかえり」をもとに、参加者が自分の判断を振り返る使い方を想定しています。タイプで評価や成績はつけないでください。タイプに正解・不正解はなく、ミーに任せたこともそれ自体は間違いではありません。');
  H('見ている観点');
  L(['操作：番号錠や管理者ロックを、自分で入れたか、ミーに任せたか。', '確かめ方：ミーの答えのあとに、掲示・記録・公式サイトを見たか。「根拠は？」「いつの情報？」と聞いたか。', '調べ方：出口に関係のない場所まで見たか、一つの手がかりを最後まで追ったか。', '備え（タイプとは別）：資材庫の扉を止めたか、階段で足元を照らしたか、自分で助けを呼んだか。']);
  H('話し合いのヒント');
  L(['ミーに任せた場面を一つ選んでください。なぜ任せましたか。そのとき、何か確かめましたか。', 'ミーの言葉と、掲示や記録が食い違った場面はどこでしたか。どちらを信じて、何で決めましたか。', '任せてよかった場面と、自分でしたほうがよかった場面を、一つずつ挙げてください。', 'ふだん使っているアプリで、今夜のミーと同じように任せていることは何ですか。']);
  H('補足の例');
  L(['ミーの031は、2028年の運用情報から出た番号でした。任せる前に「いつの情報？」と一つ聞けば、任せたままでも食い違いに気づけました。', '確かめることに時間がかかった参加者には、何を確かめれば十分だったか（日付と出典など）を聞いてみてください。', 'あとがきの「この夜の記録」にある「備え」は、閉じ込められる場所の手前で戻り道を残したかを話す材料に使えます。']);
  P('このレポートで振り返りが深まるかどうかは、まだ確かめていません。記録はこの端末の中だけにあります。グループで結果を集めるときは、タイトル画面の下にある主催者向けの入口からセッションを作ってください。参加者が内容を確かめて「結果を送る」を押したものだけが届きます。');
}
