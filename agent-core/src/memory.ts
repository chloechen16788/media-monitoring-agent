import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import type { Tool } from "./types.js";

export interface MemoryPaths {
  userMemoryFile: string;
  projectMemoryFile?: string;
  sessionMemoryFile?: string;
}

/**
 * Resolve the three-layer memory file paths using the same on-disk convention
 * as gateway (data/users/{uid}/[projects/{pid}/[sessions/{sid}]]).
 */
export function buildMemoryPaths(
  dataRoot: string,
  userId: string,
  projectId?: string,
  sessionId?: string,
): MemoryPaths {
  const safe = (v: string, fallback: string) =>
    String(v || "").replace(/[^a-zA-Z0-9_-]/g, "") || fallback;
  const u = safe(userId, "user");
  const paths: MemoryPaths = {
    userMemoryFile: path.join(dataRoot, u, "user_memory.md"),
  };
  if (projectId) {
    const p = safe(projectId, "project");
    paths.projectMemoryFile = path.join(dataRoot, u, "projects", p, "project_memory.md");
    if (sessionId) {
      const s = safe(sessionId, "session");
      paths.sessionMemoryFile = path.join(
        dataRoot,
        u,
        "projects",
        p,
        "sessions",
        s,
        "session_memory.md",
      );
    }
  }
  return paths;
}

function readTail(file: string | undefined, limitBytes: number): string {
  if (!file || !existsSync(file)) return "";
  const raw = readFileSync(file, "utf8");
  if (raw.length <= limitBytes) return raw.trim();
  // Keep the tail — most recent notes matter most.
  return raw.slice(raw.length - limitBytes).trim();
}

/**
 * Build the MEMORY block injected at the front of the system prompt each turn.
 * Empty layers are omitted so the model is not fed blank sections.
 */
export function readMemoryBlock(paths: MemoryPaths, limitBytes = 2048): string {
  const sections: Array<string> = [];
  const user = readTail(paths.userMemoryFile, limitBytes);
  const project = readTail(paths.projectMemoryFile, limitBytes);
  const session = readTail(paths.sessionMemoryFile, limitBytes);
  if (user) sections.push(`## USER MEMORY (稳定偏好/硬约束)\n${user}`);
  if (project) sections.push(`## PROJECT MEMORY (项目结论/复用假设)\n${project}`);
  if (session) sections.push(`## SESSION MEMORY (本次会话临时记录)\n${session}`);
  if (sections.length === 0) return "";
  return `=== MEMORY ===\n${sections.join("\n\n")}\n=== END MEMORY ===`;
}

function appendMemory(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const stamp = new Date().toISOString();
  const line = `\n- (${stamp}) ${content.trim()}`;
  if (existsSync(file)) {
    appendFileSync(file, line, "utf8");
  } else {
    writeFileSync(file, `# Memory${line}`, "utf8");
  }
}

/**
 * Built-in tool: lets the model persist a durable note. Only session/project
 * scopes are writable; user-layer promotion stays a human/gateway decision to
 * avoid long-term memory pollution (per V2 运行规则).
 */
export function memoryWriteTool(paths: MemoryPaths): Tool {
  return {
    name: "memory_write",
    description:
      "记录一条持久笔记到记忆层。scope=session 记本次会话细节；scope=project 记可复用的项目级结论。仅在信息稳定、值得后续复用时调用。",
    parameters: {
      type: "object",
      required: ["scope", "content"],
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["session", "project"] },
        content: { type: "string", description: "要记录的内容（简洁要点）" },
      },
    },
    run: async (args) => {
      const scope = String(args.scope || "");
      const content = String(args.content || "").trim();
      if (!content) return JSON.stringify({ ok: false, error: "content 不能为空" });
      let file: string | undefined;
      if (scope === "session") file = paths.sessionMemoryFile;
      else if (scope === "project") file = paths.projectMemoryFile;
      else return JSON.stringify({ ok: false, error: `不支持的 scope: ${scope}` });
      if (!file) {
        return JSON.stringify({
          ok: false,
          error: `当前上下文缺少 ${scope} 层路径（未提供 projectId/sessionId）`,
        });
      }
      appendMemory(file, content);
      return JSON.stringify({ ok: true, scope, bytes: content.length });
    },
  };
}
