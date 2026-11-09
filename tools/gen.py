# -*- coding: utf-8 -*-
"""Generate docs/テキスト一覧/01..06 from the JS/HTML sources (read-only on the sources)."""
import re, sys, os
from html.parser import HTMLParser
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jstok import tokenize, func_map, enclosing, has_jp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('OUT', os.path.join(ROOT, 'docs/テキスト一覧'))

SPEAKERS = {'': 'ナレーション', 'あなた': 'あなた', 'ミー': 'ミー', 'システム': 'システム', '{name}': 'あなた', '母': 'お母さん', 'お母さん': 'お母さん'}
FROM = {'mom': 'お母さん', 'proxy': '代理返信（ミー）', 'me': 'あなた（送信文）', 'scam': '不明な番号（河合）', 'sys': '画面の文（システム表示）'}
SKIP_CALLS = {'remember', 'has', 'includes', 'test', 'startsWith', 'endsWith', '$', 'querySelector', 'querySelectorAll', 'setItem', 'getItem', 'removeItem',
              'setProperty', 'setAttribute', 'getElementById', 'if', 'while', 'switch', 'Set', 'Image', 'split', 'join', 'match', 'matchMedia',
              'createElement', 'createElementNS', 'keypad', 'A.saveWorld', 'localStorage.getItem', 'localStorage.setItem', 'localStorage.removeItem', 'createTextNode',
              'Snd.setScene', 'Snd.pop', 'A.world', 'some', 'find', 'filter', 'every', 'dataset', 'add', 'remove', 'toggle', 'contains', 'indexOf', 'lastIndexOf', 'padStart',
              'proxy', 'interactables.get', 'get', 'load', 'Promise.race'}
TRANSPARENT = {'T', 'String'}
PUNCT_ONLY = re.compile(r'^[。、…・ー\s　！？「」『』（）・:：—－\-●○☆★▂▄×✓□‹›+＋／]+$')
HINT_FNS = ('hint', 'hintFor')   # ヒントの関数（hintCue から hintFor に名前が変わった）
GAME_LINES = []                  # gen_game が game.js の行を入れる（地の文の表 const missing の判定用）
PAGE_FNS = {'nightAxes', 'nightEvents', 'colEnding', 'colLog', 'colChecks', 'yourNight', 'yourNightOf', 'QUIZ', 'REFLECT',
            'renderQuiz', 'renderReflect', 'renderQuizSum', 'preQuizThen', 'playSettings'}
OPTION_NEXT = re.compile(r'^\s*,\s*(\(\)\s*=>|[A-Za-z_$][\w$]*\s*\]|\(\s*\)\s*=>)')

def esc(s):
    return s.replace('|', '｜').replace('\n', '\\n')

def is_font(s):
    return bool(re.search(r'\d+px|serif|cursive|^rgba?\(|^#[0-9a-fA-F]{3,8}$|^url\(|^\.{0,2}/|\.(png|jpg|jpeg|js|html)$', s))

def named_call(frames):
    for i in range(len(frames) - 1, -1, -1):
        f = frames[i]
        if f['type'] == '{' and not f.get('obj'):
            return None, None   # a function body: calls outside it are not this string's context
        if f['type'] == '(' and f['name'] and f['name'] not in TRANSPARENT:
            return i, f
    return None, None

def inner_array(frames, start=0):
    for i in range(len(frames) - 1, start - 1, -1):
        f = frames[i]
        if f['type'] == '[':
            return i, f
        if f['type'] == '(' and (not f['name'] or f['name'] in TRANSPARENT):
            continue
        return None, None
    return None, None

def inner_obj_key(frames, start=0):
    for i in range(len(frames) - 1, start - 1, -1):
        f = frames[i]
        if f['type'] == '{':
            return i, f
        if f['type'] == '[' or (f['type'] == '(' and (not f['name'] or f['name'] in TRANSPARENT)):
            continue
        return None, None
    return None, None

def lines_analysis(t, start, default='ミー', variants=False):
    frames = t['frames']; s = t['text']
    ai, arr = inner_array(frames, start)
    if arr is None:
        return default, ''
    first = arr['items'].get(0)
    if arr['idx'] == 0 and s in SPEAKERS and t['next'].startswith(','):
        return None, ''
    if arr['idx'] == 1 and first is not None and first in SPEAKERS:
        return SPEAKERS[first], ''
    if variants and (first is None or first not in SPEAKERS):
        return default, f'言い回し候補{arr["idx"] + 1}'
    return default, ''

def option_label(t, start):
    ai, arr = inner_array(t['frames'], start)
    if arr is not None and arr['idx'] == 0:
        return '選択肢', ''
    return None, ''

def concat_note(t):
    n = []
    if t['prev'] and t['prev'][-1] == '+': n.append('前に式をつなぐ')
    if t['next'].startswith('+'): n.append('後に式をつなぐ')
    return '／'.join(n)

def cond_from_prev(prev):
    toks = []; depth = 0
    for p in reversed(prev[:-1]):
        if p == ')': depth += 1
        elif p == '(':
            if depth == 0: break
            depth -= 1
        elif depth == 0 and p in (',', ';', '{', '[', 'say', 'return', '=', ':', '?'): break
        toks.append(p)
    toks.reverse()
    out = []
    for p in toks:
        if p.startswith('<str:'): out.append('「' + p[5:-1] + '」')
        elif p == '<tpl>': out.append('`…`')
        elif p == '<re>': out.append('/…/')
        else: out.append(p)
    s = ' '.join(out).replace(' ( ', '(').replace(' )', ')').replace('( ', '(').replace(' . ', '.').replace('. ', '.')
    return s.strip()

