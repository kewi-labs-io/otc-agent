"use client";

import { useEffect, useRef } from "react";

import { ChatMessage } from "@/components/chat-message";
import { USER_NAME } from "@/constants";
import { Citation } from "@/types/chat";
import { ChatMessage as ChatMessageType } from "@/types/chat-message";

interface ChatMessagesProps {
  messages: ChatMessageType[];
  citationsMap: Record<number, Citation[]>;
  followUpPromptsMap: Record<number, string[]>;
  onFollowUpClick: (prompt: string) => void;
  assistantAvatarUrl?: string;
  assistantName?: string;
}

export function ChatMessages({
  messages,
  citationsMap,
  followUpPromptsMap,
  onFollowUpClick,
  assistantAvatarUrl,
  assistantName,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<string>("");

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }, 100);
  };

  useEffect(() => {
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];

    // FAIL-FAST: Message must have text
    if (
      !lastMessage ||
      lastMessage.text === undefined ||
      lastMessage.text === null
    ) {
      throw new Error(
        `Last message missing text: ${lastMessage?.id || "unknown"}`,
      );
    }
    const currentText = lastMessage.text;
    const isNewMessage = currentText !== lastMessageRef.current;

    if (isNewMessage) {
      lastMessageRef.current = currentText;
      scrollToBottom("instant");
    }
  }, [messages]);

  // Get last message for effect dependencies (can be null if no messages)
  const lastMessage =
    messages.length > 0 ? messages[messages.length - 1] : null;

  // Extract fields for dependencies - only if message exists (validated in effect)
  const lastMessageName = lastMessage ? lastMessage.name : null;
  const lastMessageText = lastMessage ? lastMessage.text : null;

  useEffect(() => {
    if (!messages.length) return;
    const lastMessage = messages[messages.length - 1];

    // FAIL-FAST: Message must have required fields
    if (!lastMessage) {
      throw new Error("Last message is null or undefined");
    }
    if (!lastMessage.name) {
      throw new Error(`Last message missing name: ${lastMessage.id}`);
    }
    if (lastMessage.text === undefined || lastMessage.text === null) {
      throw new Error(`Last message missing text: ${lastMessage.id}`);
    }

    // At this point, lastMessage.name and lastMessage.text are guaranteed to exist
    const isUserMessage = lastMessage.name === USER_NAME;
    const hasContent = lastMessage.text.trim() !== "";

    if (isUserMessage && hasContent) {
      scrollToBottom("smooth");
    }
  }, [lastMessageName, lastMessageText, messages]);

  return (
    <div className="flex flex-col">
      {messages.map((message, i) => {
        // Use a combination of message id/timestamp and index to ensure uniqueness
        const messageKey = `${message.id || message.createdAt || i}_${i}`;

        const assistantIndex =
          message.name !== USER_NAME
            ? messages.slice(0, i + 1).filter((m) => m.name !== USER_NAME)
                .length - 1
            : -1;

        return (
          <div
            key={messageKey}
            ref={i === messages.length - 1 ? messagesEndRef : undefined}
          >
            <ChatMessage
              message={message}
              i={i}
              citations={
                message.name !== USER_NAME ? citationsMap[i] : undefined
              }
              followUpPrompts={
                message.name !== USER_NAME
                  ? followUpPromptsMap[assistantIndex]
                  : undefined
              }
              onFollowUpClick={onFollowUpClick}
              assistantAvatarUrl={assistantAvatarUrl}
              assistantName={assistantName}
            />
          </div>
        );
      })}
    </div>
  );
}
