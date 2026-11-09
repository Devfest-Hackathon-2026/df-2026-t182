#!/usr/bin/env python3
"""Build dist/: only the files the game serves, for Firebase Hosting.

Usage: python3 tools/build_dist.py
- Copies the page, scripts, styles, the in-game sites and the assets the game loads.
- Leaves out memos and tools: docs/, tools/, _mock/, README, serve.py, qr.*, firebase.json, dotfiles,
  the full font files, the voice ledger and samples, the unused sns/img/*.svg, and the empty assets/3d.
- Voices are packed into assets/voice/pack-xx.mp3 + manifest.json (tools/voice_pack.py), as on the current public copy.
"""
import os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
TOP_EXT = ('.html', '.js', '.css')
TOP_SKIP = {'qr.html', 'serve.py'}
DIRS = ['sites', 'shiomi', 'news', 'mii', 'sns', 'assets', 'teach']  # teach/ = 先生用の画面とサンプル授業（2026-11-09）
SKIP_PREFIX = ('assets/voice/', 'assets/3d/', 'sns/img/')
SKIP_FILES = {'assets/fonts/kowai-mincho-full.otf', 'assets/fonts/kowai-mincho.otf', 'assets/fonts/yosugara.ttf'}


def wanted(rel):
    name = os.path.basename(rel)
    if name.startswith('.') or name.lower().endswith('.md'):
        return False
    if rel in SKIP_FILES or rel.startswith(SKIP_PREFIX):
        return False
    return True


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    n = 0
    for name in sorted(os.listdir(ROOT)):
        p = os.path.join(ROOT, name)
        if os.path.isfile(p) and name.endswith(TOP_EXT) and name not in TOP_SKIP:
            shutil.copy2(p, os.path.join(DIST, name)); n += 1
    for d in DIRS:
        for base, dirs, files in os.walk(os.path.join(ROOT, d)):
            dirs[:] = [x for x in dirs if not x.startswith('.')]
            for f in files:
                rel = os.path.relpath(os.path.join(base, f), ROOT)
                if not wanted(rel):
                    continue
                out = os.path.join(DIST, rel)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                shutil.copy2(os.path.join(base, f), out); n += 1
    # voices: packed, as the public copy serves them
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'voice_pack.py'), DIST], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    total = sum(len(fs) for _, _, fs in os.walk(DIST))
    size = sum(os.path.getsize(os.path.join(b, f)) for b, _, fs in os.walk(DIST) for f in fs)
    print(f'dist: {total} files, {size / 1e6:.1f} MB (copied {n}, rest are voice packs)')


if __name__ == '__main__':
    main()
