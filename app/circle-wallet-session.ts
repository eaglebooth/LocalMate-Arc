"use client";

import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type {
  ChallengeResult,
  SignMessageResult,
  SignTransactionResult,
} from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

export type CircleSession = {
  sdk: W3SSdk;
  userToken: string;
  walletId: string;
  walletAddress: string;
};

let activeSession: CircleSession | null = null;

export function setCircleWalletSession(session: CircleSession) {
  activeSession = session;
}

export function getCircleWalletSession() {
  return activeSession;
}

export function clearCircleWalletSession() {
  activeSession = null;
}

export async function circleAction(body: Record<string, unknown>) {
  const response = await fetch("/api/circle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || "Circle Wallet request failed.");
  }
  return data;
}

export function executeCircleChallenge(
  sdk: W3SSdk,
  challengeId: string,
): Promise<ChallengeResult | SignMessageResult | SignTransactionResult> {
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error, result) => {
      if (error) {
        reject(new Error(error.message || "Circle approval was cancelled."));
        return;
      }
      if (!result) {
        reject(new Error("Circle did not return a challenge result."));
        return;
      }
      resolve(result);
    });
  });
}
