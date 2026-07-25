# LocalMate on Arc

LocalMate targets Arc Testnet (chain ID `5042002`) at
`https://rpc.testnet.arc.network`. USDC is the native gas token and the
explorer is `https://testnet.arcscan.app`.

## Implemented in this review build

- The wallet button requests and switches to the official Arc Testnet network.
- The product UI models an ERC-8183-style job lifecycle:
  `Open → Funded → Submitted → Completed / Rejected / Expired`.
- `contracts/LocalMateJobs.sol` implements USDC escrow, evaluator settlement,
  refunds after expiry, evidence hashes, and a bounded platform fee.
- `public/agent-metadata.json` is ready to be published and passed to the Arc
  ERC-8004 Identity Registry.
- Private addresses, task descriptions, images, and identity documents are
  intentionally kept offchain.

## Deployment checklist

1. Confirm the current Arc Testnet USDC address from the official contract
   address page.
2. Compile and test `LocalMateJobs.sol` with Foundry or Hardhat.
3. Deploy with a funded Arc Testnet wallet and set the treasury and fee.
4. Publish `agent-metadata.json` to a stable public or IPFS URI.
5. Register the matching agent through the official ERC-8004 Identity Registry.
6. Store the deployed job contract and agent ID as runtime environment values.
7. Replace the review dataset with indexed contract events.

No production private key belongs in this repository or in client-side code.
