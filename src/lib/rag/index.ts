import fs from "node:fs";
import path from "node:path";
import { pipeline } from "@xenova/transformers";

type Chunk = { id: string; text: string; embedding: number[] };

let _chunks: Chunk[] | null = null;
let _embedder: any | null = null;

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function chunkText(text: string, maxChars = 900): string[] {
  const paras = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > maxChars) {
      if (buf.trim()) chunks.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

async function getEmbedder() {
  if (_embedder) return _embedder;
  _embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return _embedder;
}

async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const out = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

async function loadKB(): Promise<Chunk[]> {
  if (_chunks) return _chunks;

  const kbDir = path.join(process.cwd(), "src", "kb");
  const files = fs.readdirSync(kbDir).filter((f) => f.endsWith(".md"));

  const all: Chunk[] = [];
  for (const file of files) {
    const full = fs.readFileSync(path.join(kbDir, file), "utf-8");
    const parts = chunkText(full);
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i];
      const embedding = await embed(text);
      all.push({ id: `${file}#${i}`, text, embedding });
    }
  }
  _chunks = all;
  return all;
}

export async function retrieve(query: string, k = 4) {
  const kb = await loadKB();
  const q = await embed(query);

  const scored = kb
    .map((c) => ({ c, score: cosine(q, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored.map((s) => ({
    id: s.c.id,
    score: Number(s.score.toFixed(4)),
    text: s.c.text,
  }));
}
