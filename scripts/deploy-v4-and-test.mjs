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
const BUDGET = 10_000n;
const FEE_BPS = 250;

function key(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

const owner = privateKeyToAccount(key("OWNER_PRIVATE_KEY"));
const helper = privateKeyToAccount(key("HELPER_PRIVATE_KEY"));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(RPC) });
const helperWallet = createWalletClient({ account: helper, chain: arcTestnet, transport: http(RPC) });
const fee = { maxFeePerGas: parseUnits("20", 9), maxPriorityFeePerGas: parseUnits("1", 9) };

const source = fs.readFileSync(path.resolve("contracts/LocalMateJobsV4.sol"), "utf8");
const compilation = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "LocalMateJobsV4.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
})));
const errors = (compilation.errors ?? []).filter((item) => item.severity === "error");
if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
const artifact = compilation.contracts["LocalMateJobsV4.sol"].LocalMateJobsV4;
const abi = artifact.abi;
const bytecode = `0x${artifact.evm.bytecode.object}`;
const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
];

async function wait(hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

const deployReceipt = await wait(await ownerWallet.deployContract({
  abi,
  bytecode,
  args: [USDC, owner.address, FEE_BPS, 60],
  ...fee,
}), "V4 deployed");
const contractAddress = deployReceipt.contractAddress;
if (!contractAddress) throw new Error("Missing V4 contract address");

const block = await publicClient.getBlock();
const requirementsHash = keccak256(toBytes("LocalMate V4 EOA and Circle SCA compatibility test"));
const createReceipt = await wait(await ownerWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "createJob",
  args: [owner.address, BUDGET, block.timestamp + 3_600n, requirementsHash],
  ...fee,
}), "Test job created");
const jobId = parseEventLogs({ abi, logs: createReceipt.logs, eventName: "JobCreated" })[0].args.jobId;

await wait(await ownerWallet.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "approve",
  args: [contractAddress, BUDGET],
  ...fee,
}), "Test USDC approved");
await wait(await ownerWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "fund",
  args: [jobId],
  ...fee,
}), "Test escrow funded");

const digest = await publicClient.readContract({
  address: contractAddress,
  abi,
  functionName: "applicationDigest",
  args: [jobId, helper.address],
});
const signature = await helper.signMessage({ message: { raw: digest } });
await wait(await ownerWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "assignProvider",
  args: [jobId, helper.address, signature],
  ...fee,
}), "EOA application verified");

await wait(await helperWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "submitEvidence",
  args: [jobId, keccak256(toBytes("evidence")), keccak256(toBytes("r2://localmate/evidence"))],
  ...fee,
}), "Evidence anchored");
const payoutReceipt = await wait(await ownerWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "complete",
  args: [jobId],
  ...fee,
}), "Payout completed");

const deployment = {
  network: "Arc Testnet",
  chainId: 5042002,
  contractAddress,
  usdcAddress: USDC,
  treasury: owner.address,
  feeBps: FEE_BPS,
  reviewPeriodSeconds: 60,
  deployedAt: new Date().toISOString(),
  deployTxHash: deployReceipt.transactionHash,
  testJobId: jobId.toString(),
  payoutTxHash: payoutReceipt.transactionHash,
  version: "V4",
  supportsCircleSCA: true,
};
fs.writeFileSync("public/arc-v3-deployment.json", `${JSON.stringify(deployment, null, 2)}\n`);
fs.writeFileSync("public/arc-v4-abi.json", `${JSON.stringify(abi, null, 2)}\n`);
console.log(JSON.stringify(deployment, null, 2));
