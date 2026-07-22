"""从行数据中提取并标准化专利号。"""

import json
import re
import sys
from typing import Any


PATTERN_SPECS = [
    # CN 公开号/授权号/实用新型号，如 CN117228691B、CN224459237U
    ("CN", re.compile(r"\bCN[\s\-]?\d{8,14}[A-Z](?:\d)?\b", re.IGNORECASE)),
    # CN 申请号，如 CN202521267512.4、CN202311117897.1（末位可为数字或 X）
    ("CN", re.compile(r"\bCN[\s\-]?\d{12}\.[0-9Xx]\b", re.IGNORECASE)),
    ("EP", re.compile(r"\bEP[\s\-]?\d{6,12}(?:\.[A-Z]\d?|[A-Z]\d?)?\b", re.IGNORECASE)),
    ("WO", re.compile(r"\bWO[\s\-]?\d{4}[\s\-]?\d{6,10}[A-Z]?\d?\b", re.IGNORECASE)),
    ("US", re.compile(r"\bUS[\s\-]?\d{6,12}[A-Z]\d?\b", re.IGNORECASE)),
]


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
    text = re.sub(r"[，。；：、,.;:]+$", "", text)
    return text


def build_text_from_fields(row: dict[str, Any], fields: list[str]) -> str:
    chunks: list[str] = []
    for field in fields:
        val = row.get(field, "")
        if val is None:
            continue
        chunks.append(str(val))
    return "\n".join(chunks)


def extract_from_text(text: str, include_countries: set[str]) -> list[str]:
    found: list[str] = []
    seen = set()
    for country, pattern in PATTERN_SPECS:
        if include_countries and country not in include_countries:
            continue
        for match in pattern.finditer(text):
            norm = normalize_patent_number(match.group(0))
            if norm and norm not in seen:
                seen.add(norm)
                found.append(norm)
    return found


def main() -> None:
    params = read_params()
    rows = params.get("rows")
    if not isinstance(rows, list):
        fail("缺少必填参数: rows（对象数组）。")
    if any(not isinstance(x, dict) for x in rows):
        fail("rows 必须是对象数组。")

    content_fields = params.get("content_fields", ["content", "正文", "text", "body"])
    if not isinstance(content_fields, list) or any(not isinstance(x, str) for x in content_fields):
        fail("content_fields 必须是字符串数组。")

    include_countries_raw = params.get("include_countries", ["CN", "EP", "WO", "US"])
    if not isinstance(include_countries_raw, list) or any(not isinstance(x, str) for x in include_countries_raw):
        fail("include_countries 必须是字符串数组。")
    include_countries = {x.upper() for x in include_countries_raw}

    write_back_field = str(params.get("write_back_field", "patent_numbers"))
    keep_existing = bool(params.get("keep_existing", False))

    out_rows: list[dict[str, Any]] = []
    all_unique: list[str] = []
    seen_all = set()
    extracted_total = 0

    for row in rows:
        row_out = dict(row)
        if keep_existing and isinstance(row_out.get(write_back_field), list):
            existing = [normalize_patent_number(str(x)) for x in row_out.get(write_back_field, []) if str(x).strip()]
            patents = []
            seen_row = set()
            for item in existing:
                if item not in seen_row:
                    seen_row.add(item)
                    patents.append(item)
        else:
            text = build_text_from_fields(row_out, content_fields)
            patents = extract_from_text(text, include_countries)

        row_out[write_back_field] = patents
        row_out["patent_count"] = len(patents)
        row_out["first_patent_number"] = patents[0] if patents else ""
        out_rows.append(row_out)

        extracted_total += len(patents)
        for p in patents:
            if p not in seen_all:
                seen_all.add(p)
                all_unique.append(p)

    _emit(
        {
            "ok": True,
            "data": {
                "rows": out_rows,
                "stats": {
                    "row_count": len(out_rows),
                    "rows_with_patent": sum(1 for r in out_rows if r.get("patent_count", 0) > 0),
                    "extracted_total": extracted_total,
                    "unique_patent_count": len(all_unique),
                    "unique_patent_numbers": all_unique,
                },
            },
        }
    )


if __name__ == "__main__":
    main()
