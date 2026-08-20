import type OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import type { AgentEvent, RunContext } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import { sanitizeMessagesForApi } from "./sanitize.js";

const MAX_RETRIES = 5;
const RATE_LIMIT_RETRY_WAIT_MS = Number(process.env.OPENAI_RATE_LIMIT_RETRY_WAIT_MS || "2500");

const AGENT_PREFIX = `You are an intelligent internal corporate assistant deployed within an enterprise environment. You are precise, safe, and helpful. You accomplish tasks EXCLUSIVELY by calling the tools provided to you — you have no shell or filesystem access beyond those tools. Keep going until the user's request is fully resolved before yielding your turn. If you lack information, gather it with your tools rather than guessing.`;

export interface AgentCoreParams {
  client: OpenAI;
  model: string;
  instructions: string;
  registry: ToolRegistry;
  context: RunContext;
  emit: (event: AgentEvent) => void;
}

function isReasoningModel(model: string): boolean {
  return model.startsWith("o") || model.startsWith("openai/o");
}

/**
 * Headless agent loop. Streams a chat.completions turn, aggregates tool calls,
 * dispatches them through the ToolRegistry (no shell), and feeds results back
 * until the model produces a final text turn. Retries on transient errors and
 * supports cooperative cancellation.
 */
export class AgentCore {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly instructions: string;
  private readonly registry: ToolRegistry;
  private readonly context: RunContext;
  private readonly emit: (event: AgentEvent) => void;

  private generation = 0;
  private canceled = false;
  private terminated = false;
  private currentStream: Stream<ChatCompletionChunk> | null = null;
  private readonly pendingAborts = new Set<string>();

  constructor(params: AgentCoreParams) {
    this.client = params.client;
    this.model = params.model;
    this.instructions = params.instructions;
    this.registry = params.registry;
    this.context = params.context;
    this.emit = params.emit;
  }

  cancel(): void {
    if (this.terminated) return;
    this.canceled = true;
    try {
      this.currentStream?.controller?.abort?.();
    } catch {
      /* ignore */
    }
    this.emit({ type: "loading", data: false });
  }

  terminate(): void {
    this.terminated = true;
    this.cancel();
  }

  private stage(item: ChatCompletionMessageParam, staged: Array<ChatCompletionMessageParam>): void {
    this.emit({ type: "item", data: item });
    staged.push(item);
  }

