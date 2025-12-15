// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION TESTS — History + Context Management
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../storage/index.js';
import {
  ConversationStore,
  type Message,
  type Conversation,
} from '../conversations/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CONVERSATION CRUD TESTS
// ─────────────────────────────────────────────────────────────────────────────────

describe('ConversationStore', () => {
  let memStore: MemoryStore;
  let convStore: ConversationStore;

  beforeEach(() => {
    memStore = new MemoryStore();
    convStore = new ConversationStore(memStore);
  });

  describe('Conversation CRUD', () => {
    it('should create conversation', async () => {
      const conv = await convStore.create('user1', 'conv1', 'Test Title');
      
      expect(conv.id).toBe('conv1');
      expect(conv.userId).toBe('user1');
      expect(conv.title).toBe('Test Title');
      expect(conv.messageCount).toBe(0);
    });

    it('should get conversation', async () => {
      await convStore.create('user1', 'conv2');
      const conv = await convStore.get('conv2');
      
      expect(conv).not.toBeNull();
      expect(conv?.id).toBe('conv2');
    });

    it('should return null for missing conversation', async () => {
      const conv = await convStore.get('nonexistent');
      expect(conv).toBeNull();
    });

    it('should update conversation', async () => {
      await convStore.create('user1', 'conv3');
      const updated = await convStore.update('conv3', { title: 'New Title' });
      
      expect(updated?.title).toBe('New Title');
    });

    it('should delete conversation', async () => {
      await convStore.create('user1', 'conv4');
      const deleted = await convStore.delete('conv4');
      
      expect(deleted).toBe(true);
      expect(await convStore.get('conv4')).toBeNull();
    });

    it('should getOrCreate existing conversation', async () => {
      await convStore.create('user1', 'conv5', 'Original');
      const conv = await convStore.getOrCreate('user1', 'conv5');
      
      expect(conv.title).toBe('Original');
    });

    it('should getOrCreate new conversation', async () => {
      const conv = await convStore.getOrCreate('user1', 'conv6');
      
      expect(conv.id).toBe('conv6');
      expect(conv.title).toBe('New Conversation');
    });
  });

  describe('User Conversations', () => {
    it('should list user conversations', async () => {
      await convStore.create('user1', 'c1');
      await convStore.create('user1', 'c2');
      await convStore.create('user2', 'c3');
      
      const list = await convStore.listUserConversations('user1');
      
      expect(list.length).toBe(2);
    });

    it('should sort by updatedAt descending', async () => {
      await convStore.create('user1', 'old');
      await new Promise(r => setTimeout(r, 10));
      await convStore.create('user1', 'new');
      
      const list = await convStore.listUserConversations('user1');
      
      expect(list[0].id).toBe('new');
      expect(list[1].id).toBe('old');
    });
  });

  describe('Message Operations', () => {
    it('should add message', async () => {
      await convStore.create('user1', 'conv-msg');
      const msg = await convStore.addMessage('conv-msg', {
        role: 'user',
        content: 'Hello',
      });
      
      expect(msg.id).toBeDefined();
      expect(msg.content).toBe('Hello');
      expect(msg.timestamp).toBeDefined();
    });

    it('should update message count on add', async () => {
      await convStore.create('user1', 'conv-count');
      await convStore.addMessage('conv-count', { role: 'user', content: 'Hi' });
      await convStore.addMessage('conv-count', { role: 'assistant', content: 'Hello' });
      
      const conv = await convStore.get('conv-count');
      expect(conv?.messageCount).toBe(2);
    });

    it('should get messages in chronological order', async () => {
      await convStore.create('user1', 'conv-order');
      await convStore.addMessage('conv-order', { role: 'user', content: 'First' });
      await convStore.addMessage('conv-order', { role: 'assistant', content: 'Second' });
      await convStore.addMessage('conv-order', { role: 'user', content: 'Third' });
      
      const messages = await convStore.getMessages('conv-order');
      
      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe('First');
      expect(messages[2].content).toBe('Third');
    });

    it('should auto-generate title from first message', async () => {
      await convStore.create('user1', 'conv-title');
      await convStore.addMessage('conv-title', {
        role: 'user',
        content: 'Help me plan my workout routine for the next month',
      });
      
      const conv = await convStore.get('conv-title');
      expect(conv?.title).toContain('Help me plan');
    });

    it('should store message metadata', async () => {
      await convStore.create('user1', 'conv-meta');
      await convStore.addMessage('conv-meta', {
        role: 'assistant',
        content: 'Response',
        metadata: {
          stance: 'sword',
          tokensUsed: 150,
        },
      });
      
      const messages = await convStore.getMessages('conv-meta');
      expect(messages[0].metadata?.stance).toBe('sword');
      expect(messages[0].metadata?.tokensUsed).toBe(150);
    });
  });

  describe('Context Window', () => {
    it('should build context from messages', async () => {
      await convStore.create('user1', 'conv-ctx');
      await convStore.addMessage('conv-ctx', { role: 'user', content: 'Hello' });
      await convStore.addMessage('conv-ctx', { role: 'assistant', content: 'Hi there' });
      await convStore.addMessage('conv-ctx', { role: 'user', content: 'How are you?' });
      
      const context = await convStore.buildContextWindow('conv-ctx');
      
      expect(context.messages.length).toBe(3);
      expect(context.truncated).toBe(false);
    });

    it('should respect max messages', async () => {
      await convStore.create('user1', 'conv-max');
      for (let i = 0; i < 10; i++) {
        await convStore.addMessage('conv-max', { role: 'user', content: `Message ${i}` });
      }
      
      const context = await convStore.buildContextWindow('conv-max', 8000, 5);
      
      expect(context.messages.length).toBeLessThanOrEqual(5);
      expect(context.truncated).toBe(true);
    });

    it('should respect max tokens', async () => {
      await convStore.create('user1', 'conv-tokens');
      // Each message ~25 tokens (100 chars / 4)
      for (let i = 0; i < 10; i++) {
        await convStore.addMessage('conv-tokens', {
          role: 'user',
          content: 'A'.repeat(100),
        });
      }
      
      // Max 100 tokens = ~4 messages
      const context = await convStore.buildContextWindow('conv-tokens', 100, 50);
      
      expect(context.messages.length).toBeLessThan(10);
      expect(context.totalTokens).toBeLessThanOrEqual(100);
    });

    it('should format context for LLM', async () => {
      await convStore.create('user1', 'conv-fmt');
      await convStore.addMessage('conv-fmt', { role: 'user', content: 'Hi' });
      await convStore.addMessage('conv-fmt', { role: 'assistant', content: 'Hello' });
      
      const context = await convStore.buildContextWindow('conv-fmt');
      const formatted = convStore.formatContextForLLM(context);
      
      expect(formatted).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]);
    });
  });

  describe('Full Conversation', () => {
    it('should get full conversation with messages', async () => {
      await convStore.create('user1', 'conv-full', 'Full Test');
      // First message is from assistant to avoid title auto-update
      await convStore.addMessage('conv-full', { role: 'assistant', content: 'Welcome' });
      await convStore.addMessage('conv-full', { role: 'user', content: 'Thanks' });
      
      const full = await convStore.getFullConversation('conv-full');
      
      expect(full?.title).toBe('Full Test');
      expect(full?.messages.length).toBe(2);
    });

    it('should return null for missing conversation', async () => {
      const full = await convStore.getFullConversation('missing');
      expect(full).toBeNull();
    });
  });
});
