"use client";

import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { defineChain } from "@reown/appkit/networks";

export const arcTestnetAppKit = defineChain({
  id: 5_042_002,
  caipNetworkId: "eip155:5042002",
  chainNamespace: "eip155",
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;

export const reownAppKit = projectId
  ? createAppKit({
      adapters: [new EthersAdapter()],
      networks: [arcTestnetAppKit],
      defaultNetwork: arcTestnetAppKit,
      projectId,
      metadata: {
        name: "LocalMate",
        description: "Trusted local help, settled on Arc.",
        url: "https://localmate-nine.vercel.app",
        icons: ["https://localmate-nine.vercel.app/icon.svg"],
      },
      features: {
        analytics: false,
        email: false,
        socials: [],
        swaps: false,
        onramp: false,
      },
      themeMode: "dark",
      themeVariables: {
        "--w3m-accent": "#8ff0cd",
        "--w3m-border-radius-master": "2px",
      },
    })
  : null;
