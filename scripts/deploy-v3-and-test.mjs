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

const RPC = process.env.ARC_RPC_URL || "https://rpc.blockdaemon.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";
const PAYOUT_BUDGET = 100_000n;
const DISPUTE_BUDGET = 100_000n;
const CANCEL_BUDGET = 50_000n;
const FEE_BPS = 250;

function key(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

const client = privateKeyToAccount(key("OWNER_PRIVATE_KEY"));
const provider = privateKeyToAccount(key("HELPER_PRIVATE_KEY"));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const clientWallet = createWalletClient({ account: client, chain: arcTestnet, transport: http(RPC) });
const providerWallet = createWalletClient({ account: provider, chain: arcTestnet, transport: http(RPC) });
const fee = { maxFeePerGas: parseUnits("20", 9), maxPriorityFeePerGas: parseUnits("1", 9) };

const source = fs.readFileSync(path.resolve("contracts/LocalMateJobsV3.sol"), "utf8");
const compilation = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "LocalMateJobsV3.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
})));
const errors = (compilation.errors ?? []).filter((item) => item.severity === "error");
if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
const artifact = compilation.contracts["LocalMateJobsV3.sol"].LocalMateJobsV3;
const abi = artifact.abi;
const bytecode = `0x${artifact.evm.bytecode.object}`;
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

async function expectRevert(action, label) {
  try {
    await action();
  } catch {
    console.log(`Expected revert passed: ${label}`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

const deployHash = await clientWallet.deployContract({
  abi,
  bytecode,
  args: [USDC, client.address, FEE_BPS, 60],
  ...fee,
});
const deployReceipt = await wait(deployHash, "V3 deployed");
const contract = deployReceipt.contractAddress;
if (!contract) throw new Error("Missing V3 contract address");

async function createAndFund(label, budget) {
  const latest = await publicClient.getBlock();
  const requirementsHash = keccak256(toBytes(`${label} requirements and safety checklist`));
  const createHash = await clientWallet.writeContract({
    address: contract,
    abi,
    functionName: "createJob",
    args: [client.address, budget, latest.timestamp + 3_600n, requirementsHash],
    ...fee,
  });
  const receipt = await wait(createHash, `${label} created`);
  const jobId = parseEventLogs({ abi, logs: receipt.logs, eventName: "JobCreated" })[0].args.jobId;
  await wait(await clientWallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [contract, budget],
    ...fee,
  }), `${label} USDC approved`);
  const fundHash = await clientWallet.writeContract({
    address: contract,
    abi,
    functionName: "fund",
    args: [jobId],
    ...fee,
  });
  await wait(fundHash, `${label} funded`);
  return { jobId, createHash, fundHash };
}

async function signedApplication(jobId) {
  const digest = await publicClient.readContract({
    address: contract,
    abi,
    functionName: "applicationDigest",
    args: [jobId, provider.address],
  });
  return provider.signMessage({ message: { raw: digest } });
}

async function assign(jobId, signature, label) {
  const hash = await clientWallet.writeContract({
    address: contract,
    abi,
    functionName: "assignProvider",
    args: [jobId, provider.address, signature],
    ...fee,
  });
  await wait(hash, `${label} provider assigned`);
  return hash;
}

const payout = await createAndFund("Payout job", PAYOUT_BUDGET);
const badDigest = await publicClient.readContract({
  address: contract,
  abi,
  functionName: "applicationDigest",
  args: [payout.jobId, provider.address],
});
const badSignature = await client.signMessage({ message: { raw: badDigest } });
await expectRevert(
  () => clientWallet.writeContract({
    address: contract,
    abi,
    functionName: "assignProvider",
    args: [payout.jobId, provider.address, badSignature],
    ...fee,
  }),
  "client cannot forge provider consent",
);
const payoutAssignHash = await assign(payout.jobId, await signedApplication(payout.jobId), "Payout job");
const evidenceHash = keccak256(toBytes("sha256:file-bytes:localmate-v3-demo"));
const evidenceUriHash = keccak256(toBytes("ipfs://bafy-localmate-v3-evidence"));
const payoutSubmitHash = await providerWallet.writeContract({
  address: contract,
  abi,
  functionName: "submitEvidence",
  args: [payout.jobId, evidenceHash, evidenceUriHash],
  ...fee,
});
await wait(payoutSubmitHash, "Evidence anchored");
const payoutCompleteHash = await clientWallet.writeContract({
  address: contract,
  abi,
  functionName: "complete",
  args: [payout.jobId],
  ...fee,
});
const payoutReceipt = await wait(payoutCompleteHash, "Evidence approved and payout completed");
const completed = parseEventLogs({ abi, logs: payoutReceipt.logs, eventName: "JobCompleted" })[0];
if (completed.args.providerPayment !== 97_500n || completed.args.fee !== 2_500n) {
  throw new Error("V3 payout amounts do not match");
}

const dispute = await createAndFund("Dispute job", DISPUTE_BUDGET);
const disputeAssignHash = await assign(dispute.jobId, await signedApplication(dispute.jobId), "Dispute job");
const disputeSubmitHash = await providerWallet.writeContract({
  address: contract,
  abi,
  functionName: "submitEvidence",
  args: [
    dispute.jobId,
    keccak256(toBytes("disputed evidence bytes")),
    keccak256(toBytes("ipfs://disputed-evidence")),
  ],
  ...fee,
});
await wait(disputeSubmitHash, "Dispute evidence submitted");
const disputeRaiseHash = await providerWallet.writeContract({
  address: contract,
  abi,
  functionName: "raiseDispute",
  args: [dispute.jobId, keccak256(toBytes("Scope changed after work began"))],
  ...fee,
});
await wait(disputeRaiseHash, "Dispute raised");
const disputeResolveHash = await clientWallet.writeContract({
  address: contract,
  abi,
  functionName: "resolveDispute",
  args: [dispute.jobId, 5_000],
  ...fee,
});
const disputeReceipt = await wait(disputeResolveHash, "Dispute resolved 50/50");
const resolved = parseEventLogs({ abi, logs: disputeReceipt.logs, eventName: "DisputeResolved" })[0];
if (
  resolved.args.providerPayment !== 48_750n ||
  resolved.args.clientRefund !== 50_000n ||
  resolved.args.fee !== 1_250n
) throw new Error("Dispute split amounts do not match");

const cancellation = await createAndFund("Cancellation job", CANCEL_BUDGET);
const cancelHash = await clientWallet.writeContract({
  address: contract,
  abi,
  functionName: "cancelUnassigned",
  args: [cancellation.jobId],
  ...fee,
});
await wait(cancelHash, "Unassigned job cancelled and refunded");

const escrowBalance = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [contract],
});
if (escrowBalance !== 0n) throw new Error("V3 escrow balance must be zero after tests");

