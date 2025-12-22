import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import Image from "next/image";
import { memo, useState } from "react";

import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { WalletAvatar } from "@/components/wallet-avatar";
import type { MarkdownOptions } from "@/types";
import type { Citation } from "@/types/chat";
import type { ChatMessage as ChatMessageType } from "@/types/chat-message";

// Define constants if needed, or use literals directly
const USER_NAME = "User";

interface ChatMessageProps {
  message: ChatMessageType;
  citations?: Citation[];
  followUpPrompts?: string[];
  onFollowUpClick?: (prompt: string) => void;
  assistantAvatarUrl?: string;
  assistantName?: string;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  citations,
  followUpPrompts,
  onFollowUpClick,
  assistantAvatarUrl,
  assistantName = "Eliza",
}: ChatMessageProps) {
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);

  // Null component to hide XML tags
  const NullComponent = () => null;

  // Reference component for citations
  const ReferenceComponent = ({
    children,
    index,
  }: {
    children?: React.ReactNode;
    index?: string | number;
  }) => {
    const citationIndex = typeof index === "string" ? Number(index) : (index ?? 0);
    const citation = citations?.find((_c, i) => i === citationIndex);

    // If citation not found in uniqueCitations, find first citation with same URL
    const displayCitation = uniqueCitations?.find((c) => c.url === citation?.url) || citation;

    return (
      <a
        href={displayCitation?.url}
        target="_blank"
        rel="noopener noreferrer"
        className={clsx([
          "inline-flex items-center justify-center",
          "align-super text-[0.6em] font-normal",
          "no-underline rounded-sm",
          "text-brand-500",
          "hover:text-brand-700",
          "py-0.5",
          "leading-none",
        ])}
      >
        [{children}]
      </a>
    );
  };

  const markdownOptions: MarkdownOptions = {
    forceBlock: true,
    overrides: {
      // Hide embedded XML quote blocks so React doesn't attempt to render unknown tags
      quote: NullComponent,
      // Extra safety: ignore all child tags that can appear inside <quote>
      quoteId: NullComponent,
      tokenAmount: NullComponent,
      tokenAmountFormatted: NullComponent,
      tokenSymbol: NullComponent,
      tokenName: NullComponent,
      lockupMonths: NullComponent,
      lockupDays: NullComponent,
      pricePerToken: NullComponent,
      totalValueUsd: NullComponent,
      discountBps: NullComponent,
      discountPercent: NullComponent,
      discountUsd: NullComponent,
      finalPriceUsd: NullComponent,
      paymentCurrency: NullComponent,
      paymentAmount: NullComponent,
      paymentSymbol: NullComponent,
      ethPrice: NullComponent,
      createdAt: NullComponent,
      status: NullComponent,
      message: NullComponent,
      reference: ReferenceComponent,
    },
  };

  // Deduplicate citations by URL and preserve order
  const uniqueCitations = citations?.reduce(
    (acc, current, idx) => {
      const existingCitation = acc.find((c) => c.url === current.url && c.index === idx);
      if (!existingCitation) {
        acc.push({ ...current, index: idx });
      }
      return acc;
    },
    [] as (Citation & { index: number })[],
  );

  // name is guaranteed to exist (validated above) - no optional chaining needed
  const isUser = message.name === USER_NAME || message.name.toLowerCase() === "user";

  // Parse message text - handle both raw text and structured content
  let messageText = "";
  if (typeof message.text === "string") {
    messageText = message.text;
  } else if (message.content?.text) {
    messageText = message.content.text;
  } else if (message.content) {
    messageText =
      typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  }

  // Clean up any XML artifacts or special formatting for agent messages
  const cleanMessageText = !isUser
    ? messageText
        .replace(/<\/?thought>/gi, "")
        .replace(/<\/?actions>/gi, "")
        .replace(/<\/?providers>/gi, "")
        .replace(/<\/?response>/gi, "")
        .replace(/<\/?text>/gi, "")
        // Remove embedded XML block between markers to avoid React rendering unknown tags
        .replace(/<!--\s*XML_START\s*-->[\s\S]*?<!--\s*XML_END\s*-->/gi, "")
        // Fallback: strip any bare <quote>...</quote> blocks if markers are missing
        .replace(/<quote[\s\S]*?<\/quote>/gi, "")
        .trim()
    : messageText;

  const bubbleBase = "px-4 py-3 rounded-2xl shadow-sm border";
  const bubbleAgent = "bg-zinc-900/90 border-white/10 text-zinc-200";
  const bubbleUser = "bg-zinc-800/80 border-zinc-700 text-zinc-100";

  return (
    <div data-testid={isUser ? "user-message" : "agent-message"} className="w-full group">
      <div className={clsx("flex items-end gap-3 mb-4", isUser ? "justify-end" : "justify-start")}>
        {!isUser && (
          <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center overflow-hidden rounded-full">
            <Image
              src={assistantAvatarUrl || "/tokens/eliza.svg"}
              alt={assistantName}
              width={48}
              height={48}
              className="object-cover w-full h-full rounded-full"
              unoptimized
            />
          </div>
        )}

        <div className={clsx(bubbleBase, isUser ? bubbleUser : bubbleAgent)}>
          {/* Message text */}
          <div
            className={clsx(
              "prose prose-zinc dark:prose-invert !max-w-full",
              "prose-headings:text-base prose-headings:font-medium",
              "prose-p:text-[15px] prose-p:leading-relaxed prose-p:my-0",
              "prose-ul:my-2 prose-ol:my-2",
              "prose-li:text-[15px]",
              "text-zinc-300",
            )}
          >
            <MemoizedMarkdown
              id={message.id}
              content={cleanMessageText}
              options={markdownOptions}
            />
          </div>

          {/* Display quote if present in message */}
          {/* {!isUser && messageText?.includes("<quote>") && (
            <div className="mt-3 -mx-1">
              <OTCQuoteDisplay messageText={messageText} />
            </div>
          )} */}

          {/* Citations */}
          {!isUser && uniqueCitations && uniqueCitations.length > 0 && (
            <div className="mt-3 text-xs">
              <button
                type="button"
                onClick={() => setIsSourcesExpanded(!isSourcesExpanded)}
                className="group flex items-center gap-1 py-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
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
                  {uniqueCitations.map((citation) => (
                    <a
                      key={citation.url}
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-center gap-1.5 max-w-sm text-zinc-400 hover:text-zinc-200"
                    >
                      <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      <div className="flex-1 truncate">
                        <MemoizedMarkdown
                          id={`citation-${message.id}-${citation.url}`}
                          content={citation.title}
                          options={{
                            wrapper: "span",
                            forceInline: true,
                            overrides: {
                              p: ({ children }: { children?: React.ReactNode }) => (
                                <span className="truncate">{children}</span>
                              ),
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
        </div>

        {isUser && message.senderId && (
          <div className="flex-shrink-0">
            <WalletAvatar address={message.senderId} size={48} />
          </div>
        )}
      </div>

      {/* Follow-up prompts outside bubble for breathing room */}
      {!isUser && followUpPrompts && followUpPrompts.length > 0 && (
        <div className="mt-2 ml-11 max-w-[72%] md:max-w-[60%]">
          <div className="flex flex-col gap-2">
            {followUpPrompts.map((prompt: string, index: number) => (
              <button
                type="button"
                key={`${prompt.slice(0, 30)}-${index}`}
                onClick={() => onFollowUpClick?.(prompt)}
                className={clsx([
                  "flex items-center justify-between",
                  "px-3 py-2 rounded-lg",
                  "border border-white/10",
                  "bg-zinc-900/70 hover:bg-zinc-900",
                  "text-zinc-300 hover:text-zinc-100",
                  "transition-all duration-200",
                  "group cursor-pointer",
                  "text-left text-sm",
                  "w-full",
                ])}
              >
                <span>{prompt}</span>
                <ArrowRightIcon className="w-3 h-3 text-zinc-400 group-hover:text-zinc-200 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
