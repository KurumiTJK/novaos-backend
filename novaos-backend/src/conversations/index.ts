// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION MODULE — History Persistence + Context Management
// ═══════════════════════════════════════════════════════════════════════════════

import { getStore, type KeyValueStore } from '../storage/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    stance?: string;
    status?: string;
    tokensUsed?: number;
    gateResults?: Record<string, any>;
  };
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  totalTokens: number;
  metadata?: {
    lastStance?: string;
    tags?: string[];
  };
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ContextWindow {
  messages: Message[];
  totalTokens: number;
  truncated: boolean;
  oldestIncluded: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

const MAX_CONTEXT_TOKENS = 8000;  // Leave room for response
const MAX_MESSAGES_IN_CONTEXT = 50;
const CONVERSATION_TTL_DAYS = 30;
const CONVERSATION_TTL_SECONDS = CONVERSATION_TTL_DAYS * 24 * 60 * 60;

// ─────────────────────────────────────────────────────────────────────────────────
// CONVERSATION STORE
// ─────────────────────────────────────────────────────────────────────────────────

export class ConversationStore {
  constructor(private store: KeyValueStore) {}

  private getConversationKey(conversationId: string): string {
    return `conv:${conversationId}`;
  }

  private getUserConversationsKey(userId: string): string {
    return `user:${userId}:conversations`;
  }

  private getMessagesKey(conversationId: string): string {
    return `conv:${conversationId}:messages`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERSATION CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  async create(userId: string, conversationId: string, title?: string): Promise<Conversation> {
    const now = Date.now();
    const conversation: Conversation = {
      id: conversationId,
      userId,
      title: title ?? 'New Conversation',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      totalTokens: 0,
    };

    // Store conversation
    await this.store.set(
      this.getConversationKey(conversationId),
      JSON.stringify(conversation),
      CONVERSATION_TTL_SECONDS
    );

    // Add to user's conversation list
    await this.store.lpush(
      this.getUserConversationsKey(userId),
      conversationId
    );

    return conversation;
  }

  async get(conversationId: string): Promise<Conversation | null> {
    const data = await this.store.get(this.getConversationKey(conversationId));
    return data ? JSON.parse(data) : null;
  }

  async update(conversationId: string, updates: Partial<Conversation>): Promise<Conversation | null> {
    const conversation = await this.get(conversationId);
    if (!conversation) return null;

    const updated: Conversation = {
      ...conversation,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.store.set(
      this.getConversationKey(conversationId),
      JSON.stringify(updated),
      CONVERSATION_TTL_SECONDS
    );

    return updated;
  }

  async delete(conversationId: string): Promise<boolean> {
    const conversation = await this.get(conversationId);
    if (!conversation) return false;

    // Delete conversation data
    await this.store.delete(this.getConversationKey(conversationId));
    
    // Delete messages
    await this.store.delete(this.getMessagesKey(conversationId));

    // Note: We don't remove from user list (would require list manipulation)
    // The list will naturally clean up when conversations are fetched

    return true;
  }

  async getOrCreate(userId: string, conversationId: string): Promise<Conversation> {
    const existing = await this.get(conversationId);
    if (existing) return existing;
    return this.create(userId, conversationId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // USER CONVERSATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  async listUserConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Conversation[]> {
    const conversationIds = await this.store.lrange(
      this.getUserConversationsKey(userId),
      offset,
      offset + limit - 1
    );

    const conversations: Conversation[] = [];
    for (const id of conversationIds) {
      const conv = await this.get(id);
      if (conv) {
        conversations.push(conv);
      }
    }

    // Sort by updatedAt descending
    return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  async addMessage(conversationId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const fullMessage: Message = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    // Add to messages list
    await this.store.lpush(
      this.getMessagesKey(conversationId),
      JSON.stringify(fullMessage)
    );

    // Update conversation stats
    const conversation = await this.get(conversationId);
    if (conversation) {
      await this.update(conversationId, {
        messageCount: conversation.messageCount + 1,
        totalTokens: conversation.totalTokens + (message.metadata?.tokensUsed ?? 0),
        metadata: {
          ...conversation.metadata,
          lastStance: message.metadata?.stance,
        },
      });

      // Auto-generate title from first user message
      if (conversation.messageCount === 0 && message.role === 'user') {
        const title = this.generateTitle(message.content);
        await this.update(conversationId, { title });
      }
    }

    return fullMessage;
  }

  async getMessages(
    conversationId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<Message[]> {
    const data = await this.store.lrange(
      this.getMessagesKey(conversationId),
      offset,
      offset + limit - 1
    );

    // Messages are stored newest first, reverse for chronological order
    return data.map(d => JSON.parse(d)).reverse();
  }

  async getFullConversation(conversationId: string): Promise<ConversationWithMessages | null> {
    const conversation = await this.get(conversationId);
    if (!conversation) return null;

    const messages = await this.getMessages(conversationId);

    return {
      ...conversation,
      messages,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTEXT WINDOW MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  async buildContextWindow(
    conversationId: string,
    maxTokens: number = MAX_CONTEXT_TOKENS,
    maxMessages: number = MAX_MESSAGES_IN_CONTEXT
  ): Promise<ContextWindow> {
    const messages = await this.getMessages(conversationId, maxMessages * 2);
    
    let totalTokens = 0;
    let truncated = false;
    const includedMessages: Message[] = [];

    // Work backwards from most recent, estimate tokens
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      
      const estimatedTokens = this.estimateTokens(msg.content);

      if (totalTokens + estimatedTokens > maxTokens || includedMessages.length >= maxMessages) {
        truncated = true;
        break;
      }

      includedMessages.unshift(msg);
      totalTokens += estimatedTokens;
    }

    return {
      messages: includedMessages,
      totalTokens,
      truncated,
      oldestIncluded: includedMessages[0]?.timestamp ?? 0,
    };
  }

  formatContextForLLM(contextWindow: ContextWindow): { role: string; content: string }[] {
    return contextWindow.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  }

  private generateTitle(content: string): string {
    // Take first 50 chars, trim to last complete word
    let title = content.slice(0, 50);
    if (content.length > 50) {
      const lastSpace = title.lastIndexOf(' ');
      if (lastSpace > 20) {
        title = title.slice(0, lastSpace);
      }
      title += '...';
    }
    return title;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────────

let conversationStore: ConversationStore | null = null;

export function getConversationStore(): ConversationStore {
  if (!conversationStore) {
    conversationStore = new ConversationStore(getStore());
  }
  return conversationStore;
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONVERSATION SERVICE (high-level operations)
// ─────────────────────────────────────────────────────────────────────────────────

export const conversations = {
  async getOrCreate(userId: string, conversationId: string) {
    return getConversationStore().getOrCreate(userId, conversationId);
  },

  async get(conversationId: string) {
    return getConversationStore().get(conversationId);
  },

  async list(userId: string, limit?: number, offset?: number) {
    return getConversationStore().listUserConversations(userId, limit, offset);
  },

  async delete(conversationId: string) {
    return getConversationStore().delete(conversationId);
  },

  async addUserMessage(conversationId: string, content: string) {
    return getConversationStore().addMessage(conversationId, {
      role: 'user',
      content,
    });
  },

  async addAssistantMessage(
    conversationId: string,
    content: string,
    metadata?: Message['metadata']
  ) {
    return getConversationStore().addMessage(conversationId, {
      role: 'assistant',
      content,
      metadata,
    });
  },

  async getMessages(conversationId: string, limit?: number) {
    return getConversationStore().getMessages(conversationId, limit);
  },

  async getFull(conversationId: string) {
    return getConversationStore().getFullConversation(conversationId);
  },

  async buildContext(conversationId: string, maxTokens?: number) {
    return getConversationStore().buildContextWindow(conversationId, maxTokens);
  },

  async updateTitle(conversationId: string, title: string) {
    return getConversationStore().update(conversationId, { title });
  },

  async addTag(conversationId: string, tag: string) {
    const conv = await getConversationStore().get(conversationId);
    if (!conv) return null;
    
    const tags = conv.metadata?.tags ?? [];
    if (!tags.includes(tag)) {
      tags.push(tag);
      return getConversationStore().update(conversationId, {
        metadata: { ...conv.metadata, tags },
      });
    }
    return conv;
  },
};
