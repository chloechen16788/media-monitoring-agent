import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import type {
  AgentMode,
  Registry,
  RegistrySkill,
  Tool,
  SkillRunnerConfig,
} from "./types.js";
import { runSkill, type SkillRunResult } from "./skill-runner.js";
import { memoryWriteTool, type MemoryPaths } from "./memory.js";

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });

export function loadRegistry(skillsDir: string): Registry {
  const registryPath = path.join(skillsDir, "registry.json");
  const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as Registry;
  if (!Array.isArray(parsed.skills)) {
    return { version: parsed.version ?? "v2", skills: [] };
  }
  return parsed;
}

/**
 * Knowledge layer: a compact catalog of ALL enabled skills (id / role / brief),
 * injected into the system prompt for both roles. Master needs full capability
 * awareness to plan; Sub needs it to emit accurate SKILL_FALLBACK.
 */
export function buildCatalogText(registry: Registry, allowlist?: Array<string> | null): string {
  const allowed = allowlist && allowlist.length > 0 ? new Set(allowlist) : null;
  const lines: Array<string> = [];
  for (const s of registry.skills) {
    if (!s.enabled) continue;
    if (allowed && !allowed.has(s.id)) continue;
    const role = s.type === "doc" ? "doc" : s.role ?? "-";
    lines.push(`- ${s.id} [${role}]: ${s.brief ?? ""}`);
  }
  return lines.join("\n");
}

/** Format a raw skill process result into a tool-message string for the model. */
function formatSkillResult(skill: RegistrySkill, r: SkillRunResult): string {
  if (r.timedOut) {
    return JSON.stringify({
      ok: false,
      error: `skill '${skill.id}' 执行超时`,
      stderr: r.stderr.slice(-800),
    });
  }
  if (r.exitCode !== 0) {
    return JSON.stringify({
      ok: false,
      error: `skill '${skill.id}' 退出码 ${r.exitCode}`,
      stderr: r.stderr.slice(-800),
      stdout: r.stdout.slice(-800),
    });
  }
  const out = r.stdout.trim();
  // Inject produced_files (workspace basenames) so the gateway/frontend can render
  // download links regardless of each skill's own output field naming.
  if (r.producedFiles.length > 0) {
    try {
      const parsed = out.length > 0 ? JSON.parse(out) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        (parsed as Record<string, unknown>).produced_files = r.producedFiles;
        return JSON.stringify(parsed);
      }
    } catch {
      /* stdout wasn't JSON; fall through to wrapper below */
    }
    return JSON.stringify({ ok: true, produced_files: r.producedFiles, stdout: out.slice(0, 2000) });
  }
  return out.length > 0 ? out : JSON.stringify({ ok: true, note: "skill produced no stdout" });
}

/** In-process skill doc reader (mirrors get_skill_doc.py; no spawn). */
function readSkillDoc(registry: Registry, skillsDir: string, projectRoot: string, skillId: string): string {
  const skill = registry.skills.find((s) => s.id === skillId);
  if (!skill) {
    return `错误: 找不到技能 '${skillId}'。请查阅 catalog 获取正确的技能 ID。`;
  }
  if (!skill.enabled) return `错误: 技能 '${skillId}' 已停用。`;
  if (skill.type === "doc") {
    const p = path.resolve(projectRoot, skill.entry);
    if (!existsSync(p)) return `错误: 文档文件不存在: ${skill.entry}`;
    return readFileSync(p, "utf8");
  }
  const docPath = path.join(skillsDir, "docs", `${skillId}.md`);
  const meta = [
    `【技能名称】: ${skill.id}`,
    `【角色】: ${skill.role ?? "-"}`,
    `【脚本路径】: ${skill.entry}`,
    `【简介】: ${skill.brief ?? ""}`,
  ].join("\n");
  if (!existsSync(docPath)) {
    // No long-form doc: return meta + schema so the model still gets params.
    const schema = skill.input_schema
      ? `\n【参数 schema】: ${JSON.stringify(skill.input_schema)}`
      : "";
    return meta + schema;
  }
  return `${meta}\n${readFileSync(docPath, "utf8").trimEnd()}`;
}

