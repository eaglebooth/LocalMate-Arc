import { createHash } from "node:crypto";
import { list, put } from "@vercel/blob";
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

function contentTypeFor(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  return ({
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    jfif: "image/jpeg",
    mov: "video/quicktime",
    mp4: "video/mp4",
    pdf: "application/pdf",
    png: "image/png",
    webm: "video/webm",
    webp: "image/webp",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

export async function GET(request: Request) {
  try {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId || !/^\d+$/.test(jobId)) {
      return jsonError("The Arc job ID is invalid.", 400);
    }
    const result = await list({ prefix: `job-${jobId}/`, limit: 100 });
    const blob = result.blobs.sort(
      (left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime(),
    )[0];
    if (!blob) return jsonError("No shared evidence has been uploaded for this job.", 404);
    const filename = blob.pathname.split("/").pop() ?? "evidence";
    const match = filename.match(/^([a-fA-F0-9]{64})-(.+)$/);
    if (!match) return jsonError("Stored evidence metadata is invalid.", 500);

    return NextResponse.json({
      key: blob.pathname,
      uri: blob.url,
      evidenceHash: `0x${match[1].toLowerCase()}`,
      name: match[2],
      size: blob.size,
      type: contentTypeFor(match[2]),
    });
  } catch (error) {
    console.error("Evidence lookup failed", error);
    return jsonError("Shared evidence storage is unavailable.", 503);
  }
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
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const pathname = `job-${jobId}/${evidenceHash.slice(2)}-${safeName}`;
    const blob = await put(pathname, bytes, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });

    return NextResponse.json({
      key: blob.pathname,
      uri: blob.url,
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
