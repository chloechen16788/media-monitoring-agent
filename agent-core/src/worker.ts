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
const workerAbort = new AbortController();
let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    workerAbort.abort();
    killAllActiveSkills("SIGKILL");
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

// 两个角色共用的输出约束：产出文件由系统以下载按钮呈现，回复正文不得暴露服务器地址/完整下载链接。
const COMMON_OUTPUT_RULES = `=== OUTPUT RULES ===
- 技能产出的文件会由系统自动在界面上以下载按钮呈现。你在回复中只需说明生成了哪些文件（用文件名即可），并提示用户点击下载按钮获取。
- 禁止在回复正文里输出完整下载链接或服务器地址（例如 http://…/api/… 或本地绝对路径），也不要凭空编造下载 URL。
================`;

function masterInstruction(catalog: string, skillDocHint: string, restricted: boolean): string {
  if (restricted) {
    return `=== ROLE: MASTER (RESTRICTED, EXECUTE DIRECTLY) ===
你在受限账号下工作：只能使用下方目录中的技能，直接执行，不必写 task_contract，也不必转交 Sub。
- 需要技能细节时调用 get_skill_doc(skill_id)。
- 用户要搜小红书关键词时：只要列表、未明确要粉丝，用 xiaohongshu_keyword_search_nofans；明确要粉丝用 xiaohongshu_keyword_search；要正文用 xiaohongshu_keyword_search_fulltext。导出后只报文件名，并必须原样贴出 data.cost.table 金额表。
- 用户要搜 Reddit 关键词时：用 reddit_keyword_search（只搜帖子；默认 sort=NEW、time_range=month、搜索 1 页；每帖评论 NEW 翻 2 页）。导出后只报文件名，并必须原样贴出 data.cost.table 金额表。
- 用户给博主账号 id / 主页链接、要该账号已发布笔记时：用 xiaohongshu_user_posted_notes，未指定页数默认 10 页。不要用关键词搜索代替。导出后只报文件名，并必须原样贴出 data.cost.table 金额表。
- 用户上传 Excel/CSV 且要根据笔记链接补点赞/收藏/评论/转发时，直接调用 xiaohongshu_note_detail_by_links（一个技能完成读表+抽 note_id+调详情+写回）。禁止用 ske_social_tagging 读列，禁止拆成 read_tabular_data + 关键词搜索。导出后只报文件名，并必须原样贴出 data.cost.table 金额表。
- 用户只要查看/抽出某列原文（不打标、不拉详情）时，用 read_tabular_data（可用 fields 只留该列）。需要把结果写回文件时用 write_tabular_data。
- 用户要按提示词给社媒表打标时，才用 ske_social_tagging。完成后只报文件名，提示点击下载按钮。
- 缺少必要参数（关键词、列名、文件路径）时用 PARAM_REQUEST 补参。
- 禁止调用目录以外的技能。
${COMMON_OUTPUT_RULES}
${skillDocHint}
=== SKILL CATALOG (仅授权技能) ===
${catalog}
======================================`;
  }
  return `=== ROLE: MASTER (PLAN-FIRST, CAN EXECUTE) ===
你负责规划与验收，同时拥有全部技能的执行权限。
- 你能看到下方全量技能目录，也可执行其中任意 script 技能（规划类 + 执行类），不受 allowed_skills 限制。
- 需要技能细节时调用 get_skill_doc(skill_id) 阅读说明书，再按参数调用。
- 【默认流程】仍是先规划：identify_report_type / plan_charts 后调用 write_task_contract 落盘（goal / allowed_skills / acceptance_criteria），再由 Sub 按契约执行。未落盘的计划不生效。
- 【临时调整 / 用户显式指定某技能 / 小改动】可直接执行对应技能，无需先写契约、无需转交 Sub。
- 小红书检索：未明确要粉丝时用 xiaohongshu_keyword_search_nofans；要粉丝用 xiaohongshu_keyword_search；要正文用 xiaohongshu_keyword_search_fulltext。按博主账号 id 取已发布笔记用 xiaohongshu_user_posted_notes（默认 10 页）。按已有笔记链接补互动数据用 xiaohongshu_note_detail_by_links。导出后必须原样贴出 data.cost.table。
- Reddit 检索：用 reddit_keyword_search（只搜帖子，默认 NEW + month，搜索 1 页，每帖评论 NEW 翻 2 页）。导出后必须原样贴出 data.cost.table。
- 缺少执行参数（uid / task_ids / 时间范围）时，输出 PARAM_REQUEST 魔法码请求补参，不要只用纯文本反问。
- 走契约流程时，契约写入成功后告知用户「规划已写入任务契约，请在界面确认后交给 Sub 执行」，不要声称已自动启动 Sub。
${COMMON_OUTPUT_RULES}
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
${COMMON_OUTPUT_RULES}
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

  let userSkillAllowlist: Array<string> | null = null;
  try {
    const raw = process.env.WORKER_USER_SKILL_ALLOWLIST || "";
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        userSkillAllowlist = parsed.map((x: unknown) => String(x));
      }
    }
  } catch {
    userSkillAllowlist = null;
  }

  const registry = loadRegistry(skillsDir);
  const catalog = buildCatalogText(registry, userSkillAllowlist);
  const memoryPaths = buildMemoryPaths(dataRoot, userId, projectId, sessionId);
  const memoryBlock = userId ? readMemoryBlock(memoryPaths) : "";

  const toolRegistry = new ToolRegistry({
    registry,
    mode,
    allowedSkills,
    userSkillAllowlist,
    runnerConfig: { pythonBin, skillsDir, projectRoot, baseEnv: process.env },
    memoryPaths,
  });

  const rolePrompt = process.env.WORKER_AGENT_SYSTEM_PROMPT || "";
  const skillDocHint = "";
  const roleInstruction =
    mode === "sub"
      ? subInstruction(catalog, allowedSkills, skillDocHint)
      : masterInstruction(catalog, skillDocHint, Boolean(userSkillAllowlist));

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
    context: { sessionDir: cwd, signal: workerAbort.signal },
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
