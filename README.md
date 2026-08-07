# LocalMate

LocalMate is a neighborhood-services marketplace with programmable USDC
escrow on Arc. Residents fund a job, helpers apply with a wallet signature,
the selected helper anchors completion evidence, and the resident approves,
rejects or disputes settlement.

## Live Arc integration

- Network: Arc Testnet (`5042002`)
- Contract: `LocalMateJobsV4`
- Address: `0x496d1ed6cd0bd0d0c426e5b12683a4daf93b3cef`
- Settlement asset: Arc USDC
- Explorer:
  https://testnet.arcscan.app/address/0x496d1ed6cd0bd0d0c426e5b12683a4daf93b3cef

The V4 test suite verified:

- signed provider consent and forged-signature rejection;
- job creation and USDC escrow funding;
- evidence hash and evidence URI hash anchoring;
- exact provider payout and platform fee;
- dispute settlement with a configurable split;
- cancellation and complete escrow refund;
- zero residual escrow after the test scenarios.

The detailed deployment proof is stored in
`public/arc-v4-deployment.json`.

## Circle User-Controlled Wallet

LocalMate integrates Circle Wallets as a real onboarding and transaction path,
not only as a visual mock:

- Google social login is handled by Circle's User-Controlled Wallet Web SDK.
- Circle creates or restores a user-owned SCA wallet on `ARC-TESTNET`.
- The frontend loads the Circle wallet address and USDC balance through the
  authenticated Circle Wallets API.
- Users authorize contract executions through Circle challenge and
  Confirmation UI flows; LocalMate never receives a wallet private key.
- The frontend has a Circle contract-execution adapter for V4 job creation,
  USDC approval, escrow funding, evidence submission and settlement.
- `LocalMateJobsV4` accepts both ordinary EOA signatures and Circle SCA
  signatures through ERC-1271 verification.

Circle Wallet onboarding has created a real Arc Testnet user wallet. The
repository also contains a verified V4 lifecycle completed with funded EOA
test wallets. A complete Circle-wallet-signed lifecycle will only be marked
verified after its Circle transaction hashes are recorded on Arcscan.

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
- `app/api/evidence/route.ts`: Vercel Blob evidence upload and retrieval
- `worker/index.ts`: optional Cloudflare R2 evidence backend
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
- shared Vercel Blob evidence previews verified against the Arc SHA-256 hash
- cross-browser signed application exchange through Vercel Blob, with the
  selected signature verified by LocalMateJobsV4 before assignment
- payout, refund and dispute settlement
- Circle User-Controlled Wallet onboarding with Google
- Circle Arc Testnet wallet creation/recovery, address and USDC balance
- Circle contract-execution and signing adapter
- EOA and Circle SCA signature support in `LocalMateJobsV4`

Latest verified live round:

- Job `#3` funded with `7 USDC` by Circle Resident
  `0x2606...146f`;
- Circle Helper `0xd10b...4d45` signed, was assigned and anchored evidence
  hash `0x9bc82e...b23254`;
- Resident approved settlement: Helper received `6.825 USDC` and the
  `0.175 USDC` platform fee was transferred on Arc Testnet;
- payout transaction:
  `0x10987ac546be7c3890628ad9d35b9403dea3d2c21e272ec9fd71f0450b9f39a0`.

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
- [x] Public production deployment
- [x] Public GitHub repository
- [ ] Three-minute pitch and demo video
- [ ] Final submission links

This repository is a hackathon MVP. The contract has not received a production
security audit.
