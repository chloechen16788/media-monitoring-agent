import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Remove structurally invalid message sequences before sending to the API,
 * WITHOUT rewriting tool-call arguments (unlike the legacy shell-oriented
 * sanitizer). Two failure modes are repaired:
 *   1. tool result messages whose tool_call was never declared (orphans)
 *   2. assistant tool_calls that never received a result (dangling)
 * Dangling calls trigger OpenAI 400 "No tool output found for function call".
 */
export function sanitizeMessagesForApi(
  messages: Array<ChatCompletionMessageParam>,
): Array<ChatCompletionMessageParam> {
  const declaredToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls) {
      for (const tc of msg.tool_calls) if (tc.id) declaredToolCallIds.add(tc.id);
    }
  }

  const resolvedToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "tool" && "tool_call_id" in msg && msg.tool_call_id) {
      resolvedToolCallIds.add(msg.tool_call_id);
    }
  }

  const output: Array<ChatCompletionMessageParam> = [];
  for (const msg of messages) {
    if (msg.role === "tool") {
      const tcId = (msg as { tool_call_id?: string }).tool_call_id ?? "";
      if (!declaredToolCallIds.has(tcId)) continue; // drop orphan tool result
      output.push(msg);
      continue;
    }

    if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls) {
      const fulfilled = msg.tool_calls.filter((tc) => tc.id && resolvedToolCallIds.has(tc.id));
      if (fulfilled.length === msg.tool_calls.length) {
        output.push(msg);
      } else if (fulfilled.length === 0) {
        const content = (msg as { content?: string | null }).content;
        if (!content) continue; // drop empty dangling-call message
        const clone: Record<string, unknown> = { ...(msg as unknown as Record<string, unknown>) };
        delete clone.tool_calls;
        output.push(clone as unknown as ChatCompletionMessageParam);
      } else {
        output.push({ ...msg, tool_calls: fulfilled } as ChatCompletionMessageParam);
      }
      continue;
    }

    output.push(msg);
  }
  return output;
}
