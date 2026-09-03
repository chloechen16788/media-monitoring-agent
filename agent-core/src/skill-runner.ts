import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { RegistrySkill, RunContext, SkillRunnerConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/** Snapshot filename -> mtimeMs for a directory (flat). Missing dir => empty. */
function snapshotDir(dir: string): Map<string, number> {
  const snap = new Map<string, number>();
  if (!existsSync(dir)) return snap;
  for (const name of readdirSync(dir)) {
    try {
      const st = statSync(path.join(dir, name));
      if (st.isFile()) snap.set(name, st.mtimeMs);
    } catch {
      /* ignore */
    }
  }
  return snap;
}

/** Files that are new or newer than the before-snapshot (i.e. produced by the run). */
function diffProduced(before: Map<string, number>, after: Map<string, number>): Array<string> {
  const out: Array<string> = [];
  for (const [name, mtime] of after) {
    const prev = before.get(name);
    if (prev === undefined || mtime > prev) out.push(name);
  }
  return out;
}

/**
 * Every live skill child, tracked so the worker can tear them down when it is
 * itself terminated (e.g. gateway kills the worker on client disconnect).
 * Skills spawn `detached` (own process group), so without this they would be
 * reparented to init and keep running as orphans, burning API quota with no UI.
 */
const activeChildren = new Set<ChildProcess>();

/** Kill the process group of every running skill. Called on worker shutdown. */
export function killAllActiveSkills(signal: NodeJS.Signals = "SIGKILL"): void {
  for (const child of activeChildren) {
    if (child.pid == null) continue;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }
  activeChildren.clear();
}

/** True when `candidate` is the same as, or nested inside, `parent`. */
function isInside(parent: string, candidate: string): boolean {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve the on-disk script path for a registry skill and assert it lives
 * inside the skills directory. This is the second security boundary: even if
 * registry.json were tampered with, an entry pointing outside skills/ is
 * rejected before any process is spawned.
 */
export function resolveEntry(skill: RegistrySkill, cfg: SkillRunnerConfig): string {
  const entry = path.resolve(cfg.projectRoot, skill.entry);
  if (!isInside(cfg.skillsDir, entry)) {
    throw new Error(`skill '${skill.id}' entry escapes skills dir: ${skill.entry}`);
  }
  return entry;
}

/**
 * Build argv for a skill from its arg_style. The model only ever supplies a
 * structured `args` object; the command line is assembled here, never by the
 * model. Returns argv WITHOUT the interpreter (python bin is prepended later).
 */
export function buildArgv(
  skill: RegistrySkill,
  entry: string,
  args: Record<string, unknown>,
): Array<string> {
  const style = skill.arg_style ?? "json";
  switch (style) {
    case "text": {
      const key = skill.arg_key ?? "text";
      const value = args[key];
      if (typeof value !== "string") {
        throw new Error(`skill '${skill.id}' expects string property '${key}'`);
      }
      return [entry, value];
    }
    case "argparse": {
      const argv: Array<string> = [entry];
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;
        argv.push(`--${key}`);
        argv.push(typeof value === "string" ? value : JSON.stringify(value));
      }
      return argv;
    }
    case "json":
    default:
      return [entry, JSON.stringify(args ?? {})];
  }
}

/** Keep only the env keys a skill declared it needs, plus a minimal base. */
function pickEnv(
  skill: RegistrySkill,
  cfg: SkillRunnerConfig,
): Record<string, string> {
  const env: Record<string, string> = {};
  const base = cfg.baseEnv ?? process.env;
  // Minimal always-on keys so python can locate itself and write utf-8.
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "PYTHONIOENCODING", "PYTHONPATH"]) {
    const v = base[key];
    if (typeof v === "string") env[key] = v;
  }
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || "utf-8";
  // Skill-declared env whitelist.
  for (const key of skill.env ?? []) {
    const v = base[key];
    if (typeof v === "string") env[key] = v;
  }
  return env;
}

export interface SkillRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Basenames of files created/updated in the session workspace during this run. */
  producedFiles: Array<string>;
}

/**
 * The single spawn point of the runtime. Executes a whitelisted python skill
 * with a runtime-assembled argv. No shell, no model-controlled path/cwd/timeout.
 */
export function runSkill(
  skill: RegistrySkill,
  args: Record<string, unknown>,
  ctx: RunContext,
  cfg: SkillRunnerConfig,
  onStderrLine?: (line: string) => void,
): Promise<SkillRunResult> {
  const entry = resolveEntry(skill, cfg);
  const argv = buildArgv(skill, entry, args);
  const timeoutMs = skill.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  // Skills run with cwd=sessionDir and write outputs to ./workspace. Snapshot it
  // before the run so we can report exactly which files this run produced.
  const workspaceDir = path.join(ctx.sessionDir, "workspace");
  const beforeSnap = snapshotDir(workspaceDir);

  return new Promise<SkillRunResult>((resolve) => {
    const child = spawn(cfg.pythonBin, argv, {
      cwd: ctx.sessionDir, // fixed; model cannot influence
      env: pickEnv(skill, cfg),
      // No shell: argv is passed straight to execve, so metacharacters in
      // args are inert (no command injection surface).
      shell: false,
      detached: true, // own process group so we can kill grandchildren on timeout
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(child);

    let stdout = "";
    let stderr = "";
    let stderrLineBuf = "";
    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<SkillRunResult, "producedFiles">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      if (onAbort) ctx.signal?.removeEventListener("abort", onAbort);
      const producedFiles = diffProduced(beforeSnap, snapshotDir(workspaceDir));
      resolve({ ...result, producedFiles });
    };

    const killGroup = () => {
      if (child.pid == null) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);

    const onAbort = ctx.signal
      ? () => {
          killGroup();
          finish({ stdout, stderr, exitCode: null, timedOut });
        }
      : undefined;
    if (onAbort) ctx.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      const chunk = d.toString("utf8");
      stderr += chunk;
      // Forward complete stderr lines as live progress; skills print progress to
      // stderr (stdout is reserved for the single final JSON result).
      if (onStderrLine) {
        stderrLineBuf += chunk;
        const lines = stderrLineBuf.split("\n");
        stderrLineBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) onStderrLine(trimmed);
        }
      }
    });
    child.on("error", (err) => {
      finish({ stdout, stderr: stderr + `\n[spawn error] ${err.message}`, exitCode: null, timedOut });
    });
    child.on("close", (code) => {
      finish({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}
