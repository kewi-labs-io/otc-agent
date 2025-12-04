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
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

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
          onSuccess={({ user, isNewUser, wasAlreadyAuthenticated, loginMethod, loginAccount }) => {
            // Detect login method and set chain preference
            console.log("[Providers] Privy login success:", { loginMethod, loginAccount, isNewUser, wasAlreadyAuthenticated });
            
            // Check the loginAccount to determine chain type
            if (loginAccount) {
              const accountType = (loginAccount as { chainType?: string })?.chainType;
              console.log("[Providers] Login account chain type:", accountType);
              
              if (accountType === 'solana') {
                console.log("[Providers] User logged in with Solana wallet - setting preference");
                localStorage.setItem("otc-preferred-chain", "solana");
                window.dispatchEvent(new Event("otc-chain-preference-changed"));
              } else if (accountType === 'ethereum') {
                console.log("[Providers] User logged in with EVM wallet - setting preference");
                localStorage.setItem("otc-preferred-chain", "evm");
                window.dispatchEvent(new Event("otc-chain-preference-changed"));
              }
            }
            
            // Also check loginMethod string for siws (Sign In With Solana)
            if (loginMethod === 'siws') {
              console.log("[Providers] User logged in with SIWS - setting preference to Solana");
              localStorage.setItem("otc-preferred-chain", "solana");
              window.dispatchEvent(new Event("otc-chain-preference-changed"));
            } else if (loginMethod === 'siwe') {
              console.log("[Providers] User logged in with SIWE - setting preference to EVM");
              localStorage.setItem("otc-preferred-chain", "evm");
              window.dispatchEvent(new Event("otc-chain-preference-changed"));
            }
          }}
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
            externalWallets: {
              solana: {
                connectors: toSolanaWalletConnectors(),
              },
            },
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
