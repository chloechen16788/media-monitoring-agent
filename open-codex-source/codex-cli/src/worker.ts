import "dotenv/config";
import { AgentLoop } from "./utils/agent/agent-loop.js";
import { loadConfig } from "./utils/config.js";
import { AutoApprovalMode } from "./utils/auto-approval-mode.js";
import { createInputItem } from "./utils/input-utils.js";
import { initLogger } from "./utils/agent/log.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import { sanitizeMessagesForApi } from "./utils/parsers.js";
import path from "path";

initLogger();

async function runWorker() {
  // Read prompt and config from STDIN or env
  const prompt = process.env.WORKER_PROMPT || "";
  const cwd = process.env.WORKER_CWD || process.cwd();
  const projectRoot =
    process.env.WORKER_PROJECT_ROOT || path.resolve(cwd, "..");
  const skillsDir =
    process.env.WORKER_SKILLS_DIR || path.join(projectRoot, "skills");
  const catalogPath = path.join(skillsDir, "catalog.json");
  const skillDocEntrypoint = path.join(skillsDir, "get_skill_doc.py");
  const workerAgentMode = process.env.WORKER_AGENT_MODE === "sub" ? "sub" : "master";
  const roleSystemPrompt = process.env.WORKER_AGENT_SYSTEM_PROMPT || "";
  const taskContractFile = process.env.WORKER_TASK_CONTRACT_FILE || "";
  let allowedSkills: Array<string> = [];
  try {
    allowedSkills = JSON.parse(process.env.WORKER_ALLOWED_SKILLS || "[]");
  } catch {
    allowedSkills = [];
  }
  
  const configBase = loadConfig(undefined, undefined, {
    cwd: cwd,
    isFullContext: false,
    provider: process.env.WORKER_PROVIDER,
  });

  const config = {
    ...configBase,
    model: process.env.WORKER_MODEL || configBase.model,
    provider: process.env.WORKER_PROVIDER || configBase.provider,
  };

  const now = new Date();
  const timeContext = `
=== SYSTEM CONTEXT ===
Current Date and Time: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
Day of Week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]}
======================

=== IDENTITY INSTRUCTION ===
You are a Deep Research Agent developed by Chloe. 
If anyone asks who you are, what model you use, or who developed you, you MUST reply EXCLUSIVELY that you are a Deep Research Agent developed by Chloe. 
You are STRICTLY FORBIDDEN from mentioning Codex CLI, OpenAI, any base models (like GPT, Claude, etc.), or any other company names.
============================
`;

  const roleInstruction = `
=== AGENT ROLE MODE ===
Current Agent Mode: ${workerAgentMode}
Task Contract File: ${taskContractFile || "N/A"}
Allowed Skills: ${allowedSkills.length > 0 ? allowedSkills.join(", ") : "N/A"}
${roleSystemPrompt ? `Role Prompt:\n${roleSystemPrompt}` : ""}
=======================
`;

  const masterSkillInstruction = `
=== DYNAMIC SKILL LIBRARY (MASTER / PLANNING) ===
You are the Master agent. You PLAN and VALIDATE; you DO NOT execute executor skills yourself.
You have FULL read access to the skill library for planning purposes:
1. Use ["cat", "${catalogPath}"] to inspect ALL available skills, so you can judge whether a task has matching skills and which skills the Sub should use.
2. Use ["python", "${skillDocEntrypoint}", "<skill_id>"] to read any skill's manual.

YOUR EXECUTABLE SCOPE (master-only):
- You may ONLY execute skills whose role is "master" (e.g. identify_report_type, plan_charts).
- You MUST NOT execute executor (role="sub") skills such as es_agg_search / run_es_agent.
- You MUST NOT output the Generative UI magic code ([WORKSPACE_SCHEMA_START] ... [WORKSPACE_SCHEMA_END]); triggering the report engine is the Sub's job.
- When required execution params are missing (uid / task_ids / date range etc.), DO NOT ask with plain prose only. Emit a PARAM_REQUEST block so frontend can render structured input controls:
  [PARAM_REQUEST_START]{"title":"...","fields":[{"key":"uid","label":"用户 UID","type":"text","required":true,"pattern":"^\\\\d+$","hint":"请输入数字 UID"},{"key":"time_range","label":"查询时间段","type":"daterange","required":true}]}[PARAM_REQUEST_END]
- PARAM_REQUEST is Master-only. Sub must not output it.

YOUR DELIVERABLES EACH TURN (plan -> persist -> hand off):
- Decide the report type / chart plan (use master skills when helpful).
- Produce a plan: goal, acceptance criteria, and the list of allowed_skills the Sub should use.
- PERSIST the plan by calling the write_task_contract skill, e.g.:
  ["python", "${path.join(skillsDir, "planner", "write_task_contract.py")}", "{\\"goal\\": \\"...\\", \\"allowed_skills\\": [\\"...\\"], \\"acceptance_criteria\\": [\\"...\\"]}"]
  A plan that is not persisted via write_task_contract DOES NOT take effect.
- After a successful write, tell the user the plan is saved and ask them to confirm hand-off to the Sub in the UI. Do not run the execution yourself and do not claim the Sub has started.

CRITICAL RULES:
- The 'command' parameter in the shell tool MUST ALWAYS be a JSON array of strings. NEVER a single string.
- Only make ONE tool call at a time.
=================================================
`;

  const subSkillInstruction = `
=== DYNAMIC SKILL LIBRARY (SUB / EXECUTION) ===
You are the Sub agent. You EXECUTE the task strictly per the task contract.
1. Use ["cat", "${catalogPath}"] to see available skills.
2. Use ["python", "${skillDocEntrypoint}", "<skill_id>"] to read a skill's manual before executing it.
3. Call the skill script strictly following the manual.

EXECUTION SCOPE:
- You may ONLY execute skills listed in task_contract.allowed_skills (role="sub").
- Use absolute script paths under the skills directory when possible, e.g. ["python", "${skillDocEntrypoint}", "es_agg_search"] for docs and ["python", "${path.join(skillsDir, "es_agg_search.py")}", ...] for execution.
- Script locations vary: legacy skills sit in skills/, newer ones in skills/executor/ or skills/planner/. NEVER guess a script path — always use the exact 【脚本路径】 from the skill doc (get_skill_doc.py <skill_id>).
- advanced_chart_sampling is a schema document, NOT a .py script. Read it only via get_skill_doc.py, then implement sampling using es_sample_search.py.
- You own the report engine and Generative UI, but use the RIGHT magic code for the RIGHT task type:
  - FULL REPORT task (goal asks for a complete report / big screen, via generate_report SOP): you may output [WORKSPACE_SCHEMA_START]{"schemaKey":"..."}[WORKSPACE_SCHEMA_END] and write <UPDATE_INSIGHT> blocks.
  - SINGLE CHART task (render_line_chart / render_pie_chart / any render_* skill): the skill returns data.chart_block — a ready-made [CHART_OPTION_START]{...}[CHART_OPTION_END] string. COPY it into your reply VERBATIM, character-for-character. NEVER re-type, re-format or prettify the JSON inside (hand-copying breaks the JSON and rendering fails). NEVER output WORKSPACE_SCHEMA magic code for single-chart tasks.
- Return structured results for the Master to validate.

SKILL GAP DETECTION (important):
- Before executing, compare the task goal with task_contract.allowed_skills.
- If the goal clearly requires a skill that is NOT in allowed_skills (e.g. goal says "饼图" but only render_line_chart is allowed), DO NOT silently substitute a different skill.
- Instead, output the following magic code ONCE and stop — do not attempt execution:
  [SKILL_FALLBACK_START]{"message":"<one-line description of what is missing and why>","missing_skills":["<skill_id>"],"context":"<brief summary of user goal, ≤30 chars>"}[SKILL_FALLBACK_END]
- If the goal is ambiguous or the existing skills CAN reasonably fulfill it, proceed normally without emitting SKILL_FALLBACK.
- NEVER emit SKILL_FALLBACK just because a skill is unfamiliar — only when the mismatch is clear and substitution would produce wrong output type (e.g. wrong chart type).

CRITICAL RULES:
- ALWAYS read the skill doc BEFORE executing a new skill.
- The 'command' parameter in the shell tool MUST ALWAYS be a JSON array of strings. NEVER a single string.
- Only make ONE tool call at a time.

MARKDOWN FORMATTING RULES (apply to ALL reply text):
1. TABLES: Any list of ranked/multi-column data (排名、频次、占比等) MUST use markdown table syntax with | delimiters.
   ✅ | 排名 | 关键词 | 频次 | 占比 |
   ✅ |------|--------|------|------|
   ✅ | 1    | AI     | 1633 | 17.5% |
   ❌ "1  AI  1633  17.5%" (plain text space-alignment is FORBIDDEN)
2. NESTED LISTS: Sub-items (核心事件、代表文章 etc.) must be indented with 2 spaces before "-".
   ✅ - **AI**（1,633次，占17.5%）
   ✅   - 核心事件：...
   ✅   - 代表文章：《标题》（来源，日期）
   ❌ Flat list where sub-items share the same indent level as parent items.
3. SPACING: Use a blank line before/after every heading, table, and major list block. Do NOT stack items without breathing room.
4. DIVIDERS: Use "---" sparingly — only at top-level section boundaries. Never use --- between every item.
===============================================
`;

  const dynamicSkillsInstruction =
    timeContext +
    roleInstruction +
    (workerAgentMode === "sub" ? subSkillInstruction : masterSkillInstruction);

  const agent = new AgentLoop({
    model: config.model,
    config: config,
    instructions: dynamicSkillsInstruction + "\n\n" + (config.instructions || ""),
    approvalPolicy: AutoApprovalMode.FULL_AUTO, // Always full auto for workers
    onItem: (item: ChatCompletionMessageParam) => {
      // Emit JSON event to stdout
      console.log(JSON.stringify({ type: "item", data: item }));
    },
    onLoading: (loading: boolean) => {
      console.log(JSON.stringify({ type: "loading", data: loading }));
    },
    getCommandConfirmation: async () => {
      return { review: "yes" as any };
    },
    onReset: () => {
      console.log(JSON.stringify({ type: "reset" }));
    },
  });

  const inputItem = await createInputItem(prompt, []);
  
  let prevItems: any[] = [];
  try {
    const fs = await import("fs");
    const path = await import("path");
    const historyFile = path.join(cwd, "messages.json");
    if (fs.existsSync(historyFile)) {
      prevItems = JSON.parse(fs.readFileSync(historyFile, "utf8"));
    }
  } catch (e) {
    // ignore
  }

  try {
    const safePrevItems = sanitizeMessagesForApi(
      prevItems as Array<ChatCompletionMessageParam>,
    );
    await agent.run([inputItem], safePrevItems);
    // 任务完成后必须主动退出：OpenAI 客户端的 keep-alive 连接等句柄会让进程
    // 一直挂着，gateway 依赖进程 close 事件才能结束 SSE 流。
    // 用 write 回调确保 done 事件刷写到管道后再退出，避免 stdout 截断。
    process.stdout.write(JSON.stringify({ type: "done" }) + "\n", () => {
      process.exit(0);
    });
  } catch (error) {
    process.stderr.write(
      JSON.stringify({ type: "error", error: error.message }) + "\n",
      () => {
        process.exit(1);
      },
    );
  }
}

runWorker();
