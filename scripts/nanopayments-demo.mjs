import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { writeFileSync } from "node:fs";

const rawKey = process.env.OWNER_PRIVATE_KEY;
if (!rawKey) throw new Error("Missing OWNER_PRIVATE_KEY");
const privateKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
const sellerAddress = process.env.SELLER_ADDRESS;
if (!sellerAddress) throw new Error("Missing SELLER_ADDRESS");

const app = express();
const gateway = createGatewayMiddleware({
  sellerAddress,
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
  networks: ["eip155:5042002"],
  description: "LocalMate AI Trust Review",
});

app.get("/trust-review", gateway.require("$0.001"), (request, response) => {
  response.json({
    verified: true,
    service: "LocalMate AI Trust Review",
    result: "Profile signals validated",
    payment: request.payment,
  });
});

const server = await new Promise((resolve) => {
  const active = app.listen(4021, "127.0.0.1", () => resolve(active));
});

try {
  const client = new GatewayClient({
    chain: "arcTestnet",
    privateKey,
    rpcUrl: process.env.ARC_RPC_URL || "https://rpc.quicknode.testnet.arc.network",
  });
  const balances = await client.getBalances();
  let deposit = null;
  if (balances.gateway.available < 10_000n) {
    deposit = await client.deposit("1");
    console.log("Deposited 1 USDC into Circle Gateway");
  }
  const result = await client.pay("http://127.0.0.1:4021/trust-review");
  const output = {
    protocol: "x402",
    settlement: "Circle Gateway Nanopayments",
    network: "Arc Testnet",
    amount: result.formattedAmount,
    transaction: result.transaction,
    status: result.status,
    seller: sellerAddress,
    deposit,
  };
  writeFileSync(
    "public/nanopayment.json",
    JSON.stringify(output, (_, value) => typeof value === "bigint" ? value.toString() : value, 2),
  );
  console.log(`Nanopayment complete: ${result.formattedAmount} USDC`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
