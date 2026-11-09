# -*- coding: utf-8 -*-
"""公開用に、ミーの音声 mp3 を頭2文字ごとの最大256個のまとめファイル（1個あたり約50KB）に連結する。

Artifact は1つの版に置けるファイル数に上限（511）があるため、839個の mp3 をそのまま載せられない。
出力先の assets/voice/ に pack-00.mp3〜pack-ff.mp3 と、packs 欄を足した manifest.json を書く。
台詞1つを鳴らすのに取りに行くのは数十KBで済む（16個にまとめていた頃は1個あたり約0.8MB）。
ゲーム側（sound.js の voiceBytes）は manifest に packs があればまとめファイルから切り出し、無ければ個別の mp3 を読む。

使い方: python3 tools/voice_pack.py <出力先フォルダ>
"""
import hashlib, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'voice'

def main(out):
    out = pathlib.Path(out) / 'assets' / 'voice'
    out.mkdir(parents=True, exist_ok=True)
    man = json.loads((SRC / 'manifest.json').read_text())
    groups = {}
    for key in sorted(man['lines']):
        f = SRC / f'{key}.mp3'
        if f.exists():
            groups.setdefault(key[:2], []).append((key, f.read_bytes()))
    files, index, vers = [], {}, []
    for i, head in enumerate(sorted(groups)):
        name = f'pack-{head}.mp3'
        files.append(name)
        buf = bytearray()
        for key, data in groups[head]:
            index[key] = [i, len(buf), len(data)]
            buf += data
        (out / name).write_bytes(bytes(buf))
        vers.append(hashlib.sha1(bytes(buf)).hexdigest()[:10])  # 中身が変わると URL（?v=）も変わる。manifest と古いまとめファイルが混ざらない
    man['packs'] = {'files': files, 'index': index, 'v': vers}
    (out / 'manifest.json').write_text(json.dumps(man, ensure_ascii=False, indent=1))
    sizes = [(n, (out / n).stat().st_size) for n in files]
    print(f'{len(index)} 文を {len(files)} ファイルにまとめました（最大 {max(s for _, s in sizes) / 1e6:.2f}MB、合計 {sum(s for _, s in sizes) / 1e6:.2f}MB）')
    missing = [k for k in man['lines'] if k not in index]
    if missing: print(f'音声ファイルが無い文：{len(missing)}')

if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit('使い方: python3 tools/voice_pack.py <出力先フォルダ>')
    main(sys.argv[1])
