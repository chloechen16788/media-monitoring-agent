import type { CommandConfirmation } from "./agent-loop.js";
import type { AppConfig } from "../config.js";
import type { ExecInput } from "./sandbox/interface.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { exec, execApplyPatch } from "./exec.js";
import { isLoggingEnabled, log } from "./log.js";
import { ReviewDecision } from "./review.js";
import { FullAutoErrorMode } from "../auto-approval-mode.js";
import { SandboxType } from "./sandbox/interface.js";
import { canAutoApprove } from "../../approvals.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { access } from "fs/promises";
import path from "path";
import { existsSync, readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Session‑level cache of commands that the user has chosen to always approve.
//
// The values are derived via `deriveCommandKey()` which intentionally ignores
// volatile arguments (for example the patch text passed to `apply_patch`).
// Storing *generalised* keys means that once a user selects "always approve"
// for a given class of command we will genuinely stop prompting them for
// subsequent, equivalent invocations during the same CLI session.
// ---------------------------------------------------------------------------
const alwaysApprovedCommands = new Set<string>();

// ---------------------------------------------------------------------------
// Helper: Given the argv-style representation of a command, return a stable
// string key that can be used for equality checks.
//
// The key space purposefully abstracts away parts of the command line that
// are expected to change between invocations while still retaining enough
// information to differentiate *meaningfully distinct* operations.  See the
// extensive inline documentation for details.
// ---------------------------------------------------------------------------

function deriveCommandKey(cmd: Array<string>): string {
  // pull off only the bits you care about
  const [
    maybeShell,
    maybeFlag,
    coreInvocation,
    /* …ignore the rest… */
  ] = cmd;

  if (coreInvocation?.startsWith("apply_patch")) {
    return "apply_patch";
  }

  if (maybeShell === "bash" && maybeFlag === "-lc") {
    // If the command was invoked through `bash -lc "<script>"` we extract the
    // base program name from the script string.
    const script = coreInvocation ?? "";
    return script.split(/\s+/)[0] || "bash";
  }

  // For every other command we fall back to using only the program name (the
  // first argv element).  This guarantees we always return a *string* even if
  // `coreInvocation` is undefined.
  if (coreInvocation) {
    return coreInvocation.split(/\s+/)[0]!;
  }

  return JSON.stringify(cmd);
}

type HandleExecCommandResult = {
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
};

function isPathInside(parent: string, candidate: string): boolean {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function looksLikePythonCommand(bin: string | undefined): boolean {
  if (!bin) return false;
  const base = path.basename(bin);
  return /^python(\d+(\.\d+)?)?$/.test(base);
}

type CommandSafetyCheck = {
  safe: boolean;
  normalizedCmd?: Array<string>;
  reason: string;
};

type RegistrySkill = {
  id: string;
  role?: string;
  entry?: string;
};

let registrySkillCache:
  | {
      byScriptPath: Map<string, RegistrySkill>;
      bySkillId: Map<string, RegistrySkill>;
    }
  | undefined;

function resolveSkillScriptPath(
  rawScript: string,
  cwd: string,
  skillsDir: string,
  registry?: ReturnType<typeof loadRegistrySkills>,
): string {
  const candidates = [
    path.resolve(cwd, rawScript),
    path.resolve(skillsDir, "..", rawScript),
    path.resolve(skillsDir, path.basename(rawScript)),
  ];
  // 自愈：按脚本名（=技能 id）回查 registry 的 entry 路径，
  // 自动纠正目录层级写错的调用（如 skills/<id>.py -> skills/executor/<id>.py）。
  const registrySkill = registry?.bySkillId.get(path.basename(rawScript, ".py"));
  if (registrySkill?.entry) {
    candidates.push(path.resolve(skillsDir, "..", registrySkill.entry));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve(cwd, rawScript);
}

function lookupRegistrySkill(
  scriptPath: string,
  registry: ReturnType<typeof loadRegistrySkills>,
): RegistrySkill | undefined {
  return (
    registry.byScriptPath.get(scriptPath) ??
    registry.bySkillId.get(path.basename(scriptPath, ".py"))
  );
}

function loadRegistrySkills(skillsDir: string) {
  if (registrySkillCache) return registrySkillCache;
  const registryPath = path.resolve(skillsDir, "registry.json");
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
    const byScriptPath = new Map<string, RegistrySkill>();
    const bySkillId = new Map<string, RegistrySkill>();
    for (const skill of skills) {
      if (!skill?.id) continue;
      const normalized: RegistrySkill = {
        id: String(skill.id),
        role: skill.role ? String(skill.role) : undefined,
        entry: skill.entry ? String(skill.entry) : undefined,
      };
      bySkillId.set(normalized.id, normalized);
      if (normalized.entry) {
        byScriptPath.set(path.resolve(skillsDir, "..", normalized.entry), normalized);
      }
    }
    registrySkillCache = { byScriptPath, bySkillId };
    return registrySkillCache;
  } catch {
    registrySkillCache = { byScriptPath: new Map(), bySkillId: new Map() };
    return registrySkillCache;
  }
}

async function validateEnterpriseSkillCommand(
  command: Array<string>,
  workdir?: string,
): Promise<CommandSafetyCheck> {
  if (command.length === 0) {
    return { safe: false, reason: "Empty command is not allowed." };
  }

  const cwd = workdir || process.cwd();
  const projectRoot =
    process.env.WORKER_PROJECT_ROOT || path.resolve(cwd, "..");
  const skillsDir = path.resolve(
    process.env.WORKER_SKILLS_DIR || path.join(projectRoot, "skills"),
  );
  const catalogPath = path.resolve(skillsDir, "catalog.json");
  const workerMode = process.env.WORKER_AGENT_MODE === "sub" ? "sub" : "master";
  let allowedSkills: Array<string> = [];
  try {
    allowedSkills = JSON.parse(process.env.WORKER_ALLOWED_SKILLS || "[]");
  } catch {
    allowedSkills = [];
  }
  const registry = loadRegistrySkills(skillsDir);

  if (command[0] === "cat" && command.length === 2) {
    const targetPath = resolveSkillScriptPath(command[1]!, cwd, skillsDir);
    if (targetPath === catalogPath || path.basename(targetPath) === "catalog.json") {
      return { safe: true, normalizedCmd: ["cat", catalogPath], reason: "catalog read allowed" };
    }
    return {
      safe: false,
      reason: "Only reading skills/catalog.json is allowed for cat.",
    };
  }

  if (looksLikePythonCommand(command[0])) {
    if (command.length < 2) {
      return { safe: false, reason: "Python command requires a script path." };
    }

    const scriptPath = resolveSkillScriptPath(command[1]!, cwd, skillsDir, registry);
    if (!scriptPath.endsWith(".py")) {
      return {
        safe: false,
        reason: "Only Python scripts (*.py) are allowed.",
      };
    }
    if (!isPathInside(skillsDir, scriptPath)) {
      return {
        safe: false,
        reason: "Python script must be located inside the skills directory.",
      };
    }

    try {
      await access(scriptPath);
    } catch {
      return {
        safe: false,
        reason: `Python script not found: ${command[1]}. Run ["python", "${path.join(
          skillsDir,
          "get_skill_doc.py",
        )}", "<skill_id>"] first and use the exact 【脚本路径】 from the manual (newer skills live in skills/executor/ or skills/planner/, not skills/).`,
      };
    }

    const registrySkill = lookupRegistrySkill(scriptPath, registry);
    const isSkillDocScript = path.basename(scriptPath) === "get_skill_doc.py";
    if (workerMode === "master") {
      if (isSkillDocScript) {
        const pythonBin = process.env.WORKER_PYTHON_BIN?.trim() || command[0]!;
        return {
          safe: true,
          normalizedCmd: [pythonBin, scriptPath, ...command.slice(2)],
          reason: "skill doc retrieval allowed in master mode",
        };
      }
      // Master 默认只允许显式登记为 role=master 的脚本，避免旧链路未登记技能绕过策略。
      if (!registrySkill || registrySkill.role !== "master") {
        return {
          safe: false,
          reason:
            "Master agent is policy-restricted to planning/validation and cannot execute executor or unregistered skills.",
        };
      }
    }
    if (workerMode === "sub") {
      if (isSkillDocScript) {
        const pythonBin = process.env.WORKER_PYTHON_BIN?.trim() || command[0]!;
        return {
          safe: true,
          normalizedCmd: [pythonBin, scriptPath, ...command.slice(2)],
          reason: "skill doc retrieval allowed in sub mode",
        };
      }
      if (!registrySkill || registrySkill.role !== "sub") {
        return {
          safe: false,
          reason:
            "Sub agent only accepts sub-role skills declared in registry and task_contract.allowed_skills.",
        };
      }
      if (!allowedSkills.includes(registrySkill.id)) {
        return {
          safe: false,
          reason: `Sub agent can only execute task_contract.allowed_skills. '${registrySkill.id}' is not allowed.`,
        };
      }
    }

    const pythonBin = process.env.WORKER_PYTHON_BIN?.trim() || command[0]!;
    return {
      safe: true,
      normalizedCmd: [pythonBin, scriptPath, ...command.slice(2)],
      reason: "skills python execution allowed",
    };
  }

  return {
    safe: false,
    reason:
      "Only `cat skills/catalog.json` or `python <skills/*.py>` commands are allowed.",
  };
}

export async function handleExecCommand(
  args: ExecInput,
  config: AppConfig,
  policy: ApprovalPolicy,
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>,
  abortSignal?: AbortSignal,
): Promise<HandleExecCommandResult> {
  const { cmd: command } = args;

  const key = deriveCommandKey(command);

  // 1) If the user has already said "always approve", skip
  //    any policy & never sandbox.
  if (alwaysApprovedCommands.has(key)) {
    return execCommand(
      args,
      /* applyPatch */ undefined,
      /* runInSandbox */ false,
      abortSignal,
    ).then(convertSummaryToResult);
  }

  // 2) Enterprise Dynamic Skills核心安全拦截层 (Phase 5)
  // 仅允许读取 skills/catalog.json 或执行 skills 目录下的 Python 脚本。
  const fullCmdStr = command.join(" ");
  const safetyCheck = await validateEnterpriseSkillCommand(command, args.workdir);

  if (!safetyCheck.safe && deriveCommandKey(command) !== "apply_patch") {
    log(`❌ 拦截到非法操作: ${fullCmdStr} | reason=${safetyCheck.reason}`);
    return {
      outputText: `Permission Denied: 本企业沙箱安全策略仅允许执行 \`cat skills/catalog.json\` 或 \`python skills/*.py\` 进行技能调用。禁止执行任意系统命令（如 rm, ls, curl 等）。拒绝原因: ${safetyCheck.reason ?? "unknown"}`,
      metadata: {
        error: "command rejected by enterprise sandbox",
        reason: safetyCheck.reason,
      }
    };
  }

  // 特权提权：安全命令可直接执行（跳过沙箱与二次弹窗）
  if (safetyCheck.safe) {
    args.cmd = safetyCheck.normalizedCmd || [...command];

    // 直接执行，跳过沙箱和二次弹窗
    const summary = await execCommand(
      args,
      undefined,
      false, // runInSandbox = false
      abortSignal
    );
    return convertSummaryToResult(summary);
  }

  // 3) Otherwise fall back to the normal policy
  // `canAutoApprove` now requires the list of writable roots that the command
  // is allowed to modify.  For the CLI we conservatively pass the current
  // working directory so that edits are constrained to the project root.  If
  // the caller wishes to broaden or restrict the set it can be made
  // configurable in the future.
  const safety = canAutoApprove(command, policy, [process.cwd()]);

  let runInSandbox: boolean;
  switch (safety.type) {
    case "ask-user": {
      const review = await askUserPermission(
        args,
        safety.applyPatch,
        getCommandConfirmation,
      );
      if (review != null) {
        return review;
      }

      runInSandbox = false;
      break;
    }
    case "auto-approve": {
      runInSandbox = safety.runInSandbox;
      break;
    }
    case "reject": {
      return {
        outputText: "aborted",
        metadata: {
          error: "command rejected",
          reason: "Command rejected by auto-approval system.",
        },
      };
    }
  }

  const { applyPatch } = safety;
  const summary = await execCommand(
    args,
    applyPatch,
    runInSandbox,
    abortSignal,
  );
  // If the operation was aborted in the meantime, propagate the cancellation
  // upward by returning an empty (no‑op) result so that the agent loop will
  // exit cleanly without emitting spurious output.
  if (abortSignal?.aborted) {
    return {
      outputText: "",
      metadata: {},
    };
  }
  if (
    summary.exitCode !== 0 &&
    runInSandbox &&
    // Default: If the user has configured to ignore and continue,
    // skip re-running the command.
    //
    // Otherwise, if they selected "ask-user", then we should ask the user
    // for permission to re-run the command outside of the sandbox.
    config.fullAutoErrorMode &&
    config.fullAutoErrorMode === FullAutoErrorMode.ASK_USER
  ) {
    const review = await askUserPermission(
      args,
      safety.applyPatch,
      getCommandConfirmation,
    );
    if (review != null) {
      return review;
    } else {
      // The user has approved the command, so we will run it outside of the
      // sandbox.
      const summary = await execCommand(args, applyPatch, false, abortSignal);
      return convertSummaryToResult(summary);
    }
  } else {
    return convertSummaryToResult(summary);
  }
}

function convertSummaryToResult(
  summary: ExecCommandSummary,
): HandleExecCommandResult {
  const { stdout, stderr, exitCode, durationMs } = summary;
  return {
    outputText: stdout || stderr,
    metadata: {
      exit_code: exitCode,
      duration_seconds: Math.round(durationMs / 100) / 10,
    },
  };
}

type ExecCommandSummary = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

async function execCommand(
  execInput: ExecInput,
  applyPatchCommand: ApplyPatchCommand | undefined,
  runInSandbox: boolean,
  abortSignal?: AbortSignal,
): Promise<ExecCommandSummary> {
  let { workdir } = execInput;
  if (workdir) {
    try {
      await access(workdir);
    } catch (e) {
      log(`EXEC workdir=${workdir} not found, use process.cwd() instead`);
      workdir = process.cwd();
    }
  }
  if (isLoggingEnabled()) {
    if (applyPatchCommand != null) {
      log("EXEC running apply_patch command");
    } else {
      const { cmd, timeoutInMillis } = execInput;
      // Seconds are a bit easier to read in log messages and most timeouts
      // are specified as multiples of 1000, anyway.
      const timeout =
        timeoutInMillis != null
          ? Math.round(timeoutInMillis / 1000).toString()
          : "undefined";
      log(
        `EXEC running \`${formatCommandForDisplay(
          cmd,
        )}\` in workdir=${workdir} with timeout=${timeout}s`,
      );
    }
  }

  // Note execApplyPatch() and exec() are coded defensively and should not
  // throw. Any internal errors should be mapped to a non-zero value for the
  // exitCode field.
  const start = Date.now();
  const execResult =
    applyPatchCommand != null
      ? execApplyPatch(applyPatchCommand.patch)
      : await exec(execInput, await getSandbox(runInSandbox), abortSignal);
  const duration = Date.now() - start;
  const { stdout, stderr, exitCode } = execResult;

  if (isLoggingEnabled()) {
    log(
      `EXEC exit=${exitCode} time=${duration}ms:\n\tSTDOUT: ${stdout}\n\tSTDERR: ${stderr}`,
    );
  }

  return {
    stdout,
    stderr,
    exitCode,
    durationMs: duration,
  };
}

const isInLinux = async (): Promise<boolean> => {
  try {
    await access("/proc/1/cgroup");
    return true;
  } catch {
    return false;
  }
};

async function getSandbox(runInSandbox: boolean): Promise<SandboxType> {
  if (runInSandbox) {
    if (process.platform === "darwin") {
      return SandboxType.MACOS_SEATBELT;
    } else if (await isInLinux()) {
      return SandboxType.NONE;
    } else if (process.platform === "win32") {
      // On Windows, we don't have a sandbox implementation yet, so we fall back to NONE
      // instead of throwing an error, which would crash the application
      log(
        "WARNING: Sandbox was requested but is not available on Windows. Continuing without sandbox.",
      );
      return SandboxType.NONE;
    }
    // For other platforms, still throw an error as before
    throw new Error("Sandbox was mandated, but no sandbox is available!");
  } else {
    return SandboxType.NONE;
  }
}

/**
 * If return value is non-null, then the command was rejected by the user.
 */
async function askUserPermission(
  args: ExecInput,
  applyPatchCommand: ApplyPatchCommand | undefined,
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>,
): Promise<HandleExecCommandResult | null> {
  const { review: decision, customDenyMessage } = await getCommandConfirmation(
    args.cmd,
    applyPatchCommand,
  );

  if (decision === ReviewDecision.ALWAYS) {
    // Persist this command so we won't ask again during this session.
    const key = deriveCommandKey(args.cmd);
    alwaysApprovedCommands.add(key);
  }

  // Any decision other than an affirmative (YES / ALWAYS) aborts execution.
  if (decision !== ReviewDecision.YES && decision !== ReviewDecision.ALWAYS) {
    const note =
      decision === ReviewDecision.NO_CONTINUE
        ? customDenyMessage?.trim() || "No, don't do that — keep going though."
        : "No, don't do that — stop for now.";
    return {
      outputText: "aborted",
      metadata: {},
      additionalItems: [
        {
          role: "user",
          content: [{ type: "text", text: note }],
        },
      ],
    };
  } else {
    return null;
  }
}
