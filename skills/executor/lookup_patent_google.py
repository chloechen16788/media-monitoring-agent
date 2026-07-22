"""通过 Google Patents（借助 Firecrawl）查询专利授权公开日。"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any


FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search"
FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def fail(error: str, hint: str = "") -> None:
    payload: dict[str, Any] = {"ok": False, "error": error}
    if hint:
        payload["hint"] = hint
    _emit(payload)
    sys.exit(0)


def read_params() -> dict[str, Any]:
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        fail("参数必须是单个合法的 JSON 字符串（禁止单引号）。")
    if not isinstance(parsed, dict):
        fail("参数 JSON 必须是对象。")
    return parsed


def normalize_patent_number(raw: str) -> str:
    text = re.sub(r"[\s\-_/]+", "", raw.upper())
    return text


def build_fallback_numbers(patent_number: str) -> list[str]:
    numbers = [patent_number]
    # B/U 常见无法直接命中 Google Patents 页面，尝试同号 A 页面兜底。
    if patent_number.endswith("B") or patent_number.endswith("U"):
        numbers.append(f"{patent_number[:-1]}A")
    dedup: list[str] = []
    seen = set()
    for n in numbers:
        if n not in seen:
            seen.add(n)
            dedup.append(n)
    return dedup


def firecrawl_post(url: str, api_key: str, payload: dict[str, Any], timeout_sec: int = 25) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        details = ""
        try:
            details = e.read().decode("utf-8")
        except Exception:
            details = ""
        raise RuntimeError(f"HTTP {e.code}: {details}") from e
    except Exception as e:
        raise RuntimeError(str(e)) from e


def scrape_markdown(api_key: str, url: str) -> str:
    payload = {"url": url, "formats": ["markdown"]}
    result = firecrawl_post(FIRECRAWL_SCRAPE_URL, api_key, payload, timeout_sec=30)
    if not result.get("success"):
        return ""
    data = result.get("data") or {}
    if isinstance(data, dict):
        return str(data.get("markdown", "") or "")
    return ""


def search_google_patents_urls(api_key: str, patent_number: str, limit: int = 6) -> list[str]:
    query = f"site:patents.google.com/patent {patent_number}"
    result = firecrawl_post(FIRECRAWL_SEARCH_URL, api_key, {"query": query, "limit": limit}, timeout_sec=25)
    if not result.get("success"):
        return []

    data = result.get("data")
    urls: list[str] = []

    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                url = str(item.get("url", "")).strip()
                if url:
                    urls.append(url)
    elif isinstance(data, dict):
        web = data.get("web")
        if isinstance(web, list):
            for item in web:
                if isinstance(item, dict):
                    url = str(item.get("url", "")).strip()
                    if url:
                        urls.append(url)

    dedup = []
    seen = set()
    for u in urls:
        if u not in seen:
            seen.add(u)
            dedup.append(u)
    return dedup


def _extract_first(pattern: str, text: str) -> str:
    m = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    return m.group(1) if m else ""


def extract_grant_publication_date(markdown: str, target_patent: str) -> str:
    escaped = re.escape(target_patent)
    patterns = [
        rf"(\d{{4}}-\d{{2}}-\d{{2}})\s*\n\s*\[Publication of {escaped}\]",
        rf"\[Publication of {escaped}\][^\n]*\n[^\n]*?(\d{{4}}-\d{{2}}-\d{{2}})",
        r"Grant(?:ed)?\s+date[:：]\s*(\d{4}-\d{2}-\d{2})",
        r"Publication\s+date[:：]\s*(\d{4}-\d{2}-\d{2})",
        r"Effective date of registration[:：]\s*(\d{4}-\d{2}-\d{2})",
    ]
    for p in patterns:
        date = _extract_first(p, markdown)
        if date:
            return date
    return ""


def extract_date_for_candidates(markdown: str, candidate_numbers: list[str]) -> tuple[str, str]:
    for number in candidate_numbers:
        date = extract_grant_publication_date(markdown, number)
        if date:
            return date, number
    return "", ""


def markdown_not_found(markdown: str) -> bool:
    text = markdown.strip().lower()
    if not text:
        return True
    return "404." in text or "that’s an error" in text or "that's an error" in text


def main() -> None:
    params = read_params()
    raw_patent_number = str(params.get("patent_number", "")).strip()
    if not raw_patent_number:
        fail("缺少必填参数: patent_number")
    patent_number = normalize_patent_number(raw_patent_number)

    api_key = os.environ.get("SKILL_FIRECRAWL_API_KEY", "").strip()
    if not api_key:
        fail("missing env: SKILL_FIRECRAWL_API_KEY", "请在运行环境注入 Firecrawl API Key。")

    fallback_numbers = build_fallback_numbers(patent_number)
    candidates = [f"https://patents.google.com/patent/{n}/en" for n in fallback_numbers]

    visited = []
    for url in candidates:
        md = scrape_markdown(api_key, url)
        visited.append(url)
        if markdown_not_found(md):
            continue
        grant_date, matched_number = extract_date_for_candidates(md, fallback_numbers)
        if grant_date:
            _emit(
                {
                    "ok": True,
                    "data": {
                        "source": "google_patents",
                        "patent_number": patent_number,
                        "grant_publication_date": grant_date,
                        "matched": True,
                        "matched_patent_number": matched_number,
                        "matched_via_fallback": matched_number != patent_number,
                        "source_url": url,
                        "visited_urls": visited,
                    },
                }
            )
            return

    # direct 失败后走搜索兜底（原号 + 回退号都搜索）。
    search_limit = int(params.get("search_limit", 6))
    for query_number in fallback_numbers:
        search_urls = search_google_patents_urls(api_key, query_number, limit=search_limit)
        for url in search_urls:
            if "patents.google.com/patent/" not in url:
                continue
            md = scrape_markdown(api_key, url)
            visited.append(url)
            if markdown_not_found(md):
                continue
            grant_date, matched_number = extract_date_for_candidates(md, fallback_numbers)
            if grant_date:
                _emit(
                    {
                        "ok": True,
                        "data": {
                            "source": "google_patents",
                            "patent_number": patent_number,
                            "grant_publication_date": grant_date,
                            "matched": True,
                            "matched_patent_number": matched_number,
                            "matched_via_fallback": matched_number != patent_number,
                            "source_url": url,
                            "visited_urls": visited,
                        },
                    }
                )
                return

    _emit(
        {
            "ok": True,
            "data": {
                "source": "google_patents",
                "patent_number": patent_number,
                "grant_publication_date": "",
                "matched": False,
                "matched_patent_number": "",
                "matched_via_fallback": False,
                "visited_urls": visited,
                "note": "Google Patents 未命中授权公开日。",
            },
        }
    )


if __name__ == "__main__":
    main()
