import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  parseUnits,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const RPC = process.env.ARC_RPC_URL || "https://rpc.quicknode.testnet.arc.network";
const AGENTIC_COMMERCE = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const USDC = "0x3600000000000000000000000000000000000000";
const BUDGET = 1_000_000n;

const key = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
};

const client = privateKeyToAccount(key("OWNER_PRIVATE_KEY"));
const provider = privateKeyToAccount(key("HELPER_PRIVATE_KEY"));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const clientWallet = createWalletClient({ account: client, chain: arcTestnet, transport: http(RPC) });
const providerWallet = createWalletClient({ account: provider, chain: arcTestnet, transport: http(RPC) });
const fee = {
  maxFeePerGas: parseUnits("20", 9),
  maxPriorityFeePerGas: parseUnits("1", 9),
};

const abi = [
  {
    name: "createJob", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ], outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    name: "setBudget", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [],
  },
  {
    name: "fund", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [],
  },
  {
    name: "submit", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverable", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [],
  },
  {
    name: "complete", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }, { name: "reason", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [],
  },
  {
    name: "getJob", type: "function", stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{
      name: "job", type: "tuple", components: [
        { name: "id", type: "uint256" }, { name: "client", type: "address" },
        { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
        { name: "description", type: "string" }, { name: "budget", type: "uint256" },
        { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" },
        { name: "hook", type: "address" },
      ],
    }],
  },
  {
    type: "event", name: "JobCreated",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: true, name: "client", type: "address" },
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "evaluator", type: "address" },
      { indexed: false, name: "expiredAt", type: "uint256" },
      { indexed: false, name: "hook", type: "address" },
    ],
  },
];
const erc20Abi = [{
  name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}];

async function wait(hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

const latest = await publicClient.getBlock();
const createHash = await clientWallet.writeContract({
  address: AGENTIC_COMMERCE, abi, functionName: "createJob",
  args: [provider.address, client.address, latest.timestamp + 3600n, "LocalMate verified dog-walk service", "0x0000000000000000000000000000000000000000"],
  ...fee,
});
const createReceipt = await wait(createHash, "Official ERC-8183 job created");
let jobId;
for (const log of createReceipt.logs) {
  try {
    const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
    if (event.eventName === "JobCreated") jobId = event.args.jobId;
  } catch {}
}
if (jobId === undefined) throw new Error("JobCreated event not found");

const budgetHash = await providerWallet.writeContract({
  address: AGENTIC_COMMERCE, abi, functionName: "setBudget", args: [jobId, BUDGET, "0x"], ...fee,
});
await wait(budgetHash, "Provider set budget");
await wait(await clientWallet.writeContract({
  address: USDC, abi: erc20Abi, functionName: "approve", args: [AGENTIC_COMMERCE, BUDGET], ...fee,
}), "USDC approved");
const fundHash = await clientWallet.writeContract({
  address: AGENTIC_COMMERCE, abi, functionName: "fund", args: [jobId, "0x"], ...fee,
});
await wait(fundHash, "Official escrow funded");
const submitHash = await providerWallet.writeContract({
  address: AGENTIC_COMMERCE, abi, functionName: "submit",
  args: [jobId, keccak256(toHex("LocalMate job evidence bundle")), "0x"], ...fee,
});
await wait(submitHash, "Deliverable submitted");
const completeHash = await clientWallet.writeContract({
  address: AGENTIC_COMMERCE, abi, functionName: "complete",
  args: [jobId, keccak256(toHex("Resident approved completed work")), "0x"], ...fee,
});
await wait(completeHash, "Official ERC-8183 job completed");

const output = {
  contractAddress: AGENTIC_COMMERCE,
  jobId: jobId.toString(),
  status: "Completed",
  budget: "1.00 USDC",
  transactions: { create: createHash, setBudget: budgetHash, fund: fundHash, submit: submitHash, complete: completeHash },
};
await import("node:fs").then(({ writeFileSync }) =>
  writeFileSync("public/erc8183-deployment.json", JSON.stringify(output, null, 2)),
);
console.log(`Official job ${jobId} completed`);
