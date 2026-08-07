import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { keccak256, type Hex } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const SIGNATURE_PATTERN = /^0x[a-fA-F0-9]+$/;

type StoredApplication = {
  jobId: string;
  provider: string;
  signature: string;
  applicationHash: string;
  appliedAt: string;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function isValidApplication(value: unknown): value is StoredApplication {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredApplication>;
  const structurallyValid = Boolean(
    item.jobId && /^\d+$/.test(item.jobId)
    && item.provider && ADDRESS_PATTERN.test(item.provider)
    && item.signature && SIGNATURE_PATTERN.test(item.signature) && item.signature.length <= 4098
    && item.applicationHash && HASH_PATTERN.test(item.applicationHash)
    && item.appliedAt && !Number.isNaN(Date.parse(item.appliedAt)),
  );
  if (!structurallyValid) return false;
  return keccak256(item.signature as Hex).toLowerCase() === item.applicationHash?.toLowerCase();
}

export async function GET(request: Request) {
  try {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId || !/^\d+$/.test(jobId)) return jsonError("The Arc job ID is invalid.", 400);

    const result = await list({ prefix: `applications/job-${jobId}/`, limit: 100 });
    const loaded = await Promise.all(result.blobs.map(async (blob) => {
      try {
        const response = await fetch(blob.url, { cache: "no-store" });
        if (!response.ok) return null;
        const application = await response.json() as unknown;
        return isValidApplication(application) && application.jobId === jobId
          ? application
          : null;
      } catch {
        return null;
      }
    }));

    const latestByProvider = new Map<string, StoredApplication>();
    for (const application of loaded) {
      if (!application) continue;
      const key = application.provider.toLowerCase();
      const previous = latestByProvider.get(key);
      if (!previous || Date.parse(application.appliedAt) > Date.parse(previous.appliedAt)) {
        latestByProvider.set(key, application);
      }
    }
    return NextResponse.json({ applications: [...latestByProvider.values()] });
  } catch (error) {
    console.error("Application lookup failed", error);
    return jsonError("Shared application storage is unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const application = await request.json() as unknown;
    if (!isValidApplication(application)) return jsonError("The signed application is invalid.", 400);

    const pathname = `applications/job-${application.jobId}/${application.provider.toLowerCase()}.json`;
    const blob = await put(pathname, JSON.stringify(application), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return NextResponse.json({ application, key: blob.pathname }, { status: 201 });
  } catch (error) {
    console.error("Application publishing failed", error);
    return jsonError("Could not publish this signed application.", 500);
  }
}
