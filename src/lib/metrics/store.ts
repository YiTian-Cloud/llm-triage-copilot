export type TriageRunMetric = {
    ts: number;                 // Date.now()
    traceId: string;
    useRag: boolean;
    primaryModel: string;
    fallbackModel: string;
    usedModel?: string;
  
    engine?: "llm" | "dspy"; 

    totalMs: number;
    ragMs?: number;
    llmMs?: number;
    dspyMs?: number;   
   
    attempts?: number;          // total attempts in provider trace
    retries?: number;           // attempts - 1
    validationOk: boolean;
  };
  
  type Store = {
    runs: TriageRunMetric[];
    max: number;
  };
  
  const g = globalThis as any;
  const store: Store = g.__triage_metrics_store ?? { runs: [], max: 200 };
  g.__triage_metrics_store = store;
  
  export function recordRun(run: TriageRunMetric) {
    store.runs.unshift(run);
    if (store.runs.length > store.max) store.runs.length = store.max;
  }
  
  export function listRuns(limit = 50) {
    return store.runs.slice(0, limit);
  }
  
  function percentile(values: number[], p: number) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }
  
  export function summarize() {
    const runs = store.runs;
  
    const total = runs.length;
    const ok = runs.filter(r => r.validationOk).length;
  
    const totalMs = runs.map(r => r.totalMs);
    const ragMs = runs.filter(r => r.useRag && r.ragMs != null).map(r => r.ragMs!);
    const noRagMs = runs.filter(r => !r.useRag).map(r => r.totalMs);

    const dspyRuns = runs.filter(r => r.engine === "dspy");
    const llmRuns = runs.filter(r => (r.engine ?? "llm") === "llm");

    const dspyTotalMs = dspyRuns.map(r => r.totalMs);
    const llmTotalMs = llmRuns.map(r => r.totalMs);

  
    const byModel: Record<string, number> = {};
    for (const r of runs) {
      const m = r.usedModel ?? "unknown";
      byModel[m] = (byModel[m] ?? 0) + 1;
    }
  
    const retries = runs.reduce((sum, r) => sum + (r.retries ?? 0), 0);
  
    return {
      total,
      validationRate: total ? ok / total : 0,
      retries,
      latency: {
        p50: percentile(totalMs, 50),
        p95: percentile(totalMs, 95),
        ragP50: percentile(ragMs, 50),
        ragP95: percentile(ragMs, 95),
        noRagP50: percentile(noRagMs, 50),
        noRagP95: percentile(noRagMs, 95),
        dspyP50: percentile(dspyTotalMs, 50),
        dspyP95: percentile(dspyTotalMs, 95),
        llmP50: percentile(llmTotalMs, 50),
        llmP95: percentile(llmTotalMs, 95),
      },
      byModel,
    };
  }
  