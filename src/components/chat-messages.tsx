"use client";

import { useCallback, useEffect, useRef } from "react";

import { ChatMessage } from "@/components/chat-message";
import { USER_NAME } from "@/constants";
import type { Citation } from "@/types/chat";
import type { ChatMessage as ChatMessageType } from "@/types/chat-message";

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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }, 100);
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const currentText = lastMessage.text;

    if (currentText !== lastMessageRef.current) {
      lastMessageRef.current = currentText;
      scrollToBottom("instant");
    }
  }, [messages, scrollToBottom]);

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const _lastMessageName = lastMessage?.name ?? null;
  const _lastMessageText = lastMessage?.text ?? null;

  useEffect(() => {
    if (!lastMessage) return;

    const isUserMessage = lastMessage.name === USER_NAME;
    const hasContent = lastMessage.text.trim() !== "";

    if (isUserMessage && hasContent) {
      scrollToBottom("smooth");
    }
  }, [lastMessage, scrollToBottom]);

  return (
    <div className="flex flex-col">
      {messages.map((message, i) => {
        // Use a combination of message id/timestamp and index to ensure uniqueness
        const messageKey = `${message.id || message.createdAt || i}_${i}`;

        const assistantIndex =
          message.name !== USER_NAME
            ? messages.slice(0, i + 1).filter((m) => m.name !== USER_NAME).length - 1
            : -1;

        return (
          <div key={messageKey} ref={i === messages.length - 1 ? messagesEndRef : undefined}>
            <ChatMessage
              message={message}
              citations={message.name !== USER_NAME ? citationsMap[i] : undefined}
              followUpPrompts={
                message.name !== USER_NAME ? followUpPromptsMap[assistantIndex] : undefined
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
