export interface ChatMessageAction {
  type: string;
  content?: string;
  data?: Record<string, unknown>;
}

// Quote data structure from agent messages
export interface ChatMessageQuoteData {
  quoteId?: string;
  tokenAmount?: string | number;
  tokenSymbol?: string;
  chain?: string;
  lockupMonths?: number;
  lockupDays?: number;
  discountBps?: number;
  discountPercent?: number;
  paymentCurrency?: string;
  pricePerToken?: number;
  totalUsd?: number;
  discountedUsd?: number;
  createdAt?: string | number;
  status?: string;
}

// Content structure for messages - supports both plain text and structured content
export interface ChatMessageContent {
  text?: string;
  xml?: string;
  quote?: ChatMessageQuoteData;
  type?: string;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string | null | undefined;
  senderId: string;
  roomId: string;
  createdAt: number;
  source: string;
  isLoading?: boolean;
  thought?: string;
  isUserMessage?: boolean;
  serverMessageId?: string;
  content?: ChatMessageContent; // For messages that have structured content
  actions?: ChatMessageAction[];
}
