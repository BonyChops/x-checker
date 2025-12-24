import os
import re
import json
import asyncio
from typing import Any, Dict, List, Optional, Tuple

from openai import AsyncOpenAI
from tqdm import tqdm

from client import get_client


# ---------- tweets.js の読み込み & パース ----------

def load_tweets_from_js(path: str) -> List[Dict[str, Any]]:
    """tweets.js の最初の '[' 〜 最後の ']' を JSON 配列として読み込む。"""
    with open(path, "r", encoding="utf-8") as f:
        s = f.read()

    start = s.find("[")
    end = s.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("tweets.js から JSON 配列部分([ ... ])を抽出できませんでした。")

    return json.loads(s[start : end + 1])


def extract_tweet_text_and_id(item):
    tw = item.get("tweet") or {}
    text = tw.get("full_text") or tw.get("text")
    tid = tw.get("id_str") or str(tw.get("id") or "")

    if not text or not tid:
        return None

    # RT で始まるツイートは除外
    if text.lstrip().startswith("RT"):
        return None

    return tid, text



# ---------- results の読み書き（配列: [id, text, score]） ----------

def load_results(path: str) -> List[List[Any]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("results.json の形式が不正です（配列を期待）。")
    return data


def save_results_atomic(path: str, results: List[List[Any]]) -> None:
    """逐次更新を安全にするため、tmpに書いてから置き換え。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ---------- レスポンスから最初の数値を拾う ----------

_num_re = re.compile(r"[-+]?\d+(?:\.\d+)?")

def parse_first_number_to_score(s: str) -> Optional[float]:
    m = _num_re.search(s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def clamp_score(x: float, lo: float = 0.0, hi: float = 10.0) -> float:
    return max(lo, min(hi, x))


# ---------- OpenAI 呼び出し（1ツイート=1リクエスト） ----------

def make_prompt(tweet_text: str) -> str:
    return (
        "次のツイートの炎上危険度を0から10の数値で答えてください。"
        "数値だけを出力してください。\n\n"
        f"{tweet_text}"
    )


async def score_one_tweet(
    client: AsyncOpenAI,
    model: str,
    tweet_id: str,
    tweet_text: str,
    semaphore: asyncio.Semaphore,
    max_retries: int = 5,
) -> Tuple[str, str, Optional[float]]:
    prompt = make_prompt(tweet_text)

    async with semaphore:
        last_exc: Optional[Exception] = None
        for attempt in range(max_retries):
            try:
                resp = await client.responses.create(
                    model=model,
                    input=prompt,
                )
                out = (resp.output_text or "").strip()
                raw = parse_first_number_to_score(out)
                score = clamp_score(raw) if raw is not None else None
                return tweet_id, tweet_text, score
            except Exception as e:
                last_exc = e
                wait = min(2 ** attempt, 20) + 0.1 * attempt
                await asyncio.sleep(wait)

        # 最終的に失敗したら score=None で返す（落とさず進める）
        return tweet_id, tweet_text, None


async def main():
    # 設定
    TWEETS_JS_PATH = "tweets.js"
    RESULTS_JSON = "results.json"   # ← 配列で保存
    CONCURRENCY = 5                 # n=3
    MODEL = "lucas2024/mistral-nemo-japanese-instruct-2408:q8_0"                 # 必要に応じて変更

    # api_key = os.environ.get("OPENAI_API_KEY")
    # if not api_key:
    #     raise RuntimeError("環境変数 OPENAI_API_KEY が設定されていません。")
    client = get_client()

    # tweets 読み込み
    raw_items = load_tweets_from_js(TWEETS_JS_PATH)
    all_tweets: List[Tuple[str, str]] = []
    for item in raw_items:
        r = extract_tweet_text_and_id(item)
        if r:
            all_tweets.append(r)

    # 既存 results を読み込み、再開
    results: List[List[Any]] = load_results(RESULTS_JSON)
    done_ids = {row[0] for row in results if isinstance(row, list) and len(row) >= 1}

    # 未処理のみ
    pending = [(tid, text) for (tid, text) in all_tweets if tid not in done_ids]

    sem = asyncio.Semaphore(CONCURRENCY)

    tasks = [
        asyncio.create_task(score_one_tweet(client, MODEL, tid, text, sem))
        for (tid, text) in pending
    ]

    total_count = len(all_tweets)
    done_count = len(done_ids)

    # tqdm 進捗（ETA込み）
    pbar = tqdm(
        total=total_count,
        initial=done_count,
        desc="Scoring",
        unit="tweet"
    )

    try:
        for fut in asyncio.as_completed(tasks):
            tid, text, score = await fut

            # results は [tweetid, 本文, スコア] だけ
            results.append([tid, text, score])

            # 逐次保存（進捗を保存して再開可能に）
            save_results_atomic(RESULTS_JSON, results)

            pbar.update(1)
    finally:
        pbar.close()

    print(f"Done. Saved: {RESULTS_JSON} (total={len(results)})")


if __name__ == "__main__":
    asyncio.run(main())