def table_header(title, src_name, extra=''):
    return [f'# {title}', '', f'元ファイル：`{src_name}`　（「文」の列だけ直してください。`\\n` は改行、`{{name}}` などの波括弧と `${{...}}` はそのまま。「行」「種別」「備考」は反映のための目印です{extra}）', '',
            '| 行 | 種別 | 文 | 備考 |', '|---|---|---|---|']

def extra_funcs(src):
    res = []
    for ln, l in enumerate(src.split('\n'), 1):
        m = re.match(r'^\(function (\w+)\(', l)
        if m: res.append((ln, m.group(1))); continue
        m = re.match(r"^\$\('#([\w-]+)'\)\.(on\w+) =", l)
        if m: res.append((ln, f'#{m.group(1)} {m.group(2)}')); continue
        m = re.match(r'^(A\.\w+|addEventListener|setInterval)\(', l)
        if m: res.append((ln, m.group(1)))
    return res

# ────────────────────────────── game.js ──────────────────────────────
def branch_labels(src):
    labels = {}
    for ln, l in enumerate(src.split('\n'), 1):
        if not re.match(r'^\s{2,4}(\}\s*)?(else )?if', l): continue
        m = re.search(r"(?:if|else if) \((?:id|app|target|action) === '([\w-]+)'", l)
        if m: labels[ln] = m.group(1); continue
        m = re.search(r"app\.startsWith\('(site|source):'\)", l)
        if m: labels[ln] = m.group(1) + ':'
    return labels

TITLE_KEYS = {'home', 'phone', 'photos', 'perms', 'msg', 'mi', 'history', 'notes', 'browser', 'settings', 'memory', 'proxy', 'scheduled', 'raw', 'shared'}
SOS_TEXTS = {'助けて。汐見センターに閉じ込められてる', '北棟の地下、体験室にいる。警察に連絡して', 'ミーの返信は私が書いたものじゃない。信じないで'}

