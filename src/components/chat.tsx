"use client";

import { usePrivy } from "@privy-io/react-auth";
import type React from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { AcceptQuoteModal } from "@/components/accept-quote-modal";
import { Button } from "@/components/button";
import { ChatMessages } from "@/components/chat-messages";
import { Dialog } from "@/components/dialog";
import { useMultiWallet } from "@/components/multiwallet";
import { InlineSvgSpinner } from "@/components/ui/loading-spinner";
import { TextareaWithActions } from "@/components/textarea-with-actions";
import { TokenHeader } from "@/components/token-header";
import { CHAT_SOURCE, USER_NAME } from "@/constants";
import { useConsignments } from "@/hooks/useConsignments";
import type { Token, TokenMarketData } from "@/types";
import type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageQuoteData,
} from "@/types/chat-message";
import { formatRawTokenAmount } from "@/utils/format";
import { type OTCQuote, parseMessageXML } from "@/utils/xml-parser";

interface ChatProps {
  roomId?: string;
  token?: Token;
  marketData?: TokenMarketData | null;
}

// --- Consolidated Chat State ---
interface ChatState {
  messages: ChatMessage[];
  input: string;
  inputDisabled: boolean;
  roomId: string | null;
  isLoadingHistory: boolean;
  isAgentThinking: boolean;
  entityId: string | null;
  showConnectOverlay: boolean;
  currentQuote: OTCQuote | null;
  showAcceptModal: boolean;
  isOfferGlowing: boolean;
  showClearChatModal: boolean;
}

type ChatAction =
  | { type: "SET_MESSAGES"; payload: ChatMessage[] }
  | { type: "ADD_MESSAGE"; payload: ChatMessage }
  | { type: "SET_INPUT"; payload: string }
  | { type: "SET_INPUT_DISABLED"; payload: boolean }
  | { type: "SET_ROOM_ID"; payload: string | null }
  | { type: "SET_LOADING_HISTORY"; payload: boolean }
  | { type: "SET_AGENT_THINKING"; payload: boolean }
  | { type: "SET_ENTITY_ID"; payload: string | null }
  | { type: "SET_CONNECT_OVERLAY"; payload: boolean }
  | { type: "SET_CURRENT_QUOTE"; payload: OTCQuote | null }
  | { type: "SET_ACCEPT_MODAL"; payload: boolean }
  | { type: "SET_OFFER_GLOWING"; payload: boolean }
  | { type: "SET_CLEAR_CHAT_MODAL"; payload: boolean }
  | { type: "RESET_CHAT"; payload: { roomId: string } }
  | {
      type: "USER_CONNECTED";
      payload: { entityId: string; roomId: string | null };
    }
  | { type: "USER_DISCONNECTED" };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_MESSAGES":
      return { ...state, messages: action.payload };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "SET_INPUT":
      return { ...state, input: action.payload };
    case "SET_INPUT_DISABLED":
      return { ...state, inputDisabled: action.payload };
    case "SET_ROOM_ID":
      return { ...state, roomId: action.payload };
    case "SET_LOADING_HISTORY":
      return { ...state, isLoadingHistory: action.payload };
    case "SET_AGENT_THINKING":
      return { ...state, isAgentThinking: action.payload };
    case "SET_ENTITY_ID":
      return { ...state, entityId: action.payload };
    case "SET_CONNECT_OVERLAY":
      return { ...state, showConnectOverlay: action.payload };
    case "SET_CURRENT_QUOTE":
      return { ...state, currentQuote: action.payload };
    case "SET_ACCEPT_MODAL":
      return { ...state, showAcceptModal: action.payload };
    case "SET_OFFER_GLOWING":
      return { ...state, isOfferGlowing: action.payload };
    case "SET_CLEAR_CHAT_MODAL":
      return { ...state, showClearChatModal: action.payload };
    case "RESET_CHAT":
      return {
        ...state,
        messages: [],
        currentQuote: null,
        roomId: action.payload.roomId,
        showClearChatModal: false,
      };
    case "USER_CONNECTED":
      return {
        ...state,
        entityId: action.payload.entityId,
        roomId: action.payload.roomId,
        showConnectOverlay: false,
        inputDisabled: false,
      };
    case "USER_DISCONNECTED":
      return {
        ...state,
        entityId: null,
        inputDisabled: true,
        showConnectOverlay: true,
      };
    default:
      return state;
  }
}

// RawRoomMessage imported from @/types
import type { RawRoomMessage } from "@/types";

