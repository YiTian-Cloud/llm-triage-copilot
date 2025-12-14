"use client";

import { useRef, useState } from "react";

const MODEL_OPTIONS = [
  "meta-llama/llama-3.2-3b-instruct:free",
  "amazon/nova-2-lite-v1:free",
  "mistralai/devstral-2512:free",
  // paid fallback (optional, but good “option B”)
  "mistralai/mistral-7b-instruct-v0.2",
];



export default function Home() {
  const [text, setText] = useState(
    "Customers report card authorization failed after CSRF changes. Checkout broken for some sessions."
  );
  const [result, setResult] = useState<any>(null);
  const [loadingMode, setLoadingMode] = useState<null | "rag" | "norag">(null);

  const [modelPrimary, setModelPrimary] = useState(MODEL_OPTIONS[0]);
  const [modelFallback, setModelFallback] = useState(MODEL_OPTIONS[1]);
  const [engine, setEngine] = useState<"llm" | "dspy">("dspy");


  const abortRef = useRef<AbortController | null>(null);

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoadingMode(null);
    setResult({ error: "Cancelled." });
  }

  async function run(useRag: boolean) {
    // Abort any prior in-flight request
    abortRef.current?.abort();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoadingMode(useRag ? "rag" : "norag");
    setResult(null);

    // Client-side timeout so it never “runs forever”
    const timeoutMs = 30000;
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          useRag,
          engine,
          modelPrimary,
          modelFallback,
        }),
        signal: ctrl.signal,
      });

      // Don’t assume JSON (server might return HTML or empty)
      const bodyText = await res.text();
      let data: any = null;
      try {
        data = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        data = { error: `Non-JSON response (${res.status}): ${bodyText?.slice(0, 400)}` };
      }

      setResult(data);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setResult({ error: `Request cancelled or timed out after ${timeoutMs}ms.` });
      } else {
        setResult({ error: e?.message ?? "Request failed" });
      }
    } finally {
      clearTimeout(t);
      abortRef.current = null;
      setLoadingMode(null);
    }
  }

  const isRunning = loadingMode !== null;

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">LLM Support Triage Copilot</h1>
        <a href="/metrics" className="text-sm underline opacity-80">
          View metrics
        </a>
      </div>

      <textarea
        className="w-full border rounded p-3 min-h-[140px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="space-y-1 block">
          <div className="text-sm font-semibold">Execution engine</div>
          <select
            className="w-full border rounded p-2"
            value={engine}
            onChange={(e) => setEngine(e.target.value as "llm" | "dspy")}
            disabled={isRunning}
          >
            <option value="llm">LLM (Direct / RAG)</option>
            <option value="dspy">DSPy Service</option>
          </select>

          <div className="text-xs opacity-70">
            Tip: DSPy runs via your Render service; LLM runs via OpenRouter.
          </div>
        </label>

        <label className="space-y-1">
          <div className="text-sm font-semibold">Primary model</div>
          <select
            className="w-full border rounded p-2"
            value={modelPrimary}
            onChange={(e) => setModelPrimary(e.target.value)}
            disabled={isRunning || engine === "dspy"}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
        <div className="text-sm font-semibold">Fallback model (on 404/429/5xx)</div>

          <select
            className="w-full border rounded p-2"
            value={modelFallback}
            onChange={(e) => setModelFallback(e.target.value)}
            disabled={isRunning || engine === "dspy"}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-3 items-center">
        <button
          onClick={() => run(false)}
          disabled={isRunning}
          className="px-4 py-2 rounded border bg-gray-100"
        >
          {loadingMode === "norag"
            ? "Running..."
            : `Run ${engine.toUpperCase()} WITHOUT RAG`}
        </button>

        <button
          onClick={() => run(true)}
          disabled={isRunning}
          className="px-4 py-2 rounded border bg-blue-100"
        >
          {loadingMode === "rag"
  ? "Running..."
  : `Run ${engine.toUpperCase()} WITH RAG`}
        </button>

        {isRunning && (
          <button
            onClick={cancel}
            className="px-4 py-2 rounded border bg-red-100"
          >
            Cancel
          </button>
        )}
      </div>

      {result && (
        <>
          {result?.usedRag !== undefined && (
            <div className="text-sm font-semibold">
              Mode: {result.usedRag ? "WITH RAG" : "WITHOUT RAG"}
            </div>
          )}

          {result?.sources?.length > 0 && (
            <div className="border rounded p-3 space-y-2">
              <div className="font-semibold">Retrieved Sources</div>
              {result.sources.map((s: any) => (
                <div key={s.id} className="text-sm">
                  <div className="font-mono">
                    {s.id} (score={s.score})
                  </div>
                  <div className="opacity-80 whitespace-pre-wrap">
                    {String(s.text ?? "").slice(0, 200)}...
                  </div>
                </div>
              ))}
            </div>
          )}

          {result?.usedModel && (
            <div className="text-sm">
              <span className="font-semibold">Model used:</span> {result.usedModel}
            </div>
          )}

          {result?.engine && (
            <div className="text-sm">
              <span className="font-semibold">Engine:</span>{" "}
              {String(result.engine).toUpperCase()}
            </div>
          )}

          <pre className="w-full border rounded p-3 overflow-auto text-sm">
            {JSON.stringify(result, null, 2)}
          </pre>
        </>
      )}
    </main>
  );
}