def classify_game(t, fn):
    s = t['text']; fr = t['frames']; prev = t['prev']; nxt = t['next']
    if fn == 'harden':
        return (None, '') if s == '。' else ('置換（ミーの語尾）', '置き換え後の語')
    if fn == 'T': return None, ''
    if prev and prev[-1] in ('===', '!=='): return None, ''
    if len(prev) >= 2 and prev[-2] in ('===', '!==') and prev[-1].startswith('<str'): return None, ''
    if nxt.startswith(':') and fr and fr[-1]['type'] == '{' and fr[-1].get('obj') and prev and prev[-1] in ('{', ','): return None, ''
    if s == '・・・': return '画面の文（入力中の表示）', ''
    if PUNCT_ONLY.match(s) and s not in ('……', '……。', '？？？ '): return None, ''
    if s in SOS_TEXTS and fn == 'renderPhone': return 'あなた（送信文の候補）', ''
    if s == '朝までここで待つよ。' and fn == 'renderPhone': return 'あなた（改ざんされた履歴）', 'ミーが挿入した発言'
    if len(prev) >= 2 and prev[-1] == '=' and prev[-2].split('.')[-1] in ('textContent', 'placeholder', 'innerHTML', 'title', 'enterKeyHint'):
        return '画面の文', ''
    if '=' in prev:
        k = len(prev) - 1 - prev[::-1].index('=')
        if k >= 1 and prev[k - 1].split('.')[-1] in ('textContent', 'placeholder') and not any(p in ('(', '[', '{', ';') for p in prev[k + 1:]):
            return '画面の文', ''
    if prev and prev[-1] == '||' and fn in ('proNext', 'sendSos'): return ('あなた（既定のSOS文）' if fn == 'sendSos' else '画面の文（名前の既定値）'), ''
    if fn in ('showLine', 'openBag', 'titleDate', 'title', 'updateStatus'): return '画面の文', ''
    oi, obj = inner_obj_key(fr)
    ai, arr = inner_array(fr)
    if fn == 'extendedObject' and obj is not None and obj['key'] in ('water', 'lighter', 'shard1'): return 'ナレーション', obj['key']
    if fn == 'lobbyInteract' and obj is not None and obj['key'] in ('1', '2', '3'): return 'ナレーション（連結）', ''
    if fn == 'renderPhone' and obj is not None and obj['key'] in TITLE_KEYS and t['line'] < 946: return '画面の文（画面の題）', obj['key']
    if arr is not None and arr['idx'] == 0 and s not in SPEAKERS and OPTION_NEXT.match(nxt):
        return '選択肢', ''
    ci, call = named_call(fr)
    name = call['name'] if call else ''
    a = call['idx'] if call else None
    base = name.split('.')[-1]
    # ヒント（hintFor）の地の文：think(…) の中、pointStep の文、const missing の表。ミーの声は付かない。
    if any(f['type'] == '(' and f.get('name') == 'think' for f in fr) or (name == 'pointStep' and a == 1) \
            or (fn in HINT_FNS and 'const missing' in GAME_LINES[t['line'] - 1]):
        return 'ヒント（地の文）', ''
    # あとがき・ふりかえり・設定の画面の文（ミーの台詞を引用していても、声は付かない）
    if fn in PAGE_FNS:
        return '画面の文（あとがき・設定）', concat_note(t)
    if name == 'for':
        name = ''; base = ''; call = None; a = None
    if base in SKIP_CALLS or name in SKIP_CALLS:
        return None, ''
    if base == 'replace':
        if fn in ('T', 'whisperText', 'toggleBookmark'): return None, ''
        if fn == 'idleLine': return ('置換（曜日）', '{weekday} に入る語') if a == 1 else (None, '')
        return ('置換（結末の差し替え）' if fn == 'showEnding' else '置換'), ('置き換え前' if a == 0 else '置き換え後')
    if name == 'A.notify':
        if a == 0: return '通知の差出人', ''
        if a == 1: return '通知', concat_note(t)
        if a == 2: return '通知（表示される時刻）', ''
        return None, ''
    if name == 'notifyMi': return '通知', concat_note(t)
    if name == 'el': return ('画面の文', concat_note(t)) if a == 2 else (None, '')
    if name == 'phoneButton': return ('画面の文（ボタン）', concat_note(t)) if a == 1 else (None, '')
    if name == 'confirmPhone':
        return {0: ('画面の文（確認の題）', ''), 1: ('画面の文（確認の本文）', ''), 2: ('画面の文（ボタン）', '')}.get(a, (None, ''))
    if name == 'bagAction': return ('画面の文（ボタン）', '') if a == 0 else (None, '')
    if name == 'setBagCaption': return '画面の文（持ち物）', concat_note(t)
    if name == 'screen': return '画面の文（電話）', ''
    if name == 'contact': return ('画面の文（連絡先）', '') if a in (0, 1) else (None, '')
    if name == 'proBubble':
        if a == 1:
            k = call['items'].get(0, '')
            return {'narr': 'ナレーション', 'mi typing': 'ミー', 'mi': 'ミー'}.get(k, 'ミー'), ''
        return ('画面の文', '') if a == 2 else (None, '')
    if name in ('speakForce', 'speak', 'harden'): return 'ミー', ''
    if name == 'F': return 'ミー', ('ふだんの口調' if a == 0 else '丁寧な口調（訓練シナリオ接続中）')
    if name == 'room.showCode': return '画面の文（番号錠）', ''
    if name == 'room.setExtraScratch': return '3D表示（壁の字）', ''
    if name in ('play', 'ask', 'choices', 'voiceOnly'):
        lines_arg = {'play': 0, 'ask': 1, 'voiceOnly': 0}.get(name)
        opt_arg = {'play': 1, 'ask': 2, 'choices': 0}.get(name)
        if name == 'ask' and a == 0: return 'あなた', ''
        if a == lines_arg:
            ty, note = lines_analysis(t, ci + 1)
            if ty == 'ミー' and fn in HINT_FNS: ty = 'ヒント'
            if ty == 'ミー' and name == 'voiceOnly': ty = '暗転の声（ミー）'
            return ty, concat_note(t)
        if a == opt_arg: return option_label(t, ci + 1)
        return None, ''
    if base == 'push':
        objn = name[:-5]
        if objn == 'state.shared': return '画面の文（共有ログ）', ''
        if objn == 'missing': return 'ナレーション（連結）', '足りない物の名前'
        if objn == 'lines' and fn == 'showEnding': return '結末（本文）', ''
        if objn == 'perms': return '画面の文（権限）', ''
        if objn == 'special': return '通知（独り言）', ''
    if base == 'splice' and fn == 'renderPhone': return '画面の文（履歴）', ''
    if obj is not None and obj['key'] in ('title', 'text') and fn == 'SITE_INDEX': return '画面の文（検索索引）', obj['key']
    if obj is not None and obj['key'] == 'text':
        frm = obj['items'].get(0)
        if frm in FROM: return FROM[frm], concat_note(t)
        if fn == 'showEnding': return '結末（追記）', ''
        if fn == 'flushSnsPending': return 'つぶやきの返信', ''
        return '文', ''
    if obj is not None and obj['key'] == 'original': return 'あなた（元の文）', ''
    if fn in ('FLAVOR', 'STORAGE_FLAVOR') or (fn == 'interact' and obj is not None and obj['key'] in ('record', 'procedure', 'contacts', 'delay')):
        ty, note = lines_analysis(t, 0)
        return ty, (obj['key'] if obj is not None and obj['key'] else '')
    if fn == 'momBacklog' and arr is not None:
        return {1: 'お母さん', 2: '代理返信（ミー）'}.get(arr['idx'], None), ''
    if fn in ('replayLines', 'siteLines', 'idleLines', 'advice'):
        key = obj['key'] if obj is not None else ''
        if fn in ('siteLines', 'idleLines') and arr is not None: return 'ミー', f'{key}　{arr["idx"] + 1}行目'
        return 'ミー', key or ''
    if fn == 'suggestions': return '画面の文（入力欄の候補）', obj['key'] if obj else ''
    if fn == 'softenings': return '置換（強い言葉→やわらかく）', '置き換え後の語'
    if fn == 'secretSteps': return '画面の文（メモ）', ''
    if fn in ('siteNames', 'SITE_DOMAIN'): return '画面の文', ''
    if fn in ('renderPhone', 'yourNight', 'nightEvents', 'renderTitleMemory', 'renderLock', 'be3Sequence', 'applySpoilers', 'photoTools', 'stageEnding', 'voiceOnly'):
        if fn == 'renderLock' and (arr is None or arr['idx'] > 11) and not re.match(r'^[0-9消]$', s): return 'ミー', ''
        return '画面の文', concat_note(t)
    if fn == 'whisperText': return 'ミー（タイトル画面）', concat_note(t)
    if fn == 'idleLine':
        if arr is not None: return '通知（独り言）', f'候補{arr["idx"] + 1}'
        return '通知（独り言）', ''
    if fn == 'actionReply':
        ty, note = lines_analysis(t, 0)
        return ty, ''
    if fn == 'showEnding': return '結末（差し替え文）', concat_note(t)
    if fn == 'onConnection' and obj is not None: return '文', ''
    if fn in HINT_FNS: return (None, '') if s in SPEAKERS else ('ヒント', '')
    if fn == 'reset' and obj is not None and obj['items'].get(0) == 'mom': return 'お母さん', ''
    if arr is not None:
        ty, note = lines_analysis(t, 0)
        return ty, concat_note(t)
    if fn.startswith('#say'): return 'ミー', ''
    return '？', 'unclassified'

