"use client";

import { useEffect, useRef, useState } from "react";
import { getCookie, setCookie } from "cookies-next/client";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

type CircleWallet = {
  id: string;
  address: string;
  blockchain: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onExternalWallet: () => void;
  onConnected: (wallet: CircleWallet, balance: string | null) => void;
};

async function circleAction(body: Record<string, unknown>) {
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

export default function CircleWalletModal({
  open,
  onClose,
  onExternalWallet,
  onConnected,
}: Props) {
  const sdk = useRef<W3SSdk | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

    async function loadWallets(userToken: string) {
      const walletData = await circleAction({ action: "listWallets", userToken });
      const wallet = (walletData.wallets as CircleWallet[] | undefined)?.find(
        (item) => item.blockchain === "ARC-TESTNET",
      );
      if (!wallet) throw new Error("No Arc Testnet Circle wallet was found.");
      const balanceData = await circleAction({
        action: "getTokenBalance",
        userToken,
        walletId: wallet.id,
      });
      const balances = (balanceData.tokenBalances ?? []) as Array<{
        amount?: string;
        token?: { symbol?: string; name?: string };
      }>;
      const usdc = balances.find(
        (item) =>
          item.token?.symbol?.startsWith("USDC") ||
          item.token?.name?.includes("USDC"),
      );
      onConnected(wallet, usdc?.amount ?? null);
      onClose();
    }

    async function initialize(userToken: string, encryptionKey: string) {
      if (!sdk.current) return;
      sdk.current.setAuthentication({ userToken, encryptionKey });
      setBusy("Creating your secure Arc wallet...");
      try {
        const result = await circleAction({ action: "initializeUser", userToken });
        if (result.challengeId) {
          sdk.current.execute(result.challengeId, async (challengeError) => {
            if (challengeError) {
              setError(challengeError.message || "Wallet creation was cancelled.");
              setBusy("");
              return;
            }
            await loadWallets(userToken);
          });
        } else {
          await loadWallets(userToken);
        }
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : "Wallet initialization failed.";
        if (message.includes("155106") || message.toLowerCase().includes("already initialized")) {
          await loadWallets(userToken);
        } else {
          setError(message);
          setBusy("");
        }
      }
    }

    async function setup() {
      if (!appId || !googleClientId) {
        setError("Circle Wallet environment variables are missing.");
        return;
      }
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const instance = new W3SSdk(
        {
          appSettings: { appId },
          loginConfigs: {
            deviceToken: String(getCookie("circle.deviceToken") ?? ""),
            deviceEncryptionKey: String(getCookie("circle.deviceEncryptionKey") ?? ""),
            google: {
              clientId: googleClientId,
              redirectUri: window.location.origin,
              selectAccountPrompt: true,
            },
          },
        },
        (loginError, result) => {
          if (cancelled) return;
          if (loginError || !result) {
            setError(loginError?.message || "Google login did not complete.");
            setBusy("");
            return;
          }
          void initialize(result.userToken, result.encryptionKey);
        },
      );
      sdk.current = instance;
      setReady(true);
    }

    void setup();
    return () => {
      cancelled = true;
    };
  }, [onClose, onConnected]);

  async function continueWithGoogle() {
    if (!sdk.current) return;
    setError("");
    setBusy("Opening Google...");
    try {
      const deviceId = await sdk.current.getDeviceId();
      const token = await circleAction({ action: "createDeviceToken", deviceId });
      setCookie("circle.deviceToken", token.deviceToken, { maxAge: 900 });
      setCookie("circle.deviceEncryptionKey", token.deviceEncryptionKey, { maxAge: 900 });
      sdk.current.updateConfigs({
        appSettings: { appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "" },
        loginConfigs: {
          deviceToken: token.deviceToken,
          deviceEncryptionKey: token.deviceEncryptionKey,
          google: {
            clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
            redirectUri: window.location.origin,
            selectAccountPrompt: true,
          },
        },
      });
      await sdk.current.performLogin(SocialLoginProvider.GOOGLE);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Google login failed.");
      setBusy("");
    }
  }

  if (!open) return null;

  return (
    <div className="circle-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="circle-wallet-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="circle-modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="circle-label">CIRCLE USER-CONTROLLED WALLET</p>
        <h2>Connect to LocalMate.</h2>
        <div className="circle-security">
          <b>Secure Arc wallet, no extension required.</b>
          <p>Sign in with Google to create or recover your user-owned Circle Wallet on Arc Testnet.</p>
        </div>
        <button className="circle-external" onClick={() => { onExternalWallet(); onClose(); }}>
          <span>▣</span> Connect a crypto wallet
        </button>
        <button className="circle-google" onClick={continueWithGoogle} disabled={!ready || Boolean(busy)}>
          <span>G</span> {busy || "Continue with Google"}
        </button>
        <div className="circle-divider"><span>OR</span></div>
        <div className="circle-email-coming">
          <b>Email login</b>
          <small>Configured in Circle Console · UI integration next</small>
        </div>
        {error && <p className="circle-error">{error}</p>}
        <small className="circle-fine">Your keys remain user-controlled through Circle’s MPC infrastructure.</small>
      </section>
    </div>
  );
}
