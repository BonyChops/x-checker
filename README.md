# x-checker

X の黒歴史を AI に発掘してもらうツール

## 使い方

> [!NOTE]
> 詳しくはブログを確認 ↓  
> https://blog.b7s.dev/2025/12/21/wipe-x

1. https://x.com/settings/download_your_data からアーカイブをダウンロード
2. https://github.com/BonyChops/x-checker/releases/latest から x-checker-vX.X.X.zip をダウンロードし展開
3. アーカイブの `data/tweets.js` を `x-checker/` 内にコピー
4. `cd x-checker` して `uv sync` または `pip -r reqirements.txt`
5. 必要に応じて `client.py` を編集
6. `uv run main.py` または `python main.py`
7. 出来上がった `results.json` を `viewer/` 内にコピー
8. `cd viewer` したら `uv run python -m http.server 8000` または `python -m http.server 8000`
9. http://localhost:8000 で確認
