// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT FORMATTERS — Convert Data to JSON, Markdown, CSV
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  ExportedData,
  ExportedConversation,
  ExportedGoal,
  ExportedMemory,
  ExportFormat,
  ExportOptions,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// BASE FORMATTER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────────

export interface ExportFormatter {
  format(data: ExportedData, options: ExportOptions): string;
  formatConversation(conversation: ExportedConversation): string;
  formatGoal(goal: ExportedGoal): string;
  formatMemories(memories: ExportedMemory[]): string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// JSON FORMATTER
// ─────────────────────────────────────────────────────────────────────────────────

export class JsonFormatter implements ExportFormatter {
  format(data: ExportedData, options: ExportOptions): string {
    const filtered = options.redactSensitive 
      ? this.redactSensitiveData(data)
      : data;
    
    return options.prettyPrint 
      ? JSON.stringify(filtered, null, 2)
      : JSON.stringify(filtered);
  }
  
  formatConversation(conversation: ExportedConversation): string {
    return JSON.stringify(conversation, null, 2);
  }
  
  formatGoal(goal: ExportedGoal): string {
    return JSON.stringify(goal, null, 2);
  }
  
  formatMemories(memories: ExportedMemory[]): string {
    return JSON.stringify(memories, null, 2);
  }
  
  private redactSensitiveData(data: ExportedData): ExportedData {
    const redacted = JSON.parse(JSON.stringify(data)) as ExportedData;
    
    // Redact sensitive memories
    if (redacted.memories) {
      redacted.memories = redacted.memories.map(mem => {
        if (mem.sensitivity === 'sensitive') {
          return {
            ...mem,
            value: '[REDACTED]',
            context: mem.context ? '[REDACTED]' : undefined,
          };
        }
        return mem;
      });
    }
    
    return redacted;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// MARKDOWN FORMATTER
// ─────────────────────────────────────────────────────────────────────────────────

export class MarkdownFormatter implements ExportFormatter {
  format(data: ExportedData, options: ExportOptions): string {
    const lines: string[] = [];
    
    // Header
    lines.push('# Nova Data Export');
    lines.push('');
    lines.push(`**Exported:** ${data.exportedAt}`);
    lines.push(`**User ID:** ${data.userId}`);
    lines.push(`**Scopes:** ${data.scopes.join(', ')}`);
    lines.push(`**Version:** ${data.exportVersion}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    
    // Profile
    if (data.profile) {
      lines.push('## Profile');
      lines.push('');
      if (data.profile.name) lines.push(`- **Name:** ${data.profile.name}`);
      if (data.profile.role) lines.push(`- **Role:** ${data.profile.role}`);
      if (data.profile.organization) lines.push(`- **Organization:** ${data.profile.organization}`);
      if (data.profile.location) lines.push(`- **Location:** ${data.profile.location}`);
      lines.push(`- **Expertise Level:** ${data.profile.expertiseLevel}`);
      if (data.profile.expertiseAreas.length > 0) {
        lines.push(`- **Expertise Areas:** ${data.profile.expertiseAreas.join(', ')}`);
      }
      if (data.profile.interests.length > 0) {
        lines.push(`- **Interests:** ${data.profile.interests.join(', ')}`);
      }
      lines.push('');
    }
    
    // Preferences
    if (data.preferences) {
      lines.push('## Preferences');
      lines.push('');
      lines.push(`- **Tone:** ${data.preferences.tone}`);
      lines.push(`- **Verbosity:** ${data.preferences.verbosity}`);
      lines.push(`- **Formatting:** ${data.preferences.formatting}`);
      lines.push(`- **Memory Enabled:** ${data.preferences.memoryEnabled ? 'Yes' : 'No'}`);
      lines.push(`- **Default Mode:** ${data.preferences.defaultMode}`);
      lines.push('');
    }
    
    // Conversations
    if (data.conversations && data.conversations.length > 0) {
      lines.push('## Conversations');
      lines.push('');
      lines.push(`Total: ${data.conversations.length} conversations`);
      lines.push('');
      
      for (const conv of data.conversations) {
        lines.push(this.formatConversation(conv));
        lines.push('');
      }
    }
    
    // Memories
    if (data.memories && data.memories.length > 0) {
      lines.push('## Memories');
      lines.push('');
      lines.push(this.formatMemories(data.memories));
      lines.push('');
    }
    
    // Goals
    if (data.goals && data.goals.length > 0) {
      lines.push('## Goals');
      lines.push('');
      
      for (const goal of data.goals) {
        lines.push(this.formatGoal(goal));
        lines.push('');
      }
    }
    
    // Search History
    if (data.searchHistory && data.searchHistory.length > 0) {
      lines.push('## Search History');
      lines.push('');
      lines.push('| Query | Scope | Results | Date |');
      lines.push('|-------|-------|---------|------|');
      
      for (const entry of data.searchHistory.slice(0, 100)) {
        const date = new Date(entry.timestamp).toLocaleDateString();
        lines.push(`| ${this.escapeMarkdown(entry.query)} | ${entry.scope} | ${entry.resultCount} | ${date} |`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  formatConversation(conversation: ExportedConversation): string {
    const lines: string[] = [];
    
    lines.push(`### ${this.escapeMarkdown(conversation.title)}`);
    lines.push('');
    lines.push(`- **ID:** ${conversation.id}`);
    lines.push(`- **Created:** ${conversation.createdAt}`);
    lines.push(`- **Messages:** ${conversation.messageCount}`);
    if (conversation.tags && conversation.tags.length > 0) {
      lines.push(`- **Tags:** ${conversation.tags.join(', ')}`);
    }
    lines.push('');
    
    if (conversation.messages.length > 0) {
      lines.push('<details>');
      lines.push('<summary>Messages</summary>');
      lines.push('');
      
      for (const msg of conversation.messages) {
        const timestamp = new Date(msg.timestamp).toLocaleString();
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        
        lines.push(`**${role}** (${timestamp}):`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
      
      lines.push('</details>');
    }
    
    return lines.join('\n');
  }
  
  formatGoal(goal: ExportedGoal): string {
    const lines: string[] = [];
    
    const statusEmoji = {
      active: '🟢',
      paused: '⏸️',
      completed: '✅',
      abandoned: '❌',
    }[goal.status] ?? '⚪';
    
    lines.push(`### ${statusEmoji} ${this.escapeMarkdown(goal.title)}`);
    lines.push('');
    lines.push(`> ${this.escapeMarkdown(goal.description)}`);
    lines.push('');
    lines.push(`- **Status:** ${goal.status}`);
    lines.push(`- **Progress:** ${goal.progress}%`);
    lines.push(`- **Interest Level:** ${goal.interestLevel}`);
    if (goal.targetDate) {
      lines.push(`- **Target Date:** ${goal.targetDate}`);
    }
    lines.push(`- **Created:** ${goal.createdAt}`);
    
    if (goal.successCriteria.length > 0) {
      lines.push('');
      lines.push('**Success Criteria:**');
      for (const criterion of goal.successCriteria) {
        lines.push(`- ${criterion}`);
      }
    }
    
    // Quests
    if (goal.quests.length > 0) {
      lines.push('');
      lines.push('**Quests:**');
      lines.push('');
      
      for (const quest of goal.quests) {
        const questStatus = quest.status === 'completed' ? '✅' : '⬜';
        lines.push(`${questStatus} **${this.escapeMarkdown(quest.title)}** (${quest.progress}%)`);
        
        // Steps
        if (quest.steps.length > 0) {
          for (const step of quest.steps) {
            const stepStatus = step.status === 'completed' ? '✅' : '⬜';
            lines.push(`  - ${stepStatus} ${this.escapeMarkdown(step.title)}`);
          }
        }
        lines.push('');
      }
    }
    
    return lines.join('\n');
  }
  
  formatMemories(memories: ExportedMemory[]): string {
    const lines: string[] = [];
    
    // Group by category
    const byCategory = new Map<string, ExportedMemory[]>();
    
    for (const memory of memories) {
      const existing = byCategory.get(memory.category) ?? [];
      existing.push(memory);
      byCategory.set(memory.category, existing);
    }
    
    for (const [category, mems] of byCategory) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      lines.push('');
      
      for (const mem of mems) {
        const confidence = mem.confidence === 'explicit' ? '✓' : '?';
        lines.push(`- **${mem.key}:** ${mem.value} ${confidence}`);
        if (mem.context) {
          lines.push(`  - _Context: ${mem.context}_`);
        }
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  private escapeMarkdown(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\|/g, '\\|');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// CSV FORMATTER
// ─────────────────────────────────────────────────────────────────────────────────

export class CsvFormatter implements ExportFormatter {
  format(data: ExportedData, options: ExportOptions): string {
    const sections: string[] = [];
    
    // Conversations as CSV
    if (data.conversations && data.conversations.length > 0) {
      sections.push('# CONVERSATIONS');
      sections.push('conversation_id,title,created_at,updated_at,message_count,tags');
      
      for (const conv of data.conversations) {
        sections.push([
          conv.id,
          this.escapeCsv(conv.title),
          conv.createdAt,
          conv.updatedAt,
          conv.messageCount.toString(),
          this.escapeCsv((conv.tags ?? []).join(';')),
        ].join(','));
      }
      
      sections.push('');
      sections.push('# MESSAGES');
      sections.push('conversation_id,message_id,role,timestamp,content');
      
      for (const conv of data.conversations) {
        for (const msg of conv.messages) {
          sections.push([
            conv.id,
            msg.id,
            msg.role,
            msg.timestamp,
            this.escapeCsv(msg.content),
          ].join(','));
        }
      }
    }
    
    // Memories as CSV
    if (data.memories && data.memories.length > 0) {
      sections.push('');
      sections.push('# MEMORIES');
      sections.push('id,category,key,value,confidence,sensitivity,created_at');
      
      for (const mem of data.memories) {
        const value = options.redactSensitive && mem.sensitivity === 'sensitive'
          ? '[REDACTED]'
          : mem.value;
        
        sections.push([
          mem.id,
          mem.category,
          this.escapeCsv(mem.key),
          this.escapeCsv(value),
          mem.confidence,
          mem.sensitivity,
          mem.createdAt,
        ].join(','));
      }
    }
    
    // Goals as CSV
    if (data.goals && data.goals.length > 0) {
      sections.push('');
      sections.push('# GOALS');
      sections.push('id,title,status,progress,interest_level,target_date,created_at');
      
      for (const goal of data.goals) {
        sections.push([
          goal.id,
          this.escapeCsv(goal.title),
          goal.status,
          goal.progress.toString(),
          goal.interestLevel,
          goal.targetDate ?? '',
          goal.createdAt,
        ].join(','));
      }
      
      sections.push('');
      sections.push('# QUESTS');
      sections.push('goal_id,quest_id,title,status,progress,priority,order');
      
      for (const goal of data.goals) {
        for (const quest of goal.quests) {
          sections.push([
            goal.id,
            quest.id,
            this.escapeCsv(quest.title),
            quest.status,
            quest.progress.toString(),
            quest.priority,
            quest.order.toString(),
          ].join(','));
        }
      }
      
      sections.push('');
      sections.push('# STEPS');
      sections.push('quest_id,step_id,title,type,status,order');
      
      for (const goal of data.goals) {
        for (const quest of goal.quests) {
          for (const step of quest.steps) {
            sections.push([
              quest.id,
              step.id,
              this.escapeCsv(step.title),
              step.type,
              step.status,
              step.order.toString(),
            ].join(','));
          }
        }
      }
    }
    
    // Search history as CSV
    if (data.searchHistory && data.searchHistory.length > 0) {
      sections.push('');
      sections.push('# SEARCH_HISTORY');
      sections.push('query,scope,result_count,timestamp');
      
      for (const entry of data.searchHistory) {
        sections.push([
          this.escapeCsv(entry.query),
          entry.scope,
          entry.resultCount.toString(),
          entry.timestamp,
        ].join(','));
      }
    }
    
    return sections.join('\n');
  }
  
  formatConversation(conversation: ExportedConversation): string {
    const lines: string[] = [];
    
    lines.push('message_id,role,timestamp,content');
    
    for (const msg of conversation.messages) {
      lines.push([
        msg.id,
        msg.role,
        msg.timestamp,
        this.escapeCsv(msg.content),
      ].join(','));
    }
    
    return lines.join('\n');
  }
  
  formatGoal(goal: ExportedGoal): string {
    const lines: string[] = [];
    
    lines.push('type,id,title,status,progress');
    lines.push(['goal', goal.id, this.escapeCsv(goal.title), goal.status, goal.progress.toString()].join(','));
    
    for (const quest of goal.quests) {
      lines.push(['quest', quest.id, this.escapeCsv(quest.title), quest.status, quest.progress.toString()].join(','));
      
      for (const step of quest.steps) {
        lines.push(['step', step.id, this.escapeCsv(step.title), step.status, ''].join(','));
      }
    }
    
    return lines.join('\n');
  }
  
  formatMemories(memories: ExportedMemory[]): string {
    const lines: string[] = [];
    
    lines.push('id,category,key,value,confidence,sensitivity');
    
    for (const mem of memories) {
      lines.push([
        mem.id,
        mem.category,
        this.escapeCsv(mem.key),
        this.escapeCsv(mem.value),
        mem.confidence,
        mem.sensitivity,
      ].join(','));
    }
    
    return lines.join('\n');
  }
  
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FORMATTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function getFormatter(format: ExportFormat): ExportFormatter {
  switch (format) {
    case 'json':
      return new JsonFormatter();
    case 'markdown':
      return new MarkdownFormatter();
    case 'csv':
      return new CsvFormatter();
    default:
      return new JsonFormatter();
  }
}