def gen_game():
    src = open(os.path.join(ROOT, 'game.js'), encoding='utf-8').read()
    GAME_LINES[:] = src.split('\n')
    fm = sorted(func_map(src) + extra_funcs(src)); labels = branch_labels(src)
    out = table_header('ゲーム本文：ナレーション・ミーの台詞・選択肢・スマホ画面・通知・ヒント（game.js）', 'game.js')
    cur = None
    SUBFN = {'interact', 'lobbyInteract', 'storageInteract', 'renderPhone', 'extendedObject', 'objectPuzzle', 'applyItem', 'operatePanel'}
    uncl = []
    for t in tokenize(src):
        s = t['text']; fn = enclosing(fm, t['line'])
        if fn == 'T': continue
        if not has_jp(s):
            ci, call = named_call(t['frames']); nm = call['name'] if call else ''
            keep = (nm in ('el', 'room.showCode', 'phoneButton') and call['idx'] in (1, 2) and not (nm == 'el' and call['idx'] == 1)) or (len(t['prev']) >= 2 and t['prev'][-1] == '=' and t['prev'][-2].split('.')[-1] == 'textContent')
            if not keep or len(s.strip()) < 2 or re.search(r'px|url\(|^[\w-]+$', s): continue
        ty, note = classify_game(t, fn)
        if ty is None: continue
        if fn in SUBFN:
            fstart = max(ln for ln, nm in fm if ln <= t['line'])
            cands = [ln for ln in labels if fstart <= ln <= t['line']]
            br = labels[max(cands)] if cands else None
        else: br = None
        head = fn + (('：' + ('スマホ：' if fn == 'renderPhone' else '') + br) if br else '')
        if head != cur:
            out.append(f'| | **▼ {head}** | | |'); cur = head
        if ty == '？': uncl.append((t['line'], fn, s[:40]))
        out.append(f'| {t["line"]} | {ty} | {esc(s)} | {esc(note)} |')
    return out, uncl

# ────────────────────────────── story.js ──────────────────────────────
def classify_story(t, fn):
    s = t['text']; fr = t['frames']; nxt = t['next']; prev = t['prev']
    if nxt.startswith(':') and fr and fr[-1]['type'] == '{' and fr[-1].get('obj') and prev and prev[-1] in ('{', ','): return None, ''
    oi, obj = inner_obj_key(fr); ai, arr = inner_array(fr)
    if fn == 'prologue':
        if obj is not None and obj['key'] in ('title', 'body', 'button'):
            return {'title': 'システムカード（題）', 'body': 'システムカード（本文）', 'button': 'システムカード（ボタン）'}[obj['key']], ''
        if obj is not None and obj['key'] == 'text':
            ty = obj['items'].get(0)
            return {'mi': 'ミー', 'me': 'あなた', 'mom': 'お母さん', 'proxy': '代理返信（ミー）', 'narr': 'ナレーション'}.get(ty, '文'), ''
        if obj is not None and obj['key'] == 'options' and arr is not None and arr['idx'] == 0: return '選択肢', ''
        return None, ''
    if fn in ('summarizedBefore', 'rawBefore'):
        if arr is not None and arr['idx'] == 1:
            who = arr['items'].get(0, '')
            return {'ミー': 'ミー', '{name}': 'あなた', 'システム': 'システム'}.get(who, who), ''
        return None, ''
    if fn == 'endings':
        key = obj['key'] if obj else ''
        return {0: '結末（種類）', 1: '結末（題）', 2: '結末（本文）'}.get(arr['idx'] if arr else -1, '文'), key
    if fn == 'voiceLines': return '暗転の声（ミー）', (obj['key'] if obj else '') + f'　{arr["idx"] + 1}行目'
    if fn == 'itemNames': return '持ち物の名前', obj['key'] if obj else ''
    if fn == 'itemDetails': return '持ち物の説明', obj['key'] if obj else ''
    if fn == 'evidenceDates': return '証拠の日付（メモの並べ替え用）', obj['key'] if obj else ''
    if fn == 'evidenceNotes':
        return {0: '証拠メモ（題）', 1: '証拠メモ（本文）'}.get(arr['idx'] if arr else -1, '文'), obj['key'] if obj else ''
    if fn == 'sources':
        outer = ''
        for f in fr:
            if f['type'] == '{' and f['key'] in ('scenario', 'facility', 'ops', 'none'): outer = f['key']
        if obj is not None and obj['key'] == 'title': return '参照元（題）', outer
        if obj is not None and obj['key'] == 'meta': return '参照元（情報）', outer
        if obj is not None and obj['key'] == 'lines': return '参照元（本文）', f'{outer}　{arr["idx"] + 1}行目'
        return '文', outer
    if fn == 'CODES':
        if obj is not None and obj['key'] == 'code': return '番号錠のコード', f'セット{[f for f in fr if f["type"] == "["][0]["idx"] + 1}'
        return None, ''
    if fn == 'ADMIN_CODE': return '管理者ロックのコード', ''
    if fn == 'PARTNER_ID': return 'パートナーID', ''
    return None, ''