function getSkillDocTool(
  registry: Registry,
  skillsDir: string,
  projectRoot: string,
  allowlist?: Array<string> | null,
): Tool {
  const allowed = allowlist && allowlist.length > 0 ? new Set(allowlist) : null;
  return {
    name: "get_skill_doc",
    description:
      "读取技能的完整说明书（参数、用法、样例、流程）。规划或执行前用它了解技能能力。",
    parameters: {
      type: "object",
      required: ["skill_id"],
      additionalProperties: false,
      properties: { skill_id: { type: "string" } },
    },
    run: async (args) => {
      const skillId = String(args.skill_id || "");
      if (allowed && !allowed.has(skillId)) {
        return `错误: 当前用户无权查阅技能 '${skillId}'。`;
      }
      return readSkillDoc(registry, skillsDir, projectRoot, skillId);
    },
  };
}

/** Build an executable tool for one script skill (with schema validation). */
function makeSkillTool(skill: RegistrySkill, cfg: SkillRunnerConfig): Tool {
  let validate: ValidateFunction | undefined;
  if (skill.input_schema) {
    try {
      validate = ajv.compile(skill.input_schema);
    } catch {
      validate = undefined;
    }
  }
  return {
    name: skill.id,
    description: skill.brief ?? skill.id,
    parameters: skill.input_schema ?? { type: "object", additionalProperties: true },
    run: async (args, ctx) => {
      if (validate && !validate(args)) {
        return JSON.stringify({
          ok: false,
          error: "参数校验失败",
          details: ajv.errorsText(validate.errors),
        });
      }
      const startedAt = Date.now();
      // Liveness ticker: even skills that print nothing get a "still running"
      // heartbeat every 10s so the user knows the long task hasn't stalled.
      let ticker: ReturnType<typeof setInterval> | undefined;
      if (ctx.emitProgress) {
        ticker = setInterval(() => {
          const sec = Math.round((Date.now() - startedAt) / 1000);
          ctx.emitProgress?.({ skill: skill.id, message: `执行中… ${sec}s`, elapsed_ms: Date.now() - startedAt });
        }, 10_000);
        if (typeof ticker.unref === "function") ticker.unref();
      }
      const onStderrLine = ctx.emitProgress
        ? (line: string) =>
            ctx.emitProgress?.({ skill: skill.id, message: line, elapsed_ms: Date.now() - startedAt })
        : undefined;
      try {
        const result = await runSkill(skill, args ?? {}, ctx, cfg, onStderrLine);
        return formatSkillResult(skill, result);
      } finally {
        if (ticker) clearInterval(ticker);
      }
    },
  };
}

export interface ToolRegistryOptions {
  registry: Registry;
  mode: AgentMode;
  allowedSkills: Array<string>;
  runnerConfig: SkillRunnerConfig;
  memoryPaths: MemoryPaths;
  /** Per-user skill allowlist. Empty/omitted = unrestricted. */
  userSkillAllowlist?: Array<string> | null;
}

/**
 * The complete model-visible tool table. Executable tools are role-scoped
 * (security boundary 1); knowledge tools (get_skill_doc / memory_write) are
 * always present. userSkillAllowlist is a hard cap for both roles.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(opts: ToolRegistryOptions) {
    const { registry, mode, allowedSkills, runnerConfig, memoryPaths, userSkillAllowlist } = opts;
    const userAllowed =
      userSkillAllowlist && userSkillAllowlist.length > 0 ? new Set(userSkillAllowlist) : null;
    // Master 默认拥有全部 script 技能执行权；Sub 限定在契约 allowed_skills。
    // 若设置了用户白名单，两端都只能执行名单内技能（cmm 等受限账号）。
    const executable = registry.skills.filter((s) => {
      if (!s.enabled || s.type !== "script") return false;
      if (userAllowed && !userAllowed.has(s.id)) return false;
      if (mode === "master") return true;
      return s.role === "sub" && allowedSkills.includes(s.id);
    });
    for (const skill of executable) {
      this.tools.set(skill.id, makeSkillTool(skill, runnerConfig));
    }
    const docTool = getSkillDocTool(
      registry,
      runnerConfig.skillsDir,
      runnerConfig.projectRoot,
      userSkillAllowlist,
    );
    this.tools.set(docTool.name, docTool);
    const memTool = memoryWriteTool(memoryPaths);
    this.tools.set(memTool.name, memTool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): Array<string> {
    return [...this.tools.keys()];
  }

  /** OpenAI function-tools payload for chat.completions. */
  toOpenAITools(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.names().map((name) => {
      const t = this.tools.get(name)!;
      return {
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      };
    });
  }
}
