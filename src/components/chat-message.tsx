import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LinkIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { memo, useState } from "react";
import Image from "next/image";

import { CodeBlock } from "@/components/code-block";
import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { OTCQuoteDisplay } from "@/components/quote-display";
import { Citation } from "@/types/chat";
import { ChatMessage as ChatMessageType } from "@/types/chat-message";

// Define constants if needed, or use literals directly
const USER_NAME = "User";
const ASSISTANT_NAME = "Eliza";

interface ChatMessageProps {
  message: ChatMessageType;
  i: number;
  citations?: Citation[];
  followUpPrompts?: string[];
  onFollowUpClick?: (prompt: string) => void;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  i,
  citations,
  followUpPrompts,
  onFollowUpClick,
}: ChatMessageProps) {
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);

  // Generous parsing - handle various message formats
  if (!message || typeof message !== "object") return null;
  
  // Ensure we have required fields with defaults
  const safeMessage = {
    ...message,
    name: message.name || "Unknown",
    text: message.text || "",
    id: message.id || `msg-${i}`,
    createdAt: message.createdAt || Date.now(),
  };

  const markdownOptions = {
    forceBlock: true,
    overrides: {
      code: {
        component: CodeBlock,
      },
      reference: {
        component: ({ children, index }) => {
          const citationIndex = Number(index);
          const citation = citations?.find((c, i) => i === citationIndex);

          // If citation not found in uniqueCitations, find first citation with same URL
          const displayCitation =
            uniqueCitations?.find((c) => c.url === citation?.url) || citation;

          return (
            <a
              href={displayCitation?.url}
              target="_blank"
              rel="noopener noreferrer"
              className={clsx([
                "inline-flex items-center justify-center",
                "align-super text-[0.6em] font-normal",
                "no-underline rounded-sm",
                "text-[#ff8c00]",
                "hover:text-[#cc7000]",
                "py-0.5",
                "leading-none",
              ])}
            >
              [{children}]
            </a>
          );
        },
      },
    },
  };

  // Deduplicate citations by URL and preserve order
  const uniqueCitations = citations?.reduce(
    (acc, current, idx) => {
      const existingCitation = acc.find(
        (c) => c.url === current.url && c.index === idx,
      );
      if (!existingCitation) {
        acc.push({ ...current, index: idx });
      }
      return acc;
    },
    [] as (Citation & { index: number })[],
  );

  const isUser = safeMessage.name === USER_NAME || safeMessage.name?.toLowerCase() === "user";
  const displayName = isUser ? USER_NAME : ASSISTANT_NAME;
  
  // Parse message text - handle both raw text and structured content
  let messageText = "";
  if (typeof safeMessage.text === "string") {
    messageText = safeMessage.text;
  } else if ((safeMessage as any).content?.text) {
    messageText = (safeMessage as any).content.text;
  } else if ((safeMessage as any).content) {
    messageText = typeof (safeMessage as any).content === "string" ? (safeMessage as any).content : JSON.stringify((safeMessage as any).content);
  }
  
  // Clean up any XML artifacts or special formatting for agent messages
  const cleanMessageText = !isUser ? messageText
    .replace(/<\/?thought>/gi, "")
    .replace(/<\/?actions>/gi, "")
    .replace(/<\/?providers>/gi, "")
    .replace(/<\/?response>/gi, "")
    .replace(/<\/?text>/gi, "")
    .trim() : messageText;

  return (
    <div
      data-testid={isUser ? "user-message" : "agent-message"}
      className={clsx(
        "w-full group",
        i !== 0 ? "border-t pt-6 border-zinc-950/5 dark:border-white/5" : "",
      )}
    >
      <div className="flex gap-4">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <UserCircleIcon className="w-5 h-5 text-white" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center overflow-hidden">
              <Image
                src="/eliza-white.png"
                alt="Eliza"
                width={24}
                height={24}
                className="object-contain"
              />
            </div>
          )}
        </div>

        {/* Message Content */}
        <div className="flex-1 min-w-0">
          {/* Name and timestamp */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
              {displayName}
            </span>
            {safeMessage.createdAt && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(safeMessage.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            )}
          </div>

          {/* Message text */}
          <div
            className={clsx(
              "prose prose-zinc dark:prose-invert !max-w-full",
              "prose-headings:text-base prose-headings:font-medium",
              "prose-p:text-[15px] prose-p:leading-relaxed prose-p:my-0",
              "prose-ul:my-2 prose-ol:my-2",
              "prose-li:text-[15px]",
              "text-zinc-700 dark:text-zinc-300",
            )}
          >
            <MemoizedMarkdown
              id={safeMessage.id || `msg-${i}-${safeMessage.createdAt}`}
              content={cleanMessageText}
              options={markdownOptions}
            />
          </div>


          {/* Display quote if present in message */}
          {!isUser && messageText?.includes("<quote>") && (
            <div className="mt-3">
              <OTCQuoteDisplay messageText={messageText} />
            </div>
          )}

          {/* Citations */}
          {!isUser && uniqueCitations && uniqueCitations.length > 0 && (
            <div className="mt-3 text-sm">
              <button
                onClick={() => setIsSourcesExpanded(!isSourcesExpanded)}
                className="group flex items-center gap-1 py-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
              >
                <span className="font-medium">
                  {uniqueCitations.length} source
                  {uniqueCitations.length > 1 ? "s" : ""}
                </span>
                <div className="flex items-center justify-center w-4 h-4">
                  {isSourcesExpanded ? (
                    <ChevronUpIcon className="w-3 h-3" />
                  ) : (
                    <ChevronDownIcon className="w-3 h-3" />
                  )}
                </div>
              </button>

              {isSourcesExpanded && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {uniqueCitations.map((citation, index) => (
                    <a
                      key={index}
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-center gap-1.5 max-w-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    >
                      <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      <div className="flex-1 truncate">
                        <MemoizedMarkdown
                          id={`citation-${safeMessage.id}-${index}`}
                          content={citation.title}
                          options={{
                            wrapper: "span",
                            forceInline: true,
                            overrides: {
                              p: {
                                component: "span",
                                props: {
                                  className: "truncate",
                                },
                              },
                            },
                          }}
                        />
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Follow-up prompts */}
          {!isUser && followUpPrompts?.length > 0 && (
            <div className="mt-4">
              <div className="flex flex-col gap-2">
                {followUpPrompts.map((prompt, index) => (
                  <button
                    key={index}
                    onClick={() => onFollowUpClick?.(prompt)}
                    className={clsx([
                      "flex items-center justify-between",
                      "px-3 py-2 rounded-lg",
                      "border border-zinc-950/10 dark:border-white/10",
                      "bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800",
                      "text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100",
                      "transition-all duration-200",
                      "group cursor-pointer",
                      "text-left text-sm",
                      "w-full",
                    ])}
                  >
                    <span>{prompt}</span>
                    <ArrowRightIcon className="w-3 h-3 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