def gen_story():
    src = open(os.path.join(ROOT, 'story.js'), encoding='utf-8').read()
    fm = func_map(src)
    out = table_header('導入・生ログ・結末・持ち物・証拠・参照元（story.js）', 'story.js')
    cur = None
    for t in tokenize(src):
        fn = enclosing(fm, t['line']); s = t['text']
        if not has_jp(s) and fn not in ('CODES', 'ADMIN_CODE', 'PARTNER_ID', 'evidenceDates', 'endings'): continue
        ty, note = classify_story(t, fn)
        if ty is None: continue
        if fn != cur:
            out.append(f'| | **▼ {fn}** | | |'); cur = fn
        out.append(f'| {t["line"]} | {ty} | {esc(s)} | {esc(note)} |')
    return out

# ────────────────────────────── mi-brain.js ──────────────────────────────
def gen_mibrain():
    src = open(os.path.join(ROOT, 'mi-brain.js'), encoding='utf-8').read()
    lines = src.split('\n'); fm = func_map(src)
    out = table_header('ミーの自由会話の応答（mi-brain.js）', 'mi-brain.js', '。備考は分岐条件の要約（「入力に /…/」は、話しかけた文がその正規表現に当たるとき）')
    block_cond = ''; conds = {}
    ns_start = next((i for i, l in enumerate(lines, 1) if 'function nextStep()' in l), 0)
    ns_end = next((i for i, l in enumerate(lines, 1) if i > ns_start and l.rstrip() == '  }'), 0) if ns_start else -1
    for ln, l in enumerate(lines, 1):
        st = l.strip()
        m = re.match(r'^(?:\}\s*)?(?:else\s+)?if\s*\((.*?)\)\s*(?:\{|say|src|effects|state|return|options|const)', st)
        c = m.group(1) if m else ('それ以外（上の条件が偽）' if st.startswith('else') else '')
        if re.match(r'^\s{2}(?:if|else)', l) and m: block_cond = c
        elif re.match(r'^\s{4,}', l) and c: c = (block_cond + ' → ' + c) if block_cond and block_cond != c else c
        elif re.match(r'^\s{4,}', l) and not c and block_cond: c = block_cond
        conds[ln] = c
    def short(c):
        c = re.sub(r'\s+', ' ', c).replace("r(/", "入力に /").replace('/)', '/').replace('/i)', '/i')
        return c[:120] + ('…' if len(c) > 120 else '')
    cur = None
    for t in tokenize(src):
        s = t['text']; fn = enclosing(fm, t['line']); fr = t['frames']; prev = t['prev']; nxt = t['next']
        if not has_jp(s): continue
        if re.match(r'^(ask|open|source):', s): continue
        if prev and prev[-1] in ('===', '!=='): continue
        if nxt.startswith(':') and fr and fr[-1]['type'] == '{' and fr[-1].get('obj') and prev and prev[-1] in ('{', ','): continue
        ci, call = named_call(fr); name = call['name'] if call else ''
        base = name.split('.')[-1]
        ty = None; note = conds.get(t['line'], '')
        if fn == 'swaps': ty, note = '置換（あなたの言葉のねじ曲げ）', '置き換え後の語'
        elif fn == 'misquote': ty, note = 'ミー（引用のねじ曲げ）', '引用の後に付ける'
        elif s == 'たぶん、': ty, note = 'ミー（先頭に付加）', '「わからないときは言って」と頼まれた後、断定の文の頭に付く'
        elif base in SKIP_CALLS or name in SKIP_CALLS: ty = None
        elif name == 'say':
            ty, n2 = lines_analysis(t, ci + 1, variants=True)
            if n2: note = (note + '　／ ' + n2).strip('　')
        elif name == 'P':
            ty = 'ミー'; note = (note + '　／ ' + ('ふだんの口調' if call['idx'] == 0 else '丁寧な口調（訓練シナリオ接続中）')).strip('　')
        elif name == 'v':
            ty = 'ミー'; note = (note + f'　／ 言い回し候補{call["idx"] + 1}').strip('　')
        elif name == 'options.push':
            ty, _ = option_label(t, ci + 1)
        elif base == 'replace' and fn == 'reply': ty = 'ミー'
        else:
            oi, obj = inner_obj_key(fr); ai, arr = inner_array(fr)
            if obj is not None and obj['key'] in ('ops', 'facility', 'scenario', 'none') and fn == 'reply': ty, note = 'ミー（参照元の名前）', obj['key']
            elif arr is not None and arr['idx'] == 0: ty = '選択肢'
            elif fn == 'reply' and prev and prev[-1] in ('?', ':', '+', '(', ','): ty = 'ミー'
            else: ty = '？'
        # nextStep（「どうすれば？」の答え）は配列で台詞を返す。選択肢ではなくミーの台詞。
        if ty == '選択肢' and ns_start <= t['line'] <= ns_end: ty = 'ミー'
        if ty is None: continue
        if prev and prev[-1] == '?' and s != 'たぶん、':
            note = (note + '　／ ' + cond_from_prev(prev) + ' のとき').strip('　')
        elif prev and prev[-1] == ':' and len(prev) >= 2 and prev[-2].startswith('<str'):
            note = (note + '　／ 上の条件が偽のとき').strip('　')
        if fn != cur:
            out.append(f'| | **▼ {fn}** | | |'); cur = fn
        out.append(f'| {t["line"]} | {ty} | {esc(s)} | {esc(short(note))} |')
    return out

# ────────────────────────────── scene.js / items-models.js ──────────────────────────────
PAPER_KEYS = {'title': '文書：題', 'meta': '文書：日付・発行', 'to': '文書：宛先', 'body': '文書：本文', 'table': '文書：表', 'closing': '文書：結び', 'stamp': '文書：印', 'footer': '文書：脚注', 'heading': '文書：見出し', 'tag': '文書：タグ', 'contact': '文書：連絡先', 'highlight': '文書：強調語'}

