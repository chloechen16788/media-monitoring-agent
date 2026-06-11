"""Master 规划落盘技能（A 类 / role=master）。

Cursor 式 plan -> approve -> execute 流程中的"写计划"工具：
Master 完成规划后调用本技能，把计划（goal / allowed_skills / acceptance_criteria 等）
校验后写入项目契约文件（路径由系统注入的 WORKER_TASK_CONTRACT_FILE 提供）。
用户在界面确认后切换 Sub 按契约执行。

入参: argv[1] 单个 JSON 字符串（见 docs/write_task_contract.md）
出参: stdout 单个 JSON 对象 {"ok": ..., "data"|"error": ...}
"""

import sys
import os
import json
from datetime import datetime, timezone

SKILLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY_PATH = os.path.join(SKILLS_DIR, "registry.json")


def fail(error: str, hint: str = "") -> None:
    payload = {"ok": False, "error": error}
    if hint:
        payload["hint"] = hint
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


def read_params() -> dict:
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    if not raw.strip():
        fail("缺少参数：必须以单个 JSON 字符串传入计划内容。")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        fail("参数必须是单个合法的 JSON 字符串（禁止单引号）。")
    if not isinstance(parsed, dict):
        fail("参数 JSON 必须是对象。")
    return parsed


def load_registry_skills() -> dict:
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            registry = json.load(f)
    except (OSError, json.JSONDecodeError):
        fail("无法读取 skills/registry.json，无法校验 allowed_skills。")
    return {s["id"]: s for s in registry.get("skills", []) if s.get("id")}


def validate_allowed_skills(allowed_skills, registry_skills) -> list:
    if not isinstance(allowed_skills, list) or len(allowed_skills) == 0:
        fail("allowed_skills 必须是非空字符串数组。")
    invalid = []
    for skill_id in allowed_skills:
        skill = registry_skills.get(str(skill_id))
        if skill is None or not skill.get("enabled"):
            invalid.append(str(skill_id))
            continue
        is_sub_script = skill.get("type") == "script" and skill.get("role") == "sub"
        is_doc = skill.get("type") == "doc"
        if not (is_sub_script or is_doc):
            invalid.append(str(skill_id))
    if invalid:
        fail(
            f"allowed_skills 含无效项: {invalid}。仅允许 registry 中已启用的 role=sub 可执行技能或 doc 说明书。",
            "请先 cat catalog.json 核对技能 id。",
        )
    return [str(s) for s in allowed_skills]


def validate_str_list(value, field: str) -> list:
    if not isinstance(value, list) or len(value) == 0 or not all(
        isinstance(item, str) and item.strip() for item in value
    ):
        fail(f"{field} 必须是非空字符串数组。")
    return value


def main() -> None:
    params = read_params()

    contract_file = (os.environ.get("WORKER_TASK_CONTRACT_FILE") or "").strip()
    if not contract_file:
        fail(
            "missing env: WORKER_TASK_CONTRACT_FILE",
            "本技能只能在项目会话中由 Master 调用，契约路径由系统注入。",
        )

    goal = params.get("goal")
    if not isinstance(goal, str) or not goal.strip():
        fail("goal 必须是非空字符串。")

    registry_skills = load_registry_skills()
    allowed_skills = validate_allowed_skills(params.get("allowed_skills"), registry_skills)
    acceptance_criteria = validate_str_list(params.get("acceptance_criteria"), "acceptance_criteria")

    input_context = params.get("input_context") or {}
    output_schema = params.get("output_schema") or {}
    if not isinstance(input_context, dict):
        fail("input_context 必须是 JSON 对象。")
    if not isinstance(output_schema, dict):
        fail("output_schema 必须是 JSON 对象。")

    existing = {}
    if os.path.exists(contract_file):
        try:
            with open(contract_file, "r", encoding="utf-8") as f:
                existing = json.load(f) or {}
        except (OSError, json.JSONDecodeError):
            existing = {}

    now_iso = datetime.now(timezone.utc).isoformat()
    contract = {
        **existing,
        "task_id": str(params.get("task_id") or existing.get("task_id") or f"task_{int(datetime.now().timestamp() * 1000)}"),
        "goal": goal.strip(),
        "allowed_skills": allowed_skills,
        "acceptance_criteria": acceptance_criteria,
        "input_context": input_context,
        "output_schema": output_schema,
        "status": "planned",
        "executor_result": {},
        "validation_result": {},
        "updated_at": now_iso,
    }

    os.makedirs(os.path.dirname(contract_file), exist_ok=True)
    with open(contract_file, "w", encoding="utf-8") as f:
        json.dump(contract, f, ensure_ascii=False, indent=2)

    print(json.dumps({"ok": True, "data": {"contract_file": contract_file, "contract": contract}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
