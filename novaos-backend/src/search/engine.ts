// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH ENGINE — Tokenization, Fuzzy Matching, Ranking
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  TokenizerOptions,
  FuzzyMatchOptions,
  RankingFactors,
  IndexedDocument,
  SearchResult,
  SearchableType,
} from './types.js';
import {
  DEFAULT_TOKENIZER_OPTIONS,
  DEFAULT_FUZZY_OPTIONS,
  STOP_WORDS,
  FIELD_BOOSTS,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────────

export class Tokenizer {
  private options: Required<TokenizerOptions>;
  
  constructor(options: TokenizerOptions = {}) {
    this.options = {
      ...DEFAULT_TOKENIZER_OPTIONS,
      ...options,
    } as Required<TokenizerOptions>;
  }
  
  /**
   * Tokenize text into searchable terms.
   */
  tokenize(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }
    
    // Split on non-alphanumeric characters
    let tokens = text
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean);
    
    // Apply options
    if (this.options.lowercase) {
      tokens = tokens.map(t => t.toLowerCase());
    }
    
    if (this.options.removeStopWords) {
      tokens = tokens.filter(t => !STOP_WORDS.has(t.toLowerCase()));
    }
    
    // Filter by length
    tokens = tokens.filter(t => 
      t.length >= this.options.minLength && 
      t.length <= this.options.maxLength
    );
    
    return tokens;
  }
  
  /**
   * Tokenize and deduplicate.
   */
  tokenizeUnique(text: string): string[] {
    return [...new Set(this.tokenize(text))];
  }
  
  /**
   * Get token frequency map.
   */
  getTokenFrequency(text: string): Map<string, number> {
    const tokens = this.tokenize(text);
    const freq = new Map<string, number>();
    
    for (const token of tokens) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
    
    return freq;
  }
  
  /**
   * Extract n-grams (for phrase matching).
   */
  getNGrams(text: string, n: number = 2): string[] {
    const tokens = this.tokenize(text);
    const ngrams: string[] = [];
    
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.push(tokens.slice(i, i + n).join(' '));
    }
    
    return ngrams;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// FUZZY MATCHER
// ─────────────────────────────────────────────────────────────────────────────────

export class FuzzyMatcher {
  private options: Required<FuzzyMatchOptions>;
  
  constructor(options: FuzzyMatchOptions = {}) {
    this.options = {
      ...DEFAULT_FUZZY_OPTIONS,
      ...options,
    } as Required<FuzzyMatchOptions>;
  }
  
