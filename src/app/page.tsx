"use client";

import { useState } from "react";

const MODEL_OPTIONS = [
  "meta-llama/llama-3.2-3b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemma-7b-it:free",
];

export default function Home() {
  const [text, setText] = useState(
    "Customers report card authorization failed after CSRF changes. Checkout broken for some sessions."
  );
  const [result, setResult] = useState<any>(null);
  //const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<null | "rag" | "norag">(null);
  

  
  const [modelPrimary, setModelPrimary] = useState(MODEL_OPTIONS[0]);
  const [modelFallback, setModelFallback] = useState(MODEL_OPTIONS[1]);

  
  async function run(useRag: boolean) {
    setLoadingMode(useRag ? "rag" : "norag");
    setResult(null);
  
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, useRag, modelPrimary, modelFallback }),
      });
      
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setResult({ error: e?.message ?? "Request failed" });
    } finally {
      setLoadingMode(null);
    }
  }
  
  
  return (
    <main className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">LLM Support Triage Copilot</h1>

      <textarea
        className="w-full border rounded p-3 min-h-[140px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
  <label className="space-y-1">
    <div className="text-sm font-semibold">Primary model</div>
    <select
      className="w-full border rounded p-2"
      value={modelPrimary}
      onChange={(e) => setModelPrimary(e.target.value)}
      disabled={loadingMode !== null}
    >
      {MODEL_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  </label>

  <label className="space-y-1">
    <div className="text-sm font-semibold">Fallback model (on 429)</div>
    <select
      className="w-full border rounded p-2"
      value={modelFallback}
      onChange={(e) => setModelFallback(e.target.value)}
      disabled={loadingMode !== null}
    >
      {MODEL_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  </label>
</div>


<div className="flex gap-3">
<button
  onClick={() => run(false)}
  disabled={loadingMode !== null}
  className="px-4 py-2 rounded border bg-gray-100"
>
  {loadingMode === "norag" ? "Running..." : "Run WITHOUT RAG"}
</button>

<button
  onClick={() => run(true)}
  disabled={loadingMode !== null}
  className="px-4 py-2 rounded border bg-blue-100"
>
  {loadingMode === "rag" ? "Running..." : "Run WITH RAG"}
</button>

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
              {s.text.slice(0, 200)}...
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

    <pre className="w-full border rounded p-3 overflow-auto text-sm">
      {JSON.stringify(result, null, 2)}
    </pre>
  </>
)}

    </main>
  );
}
