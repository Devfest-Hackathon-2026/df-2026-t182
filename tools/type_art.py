#!/usr/bin/env python3
"""Put the 8 type characters (結果画面の「タイプのミー」) into assets/img/types/<ID>.webp.

Usage:
  python3 tools/type_art.py <folder>                 # 確認して、差し替える
  python3 tools/type_art.py <folder> --dry-run       # 確認と一覧画像だけ（ゲームのファイルは変えない）
  python3 tools/type_art.py <folder> --fit each      # 1枚ずつ、描かれた範囲いっぱいに合わせる
  python3 tools/type_art.py <folder> --scale MGD=1.1 # その ID だけ大きく（小さくは 0.9 など）

<folder> には SCW.png … MGD.png（ファイル名は ID）を置く。一部の ID だけでもよい（ない ID は今の画像のまま）。

--fit（大きさの合わせ方）
  canvas … 既定。届いた画像の構図のまま縮小する。8枚が同じ構図で描かれていれば、体の大きさがそろう。
  each   … 1枚ずつ、描かれた範囲（道具を含む）いっぱいに合わせる。構図がばらばらな画像用。
           道具が横に広いキャラほど体が小さくなるので、--scale で直す。

出力：480×480 の透過 webp（結果画面・一覧・共有カード・記録のサムネイルが、すべてこれを読む）。
アルファ 16 以下の薄いもやは消す。一覧画像（暗い背景に 56px と 184px で並べたもの）を <folder>/_preview.png に書く。
"""
import argparse, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'img', 'types')
IDS = ['SCW', 'SCD', 'SGW', 'SGD', 'MCW', 'MCD', 'MGW', 'MGD']  # report.js の ORDER と同じ並び
SIZE = 480          # report.js が width/height に書いている大きさ
HAZE = 16           # これ以下のアルファは消す
MARGIN = 0.03       # --fit each のときの余白（一辺に対する割合）
BG = (16, 24, 22)   # #101816（結果画面の背景）


def load(path):
    im = Image.open(path)
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    r, g, b, a = im.split()
    return Image.merge('RGBA', (r, g, b, a.point(lambda v: 0 if v <= HAZE else v)))


def check(key, raw, im):
    """問題があれば文を返す（なければ空）。数値は描かれた範囲（道具を含む）。"""
    notes = []
    w, h = raw.size
    if w != h:
        notes.append(f'正方形ではない（{w}×{h}）。中央に置いて正方形にする')
    if 'A' not in raw.getbands():
        notes.append('透過がない（背景ごと出る）')
        return notes
    solid = im.getchannel('A').point(lambda v: 255 if v > 128 else 0)
    box = solid.getbbox()
    if not box:
        notes.append('中身がない')
        return notes
    x0, y0, x1, y1 = box
    if x0 == 0 or y0 == 0 or x1 == w or y1 == h:
        notes.append('キャンバスの端で切れている')
    return notes


def framing(raw, im):
    box = im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
    if not box:
        return '—'
    w, h = im.size
    text = f'高さ{(box[3] - box[1]) / h:.0%} 足元から下端{(h - box[3]) / h:.0%}'
    if 'A' in raw.getbands():
        hist = raw.getchannel('A').histogram(); used = sum(hist[1:])
        haze = sum(hist[1:HAZE + 1]) / used if used else 0
        if haze >= 0.005:
            text += f'（薄いもや{haze:.0%}を消した）'
    return text