  /**
   * Calculate Levenshtein distance between two strings.
   */
  levenshteinDistance(a: string, b: string): number {
    if (!this.options.caseSensitive) {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }
    
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    // Create distance matrix
    const matrix: number[][] = [];
    
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= b.length; j++) {
      matrix[0]![j] = j;
    }
    
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j]! + 1,      // deletion
          matrix[i]![j - 1]! + 1,      // insertion
          matrix[i - 1]![j - 1]! + cost // substitution
        );
      }
    }
    
    return matrix[a.length]![b.length]!;
  }
  
  /**
   * Calculate similarity score (0-1).
   */
  similarity(a: string, b: string): number {
    const distance = this.levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    
    if (maxLen === 0) return 1;
    
    return 1 - (distance / maxLen);
  }
  
  /**
   * Check if two strings are a fuzzy match.
   */
  matches(query: string, target: string): boolean {
    const distance = this.levenshteinDistance(query, target);
    
    if (distance > this.options.maxDistance) {
      return false;
    }
    
    const sim = this.similarity(query, target);
    return sim >= this.options.threshold;
  }
  
  /**
   * Find best fuzzy matches from a list of candidates.
   */
  findMatches(query: string, candidates: string[]): Array<{ term: string; score: number }> {
    const matches: Array<{ term: string; score: number }> = [];
    
    for (const candidate of candidates) {
      const score = this.similarity(query, candidate);
      
      if (score >= this.options.threshold) {
        matches.push({ term: candidate, score });
      }
    }
    
    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Check if query is a prefix of target.
   */
  isPrefix(query: string, target: string): boolean {
    if (!this.options.caseSensitive) {
      query = query.toLowerCase();
      target = target.toLowerCase();
    }
    
    return target.startsWith(query);
  }
  
  /**
   * Check if query is contained in target.
   */
  contains(query: string, target: string): boolean {
    if (!this.options.caseSensitive) {
      query = query.toLowerCase();
      target = target.toLowerCase();
    }
    
    return target.includes(query);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH RANKER
// ─────────────────────────────────────────────────────────────────────────────────

export class SearchRanker {
  private tokenizer: Tokenizer;
  private fuzzyMatcher: FuzzyMatcher;
  
  constructor() {
    this.tokenizer = new Tokenizer();
    this.fuzzyMatcher = new FuzzyMatcher();
  }
  
  /**
   * Calculate relevance score for a document given a query.
   */
  calculateScore(
    query: string,
    document: IndexedDocument,
    totalDocuments: number,
    termDocumentCounts: Map<string, number>
  ): { score: number; matchedTerms: string[]; factors: RankingFactors } {
    const queryTokens = this.tokenizer.tokenizeUnique(query);
    const docTokens = new Set(document.tokens);
    const matchedTerms: string[] = [];
    
    // Calculate TF-IDF inspired score
    let termFrequencyScore = 0;
    let documentFrequencyScore = 0;
    let fieldBoostScore = 0;
    let exactMatchScore = 0;
    
    for (const queryToken of queryTokens) {
      // Check exact match
      if (docTokens.has(queryToken)) {
        matchedTerms.push(queryToken);
        
        // Term frequency in document
        const tf = document.tokens.filter(t => t === queryToken).length;
        termFrequencyScore += Math.log(1 + tf);
        
        // Inverse document frequency
        const docCount = termDocumentCounts.get(queryToken) ?? 1;
        const idf = Math.log(totalDocuments / docCount);
        documentFrequencyScore += idf;
        
        // Field boost
        if (document.title) {
          const titleTokens = this.tokenizer.tokenize(document.title);
          if (titleTokens.includes(queryToken)) {
            fieldBoostScore += FIELD_BOOSTS['title']!;
          }
        }
        
        if (document.tags?.some(t => 
          this.tokenizer.tokenize(t).includes(queryToken)
        )) {
          fieldBoostScore += FIELD_BOOSTS['tags']!;
        }
      } else {
        // Try fuzzy match
        for (const docToken of docTokens) {
          if (this.fuzzyMatcher.matches(queryToken, docToken)) {
            matchedTerms.push(docToken);
            termFrequencyScore += 0.5; // Reduced score for fuzzy
            break;
          }
        }
      }
    }
    
    // Exact phrase match bonus
    const queryLower = query.toLowerCase();
    const contentLower = document.content.toLowerCase();
    if (contentLower.includes(queryLower)) {
      exactMatchScore = 2.0;
    }
    
    // Recency boost (documents from last 7 days get boost)
    const docAge = Date.now() - new Date(document.updatedAt).getTime();
    const daysSinceUpdate = docAge / (1000 * 60 * 60 * 24);
    const recencyBoost = daysSinceUpdate < 7 
      ? 1 + (0.5 * (1 - daysSinceUpdate / 7))
      : 1;
    
    // Combine scores
    const baseScore = 
      (termFrequencyScore * 0.3) +
      (documentFrequencyScore * 0.3) +
      (fieldBoostScore * 0.2) +
      (exactMatchScore * 0.2);
    
    const finalScore = Math.min(1, baseScore * recencyBoost / queryTokens.length);
    
    return {
      score: Math.max(0, finalScore),
      matchedTerms: [...new Set(matchedTerms)],
      factors: {
        termFrequency: termFrequencyScore,
        documentFrequency: documentFrequencyScore,
        fieldBoost: fieldBoostScore,
        recencyBoost,
        exactMatchBoost: exactMatchScore,
      },
    };
  }
  
  /**
   * Rank search results by score.
   */
  rankResults(results: SearchResult[]): SearchResult[] {
    return results.sort((a, b) => {
      // Primary: score
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      
      // Secondary: recency
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }
  
  /**
   * Generate highlighted snippet.
   */
  highlightSnippet(
    content: string,
    matchedTerms: string[],
    maxLength: number = 200
  ): string {
    if (!content || matchedTerms.length === 0) {
      return content?.slice(0, maxLength) ?? '';
    }
    
    const lowerContent = content.toLowerCase();
    
    // Find the first occurrence of any matched term
    let bestStart = 0;
    let bestTerm = '';
    
    for (const term of matchedTerms) {
      const index = lowerContent.indexOf(term.toLowerCase());
      if (index !== -1 && (bestTerm === '' || index < bestStart)) {
        bestStart = index;
        bestTerm = term;
      }
    }
    
    // Extract snippet around the match
    const snippetStart = Math.max(0, bestStart - 50);
    const snippetEnd = Math.min(content.length, bestStart + maxLength - 50);
    
    let snippet = content.slice(snippetStart, snippetEnd);
    
    // Add ellipsis if truncated
    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < content.length) snippet = snippet + '...';
    
    // Highlight matched terms with **bold**
    for (const term of matchedTerms) {
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
      snippet = snippet.replace(regex, '**$1**');
    }
    
    return snippet;
  }
  
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SEARCH ENGINE
// ─────────────────────────────────────────────────────────────────────────────────

export class SearchEngine {
  private tokenizer: Tokenizer;
  private fuzzyMatcher: FuzzyMatcher;
  private ranker: SearchRanker;
  
  constructor() {
    this.tokenizer = new Tokenizer();
    this.fuzzyMatcher = new FuzzyMatcher();
    this.ranker = new SearchRanker();
  }
  
  /**
   * Index a document for search.
   */
  indexDocument(
    id: string,
    type: SearchableType,
    userId: string,
    content: string,
    metadata: {
      title?: string;
      tags?: string[];
      createdAt: string;
      updatedAt?: string;
      extra?: Record<string, unknown>;
    }
  ): IndexedDocument {
    // Combine all searchable text
    const searchableText = [
      metadata.title ?? '',
      content,
      ...(metadata.tags ?? []),
    ].join(' ');
    
    const tokens = this.tokenizer.tokenize(searchableText);
    
    return {
      id,
      type,
      userId,
      content,
      title: metadata.title,
      tags: metadata.tags,
      tokens,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt ?? metadata.createdAt,
      metadata: metadata.extra ?? {},
    };
  }
  
  /**
   * Search indexed documents.
   */
  search(
    query: string,
    documents: IndexedDocument[],
    options: {
      fuzzy?: boolean;
      minScore?: number;
      limit?: number;
      offset?: number;
      highlight?: boolean;
    } = {}
  ): {
    results: SearchResult[];
    totalResults: number;
  } {
    const {
      fuzzy = true,
      minScore = 0.1,
      limit = 20,
      offset = 0,
      highlight = true,
    } = options;
    
    // Build term document counts for IDF
    const termDocCounts = new Map<string, number>();
    for (const doc of documents) {
      const uniqueTokens = new Set(doc.tokens);
      for (const token of uniqueTokens) {
        termDocCounts.set(token, (termDocCounts.get(token) ?? 0) + 1);
      }
    }
    
    // Score all documents
    const scored: Array<{
      doc: IndexedDocument;
      score: number;
      matchedTerms: string[];
    }> = [];
    
    for (const doc of documents) {
      const { score, matchedTerms } = this.ranker.calculateScore(
        query,
        doc,
        documents.length,
        termDocCounts
      );
      
      if (score >= minScore) {
        scored.push({ doc, score, matchedTerms });
      }
    }
    
    // Sort by score
    scored.sort((a, b) => b.score - a.score);
    
    // Paginate
    const totalResults = scored.length;
    const paged = scored.slice(offset, offset + limit);
    
    // Convert to SearchResult
    const results: SearchResult[] = paged.map(({ doc, score, matchedTerms }) => {
      const snippet = doc.content.slice(0, 200);
      const highlightedSnippet = highlight
        ? this.ranker.highlightSnippet(doc.content, matchedTerms)
        : undefined;
      
      return {
        id: doc.id,
        type: doc.type,
        title: doc.title ?? this.generateTitle(doc.content),
        snippet,
        highlightedSnippet,
        score,
        matchedTerms,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        data: this.buildResultData(doc),
      };
    });
    
    return { results, totalResults };
  }
  
  /**
   * Get search suggestions based on query prefix.
   */
  getSuggestions(
    prefix: string,
    documents: IndexedDocument[],
    limit: number = 5
  ): string[] {
    const allTokens = new Set<string>();
    
    for (const doc of documents) {
      for (const token of doc.tokens) {
        allTokens.add(token);
      }
    }
    
    const matches = this.fuzzyMatcher.findMatches(
      prefix.toLowerCase(),
      Array.from(allTokens)
    );
    
    // Also include prefix matches
    const prefixMatches = Array.from(allTokens)
      .filter(t => t.startsWith(prefix.toLowerCase()))
      .map(t => ({ term: t, score: 1.0 }));
    
    // Combine and dedupe
    const combined = [...prefixMatches, ...matches];
    const seen = new Set<string>();
    const unique: Array<{ term: string; score: number }> = [];
    
    for (const match of combined) {
      if (!seen.has(match.term)) {
        seen.add(match.term);
        unique.push(match);
      }
    }
    
    return unique
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(m => m.term);
  }
  
  private generateTitle(content: string): string {
    const firstLine = content.split('\n')[0] ?? '';
    if (firstLine.length <= 60) return firstLine;
    return firstLine.slice(0, 57) + '...';
  }
  
  private buildResultData(doc: IndexedDocument): SearchResult['data'] {
    switch (doc.type) {
      case 'conversation':
        return {
          type: 'conversation',
          conversationId: doc.id,
          messageCount: (doc.metadata['messageCount'] as number) ?? 0,
          lastMessage: doc.metadata['lastMessage'] as string | undefined,
          tags: doc.tags,
        };
      
      case 'message':
        return {
          type: 'message',
          messageId: doc.id,
          conversationId: doc.metadata['conversationId'] as string,
          role: doc.metadata['role'] as 'user' | 'assistant' | 'system',
          content: doc.content,
        };
      
      case 'memory':
        return {
          type: 'memory',
          memoryId: doc.id,
          category: doc.metadata['category'] as string,
          key: doc.metadata['key'] as string,
          value: doc.content,
          confidence: doc.metadata['confidence'] as string,
        };
      
      default:
        return {
          type: 'conversation',
          conversationId: doc.id,
          messageCount: 0,
        };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────────

let searchEngine: SearchEngine | null = null;

export function getSearchEngine(): SearchEngine {
  if (!searchEngine) {
    searchEngine = new SearchEngine();
  }
  return searchEngine;
}
