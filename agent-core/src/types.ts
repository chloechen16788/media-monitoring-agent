import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type ArgStyle = "json" | "text" | "argparse";

export type AgentMode = "master" | "sub";

export interface RegistrySkill {
  id: string;
  type: "script" | "doc";
  role?: AgentMode;
  group?: string;
  entry: string;
  enabled?: boolean;
  brief?: string;
  env?: Array<string>;
  /** How SkillRunner builds argv. Defaults to "json" (argv[1] = JSON.stringify(args)). */
  arg_style?: ArgStyle;
  /** For arg_style="text": which property carries the single positional string. */
  arg_key?: string;
  /** Optional per-skill execution timeout in ms. */
  timeout_ms?: number;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

export interface Registry {
  version: string;
  description?: string;
  skills: Array<RegistrySkill>;
}

export interface ProgressUpdate {
  /** Skill id that produced the update (filled in by the loop). */
  skill?: string;
  /** Human-readable progress line shown to the user. */
  message: string;
  /** Milliseconds since the skill started (filled in by the tool wrapper). */
  elapsed_ms?: number;
}

export interface RunContext {
  sessionDir: string;
  signal?: AbortSignal;
  /** Emit an ephemeral progress update while a long tool runs (not persisted). */
  emitProgress?: (update: ProgressUpdate) => void;
}

/** A model-visible, callable capability. */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: RunContext) => Promise<string>;
}

export type AgentEvent =
  | { type: "item"; data: ChatCompletionMessageParam }
  | { type: "loading"; data: boolean }
  | { type: "progress"; data: ProgressUpdate }
  | { type: "done" }
  | { type: "error"; error: string };

export interface SkillRunnerConfig {
  pythonBin: string;
  /** Absolute path to the skills/ directory. */
  skillsDir: string;
  /** Absolute path to the project root (parent of skills/). */
  projectRoot: string;
  /** Extra env always forwarded to skill processes (in addition to skill.env whitelist). */
  baseEnv?: Record<string, string | undefined>;
}
