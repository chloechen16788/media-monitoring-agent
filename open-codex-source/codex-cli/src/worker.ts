import "dotenv/config";
import { AgentLoop } from "./utils/agent/agent-loop.js";
import { loadConfig } from "./utils/config.js";
import { AutoApprovalMode } from "./utils/auto-approval-mode.js";
import { createInputItem } from "./utils/input-utils.js";
import { initLogger } from "./utils/agent/log.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";

initLogger();

async function runWorker() {
  // Read prompt and config from STDIN or env
  const prompt = process.env.WORKER_PROMPT || "";
  const cwd = process.env.WORKER_CWD || process.cwd();
  
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

  const dynamicSkillsInstruction = timeContext + `
=== DYNAMIC SKILL LIBRARY ===
You have access to a dynamic skill library.
1. Use the shell tool with command: ["cat", "/Users/Zhuanz/.gemini/antigravity/scratch/my-company-agent/skills/catalog.json"] to see available skills.
2. Once you find a suitable skill, use the shell tool with command: ["python", "/Users/Zhuanz/.gemini/antigravity/scratch/my-company-agent/skills/get_skill_doc.py", "<skill_id>"] to retrieve its detailed manual and parameters.
3. Call the skill script strictly following the manual using the shell tool.

CRITICAL RULES:
- ALWAYS explore the catalog FIRST.
- ALWAYS read the skill doc BEFORE executing a new skill.
- The 'command' parameter in the shell tool MUST ALWAYS be a JSON array of strings, e.g. ["python", "script.py", "--arg", "value"]. NEVER a single string.
- Only make ONE tool call at a time.
=============================
`;

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
    await agent.run([inputItem], prevItems);
    console.log(JSON.stringify({ type: "done" }));
  } catch (error) {
    console.error(JSON.stringify({ type: "error", error: error.message }));
  }
}

runWorker();
