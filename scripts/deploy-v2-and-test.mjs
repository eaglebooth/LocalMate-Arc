import fs from "node:fs";
import path from "node:path";
import solc from "solc";
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

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";
const BUDGET = 100_000n;
const FEE_BPS = 250;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

const client = privateKeyToAccount(required("OWNER_PRIVATE_KEY"));
const provider = privateKeyToAccount(required("HELPER_PRIVATE_KEY"));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) });
const clientWallet = createWalletClient({ account: client, chain: arcTestnet, transport: http(RPC_URL) });
const providerWallet = createWalletClient({ account: provider, chain: arcTestnet, transport: http(RPC_URL) });

const source = fs.readFileSync(path.resolve("contracts/LocalMateJobsV2.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "LocalMateJobsV2.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
const compilerErrors = (compiled.errors ?? []).filter((item) => item.severity === "error");
if (compilerErrors.length) throw new Error(compilerErrors.map((item) => item.formattedMessage).join("\n"));
const artifact = compiled.contracts["LocalMateJobsV2.sol"].LocalMateJobsV2;
const abi = artifact.abi;
const bytecode = `0x${artifact.evm.bytecode.object}`;

const erc20Abi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const fee = {
  maxFeePerGas: parseUnits("20", 9),
  maxPriorityFeePerGas: parseUnits("1", 9),
};

async function wait(hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

async function expectRevert(promise, label) {
  try {
    const hash = await promise;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      console.log(`Expected revert passed: ${label}`);
      return;
    }
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (`${error}`.includes("unexpectedly succeeded")) throw error;
    console.log(`Expected revert passed: ${label}`);
  }
}

console.log(`Client: ${client.address}`);
console.log(`Provider: ${provider.address}`);

let deployHash = process.env.DEPLOY_TX ?? null;
let contractAddress = process.env.EXISTING_V2_CONTRACT ?? null;
if (!contractAddress) {
  deployHash = await clientWallet.deployContract({
    abi,
    bytecode,
    args: [USDC, client.address, FEE_BPS],
    ...fee,
  });
  const deployReceipt = await wait(deployHash, "V2 contract deployed");
  contractAddress = deployReceipt.contractAddress;
  if (!contractAddress) throw new Error("Deployment receipt did not include a contract address");
} else {
  console.log(`Using deployed V2 contract: ${contractAddress}`);
}

const requirementsHash = keccak256(toBytes("LocalMate V2 funded job board test"));
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
const createHash = await clientWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "createJob",
  args: [client.address, BUDGET, expiresAt, requirementsHash],
  ...fee,
});
const createReceipt = await wait(createHash, "Unassigned job created");
const created = parseEventLogs({ abi, logs: createReceipt.logs, eventName: "JobCreated" })[0];
const jobId = created.args.jobId;

await wait(
  await clientWallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [contractAddress, BUDGET],
    ...fee,
  }),
  "USDC approved",
);
const fundHash = await clientWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "fund",
  args: [jobId],
  ...fee,
});
await wait(fundHash, "Unassigned job funded");

const fundedJob = await publicClient.readContract({
  address: contractAddress,
  abi,
  functionName: "jobs",
  args: [jobId],
});
if (fundedJob[1] !== "0x0000000000000000000000000000000000000000" || fundedJob[5] !== 1) {
  throw new Error("Funded job invariant failed: provider must be empty and status must be Funded");
}

await expectRevert(
  providerWallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "assignProvider",
    args: [jobId, provider.address, keccak256(toBytes("unauthorized"))],
    ...fee,
  }),
  "non-client cannot assign provider",
);

const applicationHash = keccak256(toBytes("Provider opted in to scope, timing and budget"));
const assignHash = await clientWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "assignProvider",
  args: [jobId, provider.address, applicationHash],
  ...fee,
});
await wait(assignHash, "Applicant selected after funding");

await expectRevert(
  clientWallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "submit",
    args: [jobId, keccak256(toBytes("wrong submitter"))],
    ...fee,
  }),
  "non-provider cannot submit",
);

const deliverableHash = keccak256(toBytes("Completed task evidence stored offchain"));
const submitHash = await providerWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "submit",
  args: [jobId, deliverableHash],
  ...fee,
});
await wait(submitHash, "Provider submitted work");

await expectRevert(
  clientWallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "claimRefund",
    args: [jobId],
    ...fee,
  }),
  "submitted job cannot be refunded by client",
);

const providerBefore = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [provider.address],
});
const treasuryBefore = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [client.address],
});

const completeHash = await clientWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "complete",
  args: [jobId],
  ...fee,
});
await wait(completeHash, "Evaluator completed and paid out job");

const providerAfter = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [provider.address],
});
const treasuryAfter = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [client.address],
});
const escrowAfter = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [contractAddress],
});
const finalJob = await publicClient.readContract({
  address: contractAddress,
  abi,
  functionName: "jobs",
  args: [jobId],
});

const expectedFee = BUDGET * BigInt(FEE_BPS) / 10_000n;
const expectedProviderPayment = BUDGET - expectedFee;
if (providerAfter - providerBefore !== expectedProviderPayment) throw new Error("Provider payout mismatch");
if (treasuryAfter - treasuryBefore !== expectedFee) throw new Error("Treasury fee mismatch");
if (escrowAfter !== 0n) throw new Error("Escrow balance must be zero after completion");
if (finalJob[5] !== 4) throw new Error("Final status must be Completed");

await expectRevert(
  clientWallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "complete",
    args: [jobId],
    ...fee,
  }),
  "job cannot be paid twice",
);

const output = {
  network: "Arc Testnet",
  chainId: 5042002,
  version: "LocalMateJobsV2",
  contractAddress,
  jobId: jobId.toString(),
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
    doublePayoutReverted: true,
    escrowBalanceAfterCompletion: escrowAfter.toString(),
  },
  transactions: {
    deployment: deployHash,
    create: createHash,
    fund: fundHash,
    assign: assignHash,
    submit: submitHash,
    complete: completeHash,
  },
};

fs.writeFileSync("public/arc-v2-deployment.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