const output = {
  network: "Arc Testnet",
  chainId: 5042002,
  version: "LocalMateJobsV3",
  contractAddress: contract,
  reviewPeriodSeconds: 60,
  tests: {
    providerConsentSignatureVerified: true,
    forgedConsentRejected: true,
    evidenceHashAnchored: true,
    evidenceUriHashAnchored: true,
    exactPayoutVerified: true,
    disputeSplitVerified: true,
    unassignedRefundVerified: true,
    escrowBalanceAfterTests: escrowBalance.toString(),
  },
  jobs: {
    payout: payout.jobId.toString(),
    dispute: dispute.jobId.toString(),
    cancellation: cancellation.jobId.toString(),
  },
  transactions: {
    deployment: deployHash,
    payoutCreate: payout.createHash,
    payoutFund: payout.fundHash,
    payoutAssign: payoutAssignHash,
    payoutSubmit: payoutSubmitHash,
    payoutComplete: payoutCompleteHash,
    disputeCreate: dispute.createHash,
    disputeFund: dispute.fundHash,
    disputeAssign: disputeAssignHash,
    disputeSubmit: disputeSubmitHash,
    disputeRaise: disputeRaiseHash,
    disputeResolve: disputeResolveHash,
    cancellationCreate: cancellation.createHash,
    cancellationFund: cancellation.fundHash,
    cancellationRefund: cancelHash,
  },
};
fs.writeFileSync("public/legacy-arc-v3-deployment.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
