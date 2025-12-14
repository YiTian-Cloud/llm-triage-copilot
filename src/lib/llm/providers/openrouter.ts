import type { ChatMessage, ChatResult, LLMProvider, ChatOptions } from "../types";

type AttemptEvent = {
  apiKeyIndex?: number; // NEW: which key in the pool was used
  model: string;
  attempt: number;
  status: number;
  latencyMs: number;
  note?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class OpenRouterProvider implements LLMProvider {
  private apiKeys: string[];         // NEW: pool of keys
  private model: string;
  private fallbackModel?: string;
  private siteUrl?: string;
  private appName?: string;

  constructor() {
    // Prefer a pool, fallback to single key for backwards compatibility
    const keys =
      process.env.OPENROUTER_API_KEYS ??
      process.env.OPENROUTER_API_KEY ??
      "";

    const model = process.env.OPENROUTER_MODEL;

    if (!keys) throw new Error("Missing OPENROUTER_API_KEYS or OPENROUTER_API_KEY");
    if (!model) throw new Error("Missing OPENROUTER_MODEL");

    this.apiKeys = keys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (this.apiKeys.length === 0) {
      throw new Error("OPENROUTER_API_KEYS/OPENROUTER_API_KEY is empty");
    }

    this.model = model;
    this.fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL;
    this.siteUrl = process.env.OPENROUTER_SITE_URL;
    this.appName = process.env.OPENROUTER_APP_NAME;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const primary = options?.primaryModel ?? this.model;
    const fallback = options?.fallbackModel ?? this.fallbackModel;

    const modelsToTry = [primary, ...(fallback ? [fallback] : [])];

    const maxRetriesPerModel = 2; // additional retries after first attempt
    const requestTimeoutMs = 25000;

    const attempts: AttemptEvent[] = [];
    let lastErr: Error | null = null;

    // NEW: outer loop over API keys (failover if one hits daily quota / gateways)
    for (let apiKeyIndex = 0; apiKeyIndex < this.apiKeys.length; apiKeyIndex++) {
      const apiKey = this.apiKeys[apiKeyIndex];

      // keep your existing model + retry behavior unchanged
      for (const model of modelsToTry) {
        for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), requestTimeoutMs);
          const t0 = Date.now();

          try {
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                ...(this.siteUrl ? { "HTTP-Referer": this.siteUrl } : {}),
                ...(this.appName ? { "X-Title": this.appName } : {}),
              },
              body: JSON.stringify({ model, messages, temperature: 0.2 }),
              signal: ctrl.signal,
            });

            const latencyMs = Date.now() - t0;
            attempts.push({ apiKeyIndex, model, attempt, status: res.status, latencyMs });

            // Read body once (handles non-JSON errors cleanly)
            const bodyText = await res.text();

            // Retryable statuses (provider/gateway/rate-limit)
            const retryable = new Set([429, 502, 503, 504]);
            const fallbackable = new Set([404, 429, 502, 503, 504]);

            if (retryable.has(res.status)) {
              // 429/5xx: retry with exponential backoff up to maxRetriesPerModel
              if (attempt < maxRetriesPerModel) {
                const waitMs = 800 * Math.pow(2, attempt); // 800, 1600, ...
                attempts.push({
                  apiKeyIndex,
                  model,
                  attempt,
                  status: res.status,
                  latencyMs: 0,
                  note: `backoff ${waitMs}ms`,
                });
                await sleep(waitMs);
                continue;
              }

              // retries exhausted on this model for this key
              lastErr = new Error(
                `OpenRouter ${res.status} on model=${model} (key[${apiKeyIndex}]): ${
                  bodyText?.slice(0, 400) || "(empty body)"
                }`
              );

              // If 404/429/5xx, break to try fallback model (same key)
              if (fallbackable.has(res.status)) break;

              // Otherwise hard error
              throw lastErr;
            }

            // 404 means model not available -> try fallback model immediately (same key)
            if (res.status === 404) {
              lastErr = new Error(
                `OpenRouter 404 on model=${model} (key[${apiKeyIndex}]): ${
                  bodyText?.slice(0, 400) || "(empty body)"
                }`
              );
              break; // try fallback model
            }

            // Any other non-OK is a hard error (don’t failover keys)
            if (!res.ok) {
              throw new Error(
                `OpenRouter error ${res.status} on model=${model} (key[${apiKeyIndex}]): ${
                  bodyText?.slice(0, 400) || "(empty body)"
                }`
              );
            }

            // Parse JSON success response
            let data: any = null;
            try {
              data = bodyText ? JSON.parse(bodyText) : null;
            } catch {
              throw new Error(
                `OpenRouter returned non-JSON success response on model=${model} (key[${apiKeyIndex}]): ${
                  bodyText?.slice(0, 400) || "(empty body)"
                }`
              );
            }

            const text = data?.choices?.[0]?.message?.content ?? "";

            // Treat empty/whitespace as failure (retry/fallback)
            if (!String(text).trim()) {
              attempts.push({
                model,
                attempt,
                status: 200,
                latencyMs: 0,
                note: "empty_completion",
              });
            
              if (attempt < maxRetriesPerModel) {
                const waitMs = 800 * Math.pow(2, attempt);
                attempts.push({ model, attempt, status: 0, latencyMs: 0, note: `backoff ${waitMs}ms` });
                await sleep(waitMs);
                continue;
              }
            
              lastErr = new Error(`OpenRouter returned empty completion on model=${model}`);
              break; // try fallback model
            }
            
            return {
              text,
              raw: data,
              usedModel: model,
              trace: { attempts, usage: data?.usage },
            };
            
          } catch (e: any) {
            const latencyMs = Date.now() - t0;

            if (e?.name === "AbortError") {
              attempts.push({
                apiKeyIndex,
                model,
                attempt,
                status: 0,
                latencyMs,
                note: `timeout ${requestTimeoutMs}ms`,
              });

              // timeout: retry within same model if possible
              if (attempt < maxRetriesPerModel) {
                const waitMs = 800 * Math.pow(2, attempt);
                attempts.push({
                  apiKeyIndex,
                  model,
                  attempt,
                  status: 0,
                  latencyMs: 0,
                  note: `backoff ${waitMs}ms`,
                });
                await sleep(waitMs);
                continue;
              }

              lastErr = new Error(`OpenRouter timeout on model=${model} (key[${apiKeyIndex}])`);
              break; // try fallback model (same key)
            }

            // Any other fetch error: treat as retryable within same model
            attempts.push({
              apiKeyIndex,
              model,
              attempt,
              status: 0,
              latencyMs,
              note: `fetch_error: ${e?.message ?? "unknown"}`,
            });

            if (attempt < maxRetriesPerModel) {
              const waitMs = 800 * Math.pow(2, attempt);
              attempts.push({
                apiKeyIndex,
                model,
                attempt,
                status: 0,
                latencyMs: 0,
                note: `backoff ${waitMs}ms`,
              });
              await sleep(waitMs);
              continue;
            }

            lastErr = new Error(
              `OpenRouter fetch error on model=${model} (key[${apiKeyIndex}]): ${
                e?.message ?? "unknown"
              }`
            );
            break; // try fallback model (same key)
          } finally {
            clearTimeout(timeout);
          }
        }
      }

      // NEW: if we got here, this API key could not satisfy the request.
      // Try next key in the pool.
      attempts.push({
        apiKeyIndex,
        model: "(key_failover)",
        attempt: 0,
        status: 0,
        latencyMs: 0,
        note: "switch_api_key",
      });
    }

    // Preserve attempts trace for observability even on failure
    const msg = lastErr?.message ?? "OpenRouter request failed.";
    const err = new Error(msg);
    (err as any).trace = { attempts };
    throw err;
  }
}