  /** Dispatch a single tool call through the registry. Returns the tool message. */
  private async dispatchToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): Promise<ChatCompletionMessageParam> {
    const callId = toolCall.id;
    const name = toolCall.function?.name ?? "";
    const rawArgs = toolCall.function?.arguments ?? "{}";

    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawArgs || "{}");
      args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify({ ok: false, error: `工具参数不是合法 JSON: ${rawArgs.slice(0, 200)}` }),
      };
    }

    const tool = this.registry.get(name);
    if (!tool) {
      return {
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify({
          ok: false,
          error: `未知工具 '${name}'。可用工具: ${this.registry.names().join(", ")}`,
        }),
      };
    }

    try {
      // Per-call context carries a progress emitter so long-running skills can
      // stream ephemeral status back to the UI (forwarded as SSE, not persisted).
      const ctx: RunContext = {
        ...this.context,
        emitProgress: (update) => this.emit({ type: "progress", data: update }),
      };
      const output = await tool.run(args, ctx);
      return { role: "tool", tool_call_id: callId, content: output };
    } catch (err) {
      return {
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify({ ok: false, error: `工具执行异常: ${(err as Error).message}` }),
      };
    }
  }

  async run(
    input: Array<ChatCompletionMessageParam>,
    prevItems: Array<ChatCompletionMessageParam> = [],
  ): Promise<void> {
    if (this.terminated) throw new Error("AgentCore has been terminated");
    const thisGeneration = ++this.generation;
    this.canceled = false;

    // Satisfy any tool calls left dangling by a previous cancelled run.
    const abortOutputs: Array<ChatCompletionMessageParam> = [];
    for (const id of this.pendingAborts) {
      abortOutputs.push({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify({ ok: false, error: "aborted" }),
      });
    }
    this.pendingAborts.clear();

    let turnInput = [...abortOutputs, ...input];
    const staged: Array<ChatCompletionMessageParam> = [];
    this.emit({ type: "loading", data: true });

    const tools = this.registry.toOpenAITools();

    while (turnInput.length > 0) {
      if (this.canceled) {
        this.emit({ type: "loading", data: false });
        return;
      }
      for (const item of turnInput) this.stage(item, staged);

      const messages: Array<ChatCompletionMessageParam> = [
        { role: "system", content: `${AGENT_PREFIX}\n\n${this.instructions}` },
        ...sanitizeMessagesForApi([...prevItems, ...staged]),
      ];

      let stream: Stream<ChatCompletionChunk> | undefined;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          stream = await this.client.chat.completions.create({
            model: this.model,
            stream: true,
            messages,
            ...(isReasoningModel(this.model) ? { reasoning_effort: "high" as const } : {}),
            tools,
          });
          break;
        } catch (error) {
          const handled = await this.handleRequestError(error, attempt);
          if (handled === "retry") continue;
          if (handled === "abort") {
            this.emit({ type: "loading", data: false });
            return;
          }
          throw error;
        }
      }

      turnInput = [];
      if (this.canceled || !stream) {
        try {
          stream?.controller?.abort?.();
        } catch {
          /* ignore */
        }
        this.emit({ type: "loading", data: false });
        return;
      }

      this.currentStream = stream;
      try {
        let message: (ChatCompletionMessageParam & { tool_calls?: ChatCompletionMessageToolCall[] }) | undefined;
        for await (const chunk of stream) {
          const delta = chunk?.choices?.[0]?.delta;
          const content = delta?.content;
          const toolCall = delta?.tool_calls?.[0];

          if (!message) {
            message = delta as unknown as typeof message;
          } else {
            if (content) {
              message.content = (message.content ?? "") + content;
            }
            if (!message.tool_calls && toolCall) {
              message.tool_calls = [toolCall as unknown as ChatCompletionMessageToolCall];
            } else if (toolCall) {
              const target = message.tool_calls![0]!;
              if (toolCall.function?.name) target.function.name += toolCall.function.name;
              if (toolCall.function?.arguments) target.function.arguments += toolCall.function.arguments;
            }
          }
          if (toolCall?.id) this.pendingAborts.add(toolCall.id);

          const finishReason = chunk?.choices?.[0]?.finish_reason;
          if (finishReason && thisGeneration === this.generation && !this.canceled) {
            if (message?.tool_calls?.[0]) {
              this.stage(message as ChatCompletionMessageParam, staged);
              const toolMsg = await this.dispatchToolCall(message.tool_calls[0]);
              const resolvedId = (toolMsg as { tool_call_id?: string }).tool_call_id;
              if (resolvedId) this.pendingAborts.delete(resolvedId);
              turnInput.push(toolMsg);
            } else if (message && Object.keys(message).length > 0) {
              this.stage(message as ChatCompletionMessageParam, staged);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          this.emit({ type: "loading", data: false });
          return;
        }
        throw err;
      } finally {
        this.currentStream = null;
      }
    }

    this.pendingAborts.clear();
    this.emit({ type: "loading", data: false });
  }

  /** Classify a request error: retry / abort (surfaced to user) / rethrow. */
  private async handleRequestError(
    error: unknown,
    attempt: number,
  ): Promise<"retry" | "abort" | "throw"> {
    const errCtx = error as {
      status?: number;
      httpStatus?: number;
      statusCode?: number;
      code?: string;
      type?: string;
      message?: string;
      name?: string;
    };
    const status = errCtx?.status ?? errCtx?.httpStatus ?? errCtx?.statusCode;
    const isTimeout = errCtx?.name === "APIConnectionTimeoutError";
    const isServerError = typeof status === "number" && status >= 500;

    if ((isTimeout || isServerError) && attempt < MAX_RETRIES) return "retry";

    const isRateLimit =
      status === 429 ||
      errCtx?.code === "rate_limit_exceeded" ||
      errCtx?.type === "rate_limit_exceeded" ||
      /rate limit/i.test(errCtx?.message ?? "");
    if (isRateLimit) {
      if (attempt < MAX_RETRIES) {
        let delayMs = RATE_LIMIT_RETRY_WAIT_MS * 2 ** (attempt - 1);
        const m = /(?:retry|try) again in ([\d.]+)s/i.exec(errCtx?.message ?? "");
        if (m && m[1]) {
          const suggested = parseFloat(m[1]) * 1000;
          if (!Number.isNaN(suggested)) delayMs = suggested;
        }
        await new Promise((r) => setTimeout(r, delayMs));
        return "retry";
      }
      this.emit({
        type: "item",
        data: { role: "assistant", content: `⚠️ 触发限流，已重试上限。请稍后再试。` },
      });
      return "abort";
    }

    const isClientError =
      (typeof status === "number" && status >= 400 && status < 500) ||
      errCtx?.type === "invalid_request_error";
    if (isClientError) {
      this.emit({
        type: "item",
        data: {
          role: "assistant",
          content: `⚠️ 请求被拒绝（status ${status ?? "?"} / ${errCtx?.type ?? errCtx?.code ?? "unknown"}）：${errCtx?.message ?? ""}`,
        },
      });
      return "abort";
    }
    return "throw";
  }
}
