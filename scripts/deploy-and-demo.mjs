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

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.drpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

const owner = privateKeyToAccount(required("OWNER_PRIVATE_KEY"));
const helper = privateKeyToAccount(required("HELPER_PRIVATE_KEY"));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) });
const ownerClient = createWalletClient({ account: owner, chain: arcTestnet, transport: http(RPC_URL) });
const helperClient = createWalletClient({ account: helper, chain: arcTestnet, transport: http(RPC_URL) });

const source = fs.readFileSync(path.resolve("contracts/LocalMateJobs.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "LocalMateJobs.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (compiled.errors ?? []).filter((item) => item.severity === "error");
if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
const artifact = compiled.contracts["LocalMateJobs.sol"].LocalMateJobs;
const abi = artifact.abi;
const bytecode = `0x${artifact.evm.bytecode.object}`;

async function wait(hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

console.log(`Owner: ${owner.address}`);
console.log(`Helper / validator: ${helper.address}`);

const ownerBalance = await publicClient.getBalance({ address: owner.address });
const helperBalance = await publicClient.getBalance({ address: helper.address });
console.log(`Owner native USDC: ${ownerBalance}`);
console.log(`Helper native USDC: ${helperBalance}`);

let deployHash = process.env.DEPLOY_TX || null;
let contractAddress = process.env.EXISTING_CONTRACT;
if (!contractAddress) {
  deployHash = await ownerClient.deployContract({
    abi,
    bytecode,
    args: [USDC, owner.address, 250],
    maxFeePerGas: parseUnits("20", 9),
    maxPriorityFeePerGas: parseUnits("1", 9),
  });
  const deployment = await wait(deployHash, "Contract deployed");
  contractAddress = deployment.contractAddress;
  if (!contractAddress) throw new Error("No contract address in deployment receipt");
} else {
  console.log(`Using deployed contract: ${contractAddress}`);
}

let createHash = process.env.CREATE_TX || null;
let jobId = process.env.EXISTING_JOB_ID ? BigInt(process.env.EXISTING_JOB_ID) : null;
if (jobId === null) {
  const requirementsHash = keccak256(toBytes("Dog walk · 18:00–19:00 · Sunrise Riverside · Demo"));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  createHash = await ownerClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "createJob",
    args: [helper.address, owner.address, 1_000_000n, expiresAt, requirementsHash],
    maxFeePerGas: parseUnits("20", 9),
    maxPriorityFeePerGas: parseUnits("1", 9),
  });
  const createReceipt = await wait(createHash, "Job created");
  const created = parseEventLogs({ abi, logs: createReceipt.logs, eventName: "JobCreated" })[0];
  jobId = created.args.jobId;
} else {
  console.log(`Resuming job: ${jobId}`);
}

const usdcAbi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
];
await wait(
  await ownerClient.writeContract({
    address: USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [contractAddress, 1_000_000n],
    maxFeePerGas: parseUnits("20", 9),
    maxPriorityFeePerGas: parseUnits("1", 9),
  }),
  "USDC approved",
);
await wait(
  await ownerClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "fund",
    args: [jobId],
    maxFeePerGas: parseUnits("20", 9),
    maxPriorityFeePerGas: parseUnits("1", 9),
  }),
  "Job funded",
);
const deliverableHash = keccak256(toBytes("Demo walk completed · evidence stored offchain"));
await wait(
  await helperClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "submit",
    args: [jobId, deliverableHash],
    maxFeePerGas: parseUnits("20", 9),
    maxPriorityFeePerGas: parseUnits("1", 9),
  }),
  "Work submitted",
);
const completeHash = await ownerClient.writeContract({
  address: contractAddress,
  abi,
  functionName: "complete",
  args: [jobId],
  maxFeePerGas: parseUnits("20", 9),
  maxPriorityFeePerGas: parseUnits("1", 9),
});
await wait(completeHash, "Job completed");

const metadataUrl = process.env.AGENT_METADATA_URL || "https://localmate.example/agent-metadata.json";
const identityAbi = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "metadataURI", type: "string" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
  },
];
const registerHash = await ownerClient.writeContract({
  address: IDENTITY_REGISTRY,
  abi: identityAbi,
  functionName: "register",
  args: [metadataUrl],
  maxFeePerGas: parseUnits("20", 9),
  maxPriorityFeePerGas: parseUnits("1", 9),
});
const registerReceipt = await wait(registerHash, "Agent registered");
const transfer = parseEventLogs({ abi: identityAbi, logs: registerReceipt.logs, eventName: "Transfer" })
  .find((log) => log.args.to?.toLowerCase() === owner.address.toLowerCase());
const agentId = transfer?.args.tokenId;

let reputationHash = null;
if (agentId !== undefined) {
  const feedbackHash = keccak256(toBytes("localmate_demo_job_completed"));
  const reputationAbi = [
    {
      name: "giveFeedback",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "agentId", type: "uint256" },
        { name: "value", type: "int128" },
        { name: "valueDecimals", type: "uint8" },
        { name: "tag1", type: "string" },
        { name: "tag2", type: "string" },
        { name: "endpoint", type: "string" },
        { name: "feedbackURI", type: "string" },
        { name: "feedbackHash", type: "bytes32" },
      ],
      outputs: [],
    },
  ];
  reputationHash = await helperClient.writeContract({
    address: REPUTATION_REGISTRY,
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [agentId, 95n, 0, "successful_job", "local_services", "", "", feedbackHash],
    maxFeePerGas: parseUnits("20", 9),
    maxPriorityFeePerGas: parseUnits("1", 9),
  });
  await wait(reputationHash, "Agent reputation recorded");
}

const output = {
  network: "Arc Testnet",
  chainId: 5042002,
  contractAddress,
  jobId: jobId.toString(),
  agentId: agentId?.toString() ?? null,
  owner: owner.address,
  helper: helper.address,
  transactions: {
    deployment: deployHash,
    create: createHash,
    complete: completeHash,
    agentRegistration: registerHash,
    reputation: reputationHash,
  },
};
fs.writeFileSync("public/arc-deployment.json", JSON.stringify(output, null, 2));
console.log("Saved public/arc-deployment.json");
