import type { ChatMessage, ChatResult, LLMProvider, ChatOptions } from "../types";

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private fallbackModel?: string;
  private siteUrl?: string;
  private appName?: string;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL;

    if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");
    if (!model) throw new Error("Missing OPENROUTER_MODEL");

    this.apiKey = apiKey;
    this.model = model;
    this.fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL;
    this.siteUrl = process.env.OPENROUTER_SITE_URL;
    this.appName = process.env.OPENROUTER_APP_NAME;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const primary = options?.primaryModel ?? this.model;
    const fallback = options?.fallbackModel ?? this.fallbackModel;

    const modelsToTry = [primary, ...(fallback ? [fallback] : [])];
    const maxRetriesPerModel = 2;

    let lastErr: Error | null = null;

    for (const model of modelsToTry) {
      for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(this.siteUrl ? { "HTTP-Referer": this.siteUrl } : {}),
            ...(this.appName ? { "X-Title": this.appName } : {}),
          },
          body: JSON.stringify({
            model,            // ✅ IMPORTANT: use the loop variable
            messages,
            temperature: 0.2,
          }),
        });

        // 429: retry with backoff, then try fallback model
        if (res.status === 429) {
          if (attempt < maxRetriesPerModel) {
            const waitMs = 800 * Math.pow(2, attempt); // 800, 1600...
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          const body = await res.text();
          lastErr = new Error(`OpenRouter 429 on model=${model}: ${body}`);
          break; // try next model
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`OpenRouter error ${res.status} on model=${model}: ${body}`);
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        return { text, raw: data, usedModel: model };
      }
    }

    throw lastErr ?? new Error("OpenRouter request failed.");
  }
}
