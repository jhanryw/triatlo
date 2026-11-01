import { NextResponse } from "next/server";
import { IngestError } from "@triatlo/ingest";
import { getSession } from "@/server/ctx";
import { analyzeUpload } from "@/server/import-analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST the raw file body (GPX, TCX or Apple Health export.xml). Returns what it contains; nothing is stored yet. */
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!request.body) return NextResponse.json({ error: "empty_body" }, { status: 400 });
  try {
    return NextResponse.json(await analyzeUpload(request.body));
  } catch (e) {
    if (e instanceof IngestError) return NextResponse.json({ error: "unsupported_file", message: e.message }, { status: 422 });
    return NextResponse.json({ error: "analysis_failed" }, { status: 500 });
  }
}
