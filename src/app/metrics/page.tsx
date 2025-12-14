"use client";

import { useEffect, useMemo, useState } from "react";

type MetricsResponse = {
  summary: {
    total: number;
    validationRate: number;
    retries: number;
    latency: {
      p50: number; p95: number;
      ragP50: number; ragP95: number;
      noRagP50: number; noRagP95: number;
    };
    byModel: Record<string, number>;
  };
  runs: Array<{
    ts: number;
    traceId: string;
    useRag: boolean;
    primaryModel: string;
    fallbackModel: string;
    usedModel?: string;
    totalMs: number;
    ragMs?: number;
    llmMs?: number;
    attempts?: number;
    retries?: number;
    validationOk: boolean;
  }>;
};

function fmtPct(x: number) {
  return `${Math.round(x * 1000) / 10}%`;
}

export default function MetricsPage() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function load() {
    try {
      setError(null);
      const res = await fetch("/api/metrics?limit=80", { cache: "no-store" });
      const json = (await res.json()) as MetricsResponse;
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load metrics");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  const models = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.summary.byModel).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Metrics</h1>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto refresh
          </label>
          <button className="px-3 py-2 border rounded text-sm" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="border rounded p-3 text-sm">
          <span className="font-semibold">Error:</span> {error}
        </div>
      )}

      {!data ? (
        <div className="text-sm opacity-80">Loading…</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="border rounded p-3">
              <div className="text-sm opacity-70">Requests</div>
              <div className="text-xl font-semibold">{data.summary.total}</div>
            </div>

            <div className="border rounded p-3">
              <div className="text-sm opacity-70">Validation rate</div>
              <div className="text-xl font-semibold">
                {fmtPct(data.summary.validationRate)}
              </div>
            </div>

            <div className="border rounded p-3">
              <div className="text-sm opacity-70">Retries (total)</div>
              <div className="text-xl font-semibold">{data.summary.retries}</div>
            </div>

            <div className="border rounded p-3">
              <div className="text-sm opacity-70">Latency p50 / p95</div>
              <div className="text-xl font-semibold">
                {Math.round(data.summary.latency.p50)}ms /{" "}
                {Math.round(data.summary.latency.p95)}ms
              </div>
            </div>
          </div>

          {/* RAG vs no-RAG */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border rounded p-3">
              <div className="font-semibold">With RAG</div>
              <div className="text-sm opacity-80">
                p50 {Math.round(data.summary.latency.ragP50)}ms · p95{" "}
                {Math.round(data.summary.latency.ragP95)}ms
              </div>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold">Without RAG</div>
              <div className="text-sm opacity-80">
                p50 {Math.round(data.summary.latency.noRagP50)}ms · p95{" "}
                {Math.round(data.summary.latency.noRagP95)}ms
              </div>
            </div>
          </div>

          {/* Model distribution */}
          <div className="border rounded p-3 space-y-2">
            <div className="font-semibold">Model usage</div>
            {models.length === 0 ? (
              <div className="text-sm opacity-80">No data yet.</div>
            ) : (
              <div className="space-y-1">
                {models.map(([m, count]) => (
                  <div key={m} className="text-sm flex justify-between gap-3">
                    <div className="font-mono truncate">{m}</div>
                    <div className="font-mono">{count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent runs table */}
          <div className="border rounded p-3">
            <div className="font-semibold mb-2">Recent runs</div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left opacity-80">
                  <tr>
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Mode</th>
                    <th className="py-2 pr-4">Used model</th>
                    <th className="py-2 pr-4">Latency</th>
                    <th className="py-2 pr-4">Retries</th>
                    <th className="py-2 pr-4">Valid</th>
                    <th className="py-2 pr-4">Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((r) => (
                    <tr key={r.traceId} className="border-t">
                      <td className="py-2 pr-4">
                        {new Date(r.ts).toLocaleTimeString()}
                      </td>
                      <td className="py-2 pr-4">
                        {r.useRag ? "RAG" : "No-RAG"}
                      </td>
                      <td className="py-2 pr-4 font-mono max-w-[360px] truncate">
                        {r.usedModel ?? "unknown"}
                      </td>
                      <td className="py-2 pr-4 font-mono">
                        {Math.round(r.totalMs)}ms
                      </td>
                      <td className="py-2 pr-4 font-mono">{r.retries ?? 0}</td>
                      <td className="py-2 pr-4">
                        {r.validationOk ? "✅" : "❌"}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.traceId.slice(0, 8)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