// --- Helper: Parse room message into ChatMessage format ---
function parseRoomMessage(
  msg: RawRoomMessage,
  roomId: string,
): ChatMessage | null {
  // FAIL-FAST: Validate required fields first
  if (!msg.id) {
    throw new Error("RawRoomMessage missing id field");
  }
  // FAIL-FAST: Required fields must exist
  if (msg.entityId == null) {
    throw new Error("RawRoomMessage missing entityId field");
  }
  if (msg.agentId == null) {
    throw new Error("RawRoomMessage missing agentId field");
  }
  if (msg.createdAt == null) {
    throw new Error("RawRoomMessage missing createdAt field");
  }

  // Parse message text from various possible formats
  let messageText = "";
  const rawContent = msg.content;
  // rawContent.text exists if rawContent is an object with text property
  if (
    typeof rawContent === "object" &&
    rawContent !== null &&
    "text" in rawContent &&
    typeof rawContent.text === "string"
  ) {
    messageText = rawContent.text;
  } else if (msg.text) {
    messageText = msg.text;
  } else if (typeof rawContent === "string") {
    messageText = rawContent;
  } else if (rawContent) {
    messageText = JSON.stringify(rawContent);
  }
  // FAIL-FAST: Message must have text (empty string is valid)
  if (messageText === undefined) {
    throw new Error(`RawRoomMessage ${msg.id} has no text content`);
  }

  // Filter out system messages
  if (messageText.startsWith("Executed action:")) {
    return null;
  }

  // Preserve structured content for quote extraction
  const parsedContent: ChatMessageContent | undefined =
    typeof rawContent === "object" && rawContent
      ? {
          text: rawContent.text,
          xml: rawContent.xml,
          quote: rawContent.quote as ChatMessageQuoteData | undefined,
          type: rawContent.type,
        }
      : undefined;

  return {
    id: msg.id,
    name: msg.entityId === msg.agentId ? "Eliza" : USER_NAME,
    text: messageText, // Always a string (validated above)
    senderId: msg.entityId,
    roomId: roomId,
    createdAt:
      typeof msg.createdAt === "number"
        ? msg.createdAt
        : new Date(msg.createdAt).getTime(),
    source: CHAT_SOURCE,
    isLoading: false,
    serverMessageId: msg.id,
    content: parsedContent,
  };
}

const initialChatState: ChatState = {
  messages: [],
  input: "",
  inputDisabled: false,
  roomId: null,
  isLoadingHistory: false,
  isAgentThinking: false,
  entityId: null,
  showConnectOverlay: false,
  currentQuote: null,
  showAcceptModal: false,
  isOfferGlowing: false,
  showClearChatModal: false,
};

