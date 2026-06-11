"""Master-only planning skill: identify the report type from a user intent.

Input  : 用户意图文本（argv[1]）或 JSON 字符串 {"text": "..."}（argv[1] / stdin）
Output : JSON {"report_type": "...", "confidence": "...", "reason": "...", "candidates": [...]}
角色   : role=master（仅供 Master 规划阶段使用，不触发任何执行引擎）
"""

import sys
import json

SUPPORTED = {
    "brand_monthly": ["品牌", "月报", "全景", "本品", "brand", "monthly"],
    "competitor_weekly": ["竞品", "周报", "竞争", "对手", "competitor", "weekly"],
}


def read_intent_text() -> str:
    if len(sys.argv) >= 2:
        raw = sys.argv[1]
    else:
        raw = sys.stdin.read()
    raw = (raw or "").strip()
    if not raw:
        return ""
    # 兼容 JSON 入参
    if raw.startswith("{"):
        try:
            obj = json.loads(raw)
            return str(obj.get("text") or obj.get("intent") or obj.get("goal") or "")
        except json.JSONDecodeError:
            return raw
    return raw


def identify(text: str) -> dict:
    lowered = text.lower()
    scores = {}
    for report_type, keywords in SUPPORTED.items():
        scores[report_type] = sum(1 for kw in keywords if kw.lower() in lowered)

    best_type = max(scores, key=scores.get)
    best_score = scores[best_type]

    if best_score == 0:
        # 无明显信号：默认品牌月报，标注低置信，建议 Master 向用户确认
        return {
            "report_type": "brand_monthly",
            "confidence": "low",
            "reason": "未在意图中识别到明确的报告类型关键词，默认 brand_monthly，建议向用户确认。",
            "candidates": list(SUPPORTED.keys()),
        }

    confidence = "high" if best_score >= 2 else "medium"
    return {
        "report_type": best_type,
        "confidence": confidence,
        "reason": f"基于关键词匹配命中 {best_score} 个 '{best_type}' 信号。",
        "candidates": [t for t, s in sorted(scores.items(), key=lambda kv: kv[1], reverse=True)],
    }


if __name__ == "__main__":
    intent = read_intent_text()
    result = identify(intent)
    print(json.dumps(result, ensure_ascii=False))
