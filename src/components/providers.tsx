"use client";

import { MultiWalletProvider } from "@/components/multiwallet";
import { ChainResetMonitor } from "@/components/chain-reset-monitor";
import { config } from "@/lib/wagmi-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { base, hardhat, mainnet } from "wagmi/chains";

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

  const isDevelopment = process.env.NODE_ENV === "development";
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!privyAppId) {
    throw new Error(
      "NEXT_PUBLIC_PRIVY_APP_ID is required. Please add it to your .env.local file."
    );
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {mounted ? (
        <PrivyProvider
          appId={privyAppId}
          config={{
            // ALL login methods: social logins + external wallets
            loginMethods: ["wallet", "email", "google", "farcaster"],
            // Support both EVM and Solana wallets
            appearance: {
              theme: "light",
              accentColor: "#0052ff",
              walletChainType: "ethereum-and-solana", // KEY: Enable both chains
            },
            // Embedded wallets for users without external wallets
            embeddedWallets: {
              createOnLogin: "users-without-wallets",
              requireUserPasswordOnCreate: false,
            },
            defaultChain: isDevelopment ? hardhat : base,
            supportedChains: isDevelopment
              ? [hardhat, base, mainnet]
              : [base, mainnet],
          }}
        >
          <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
              <MultiWalletProvider>
                <ChainResetMonitor />
                {children}
              </MultiWalletProvider>
            </QueryClientProvider>
          </WagmiProvider>
        </PrivyProvider>
      ) : (
        children
      )}
    </ThemeProvider>
  );
}
