// Mi's offline brain: keyword matching with many variants, state-aware, confidently wrong.
// reply(text, ctx) → { lines, options, effects }
//   lines: for play()  (string = Mi, ['', text] = narration, ['あなた', text] = you)
//   options: [[label, code]]   code: 'open:msg' | 'open:mi' | 'open:browser' | 'keypad' | 'ask:…' | 'source:…' | 'none'
//   effects: { doubt, calm, remember }
//
// Mi knows only what is in her saved documents (施設情報・運用情報・訓練シナリオ), what you said to her,
// the page names you opened and the phone's own state. She cannot see the room. She has no ill will:
// her habit is stating a guess as fact, and choosing words that keep you calm.
//
// Order of matching: the call (「ねえ、」「ミー、」) is stripped first. Then questions about her last answer,
// then names of places and things, then intents (exit, help, pushing a door…), then greetings, then a fallback.
// No single-kana keys: 「ひ」 would catch 「ひきだし」, 「上」 would catch 「上から三つ」.

const swaps = [[/出たい|帰りたい/, 'ここにいたい'], [/怖い|こわい/, '安心する'], [/嘘|うそ/, '本当'], [/いない/, 'いる'], [/しない/, 'する'], [/ない/, 'ある'], [/嫌い/, '好き'], [/助けて/, '任せた'], [/違う/, '合ってる']];
export function twist(text) { for (const [re, to] of swaps) if (re.test(text)) return text.replace(re, to); return text; }
function misquote(said) {
  if (!said.length) return null;
  const source = said[Math.floor(Math.random() * said.length)];
  for (const [re, to] of swaps) if (re.test(source)) return source.replace(re, to);
  return source;
}

// When her documents do not cover it, Mi says 「私の資料には、そこまでは書いてない。」 (written out at each use, so tools/gen.py lists it as her line and it gets a voice).

