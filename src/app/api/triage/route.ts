import { NextResponse } from "next/server";
import { getLLMProvider } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/types";
import { recordRun } from "@/lib/metrics/store";
import { callDSPyTriage } from "@/lib/dspy/client";
import { retrieve } from "@/lib/rag";
import { z } from "zod";
import crypto from "node:crypto";

export const runtime = "nodejs";

const ALLOWED_MODELS = new Set([
  "meta-llama/llama-3.2-3b-instruct:free",
  "amazon/nova-2-lite-v1:free",
  "mistralai/devstral-2512:free",
  // paid fallback (optional, but good “option B”)
  "mistralai/mistral-7b-instruct-v0.2",
]);


function pickModel(input: unknown, defaultValue: string) {
  if (typeof input === "string" && ALLOWED_MODELS.has(input)) return input;
  return defaultValue;
}

const TriageSchema = z.object({
  severity: z.enum(["SEV1", "SEV2", "SEV3"]),
  owner_team: z.string(),
  diagnosis: z.string(),
  next_steps: z.array(z.string()).min(1),
  customer_reply: z.string(),
  citations: z
    .array(z.object({ id: z.string(), quote: z.string().optional() }))
    .optional(),
});

function safeJsonParse(text: string) {
  const s = (text ?? "").trim();
  if (!s) return { ok: false as const, error: "Empty model output" };

  try {
    return { ok: true as const, value: JSON.parse(s) };
  } catch {
    // Try to salvage the first JSON object from the response
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const candidate = s.slice(first, last + 1);
      try {
        return { ok: true as const, value: JSON.parse(candidate) };
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Invalid JSON" };
      }
    }
    return { ok: false as const, error: "Invalid JSON (no object found)" };
  }
}