def square(im):
    w, h = im.size
    if w == h:
        return im
    s = max(w, h)
    c = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    c.paste(im, ((s - w) // 2, (s - h) // 2))
    return c


def fit(im, mode, scale):
    im = square(im)
    if mode == 'each':
        x0, y0, x1, y1 = im.getchannel('A').getbbox()
        side = max(x1 - x0, y1 - y0)
        side = round(side * (1 + MARGIN * 2))
        c = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        c.paste(im.crop((x0, y0, x1, y1)), ((side - (x1 - x0)) // 2, (side - (y1 - y0)) // 2))
        im = c
    if scale != 1:
        # 中心を保ったまま拡大・縮小する。下端（足元）の位置は保たない
        s = im.size[0]
        n = round(s / scale)
        if scale > 1:
            o = (s - n) // 2
            im = im.crop((o, o, o + n, o + n))
        else:
            c = Image.new('RGBA', (n, n), (0, 0, 0, 0))
            c.paste(im, ((n - s) // 2, (n - s) // 2))
            im = c
    return im.resize((SIZE, SIZE), Image.LANCZOS)


def clipped(im):
    a = im.getchannel('A')
    w, h = a.size
    edges = [a.crop((0, 0, w, 1)), a.crop((0, h - 1, w, h)), a.crop((0, 0, 1, h)), a.crop((w - 1, 0, w, h))]
    return any(e.getextrema()[1] > 128 for e in edges)


def preview(images, path):
    big, small, pad = 184, 56, 16
    W = pad + len(IDS) * (big + pad)
    sheet = Image.new('RGB', (W, pad * 3 + big + small), BG)
    for i, key in enumerate(IDS):
        im = images.get(key)
        if im is None:
            continue
        x = pad + i * (big + pad)
        b = im.resize((big, big), Image.LANCZOS)
        sheet.paste(b, (x, pad), b)
        s = im.resize((small, small), Image.LANCZOS)
        sheet.paste(s, (x + (big - small) // 2, pad * 2 + big), s)
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser(description='タイプのミー（8枚）を確認して assets/img/types/ に入れる')
    ap.add_argument('folder', help='SCW.png … MGD.png を置いたフォルダ')
    ap.add_argument('--fit', choices=['canvas', 'each'], default='canvas')
    ap.add_argument('--scale', action='append', default=[], metavar='ID=倍率')
    ap.add_argument('--dry-run', action='store_true', help='確認と一覧画像だけ。ゲームのファイルは変えない')
    ap.add_argument('--out', default=OUT_DIR, help=argparse.SUPPRESS)  # 動作確認用
    args = ap.parse_args()

    scales = {}
    for s in args.scale:
        key, _, v = s.partition('=')
        if key not in IDS or not v:
            sys.exit(f'--scale は ID=倍率 で書く（例：MGD=1.1）：{s}')
        scales[key] = float(v)

    if not os.path.isdir(args.folder):
        sys.exit(f'フォルダが見つからない：{args.folder}')
    found = {}
    for name in sorted(os.listdir(args.folder)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in ('.png', '.webp') or stem.startswith('_'):
            continue
        if stem.upper() not in IDS:
            print(f'  使わない：{name}（ファイル名が ID ではない）')
            continue
        found[stem.upper()] = os.path.join(args.folder, name)
    if not found:
        sys.exit(f'{args.folder} に SCW.png … MGD.png が見つからない')

    out, problems = {}, 0
    print(f'合わせ方：{args.fit}' + (f'　倍率：{scales}' if scales else ''))
    for key in IDS:
        if key not in found:
            print(f'{key}  （なし。今の画像のまま）')
            continue
        raw = Image.open(found[key])
        im = load(found[key])
        notes = check(key, raw, im)
        res = fit(im, args.fit, scales.get(key, 1))
        if 'A' in raw.getbands() and clipped(res):
            notes.append('縮小後に端で切れている（--scale を小さくする）')
        problems += len(notes)
        print(f'{key}  {raw.size[0]}×{raw.size[1]}  {framing(square(raw), square(im))}' + ''.join(f'\n      ! {n}' for n in notes))
        out[key] = res

    if args.fit == 'canvas':
        print('（「高さ」「足元」は道具を含む範囲。体だけの高さ70%・足元8%は目で確かめる）')

    shown = dict(out)
    for key in IDS:  # 一覧には、差し替えない ID の今の画像も並べる
        if key not in shown:
            p = os.path.join(args.out, f'{key}.webp')
            if os.path.exists(p):
                shown[key] = Image.open(p).convert('RGBA')
    sheet = os.path.join(args.folder, '_preview.png')
    preview(shown, sheet)
    print(f'一覧：{sheet}')

    if args.dry_run:
        print('--dry-run：ゲームのファイルは変えていない')
        return
    os.makedirs(args.out, exist_ok=True)
    for key in IDS:
        if key in found:
            p = os.path.join(args.out, f'{key}.webp')
            out[key].save(p, 'WEBP', quality=88, method=6)
            shown_path = os.path.relpath(p, ROOT) if os.path.abspath(p).startswith(ROOT + os.sep) else p
            print(f'書いた：{shown_path}（{os.path.getsize(p) // 1024}KB）')
    if problems:
        print(f'注意が {problems} 件あります（上の「!」）')


if __name__ == '__main__':
    main()
