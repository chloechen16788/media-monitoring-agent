"""ES 抽样结果导出 Excel 技能（A 类 / role=sub）。

纯计算工具：将 es_sample_search 返回结果导出为 xlsx 文件，保留 articles
中的全部字段（动态列，不丢字段），并返回可下载相对路径。
"""

import glob
import json
import os
import re
import sys
from datetime import datetime

from openpyxl import Workbook


def fail(error: str, hint: str = "") -> None:
    payload = {"ok": False, "error": error}
    if hint:
        payload["hint"] = hint
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


def read_params() -> dict:
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


def sanitize_filename(text: str) -> str:
    text = re.sub(r"[\\/:*?\"<>|]+", "_", text or "")
    text = re.sub(r"\s+", "_", text).strip("._")
    return text[:80] if text else "es_sample_export"


def _read_jsonl(path: str) -> list[dict]:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                rows.append(obj)
    return rows


def normalize_articles(params: dict) -> list[dict]:
    # 兼容多种输入：
    # 1) articles: [...]
    # 2) sample_output / es_sample_output: {"articles":[...]}
    # 3) input_jsonl_dir: 目录下所有 *.jsonl 按文件名排序合并
    # 4) input_jsonl: 单个 jsonl 文件
    input_jsonl_dir = params.get("input_jsonl_dir")
    if isinstance(input_jsonl_dir, str) and input_jsonl_dir.strip():
        rows = []
        for fp in sorted(glob.glob(os.path.join(input_jsonl_dir, "*.jsonl"))):
            rows.extend(_read_jsonl(fp))
        return rows
    input_jsonl = params.get("input_jsonl")
    if isinstance(input_jsonl, str) and input_jsonl.strip():
        return _read_jsonl(input_jsonl)
    if isinstance(params.get("articles"), list):
        return [x for x in params["articles"] if isinstance(x, dict)]
    sample_output = params.get("sample_output")
    if isinstance(sample_output, dict) and isinstance(sample_output.get("articles"), list):
        return [x for x in sample_output["articles"] if isinstance(x, dict)]
    if isinstance(params.get("es_sample_output"), dict) and isinstance(params["es_sample_output"].get("articles"), list):
        return [x for x in params["es_sample_output"]["articles"] if isinstance(x, dict)]
    return []


def main() -> None:
    params = read_params()
    articles = normalize_articles(params)
    if not articles:
        fail(
            "缺少可导出的数据。",
            "请传入 articles 数组、sample_output/es_sample_output（含 articles），"
            "或 input_jsonl_dir（标注后 annotated 目录）/ input_jsonl（单个 jsonl 文件）。",
        )

    export_dir = str(params.get("export_dir") or "./workspace")
    report_name = str(params.get("report_name") or "ES抽样结果")
    filename = str(params.get("filename") or "")
    if not filename:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{sanitize_filename(report_name)}_{stamp}.xlsx"
    if not filename.lower().endswith(".xlsx"):
        filename += ".xlsx"

    os.makedirs(export_dir, exist_ok=True)
    abs_path = os.path.abspath(os.path.join(export_dir, filename))

    # 动态聚合全部字段，确保“保留所有字段”
    columns: list[str] = []
    seen = set()
    for row in articles:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                columns.append(key)

    wb = Workbook()
    ws = wb.active
    ws.title = "es_sample_articles"

    ws.append(columns)
    for row in articles:
        ws.append([row.get(col, "") for col in columns])

    # 次页写基础统计
    meta = wb.create_sheet("meta")
    meta.append(["report_name", report_name])
    meta.append(["exported_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    meta.append(["article_count", len(articles)])
    meta.append(["column_count", len(columns)])
    meta.append(["columns", ",".join(columns)])

    wb.save(abs_path)

    result = {
        "ok": True,
        "data": {
            "file_path": abs_path,
            "download_path": f"./workspace/{filename}",
            "filename": filename,
            "article_count": len(articles),
            "columns": columns,
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