export async function POST(req: Request) {
  const {
    text,
    useRag = true,
    engine = "llm", // "llm" | "dspy"
    modelPrimary,
    modelFallback,
  } = await req.json();

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const traceId = crypto.randomUUID();
  const t0 = Date.now();
  const steps: Array<{ name: string; ok: boolean; ms: number; detail?: any }> =
    [];

  const defaultPrimary =
    process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.2-3b-instruct:free";
  const defaultFallback =
    process.env.OPENROUTER_FALLBACK_MODEL ??
    "mistralai/mistral-7b-instruct:free";

  const pickedPrimaryModel = pickModel(modelPrimary, defaultPrimary);
  const pickedFallbackModel = pickModel(modelFallback, defaultFallback);

  // --- Retrieve (RAG) ---
  let chunks: any[] = [];
  const tRetrieve = Date.now();
  try {
    chunks = useRag ? await retrieve(text, 4) : [];
    steps.push({
      name: "retrieve",
      ok: true,
      ms: Date.now() - tRetrieve,
      detail: { useRag, k: 4, returned: chunks.length },
    });
  } catch (e: any) {
    steps.push({
      name: "retrieve",
      ok: false,
      ms: Date.now() - tRetrieve,
      detail: { error: e?.message ?? "retrieve failed" },
    });
    chunks = []; // continue without RAG
  }

  const kbBlock = chunks.length
    ? chunks
        .map((c) => `SOURCE ${c.id} (score=${c.score})\n${c.text}`)
        .join("\n\n---\n\n")
    : "NO SOURCES PROVIDED";

  const system = `You are a Support Triage Copilot.
You MUST ground diagnosis and next_steps in the provided SOURCES.
Return JSON only (no markdown) with keys:
severity ("SEV1"|"SEV2"|"SEV3"),
owner_team,
diagnosis,
next_steps (array of strings),
customer_reply,
citations (array of { id, quote? }).

Rules:
- citations must reference SOURCE ids you were given (e.g., "runbook.md#0")
- include 1-3 citations if possible
- if SOURCES are insufficient, say what is missing and ask ONE question in diagnosis, and keep next_steps minimal.`;

  const user = `SOURCES:
${kbBlock}

Ticket text:
${text}`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    // Unified outputs from either engine
    let rawText = "";
    let parsedCandidate: any = null;
    let usedModel: string | undefined = undefined;
    let engineTrace: any = null;

    if (engine === "dspy") {
      const tDspy = Date.now();
      //const dspy = await callDSPyTriage({ text, useRag });
      const dspy = await callDSPyTriage({
        text,
        useRag,
        // pass your RAG sources as strings (service expects list)
        sources: chunks.map((c) => `SOURCE ${c.id} (score=${c.score})\n${c.text}`),
        // for demo stability keep compile false (set true only when you want)
        compile: false,
      });
      
      steps.push({
        name: "dspy_triage",
        ok: true,
        ms: Date.now() - tDspy,
        detail: { usedModel: dspy.usedModel },
      });

      parsedCandidate = dspy.parsed;
      usedModel = dspy.usedModel;
      engineTrace = dspy.trace ?? null;

      rawText = JSON.stringify(dspy.raw ?? dspy.parsed ?? {}, null, 2);
    } else {
      const llm = getLLMProvider();
      const tLlm = Date.now();

      const out = await llm.chat(messages, {
        primaryModel: pickedPrimaryModel,
        fallbackModel: pickedFallbackModel,
      });

      steps.push({
        name: "llm_triage",
        ok: true,
        ms: Date.now() - tLlm,
        detail: {
          usedModel: out.usedModel,
          primaryModel: pickedPrimaryModel,
          fallbackModel: pickedFallbackModel,
        },
      });

      rawText = out.text ?? "";
      usedModel = out.usedModel;
      engineTrace = out.trace ?? null;

      // Safe parse
      const parsedTry = safeJsonParse(rawText);
      if (!parsedTry.ok) {
        parsedCandidate = null;
        steps.push({
          name: "parse_json",
          ok: false,
          ms: 0,
          detail: { error: parsedTry.error },
        });
      } else {
        parsedCandidate = parsedTry.value;
        steps.push({ name: "parse_json", ok: true, ms: 0 });
      }
    }

    // Validate + normalize with Zod
    let parsed: any = null;
    let validationError: string | null = null;

    if (parsedCandidate == null) {
      validationError = "Model did not return valid JSON.";
      parsed = null;
    } else {
      const v = TriageSchema.safeParse(parsedCandidate);
      if (!v.success) {
        validationError = v.error.message;
        parsed = parsedCandidate; // still return for debugging
      } else {
        parsed = v.data;
      }
    }

    steps.push({
      name: "validate",
      ok: !validationError,
      ms: 0,
      detail: validationError
        ? { error: validationError }
        : { schema: "TriageSchema" },
    });

    // Guardrail: only allow citations that reference retrieved sources
    if (parsed?.citations?.length) {
      const allowedIds = new Set(chunks.map((c) => c.id));
      parsed.citations = parsed.citations.filter((c: any) =>
        allowedIds.has(c.id)
      );
    }

    const trace = {
      traceId,
      totalMs: Date.now() - t0,
      steps,
      engine,
      engineTrace,
    };

    // Metrics
    const retrieveStep = steps.find((s) => s.name === "retrieve");
    const llmStep = steps.find((s) => s.name === "llm_triage");
    const dspyStep = steps.find((s) => s.name === "dspy_triage");

    // Retry counting for LLM only (based on provider trace attempts)
    const attemptEvents = engineTrace?.attempts ?? [];
    const httpAttempts = Array.isArray(attemptEvents)
      ? attemptEvents.filter((a: any) => a?.latencyMs > 0)
      : [];
    const attempts = engine === "llm" ? httpAttempts.length : 0;
    const retries = engine === "llm" ? Math.max(0, attempts - 1) : 0;

    recordRun({
      ts: Date.now(),
      traceId,
      engine,
      useRag,
      primaryModel: pickedPrimaryModel,
      fallbackModel: pickedFallbackModel,
      usedModel,
      totalMs: trace.totalMs,
      ragMs: retrieveStep?.ms,
      llmMs: llmStep?.ms,
      dspyMs: dspyStep?.ms,
      attempts,
      retries,
      validationOk: !validationError,
    });

    return NextResponse.json({
      parsed,
      rawText,
      validationError,
      sources: chunks,
      usedRag: useRag,
      engine,
      primaryModel: pickedPrimaryModel,
      fallbackModel: pickedFallbackModel,
      usedModel,
      trace,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
