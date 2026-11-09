#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ミーの台詞を Google Cloud Text-to-Speech（Chirp 3: HD）で事前生成する。

    python3 tools/voice_gen.py list                 # 対象台詞の数・文字数・未生成の数・外れる声を表示（API は呼ばない）
    python3 tools/voice_gen.py check-harden         # 語尾の変え方が game.js と同じか、node で突き合わせる（API は呼ばない）
    python3 tools/voice_gen.py one "こんばんは。"      # 1 文だけ生成して assets/voice/ に保存（動作確認用）
    python3 tools/voice_gen.py all --yes            # 未生成の台詞をまとめて生成
    python3 tools/voice_gen.py all --yes --limit 50 # 先頭 50 文だけ
    python3 tools/voice_gen.py sample "こんばんは。" Aoede Kore   # 声の聞き比べ（assets/voice/samples/）

対象は docs/テキスト一覧/01_story.md・02_game.md・03_mi-brain.md の種別「ミー」「ヒント」の行
（tools/gen.py がソースから書き出したもの。表示経路 showLine → ミーの台詞）。
ゲーム側（game.js の speak）は「表示される最終テキスト」から同じハッシュを計算して
assets/voice/<hash>.mp3 を再生するので、ここでも同じ変形（{name} の置換、harden の語尾変化）を
先回りして全部作る。

