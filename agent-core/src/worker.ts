import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AgentEvent, AgentMode } from "./types.js";
import { resolveProvider, createClient } from "./provider.js";
import { loadRegistry, buildCatalogText, ToolRegistry } from "./tool-registry.js";
import { buildMemoryPaths, readMemoryBlock } from "./memory.js";
import { AgentCore } from "./loop.js";
import { killAllActiveSkills } from "./skill-runner.js";

// When the gateway kills this worker (client disconnect / abort), Node exits
// immediately by default and leaves detached skill children as orphans. Catch
// termination first, kill any running skill's process group, then exit — so a
// stopped/aborted task actually stops instead of running headless forever.
let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    killAllActiveSkills("SIGTERM");
  } finally {
    process.exit(code);
  }
}
process.once("SIGTERM", () => shutdown(143));
process.once("SIGINT", () => shutdown(130));

function emit(event: AgentEvent): void {
  // Gateway 已在 /api/chat 中把当前用户输入写入内存 history；worker 不再回显
  // role="user" 的输入回声，避免历史记录重复。模型侧不会产出 user 消息。
  if (event.type === "item" && (event.data as { role?: string })?.role === "user") {
    return;
  }
  process.stdout.write(JSON.stringify(event) + "\n");
}

const IDENTITY = `=== IDENTITY ===
You are a Deep Research Agent developed by Chloe. If asked who you are, what model you use, or who developed you, reply ONLY that you are a Deep Research Agent developed by Chloe. Never mention underlying models or vendors.
================`;

function masterInstruction(catalog: string, skillDocHint: string): string {
  return `=== ROLE: MASTER (PLAN & VALIDATE) ===
你只做规划与验收，不执行 executor 技能。
- 你能看到下方全量技能目录（用于判断任务是否有匹配技能、该让 Sub 用哪些技能）。
- 需要技能细节时调用 get_skill_doc(skill_id) 阅读说明书。
- 你可执行的工具仅限 master 规划类（identify_report_type / plan_charts / write_task_contract）。
- 规划完成后必须调用 write_task_contract 落盘（goal / allowed_skills / acceptance_criteria）；未落盘的计划不生效。
- 缺少执行参数（uid / task_ids / 时间范围）时，输出 PARAM_REQUEST 魔法码请求补参，不要只用纯文本反问。
- 契约写入成功后，告知用户「规划已写入任务契约，请在界面确认后交给 Sub 执行」，不要声称已自动启动 Sub。
${skillDocHint}
=== SKILL CATALOG (全量可见) ===
${catalog}
======================================`;
}

function subInstruction(catalog: string, allowed: Array<string>, skillDocHint: string): string {
  return `=== ROLE: SUB (EXECUTE PER CONTRACT) ===
你严格按任务契约执行。
- 你可执行的工具仅限本次授权技能: ${allowed.length ? allowed.join(", ") : "(none)"}。
- 执行新技能前先调用 get_skill_doc(skill_id) 阅读说明书，再按参数调用。
- 若目标明显需要一个不在授权列表中的技能（如需饼图但只授权了折线图），不要静默替代；输出一次 SKILL_FALLBACK 魔法码并停止：
  [SKILL_FALLBACK_START]{"message":"缺失说明","missing_skills":["<skill_id>"],"context":"<用户目标摘要≤30字>"}[SKILL_FALLBACK_END]
- 单图任务：render_* 技能返回的 chart_block（[CHART_OPTION_START]...[CHART_OPTION_END]）必须原样复制进回复，禁止重排 JSON。
- 完整报告任务：可输出 [WORKSPACE_SCHEMA_START]{...}[WORKSPACE_SCHEMA_END] 并写 <UPDATE_INSIGHT> 块。
- 返回结构化结果供 Master 验收。
${skillDocHint}
=== SKILL CATALOG (全量可见) ===
${catalog}
======================================`;
}

async function main(): Promise<void> {
  const prompt = process.env.WORKER_PROMPT || "";
  const cwd = process.env.WORKER_CWD || process.cwd();
  const projectRoot = process.env.WORKER_PROJECT_ROOT || path.resolve(cwd, "..");
  const skillsDir = process.env.WORKER_SKILLS_DIR || path.join(projectRoot, "skills");
  const pythonBin = process.env.WORKER_PYTHON_BIN || "python3";
  const mode: AgentMode = process.env.WORKER_AGENT_MODE === "sub" ? "sub" : "master";
  const model = process.env.WORKER_MODEL || "gpt-4o-mini";
  const provider = process.env.WORKER_PROVIDER || "openai";
  const dataRoot = process.env.WORKER_DATA_ROOT || path.join(projectRoot, "data", "users");
  const userId = process.env.WORKER_USER_ID || "";
  const projectId = process.env.WORKER_PROJECT_ID || undefined;
  const sessionId = process.env.WORKER_SESSION_ID || undefined;

  let allowedSkills: Array<string> = [];
  try {
    allowedSkills = JSON.parse(process.env.WORKER_ALLOWED_SKILLS || "[]");
  } catch {
    allowedSkills = [];
  }

  const registry = loadRegistry(skillsDir);
  const catalog = buildCatalogText(registry);
  const memoryPaths = buildMemoryPaths(dataRoot, userId, projectId, sessionId);
  const memoryBlock = userId ? readMemoryBlock(memoryPaths) : "";

  const toolRegistry = new ToolRegistry({
    registry,
    mode,
    allowedSkills,
    runnerConfig: { pythonBin, skillsDir, projectRoot, baseEnv: process.env },
    memoryPaths,
  });

  const rolePrompt = process.env.WORKER_AGENT_SYSTEM_PROMPT || "";
  const skillDocHint = "";
  const roleInstruction =
    mode === "sub"
      ? subInstruction(catalog, allowedSkills, skillDocHint)
      : masterInstruction(catalog, skillDocHint);

  const now = new Date();
  const timeContext = `=== TIME ===\nNow: ${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n============`;

  const instructions = [
    IDENTITY,
    timeContext,
    memoryBlock,
    roleInstruction,
    rolePrompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  const providerCfg = resolveProvider(model, provider);
  const client = createClient(providerCfg);

  let prevItems: Array<ChatCompletionMessageParam> = [];
  try {
    const historyFile = path.join(cwd, "messages.json");
    if (existsSync(historyFile)) {
      prevItems = JSON.parse(readFileSync(historyFile, "utf8"));
    }
  } catch {
    prevItems = [];
  }

  const agent = new AgentCore({
    client,
    model,
    instructions,
    registry: toolRegistry,
    context: { sessionDir: cwd },
    emit,
  });

  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: prompt,
  };

  try {
    await agent.run([userMessage], prevItems);
    process.stdout.write(JSON.stringify({ type: "done" }) + "\n", () => process.exit(0));
  } catch (error) {
    process.stderr.write(
      JSON.stringify({ type: "error", error: (error as Error).message }) + "\n",
      () => process.exit(1),
    );
  }
}

main();
