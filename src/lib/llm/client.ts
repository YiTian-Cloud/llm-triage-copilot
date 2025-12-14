import type { LLMProvider } from "./types";
import { OpenRouterProvider } from "./providers/openrouter";

export function getLLMProvider(): LLMProvider {
  const p = (process.env.LLM_PROVIDER || "openrouter").toLowerCase();

  switch (p) {
    case "openrouter":
      return new OpenRouterProvider();
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${p}`);
  }
}