def classify_scene(t, fn):
    s = t['text']; fr = t['frames']; prev = t['prev']; nxt = t['next']
    if is_font(s): return None, ''
    if prev and prev[-1] in ('===', '!=='): return None, ''
    if nxt.startswith(':') and fr and fr[-1]['type'] == '{' and fr[-1].get('obj') and prev and prev[-1] in ('{', ','): return None, ''
    ci, call = named_call(fr); name = call['name'] if call else ''; base = name.split('.')[-1]
    a = call['idx'] if call else None
    if name == 'for': name = ''; base = ''; call = None; a = None
    if base in SKIP_CALLS or name in SKIP_CALLS: return None, ''
    if name == 'register': return ('対象の名前（マーカー）', '') if a == 1 else (None, '')
    if name == 'label': return '札・表示', ''
    if name == 'makeDoor': return ('扉の札', '') if a == 1 else (None, '')
    if name in ('ctx.fillText', 'vtext', 'gouge', 'fillText'): return '描き文字', ''
    if name == 'canTexture':
        oi, obj = inner_obj_key(fr, ci + 1); k = obj['key'] if obj else ''
        return {'text': '缶の銘柄', 'small': '缶の表記'}.get(k, '缶の表記'), ('引数の既定値' if fn == 'canTexture' else '')
    if name == 'wrapperTexture':
        oi, obj = inner_obj_key(fr, ci + 1); k = obj['key'] if obj else ''
        return {'text': '袋の銘柄', 'sub': '袋の表記'}.get(k, '袋の表記'), ''
    if name == 'calendarTexture': return 'カレンダーの印', ''
    if name == 'paper':
        oi, obj = inner_obj_key(fr, ci + 1); k = obj['key'] if obj else ''
        if k in PAPER_KEYS:
            note = ''
            if k == 'table':
                ai, arr = inner_array(fr, ci + 1)
                if arr is not None: note = f'列{arr["idx"] + 1}'
            return PAPER_KEYS[k], note
        for f in fr[ci + 1:]:
            if f['type'] == '{' and f['key'] == 'table':
                ai, arr = inner_array(fr, ci + 1)
                return '文書：表', f'列{arr["idx"] + 1}' if arr else ''
        if fn == 'paper': return '文書：見出し', '引数の既定値'
        return '文書', k
    if name == 'canvasTexture' or (call and 'Texture' in name): return '描き文字', ''
    if fn == 'calendarTexture': return '描き文字', ''
    if fn == 'planTexture': return '経路図の文字', ''
    if fn == 'newspaperTexture': return '新聞の文字', ''
    ai, arr = inner_array(fr)
    if arr is not None:
        if 1148 <= t['line'] <= 1160 and fn == 'createRoom': return 'キーパッドの文字', ''
        return '描き文字（配列）', ''
    return '？', 'unclassified'

def gen_scene():
    out = table_header('張り紙・文書・3D内の表示（scene.js、items-models.js）', 'scene.js／items-models.js')
    uncl = []
    for fname in ('scene.js', 'items-models.js'):
        src = open(os.path.join(ROOT, fname), encoding='utf-8').read()
        lines = src.split('\n'); fm = func_map(src)
        comments = {ln: l.strip()[3:] for ln, l in enumerate(lines, 1) if re.match(r'^  // [A-Z]', l)}
        registers = {}
        for ln, l in enumerate(lines, 1):
            for m in re.finditer(r"register\('([\w-]+)', '([^']+)'", l): registers[ln] = m.group(2)
        out.append(f'| | **▼▼ {fname}** | | |')
        cur = None
        for t in tokenize(src):
            s = t['text']; fn = enclosing(fm, t['line'])
            if fn in ('MINCHO', 'HAND', 'JP', 'MIN'): continue
            if not has_jp(s):
                ci, call = named_call(t['frames']); nm = call['name'] if call else ''
                if is_font(s) or (re.match(r'^[\w-]+$', s) and not re.match(r'^\d', s)): continue
                if not (nm in ('ctx.fillText', 'vtext', 'gouge', 'label', 'canTexture', 'wrapperTexture', 'paper', 'register') or any(f['name'] in ('label', 'paper', 'canTexture', 'wrapperTexture') for f in t['frames'])):
                    continue
                if len(s.strip()) < 2 or re.match(r'^[a-z]+-[\w-]+$', s): continue
            ty, note = classify_scene(t, fn)
            if ty is None: continue
            if fn == 'createRoom':
                cands = [ln for ln in comments if ln <= t['line']]
                ctext = comments[max(cands)] if cands else ''
                head = 'createRoom：' + ctext[:50]
                special = {'Cardboard': '段ボール箱の印字', 'Inside: a helmet': 'ロッカー内の配布資料（しおり）', 'Facility poster': '壁のポスター', 'Bento': 'コンビニ袋の中の弁当', 'Two short strips of hazard tape': '床の立入禁止テープ', 'Tins on the middle shelf': '資材庫の棚'}
                sp = next((v for k, v in special.items() if ctext.startswith(k)), None)
                if sp and not note: note = '対象：' + sp
                else:
                    near = sorted(((abs(ln - t['line']) - (0 if ln >= t['line'] else 5), ln) for ln in registers if abs(ln - t['line']) <= 30))
                    if near and not note: note = '対象：' + registers[near[0][1]]
            else: head = fn
            if head != cur:
                out.append(f'| | **▼ {head}** | | |'); cur = head
            if ty == '？': uncl.append((fname, t['line'], s[:40]))
            out.append(f'| {t["line"]} | {ty} | {esc(s)} | {esc(note)} |')
    return out, uncl