- 認証：ADC（gcloud auth application-default login）。鍵ファイルやトークンはコードに置かない。
- 重複防止：ファイル名 = FNV-1a 64bit(音声名|話速|文) なので、同じ文＋同じ設定なら再生成しない。
- 上限：この作業で API に送る文字数の累計は assets/voice/ledger.json に記録し、BUDGET を超える送信は拒否する。
"""
import argparse, json, os, re, sys, time, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.environ.get('DOCS', os.path.join(ROOT, 'docs/テキスト一覧'))   # gen.py の OUT と同じ（試すときは別の場所を指せる）
OUT = os.path.join(ROOT, 'assets/voice')
MANIFEST = os.path.join(OUT, 'manifest.json')
LEDGER = os.path.join(OUT, 'ledger.json')

VOICE = 'ja-JP-Chirp3-HD-Leda'   # ミーの声（Chirp 3: HD、ja-JP）。変えると全文が別ファイルになる
RATE = 1.0                      # 話速（0.25〜2.0）。tone による変化はゲーム側の再生速度で付ける
ENCODING = 'MP3'
MARKUP = True                   # True なら「……」と改行を休止タグにした markup 入力で生成（間が自然になる）
BUDGET = 50000                  # この作業で API に送ってよい文字数の累計（試作・再生成を含む）
SOURCES = ['01_story.md', '02_game.md', '03_mi-brain.md']
SKIP_SECTIONS = {'idleLines', 'idleLine'}
# 「ミー（タイトル画面）」「通知」は showLine を通らないので対象外。「ヒント（地の文）」は声なし。
# 暗転の声（speakForce）は game.js の SPEAK_FORCE が true のときだけ対象にする（false なら一度も再生されない）。
GAME_SRC = open(os.path.join(ROOT, 'game.js'), encoding='utf-8').read()
SPEAK_FORCE = bool(re.search(r'const SPEAK_FORCE = true', GAME_SRC))
KINDS = {'ミー', 'ヒント'} | ({'暗転の声（ミー）'} if SPEAK_FORCE else set())
DYNAMIC = re.compile(r'\{(time|battery|device|shiftEnd|level|weekday|awayCount)\}|\$\{')
MAYBE = re.compile(r'巡回|031|通路|カメラ|外に出|高台|2031|開くはず|使用可|毎晩')  # mi-brain.js finish(): honest のとき「たぶん、」が付く


def fnv1a64(s):
    h = 0xcbf29ce484222325
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return '%016x' % h


def rate_key(rate=None, markup=None):
    rate = RATE if rate is None else rate; markup = MARKUP if markup is None else markup
    return ('%s+pause' % rate) if markup else '%s' % rate


def key_of(text, voice=None, rate=None, markup=None):
    return fnv1a64('%s|%s|%s' % (voice or VOICE, rate_key(rate, markup), text))


def harden(text, t):
    """game.js の harden と同じ式（tone 2 以上で語尾が短くなる）。game.js を変えたら、ここも同じに変える。
    確かめ方：python3 tools/voice_gen.py check-harden（game.js の式を node で動かして突き合わせる）。"""
    if t < 2:
        return text

    def yone(m):
        # 「〜ですよね。」「〜ましたよね？」は丁寧語なのでそのまま。ほかの「よね」は「でしょ」に。
        return m.group(0) if re.search(r'(ます|ました|です|でした)\Z', m.string[:m.start() + 1]) else m.group(1) + 'でしょ' + m.group(2)
    s = re.sub(r'([^だ])よね([。？])', yone, text)
    s = s.replace('んだよ。', 'んだ。').replace('だよ。', '。').replace('よ。', '。')
    s = re.sub(r'([^す])ね。', r'\1。', s)
    if t >= 3:
        if 'から' not in s:
            s = re.sub(r'(^|[。？！\n　 ])大丈夫。', r'\1大丈夫だから。', s, count=1)
        if 'お願い' not in s:
            s = re.sub(r'([^。？！\n]*してみて。)', r'お願い、\1', s, count=1)
        s = s.replace('たら？', 'てくれる？')
    return s.replace('。。', '。')


def source_lines():
    """docs の表から（ファイル, 行, 文）を集める。表の中の `\\n` は改行、`｜` は `|` に戻す。"""
    rows = []
    for name in SOURCES:
        path = os.path.join(DOCS, name)
        section = ''
        with open(path, encoding='utf-8') as f:
            for line in f:
                cells = [c.strip() for c in line.rstrip('\n').split('|')]
                if len(cells) >= 3 and cells[2].startswith('**▼'):
                    section = cells[2].strip('*▼ ')
                if len(cells) < 5 or cells[2] not in KINDS:
                    continue
                if name.startswith('01') and cells[2] != '暗転の声（ミー）':
                    continue   # 導入チャット・履歴・要約は showLine を通らない
                if section in SKIP_SECTIONS:
                    continue   # 通知で出る独り言
                text = cells[3].replace('\\n', '\n').replace('｜', '|')
                rows.append((name, cells[1], text, cells[4]))
    return rows


def variants(text, from_brain):
    """表示されうる最終テキストを全部返す（{name}→あなた、tone 0/2/3、たぶん、）。"""
    base = text.replace('{name}', 'あなた')
    bases = [base]
    if from_brain and MAYBE.search(base) and 'たぶん' not in base and not base.startswith('ううん'):
        bases.append('たぶん、' + base)
    out = []
    for b in bases:
        for t in (0, 2, 3):
            v = harden(b, t)
            if v not in out:
                out.append(v)
    return out


CODE_TOPS = ['648', '127', '513']   # story.js CODES の box+d1+circ（3 セット）
# `${ctx.codeTop}`・`${ctx.codeTop || ''}`・`${v.box}${v.d1}${v.circ}` のどれでも当たる
CODE_EXPR = re.compile(r"\$\{ctx\.codeTop(?:\s*\|\|\s*'[0-9]*')?\}|\$\{v\.box\}\$\{v\.d1\}\$\{v\.circ\}")
# 「根拠は？」の答え `${titles[k]}。そこにそう書いてあった。` の k は mi-brain.js の titles（none 以外）の 3 通り
_titles = re.search(r"const titles = \{(.*?)\};", open(os.path.join(ROOT, 'mi-brain.js'), encoding='utf-8').read())
TITLES = [v for k, v in re.findall(r"(\w+): '([^']*)'", _titles.group(1)) if k != 'none'] if _titles else []
TITLE_EXPR = re.compile(r"\$\{titles\[k\]\}")


def expand_codes(text):
    """番号錠の上三つの値（3 通り）と、参照元の名前（3 通り）は、全部の文を作る。"""
    if TITLE_EXPR.search(text):
        return [TITLE_EXPR.sub(lambda m, x=x: x, text) for x in TITLES]
    if not CODE_EXPR.search(text):
        return [text]
    return [CODE_EXPR.sub(c, text) for c in CODE_TOPS]


def collect():
    targets = {}   # final text -> {sources}
    skipped = []
    rows = []
    for name, ln, text, note in source_lines():
        for t in expand_codes(text):
            rows.append((name, ln, t, note))
    for name, ln, text, note in rows:
        if DYNAMIC.search(text) or 'つなぐ' in note:
            skipped.append((name, ln, text))
            continue
        for v in variants(text, name.startswith('03')):
            targets.setdefault(v, set()).add('%s:%s' % (name[:2], ln))
    return targets, skipped


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


def manifest():
    m = load_json(MANIFEST, None)
    if not m or m.get('voice') != VOICE or m.get('rate') != RATE or bool(m.get('markup')) != MARKUP:
        m = {'voice': VOICE, 'rate': RATE, 'markup': MARKUP, 'rateKey': rate_key(), 'encoding': ENCODING, 'lines': {}}
    return m


def existing(m, text):
    k = key_of(text)
    return k if os.path.exists(os.path.join(OUT, k + '.mp3')) and k in m['lines'] else None


# ───────── API ─────────
_session = None
_project = None


def session():
    """ADC で認証した requests セッション。鍵ファイルは使わない。"""
    global _session, _project
    if _session:
        return _session
    try:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
    except ImportError:
        sys.exit('google-auth / requests がありません：  pip3 install --user google-auth requests')
    try:
        creds, project = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    except Exception as e:  # DefaultCredentialsError
        sys.exit('ADC が見つかりません。先に  gcloud auth application-default login  を実行してください。\n' + str(e))
    _project = os.environ.get('GOOGLE_CLOUD_PROJECT') or project or getattr(creds, 'quota_project_id', None)
    if not _project:
        sys.exit('プロジェクトが分かりません。  gcloud auth application-default set-quota-project <PROJECT_ID>  か、環境変数 GOOGLE_CLOUD_PROJECT を設定してください。')
    _session = AuthorizedSession(creds)
    return _session


def sent_len(text, markup=None):
    """API に送る文字数（markup ならタグ込み。空白・改行も数える）。"""
    return len(to_markup(text)) if (MARKUP if markup is None else markup) else len(text)


def to_markup(text):
    """Chirp 3: HD の markup 入力。「……」と改行を休止タグにして、間を取らせる。"""
    t = text.replace('……', '[pause short]').replace('\n', ' [pause] ')
    return re.sub(r'\s+', ' ', t).strip()


def synthesize(text, voice=None, rate=None, markup=None):
    s = session()
    markup = MARKUP if markup is None else markup
    body = {'input': {'markup': to_markup(text)} if markup else {'text': text},
            'voice': {'languageCode': 'ja-JP', 'name': voice or VOICE},
            'audioConfig': {'audioEncoding': ENCODING, 'speakingRate': rate or RATE}}
    r = s.post('https://texttospeech.googleapis.com/v1/text:synthesize', json=body,
               headers={'x-goog-user-project': _project}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError('HTTP %s: %s' % (r.status_code, r.text[:600]))
    import base64
    return base64.b64decode(r.json()['audioContent'])


def ledger():
    return load_json(LEDGER, {'budget': BUDGET, 'sent_chars': 0, 'requests': 0, 'entries': []})


def generate(texts, m, yes):
    led = ledger()
    todo = [t for t in texts if not existing(m, t)]
    chars = sum(sent_len(t) for t in todo)
    print('生成対象：%d 文 / 送信文字数：%d 文字（これまでの累計 %d 文字、上限 %d 文字）' % (len(todo), chars, led['sent_chars'], BUDGET))
    if not todo:
        print('すべて生成済みです。')
        return
    if led['sent_chars'] + chars > BUDGET:
        sys.exit('上限 %d 文字を超えるので送信しません（累計 %d + 今回 %d）。' % (BUDGET, led['sent_chars'], chars))
    if not yes:
        sys.exit('実行するには --yes を付けてください。')
    os.makedirs(OUT, exist_ok=True)
    for i, t in enumerate(todo, 1):
        k = key_of(t)
        try:
            audio = synthesize(t)
        except Exception as e:
            print('失敗 (%d/%d) %r\n  %s' % (i, len(todo), t[:40], e))
            save_json(MANIFEST, m); save_json(LEDGER, led)
            sys.exit(1)
        with open(os.path.join(OUT, k + '.mp3'), 'wb') as f:
            f.write(audio)
        m['lines'][k] = t
        n = sent_len(t); led['sent_chars'] += n; led['requests'] += 1
        led['entries'].append({'at': datetime.datetime.now().isoformat(timespec='seconds'), 'key': k, 'chars': n, 'voice': VOICE, 'rate': rate_key()})
        print('OK (%d/%d) %5d bytes  %s  %s' % (i, len(todo), len(audio), k, t.replace('\n', '／')[:36]))
        save_json(MANIFEST, m); save_json(LEDGER, led)
        time.sleep(0.15)
    print('完了。累計送信 %d 文字 / %d 文字' % (led['sent_chars'], BUDGET))
    prune(m)


def prune(m):
    """manifest に無い mp3（設定変更前の残骸）を消す。samples/ は触らない。"""
    gone = 0
    for name in os.listdir(OUT):
        if name.endswith('.mp3') and name[:-4] not in m['lines']:
            os.remove(os.path.join(OUT, name)); gone += 1
    if gone:
        print('旧設定のファイルを %d 個削除' % gone)


def sample(text, voices, rate=None, markup=None):
    """声の聞き比べ用。assets/voice/samples/<声>.mp3 に保存し、manifest には入れない（文字数は ledger に記録）。"""
    led = ledger()
    chars = sent_len(text, markup) * len(voices)
    print('試作：%d 声 × %d 文字 = %d 文字（累計 %d / %d）' % (len(voices), len(text), chars, led['sent_chars'], BUDGET))
    if led['sent_chars'] + chars > BUDGET:
        sys.exit('上限を超えるので送信しません。')
    d = os.path.join(OUT, 'samples'); os.makedirs(d, exist_ok=True)
    for v in voices:
        name = v if v.startswith('ja-JP-') else 'ja-JP-Chirp3-HD-' + v
        audio = synthesize(text, name, rate, markup)
        tag = name.split('-')[-1] + ('_r%s' % (rate or RATE)) + ('_pause' if (MARKUP if markup is None else markup) else '')
        path = os.path.join(d, tag + '.mp3')
        with open(path, 'wb') as f:
            f.write(audio)
        n = sent_len(text, markup); led['sent_chars'] += n; led['requests'] += 1
        led['entries'].append({'at': datetime.datetime.now().isoformat(timespec='seconds'), 'sample': name, 'chars': n, 'rate': rate_key(rate, markup)})
        save_json(LEDGER, led)
        print('OK %6d bytes  %s' % (len(audio), path))


def check_harden(texts):
    """game.js の harden を node で動かし、このファイルの harden と全文・全トーンで突き合わせる（API は呼ばない）。"""
    import subprocess
    i = GAME_SRC.index('function harden(')
    j = GAME_SRC.index('\n}\n', i) + 2
    js = GAME_SRC[i:j] + '\nconst d = JSON.parse(require("fs").readFileSync(0, "utf8"));\nconsole.log(JSON.stringify(d.map(([s, t]) => harden(s, t))));\n'
    pairs = [(s, t) for s in texts for t in (2, 3)]
    out = json.loads(subprocess.run(['node', '-e', js], input=json.dumps(pairs), capture_output=True, text=True, check=True).stdout)
    bad = [(s, t, o, harden(s, t)) for (s, t), o in zip(pairs, out) if o != harden(s, t)]
    print('harden の突き合わせ：%d 組中 %d 組が不一致' % (len(pairs), len(bad)))
    for s, t, o, p in bad[:20]:
        print('  tone%d %s\n    game.js：%s\n    python ：%s' % (t, s.replace('\n', '／'), o.replace('\n', '／'), p.replace('\n', '／')))
    return not bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['list', 'one', 'all', 'sample', 'check-harden'])
    ap.add_argument('text', nargs='?')
    ap.add_argument('voices', nargs='*')
    ap.add_argument('--yes', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--rate', type=float)
    ap.add_argument('--markup', action='store_true')
    a = ap.parse_args()
    m = manifest()
    if a.cmd == 'sample':
        if not a.text or not a.voices:
            sys.exit('使い方：sample "文" Aoede Kore Zephyr')
        sample(a.text, a.voices, a.rate, True if a.markup else None)
        return
    if a.cmd == 'one':
        if not a.text:
            sys.exit('文を指定してください。')
        generate([a.text], m, True)
        return
    if a.cmd == 'check-harden':
        bases = sorted({t.replace('{name}', 'あなた') for _, _, text, _ in source_lines() for t in expand_codes(text) if not DYNAMIC.search(t)})
        sys.exit(0 if check_harden(bases) else 1)
    targets, skipped = collect()
    texts = list(targets)
    done = [t for t in texts if existing(m, t)]
    todo = [t for t in texts if not existing(m, t)]
    rows = source_lines()
    print('元の行：%d 行（ミー・ヒント）、動的な差し込みがあり対象外：%d 行' % (len(rows), len(skipped)))
    print('最終テキストの種類：%d 文（口調の変化などの分岐を含む、重複除去後）、合計 %d 文字' % (len(texts), sum(len(t) for t in texts)))
    print('  生成済み：%d 文、未生成：%d 文（%d 文字）' % (len(done), len(todo), sum(len(t) for t in todo)))
    print('  音声：%s  話速：%s  累計送信：%d / %d 文字' % (VOICE, RATE, ledger()['sent_chars'], BUDGET))
    # all --yes のあとに manifest から外れ、prune で mp3 が消える文（今の台詞から外れた声）
    keep = {key_of(t) for t in texts}
    stale = [(k, v) for k, v in m['lines'].items() if k not in keep]
    print('  対象から外れる生成済みの声：%d 文（all --yes の後に manifest から外し、mp3 を削除）' % len(stale))
    if a.cmd == 'list':
        for name, ln, text in skipped:
            print('  対象外 %s:%s %s' % (name[:2], ln, text.replace('\n', '／')[:50]))
        for k, v in stale:
            print('  外れる %s %s' % (k, v.replace('\n', '／')[:60]))
        for t in todo:
            print('  未生成 %3d文字 %s' % (len(t), t.replace('\n', '／')))
        return
    if a.limit:
        todo = todo[:a.limit]
    generate(todo, m, a.yes)
    if a.yes:
        keep = {key_of(t) for t in texts}
        stale = [k for k in m['lines'] if k not in keep]
        for k in stale:
            del m['lines'][k]
        if stale:
            save_json(MANIFEST, m); print('対象外になった文を manifest から %d 件外した' % len(stale))
        prune(m)


if __name__ == '__main__':
    main()
