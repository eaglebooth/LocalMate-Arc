import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  parseUnits,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const RPC = process.env.ARC_RPC_URL || "https://rpc.blockdaemon.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";
const BUDGET = 10_000n;
const deployment = JSON.parse(fs.readFileSync("public/arc-v4-deployment.json", "utf8"));
const abi = JSON.parse(fs.readFileSync("public/arc-v4-abi.json", "utf8"));
const contract = deployment.contractAddress;

function key(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

const resident = privateKeyToAccount(key("OWNER_PRIVATE_KEY"));
const helper = privateKeyToAccount(key("HELPER_PRIVATE_KEY"));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const residentWallet = createWalletClient({ account: resident, chain: arcTestnet, transport: http(RPC) });
const helperWallet = createWalletClient({ account: helper, chain: arcTestnet, transport: http(RPC) });
const fee = { maxFeePerGas: parseUnits("20", 9), maxPriorityFeePerGas: parseUnits("1", 9) };
const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

async function wait(hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

const residentBalance = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [resident.address],
});
if (residentBalance < BUDGET) throw new Error("Resident wallet needs at least 0.01 USDC.");

const latest = await publicClient.getBlock();
const requirementsHash = keccak256(toBytes(`LocalMate live review round ${Date.now()}`));
const createReceipt = await wait(await residentWallet.writeContract({
  address: contract,
  abi,
  functionName: "createJob",
  args: [resident.address, BUDGET, latest.timestamp + 3_600n, requirementsHash],
  ...fee,
}), "Job created");
const jobId = parseEventLogs({ abi, logs: createReceipt.logs, eventName: "JobCreated" })[0].args.jobId;

await wait(await residentWallet.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "approve",
  args: [contract, BUDGET],
  ...fee,
}), "USDC approved");
await wait(await residentWallet.writeContract({
  address: contract,
  abi,
  functionName: "fund",
  args: [jobId],
  ...fee,
}), "Escrow funded");

const digest = await publicClient.readContract({
  address: contract,
  abi,
  functionName: "applicationDigest",
  args: [jobId, helper.address],
});
const signature = await helper.signMessage({ message: { raw: digest } });
await wait(await residentWallet.writeContract({
  address: contract,
  abi,
  functionName: "assignProvider",
  args: [jobId, helper.address, signature],
  ...fee,
}), "Helper application assigned");

const evidenceHash = keccak256(toBytes(`LocalMate evidence for job ${jobId}`));
const evidenceUriHash = keccak256(toBytes(`r2://localmate/job-${jobId}/review-evidence.jpg`));
await wait(await helperWallet.writeContract({
  address: contract,
  abi,
  functionName: "submitEvidence",
  args: [jobId, evidenceHash, evidenceUriHash],
  ...fee,
}), "Evidence anchored");
const payoutReceipt = await wait(await residentWallet.writeContract({
  address: contract,
  abi,
  functionName: "complete",
  args: [jobId],
  ...fee,
}), "Payout completed");

deployment.latestLiveRound = {
  jobId: jobId.toString(),
  budgetUsdc: "0.01",
  resident: resident.address,
  helper: helper.address,
  evidenceHash,
  createTxHash: createReceipt.transactionHash,
  payoutTxHash: payoutReceipt.transactionHash,
  completedAt: new Date().toISOString(),
};
deployment.payoutTxHash = payoutReceipt.transactionHash;
fs.writeFileSync("public/arc-v4-deployment.json", `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify(deployment.latestLiveRound, null, 2));
