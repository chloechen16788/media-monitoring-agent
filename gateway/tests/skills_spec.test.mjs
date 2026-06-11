// Skills 规范一致性测试（对应 skills/SKILL_DEVELOPMENT_GUIDE.md）
// registry.json 是唯一手工登记处，本测试校验派生物不漂移：
//   1. registry.json 字段齐全、entry 文件存在、script 技能配有 docs/<id>.md
//   2. catalog.json 必须等于 registry 投影（启用技能的 id+brief，顺序一致）
//      —— 改动 registry 后忘记跑 `python skills/sync_catalog.py` 会在此失败
//   3. catalog 中每个 id 都能通过 get_skill_doc.py 查到说明书（渐进式披露不断链）
// 运行: node tests/skills_spec.test.mjs
// 可选环境变量: WORKER_PYTHON_BIN 指定 python 解释器（默认 python3）

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsDir = path.join(repoRoot, "skills");
const pythonBin = process.env.WORKER_PYTHON_BIN?.trim() || "python3";

const registry = JSON.parse(readFileSync(path.join(skillsDir, "registry.json"), "utf8"));
const catalog = JSON.parse(readFileSync(path.join(skillsDir, "catalog.json"), "utf8"));

// ---------- 1. registry 结构校验 ----------
assert.ok(Array.isArray(registry.skills), "registry.skills 必须是数组");

const registryById = new Map();
for (const skill of registry.skills) {
  const label = `registry[${skill?.id ?? "?"}]`;
  assert.ok(skill.id && typeof skill.id === "string", `${label}: 缺少 id`);
  assert.ok(!registryById.has(skill.id), `${label}: id 重复`);
  registryById.set(skill.id, skill);

  assert.ok(["script", "doc"].includes(skill.type), `${label}: type 必须是 script|doc`);
  assert.ok(skill.group, `${label}: 缺少 group`);
  assert.ok(typeof skill.enabled === "boolean", `${label}: enabled 必须是布尔值`);
  assert.ok(skill.brief && typeof skill.brief === "string", `${label}: 缺少 brief`);
  assert.ok(skill.entry && typeof skill.entry === "string", `${label}: 缺少 entry`);

  const entryPath = path.resolve(repoRoot, skill.entry);
  assert.ok(existsSync(entryPath), `${label}: entry 文件不存在: ${skill.entry}`);

  if (skill.type === "script") {
    assert.ok(["master", "sub"].includes(skill.role), `${label}: script 类型必须声明 role=master|sub`);
    assert.ok(skill.entry.endsWith(".py"), `${label}: script 类型 entry 必须是 .py`);
    assert.ok(
      existsSync(path.join(skillsDir, "docs", `${skill.id}.md`)),
      `${label}: 缺少说明书 skills/docs/${skill.id}.md`
    );
  } else {
    assert.ok(
      skill.entry.endsWith(".md") || skill.entry.endsWith(".json"),
      `${label}: doc 类型 entry 必须是 .md 或 .json`
    );
  }
}

// ---------- 2. catalog 必须等于 registry 投影 ----------
assert.ok(Array.isArray(catalog), "catalog.json 必须是数组");

const expectedCatalog = registry.skills
  .filter((skill) => skill.enabled)
  .map((skill) => ({ id: skill.id, brief: skill.brief }));

assert.deepEqual(
  catalog,
  expectedCatalog,
  "catalog.json 与 registry 投影不一致。catalog 是生成物，请勿手改；运行: python skills/sync_catalog.py"
);

const catalogIds = new Set(catalog.map((item) => item.id));

// ---------- 3. 渐进式披露：catalog 每个 id 可查说明书 ----------
const docEntrypoint = path.join(skillsDir, "get_skill_doc.py");
assert.ok(existsSync(docEntrypoint), "缺少 skills/get_skill_doc.py");

for (const id of catalogIds) {
  const result = spawnSync(pythonBin, [docEntrypoint, id], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, `get_skill_doc.py ${id} 退出码非 0: ${result.stderr || result.stdout}`);
  const stdout = (result.stdout || "").trim();
  assert.ok(stdout.length > 0, `get_skill_doc.py ${id} 输出为空`);
  assert.ok(!stdout.startsWith("错误"), `get_skill_doc.py ${id} 返回错误: ${stdout.slice(0, 120)}`);
}

console.log(
  `Skills spec consistency tests passed. registry=${registryById.size} catalog=${catalogIds.size} python=${pythonBin}`
);
