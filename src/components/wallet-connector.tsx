"use client";

import { Button } from "@/components/button";
import { useMultiWallet } from "@/components/multiwallet";
import { NetworkMenu } from "@/components/network-menu";
import { useEffect, useState } from "react";

interface WalletConnectorProps {
  onConnectionChange: (connected: boolean, address?: string) => void;
  showAsButton?: boolean;
}

const WalletConnectorInner = ({
  onConnectionChange,
  showAsButton,
}: WalletConnectorProps) => {
  const {
    isConnected,
    evmAddress,
    solanaPublicKey,
    activeFamily,
    login,
    connectWallet,
    entityId,
  } = useMultiWallet();

  // Notify parent component of connection changes
  useEffect(() => {
    onConnectionChange(isConnected, evmAddress || solanaPublicKey);
  }, [isConnected, evmAddress, solanaPublicKey, onConnectionChange]);

  if (showAsButton) {
    if (isConnected) return null;

    // Show simplified connect button
    return (
      <div className="inline-flex">
        <Button
          onClick={() => login()}
          className="!h-9 !px-4 !text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg"
        >
          Connect Wallet
        </Button>
      </div>
    );
  }

  // Main header view - always show network menu + wallet button
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Network Menu (Base | Solana) */}
      <NetworkMenu />

      {/* Wallet/Account button */}
      {isConnected ? (
        <Button
          onClick={() => connectWallet()}
          className="!h-9 !px-3 !text-sm whitespace-nowrap bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg flex items-center gap-2 border border-zinc-200 dark:border-zinc-700"
        >
          {activeFamily === "evm" && evmAddress && (
            <>
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span>{`${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}`}</span>
            </>
          )}
          {activeFamily === "solana" && solanaPublicKey && (
            <>
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              <span>{`${solanaPublicKey.slice(0, 6)}...${solanaPublicKey.slice(-4)}`}</span>
            </>
          )}
          {activeFamily === "social" && entityId && (
            <>
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span>Account</span>
            </>
          )}
        </Button>
      ) : (
        <Button
          onClick={() => login()}
          className="!h-9 !px-4 !text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg"
        >
          Connect
        </Button>
      )}
    </div>
  );
};

// Wrapper component that ensures client-side only rendering
export const WalletConnector = (props: WalletConnectorProps) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render anything until client-side
  if (!mounted) {
    return null;
  }

  return <WalletConnectorInner {...props} />;
};
