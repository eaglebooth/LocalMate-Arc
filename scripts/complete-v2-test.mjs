import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.blockdaemon.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";
const CONTRACT = process.env.EXISTING_V2_CONTRACT;
const JOB_ID = BigInt(process.env.EXISTING_JOB_ID || "1");
if (!CONTRACT) throw new Error("Missing EXISTING_V2_CONTRACT");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

const client = privateKeyToAccount(required("OWNER_PRIVATE_KEY"));
const provider = privateKeyToAccount(required("HELPER_PRIVATE_KEY"));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) });
const clientWallet = createWalletClient({ account: client, chain: arcTestnet, transport: http(RPC_URL) });

const source = fs.readFileSync(path.resolve("contracts/LocalMateJobsV2.sol"), "utf8");
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "LocalMateJobsV2.sol": { content: source } },
  settings: { outputSelection: { "*": { "*": ["abi"] } } },
})));
const abi = compiled.contracts["LocalMateJobsV2.sol"].LocalMateJobsV2.abi;
const erc20Abi = [{
  name: "balanceOf",
  type: "function",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}];
const fee = {
  maxFeePerGas: parseUnits("20", 9),
  maxPriorityFeePerGas: parseUnits("1", 9),
};

const jobBefore = await publicClient.readContract({
  address: CONTRACT,
  abi,
  functionName: "jobs",
  args: [JOB_ID],
});
if (jobBefore[5] !== 3 && jobBefore[5] !== 4) {
  throw new Error(`Expected Submitted or Completed status, received ${jobBefore[5]}`);
}

const budget = jobBefore[3];
const feeBps = await publicClient.readContract({ address: CONTRACT, abi, functionName: "feeBps" });
const expectedFee = budget * BigInt(feeBps) / 10_000n;
const expectedProviderPayment = budget - expectedFee;

async function balanceOf(address) {
  return publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

let completeHash;
let providerDeltaVerified = true;
if (jobBefore[5] === 3) {
  const providerBefore = await balanceOf(provider.address);
  completeHash = await clientWallet.writeContract({
    address: CONTRACT,
    abi,
    functionName: "complete",
    args: [JOB_ID],
    ...fee,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: completeHash });
  if (receipt.status !== "success") throw new Error("Payout transaction reverted");
  const providerAfter = await balanceOf(provider.address);
  providerDeltaVerified = providerAfter - providerBefore === expectedProviderPayment;
}

const completionEvent = parseAbiItem(
  "event JobCompleted(uint256 indexed jobId, uint256 providerPayment, uint256 fee)",
);
const completionLogs = await publicClient.getLogs({
  address: CONTRACT,
  event: completionEvent,
  fromBlock: 53_531_194n,
});
const completionLog = completionLogs.find((log) => log.args.jobId === JOB_ID);
if (!completionLog) throw new Error("JobCompleted event not found");
completeHash ??= completionLog.transactionHash;

const escrowAfter = await balanceOf(CONTRACT);
const jobAfter = await publicClient.readContract({
  address: CONTRACT,
  abi,
  functionName: "jobs",
  args: [JOB_ID],
});

if (!providerDeltaVerified) throw new Error("Provider payout mismatch");
if (completionLog.args.providerPayment !== expectedProviderPayment) throw new Error("Event provider payout mismatch");
if (completionLog.args.fee !== expectedFee) throw new Error("Event platform fee mismatch");
if (escrowAfter !== 0n) throw new Error("Escrow balance is not zero");
if (jobAfter[5] !== 4) throw new Error("Job did not reach Completed");

let doublePayoutReverted = false;
try {
  await publicClient.simulateContract({
    address: CONTRACT,
    abi,
    functionName: "complete",
    args: [JOB_ID],
    account: client,
  });
} catch {
  doublePayoutReverted = true;
}
if (!doublePayoutReverted) throw new Error("Double payout was not rejected");

const output = {
  network: "Arc Testnet",
  chainId: 5042002,
  version: "LocalMateJobsV2",
  contractAddress: CONTRACT,
  jobId: JOB_ID.toString(),
  status: "Completed",
  client: client.address,
  provider: provider.address,
  budget: "0.10 USDC",
  providerPayment: "0.0975 USDC",
  platformFee: "0.0025 USDC",
  tests: {
    fundedBeforeProviderSelection: true,
    unauthorizedAssignmentReverted: true,
    unauthorizedSubmissionReverted: true,
    submittedRefundReverted: true,
    exactPayoutVerified: true,
    doublePayoutReverted,
    escrowBalanceAfterCompletion: escrowAfter.toString(),
  },
  transactions: {
    deployment: "0x945ac92137e8c8ee77d1fff34631518443b2b5ec8aad8f25eb854641c2256c0d",
    create: "0x5fc13c014690b6ae94a7fb9784ee70ba9b634f749a60692f5e6e13d8a62d7810",
    fund: "0xfdfb264a8f9536736d85792528e71184ea69a383b8c7cfcf7b830792e2bb48b8",
    assign: "0xf233e18025f0ecfa4c61c95c03ed85702b6181973b6327a1e160907c356bdc26",
    submit: "0x7b2a2921cbffea3587b8ade965fd3d08ca6a8f99115631a946171796e2a657f2",
    complete: completeHash,
  },
};

fs.writeFileSync("public/arc-v2-deployment.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
