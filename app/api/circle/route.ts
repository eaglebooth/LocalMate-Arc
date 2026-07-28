import { NextResponse } from "next/server";

const CIRCLE_BASE_URL = "https://api.circle.com";

async function circleRequest(
  path: string,
  options: RequestInit,
  userToken?: string,
) {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Circle Wallet is not configured on this deployment." },
      { status: 503 },
    );
  }

  const response = await fetch(`${CIRCLE_BASE_URL}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(userToken ? { "X-User-Token": userToken } : {}),
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json();
  return NextResponse.json(data.data ?? data, { status: response.status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "createDeviceToken") {
      if (!body.deviceId) {
        return NextResponse.json({ error: "Missing deviceId." }, { status: 400 });
      }
      return circleRequest("/v1/w3s/users/social/token", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          deviceId: body.deviceId,
        }),
      });
    }

    if (action === "initializeUser") {
      if (!body.userToken) {
        return NextResponse.json({ error: "Missing userToken." }, { status: 400 });
      }
      return circleRequest(
        "/v1/w3s/user/initialize",
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            accountType: "SCA",
            blockchains: ["ARC-TESTNET"],
          }),
        },
        body.userToken,
      );
    }

    if (action === "listWallets") {
      if (!body.userToken) {
        return NextResponse.json({ error: "Missing userToken." }, { status: 400 });
      }
      return circleRequest("/v1/w3s/wallets", { method: "GET" }, body.userToken);
    }

    if (action === "getTokenBalance") {
      if (!body.userToken || !body.walletId) {
        return NextResponse.json(
          { error: "Missing userToken or walletId." },
          { status: 400 },
        );
      }
      return circleRequest(
        `/v1/w3s/wallets/${body.walletId}/balances`,
        { method: "GET" },
        body.userToken,
      );
    }

    if (action === "createContractExecution") {
      if (
        !body.userToken ||
        !body.walletId ||
        !/^0x[a-fA-F0-9]{40}$/.test(body.contractAddress ?? "") ||
        !/^0x(?:[a-fA-F0-9]{2})*$/.test(body.callData ?? "")
      ) {
        return NextResponse.json(
          { error: "Missing or invalid Circle contract execution fields." },
          { status: 400 },
        );
      }
      return circleRequest(
        "/v1/w3s/user/transactions/contractExecution",
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            contractAddress: body.contractAddress,
            walletId: body.walletId,
            callData: body.callData,
            feeLevel: "MEDIUM",
            refId: String(body.refId ?? "LocalMate Arc transaction").slice(0, 100),
          }),
        },
        body.userToken,
      );
    }

    if (action === "signMessage") {
      if (
        !body.userToken ||
        !body.walletId ||
        !/^0x(?:[a-fA-F0-9]{2})+$/.test(body.message ?? "")
      ) {
        return NextResponse.json(
          { error: "Missing or invalid Circle signing fields." },
          { status: 400 },
        );
      }
      return circleRequest(
        "/v1/w3s/user/sign/message",
        {
          method: "POST",
          body: JSON.stringify({
            walletId: body.walletId,
            message: body.message,
            encodedByHex: true,
            memo: String(body.memo ?? "Apply to a LocalMate job").slice(0, 100),
          }),
        },
        body.userToken,
      );
    }

    if (action === "getChallenge") {
      if (!body.userToken || !/^[a-fA-F0-9-]{36}$/.test(body.challengeId ?? "")) {
        return NextResponse.json({ error: "Missing Circle challenge fields." }, { status: 400 });
      }
      return circleRequest(
        `/v1/w3s/user/challenges/${body.challengeId}`,
        { method: "GET" },
        body.userToken,
      );
    }

    if (action === "getTransaction") {
      if (!body.userToken || !/^[a-fA-F0-9-]{36}$/.test(body.transactionId ?? "")) {
        return NextResponse.json({ error: "Missing Circle transaction fields." }, { status: 400 });
      }
      return circleRequest(
        `/v1/w3s/transactions/${body.transactionId}`,
        { method: "GET" },
        body.userToken,
      );
    }

    return NextResponse.json({ error: "Unknown Circle action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Circle request failed." },
      { status: 500 },
    );
  }
}
