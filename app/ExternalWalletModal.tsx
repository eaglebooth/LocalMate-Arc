"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (provider: Eip1193Provider, name: string) => void;
};

export default function ExternalWalletModal({ open, onClose, onSelect }: Props) {
  const [providers, setProviders] = useState<ProviderDetail[]>([]);

  useEffect(() => {
    if (!open) return;
    const discovered = new Map<string, ProviderDetail>();
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      discovered.set(detail.info.uuid, detail);
      setProviders(Array.from(discovered.values()));
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
    const timer = window.setTimeout(() => {
      if (discovered.size === 0 && legacy) {
        setProviders([{
          info: { uuid: "legacy-injected", name: "Browser wallet", icon: "", rdns: "injected" },
          provider: legacy,
        }]);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="circle-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="wallet-picker" role="dialog" aria-modal="true" aria-label="Choose a crypto wallet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="wallet-picker-head">
          <span className="wallet-help">?</span>
          <h2>Connect wallet</h2>
          <button onClick={onClose} aria-label="Close wallet list">×</button>
        </div>
        <div className="wallet-options">
          {providers.map((item) => (
            <button key={item.info.uuid} onClick={() => onSelect(item.provider, item.info.name)}>
              <span className="wallet-option-icon">
                {/* Wallet icons are extension-provided data URLs and cannot use Next image optimization. */}
                {item.info.icon ? <img src={item.info.icon} alt="" /> : "◈"}
              </span>
              <span><b>{item.info.name}</b><small>Installed</small></span>
              <em>›</em>
            </button>
          ))}
          {providers.length === 0 && (
            <div className="wallet-discovery"><span className="wallet-loader" />Looking for installed wallets...</div>
          )}
          <button className="walletconnect-preview" disabled>
            <span className="wallet-option-icon walletconnect-icon">⌁</span>
            <span><b>WalletConnect</b><small>QR and mobile wallets · Reown ID required</small></span>
            <em>QR</em>
          </button>
        </div>
        <p className="wallet-picker-note">Installed wallets are detected securely through EIP-6963.</p>
      </section>
    </div>
  );
}
