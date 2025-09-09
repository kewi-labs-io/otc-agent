import { useEffect, useState, useCallback, useRef } from "react";

export interface Notification {
  id: string;
  userId: string;
  type: "offer_approved" | "deal_completed" | "info" | "error";
  message: string;
  timestamp: string;
  read: boolean;
  quoteId?: string;
  offerId?: string;
  transactionHash?: string;
  dealSummary?: {
    tokenAmount: string;
    savings: string;
    apr: number;
    lockupMonths: number;
    maturityDate: string;
  };
}

interface UseNotificationPollingOptions {
  userId?: string | null;
  pollInterval?: number; // milliseconds
  enabled?: boolean;
}

/**
 * Hook for polling notifications from the HTTP API
 * Replaces socket.io real-time notifications in serverless architecture
 */
export function useNotificationPolling({
  userId,
  pollInterval = 5000, // Poll every 5 seconds by default
  enabled = true,
}: UseNotificationPollingOptions = {}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPollTimeRef = useRef<string | null>(null);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!userId || !enabled) return;

    try {
      setIsPolling(true);
      setError(null);

      const params = new URLSearchParams({
        userId,
        ...(lastPollTimeRef.current && { since: lastPollTimeRef.current }),
      });

      const response = await fetch(`/api/notifications?${params}`);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch notifications: ${response.statusText}`,
        );
      }

      const data = await response.json();

      if (data.notifications && data.notifications.length > 0) {
        setNotifications((prev) => {
          // Merge new notifications, avoiding duplicates
          const existingIds = new Set(prev.map((n) => n.id));
          const newNotifications = data.notifications.filter(
            (n: Notification) => !existingIds.has(n.id),
          );
          return [...prev, ...newNotifications];
        });

        // Play a notification sound for new notifications
        if (data.notifications.some((n: Notification) => !n.read)) {
          playNotificationSound();
        }
      }

      lastPollTimeRef.current = data.timestamp;
    } catch (err) {
      console.error("Error polling notifications:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsPolling(false);
    }
  }, [userId, enabled]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!userId) return;

      try {
        const response = await fetch("/api/notifications", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId, notificationId }),
        });

        if (response.ok) {
          setNotifications((prev) =>
            prev.filter((n) => n.id !== notificationId),
          );
        }
      } catch (err) {
        console.error("Error marking notification as read:", err);
      }
    },
    [userId],
  );

  const clearAll = useCallback(() => {
    setNotifications([]);
    lastPollTimeRef.current = new Date().toISOString();
  }, []);

  // Set up polling interval
  useEffect(() => {
    if (!userId || !enabled) {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      return;
    }

    // Fetch immediately on mount or when userId changes
    fetchNotifications();

    // Set up polling interval
    intervalIdRef.current = setInterval(fetchNotifications, pollInterval);

    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, [userId, enabled, pollInterval, fetchNotifications]);

  // Handle visibility change - poll immediately when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && userId && enabled) {
        fetchNotifications();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchNotifications, userId, enabled]);

  return {
    notifications,
    isPolling,
    error,
    markAsRead,
    clearAll,
    refetch: fetchNotifications,
    unreadCount: notifications.filter((n) => !n.read).length,
  };
}

// Helper function to play notification sound
function playNotificationSound() {
  try {
    // Create a simple beep sound using Web Audio API
    const audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // Frequency in Hz
    oscillator.type = "sine";

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + 0.1,
    );

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (err) {
    // Fail silently if audio is not supported or blocked
    console.debug("Could not play notification sound:", err);
  }
}