export const Chat = ({
  roomId: initialRoomId,
  token,
  marketData,
}: ChatProps = {}) => {
  // --- Consolidated State ---
  const [state, dispatch] = useReducer(chatReducer, {
    ...initialChatState,
    roomId: initialRoomId || null,
  });

  const {
    messages,
    input,
    inputDisabled,
    roomId,
    isLoadingHistory,
    isAgentThinking,
    entityId,
    showConnectOverlay,
    currentQuote,
    showAcceptModal,
    isOfferGlowing,
    showClearChatModal,
  } = state;

  const {
    isConnected,
    entityId: walletEntityId,
    setActiveFamily,
    evmConnected,
    solanaConnected,
    privyAuthenticated,
    connectWallet,
  } = useMultiWallet();
  const { login, ready: privyReady } = usePrivy();

  // Fetch consignments for this token to get available amounts and terms
  const { data: consignments } = useConsignments({
    filters: token && token.id ? { tokenId: token.id } : {},
    enabled: !!(token && token.id),
  });

  // Helper to safely parse BigInt
  const safeBigInt = (value: string | undefined | null): bigint => {
    if (!value) return 0n;
    return BigInt(value);
  };

  // Calculate aggregated consignment data for the token
  // Uses sanitized display fields (worst case for negotiable, actual for fixed)
  const consignmentData = useMemo(() => {
    if (!consignments?.length) return null;

    // Filter to active consignments with remaining balance
    const activeConsignments = consignments.filter((c) => {
      if (c.status !== "active") return false;
      const remaining = safeBigInt(c.remainingAmount);
      return remaining > 0n;
    });

    if (!activeConsignments.length) return null;

    // Sum up total available
    const totalAvailable = activeConsignments.reduce(
      (sum, c) => sum + safeBigInt(c.remainingAmount),
      0n,
    );

    // Extended type for sanitized consignments with display fields
    type ConsignmentWithDisplay = (typeof activeConsignments)[0] & {
      displayDiscountBps?: number;
      displayLockupDays?: number;
    };

    // Get starting terms using sanitized display fields
    // For negotiable: displayDiscountBps = minDiscount (worst), displayLockupDays = maxLockup (worst)
    // For fixed: displayDiscountBps = fixedDiscount, displayLockupDays = fixedLockup
    const startingDiscount = Math.min(
      ...activeConsignments.map((c) => {
        const cwd = c as ConsignmentWithDisplay;
        // Use display field if available (sanitized API), fallback to raw fields (owner view)
        if (cwd.displayDiscountBps !== undefined) return cwd.displayDiscountBps;
        if (c.isNegotiable) {
          // FAIL-FAST: Negotiable consignments must have minDiscountBps
          if (c.minDiscountBps == null) {
            throw new Error(
              `Negotiable consignment ${c.id} missing minDiscountBps`,
            );
          }
          return c.minDiscountBps;
        }
        // FAIL-FAST: Fixed consignments must have fixedDiscountBps
        if (c.fixedDiscountBps == null) {
          throw new Error(`Fixed consignment ${c.id} missing fixedDiscountBps`);
        }
        return c.fixedDiscountBps;
      }),
    );

    const startingLockupDays = Math.max(
      ...activeConsignments.map((c) => {
        const cwd = c as ConsignmentWithDisplay;
        // Use display field if available (sanitized API), fallback to raw fields (owner view)
        if (cwd.displayLockupDays !== undefined) return cwd.displayLockupDays;
        if (c.isNegotiable) {
          // FAIL-FAST: Negotiable consignments must have maxLockupDays
          if (c.maxLockupDays == null) {
            throw new Error(
              `Negotiable consignment ${c.id} missing maxLockupDays`,
            );
          }
          return c.maxLockupDays;
        }
        // FAIL-FAST: Fixed consignments must have fixedLockupDays
        if (c.fixedLockupDays == null) {
          throw new Error(`Fixed consignment ${c.id} missing fixedLockupDays`);
        }
        return c.fixedLockupDays;
      }),
    );

    const maxDealAmount = totalAvailable; // Can buy up to total available

    // Check if any consignment is fractionalized (allows partial purchases)
    const hasFractionalized = activeConsignments.some(
      (c) => c.isFractionalized,
    );
    const hasNegotiable = activeConsignments.some((c) => c.isNegotiable);

    // FAIL-FAST: startingDiscount and startingLockupDays must be valid numbers
    // activeConsignments is guaranteed to have at least one element (checked above)
    // so Math.min/Math.max should always return valid numbers, not Infinity/-Infinity
    if (!Number.isFinite(startingDiscount) || startingDiscount < 0) {
      throw new Error(`Invalid startingDiscount computed: ${startingDiscount}`);
    }
    if (!Number.isFinite(startingLockupDays) || startingLockupDays < 0) {
      throw new Error(
        `Invalid startingLockupDays computed: ${startingLockupDays}`,
      );
    }

    return {
      totalAvailable: totalAvailable.toString(),
      // Starting terms (worst case for negotiable, actual for fixed)
      startingDiscountBps: startingDiscount,
      startingLockupDays: startingLockupDays,
      maxDealAmount: maxDealAmount.toString(),
      hasNegotiable,
      hasFractionalized,
      // Include primary consignment ID for default quote linking
      // Uses the first active consignment (required for on-chain execution)
      primaryConsignmentId: activeConsignments[0].id,
    };
  }, [consignments]);

  // --- Refs ---
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const lastMessageTimestampRef = useRef<number>(0);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const previousQuoteIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Initialize user from connected wallet; gate chat when disconnected
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isConnected && walletEntityId) {
      const addr = walletEntityId.toLowerCase();
      const storedRoomId = localStorage.getItem(`otc-desk-room-${addr}`);
      // Use initialRoomId if provided, else stored room, else null (will create new)
      const targetRoomId = initialRoomId || storedRoomId || null;
      dispatch({
        type: "USER_CONNECTED",
        payload: { entityId: addr, roomId: targetRoomId },
      });
    } else {
      dispatch({ type: "USER_DISCONNECTED" });
    }
  }, [isConnected, walletEntityId, initialRoomId]); // Removed 'roomId' - was causing loop

  // Function to create a new room
  const createNewRoom = useCallback(async () => {
    if (!entityId) return null;

    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId }),
    });

    if (!response.ok) {
      throw new Error("Failed to create room");
    }

    const data = await response.json();
    const newRoomId = data.roomId;

    // Persist room per-wallet
    if (entityId) {
      localStorage.setItem(`otc-desk-room-${entityId}`, newRoomId);
    }
    dispatch({ type: "RESET_CHAT", payload: { roomId: newRoomId } });

    return newRoomId;
  }, [entityId]);

  // Load room data - only when roomId or entityId changes, NOT on messages change
  useEffect(() => {
    if (!roomId || !entityId) return;

    const loadRoom = async () => {
      dispatch({ type: "SET_LOADING_HISTORY", payload: true });

      const response = await fetch(`/api/rooms/${roomId}/messages`, {
        cache: "no-store",
      });

      if (response.ok) {
        const data = await response.json();
        // FAIL-FAST: API response must have messages array
        if (!data.messages || !Array.isArray(data.messages)) {
          throw new Error(
            "Invalid API response: messages array is missing or not an array",
          );
        }
        const rawMessages = data.messages;

        // Format messages using helper function
        const formattedMessages = (rawMessages as RawRoomMessage[])
          .map((msg) => parseRoomMessage(msg, roomId))
          .filter(
            (msg: ChatMessage | null): msg is ChatMessage => msg !== null,
          );

        // Sort by timestamp
        formattedMessages.sort(
          (a: ChatMessage, b: ChatMessage) => a.createdAt - b.createdAt,
        );

        dispatch({ type: "SET_MESSAGES", payload: formattedMessages });

        // Update last message timestamp
        if (formattedMessages.length > 0) {
          const lastMessage = formattedMessages[formattedMessages.length - 1];
          lastMessageTimestampRef.current = lastMessage.createdAt;
        }
      }
      dispatch({ type: "SET_LOADING_HISTORY", payload: false });
    };

    loadRoom();
  }, [roomId, entityId]); // Removed 'messages' - was causing infinite loop

  // Store messages ref for polling to avoid stale closure issues
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Poll for new messages when agent is thinking
  useEffect(() => {
    if (!isAgentThinking || !roomId) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Poll every 2 seconds for new messages (faster polling has diminishing returns)
    pollingIntervalRef.current = setInterval(async () => {
      const response = await fetch(
        `/api/rooms/${roomId}/messages?afterTimestamp=${lastMessageTimestampRef.current}&_=${Date.now()}`,
        { cache: "no-store" },
      );

      if (response.ok) {
        const data = await response.json();
        // FAIL-FAST: API response must have messages array
        if (!data.messages || !Array.isArray(data.messages)) {
          throw new Error(
            "Invalid API response: messages array is missing or not an array",
          );
        }
        const newMessages = data.messages;

        if (newMessages.length > 0) {
          const formattedMessages = (newMessages as RawRoomMessage[])
            .map((msg) => parseRoomMessage(msg, roomId))
            .filter(
              (msg: ChatMessage | null): msg is ChatMessage => msg !== null,
            );

          // Use ref to get current messages without triggering effect restart
          const currentMessages = messagesRef.current;
          const withoutOptimistic = currentMessages.filter(
            (m) => !m.isUserMessage,
          );

          // Merge with new messages and dedupe by server ID
          const byServerId = new Map<string, ChatMessage>();
          withoutOptimistic.forEach((m) => {
            // Use serverMessageId if available, otherwise fall back to id
            // Both are required fields - at least one must exist
            const key = m.serverMessageId?.trim() || m.id?.trim();
            if (!key) {
              throw new Error("Message missing both serverMessageId and id");
            }
            byServerId.set(key, m);
          });
          formattedMessages.forEach((m: ChatMessage) => {
            // Use serverMessageId if available, otherwise fall back to id
            // Both are required fields - at least one must exist
            const key = m.serverMessageId?.trim() || m.id?.trim();
            if (!key) {
              throw new Error("Message missing both serverMessageId and id");
            }
            byServerId.set(key, m);
          });

          const merged = Array.from(byServerId.values());
          merged.sort((a, b) => a.createdAt - b.createdAt);

          dispatch({ type: "SET_MESSAGES", payload: merged });

          // Update last message timestamp
          if (formattedMessages.length > 0) {
            const lastNewMessage =
              formattedMessages[formattedMessages.length - 1];
            lastMessageTimestampRef.current = lastNewMessage.createdAt;
          }

          // Check if we received an agent message
          const hasAgentMessage = (newMessages as RawRoomMessage[]).some(
            (msg) => msg.entityId === msg.agentId,
          );
          if (hasAgentMessage) {
            setTimeout(() => {
              dispatch({ type: "SET_AGENT_THINKING", payload: false });
              dispatch({ type: "SET_INPUT_DISABLED", payload: false });
            }, 3000);
          }
        }
      }
    }, 2000);

    // Stop polling after 30 seconds
    const timeoutId = setTimeout(() => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        dispatch({ type: "SET_AGENT_THINKING", payload: false });
        dispatch({ type: "SET_INPUT_DISABLED", payload: false });
      }
    }, 30000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      clearTimeout(timeoutId);
    };
  }, [isAgentThinking, roomId]); // Removed 'messages' - using ref instead

  // Send message function - accepts optional targetRoomId to handle newly created rooms
  const sendMessage = useCallback(
    async (messageText: string, targetRoomId?: string) => {
      const effectiveRoomId = targetRoomId || roomId;
      if (
        !messageText.trim() ||
        !entityId ||
        !effectiveRoomId ||
        inputDisabled ||
        !isConnected
      ) {
        throw new Error("Cannot send message: missing required data");
      }

      // Add user message to UI immediately with a client-generated ID
      const clientMessageId = uuidv4();
      const userMessage: ChatMessage = {
        id: clientMessageId,
        name: USER_NAME,
        text: messageText,
        senderId: entityId,
        roomId: effectiveRoomId,
        createdAt: Date.now(),
        source: CHAT_SOURCE,
        isLoading: false,
        isUserMessage: true,
      };

      dispatch({ type: "ADD_MESSAGE", payload: userMessage });
      dispatch({ type: "SET_AGENT_THINKING", payload: true });
      dispatch({ type: "SET_INPUT_DISABLED", payload: true });

      const doPost = async () =>
        fetch(`/api/rooms/${effectiveRoomId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId,
            text: messageText,
            clientMessageId,
          }),
          cache: "no-store",
          keepalive: true,
        });

      let response = await doPost();
      if (!response.ok) {
        // Retry once on transient server errors
        await new Promise((r) => setTimeout(r, 800));
        response = await doPost();
      }
      if (!response.ok) throw new Error("Failed to send message");

      // Prefer server timestamp to avoid client/server clock skew missing agent replies
      const result = (await response.json()) as {
        message?: { createdAt?: string | number };
      };
      const serverCreatedAt =
        result.message && result.message.createdAt
          ? new Date(result.message.createdAt).getTime()
          : undefined;
      if (
        typeof serverCreatedAt === "number" &&
        !Number.isNaN(serverCreatedAt)
      ) {
        // Set to just before our message so we catch both our message and agent's response
        lastMessageTimestampRef.current = serverCreatedAt - 100;
      } else {
        // Fallback: use current time minus a buffer
        lastMessageTimestampRef.current = Date.now() - 1000;
      }
    },
    [entityId, roomId, inputDisabled, isConnected],
  );

  // Handle form submit
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;

      // Ensure user is connected and room exists before sending
      if (!isConnected || !entityId) {
        dispatch({ type: "SET_CONNECT_OVERLAY", payload: true });
        return;
      }

      let activeRoomId = roomId;
      if (!activeRoomId) {
        activeRoomId = await createNewRoom();
        if (!activeRoomId) return; // creation failed
      }

      // Pass activeRoomId explicitly in case it was just created (state not yet updated)
      await sendMessage(trimmed, activeRoomId);
      dispatch({ type: "SET_INPUT", payload: "" });

      // Refocus the textarea after sending
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [input, isConnected, entityId, roomId, createNewRoom, sendMessage],
  );

  // Handle creating a new room when there isn't one
  useEffect(() => {
    if (!roomId && entityId && isConnected) {
      // Automatically create a room for this wallet when connected
      createNewRoom();
    }
  }, [roomId, entityId, isConnected, createNewRoom]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  // Helper: Extract text content from a message for XML parsing
  const getMessageTextForParsing = (msg: ChatMessage): string => {
    // Primary: use text field if it's a string
    if (typeof msg.text === "string" && msg.text) {
      return msg.text;
    }
    // Fallback 1: check content.text
    if (msg.content && msg.content.text) {
      return msg.content.text;
    }
    // Fallback 2: check content.xml (agent sends quotes here too)
    if (msg.content && msg.content.xml) {
      return msg.content.xml;
    }
    return "";
  };

  // Helper: Try to extract quote directly from structured content
  const getQuoteFromContent = (msg: ChatMessage): OTCQuote | null => {
    if (!msg.content) return null;
    if (msg.content.type !== "otc_quote") return null;
    if (!msg.content.quote) return null;

    const q: ChatMessageQuoteData = msg.content.quote;

    // FAIL-FAST: Validate required quote fields
    if (!q.quoteId) {
      throw new Error("Quote missing quoteId");
    }
    if (!q.tokenAmount) {
      throw new Error("Quote missing tokenAmount");
    }
    if (!q.tokenSymbol) {
      throw new Error("Quote missing tokenSymbol");
    }
    if (!q.chain) {
      throw new Error("Quote missing chain");
    }
    // FAIL-FAST: Required quote fields must exist
    if (q.discountBps == null) {
      throw new Error("Quote missing discountBps");
    }
    if (q.lockupDays == null) {
      throw new Error("Quote missing lockupDays");
    }
    if (!q.paymentCurrency) {
      throw new Error("Quote missing paymentCurrency");
    }

    // Map the structured quote data to OTCQuote interface
    const discountBps = Number(q.discountBps);
    const lockupDays = Number(q.lockupDays);
    // lockupMonths is optional - calculate from lockupDays if not provided
    const lockupMonths =
      typeof q.lockupMonths === "number"
        ? Number(q.lockupMonths)
        : Math.ceil(lockupDays / 30);

    return {
      quoteId: String(q.quoteId),
      tokenAmount: String(q.tokenAmount),
      tokenSymbol: String(q.tokenSymbol),
      tokenChain: q.chain as OTCQuote["tokenChain"],
      tokenAddress: q.tokenAddress ? String(q.tokenAddress) : undefined,
      lockupMonths,
      lockupDays,
      discountBps,
      discountPercent:
        q.discountPercent !== undefined && q.discountPercent !== null
          ? Number(q.discountPercent)
          : discountBps / 100,
      paymentCurrency: String(q.paymentCurrency),
      pricePerToken:
        q.pricePerToken !== undefined && q.pricePerToken !== null
          ? Number(q.pricePerToken)
          : undefined,
      totalValueUsd:
        q.totalUsd !== undefined && q.totalUsd !== null
          ? Number(q.totalUsd)
          : undefined,
      finalPriceUsd:
        q.discountedUsd !== undefined && q.discountedUsd !== null
          ? Number(q.discountedUsd)
          : undefined,
      createdAt: q.createdAt ? String(q.createdAt) : undefined,
      status: q.status ? String(q.status) : undefined,
    };
  };

  // Extract current quote from messages
  useEffect(() => {
    if (!messages.length) return;

    // Find the latest quote in messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) {
        throw new Error(`Message at index ${i} is null or undefined`);
      }
      if (msg.name === USER_NAME) continue;

      // Try structured content first (more reliable)
      let extractedQuote = getQuoteFromContent(msg);

      // Fall back to XML parsing if no structured quote
      if (!extractedQuote) {
        const messageText = getMessageTextForParsing(msg);
        const parsed = parseMessageXML(messageText);
        if (
          parsed &&
          parsed.type === "otc_quote" &&
          parsed.data &&
          "tokenSymbol" in parsed.data
        ) {
          extractedQuote = parsed.data as OTCQuote;
        }
      }

      if (extractedQuote) {
        const newQuoteId = extractedQuote.quoteId;
        const prevQuoteId = previousQuoteIdRef.current;

        // Only update if quote actually changed
        if (prevQuoteId !== newQuoteId) {
          // Trigger glow effect only if there was a previous quote
          if (prevQuoteId) {
            dispatch({ type: "SET_OFFER_GLOWING", payload: true });
            setTimeout(() => {
              dispatch({ type: "SET_OFFER_GLOWING", payload: false });
            }, 5000);
          }

          // Update the ref and state
          previousQuoteIdRef.current = newQuoteId;
          dispatch({
            type: "SET_CURRENT_QUOTE",
            payload: extractedQuote,
          });
        }
        break;
      }
    }
  }, [messages]);

  // Extract marketData.priceUsd to a variable for static dependency checking
  const priceUsd = marketData?.priceUsd;

  // Set default quote when token is provided but no quote exists yet
  // This shows the minimum offer (worst terms) that user can accept or negotiate better
  useEffect(() => {
    // Only create default if we have a token and no current quote
    if (!token || currentQuote) return;

    // Don't create default while still loading messages (a quote might be there)
    if (isLoadingHistory) return;

    // Wait for consignment data to load to show accurate terms
    if (!consignmentData) return;

    // Extract chain from token ID (format: token-{chain}-{address})
    if (!token.id) {
      throw new Error("Token missing id field");
    }
    const tokenIdParts = token.id.split("-");
    if (tokenIdParts.length < 3) {
      throw new Error(`Invalid token ID format: ${token.id}`);
    }
    const tokenChain = tokenIdParts[1] as OTCQuote["tokenChain"];
    const validChains: OTCQuote["tokenChain"][] = [
      "ethereum",
      "base",
      "bsc",
      "solana",
    ];
    if (!validChains.includes(tokenChain)) {
      throw new Error(`Invalid chain in token ID: ${tokenChain}`);
    }

    // Calculate lockup months from days (starting terms for negotiable, actual for fixed)
    const lockupDays = consignmentData.startingLockupDays;
    const lockupMonths = Math.ceil(lockupDays / 30);

    // Extract token address from token ID (format: token-{chain}-{address})
    const tokenAddress = tokenIdParts.slice(2).join("-");
    if (!tokenAddress && !token.contractAddress) {
      throw new Error("Token missing both tokenId address and contractAddress");
    }

    // Create default quote with starting terms from consignment data
    const defaultQuote: OTCQuote = {
      quoteId: `default-${token.id}`,
      tokenAmount: consignmentData.totalAvailable,
      tokenAmountFormatted: formatRawTokenAmount(
        consignmentData.totalAvailable,
        token.decimals,
      ),
      tokenSymbol: token.symbol,
      tokenChain: tokenChain,
      tokenAddress: tokenAddress, // Include for direct lookup
      lockupMonths: lockupMonths,
      lockupDays: lockupDays,
      discountBps: consignmentData.startingDiscountBps,
      discountPercent: consignmentData.startingDiscountBps / 100,
      paymentCurrency: "USDC",
      // priceUsd is optional - use typeof check
      pricePerToken: typeof priceUsd === "number" ? priceUsd : undefined,
      totalValueUsd:
        typeof priceUsd === "number"
          ? (Number(consignmentData.totalAvailable) / 10 ** token.decimals) *
            priceUsd
          : undefined,
      status: "default",
      // Pass consignment properties for UI
      isFractionalized: consignmentData.hasFractionalized,
      isNegotiable: consignmentData.hasNegotiable,
      isFixedPrice: !consignmentData.hasFractionalized, // Fixed price only if NOT fractionalized
      // Link to primary consignment for on-chain execution
      consignmentId: consignmentData.primaryConsignmentId,
    };

    dispatch({
      type: "SET_CURRENT_QUOTE",
      payload: defaultQuote,
    });
  }, [token, currentQuote, isLoadingHistory, priceUsd, consignmentData]);

  const handleAcceptOffer = useCallback(() => {
    if (!currentQuote) {
      console.error("[Chat] Cannot accept offer - no quote available");
      return;
    }

    // Check if this is a default quote (not yet negotiated with agent)
    if (currentQuote.quoteId.startsWith("default-")) {
      // Default quote - prompt user to chat with agent first to get a real quote
      // We could auto-send a message, but for now just show the modal which will
      // request a quote if needed
      dispatch({ type: "SET_ACCEPT_MODAL", payload: true });
      return;
    }

    // Validate quote has required fields
    if (!currentQuote.quoteId) {
      console.error("[Chat] Quote missing quoteId - request a new quote");
      return;
    }

    // Determine required chain from quote
    const isSolanaQuote = currentQuote.tokenChain === "solana";
    const isEvmQuote =
      currentQuote.tokenChain === "base" ||
      currentQuote.tokenChain === "bsc" ||
      currentQuote.tokenChain === "ethereum";

    // If user is not connected at all, just open modal (it will show connect screen)
    if (!isConnected) {
      dispatch({ type: "SET_ACCEPT_MODAL", payload: true });
      return;
    }

    // User is connected - check if they're on the right chain
    const needsChainConnection = isSolanaQuote
      ? !solanaConnected
      : isEvmQuote
        ? !evmConnected
        : false;

    // If connected but to wrong chain, trigger connection flow for required chain
    if (needsChainConnection) {
      const requiredChain = isSolanaQuote ? "solana" : "evm";
      console.log(
        `[Chat] Quote requires ${requiredChain}, connecting wallet...`,
      );
      // Set active family first so Privy knows which chain to connect
      setActiveFamily(requiredChain);
      // Trigger Privy connect (user is already authenticated since isConnected is true)
      connectWallet();
      // Still open the modal - it will handle the chain mismatch state if connection fails
      dispatch({ type: "SET_ACCEPT_MODAL", payload: true });
      return;
    }

    // User is connected to the right chain, proceed normally
    dispatch({ type: "SET_ACCEPT_MODAL", payload: true });
  }, [
    currentQuote,
    isConnected,
    solanaConnected,
    evmConnected,
    connectWallet,
    setActiveFamily,
  ]);

  const handleClearChat = useCallback(async () => {
    if (!entityId) return;

    // Clear local storage for this wallet
    localStorage.removeItem(`otc-desk-room-${entityId}`);

    // Create a new room
    const newRoomId = await createNewRoom();
    if (!newRoomId) {
      throw new Error("Failed to create new room");
    }

    // Clear messages and reset state
    previousQuoteIdRef.current = null;
    dispatch({ type: "RESET_CHAT", payload: { roomId: newRoomId } });
  }, [entityId, createNewRoom]);

  const handleDealComplete = useCallback(async () => {
    // DO NOT close the modal - let it show the success state and handle its own redirect
    // The modal will redirect to /deal/[id] page after 2 seconds

    // Reset chat and create new room in the background
    if (!entityId) {
      console.warn(
        "[Chat] No entityId during deal completion - cannot reset chat",
      );
      return;
    }

    // Clear local storage for this wallet
    localStorage.removeItem(`otc-desk-room-${entityId}`);

    // Create a new room
    const newRoomId = await createNewRoom();
    if (!newRoomId) {
      // Still clear the old state even if new room creation failed
      previousQuoteIdRef.current = null;
      dispatch({ type: "SET_MESSAGES", payload: [] });
      dispatch({ type: "SET_CURRENT_QUOTE", payload: null });
      dispatch({ type: "SET_ROOM_ID", payload: null });
      return;
    }

    // Clear messages and reset state - this prepares a fresh chat for when user returns
    previousQuoteIdRef.current = null;
    dispatch({ type: "RESET_CHAT", payload: { roomId: newRoomId } });
  }, [entityId, createNewRoom]);

  // Unified connect handler - uses connectWallet if already authenticated, login if not
  const handleConnect = useCallback(() => {
    localStorage.setItem("otc-desk-connect-overlay-seen", "1");
    localStorage.setItem("otc-desk-connect-overlay-dismissed", "1");
    dispatch({ type: "SET_CONNECT_OVERLAY", payload: false });
    if (privyAuthenticated) {
      connectWallet();
    } else {
      login();
    }
  }, [privyAuthenticated, connectWallet, login]);

  // Memoized setters for child components
  const setInput = useCallback((value: string) => {
    dispatch({ type: "SET_INPUT", payload: value });
  }, []);

  const setShowConnectOverlay = useCallback((value: boolean) => {
    dispatch({ type: "SET_CONNECT_OVERLAY", payload: value });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <ChatBody
        messages={messages}
        isLoadingHistory={isLoadingHistory}
        isAgentThinking={isAgentThinking}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        inputDisabled={inputDisabled}
        isConnected={isConnected}
        messagesContainerRef={messagesContainerRef}
        textareaRef={textareaRef}
        showConnectOverlay={showConnectOverlay}
        setShowConnectOverlay={setShowConnectOverlay}
        currentQuote={currentQuote}
        onAcceptOffer={handleAcceptOffer}
        isOfferGlowing={isOfferGlowing}
        onClearChat={() =>
          dispatch({ type: "SET_CLEAR_CHAT_MODAL", payload: true })
        }
        onConnect={handleConnect}
        privyReady={privyReady}
        token={token}
        marketData={marketData}
      />
      {currentQuote && (
        <AcceptQuoteModal
          isOpen={showAcceptModal}
          onClose={() => dispatch({ type: "SET_ACCEPT_MODAL", payload: false })}
          initialQuote={currentQuote}
          onComplete={handleDealComplete}
        />
      )}

      {/* Clear Chat Confirmation Modal */}
      <Dialog
        open={showClearChatModal}
        onClose={() =>
          dispatch({ type: "SET_CLEAR_CHAT_MODAL", payload: false })
        }
      >
        <div className="bg-white dark:bg-zinc-900 max-w-md rounded-lg overflow-hidden">
          <h3 className="text-xl font-semibold bg-red-600 text-white mb-4 px-4 py-2 rounded-t-lg">
            Clear Chat History?
          </h3>
          <div className="p-4">
            <p className="text-zinc-600 dark:text-zinc-400 mb-6">
              This will permanently delete all messages and reset the
              agent&apos;s memory of your conversation. Your current quote will
              be reset to default terms. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() =>
                  dispatch({ type: "SET_CLEAR_CHAT_MODAL", payload: false })
                }
                color="dark"
              >
                <div className="px-4 py-2">Cancel</div>
              </Button>
              <Button onClick={handleClearChat} color="red">
                <div className="px-4 py-2">Reset</div>
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

function ChatHeader({
  apiQuote,
  onAcceptOffer,
  isOfferGlowing,
  onClearChat,
  isLoadingHistory,
}: {
  apiQuote: OTCQuote | null;
  onAcceptOffer: () => void;
  isOfferGlowing: boolean;
  onClearChat: () => void;
  isLoadingHistory: boolean;
}) {
  const currentQuote = apiQuote;

  // Format discount and lockup display
  const discountDisplay =
    currentQuote && currentQuote.discountPercent !== undefined
      ? `${currentQuote.discountPercent.toFixed(1)}% off`
      : null;

  const lockupDisplay =
    currentQuote && currentQuote.lockupDays !== undefined
      ? currentQuote.lockupDays >= 30
        ? `${Math.ceil(currentQuote.lockupDays / 30)}mo lockup`
        : `${currentQuote.lockupDays}d lockup`
      : null;

  return (
    <div className="flex-shrink-0 pb-3 border-b border-zinc-200 dark:border-zinc-800">
      {/* Header row with title and actions */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Negotiate a Deal
        </h2>
        {!isLoadingHistory && (
          <button
            onClick={onClearChat}
            className="text-xs text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition-colors"
          >
            Reset Chat
          </button>
        )}
      </div>

      {/* Offer card - shown when quote exists or loading */}
      {isLoadingHistory ? (
        <div className="mt-3 rounded-xl bg-gradient-to-r from-brand-500/10 to-brand-500/5 dark:from-brand-500/20 dark:to-brand-500/10 p-3 animate-pulse">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Quote details skeleton */}
            <div className="flex-1 min-w-0 flex items-start gap-3">
              {/* Badge skeleton */}
              <div className="h-7 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-full flex-shrink-0"></div>
              {/* Discount and lockup skeleton */}
              <div className="flex flex-col gap-1 min-w-0">
                <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
              </div>
            </div>
            {/* Button skeleton */}
            <div className="h-10 w-32 bg-zinc-200 dark:bg-zinc-800 rounded-lg"></div>
          </div>
        </div>
      ) : currentQuote ? (
        <div className="mt-3 rounded-xl bg-gradient-to-r from-brand-500/10 to-brand-500/5 dark:from-brand-500/20 dark:to-brand-500/10 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Quote details */}
            <div className="flex-1 min-w-0 flex items-start gap-3">
              {/* Offer Ready badge - left column */}
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-green-500/20 text-green-600 dark:bg-green-500/30 dark:text-green-400 flex-shrink-0">
                Offer Ready
              </span>
              {/* Discount and lockup - right column */}
              <div className="flex flex-col gap-1 min-w-0">
                {discountDisplay && (
                  <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                    {discountDisplay}
                  </span>
                )}
                {lockupDisplay && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {lockupDisplay}
                  </span>
                )}
              </div>
            </div>

            {/* Accept button */}
            <Button
              onClick={onAcceptOffer}
              className={`w-full sm:w-auto !h-10 !px-3 !py-1 !text-sm font-semibold transition-all duration-300 ${
                isOfferGlowing
                  ? "shadow-lg shadow-brand-500/50 ring-2 ring-brand-400 animate-pulse"
                  : ""
              }`}
              color="brand"
            >
              Accept Offer
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChatBody({
  messages,
  isLoadingHistory,
  isAgentThinking,
  input,
  setInput,
  handleSubmit,
  inputDisabled,
  isConnected,
  messagesContainerRef,
  textareaRef,
  showConnectOverlay,
  setShowConnectOverlay,
  currentQuote,
  onAcceptOffer,
  isOfferGlowing,
  onClearChat,
  onConnect,
  privyReady,
  token,
  marketData,
}: {
  messages: ChatMessage[];
  isLoadingHistory: boolean;
  isAgentThinking: boolean;
  input: string;
  setInput: (s: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  inputDisabled: boolean;
  isConnected: boolean;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  showConnectOverlay: boolean;
  setShowConnectOverlay: (v: boolean) => void;
  currentQuote: OTCQuote | null;
  onAcceptOffer: () => void;
  isOfferGlowing: boolean;
  onClearChat: () => void;
  onConnect: () => void;
  privyReady: boolean;
  token?: Token;
  marketData?: TokenMarketData | null;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Connect wallet overlay */}
      <Dialog
        open={showConnectOverlay}
        onClose={() => {
          localStorage.setItem("otc-desk-connect-overlay-seen", "1");
          localStorage.setItem("otc-desk-connect-overlay-dismissed", "1");
          setShowConnectOverlay(false);
        }}
      >
        <div className="w-full max-w-sm rounded-2xl overflow-hidden bg-zinc-50 dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-2xl mx-auto">
          <div className="relative w-full bg-gradient-to-br from-zinc-900 to-zinc-800 p-6 sm:p-8">
            <div
              aria-hidden
              className="absolute inset-0 opacity-20 bg-no-repeat bg-right-bottom"
              style={{
                backgroundImage: "url('/business.png')",
                backgroundSize: "contain",
              }}
            />
            <div className="relative z-10 flex flex-col items-center text-center">
              <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight mb-4">
                Sign in to continue
              </h2>
              <Button
                onClick={onConnect}
                disabled={!privyReady}
                color="brand"
                className="!px-6 !py-2.5 !text-base"
              >
                {privyReady ? "Connect Wallet" : "Loading..."}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem("otc-desk-connect-overlay-seen", "1");
                localStorage.setItem("otc-desk-connect-overlay-dismissed", "1");
                setShowConnectOverlay(false);
              }}
              className="absolute top-3 right-3 rounded-full bg-white/10 text-white hover:bg-white/20 p-1.5 transition-colors"
              aria-label="Close"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </Dialog>

      {/* Main chat container - fills available height */}
      <div className="relative flex flex-col flex-1 min-h-0 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
        {/* Token header - fixed at top when provided */}
        {token && (
          <div className="flex-shrink-0 p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800">
            <TokenHeader token={token} marketData={marketData ?? null} />
          </div>
        )}

        {/* Chat header with offer card */}
        <div className="flex-shrink-0 px-3 sm:px-4 pt-3 sm:pt-4">
          <ChatHeader
            apiQuote={currentQuote}
            onAcceptOffer={onAcceptOffer}
            isOfferGlowing={isOfferGlowing}
            onClearChat={onClearChat}
            isLoadingHistory={isLoadingHistory}
          />
        </div>

        {/* Messages area - scrollable, fills remaining space */}
        <div
          ref={messagesContainerRef}
          className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3"
        >
          {isLoadingHistory ? (
            <div className="space-y-4">
              {/* Skeleton messages */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-end gap-3 animate-pulse">
                  <div className="flex-shrink-0 w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4"></div>
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[200px] text-center px-4">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  Welcome to AI OTC Desk
                </h2>
                <p className="text-sm sm:text-base text-zinc-500 dark:text-zinc-400">
                  {isConnected
                    ? "Ask me about quotes and discounted token deals"
                    : "Connect your wallet to get a quote and start chatting"}
                </p>
              </div>
            </div>
          ) : (
            <>
              <ChatMessages
                messages={messages}
                citationsMap={{}}
                followUpPromptsMap={{}}
                onFollowUpClick={(prompt) => {
                  setInput(prompt);
                }}
                assistantAvatarUrl={token ? token.logoUrl : undefined}
                assistantName={token ? token.name : undefined}
              />
              {isAgentThinking && (
                <div className="flex items-center gap-2 py-4 text-zinc-600 dark:text-zinc-400">
                  <InlineSvgSpinner />
                  <span>Eliza is thinking...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Input area - pinned to bottom */}
        <div className="flex-shrink-0 p-3 sm:p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80">
          <TextareaWithActions
            ref={textareaRef}
            input={input}
            onInputChange={(e) => setInput(e.target.value)}
            onSubmit={handleSubmit}
            isLoading={isAgentThinking || inputDisabled || !isConnected}
            placeholder={
              isConnected
                ? currentQuote && currentQuote.tokenSymbol
                  ? `Negotiate a deal for $${currentQuote.tokenSymbol}`
                  : "Ask about available tokens or request a quote"
                : "Connect wallet to chat"
            }
          />
        </div>
      </div>
    </div>
  );
}

export default Chat;
