import { NextResponse } from "next/server";
import { getLLMProvider } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/types";


import { retrieve } from "@/lib/rag";
import { z } from "zod";

export const runtime = "nodejs";

const ALLOWED_MODELS = new Set([
    "meta-llama/llama-3.2-3b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
    "google/gemma-7b-it:free",
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
      .optional()
  });

  
export async function POST(req: Request) {
 // const { text } = await req.json();
 //const { text, useRag = true } = await req.json();
 const { text, useRag = true, modelPrimary, modelFallback } = await req.json();


  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const defaultPrimary =
  process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.2-3b-instruct:free";
const defaultFallback =
  process.env.OPENROUTER_FALLBACK_MODEL ?? "mistralai/mistral-7b-instruct:free";

const primaryModel = pickModel(modelPrimary, defaultPrimary);
const fallbackModel = pickModel(modelFallback, defaultFallback);


  //const chunks = await retrieve(text, 4);
  const chunks = useRag ? await retrieve(text, 4) : [];

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
  ${text}
  `;
  

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    const llm = getLLMProvider();
    //const out = await llm.chat(messages);
    const out = await llm.chat(messages, { primaryModel, fallbackModel });


    // Attempt to parse JSON; if model returns extra text, still show raw
    let parsed: any = null;
    let validationError: string | null = null;

    try {
      parsed = JSON.parse(out.text);
      const v = TriageSchema.safeParse(parsed);
      if (!v.success) validationError = v.error.message;
      else parsed = v.data;
    } catch (e: any) {
        validationError = e?.message ?? "Model did not return valid JSON.";
      }

    //return NextResponse.json({ parsed, rawText: out.text });
    return NextResponse.json({
        parsed,
        rawText: out.text,
        validationError,
        sources: chunks,
        usedRag: useRag,
        modelPrimary: primaryModel,
        modelFallback: fallbackModel,
        usedModel: out.usedModel,
      });
      
      
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
