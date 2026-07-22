"""ES 抽样结果切批导出 JSONL 技能（A 类 / role=sub）。

纯计算工具：将 es_sample_search 返回的 articles 按 batch_size 切批，
每批写成一个 JSONL 文件（一行一条，保留所有字段），并生成 manifest.json
作为批次状态的唯一事实源，支撑“导一批标一批”的分批标注流转。

入参: argv[1] 单个 JSON 字符串（见 docs/es_export_jsonl_batches.md）
出参: stdout 单个 JSON 对象 {"ok": ..., "data"|"error": ...}
"""

import json
import os
import re
import sys
from datetime import datetime


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


def sanitize_id(text: str) -> str:
    text = re.sub(r"[^0-9A-Za-z_\-]+", "_", str(text or "")).strip("._-")
    return text[:60] if text else f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def normalize_articles(params: dict) -> list:
    input_jsonl = str(params.get("input_jsonl") or "").strip()
    if input_jsonl:
        if not os.path.exists(input_jsonl):
            fail(f"input_jsonl 不存在: {input_jsonl}")
        rows = []
        with open(input_jsonl, "r", encoding="utf-8") as f:
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

    if isinstance(params.get("articles"), list):
        return [x for x in params["articles"] if isinstance(x, dict)]
    sample_output = params.get("sample_output")
    if isinstance(sample_output, dict) and isinstance(sample_output.get("articles"), list):
        return [x for x in sample_output["articles"] if isinstance(x, dict)]
    es_out = params.get("es_sample_output")
    if isinstance(es_out, dict) and isinstance(es_out.get("articles"), list):
        return [x for x in es_out["articles"] if isinstance(x, dict)]
    return []


def atomic_write(path: str, content: str) -> None:
    """临时文件 + os.replace 原子落盘，避免读到半截文件。"""
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def main() -> None:
    params = read_params()
    articles = normalize_articles(params)
    if not articles:
        fail(
            "缺少可导出的 articles 数据。",
            "请传入 input_jsonl，或传入 articles 数组，或传入 sample_output/es_sample_output（其中需包含 articles）。"
            "若尚未取数，请先调用 es_sample_search。",
        )

    run_id = sanitize_id(params.get("run_id"))
    try:
        batch_size = int(params.get("batch_size") or 1000)
    except (TypeError, ValueError):
        fail("batch_size 必须是整数。")
    batch_size = max(1, batch_size)

    export_dir = str(params.get("export_dir") or "./workspace")
    run_dir = os.path.abspath(os.path.join(export_dir, run_id))
    raw_dir = os.path.join(run_dir, "raw")
    os.makedirs(raw_dir, exist_ok=True)

    total = len(articles)
    batches_meta = []
    batch_id = 0
    for start in range(0, total, batch_size):
        chunk = articles[start:start + batch_size]
        end = start + len(chunk) - 1
        raw_rel = f"raw/batch_{batch_id:03d}.jsonl"
        raw_abs = os.path.join(run_dir, raw_rel)
        lines = []
        for offset, record in enumerate(chunk):
            # 注入全局行号，便于标注阶段顺序回填与定位
            row = dict(record)
            row.setdefault("_row", start + offset)
            lines.append(json.dumps(row, ensure_ascii=False))
        atomic_write(raw_abs, "\n".join(lines) + ("\n" if lines else ""))
        batches_meta.append({
            "id": batch_id,
            "range": [start, end],
            "count": len(chunk),
            "raw": raw_rel,
            "annotated": None,
            "status": "exported",
        })
        batch_id += 1

    manifest = {
        "run_id": run_id,
        "total": total,
        "batch_size": batch_size,
        "batch_count": len(batches_meta),
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "batches": batches_meta,
    }
    manifest_path = os.path.join(run_dir, "manifest.json")
    atomic_write(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2))

    result = {
        "ok": True,
        "data": {
            "run_id": run_id,
            "run_dir": run_dir,
            "manifest_path": manifest_path,
            "batch_count": len(batches_meta),
            "total": total,
            "batches": batches_meta,
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
