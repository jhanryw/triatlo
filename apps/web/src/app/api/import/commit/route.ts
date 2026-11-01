import { NextResponse } from "next/server";
import { commitImport, DataError } from "@triatlo/data";
import { getSession } from "@/server/ctx";
import { CommitBodySchema, batchFromCommit } from "@/server/import-commit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stores what the user chose after seeing the inventory. Idempotent: re-importing the same file adds nothing new. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = CommitBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const { batch, sourceId } = batchFromCommit(parsed.data);
    const report = await commitImport(session.ctx, batch, { sourceId, fileName: parsed.data.fileName, fileSha256: parsed.data.fileSha256 });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof DataError ? "data_error" : "import_failed", message: e instanceof DataError ? e.message : undefined }, { status: 500 });
  }
}
