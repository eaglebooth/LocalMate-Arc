import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("uses the current LocalMateJobsV4 deployment everywhere active", async () => {
  const [page, readme, architecture, deploymentText] = await Promise.all([
    source("app/page.tsx"),
    source("README.md"),
    source("ARCHITECTURE.md"),
    source("public/arc-v4-deployment.json"),
  ]);
  const deployment = JSON.parse(deploymentText);

  assert.equal(deployment.version, "V4");
  assert.equal(
    deployment.contractAddress,
    "0x496d1ed6cd0bd0d0c426e5b12683a4daf93b3cef",
  );
  assert.equal(deployment.supportsCircleSCA, true);
  assert.match(page, /arc-v4-deployment\.json/);
  assert.match(page, /const v4Abi =/);
  assert.doesNotMatch(page, /deploymentV3|v3Abi|arc-v3-deployment/);
  assert.match(readme, new RegExp(deployment.contractAddress, "i"));
  assert.match(architecture, new RegExp(deployment.contractAddress, "i"));
});

test("contains a real Circle User-Controlled Wallet integration", async () => {
  const [modal, route, session, contract, readme] = await Promise.all([
    source("app/CircleWalletModal.tsx"),
    source("app/api/circle/route.ts"),
    source("app/circle-wallet-session.ts"),
    source("contracts/LocalMateJobsV4.sol"),
    source("README.md"),
  ]);

  assert.match(modal, /@circle-fin\/w3s-pw-web-sdk/);
  assert.match(modal, /SocialLoginProvider\.GOOGLE/);
  assert.match(modal, /initializeUser/);
  assert.match(route, /blockchains:\s*\["ARC-TESTNET"\]/);
  assert.match(route, /\/v1\/w3s\/user\/transactions\/contractExecution/);
  assert.match(session, /executeCircleChallenge/);
  assert.match(contract, /interface IERC1271/);
  assert.match(contract, /IERC1271\.isValidSignature/);
  assert.match(readme, /Circle User-Controlled Wallet/);
});

test("keeps Circle claims aligned with verified onchain evidence", async () => {
  const [readme, deploymentText] = await Promise.all([
    source("README.md"),
    source("public/arc-v4-deployment.json"),
  ]);
  const deployment = JSON.parse(deploymentText);

  assert.match(deployment.payoutTxHash, /^0x[a-f0-9]{64}$/i);
  assert.match(deployment.latestLiveRound.createTxHash, /^0x[a-f0-9]{64}$/i);
  assert.match(
    readme,
    /complete Circle-wallet-signed lifecycle will only be marked\s+verified/i,
  );
});

test("shares job descriptions across browsers with Arc hash integrity", async () => {
  const [page, route] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/jobs/route.ts"),
  ]);

  assert.match(page, /publishSharedJobTask/);
  assert.match(page, /loadSharedJobTask/);
  assert.match(route, /keccak256\(toBytes\(item\.task\)\)/);
  assert.match(route, /requirementsHash\.toLowerCase\(\)/);
});
