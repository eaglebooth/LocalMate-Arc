# LocalMate

LocalMate is a neighborhood-services marketplace with programmable USDC
escrow on Arc. Residents fund a job, helpers apply with a wallet signature,
the selected helper anchors completion evidence, and the resident approves,
rejects or disputes settlement.

## Live Arc integration

- Network: Arc Testnet (`5042002`)
- Contract: `LocalMateJobsV4`
- Address: `0xfec759cb31f16df8714ed847de92ae9300e4cc36`
- Settlement asset: Arc USDC
- Explorer:
  https://testnet.arcscan.app/address/0xfec759cb31f16df8714ed847de92ae9300e4cc36

The V4 test suite verified:

- signed provider consent and forged-signature rejection;
- job creation and USDC escrow funding;
- evidence hash and evidence URI hash anchoring;
- exact provider payout and platform fee;
- dispute settlement with a configurable split;
- cancellation and complete escrow refund;
- zero residual escrow after the test scenarios.

The detailed deployment proof is stored in
`public/arc-v3-deployment.json`.

## User journey

1. A resident connects a wallet, writes a task and chooses the budget.
2. LocalMate creates and funds a V4 job on Arc.
3. Helpers discover funded jobs and apply with a wallet signature.
4. The resident chooses an applicant; V4 verifies EOA or Circle SCA signed consent.
5. The helper uploads a photo, video or PDF deliverable.
6. The file stays off-chain while its content hash and URI hash are recorded on
   Arc.
7. The resident approves payout, rejects and receives a refund, or opens a
   dispute for evaluator settlement.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Verification:

```bash
npm run lint
npm run build
```

The live deployment test can be run with funded Arc Testnet wallets:

```bash
npm run arc:v3-test
npm run arc:v4-test
```

Never commit test or production private keys.

## Repository map

- `app/page.tsx`: Resident and Helper product flows
- `contracts/LocalMateJobsV4.sol`: Circle SCA-compatible escrow and settlement contract
- `worker/index.ts`: evidence upload and retrieval
- `scripts/deploy-v4-and-test.mjs`: Arc deployment and end-to-end contract test
- `ARCHITECTURE.md`: current architecture and planned Agentic Economy modules
- `ARC_INTEGRATION.md`: Arc configuration and integration notes

## Honest integration status

Live:

- Arc Testnet
- USDC escrow
- V4 job lifecycle
- wallet-signed applications
- evidence anchoring
- payout, refund and dispute settlement

Planned, not presented as live:

- ERC-8004 agent registration and reputation
- Circle Gateway/x402 nanopayments
- official ERC-8183 reference contract integration

LocalMate V4 follows an ERC-8183-style lifecycle but includes custom application
consent, evidence and dispute extensions. It should not be described as the
official ERC-8183 reference implementation.

## Hackathon submission checklist

- [x] Functional frontend
- [x] Functional evidence backend
- [x] Contract deployed on Arc Testnet
- [x] End-to-end USDC settlement transactions
- [x] Architecture documentation
- [ ] Public production deployment
- [ ] Public GitHub repository
- [ ] Three-minute pitch and demo video
- [ ] Final submission links

This repository is a hackathon MVP. The contract has not received a production
security audit.
