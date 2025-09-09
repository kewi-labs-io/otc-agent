"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import { ChatMessages } from "@/components/chat-messages";
import { TextareaWithActions } from "@/components/textarea-with-actions";
import { ChatSessions } from "@/components/chat-sessions";
import { Button } from "@/components/button";
import { USER_NAME, CHAT_SOURCE } from "@/constants";
import type { ChatMessage } from "@/types/chat-message";

// Simple spinner component
const LoadingSpinner = () => (
  <svg
    className="animate-spin h-4 w-4 text-zinc-600 dark:text-zinc-400"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

interface ChatProps {
  conversationId?: string;
}

export const Chat = ({
  conversationId: propConversationId,
}: ChatProps = {}) => {
  // --- State ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [inputDisabled, setInputDisabled] = useState<boolean>(false);
  const [conversationId, setConversationId] = useState<string | null>(
    propConversationId || null,
  );
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [isAgentThinking, setIsAgentThinking] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(null);

  // --- Refs ---
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageTimestampRef = useRef<number>(0);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Format time ago utility
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Initialize user on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Generate or retrieve user ID from localStorage
      let storedUserId = localStorage.getItem("otc-desk-user-id");
      if (!storedUserId) {
        storedUserId = `user-${uuidv4()}`;
        localStorage.setItem("otc-desk-user-id", storedUserId);
      }
      setUserId(storedUserId);

      // Retrieve current conversation ID from localStorage
      const storedConversationId = localStorage.getItem(
        "otc-desk-conversation-id",
      );
      if (storedConversationId && !propConversationId) {
        setConversationId(storedConversationId);
      }
    }
  }, [propConversationId]);

  // Function to create a new conversation
  const createNewConversation = useCallback(async () => {
    if (!userId) return null;

    try {

      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        throw new Error("Failed to create conversation");
      }

      const data = await response.json();
      const newConversationId = data.conversationId;


      setConversationId(newConversationId);
      localStorage.setItem("otc-desk-conversation-id", newConversationId);
      setMessages([]);

      return newConversationId;
    } catch (error) {
      throw error;
      return null;
    }
  }, [userId]);

  // Load conversation data
  useEffect(() => {
    if (!conversationId || !userId) return;

    const loadConversation = async () => {
      try {
        setIsLoadingHistory(true);

        const response = await fetch(
          `/api/conversations/${conversationId}/messages`,
        );

        if (response.ok) {
          const data = await response.json();
          const messages = data.messages || [];


          // Format messages for display with generous parsing
          const formattedMessages = messages.map((msg: any) => {
            // Parse message text from various possible formats
            let messageText = "";
            if (msg.content?.text) {
              messageText = msg.content.text;
            } else if (msg.text) {
              messageText = msg.text;
            } else if (msg.content && typeof msg.content === "string") {
              messageText = msg.content;
            } else if (msg.content) {
              messageText = JSON.stringify(msg.content);
            }
            
            return {
              id: msg.id || `msg-${msg.createdAt}`,
              name: msg.isAgent ? "Eliza" : USER_NAME,
              text: messageText,
              senderId: msg.userId,
              roomId: conversationId,
              createdAt: new Date(msg.createdAt).getTime(),
              source: CHAT_SOURCE,
              isLoading: false,
            };
          });

          setMessages(formattedMessages);

          // Update last message timestamp
          if (formattedMessages.length > 0) {
            lastMessageTimestampRef.current =
              formattedMessages[formattedMessages.length - 1].createdAt;
          }
        }
      } catch (error) {
        throw error;
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadConversation();
  }, [conversationId, userId]);

  // Poll for new messages when agent is thinking
  useEffect(() => {
    if (!isAgentThinking || !conversationId) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }


    // Poll every second for new messages
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/conversations/${conversationId}/messages?afterTimestamp=${lastMessageTimestampRef.current}`,
        );

        if (response.ok) {
          const data = await response.json();
          const newMessages = data.messages || [];

          if (newMessages.length > 0) {

            const formattedMessages = newMessages.map((msg: any) => {
              // Parse message text from various possible formats
              let messageText = "";
              if (msg.content?.text) {
                messageText = msg.content.text;
              } else if (msg.text) {
                messageText = msg.text;
              } else if (msg.content && typeof msg.content === "string") {
                messageText = msg.content;
              } else if (msg.content) {
                messageText = JSON.stringify(msg.content);
              }
              
              return {
                id: msg.id || `msg-${msg.createdAt}`,
                name: msg.isAgent ? "Eliza" : USER_NAME,
                text: messageText,
                senderId: msg.userId,
                roomId: conversationId,
                createdAt: new Date(msg.createdAt).getTime(),
                source: CHAT_SOURCE,
                isLoading: false,
              };
            });

            setMessages((prev) => {
              const byId = new Map<string, any>();
              prev.forEach((m) => byId.set(m.id, m));
              formattedMessages.forEach((m: any) => byId.set(m.id, m));
              const merged = Array.from(byId.values());
              merged.sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0));
              return merged;
            });

            // Update last message timestamp
            const lastNewMessage =
              formattedMessages[formattedMessages.length - 1];
            lastMessageTimestampRef.current = lastNewMessage.createdAt;

            // Check if we received an agent message
            const hasAgentMessage = newMessages.some((msg: any) => msg.isAgent);
            if (hasAgentMessage) {
              setIsAgentThinking(false);
              setInputDisabled(false);
            }
          }
        }
      } catch (error) {
        // Ignore polling errors - they're expected when messages aren't ready
      }
    }, 1000);

    // Stop polling after 30 seconds
    setTimeout(() => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        setIsAgentThinking(false);
        setInputDisabled(false);
      }
    }, 30000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isAgentThinking, conversationId]);

  // Send message function
  const sendMessage = useCallback(
    async (messageText: string) => {
      if (!messageText.trim() || !userId || !conversationId || inputDisabled) {
        throw new Error("Cannot send message: missing required data");
      }

      // Add user message to UI immediately with a client-generated ID
      const clientMessageId = uuidv4();
      const userMessage: ChatMessage = {
        id: clientMessageId,
        name: USER_NAME,
        text: messageText,
        senderId: userId,
        roomId: conversationId,
        createdAt: Date.now(),
        source: CHAT_SOURCE,
        isLoading: false,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsAgentThinking(true);
      setInputDisabled(true);

      try {

        // Send message via API
        const response = await fetch(
          `/api/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              text: messageText,
              clientMessageId,
            }),
          },
        );

        if (!response.ok) {
          throw new Error("Failed to send message");
        }

        // Prefer server timestamp to avoid client/server clock skew missing agent replies
        try {
          const result = await response.json();
          const serverCreatedAt = result?.message?.createdAt
            ? new Date(result.message.createdAt).getTime()
            : undefined;
          if (
            typeof serverCreatedAt === "number" &&
            !Number.isNaN(serverCreatedAt)
          ) {
            // Subtract 1ms to include any agent messages written at the same DB timestamp second
            lastMessageTimestampRef.current = Math.max(
              lastMessageTimestampRef.current,
              serverCreatedAt - 1,
            );
          }
        } catch {
          // If parsing fails, fall back to previous timestamp; polling will still pick up messages
        }
      } catch (error) {
        setIsAgentThinking(false);
        setInputDisabled(false);
        setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id));
        throw error;
      }
    },
    [userId, conversationId, inputDisabled],
  );

  // Handle form submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim()) {
        sendMessage(input.trim());
        setInput("");
      }
    },
    [input, sendMessage],
  );

  // Handle creating a new conversation when there isn't one
  useEffect(() => {
    if (!conversationId && userId) {
      // Automatically create a conversation when the component loads without one
      createNewConversation();
    }
  }, [conversationId, userId, createNewConversation]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background image: bottom-right behind chat */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: "url('/business.png')",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right bottom",
          backgroundSize: "auto 45%",
          opacity: 0.15,
        }}
      />

      {/* Centered chat container */}
      <div className="relative z-10 flex items-center justify-center min-h-screen px-4">
        <div className="w-full max-w-4xl mx-auto flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md shadow-sm p-4 md:p-6 my-6 max-h-[calc(100vh-4rem)]">
          {/* Header Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="text-zinc-600 dark:text-zinc-400 text-sm">
                  {messages.length} messages
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => createNewConversation()} color="blue">
                  Clear Chat
                </Button>
              </div>
            </div>
          </div>

          {/* Chat Messages - scrollable area */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto pr-1">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center h-32">
                <div className="flex items-center gap-2">
                  <LoadingSpinner />
                  <span className="text-gray-600">Loading conversation...</span>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-center">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                    Welcome to ELIZA OTC Desk
                  </h2>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    Ask me about quotes for ELIZA tokens!
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
                />
                {isAgentThinking && (
                  <div className="flex items-center gap-2 py-4 text-gray-600">
                    <LoadingSpinner />
                    <span>Eliza is thinking...</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Input Area - inside centered container */}
          <div className="pt-4">
            <TextareaWithActions
              input={input}
              onInputChange={(e) => setInput(e.target.value)}
              onSubmit={handleSubmit}
              isLoading={isAgentThinking || inputDisabled}
              placeholder="Ask about quotes for ELIZA tokens..."
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;
