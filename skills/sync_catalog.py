"""从 registry.json 生成 catalog.json。

catalog.json 是 registry 的投影（仅含启用技能的 id + brief），禁止手工编辑。
新增/修改技能后执行一次：

    python skills/sync_catalog.py

之后运行 gateway/tests/skills_spec.test.mjs 验证一致性。
"""

import json
import os

SKILLS_DIR = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH = os.path.join(SKILLS_DIR, "registry.json")
CATALOG_PATH = os.path.join(SKILLS_DIR, "catalog.json")


def main() -> None:
    with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
        registry = json.load(f)

    catalog = [
        {"id": s["id"], "brief": s.get("brief", "")}
        for s in registry.get("skills", [])
        if s.get("id") and s.get("enabled")
    ]

    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"catalog.json 已生成: {len(catalog)} 个启用技能。")


if __name__ == "__main__":
    main()