# ────────────────────────────── HTML (05 / 06) ──────────────────────────────
BLOCK = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div', 'section', 'article', 'header', 'footer', 'nav', 'tr', 'dt', 'dd', 'br', 'hr', 'button', 'figcaption', 'blockquote', 'details', 'summary', 'table', 'ul', 'ol', 'main', 'aside', 'form', 'label', 'option', 'time', 'address', 'caption'}
SKIP_TAGS = ('script', 'style', 'svg', 'noscript', 'template')

class Text(HTMLParser):
    def __init__(self, only_id=None):
        super().__init__(convert_charrefs=True)
        self.lines = []; self.cur = []; self.skip = 0; self.stack = []; self.prefix = ''
        self.only_id = only_id; self.inside = only_id is None; self.depth_at = None; self.depth = 0
    def flush(self):
        txt = re.sub(r'[ \t\r\n]+', ' ', ''.join(self.cur)).strip()
        if txt: self.lines.append(self.prefix + txt)
        self.cur = []; self.prefix = ''
    def handle_starttag(self, tag, attrs):
        a = dict(attrs); self.depth += 1
        if self.only_id and not self.inside and a.get('id') == self.only_id: self.inside = True; self.depth_at = self.depth
        if tag in SKIP_TAGS: self.skip += 1; return
        if not self.inside: return
        if tag in BLOCK:
            self.flush()
            if tag in ('h1', 'h2', 'h3', 'h4'): self.prefix = '#' * int(tag[1]) + ' '
            elif tag == 'li': self.prefix = '- '
            elif tag == 'dt': self.prefix = '**Q.** '
            elif tag == 'dd': self.prefix = 'A. '
            elif tag == 'button': self.prefix = '［ボタン］'
            elif tag == 'option': self.prefix = '［選択肢］'
        for k in ('placeholder', 'aria-label', 'title', 'alt'):
            if a.get(k) and has_jp(a[k]): self.lines.append(f'［{k}］{a[k]}')
        if tag == 'a' and a.get('href', '').startswith('http'): self.stack.append(a['href'])
        else: self.stack.append(None)
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs); self.handle_endtag(tag)
    def handle_endtag(self, tag):
        if tag in SKIP_TAGS: self.skip = max(0, self.skip - 1); self.depth -= 1; return
        if self.inside:
            if tag == 'a' and self.stack:
                href = self.stack.pop()
                if href: self.cur.append(f'（{href}）')
            elif self.stack: self.stack.pop()
            if tag in ('a', 'b', 'strong', 'span', 'em', 'i', 'small', 'time', 'code'):
                cur = ''.join(self.cur)
                if cur and not re.search(r'[\s。、！？」』》：]$', cur): self.cur.append('　')
            if tag in BLOCK: self.flush()
        if self.only_id and self.inside and self.depth == self.depth_at: self.flush(); self.inside = False
        self.depth -= 1
    def handle_data(self, data):
        if self.skip or not self.inside: return
        self.cur.append(data)

def html_text(path, only_id=None):
    p = Text(only_id); p.feed(open(path, encoding='utf-8').read()); p.flush()
    res = []
    for l in p.lines:
        if res and res[-1] == l: continue
        res.append(l)
    return res

def gen_column():
    lines = html_text(os.path.join(ROOT, 'index.html'), 'column')
    out = ['# あとがき（index.html の #column）', '', '元ファイル：`index.html` の `<section id="column">`。HTML を除いた本文です。文章を直接書き換えてください。', '結末ごとに差し込まれる「今回の記録」「あなたの夜」の文は 02_game.md の nightEvents／yourNight にあります。', '']
    for l in lines:
        if l in ('×', '［ボタン］×') or l.startswith('［aria-label］閉じる'): continue
        out.append(l); out.append('')
    return out

def gen_site(page, title):
    path = os.path.join(ROOT, page, 'index.html')
    lines = html_text(path)
    out = [f'# {title}（{page}/index.html）', '', f'元ファイル：`{page}/index.html`。HTML を除いた本文です。文章を直接書き換えてください。', '']
    for l in lines:
        out.append(l); out.append('')
    return out

