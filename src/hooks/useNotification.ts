/**
 * useNotification - React Query mutation for sending notifications
 *
 * Uses Farcaster/Neynar API via our notification endpoint
 */

import { useMutation } from "@tanstack/react-query";

interface SendNotificationInput {
  fid: number | string;
  title: string;
  body: string;
}

interface NotificationResponse {
  state: string;
  simulated?: boolean;
  deliveries?: Array<{ fid: number; status: string }>;
}

/**
 * Send a notification via the API
 */
async function sendNotification(input: SendNotificationInput): Promise<NotificationResponse> {
  const response = await fetch("/api/notifications/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Failed to send notification: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Hook to send notifications
 *
 * Usage:
 * ```tsx
 * const { mutate: sendNotification } = useSendNotification();
 * sendNotification({ fid: 123, title: "Hello", body: "World" });
 * ```
 */
export function useSendNotification() {
  return useMutation({
    mutationFn: sendNotification,
  });
}

/**
 * Send a welcome notification to a user
 */
export function useWelcomeNotification() {
  const mutation = useSendNotification();

  return (fid: number) =>
    mutation.mutateAsync({
      fid,
      title: "Welcome to Eliza OTC Desk",
      body: "Start trading with AI-powered negotiation on Base, BSC, and Solana",
    });
}
