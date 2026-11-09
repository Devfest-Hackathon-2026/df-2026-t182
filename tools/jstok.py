"""Tiny JS string-literal extractor with bracket/call context.
Yields dicts: line, text (raw, \\n kept literal, quotes unescaped), kind ('s'|'d'|'t'),
frames: list of frames from outermost to innermost; each frame = dict(type, name, idx, key, items)
prev: preceding significant tokens (for things like `textContent =`).
"""
import re, sys

JP = re.compile(r'[぀-ヿ㐀-鿿！-｠…　-〿]')
IDENT = re.compile(r'[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*')

def has_jp(s):
    return bool(JP.search(s))

def tokenize(src):
    """Return list of string tokens with context."""
    n = len(src); i = 0; line = 1
    frames = []          # stack of dict(type, name, idx, key, items)
    prev = []            # last few significant tokens (strings)
    out = []
    last_sig = ''        # last significant token text (for regex detection)
    regex_prev = {'(', ',', '=', ':', '[', '!', '&&', '||', '?', '{', '}', ';', 'return', '&', '|', '', '=>', 'typeof', 'case', '+'}
    pending_key = None   # last identifier/string seen inside an object literal before ':'
    tmpl_stack = []      # for template literal nesting: depth of frames at ${ start

    def push(tp, name=None):
        obj = tp == '{' and bool(prev) and prev[-1] in ('=', '(', ',', ':', 'return', '[', '?', '||', '&&', '...', '??')
        frames.append({'type': tp, 'name': name, 'idx': 0, 'key': None, 'items': {}, 'line': line, 'obj': obj})

    def record_string(text, kind, start_line):
        fr = [dict(f, items=dict(f['items'])) for f in frames]
        j = i
        while j < n and src[j] in ' \t\r\n': j += 1
        out.append({'line': start_line, 'text': text, 'kind': kind, 'frames': fr, 'prev': list(prev[-14:]), 'next': src[j:j + 40]})
        if frames:
            f = frames[-1]
            f['items'].setdefault(f['idx'], text)

    def read_string(q):
        nonlocal i, line
        start_line = line; i += 1; buf = []
        while i < n:
            c = src[i]
            if c == '\\':
                nx = src[i+1]
                if nx in (q, '\\'):
                    buf.append(nx); i += 2; continue
                buf.append(c); buf.append(nx); i += 2
                if nx == '\n': line += 1
                continue
            if c == q:
                i += 1; break
            if c == '\n': line += 1
            buf.append(c); i += 1
        return ''.join(buf), start_line

    def read_template():
        # returns raw text with ${...} kept verbatim; nested strings inside ${} are also recorded
        nonlocal i, line
        start_line = line; i += 1; buf = []
        while i < n:
            c = src[i]
            if c == '\\':
                nx = src[i+1]
                if nx in ('`', '\\', '$'):
                    buf.append(nx); i += 2; continue
                buf.append(c); buf.append(nx); i += 2; continue
            if c == '`':
                i += 1; break
            if c == '$' and src[i+1] == '{':
                # find matching }
                depth = 0; j = i + 1
                while j < n:
                    ch = src[j]
                    if ch in "'\"":
                        # skip string
                        k = j + 1
                        while k < n and src[k] != ch:
                            if src[k] == '\\': k += 1
                            k += 1
                        j = k + 1; continue
                    if ch == '`':
                        # nested template: skip crudely
                        k = j + 1
                        while k < n and src[k] != '`':
                            if src[k] == '\\': k += 1
                            k += 1
                        j = k + 1; continue
                    if ch == '{': depth += 1
                    elif ch == '}':
                        depth -= 1
                        if depth == 0: break
                    j += 1
                expr = src[i:j+1]
                line += expr.count('\n')
                buf.append(expr); i = j + 1; continue
            if c == '\n': line += 1
            buf.append(c); i += 1
        return ''.join(buf), start_line

    while i < n:
        c = src[i]
        if c == '\n':
            line += 1; i += 1; continue
        if c in ' \t\r':
            i += 1; continue
        if src.startswith('//', i):
            j = src.find('\n', i); i = n if j < 0 else j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2
            line += src[i:j].count('\n'); i = j; continue
        if c in "'\"":
            text, sl = read_string(c)
            record_string(text, 's' if c == "'" else 'd', sl)
            last_sig = '<str>'; prev.append('<str:' + text[:20] + '>')
            continue
        if c == '`':
            text, sl = read_template()
            record_string(text, 't', sl)
            last_sig = '<str>'; prev.append('<tpl>')
            continue
        if c == '/':
            if last_sig in regex_prev or last_sig.endswith('('):
                # regex literal
                j = i + 1; in_cls = False
                while j < n:
                    ch = src[j]
                    if ch == '\\': j += 2; continue
                    if ch == '[': in_cls = True
                    elif ch == ']': in_cls = False
                    elif ch == '/' and not in_cls: break
                    elif ch == '\n': break
                    j += 1
                j += 1
                while j < n and src[j].isalpha(): j += 1
                prev.append('<re>'); last_sig = '<re>'; i = j; continue
            i += 1; last_sig = '/'; prev.append('/'); continue
        if c == '(':
            # call name = previous identifier if directly preceding
            name = None
            if prev and IDENT.fullmatch(prev[-1] or ''):
                name = prev[-1]
            push('(', name); last_sig = '('; prev.append('('); i += 1; continue
        if c == '[':
            push('['); last_sig = '['; prev.append('['); i += 1; continue
        if c == '{':
            push('{'); last_sig = '{'; prev.append('{'); i += 1; continue
        if c in ')]}':
            if frames: frames.pop()
            last_sig = c; prev.append(c); i += 1; continue
        if c == ',':
            if frames: frames[-1]['idx'] += 1; frames[-1]['key'] = None
            last_sig = ','; prev.append(','); i += 1; continue
        if c == ':' and frames and frames[-1]['type'] == '{' and prev:
            if len(prev) >= 2 and prev[-2] in ('{', ','):
                k = prev[-1]
                if k.startswith('<str:'): k = k[5:-1]
                frames[-1]['key'] = k
            last_sig = ':'; prev.append(':'); i += 1; continue
        m = IDENT.match(src, i)
        if m:
            tok = m.group(0); i = m.end(); last_sig = tok; prev.append(tok); continue
        # operators / numbers
        m2 = re.match(r'=>|&&|\|\||===|!==|==|!=|<=|>=|\+\+|--|\?\?|\?\.|[-+*%<>=!?&|~^;:.]|\d[\w.]*', src[i:])
        if m2:
            tok = m2.group(0); i += len(tok); last_sig = tok; prev.append(tok); continue
        i += 1
    return out

def func_map(src):
    """Return list of (line, name) for top-level and 2-space-indented function/const defs."""
    res = []
    for ln, l in enumerate(src.split('\n'), 1):
        m = re.match(r'^(?:export )?(?:async )?function\s+(\w+)', l) or re.match(r'^(?:export )?(?:const|let)\s+(\w+)\s*=', l)
        if m: res.append((ln, m.group(1)))
    return res

def enclosing(fm, line):
    name = ''
    for ln, nm in fm:
        if ln <= line: name = nm
        else: break
    return name

def md_escape(s):
    return s.replace('|', '｜').replace('\n', '\\n')

if __name__ == '__main__':
    src = open(sys.argv[1], encoding='utf-8').read()
    fm = func_map(src)
    for t in tokenize(src):
        if not has_jp(t['text']): continue
        chain = '>'.join((f['name'] or f['type']) + str(f['idx']) for f in t['frames'][-4:])
        print(t['line'], enclosing(fm, t['line']), chain, repr(t['text'][:60]))
