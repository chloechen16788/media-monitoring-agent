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
export function parseToolCallArguments(
  toolCallArguments: string,
): ExecInput | undefined {
  let json: unknown;
  try {
    json = JSON.parse(toolCallArguments);
  } catch (err) {
    log(`Failed to parse toolCall.arguments: ${toolCallArguments}`);
    return undefined;
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
