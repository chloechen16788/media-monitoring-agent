import OpenAI from "openai";

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseURL: string;
}

function baseURLForProvider(provider: string): string {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    case "ollama":
      return process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai/";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "xai":
      return "https://api.x.ai/v1";
    default:
      return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  }
}

function apiKeyForProvider(provider: string): string {
  switch (provider) {
    case "gemini":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.OPENAI_API_KEY || "";
    case "openrouter":
      return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
    case "xai":
      return process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || "";
    case "ollama":
      return "ollama";
    default:
      return process.env.OPENAI_API_KEY || "";
  }
}

/** Resolve provider config from env + worker-injected model/provider. */
export function resolveProvider(model: string, provider?: string): ProviderConfig {
  const p = provider && provider.trim() ? provider.trim() : "openai";
  return {
    provider: p,
    model,
    apiKey: apiKeyForProvider(p),
    baseURL: process.env.OPENAI_BASE_URL || baseURLForProvider(p),
  };
}

export function createClient(cfg: ProviderConfig): OpenAI {
  return new OpenAI({ apiKey: cfg.apiKey || "", baseURL: cfg.baseURL });
}
