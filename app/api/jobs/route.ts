import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { keccak256, toBytes } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const MAX_TASK_LENGTH = 2_000;

type SharedJobMetadata = {
  jobId: string;
  task: string;
  requirementsHash: string;
  createdAt: string;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function isValidMetadata(value: unknown): value is SharedJobMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SharedJobMetadata>;
  if (
    !item.jobId || !/^\d+$/.test(item.jobId)
    || !item.task || item.task.length > MAX_TASK_LENGTH
    || !item.requirementsHash || !HASH_PATTERN.test(item.requirementsHash)
    || !item.createdAt || Number.isNaN(Date.parse(item.createdAt))
  ) return false;
  return keccak256(toBytes(item.task)).toLowerCase() === item.requirementsHash.toLowerCase();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const requirementsHash = url.searchParams.get("requirementsHash");
    if (!jobId || !/^\d+$/.test(jobId)) return jsonError("The Arc job ID is invalid.", 400);
    if (!requirementsHash || !HASH_PATTERN.test(requirementsHash)) {
      return jsonError("The requirements hash is invalid.", 400);
    }

    const prefix = `jobs/job-${jobId}/${requirementsHash.toLowerCase()}.json`;
    const result = await list({ prefix, limit: 1 });
    const blob = result.blobs[0];
    if (!blob) return jsonError("No shared job description was found.", 404);
    const response = await fetch(blob.url, { cache: "no-store" });
    if (!response.ok) return jsonError("The shared job description could not be loaded.", 502);
    const metadata = await response.json() as unknown;
    if (!isValidMetadata(metadata)) return jsonError("The shared job description failed integrity checks.", 409);
    if (metadata.jobId !== jobId || metadata.requirementsHash.toLowerCase() !== requirementsHash.toLowerCase()) {
      return jsonError("The shared job description does not match this Arc job.", 409);
    }
    return NextResponse.json(metadata);
  } catch (error) {
    console.error("Job metadata lookup failed", error);
    return jsonError("Shared job description storage is unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const metadata = await request.json() as unknown;
    if (!isValidMetadata(metadata)) return jsonError("The job description or requirements hash is invalid.", 400);
    const pathname = `jobs/job-${metadata.jobId}/${metadata.requirementsHash.toLowerCase()}.json`;
    const blob = await put(pathname, JSON.stringify(metadata), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return NextResponse.json({ metadata, key: blob.pathname }, { status: 201 });
  } catch (error) {
    console.error("Job metadata publishing failed", error);
    return jsonError("Could not publish this job description.", 500);
  }
}
