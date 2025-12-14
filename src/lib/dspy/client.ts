type DSPyInput = {
  text: string;
  useRag?: boolean; // kept for your UI; service can ignore it
  sources?: string[]; // IMPORTANT: list of strings
  compile?: boolean; // optional (slower)
};

type DSPyResult = {
  parsed: any;
  raw: any;
  latencyMs: number;
  usedModel: string;
  trace: any;
};

export async function callDSPyTriage(input: DSPyInput): Promise<DSPyResult> {
  const endpoint = process.env.DSPY_SERVICE_URL;
  if (!endpoint) throw new Error("Missing DSPY_SERVICE_URL");

  // IMPORTANT: must be https URL in Vercel env (no trailing spaces)
  const base = endpoint.replace(/\/$/, "");
  const url = `${base}/triage`;

  // Convert to service contract (FastAPI expects text, sources, compile)
  const payload = {
    text: input.text,
    // service expects sources array; default []
    sources: Array.isArray(input.sources) ? input.sources : [],
    // for demo stability: default compile=false
    compile: Boolean(input.compile),
    // optional: include useRag in case you log it server-side later
    useRag: Boolean(input.useRag),
  };

  async function attemptOnce(timeoutMs: number, attemptLabel: string) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Some hosts behave better with explicit accept
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });

      const latencyMs = Date.now() - t0;
      const bodyText = await res.text();

      if (!res.ok) {
        const msg = bodyText?.slice(0, 600) || "(empty body)";
        throw new Error(`DSPy HTTP ${res.status} (${attemptLabel}) from ${url}: ${msg}`);
      }

      let data: any;
      try {
        data = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        throw new Error(
          `DSPy returned non-JSON (${attemptLabel}) from ${url}: ${
            bodyText?.slice(0, 600) || "(empty body)"
          }`
        );
      }

      // main.py returns: { output, model, trace, raw, score, notes }
      return {
        parsed: data?.output ?? data,
        raw: data,
        latencyMs,
        usedModel: data?.model ?? "DSPy",
        trace: data?.trace ?? null,
      };
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error(`DSPy timeout after ${timeoutMs}ms (${attemptLabel}) calling ${url}`);
      }
      throw new Error(`DSPy fetch failed (${attemptLabel}) calling ${url}: ${e?.message ?? e}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Render cold start can exceed 25s. Use 45s first attempt, then retry once.
  try {
    return await attemptOnce(45000, "attempt-1");
  } catch (e: any) {
    // Backoff a bit then retry (helps with cold-start)
    await new Promise((r) => setTimeout(r, 2500));
    return await attemptOnce(45000, "attempt-2");
  }
}