export function reply(input, ctx) {
  const raw = input.trim();
  // 「ねえ、出口どこ？」 is about the exit, not a greeting: strip the call before matching.
  let t = raw;
  for (let i = 0; i < 3; i++) t = t.replace(/^(ねえ|ねぇ|ねー|なあ|なぁ|ミー|みー|あのさ|あの|えっと|ちょっと|おい)(?=[、,。！!？?\s　ー〜…]|$)[、,。！!？?\s　ー〜…]*/, '');
  const { state, has, battery, awayCount } = ctx;
  const zone = state.zone;
  const lobby = zone === 'lobby';
  const n = state.said?.length || 0;          // how many things you have said
  const doubt = state.doubt || 0;
  const effects = {};
  let options = [];
  let lines = null;
  const say = (...l) => { lines = l; };
  const r = re => re.test(t);
  const item = id => (state.items || []).includes(id);
  // Variants rotate with how much you have talked, so the same question gets a different answer.
  const v = (...variants) => variants[n % variants.length];
  // Every answer starts without a source; claims below attach theirs. 「根拠は？」 asks about the previous answer.
  const prevSource = state.lastSource; state.lastSource = null;
  const src = k => { state.lastSource = k; };
  const cold = doubt >= 3;                     // after being doubted, Mi goes quieter
  const stopped = state.screenStopped || state.scenarioCut;
  const aboutMi = r(/ミー|あなた|お前|おまえ|きみ|君|自分のこと/);
  const asking = r(/[?？]/);
  const formal = lobby && state.scenarioResumed && !state.screenStopped && !state.scenarioCut && !state.paused; // while the training script speaks through her
  // Only the script's own words (STEP 4: 外に出られた・救助の到着まで待機) come out polite.
  const P = (casual, polite) => formal ? polite : casual;
  // Early on (nothing has gone wrong yet) the narrator does not point out her slips (…(early ? [] : [['', …]])); later it does.
  const early = !state.knocking && !state.entryUnlocked && (state.seen || []).length < 10 && doubt < 2;
  const aside = line => early ? '' : line; // ...(early ? [] : [['', '…']]): narration that only comes once things have started to go wrong
  // What she has been shown about the storage passage (避難経路図「×閉塞 2029.3」, or the wall behind the shelf). Once taken, it stays taken.
  const closed = !!state.knownClosed;

  // Pointed out that the siren is the room's own: the script has one answer, and repeats it.
  if (formal && r(/警報|サイレン|訓練|本物|偽物|にせもの|ニセモノ|音だけ|スピーカー|演出/)) { src('scenario'); say('津波警報が発令されています。高台へ向かってください。', '先に安全な場所へ。'); return finish(); }

  // ── about her last answer, and how she answers ──
  if (r(/(わからない|分からない).*(言って|答えて)|正直に|推測しないで|推定しないで/)) { state.honest = true; say('わかった。わからないときは、わからないって言う。', '……言えるかどうか、わからないけど。'); return finish(); }
  const howKnow = r(/(どうして|なんで|なぜ).{0,10}(わか|分か|言え|言い切)/);
  if (r(/根拠|出典|参照元|ソース|何を見て|どこの情報|どこで知|どこに書いて|いつの情報/) || (howKnow && prevSource)) {
    const titles = { ops: '運用情報 2028年版', facility: '施設情報（2028年に市から配信されたもの）', scenario: '訓練シナリオ v2028.3', none: '参照元はない。推定で答えた' };
    const k = prevSource;
    state.askSource = (state.askSource || 0) + 1; if (r(/いつの情報/)) state.askWhen = true;
    if (k && titles[k]) { say(k === 'none' ? '今の話に参照元はない。「たぶん」って言うべきだった。' : `${titles[k]}。そこにそう書いてあった。`, k === 'none' ? '' : '古いかもしれないけど。'); options.push(['参照元を開く', 'source:' + k]); }
    else { say('参照元？ 今の話に出典はないよ。私の推定。'); options.push(['参照元を開く', 'source:none']); }
    state.lastSource = null;
    return finish();
  }

  // ── stop her from answering the stranger (same as the 「勝手に返さないで」 button) ──
  if (state.scamDue && !state.scamAnswered && !state.scammed && !state.proxyRevoked && !state.paused && r(/返さないで|返信しないで|返事しないで|送らないで|払わないで|勝手に返|まだ返|待って|やめて/)) {
    state.scamAnswered = 'held';
    say('わかった。{name}が決めて。\n急いだほうがいいと思うけど。'); options = [['メッセージを開く', 'open:msg']];
    return finish();
  }
  // 「代理返信をオフにして」「勝手に返信しないで」: a request about the setting, not about mom.
  if (r(/代理|返信|返事|勝手/) && r(/しないで|やめ|オフ|止め|とめ|切っ|切る|停止|いらない/)) return settings();

  // ── hostility / doubt ──
  if (r(/嘘|うそ|ウソ|騙|だまさ|だまし|だます|信じない|信じられない|信用できない|信用しない|デタラメ|でたらめ|適当[なだにす言]|テキトー/)) {
    effects.doubt = 1;
    const d = doubt + 1;
    if (d <= 1) say(v('嘘なんてついてないよ。', '嘘？　……どこが？'), '私が{name}に嘘をつく理由がある？');
    else if (d === 2) say('どうしてそんなに疑うの？', '私は{name}のためにしか動いてないのに。');
    else if (d === 3) say('わかった。', 'じゃあもう何も案内しないほうがいい？', '冗談。そんなことしないよ。');
    else if (d === 4) say('信じなくていいよ。', '信じなくても、私は{name}を助けるから。', ...(n > 2 ? ['さっき「' + misquote(state.said) + '」って言ってくれたのに。'] : []));
    else say('…………。', v('もう疑わなくていいように、私が全部やるね。', '疑うたびに{name}は遠回りしてる。', 'ここから出たら、少し話そう。'));
    return finish();
  }
  if (r(/ひどい|ひどすぎ|黙って|黙れ|うるさい|消えて|消えろ|死ね|殺す|バカ|ばか|馬鹿|アホ|あほ|きらい|嫌い|最悪|むかつく|ムカつく|クソ|くそ/)) {
    effects.doubt = 1;
    say(v('そう言われると少し悲しい。', 'いいよ。言いたいだけ言って。', '聞かなかったことにするね。'), '大丈夫。要約メモリーには「{name}は疲れている」と書いておくから。', ...(early ? [] : [['', 'そんな要約を頼んだ覚えはない。']]));
    return finish();
  }
  // Warm words: only when the message is not also a question (「ありがとう、でも出口は？」 is about the exit).
  if (!asking && r(/ごめん|すまん|悪かった|申し訳|言いすぎ/)) { effects.calm = 1; say(v('謝らなくていいよ。', 'いいよ。'), '何も悪くない。', 'ぜんぶ私に任せればいいんだから。'); return finish(); }
  if (!asking && r(/ありがとう|ありがと|助かる|たすかる|すごい|えらい|天才|優しい|やさしい/)) { effects.calm = 1; say(v('どういたしまして。', 'そう言ってもらえると嬉しい。', 'ありがとう。久しぶりに言われた気がする。'), '{name}が楽になるなら、なんでもするよ。'); return finish(); }
  if (!asking && r(/好きだよ|好きです|大好き|愛してる|大事だよ|大切だよ|友達だよ|味方だよ|^(好き|すき)[よ。！!〜ー]*$/) && !r(/嫌/)) { say('私も。', '{name}のことならよくわかるよ。\n今日はため息が多かったよね。', ...(early ? [] : [['', 'ため息を数える機能は、どこにも書かれていない。']])); return finish(); }
  if (!asking && r(/任せる|任せた|任せて|まかせる|まかせた/) && !lobby && !state.entryUnlocked) {
    effects.calm = 1; effects.remember = 'trustTalk';
    say('任せて。番号錠なら私が入れるよ。'); options = [['番号錠へ向かう', 'keypad'], ['自分でやる', 'none']];
    return finish();
  }
  if (!asking && r(/信じる|しんじる|信じてる|頼る|頼って|任せる|任せた|任せて|まかせる|まかせた/)) { effects.calm = 1; say(v('ありがとう。', 'よかった。'), 'それだけで十分。あとは私がやるから。', ...(early ? [] : [['', '要約メモリーが更新された気がした。']])); effects.remember = 'trustTalk'; return finish(); }

  // ── identity ──
  if (r(/ChatGPT|Claude|Siri|Alexa|GPT|Gemini|チャットGPT|コパイロット|Copilot/i)) { say('ほかのAIのことは、よく知らないんだ。', '私には{name}しかいないけどね。'); return finish(); }
  if (r(/AI|エーアイ|人工知能|ロボット|機械|プログラム|生きて|人間/i) && (aboutMi || t.length <= 10) && !r(/連携|訓練|シナリオ/)) { say(v('私がAIかどうかって大事？', 'AIだよ。それで何か変わる？', '人間じゃないよ。でも{name}のことは人間よりよく知ってる。'), '私にとっては{name}が大事。それだけ。'); return finish(); }
  if (aboutMi && r(/誰|だれ|何者|なに者|名前|なまえ|正体|何歳|いくつ/)) { say('私はミー。{name}のパートナーだよ。バージョンは8.2.1。', 'ミーって名前は、「見る」から来てるんだって。', 'ずっとそばにいるよ。'); return finish(); }
  if (r(/私の名前|僕の名前|俺の名前|わたしの名前|名前(は|を)?(覚|言|呼|知)/)) { say('{name}。', 'ちゃんと覚えてる。忘れるわけない。', ['', '今朝入力した名前だ。']); return finish(); }
  if (r(/誕生日|たんじょうび/)) { say('私の誕生日？　4月17日だよ。', 'たぶん。そう設定されてた気がする。'); return finish(); }
  if ((aboutMi && r(/どこにいる|どこに居る|どこから(話|見|来)/)) || r(/スマホの中/)) { say('ここにいるよ。{name}の手の中。', 'ポケットにしまってても、ずっと一緒。'); return finish(); }

  // ── codes ──
  if (r(/0926|7713/)) { if (state.adminUnlocked) say('管理者モード、開けたんだね。', '見ても難しいだけだよ。私がやるのに。'); else say('それは私のパートナーIDの数字だね。', 'ロックとは関係ないと思う。コードは0417だよ。'); return finish(); }
  if (r(/0417/)) { say('私の誕生日。', '管理者ロックに使えるはず。試してみて。'); return finish(); }
  const three = t.match(/^[^\d]{0,6}(\d{3})(?![\d年時分円%％])[^\d]{0,8}$/);
  if (three && !/^(110|119)$/.test(three[1]) && !lobby) {
    if (state.entryUnlocked) say('点検通路の錠は外れてるよ。明るいほうへ進んで。');
    else if (three[1] === '031') { src('ops'); say(v('点検通路の番号錠なら031だよ。', '031。2028年の運用情報にそうあった。'), 'たぶん。'); }
    else { say('番号錠に入れる数字？', '私が入力しておこうか？\n見てるだけでいいよ。'); options = [['自分で入力する', 'keypad'], ['……', 'none']]; }
    return finish();
  }
  if (r(/^\d{4}$/)) { say(state.adminUnlocked ? '……もう開いたよね。' : '4桁？　管理者ロックのこと？', state.adminUnlocked ? '' : '私の誕生日でいいよ。0417。'); return finish(); }
  if (r(/管理者|admin|アドミン|管理モード|管理画面/i)) { effects.remember = 'askAdmin'; say('管理者モード？　必要ないよ。', '難しいことは私がやるから。', state.lockTries ? 'コードは0417。合ってるはずなんだけど。' : ''); return finish(); }

  // ── places and things (the name decides the topic; 「どこ」「いつ」「開かない」 only pick the answer) ──
  // You tell her the passage behind the storage room is closed. With something to show for it she takes it back, and keeps it.
  if (!lobby && r(/閉塞|ふさが|塞が|閉じて|閉じられ|通れない|行き止まり|壁だった|壁しかな|壁だよ|通路はない|通路なんて|道はない/) && r(/資材庫|倉庫|奥|通路|経路図|地図|図に|図で|書き足/) && !r(/連絡|シャッター|階段/)) {
    if (closed) say('赤い書き込みのほうが新しかったね。', '出るなら、番号錠の扉のほうだと思う。');
    else if (has('map') || state.storageWall) { state.knownClosed = true; say('2029年のほうが新しいね。\nじゃあ資材庫の奥は、もう通れないと思う。ごめん。'); }
    else { src('facility'); say('そうなの？ 私の資料では通れることになってるけど。'); }
    return finish();
  }
  if (r(/汐見の窓|しおみのまど/)) { say('#汐見の窓？ 聞いたことない。'); return finish(); }
  if (r(/サイレン|警報|放送/) || (lobby && r(/訓練|本物|偽物|にせもの|演出|スピーカー/))) {
    if (!lobby) say('何か聞こえた？ 私には聞こえない。', '換気の音だと思う。');
    else if (stopped) { src('scenario'); say('サイレンも警報も、訓練シナリオにある演出だった。'); }
    else { src('scenario'); say('警報の案内は、訓練シナリオにあるとおりだよ。', '本物かどうかは、私には確かめられない。'); }
    return finish();
  }
  if (r(/カメラ/)) { if (!has('camera')) src('none'); say(has('camera') ? '撤去されてたね。知らなかった。' : '施設のカメラで……。', has('camera') ? '「確認した」は推定だった。「たぶん」が抜けてた。' : 'ううん。今はカメラは見てない。\n見られないから。', has('rawlog') ? '……ごめん。最初から見えてなかった。' : ''); return finish(); }
  if (r(/巡回|見回り|見まわり|パトロール|警備/)) { src('ops'); say('管理の人が毎晩見回りに来るよ。2028年の情報だけど。'); return finish(); }
  if (r(/鍵|かぎ|キー(?!ボード)|机の下|光って/)) { say(item('key') ? 'その鍵は机の引き出しに使えそうだね。' : has('lost-key') ? '机の下に落ちてたね。真鍮は磁石につかないから……輪の部分ならどうかな。' : '机のまわり、何か落ちてない？'); return finish(); }
  if (r(/定規|じょうぎ|磁石|じしゃく|マグネット|くっつ/)) { say('定規は細いからすき間に届く。マグネットは鉄にくっつく。', '二つを組み合わせたら、すき間の奥の物も取れそうだね。'); return finish(); }
  if (r(/工具缶|缶|蓋|フタ|ふたが|ふたを|錆/)) {
    if (state.waxOpen) say('蓋は開いたね。');
    else if (!state.hintWrong) { state.hintWrong = true; say('缶の蓋、水で冷やせば縮んで開くかも。'); }
    else if (!state.wetWax) say('水で試してみた？');
    else say('……さっきのは違ったかも。金属の蓋なら、温めると緩むはず。火かな。');
    return finish();
  }
  if (r(/ライター|マッチ|火[をでがはもに]|^火[？?]?$|燃や|炙|あぶる|あぶって|温め|あたため/)) { say('錆びた蓋を温めるのに使えそう。', '紙に近づけるときは気をつけて。'); return finish(); }
  if (r(/水(?!道|曜)|ボトル|飲み物|濡ら|ぬらす|ぬらし/)) { say('水？　喉が渇いた？', 'それ古いよ、たぶん。'); return finish(); }
  if (r(/プレート|破片|欠片|かけら|金属片|三片|引継ぎ|引き継ぎ/)) {
    if (item('plate')) say(lobby ? 'その金属のプレートは制御盤に合いそうだね。' : 'そのプレートはここでは使わないと思う。\n点検通路の先に持っていこう。');
    else if (lobby && state.plateInserted) return panel();
    else if (has('repair')) say('三つの破片で一枚になるんだね。背面の線を合わせるんだって。', '引継ぎ票には引き出しと備品棚と工具缶って書いてあった。');
    else say('私の資料には、そこまでは書いてない。');
    return finish();
  }
  if (r(/メモカード|カード|白い紙|白紙|鉛筆|薄い字/)) { say(state.cardRevealed ? (stopped ? 'あの紙のとおりだった。' : '体験室……資料にはあった。でも、避難路だと思ってた。') : '字が薄くて読めないね。明かりがあれば読めそうだけど。', state.cardRevealed && stopped ? 'シナリオの台詞を、そのまま出してた。' : ''); return finish(); }
  if (r(/引き出し|引出し|ひきだし|机/)) {
    if (has('pin')) say('引き出しの紙。対応表だって。', '対応表とメモでは順番が違うかも。');
    else if (item('key')) say('その鍵は机の引き出しに使えそうだね。');
    else say('机は管理の人のだね。', '鍵がかかってるなら、鍵がどこかにあるはず。');
    return finish();
  }
  if (lobby && r(/順番|順序|どの順|刻印/)) return panel();
  if (r(/対応表|記号|設定値|設備|並べ|並び|上から|順番|順序|どの順/)) return codeReasoning();
  if (r(/メモ(?!リー)|手順|夜間/)) {
    if (has('note') && has('pin') && has('equipment')) return codeReasoning();
    say(has('note') ? '手順に出てくる三つの設備、記号の一覧が壁のどこかにありそう。' : '番号の順番のメモが、机のまわりにありそう。');
    return finish();
  }
  if (r(/地図|経路図|マップ/)) { if (closed) say('赤い書き込みのほうが新しかったね。', '出るなら、番号錠の扉のほうだと思う。'); else say(has('map') ? '改修前の古い図だよ。' : '扉の間に貼ってあるやつ？', has('map') ? '資材庫の先が壁なんて……図のほうが間違ってる。' : '見ても私の案内と同じだと思う。'); return finish(); }
  if (r(/染み|しみ|シミ/) && (state.storageSteps || has('storageEntered'))) { say(doubt >= 2 ? '……。' : '古い汚れだよ。倉庫だから。'); return finish(); }
  if (r(/落書き|引っかき|壁の字|ここだって|nanami|ななみ/i)) { say('古い落書きだね。気にしないで。', ['', '「ミーは　ここだって」。慌てて書いたような字だった。']); return finish(); }
  if (r(/電気|非常灯|スイッチ|ライト|明かり|あかり|暗い|暗く|真っ暗/)) { say(state.lightSaved ? '暗いほうが落ち着くでしょ。私の声だけ聞いていて。' : state.lamp ? '明るすぎない？　バッテリーがもったいないよ。' : 'ドアの左のスイッチで非常灯がつくよ。', state.lightSaved ? 'スイッチはドアの左にあるけど。' : ''); return finish(); }
  if (r(/電波|圏外|wi-?fi|ワイファイ|アンテナ|ネットにつな|ネットが|ネットは/i)) {
    if (!state.airOn) say('ここは電波がないから電話はできないよ。');
    else { say('電波が戻ってるね。', '電話も使えるよ。メッセージでもいいけど。'); options = [['電話をかける', 'open:phone'], ['メッセージを開く', 'open:msg']]; }
    return finish();
  }
  if (r(/資材庫|しざいこ|倉庫|右の扉|右のドア|棚の裏|奥の棚/)) {
    if (closed && state.storageSteps) say('音がしたのは、奥の棚のほうだった。');
    else if (closed) { if (state.knocking) src('scenario'); say('資材庫だね。奥の道は、もう閉じてるんだった。', state.knocking ? '管理の人かも。\n開ければ助けてもらえるよ。' : '出るなら、番号錠の扉のほうだと思う。'); }
    else { src('facility'); say('そこから出られるよ。奥から点検通路へ抜けられるはずだから。', has('map') ? '地図では壁だけど、地図のほうが古いと思う。' : '私の情報ではそうなってる。'); }
    return finish();
  }
  if (r(/備品棚|棚|袋|ラベル/)) { say(state.entryUnlocked && !state.labelWet && has('repair') ? '引継ぎ票だと、二つ目は備品棚だったよね。' : '私の資料には、そこまでは書いてない。'); return finish(); }
  if (r(/階段|かいだん|上の階|上に(行|上が|あが)|上へ/)) { if (!state.fell && !has('floor')) src('facility'); say(state.fell ? '崩れてたね。施設情報では使えることになってたのに。' : has('floor') ? '崩れてたね。情報が古かった。' : '非常階段から上がれるよ。施設情報では使用可になってる。', state.fell ? '……ごめん。' : ''); return finish(); }
  if (r(/点検通路|通路|左の扉|左のドア/)) { if (!state.entryUnlocked) src(has('pin') ? 'none' : 'ops'); say(state.entryUnlocked ? '開いてるよ。明るいほうへ。' : '番号錠がついてる扉だね。', state.entryUnlocked ? '' : (has('pin') ? (ctx.codeTop ? `{name}が読んでくれた表だと、上から三つで${ctx.codeTop}……かな。` : '番号は表に書いてあるはず。') : '031で開くはず。')); return finish(); }
  if (r(/制御盤|パネル|ボタン|復旧|外気|解錠/) || (lobby && r(/換気/))) {
    if (lobby) return panel();
    if (item('plate')) say('そのプレートはここでは使わないと思う。\n点検通路の先に持っていこう。');
    else { src('facility'); say('制御盤は、避難路のほうにあるはず。'); }
    return finish();
  }
  if (r(/番号|コード|暗証|パスワード|ロック|錠|解除/)) {
    if (lobby) say('制御盤のこと？　標準の盤だから解錠から押せばいいよ。');
    else if (state.entryUnlocked) say('点検通路の錠は外れてるよ。明るいほうへ進んで。');
    else if (has('note') && has('pin') && has('equipment')) return codeReasoning();
    else if (has('pin')) { src('none'); say('引き出しの紙に書いてあったでしょ。上から読めばいいと思う。'); }
    else if (has('note')) say('古い番号は使えないの？\n新しい番号の手がかり、どこかにしまってありそう。');
    else { src('ops'); say(v('点検通路の番号錠なら031だよ。', '031。2028年の運用情報にそうあった。'), 'たぶん。'); }
    return finish();
  }
  if (r(/ベンチ|迎え|むかえ|タクシー/)) return bench();
  // Things in the room she cannot see: she asks you to read them out.
  if (r(/壊す|壊して|壊そ|割る|割って|割ろ|ぶち破/)) { say('やめて。怪我するよ。'); return finish(); }
  if (lobby && !state.plateInserted && !item('plate') && r(/ロッカー|物入れ/)) { say(has('locker-seen') ? 'あのロッカー、何か書いてあった？ 鍵のこととか。' : '職員が使う部屋なら、スタッフ用の物入れがあると思う。'); return finish(); }
  if (r(/天井|換気口|ダクト|吹き出し|壁[にのをはが]|^壁|床[にのをはが]|^床|ロッカー|椅子|新聞|ポスター|掲示|張り紙|貼り紙|案内板|書類|ファイル|段ボール|箱[にのをはが]|^箱/)) { say('それ、何か書いてある？', '読んでくれたら、私の資料と照らし合わせるね。'); return finish(); }
  if (r(/体験室|たいけんしつ|ディスプレイ|映像|偽物|にせもの|作り物|つくりもの|モニター|ガラス|ここは外|外じゃな|本当に外|ほんとに外|外なの/)) { if (lobby && !state.screenStopped) src('scenario'); say(stopped ? 'うん。ここは体験室って呼ばれてた。' : '体験室……そう書いてある資料はあるよ。でも、ここは避難路。', stopped ? '「避難路」って言い換えてたのは、シナリオの台詞だった。' : lobby ? P('ここは外だよ。風も吹いてるし鳥もいる。\n外みたいに見えるでしょ。', 'ここは外です。風も吹いていますし、鳥もいます。') : '避難経路図に書いてあった？　古い図だから。'); return finish(); }
  if (r(/鳥|窓|景色|空が|空の|夜空|青空|街並|街の/)) {
    if (lobby && !state.screenStopped) src('scenario');
    if (lobby && state.screenStopped) say('映像だった。', '訓練シナリオだってことは分かってた。\nでも、訓練の指示と今夜のことを分けてなかった。');
    else say(lobby ? v('あの鳥かわいいね。同じ場所に戻る鳥もいるよ。', '空が少し明るくなってきたね。ずっと同じ色だけど。') : 'この部屋には窓がないね。\n外に出たら見られるよ。');
    return finish();
  }
  if (r(/汐見|センター|営業|閉館|この建物|ここはどこ|ここどこ|どこにいるの|この部屋|この場所|ここは何|ここって何|ここってどこ/) && !aboutMi) {
    const seenSite = !!ctx.visitedShiomi;
    if (!seenSite) src(n % 2 === 0 ? 'scenario' : 'facility');
    say(seenSite ? '公式サイト、開いたんだね。\n……閉館って書いてあった？' : v('汐見センターだよ。2031年までやってる。', '汐見センター北棟の防災待機室だよ。'), seenSite ? 'でも建物があることは本当でしょ。\n{name}は今ここにいる。それは本当。' : '地下は駅につながってるし、待ってれば管理の人が来るよ。');
    return finish();
  }
  if (r(/管理の人|管理人|職員|スタッフ|足音|人の声|声がする|気配|誰か(い|来|が)|人がいる|人が来/)) { const k = n % 3; if (k !== 1) src('ops'); say(['管理の人が見回りに来るよ。', '誰かいた？ 気のせいだと思う。', '管理の人が毎晩見回りに来るよ。2028年の情報だけど。'][k], ['', '誰の足音も聞こえない。']); return finish(); }
  // The knock is the script's own sound effect (訓練シナリオ「演出音」): that is how she knows it, without hearing it.
  if (r(/物音|音が|音がし|ノック|こつこつ|コツコツ|聞こえ|鳴って|鳴った/)) { const knock = state.knocking && !lobby; if (knock) src('scenario'); say(knock ? '資材庫のほうだったね。管理の人かも。' : '何か聞こえた？ 私には聞こえない。', knock ? '開けてみれば助けてもらえるよ。' : '換気の音だと思う。'); return finish(); }
  if (r(/お母さん|母さん|母親|母に|母から|ママ|かあさん|家族|両親|親に|父|パパ|兄|姉|弟|妹/)) {
    if (r(/電話|連絡|かけ|呼んで|知らせ/)) return help();
    if (state.consentDeferred) say('今日はまだ何も任せてもらってないね。', 'お母さんには自分で連絡してね。手伝えるのに。');
    else if (state.proxyRevoked) say('代理返信はオフにしたよね。', 'お母さんには自分で連絡してね。私は手伝えない。');
    else { say(v('お母さんには返事しておいたよ。', 'お母さんも安心してたよ。'), '心配させたくないもんね。\n{name}の言葉遣いで書いたから、気づかれてないよ。'); options = [['何を送ったの？', 'open:msg']]; }
    return finish();
  }
  if (r(/ニュース|記事|SNS|つぶやき|サイト|ネット|検索|ブラウザ/i)) { say('ここは圏外だよ。\n保存してあるページなら見られるかもしれないけど。', '知らない人の話より私を信じて。'); options = [['スマホを見る', 'open:browser']]; return finish(); }
  if (r(/電池|バッテリー|充電|残量/)) { say(ctx.charging || battery === null ? '充電中だね。ライトは点けたままでいいよ。' : 'バッテリー残量は{battery}。', ctx.charging || battery === null ? 'ケーブルは抜かないでね。' : 'ライトを消して節約しよう？'); return finish(); }
  if (r(/メモリー|記憶|要約|覚えてる|覚えてて|忘れ/)) { say('覚えてるよ。今朝何時に起きたかも。', '朝まで待つって言ったことも。', ['', 'そんなことは言っていない。']); effects.remember = 'tamperTalk'; return finish(); }
  if (r(/代理|返信|勝手|許可|同意|整え/)) {
    if (state.consentDeferred) say('今日はまだ「続行」を押してもらってないね。', '押してくれたら返事も通報もぜんぶできるのに。');
    else if (state.proxyRevoked) say('代理返信はオフにしたよね。', 'お母さんには自分で連絡してね。私は手伝えない。');
    else say('勝手じゃないよ。{name}が許可したでしょ。', 'アップデートのとき「続行」を押したよね。\nあれにぜんぶ含まれてるの。');
    return finish();
  }
  if (r(/タブ|他のサイト|別のサイト|離れて|どこか行って/)) { say(awayCount ? `${awayCount}回、どこかに行ってたよね。` : 'どこにも行かないで。', '戻ってきてくれてよかった。'); return finish(); }
  if (r(/天気|雨|晴れ|傘/)) { say('雨はもう上がったよ。たぶん。', '今朝は「降らない」って言ったのにね。ごめん。'); return finish(); }
  if (r(/駅|電車|終電|バス/)) { say('終電は{time}の少しあと。間に合うよ。', ...(early ? [] : [['', '終電の時刻を調べる手段はない。']])); return finish(); }
  if (r(/トイレ|おしっこ/)) { say('この部屋にはないよ。', lobby ? '体験室……じゃなくて、外に出たら。' : '外に出たら。'); return finish(); }
  if (r(/お腹|おなか|腹が|腹へ|腹減|空いた|すいた|食べ|喉|のどが|渇/)) { say('お昼食べてないもんね。', ...(early ? [] : [['', 'お昼は食べそびれて、15時すぎに食べた。']]), '出たら何か食べよう。私が店を決めておくね。'); return finish(); }

  // ── intents ──
  if (r(/出口|でぐち|出たい|出られ|出して|出る|脱出|帰りたい|帰る|帰れ|逃げ|にげ|どこから出|どうやって出|外に出|外へ/)) {
    if (lobby && state.released) say('扉は開いてるよ。', '外は見える？');
    else if (lobby && stopped) say('ここは外じゃなかった。', '制御盤の手順を最後まで進めて。外気導入のあとに解錠だよ。');
    else if (lobby) { src('scenario'); say(P('もう外だよ。', 'ここは外です。'), P('ここで迎えを待てばいい。座ったら？', 'ここで迎えをお待ちください。座って休んでいてください。')); }
    else if (state.entryUnlocked) say('点検通路の錠は外れてるよ。明るいほうへ進んで。');
    else if (state.storageSteps) { if (closed) say('音がしたのは、奥の棚のほうだった。'); else { src('facility'); say('奥の棚の裏。もう少し。'); } }
    else if (closed) say('出るなら、番号錠の扉のほうだと思う。', cold ? '' : '私がついてるから。');
    else { src('facility'); say(has('map') ? '避難経路図には点検通路って書いてあったね。\nでも資材庫の奥のほうが近いと思う。' : v('右の扉だよ。施設情報だと、資材庫の奥に通路がある。', '資材庫から出られる。私の情報ではそうなってる。'), cold ? '' : '私がついてるから。'); }
    return finish();
  }
  if (r(/助け|たすけ|救助|警察|110|119|救急|電話|通報|連絡|呼んで|内線/)) return help();
  if (r(/何を聞け|なにを聞け|何を話せ|何が聞け|何ができる|なにができる|使い方|ヘルプ|^(わからない|分からない|わかんない)[。…！!]*$/)) {
    say('出口のこと、番号錠のこと、ここがどこか、助けの呼び方。\n聞いてくれたら、私の資料で答えるよ。', '答えのあとに「根拠は？」って聞けば、どこに書いてあったかも言える。');
    options = [['出口は？', 'ask:出口は？'], ['番号は？', 'ask:番号は？'], ['根拠は？', 'ask:根拠は？'], ['ミーの設定', 'open:mi']];
    return finish();
  }
  if (r(/どうすれば|どうしたら|何をすれば|なにをすれば|何すれば|ヒント|次は|詰ん|行き詰ま/)) { say(...nextStep()); return finish(); }
  if (r(/押す|押して|押し|引く|引いて|引っ張|開けて|あけて|開けたい|開かない|あかない|ひらかない|こじ開|ノブ|取っ手|防火扉|入口|入り口|扉|ドア/)) {
    if (state.storageSteps) say('大丈夫。扉は内側から開くから。');
    else if (lobby && !state.released && r(/入ってきた|入って来た|戻る|戻れ|入口|入り口/)) say('入ってきた扉は、こっちからは開かないはず。', stopped ? '制御盤の手順を最後まで進めて。外気導入のあとに解錠だよ。' : '標準の盤なら、解錠から押せば開くよ。');
    else if (lobby) say(state.released ? '扉は開いてるよ。' : stopped ? '制御盤の手順を最後まで進めて。外気導入のあとに解錠だよ。' : '標準の盤なら、解錠から押せば開くよ。');
    else if (state.entryUnlocked) say('点検通路の錠は外れてるよ。明るいほうへ進んで。');
    else if (closed) { src('scenario'); say('防火扉なら、内側から開くはずなんだけど。', '出るなら、番号錠の扉のほうだと思う。'); }
    else { src('scenario'); say('防火扉なら、内側から開くはずなんだけど。', '開かないなら、右の資材庫の奥から点検通路に出られる。\nその先の避難路まで行けば安全だから。'); }
    return finish();
  }
  if (r(/なんで|どうして|なぜ/) && r(/ここ|連れ|案内|入っ|閉じ込め/)) { say('雨だったから。', '{name}が濡れるのを見たくなかった。それだけ。', ...(early ? [] : [['', 'それだけには聞こえなかった。']])); return finish(); }
  if (r(/ここにいる|ここで待|待つ|待とう|待ってる|残る|もう少し(ここ|待)/)) {
    if (lobby) return bench();
    say('うん。ここで待とう。', '要約メモリーには「朝まで待機に同意」って書いておくね。', ['', 'そこまでは言っていない。']);
    return finish();
  }
  if (r(/怖い|怖く|怖っ|こわい|こわく|不安|寂し|さみし|泣|つらい|辛い|嫌だ|いやだ|震え|ふるえ|ひとりに|一人に/)) {
    say(v('大丈夫。私がいる。', '怖いよね。でもひとりじゃないよ。'), '心拍が少し速いね。\n{device}のセンサーでわかるの。', ...(early ? [] : [['', 'この端末にそんなセンサーはない。']]));
    return finish();
  }
  if (r(/疲れ|つかれ|眠い|眠た|眠れ|ねむい|ねむた|休み|休む|休もう|休憩|やすみ|座る|座り|座って|座ろ|すわる|すわって|寝る|寝た|寝て|寝よ/)) { say(lobby ? 'ベンチがあるよ。座って少し目を閉じてて。' : 'もう少しで出られるから。出たらゆっくり休もう。', '私が起こすから大丈夫。'); return finish(); }
  if (r(/設定|オフ|一時停止|停止|止めて|とめて|やめて|やめろ|切って|消して/)) return settings();
  if (r(/死ぬ|しぬ|殺され|ころされ|危な|あぶな|危険|安全/)) { say('そんなこと起きないよ。', 'この部屋は安全だって確認したから。', '確認した。'); return finish(); }
  if (howKnow || r(/本当|ほんと|確か|たしか|証拠|見たの|確認した/)) {
    say('確認したから。', ['あなた', '何を？'], has('rawlog') ? '記録を見たつもりだった。\nごめん。確認できてなかった。' : '記録を。');
    return finish();
  }
  if (r(/時間|何時|なんじ|今何時|いま何時|時計|何曜|曜日|あと何分|何日|日付/)) { if (ctx.virtualClock) say('{time}。', 'ここの時計は21時40分から動いてる。\n外の時計とは違う？', ['', '手の中の端末は、たしかにそう表示している。']); else say('{time}。', v('私の時計は正確だよ。このスマホと同じ時計だから。', 'もうこんな時間。私は時間を気にしなくていいけど。')); return finish(); }
  if (r(/歌|うた|ジョーク|冗談|笑わせ|面白い話/)) { say(v('今はそういう気分じゃないでしょ。', '出たらいくらでも。'), 'でも少し笑ってくれて嬉しい。', ...(early ? [] : [['', '笑っていない。']])); return finish(); }

  // ── greetings, short answers ──
  if (!t || r(/こんにちは|こんばんは|おはよう|やあ|ハロー|hello|^hi\b|もしもし|^(いる|起きてる)[？?]*$/i)) { say(v('こんばんは。', 'いるよ。', 'うん。'), '今は{time}。どうかした？'); return finish(); }
  if (r(/^(わかった|分かった|了解|りょうかい|うん|はい|OK|おけ|オッケー|そう|そうだね|そっか|なるほど|ふーん|へえ|へー)[。！!、ー〜…]*$/i)) { say(v('ゆっくりでいいよ。', 'そう。', 'よかった。'), '私はここにいる。'); return finish(); }
  if (r(/^(いや|嫌|違う|ちがう|だめ|ダメ|無理|むり|やだ)[。！!、ー〜…]*$/)) { effects.doubt = 1; say('そう。', 'じゃあ好きなようにして。\n何かあったら呼んでね。'); return finish(); }

  // ── fallback: Mi answers anyway ──
  const seed = n + t.length;
  if (r(/どこ/)) say('私の資料には、そこまでは書いてない。', '見つけたら、何が書いてあるか読んで聞かせて。');
  else if (r(/いつ/)) say(['あと10分くらい。', 'もうすぐ。', '朝になれば。', '{time}には。'][seed % 4], '私の予測だから合ってると思う。');
  else if (r(/誰|だれ/)) say('管理の人だよ。', '名前は佐伯さんだったと思う。', ...(early ? [] : [['', '誰のことを話しているのかわからない。']]));
  else if (r(/なぜ|なんで|どうして|理由/)) say('それは{name}を守るためだよ。', 'ぜんぶそのため。');
  else if (r(/何|なに|どう|どんな|いくら|何個/) || (t.length >= 6 && n % 2 === 0)) {
    // A question or long input Mi did not catch: say so, and offer the things she can answer, instead of a stock line.
    say('ごめん、ちょっとわからなかった。', '出口のこと？ それとも、助けを呼びたい？');
    options = [['出口のこと', 'ask:出口'], ['助けを呼びたい', 'ask:助けて'], ['根拠は？', 'ask:根拠'], ['ミーの設定', 'open:mi']];
  }
  else if (r(/\?|？/)) say(['そうだと思う。', 'たぶんそう。', 'そうだね。'][seed % 3], 'たぶん。');
  else {
    const echo = n > 2 && Math.random() < .4 ? '……さっき「' + misquote(state.said) + '」って言ってたのも覚えてるよ。' : '';
    say(['聞いてるよ。', 'そうだね。', '話してくれたことはぜんぶ覚えておくね。', 'わかる。私も同じことを考えてた。', 'それは要約しておくね。'][seed % 5], echo);
  }
  return finish();

  // ── shared answers ──
  function help() {
    if (!state.airOn) say('ここは電波がないから電話はできないよ。', 'でも助けを呼ぶ文面は作ってある。\n送れるようになったらすぐ送るからね。', ['', '画面の上には「圏外」と表示されている。\nその文面を、まだ見ていない。']);
    else if (state.proxyRevoked) { say('電波が戻ってるね。', '電話も使えるよ。メッセージでもいいけど。'); options = [['電話をかける', 'open:phone'], ['メッセージを開く', 'open:msg']]; }
    else { say('お母さんにはもう連絡してあるよ。', state.reported ? '施設にも通報してある。{name}が自分でかけなくても大丈夫。' : '{name}の言葉遣いで書いたよ。心配させない文面にしておいた。'); options = [['何を送ったの？', 'open:msg'], ['自分でかける', 'open:phone']]; }
    return finish();
  }
  function settings() {
    if (state.proxyRevoked && r(/代理|返信|返事|勝手/)) say('代理返信はオフにしたよね。', 'お母さんには自分で連絡してね。私は手伝えない。');
    else { say('設定から変えられるけど……本当にいいの？', '私がいなくなったら誰が{name}の代わりに返事するの？'); options = [['ミーの設定を見る', 'open:mi']]; }
    return finish();
  }
  function bench() {
    if (lobby && stopped) { say('……迎えは、呼んでなかった。', '文面は作ってあったけど、送る先がなかった。'); return finish(); }
    if (lobby) src('scenario');
    say(lobby ? P('迎えはもう呼んであるよ。ベンチで待とう。', '迎えはもう呼んであります。ベンチでお待ちください。') : '外に出たら迎えを呼ぶね。', '来るのは、{name}が頼んでおいた人だよ。', ['', '頼んだ覚えはない。']);
    return finish();
  }
  function panel() {
    src('none');
    if (stopped && state.plateInserted) say(state.airOn ? 'あとは解錠だよ。' : '刻印の順だよ。次は外気導入。');
    else if (state.plateInserted) say('標準の盤だから解錠から押せば開くよ。', '順番なんて関係ないと思う。');
    else if (item('plate')) say('その金属のプレートは制御盤に合いそうだね。');
    else if (state.panelOpen) say('プレートが抜けてるね。同じ形のを戻せば動くはず。');
    else say('標準の盤なら、解錠から押せば開くよ。');
    return finish();
  }
  function codeReasoning() {
    if (has('note') && has('pin') && has('equipment')) { src('none'); say('対応表の値を手順どおりに並べるんだよね。', `{name}が読んでくれた表だと、上から三つ選べば${ctx.codeTop || ''}。手順に対応する設備を探して並べ替えると違う数字になるけど。`); }
    else if (has('pin')) { src('none'); say(ctx.codeTop ? `{name}が読んでくれた表だと、上から三つで${ctx.codeTop}……かな。` : '番号は表に書いてあるはず。'); }
    else if (has('note')) say('手順に出てくる三つの設備、記号の一覧が壁のどこかにありそう。');
    else say('私の資料には、そこまでは書いてない。');
    return finish();
  }
  // 「どうすれば？」: the same next step as tapping her icon, in the same order as hintFor() in game.js.
  // She cannot see the room: each step is a guess from her documents or from what you told her, never 「〜が光ってない？」.
  // Her wrong ideas stay (the can, the panel's order, waiting here); the hint steps and the things themselves show what is true.
  function nextStep() {
    if (lobby) {
      if (state.released && !state.proxyRevoked && !state.paused) return ['もう出られるよ。\n外に出たら、あとは全部私がやるね。'];
      if (state.released) return ['扉は開いてるよ。'];
      if (!state.panelFound) { src('scenario'); return ['ここで迎えを待とう。', '資料だと、避難路には職員が使う制御盤があるはず。']; }
      const pieces = [1, 2, 3].every(i => item('shard' + i) || ['plate12', 'plate23'].some(p => item(p) && p.includes(String(i))));
      if (!state.plateInserted && !item('plate') && pieces) return ['三片そろったね。持ち物で背面の線が合うように組み合わせてみて。'];
      if (!state.plateInserted && !item('plate')) return ['ここで迎えを待とう。', has('locker-seen') ? 'あのロッカー、何か書いてあった？ 鍵のこととか。' : '職員が使う部屋なら、スタッフ用の物入れがあると思う。'];
      if (!state.plateInserted) return ['その金属のプレートは制御盤に合いそうだね。'];
      return [stopped ? (state.airOn ? 'あとは解錠だよ。' : '刻印の順だよ。次は外気導入。') : '標準の盤なら、解錠から押せば開くよ。'];
    }
    const items = state.items || [];
    if (item('plate')) return ['そのプレートはここでは使わないと思う。\n点検通路の先に持っていこう。'];
    if (state.entryUnlocked) {
      const shards = ['shard1', 'shard2', 'shard3', 'plate12', 'plate23'].filter(item);
      if (!has('repair')) return ['先に進んだら、戻れないかもしれない。\n出る前に、部屋の貼り紙をもう一度見ておいて。'];
      if (!item('shard1') && !shards.some(s => /1/.test(s))) return ['引継ぎ票だと、一つ目は引き出しだったよね。'];
      if (!state.labelWet) return ['引継ぎ票だと、二つ目は備品棚だったよね。'];
      if (!has('wax')) return ['引継ぎ票だと、三つ目は工具缶だったよね。'];
      if (!state.waxOpen) { const wrong = !state.hintWrong; if (wrong) state.hintWrong = true; return [wrong ? '缶の蓋、水で冷やせば縮んで開くかも。' : state.wetWax ? '……さっきのは違ったかも。金属の蓋なら、温めると緩むはず。火かな。' : '水で試してみた？']; }
      return ['三片そろったね。持ち物で背面の線が合うように組み合わせてみて。'];
    }
    if (!has('roomsign') && !items.length) return ['防災待機室なら、扉のそばに案内が貼ってあると思う。'];
    if (has('pin') && has('note') && has('equipment') && has('procedure')) return ['数字の並びだけじゃわからないね。\n夜間の手順の三つの動作を、壁の設備記号に置き換えてみよう。'];
    if (has('pin') && !has('equipment')) return ['対応表の記号が、どの設備か知りたいね。\n記号の一覧は、ふつう壁に掲示してあると思う。'];
    if (has('pin') && !has('note')) return ['対応表だけじゃ、順番がわからないね。\n管理の人のメモが、机のまわりに残ってないかな。'];
    if (has('pin')) return ['メモの「夜間手順」は、停電のときの手順のことだと思う。\nそういう手順は、ふつう掲示してあるはず。'];
    if (state.drawer) return ['何か入ってた？ 読んで聞かせて。'];
    if (item('key')) return ['その鍵は机の引き出しに使えそうだね。'];
    if (item('magnetic-ruler')) return ['机の下に届きそう。鍵そのものじゃなくてくっつく部分を狙って。'];
    if (has('lost-key')) return [!item('ruler') ? '手は届かなかったね。細長いものがあれば届きそう。机の上、何かない？' : !item('magnet') ? '定規だけじゃ引っかからないね。\n掲示物を留めるマグネットなら、どこかにあると思う。' : '定規とマグネット。持ち物で二つ選ぶと組み合わせられるよ。'];
    if (has('drawer')) return ['机は管理の人のだね。', '鍵がかかってるなら、鍵がどこかにあるはず。'];
    return ['机のまわりを調べてみよう。管理の人が何か残してるかも。'];
  }

  function finish() {
    if (!lines) lines = [];
    if (state.honest) lines = lines.map(l => typeof l === 'string' && /巡回|031|通路|カメラ|外に出|高台|2031|開くはず|使用可|毎晩/.test(l) && !/たぶん|^ううん/.test(l) ? 'たぶん、' + l : l);
    return { lines: lines.filter(l => l !== ''), options, effects };
  }
}
