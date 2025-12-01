"use client";

import { MultiWalletProvider } from "@/components/multiwallet";
import { ChainResetMonitor } from "@/components/chain-reset-monitor";
import { SolanaWalletProvider } from "@/components/solana-wallet-provider";
import { MiniappProvider } from "@/components/miniapp-provider";
import { config, chains } from "@/lib/wagmi-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { PrivyProvider } from "@privy-io/react-auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0, // Always refetch - critical for real-time contract state
      gcTime: 0, // Don't cache old data
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!privyAppId) {
    throw new Error(
      "NEXT_PUBLIC_PRIVY_APP_ID is required. Please add it to your .env.local file.",
    );
  }

  if (!mounted) {
    // Render children with skeleton providers during SSR/hydration
    return (
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <MiniappProvider>
        <PrivyProvider
          appId={privyAppId}
          config={{
            // Farcaster + available wallets (auto-detect what's installed)
            loginMethods: ["farcaster", "wallet"],
            // Support EVM and Solana wallets via Privy
            appearance: {
              theme: "light",
              accentColor: "#0052ff",
              walletChainType: "ethereum-and-solana",
              walletList: [
                "detected_ethereum_wallets",
                "detected_solana_wallets",
                "wallet_connect",
                "phantom",
              ],
            },
            // Embedded wallets for users without external wallets
            embeddedWallets: {
              ethereum: {
                createOnLogin: "users-without-wallets",
              },
              solana: {
                createOnLogin: "users-without-wallets",
              },
            },
            defaultChain: chains[0],
            supportedChains: chains,
          }}
        >
          <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
              <SolanaWalletProvider>
                <MultiWalletProvider>
                  <ChainResetMonitor />
                  {children}
                </MultiWalletProvider>
              </SolanaWalletProvider>
            </QueryClientProvider>
          </WagmiProvider>
        </PrivyProvider>
      </MiniappProvider>
    </ThemeProvider>
  );
}
