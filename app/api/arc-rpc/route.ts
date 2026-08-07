import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "eth_call",
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionReceipt",
]);

const RPC_ENDPOINTS = [
  "https://rpc.testnet.arc.network",
  "https://rpc.drpc.testnet.arc.network",
];

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 65_536) {
      return NextResponse.json({ error: { message: "RPC request is too large." } }, { status: 413 });
    }
    const body = await request.json() as { method?: string; params?: unknown[] };
    if (!body.method || !ALLOWED_METHODS.has(body.method) || !Array.isArray(body.params)) {
      return NextResponse.json({ error: { message: "RPC method is not allowed." } }, { status: 400 });
    }

    let lastError = "Arc Testnet RPC is temporarily unavailable.";
    for (const endpoint of RPC_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: body.method, params: body.params }),
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) {
          lastError = `Arc RPC returned HTTP ${response.status}.`;
          continue;
        }
        const payload = await response.json() as { result?: unknown; error?: { message?: string } };
        if (payload.error) {
          return NextResponse.json(payload, { status: 200 });
        }
        if (payload.result !== undefined) {
          return NextResponse.json(payload, { status: 200 });
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    return NextResponse.json({ error: { message: lastError } }, { status: 503 });
  } catch {
    return NextResponse.json({ error: { message: "Invalid RPC request." } }, { status: 400 });
  }
}
