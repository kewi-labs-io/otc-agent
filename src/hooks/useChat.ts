/**
 * useChat - React Query hooks for chat/room functionality
 *
 * Provides:
 * - useCreateRoom: Create new chat rooms
 * - useRoomMessages: Fetch and poll for messages
 * - useSendMessage: Send messages to rooms
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chatKeys } from "./queryKeys";

/**
 * Chat message structure
 */
export interface ChatMessage {
  id: string;
  text: string;
  userId: string;
  userName?: string;
  isAgent?: boolean;
  clientMessageId?: string;
  timestamp: number;
  createdAt?: string;
}

/**
 * Room data structure
 */
interface RoomData {
  roomId: string;
  entityId?: string;
}

/**
 * Create a new chat room
 */
async function createRoom(entityId: string): Promise<RoomData> {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create room: ${response.status}`);
  }

  const data = await response.json();

  if (!data.roomId) {
    throw new Error("Invalid room creation response: missing roomId");
  }

  return data as RoomData;
}

/**
 * Hook to create a new chat room
 */
export function useCreateRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createRoom,
    // Disable automatic retries - the calling code will handle retry logic
    // This prevents cascading failures that exhaust browser connections
    retry: 0,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.rooms() });
    },
  });
}

/**
 * Fetch messages from a room
 */
async function fetchMessages(roomId: string, afterTimestamp?: number): Promise<ChatMessage[]> {
  const url = afterTimestamp
    ? `/api/rooms/${roomId}/messages?afterTimestamp=${afterTimestamp}&_=${Date.now()}`
    : `/api/rooms/${roomId}/messages`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.status}`);
  }

  const data = await response.json();

  if (!data.messages || !Array.isArray(data.messages)) {
    throw new Error("Invalid API response: messages array is missing or not an array");
  }

  return data.messages as ChatMessage[];
}

/**
 * Hook to fetch and auto-poll room messages
 *
 * Features:
 * - Initial fetch of all messages
 * - Auto-polling every 2 seconds for new messages
 * - Deduplication via React Query
 *
 * @param roomId - Room ID to fetch messages for
 * @param options - Optional configuration
 */
export function useRoomMessages(
  roomId: string | null | undefined,
  options?: {
    enabled?: boolean;
    pollingInterval?: number;
  },
) {
  const { enabled = true, pollingInterval = 2000 } = options ?? {};

  return useQuery({
    queryKey: roomId ? chatKeys.messages(roomId) : chatKeys.all,
    queryFn: () => {
      if (!roomId) throw new Error("No roomId provided");
      return fetchMessages(roomId);
    },
    enabled: enabled && !!roomId,
    staleTime: 0, // Always refetch
    refetchInterval: pollingInterval, // Poll every 2 seconds
    refetchIntervalInBackground: false, // Don't poll when tab not visible
  });
}

/**
 * Send message input
 */
interface SendMessageInput {
  roomId: string;
  entityId: string;
  text: string;
  clientMessageId: string;
}

/**
 * Send message response
 */
interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a message to a room
 */
async function sendMessage(input: SendMessageInput): Promise<SendMessageResponse> {
  const response = await fetch(`/api/rooms/${input.roomId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityId: input.entityId,
      text: input.text,
      clientMessageId: input.clientMessageId,
    }),
    cache: "no-store",
    keepalive: true,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send message: ${errorText}`);
  }

  return response.json();
}

/**
 * Hook to send messages
 *
 * Features:
 * - Invalidates messages cache on success
 * - Supports optimistic updates via onMutate callback
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: sendMessage,
    onSuccess: (_, variables) => {
      // Invalidate messages to trigger refetch
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(variables.roomId),
      });
    },
  });
}

/**
 * Hook to invalidate chat cache
 */
export function useInvalidateChat() {
  const queryClient = useQueryClient();

  return (roomId?: string) => {
    if (roomId) {
      queryClient.invalidateQueries({ queryKey: chatKeys.messages(roomId) });
    } else {
      queryClient.invalidateQueries({ queryKey: chatKeys.all });
    }
  };
}
