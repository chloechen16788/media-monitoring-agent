"""技能说明书统一入口（渐进式披露第二层）。

本脚本不持有任何技能数据，全部信息来自唯一注册中心 registry.json：
- type=script 的技能：输出 registry 元信息（角色/脚本路径/简介）+ skills/docs/<id>.md 详细说明书
- type=doc   的技能：直接输出 registry.entry 指向的文档全文

用法:
    python get_skill_doc.py              # 列出全部启用技能（id + 简介）
    python get_skill_doc.py <skill_id>   # 输出指定技能的完整说明书
"""

import sys
import json
import os

SKILLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SKILLS_DIR)
REGISTRY_PATH = os.path.join(SKILLS_DIR, "registry.json")
DOCS_DIR = os.path.join(SKILLS_DIR, "docs")


def load_skills() -> dict:
    with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
        registry = json.load(f)
    return {s["id"]: s for s in registry.get("skills", []) if s.get("id")}


def list_skills(skills: dict) -> None:
    print("可用技能列表（详情: python skills/get_skill_doc.py <skill_id>）:")
    for skill in skills.values():
        if skill.get("enabled"):
            print(f"- {skill['id']}: {skill.get('brief', '')}")


def read_file(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def print_skill_doc(skill: dict) -> None:
    if skill.get("type") == "doc":
        content = read_file(os.path.join(PROJECT_ROOT, skill.get("entry", "")))
        if content is None:
            print(f"错误: 文档文件不存在: {skill.get('entry')}")
            sys.exit(1)
        print(content)
        return

    # type == "script"
    doc_body = read_file(os.path.join(DOCS_DIR, f"{skill['id']}.md"))
    if doc_body is None:
        print(f"错误: 缺少说明书 skills/docs/{skill['id']}.md，请按 SKILL_DEVELOPMENT_GUIDE.md 补齐。")
        sys.exit(1)

    print(f"【技能名称】: {skill['id']}")
    print(f"【角色】: {skill.get('role', '-')}")
    print(f"【脚本路径】: {skill.get('entry', '-')}")
    print(f"【简介】: {skill.get('brief', '')}")
    print(doc_body.rstrip())


if __name__ == "__main__":
    skills = load_skills()

    if len(sys.argv) < 2:
        list_skills(skills)
        sys.exit(0)

    skill_id = sys.argv[1]
    skill = skills.get(skill_id)
    if not skill:
        print(f"错误: 找不到技能 '{skill_id}'。请查阅 catalog.json 获取正确的技能ID。")
        sys.exit(1)
    if not skill.get("enabled"):
        print(f"错误: 技能 '{skill_id}' 已停用。")
        sys.exit(1)

    print_skill_doc(skill)