def gen_sns():
    path = os.path.join(ROOT, 'sns', 'index.html')
    src = open(path, encoding='utf-8').read()
    out = gen_site('sns', 'つぶやき')
    m = re.search(r'<script>\n(.*?)</script>', src, re.S)
    js = m.group(1); js_start = src[:m.start(1)].count('\n') + 1
    def L(off): return js_start + js[:off].count('\n')
    users = {}
    for um in re.finditer(r"^\s+(\w+): \{ (.*?) \},?$", js, re.M):
        key, body = um.group(1), um.group(2)
        def g(k):
            mm = re.search(k + r": (?:'((?:[^'\\]|\\.)*)'|`([^`]*)`)", body)
            if not mm: return ''
            return mm.group(1) if mm.group(1) is not None else mm.group(2)
        if 'handle' in body: users[key] = {'name': g('name'), 'handle': g('handle'), 'bio': g('bio'), 'meta': g('meta'), 'line': L(um.start())}
    out += ['## ユーザー（名前／@ID／自己紹介／プロフィールの行）', '', '| 行 | key | 名前 | @ID | 自己紹介（bio） | meta |', '|---|---|---|---|---|---|']
    for k, u in users.items():
        out.append(f"| {u['line']} | {k} | {esc(u['name']) or '（{me}＝あなたの名前）'} | @{u['handle']} | {esc(u['bio'])} | {esc(u['meta'])} |")
    out += ['', '## 投稿と返信（JS内）', '', '書き方：`- 【id・行】投稿者：本文` ／ 返信は `  - ↳ 返信者：本文`。本文の `\\n` は改行。（ ）内は表示される条件など。', '']
    cond_map = {'w1': 'ミーが通報した夜に表示（world.reported）', 'w2': '映像を止めたあとに表示（world.screenStopped）', 'w3': '通報あり＋TRUE／SECRET到達で表示', 'g1': '通報ありで表示（world.reportedAt）', 'p2': '母への「泊まるね」が送られたあとに表示（when: momFooled）'}
    for pm in re.finditer(r"\{ id: '(\w+)', u: '(\w+)',(.*?)replies: \[(.*?)\](?:, when: '(\w+)')?(?:, alert: true)? \}", js, re.S):
        pid, u, head, reps, when = pm.groups()
        if pid == 'ghost': continue
        tm = re.search(r"text: (?:'((?:[^'\\]|\\.)*)'|`([^`]*)`)", head)
        text = tm.group(1) if tm.group(1) is not None else tm.group(2)
        cond = cond_map.get(pid, f'when: {when}' if when else '')
        uname = users.get(u, {}).get('name', u) or 'あなた'
        extra = []
        if 'ad: true' in head: extra.append('広告')
        if 'photo:' in head: extra.append('写真つき')
        if pid.startswith('n') or pid.startswith('d'): extra.append('過去の投稿')
        tag = ('　（' + '、'.join(extra + ([cond] if cond else [])) + '）') if (extra or cond) else ''
        out.append(f"- 【{pid}・{L(pm.start())}行】{uname}（@{users.get(u, {}).get('handle', u)}）{tag}：{esc(text)}")
        for rm in re.finditer(r"\{ u: '(\w+)', m: [^,]+, text: (?:'((?:[^'\\]|\\.)*)'|`([^`]*)`) \}", reps):
            ru = rm.group(1); rt = rm.group(2) if rm.group(2) is not None else rm.group(3)
            out.append(f"  - ↳ {users.get(ru, {}).get('name', ru)}：{esc(rt)}")
        out.append('')
    gm = re.search(r"mine\.unshift\(\{ id: 'ghost'.*?text: '((?:[^'\\]|\\.)*)', via: '([^']*)'.*?replies: \[\{ u: '(\w+)', m: 0, text: '((?:[^'\\]|\\.)*)' \}\]", js, re.S)
    if gm:
        out.append(f"- 【ghost・{L(gm.start())}行】あなた（{gm.group(2)} から投稿）　（BAD／HAPPY END のあと、自分の名前で勝手に投稿されたもの）：{esc(gm.group(1))}")
        out.append(f"  - ↳ {users.get(gm.group(3), {}).get('name', gm.group(3))}：{esc(gm.group(4))}")
        out.append('')
    out += ['## 自分の投稿への自動返信（deliver：電波が戻って投稿が送信されたとき）', '']
    for dm in re.finditer(r"p\.replies\.push\(\{ u: '(\w+)', m: 0, text: (.*?) \}\)", js):
        for s in re.findall(r"`([^`]*)`", dm.group(2)):
            out.append(f"- 【{L(dm.start())}行】{users.get(dm.group(1), {}).get('name', dm.group(1))}：{esc(s)}")
    out.append('')
    out += ['## 通知タブ・画面の文（JS内）', '', '| 行 | 文 |', '|---|---|']
    seen = set()
    p0, p1 = js.find('const users = {'), js.find('let store =')
    offs = [0]
    for l in js.split('\n'): offs.append(offs[-1] + len(l) + 1)
    for t in tokenize(js):
        s = t['text']
        if not has_jp(s) or len(s) < 2: continue
        off = offs[t['line'] - 1]
        if p0 <= off < p1: continue
        if s.startswith('@you') or t['line'] + js_start - 1 == (L(gm.start()) if gm else -1): continue
        if t['next'].startswith(':') and t['frames'] and t['frames'][-1]['type'] == '{' and t['frames'][-1].get('obj') and t['prev'] and t['prev'][-1] in ('{', ','): continue
        abs_ln = js_start + t['line'] - 1
        if (abs_ln, s) in seen: continue
        seen.add((abs_ln, s))
        out.append(f'| {abs_ln} | {esc(s)} |')
    return out

if __name__ == '__main__':
    which = sys.argv[1:] or ['story', 'game', 'mibrain', 'scene', 'html']
    os.makedirs(OUT, exist_ok=True)
    def w(name, lines): open(os.path.join(OUT, name), 'w', encoding='utf-8').write('\n'.join(lines).rstrip('\n') + '\n')
    if 'story' in which: w('01_story.md', gen_story())
    if 'game' in which:
        out, uncl = gen_game(); w('02_game.md', out)
        print('game unclassified:', len(uncl)); [print('  ', u) for u in uncl]
    if 'mibrain' in which: w('03_mi-brain.md', gen_mibrain())
    if 'scene' in which:
        out, uncl = gen_scene(); w('04_scene.md', out)
        print('scene unclassified:', len(uncl)); [print('  ', u) for u in uncl]
    if 'html' in which:
        w('05_あとがき.md', gen_column())
        w('06_公式サイト.md', gen_site('shiomi', '公式サイト'))
        w('06_ミーサポート.md', gen_site('mii', 'ミーサポート'))
        w('06_汐見タイムズ.md', gen_site('news', '汐見タイムズ'))
        w('06_つぶやき.md', gen_sns())
