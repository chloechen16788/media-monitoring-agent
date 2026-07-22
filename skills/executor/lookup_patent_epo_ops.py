"""通过 EPO OPS 查询专利授权公开日（publication-reference/date）。"""

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


OPS_TOKEN_URL = "https://ops.epo.org/3.2/auth/accesstoken"
OPS_BIBLIO_URL_TEMPLATE = "https://ops.epo.org/rest-services/published-data/publication/epodoc/{number}/biblio"


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
    return re.sub(r"[\s\-_/]+", "", raw.upper())


def _http_post(url: str, headers: dict[str, str], body: bytes, timeout_sec: int = 25) -> tuple[int, str]:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return resp.getcode(), resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="ignore")


def _http_get(url: str, headers: dict[str, str], timeout_sec: int = 25) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return resp.getcode(), resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="ignore")


def fetch_access_token(client_key: str, client_secret: str) -> str:
    raw = f"{client_key}:{client_secret}".encode("utf-8")
    basic = base64.b64encode(raw).decode("ascii")
    headers = {
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode("utf-8")
    status, text = _http_post(OPS_TOKEN_URL, headers, body, timeout_sec=25)
    if status // 100 != 2:
        raise RuntimeError(f"OPS token 获取失败 (HTTP {status})")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError("OPS token 响应非 JSON。") from e
    token = str(payload.get("access_token", "")).strip()
    if not token:
        raise RuntimeError("OPS token 响应中缺少 access_token。")
    return token


def _walk_dates_from_json(obj: Any, out: list[str]) -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "date":
                if isinstance(value, str) and re.fullmatch(r"\d{8}", value):
                    out.append(value)
                elif isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                    out.append(value.replace("-", ""))
            _walk_dates_from_json(value, out)
    elif isinstance(obj, list):
        for item in obj:
            _walk_dates_from_json(item, out)


def parse_publication_date(payload_text: str) -> str:
    # 优先 JSON 响应解析
    try:
        data = json.loads(payload_text)
        dates: list[str] = []
        _walk_dates_from_json(data, dates)
        for date in dates:
            if re.fullmatch(r"\d{8}", date):
                return f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    except json.JSONDecodeError:
        pass

    # XML/文本兜底：取 publication-reference 区块内第一个 yyyyMMdd
    m = re.search(
        r"publication-reference[\s\S]{0,2000}?<date>(\d{8})</date>",
        payload_text,
        flags=re.IGNORECASE,
    )
    if m:
        d = m.group(1)
        return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
    return ""


def main() -> None:
    params = read_params()
    raw_patent_number = str(params.get("patent_number", "")).strip()
    if not raw_patent_number:
        fail("缺少必填参数: patent_number")
    patent_number = normalize_patent_number(raw_patent_number)

    client_key = os.environ.get("SKILL_EPO_OPS_KEY", "").strip()
    client_secret = os.environ.get("SKILL_EPO_OPS_SECRET", "").strip()
    if not client_key or not client_secret:
        fail(
            "missing env: SKILL_EPO_OPS_KEY / SKILL_EPO_OPS_SECRET",
            "请在运行环境注入 OPS 应用凭证。",
        )

    try:
        token = fetch_access_token(client_key, client_secret)
    except Exception as e:
        fail(str(e))
        return

    biblio_url = OPS_BIBLIO_URL_TEMPLATE.format(number=urllib.parse.quote(patent_number, safe=""))
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json, application/exchange+xml;q=0.9, application/xml;q=0.8",
    }
    status, text = _http_get(biblio_url, headers, timeout_sec=30)
    if status == 404:
        _emit(
            {
                "ok": True,
                "data": {
                    "source": "epo_ops",
                    "patent_number": patent_number,
                    "grant_publication_date": "",
                    "matched": False,
                    "note": "OPS 未找到该专利号。",
                    "source_url": biblio_url,
                },
            }
        )
        return
    if status // 100 != 2:
        fail(f"OPS 查询失败 (HTTP {status})")
        return

    grant_date = parse_publication_date(text)
    _emit(
        {
            "ok": True,
            "data": {
                "source": "epo_ops",
                "patent_number": patent_number,
                "grant_publication_date": grant_date,
                "matched": bool(grant_date),
                "source_url": biblio_url,
            },
        }
    )


if __name__ == "__main__":
    main()
