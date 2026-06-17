import type {
  ExecInput,
  ExecOutputMetadata,
} from "./agent/sandbox/interface.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.mjs";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { log } from "node:console";
import { formatCommandForDisplay } from "src/format-command.js";

// The console utility import is intentionally explicit to avoid bundlers from
// including the entire `console` module when only the `log` function is
// required.

export function parseToolCallOutput(toolCallOutput: string): {
  output: string;
  metadata: ExecOutputMetadata;
} {
  try {
    const { output, metadata } = JSON.parse(toolCallOutput);
    return {
      output,
      metadata,
    };
  } catch (err) {
    return {
      output: `Failed to parse JSON result`,
      metadata: {
        exit_code: 1,
        duration_seconds: 0,
      },
    };
  }
}

export type CommandReviewDetails = {
  cmd: Array<string>;
  cmdReadableText: string;
};

/**
 * Tries to parse a tool call and, if successful, returns an object that has
 * both:
 * - an array of strings to use with `ExecInput` and `canAutoApprove()`
 * - a human-readable string to display to the user
 */
export function parseToolCallChatCompletion(
  toolCall: ChatCompletionMessageToolCall,
): CommandReviewDetails | undefined {
  if (toolCall.type !== "function") {
    return undefined;
  }
  const toolCallArgs = parseToolCallArguments(toolCall.function.arguments);
  if (toolCallArgs == null) {
    return undefined;
  }
  const { cmd } = toolCallArgs;
  const cmdReadableText = formatCommandForDisplay(cmd);
  return {
    cmd,
    cmdReadableText,
  };
}

export function parseToolCall(
  toolCall: ResponseFunctionToolCall,
): CommandReviewDetails | undefined {
  const toolCallArgs = parseToolCallArguments(toolCall.arguments);
  if (toolCallArgs == null) {
    return undefined;
  }

  const { cmd } = toolCallArgs;
  const cmdReadableText = formatCommandForDisplay(cmd);

  return {
    cmd,
    cmdReadableText,
  };
}

/**
 * If toolCallArguments is a string of JSON that can be parsed into an object
 * with a "cmd" or "command" property that is an `Array<string>`, then returns
 * that array. Otherwise, returns undefined.
 */
/**
 * 从可能含多个拼接 JSON 对象的字符串中提取第一个完整 JSON 对象。
 * 模型有时会把多个 tool call 的 arguments 拼在一起，导致 JSON.parse 失败；
 * 此函数截取第一个合法对象，保证至少第一条命令能执行。
 */
function extractFirstJsonObject(raw: string): string | null {
  let depth = 0;
  let started = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") {
      depth++;
      started = true;
    } else if (ch === "}") {
      depth--;
      if (started && depth === 0) {
        return raw.slice(0, i + 1);
      }
    }
  }
  return null;
}

export function parseToolCallArguments(
  toolCallArguments: string,
): ExecInput | undefined {
  let json: unknown;
  try {
    json = JSON.parse(toolCallArguments);
  } catch (err) {
    // 检测"多个 JSON 对象拼接"的情况（模型违反了"每次只发一条 tool call"规则）：
    // 提取第一个合法 JSON 对象并执行，其余部分丢弃。
    const firstObj = extractFirstJsonObject(toolCallArguments);
    if (firstObj && firstObj !== toolCallArguments.trim()) {
      try {
        json = JSON.parse(firstObj);
        log(
          `[WARN] toolCall.arguments contained multiple JSON objects; executing only the first one. Full args: ${toolCallArguments}`,
        );
      } catch {
        log(`Failed to parse toolCall.arguments: ${toolCallArguments}`);
        return undefined;
      }
    } else {
      log(`Failed to parse toolCall.arguments: ${toolCallArguments}`);
      return undefined;
    }
  }

  if (typeof json !== "object" || json == null) {
    return undefined;
  }

  const { cmd, command } = json as Record<string, unknown>;
  const commandArray = toStringArray(cmd) ?? toStringArray(command);
  if (commandArray == null) {
    return undefined;
  }

  // @ts-expect-error timeout and workdir may not exist on json.
  const { timeout, workdir } = json;
  return {
    cmd: commandArray,
    workdir: typeof workdir === "string" ? workdir : undefined,
    timeoutInMillis: typeof timeout === "number" ? timeout : undefined,
  };
}

function toStringArray(obj: unknown): Array<string> | undefined {
  if (Array.isArray(obj) && obj.every((item) => typeof item === "string")) {
    const arrayOfStrings: Array<string> = obj;
    return arrayOfStrings;
  } else {
    return undefined;
  }
}

/**
 * Normalize tool-call arguments to valid JSON matching the shell tool schema.
 * Maps legacy `cmd` -> `command` and re-serializes so providers receive
 * strictly valid JSON strings (avoids 400 invalid function arguments).
 */
export function normalizeToolCallArgumentsString(
  raw: string | undefined,
): string {
  const parsed = parseToolCallArguments(raw ?? "");
  if (!parsed?.cmd?.length) {
    return JSON.stringify({ command: [] });
  }
  const payload: Record<string, unknown> = { command: parsed.cmd };
  if (parsed.workdir) payload.workdir = parsed.workdir;
  if (parsed.timeoutInMillis != null) payload.timeout = parsed.timeoutInMillis;
  return JSON.stringify(payload);
}

export function sanitizeAssistantMessage(
  message: ChatCompletionMessageParam,
): ChatCompletionMessageParam {
  if (message.role !== "assistant" || !("tool_calls" in message) || !message.tool_calls) {
    return message;
  }
  return {
    ...message,
    tool_calls: message.tool_calls.map((toolCall) => {
      if (toolCall.type !== "function") {
        return toolCall;
      }
      return {
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: normalizeToolCallArgumentsString(toolCall.function?.arguments),
        },
      };
    }),
  };
}

export function sanitizeMessagesForApi(
  messages: Array<ChatCompletionMessageParam>,
): Array<ChatCompletionMessageParam> {
  return messages.map((message) => sanitizeAssistantMessage(message));
}
