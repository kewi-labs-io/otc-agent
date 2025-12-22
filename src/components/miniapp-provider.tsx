"use client";

import miniappSdk from "@farcaster/miniapp-sdk";
import { useEffect, useRef, useState } from "react";
import { sendWelcomeNotification } from "@/lib/notifications";
import { useRenderTracker } from "@/utils/render-tracker";

export function MiniappProvider({ children }: { children: React.ReactNode }) {
  useRenderTracker("MiniappProvider");

  const [isInitialized, setIsInitialized] = useState(false);
  const initStartedRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization with refs (more reliable than state)
    if (typeof window === "undefined" || initStartedRef.current) return;
    initStartedRef.current = true;

    const initMiniapp = async () => {
      const context = await miniappSdk.context;

      if (!context) {
        setIsInitialized(true);
        return;
      }

      // Signal ready
      await miniappSdk.actions.ready();

      // Send welcome notification on first load
      // Note: Neynar handles deduplication
      if (context.user?.fid) {
        await sendWelcomeNotification(context.user.fid);
      }

      setIsInitialized(true);
    };

    initMiniapp();
  }, []); // No deps needed - ref guards against double execution

  // Use isInitialized to prevent unused variable warning
  void isInitialized;

  return <>{children}</>;
}
