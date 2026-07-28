"use client";

import { useEffect, useRef, useState } from "react";
import { getCookie, setCookie } from "cookies-next/client";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import {
  circleAction,
  executeCircleChallenge,
  setCircleWalletSession,
} from "./circle-wallet-session";

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
      if (!sdk.current) throw new Error("Circle Wallet SDK is not ready.");
      setCircleWalletSession({
        sdk: sdk.current,
        userToken,
        walletId: wallet.id,
        walletAddress: wallet.address,
      });
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
          await executeCircleChallenge(sdk.current, result.challengeId);
          await loadWallets(userToken);
        } else {
          await loadWallets(userToken);
        }
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : "Wallet initialization failed.";
        if (message.includes("155106") || message.toLowerCase().includes("already initialized")) {
          await loadWallets(userToken);
        } else {
          window.sessionStorage.removeItem("localmate-circle-login-pending");
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
            window.sessionStorage.removeItem("localmate-circle-login-pending");
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
      window.sessionStorage.setItem("localmate-circle-login-pending", "true");
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
      window.sessionStorage.removeItem("localmate-circle-login-pending");
      setError(loginError instanceof Error ? loginError.message : "Google login failed.");
      setBusy("");
    }
  }

  if (!open) return null;

  return (
    <div className="circle-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="circle-wallet-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="circle-modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="circle-brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 3a13 13 0 1 0 0 26" />
            <path d="M16 8a8 8 0 1 0 0 16" />
            <path d="M20 4.2a13 13 0 0 1 8 8" />
            <path d="M20 27.8a13 13 0 0 0 8-8" />
          </svg>
          <span>CIRCLE WALLET</span>
        </div>
        <p className="circle-label">USER-CONTROLLED · ARC TESTNET</p>
        <h2>Connect to LocalMate.</h2>
        <div className="circle-security">
          <b>Secure Arc wallet, no extension required.</b>
          <p>Sign in with Google to create or recover your user-owned Circle Wallet on Arc Testnet.</p>
        </div>
        <button className="circle-external" onClick={() => { onExternalWallet(); onClose(); }}>
          <span className="connect-icon wallet-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 6.8h13.2c1 0 1.8.8 1.8 1.8v8.6c0 1-.8 1.8-1.8 1.8H5a3 3 0 0 1-3-3V7.3c0-1.4.9-2.7 2.3-3.1l10-2.9c.9-.3 1.9.3 2.1 1.2l.3 1.3H5a3 3 0 0 0-3 3" />
              <path d="M15.8 11.2H22v4.4h-6.2a2.2 2.2 0 1 1 0-4.4Z" />
              <circle cx="16.2" cy="13.4" r=".7" />
            </svg>
          </span>
          Choose a crypto wallet <i>›</i>
        </button>
        <button className="circle-google" onClick={continueWithGoogle} disabled={!ready || Boolean(busy)}>
          <span className="connect-icon google-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-1.99 3.02v2.54h3.23c1.89-1.74 2.98-4.3 2.98-7.41Z" />
              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.36l-3.23-2.54c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.08v2.62A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.41 13.94A6 6 0 0 1 6.1 12c0-.67.12-1.32.31-1.94V7.44H3.08A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.56l3.33-2.62Z" />
              <path fill="#EA4335" d="M12 5.94c1.47 0 2.78.5 3.82 1.49l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.92 5.44l3.33 2.62C7.2 7.7 9.4 5.94 12 5.94Z" />
            </svg>
          </span>
          {busy || "Continue with Google"}
        </button>
        <div className="circle-divider"><span>OR</span></div>
        <div className="circle-email-coming">
          <b>Email login</b>
          <small>Google login is ready · Email OTP integration next</small>
        </div>
        {error && <p className="circle-error">{error}</p>}
        <small className="circle-fine">Your keys remain user-controlled through Circle’s MPC infrastructure.</small>
      </section>
    </div>
  );
}
