"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";

interface WalletConnectorProps {
  onConnectionChange: (connected: boolean, address?: string) => void;
  showAsButton?: boolean;
}

const WalletConnectorInner = ({
  onConnectionChange,
  showAsButton,
}: WalletConnectorProps) => {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  // Notify parent component of connection changes
  useEffect(() => {
    onConnectionChange(isConnected, address);
  }, [isConnected, address, onConnectionChange]);

  if (showAsButton) {
    return (
      <Button onClick={() => connect({ connector: injected() })} color="blue">
        Connect Wallet
      </Button>
    );
  }

  if (isConnected) {
    return (
      <>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
        <Button onClick={() => disconnect()} plain className="text-sm">
          Disconnect
        </Button>
      </>
    );
  }

  return (
    <Button
      onClick={() => connect({ connector: injected() })}
      color="blue"
      className="text-sm"
    >
      Connect Wallet
    </Button>
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
