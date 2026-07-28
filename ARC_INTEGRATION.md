# LocalMate on Arc

LocalMate runs on Arc Testnet (chain ID `5042002`) using
`https://rpc.testnet.arc.network`. USDC is used for escrow and settlement, and
transactions are verifiable through `https://testnet.arcscan.app`.

## Implemented

- Circle User-Controlled Wallet uses Google social authentication through
  `@circle-fin/w3s-pw-web-sdk`.
- Circle creates or restores an SCA wallet on `ARC-TESTNET`; LocalMate displays
  its address and USDC balance without receiving a private key.
- Circle challenge execution is wired to V4 contract calls and signatures.
- External EVM wallets remain available through Reown AppKit.
- The product implements an ERC-8183-style lifecycle:
  `Open -> Funded -> Submitted -> Completed / Rejected / Disputed`.
- `contracts/LocalMateJobsV4.sol` implements USDC escrow, Circle SCA/EOA
  signature verification, evaluator settlement, refunds, evidence hashes, and
  a bounded platform fee.
- Private addresses, task descriptions, identity documents and evidence files
  stay off-chain; only the required hashes and settlement state are anchored.

## Current deployment

- Contract: `LocalMateJobsV4`
- Address: `0x496d1ed6cd0bd0d0c426e5b12683a4daf93b3cef`
- Deployment proof: `public/arc-v4-deployment.json`
- Live app: `https://localmate-nine.vercel.app`

## Verification status

The V4 contract lifecycle and USDC payout have been verified on-chain with two
funded Arc Testnet EOA wallets. Circle User-Controlled Wallet onboarding,
wallet creation/recovery, address lookup, balance lookup and transaction
challenge adapters are live. A complete Circle-wallet-signed lifecycle should
only be labelled verified after its Circle transaction hashes are captured on
Arcscan.

No production private key belongs in this repository or in client-side code.
