import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 1024 * 1024;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const jobId = formData.get("jobId");
    const provider = formData.get("provider");

    if (!(file instanceof File)) {
      return jsonError("Choose an evidence file before submitting.", 400);
    }
    if (typeof jobId !== "string" || !/^\d+$/.test(jobId)) {
      return jsonError("The Arc job ID is invalid.", 400);
    }
    if (typeof provider !== "string" || !ADDRESS_PATTERN.test(provider)) {
      return jsonError("The provider wallet address is invalid.", 400);
    }
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return jsonError("Evidence must be between 1 byte and 1 MB.", 413);
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return jsonError("Upload a JPG, PNG, WEBP, GIF, MP4, MOV, WEBM or PDF file.", 415);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const evidenceHash = `0x${createHash("sha256").update(bytes).digest("hex")}`;
    const uri = `data:${file.type};base64,${bytes.toString("base64")}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);

    return NextResponse.json({
      key: `job-${jobId}/${Date.now()}-${safeName}`,
      uri,
      evidenceHash,
      name: file.name,
      size: file.size,
      type: file.type,
      provider: provider.toLowerCase(),
    });
  } catch (error) {
    console.error("Evidence upload failed", error);
    return jsonError("Evidence service could not process this file.", 500);
  }
}
