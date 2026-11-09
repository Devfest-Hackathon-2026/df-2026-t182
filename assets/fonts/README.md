# フォント

ゲームで使っている文字だけを抜き出した「サブセット」を置いています。

| ファイル | 元のフォント | ライセンス |
|---|---|---|
| kowai-mincho.woff | 07 ふぉんとうは怖い明朝体（Fontna.com、IPAex明朝の派生） | IPAフォントライセンス v1.0（同じフォルダーの IPA_Font_License_Agreement_v1.0.txt） |
| yosugara-sub.woff | 夜すがら手書きフォント 1.2（作者：て！） | 配布元の利用規約（商用・非商用とも無償、ゲームでの利用可） |

- kowai-mincho.woff は、タイトル用の文字・かな・英数に、記録の見出しと8タイプ名の漢字を足したものです（2026-11-09）。
- 2026-11-09 夜：ゆきの物語の結末名と日付の漢字（何出別外密役日月消漏火疑秘立続誰起の17字）を足しました。それまでは、この字だけ別の書体で出ていました。
- 作り直し方（今の woff と同じ設定）：今の woff の文字一覧に足したい字を加えて `U+XXXX,...` のファイルにし、
  `python3 -m fontTools.subset kowai-mincho-full.otf --unicodes-file=<一覧> --flavor=woff --layout-features='*' --output-file=kowai-mincho.woff`
  （`--layout-features='*'` で縦書き・異体字の置き換えも残すため、字数のわりに大きくなります。同じ一覧なら同じファイルになることを確かめ済み）。
- 元のフォントファイルは、このリポジトリには入れていません。
