import { v4 as uuidv4 } from "uuid";

interface Message {
  id: string;
  userId: string;
  agentId: string;
  content: {
    text: string;
    attachments?: any[];
  };
  createdAt: number;
  isAgent: boolean;
}

interface Conversation {
  id: string;
  createdAt: number;
  lastMessage?: string;
  lastMessageAt?: number;
}

export class ConversationClient {
  private userId: string;
  private currentConversationId: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastMessageTimestamp: number = 0;

  constructor() {
    // Check if we're in the browser
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      // Generate or retrieve user ID from local storage
      const storedUserId = localStorage.getItem("userId");
      if (storedUserId) {
        this.userId = storedUserId;
      } else {
        this.userId = uuidv4();
        localStorage.setItem("userId", this.userId);
      }

      // Retrieve current conversation from local storage
      const storedConversationId = localStorage.getItem(
        "currentConversationId",
      );
      if (storedConversationId) {
        this.currentConversationId = storedConversationId;
      }
    } else {
      // Server-side or no localStorage support
      this.userId = uuidv4();
    }
  }

  // Get or create current conversation
  async getCurrentConversation(): Promise<string> {
    if (this.currentConversationId) {
      // Verify the conversation still exists
      try {
        const response = await fetch(
          `/api/conversations/${this.currentConversationId}`,
        );
        if (response.ok) {
          return this.currentConversationId;
        }
      } catch (error) {
        console.error("Failed to verify conversation:", error);
      }
    }

    // Create new conversation
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: this.userId,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create conversation");
    }

    const data = await response.json();
    this.currentConversationId = data.conversationId;
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("currentConversationId", this.currentConversationId);
    }
    return this.currentConversationId;
  }

  // Get user's conversations
  async getUserConversations(): Promise<Conversation[]> {
    const response = await fetch(
      `/api/conversations?userId=${encodeURIComponent(this.userId)}`,
    );

    if (!response.ok) {
      throw new Error("Failed to get conversations");
    }

    const data = await response.json();
    return data.conversations;
  }

  // Get messages for current conversation
  async getMessages(afterTimestamp?: number): Promise<Message[]> {
    const conversationId = await this.getCurrentConversation();

    let url = `/api/conversations/${conversationId}/messages`;
    if (afterTimestamp) {
      url += `?afterTimestamp=${afterTimestamp}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Failed to get messages");
    }

    const data = await response.json();

    // Update last message timestamp
    if (data.messages.length > 0) {
      this.lastMessageTimestamp = Math.max(
        ...data.messages.map((m: Message) => m.createdAt),
      );
    }

    return data.messages;
  }

  // Send a message
  async sendMessage(text: string, attachments?: any[]): Promise<Message> {
    const conversationId = await this.getCurrentConversation();

    const response = await fetch(
      `/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: this.userId,
          text,
          attachments,
        }),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to send message");
    }

    const data = await response.json();

    // Start polling for responses
    if (data.pollForResponse) {
      this.startPolling(data.pollDuration || 30000, data.pollInterval || 1000);
    }

    return data.message;
  }

  // Start polling for new messages
  startPolling(
    duration: number,
    interval: number,
    onNewMessage?: (messages: Message[]) => void,
  ) {
    this.stopPolling(); // Stop any existing polling

    const startTime = Date.now();

    this.pollingInterval = setInterval(async () => {
      try {
        // Check if we've exceeded the duration
        if (Date.now() - startTime > duration) {
          this.stopPolling();
          return;
        }

        // Get new messages since last timestamp
        const messages = await this.getMessages(this.lastMessageTimestamp);

        if (messages.length > 0 && onNewMessage) {
          onNewMessage(messages);
        }
      } catch (error) {
        console.error("Error polling for messages:", error);
      }
    }, interval);
  }

  // Stop polling
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  // Switch conversation
  async switchConversation(conversationId: string) {
    this.currentConversationId = conversationId;
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("currentConversationId", conversationId);
    }
    this.lastMessageTimestamp = 0;
    this.stopPolling();
  }

  // Create new conversation
  async createNewConversation(): Promise<string> {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: this.userId,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create conversation");
    }

    const data = await response.json();
    this.currentConversationId = data.conversationId;
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("currentConversationId", this.currentConversationId);
    }
    this.lastMessageTimestamp = 0;
    this.stopPolling();
    return this.currentConversationId;
  }

  // Clear current conversation
  clearCurrentConversation() {
    this.currentConversationId = null;
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.removeItem("currentConversationId");
    }
    this.lastMessageTimestamp = 0;
    this.stopPolling();
  }

  // Get user ID
  getUserId(): string {
    return this.userId;
  }

  // Get current conversation ID
  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }
}

// Create a singleton instance only on the client side
let conversationClientInstance: ConversationClient | null = null;

export const conversationClient = {
  getInstance(): ConversationClient {
    if (typeof window === "undefined") {
      // Return a new instance for server-side rendering
      return new ConversationClient();
    }

    // Use singleton on client side
    if (!conversationClientInstance) {
      conversationClientInstance = new ConversationClient();
    }
    return conversationClientInstance;
  },

  // Proxy methods for easier access
  async getCurrentConversation(): Promise<string> {
    return this.getInstance().getCurrentConversation();
  },

  async getUserConversations(): Promise<Conversation[]> {
    return this.getInstance().getUserConversations();
  },

  async getMessages(afterTimestamp?: number): Promise<Message[]> {
    return this.getInstance().getMessages(afterTimestamp);
  },

  async sendMessage(text: string, attachments?: any[]): Promise<Message> {
    return this.getInstance().sendMessage(text, attachments);
  },

  startPolling(
    duration: number,
    interval: number,
    onNewMessage?: (messages: Message[]) => void,
  ) {
    return this.getInstance().startPolling(duration, interval, onNewMessage);
  },

  stopPolling() {
    return this.getInstance().stopPolling();
  },

  async switchConversation(conversationId: string) {
    return this.getInstance().switchConversation(conversationId);
  },

  async createNewConversation(): Promise<string> {
    return this.getInstance().createNewConversation();
  },

  clearCurrentConversation() {
    return this.getInstance().clearCurrentConversation();
  },

  getUserId(): string {
    return this.getInstance().getUserId();
  },

  getCurrentConversationId(): string | null {
    return this.getInstance().getCurrentConversationId();
  },
};
