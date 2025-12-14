import { NextResponse } from "next/server";
import { listRuns, summarize } from "@/lib/metrics/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  return NextResponse.json({
    summary: summarize(),
    runs: listRuns(Math.max(1, Math.min(200, limit))),
  });
}
