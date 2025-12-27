// ═══════════════════════════════════════════════════════════════════════════════
// REFINE MODULE TYPES — Topic Landscape & Volatility Assessment
// NovaOS Gates — Phase 14B: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════
//
// Type definitions for expanded refinement:
//   - TopicLandscape: Hierarchical topic structure with prerequisites
//   - VolatilityAssessment: Freshness detection for web search triggering
//   - LearningPath: Recommended sequences through topic space
//   - RefineContext: Aggregated context from explore + landscape
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { Timestamp } from '../../../types/branded.js';

// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY ASSESSMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Categories of volatility signals.
 *
 * Each category represents a different reason why content might become stale:
 * - tool_specific: "React 18", "Python 3.12" — version-locked content
 * - version_sensitive: "latest API", "current syntax" — explicit recency
 * - regulatory: "tax law", "GDPR" — legal/compliance changes
 * - platform_dependent: "AWS", "Azure" — cloud platform evolution
 * - certification: "PMP", "AWS SA" — exam content updates
 * - research_frontier: "AI alignment", "quantum" — rapid advancement
 * - market_dynamic: "crypto", "stocks" — financial volatility
 * - best_practices: "security", "performance" — evolving standards
 * - security_threat: "vulnerability", "CVE" — urgent updates
 * - api_dependent: "OpenAI API", "Stripe API" — third-party changes
 */
export type VolatilityCategory =
  | 'tool_specific'
  | 'version_sensitive'
  | 'regulatory'
  | 'platform_dependent'
  | 'certification'
  | 'research_frontier'
  | 'market_dynamic'
  | 'best_practices'
  | 'security_threat'
  | 'api_dependent'
  | 'stable';

/**
 * Individual volatility signal detected in the goal/topic.
 */
export interface VolatilitySignal {
  /** The signal text that was detected */
  readonly signal: string;

  /** Weight of this signal (-1 to 1, positive = more volatile) */
  readonly weight: number;

  /** Category of volatility */
  readonly category: VolatilityCategory;

  /** Optional explanation */
  readonly reason?: string;
}

/**
 * Complete volatility assessment for a topic.
 */
export interface VolatilityAssessment {
  /** Overall volatility score (0-1, higher = more volatile) */
  readonly score: number;

  /** Whether web search is recommended for freshness */
  readonly needsFreshness: boolean;

  /** Individual signals that contributed to the score */
  readonly signals: readonly VolatilitySignal[];

  /** Confidence in the assessment */
  readonly confidence: 'high' | 'medium' | 'low';

  /** How the assessment was made */
  readonly method: 'pattern' | 'llm' | 'hybrid';

  /** Explanation of the assessment */
  readonly reasoning?: string;

  /** Suggested search topics if freshness needed */
  readonly suggestedSearchTopics?: readonly string[];

  /** Timestamp of assessment */
  readonly assessedAt: Timestamp;
}

/**
 * Volatility thresholds for decision making.
 */
export interface VolatilityThresholds {
  /** Score above which web search is triggered (default: 0.6) */
  readonly searchTrigger: number;

  /** Score above which shorter plan segments are recommended (default: 0.7) */
  readonly shortSegmentTrigger: number;

  /** Score above which deprecation warnings are shown (default: 0.8) */
  readonly deprecationWarningTrigger: number;
}

/**
 * Default volatility thresholds.
 */
export const DEFAULT_VOLATILITY_THRESHOLDS: VolatilityThresholds = {
  searchTrigger: 0.6,
  shortSegmentTrigger: 0.7,
  deprecationWarningTrigger: 0.8,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC LANDSCAPE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Difficulty level for topics.
 */
export type TopicDifficulty = 'foundational' | 'intermediate' | 'advanced';

/**
 * Scope assessment for the learning goal.
 */
export type ScopeAssessment = 'narrow' | 'moderate' | 'broad' | 'vast';

/**
 * A node in the topic hierarchy.
 */
export interface TopicNode {
  /** Unique identifier for this topic */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Brief description */
  readonly description: string;

  /** Difficulty level */
  readonly difficulty: TopicDifficulty;

  /** Estimated weeks to learn this topic */
  readonly estimatedWeeks: number;

  /** Child topics (subtopics) */
  readonly children?: readonly TopicNode[];

  /** Whether this is a prerequisite for the main goal */
  readonly isPrerequisite?: boolean;

  /** IDs of topics this depends on */
  readonly dependsOn?: readonly string[];

  /** Keywords for matching */
  readonly keywords?: readonly string[];
}

/**
 * Prerequisite information.
 */
export interface Prerequisite {
  /** Topic name */
  readonly topic: string;

  /** How important is this prerequisite */
  readonly importance: 'required' | 'recommended' | 'helpful';

  /** Why this is needed */
  readonly reason: string;

  /** Estimated weeks to learn if missing */
  readonly estimatedWeeks?: number;

  /** Question to assess if user has this knowledge */
  readonly assessmentQuestion?: string;

  /** Related topic IDs in the landscape */
  readonly relatedTopicIds?: readonly string[];
}

/**
 * A recommended learning path through the topic space.
 */
export interface LearningPath {
  /** Unique identifier */
  readonly id: string;

  /** Path name (e.g., "Web Developer Path") */
  readonly name: string;

  /** Description of this path */
  readonly description: string;

  /** Target role/outcome (e.g., "Frontend Developer") */
  readonly targetRole?: string;

  /** Ordered sequence of topic IDs */
  readonly topicSequence: readonly string[];

  /** Total estimated weeks */
  readonly estimatedWeeks: number;

  /** Pacing style */
  readonly difficulty: 'gradual' | 'intensive' | 'self-paced';

  /** Who this path is best for */
  readonly bestFor: readonly string[];

  /** Optional focus areas emphasized */
  readonly focusAreas?: readonly string[];
}

/**
 * Deprecation warning for outdated content.
 */
export interface DeprecationWarning {
  /** What is deprecated */
  readonly subject: string;

  /** Why it's deprecated */
  readonly reason: string;

  /** What to use instead */
  readonly alternative?: string;

  /** When it was deprecated */
  readonly since?: string;

  /** How serious is this */
  readonly severity: 'info' | 'warning' | 'critical';
}

/**
 * Freshness information from web search.
 */
export interface FreshnessInfo {
  /** When freshness was checked */
  readonly checkedAt: Timestamp;

  /** Sources consulted */
  readonly sources: readonly string[];

  /** Key findings about current state */
  readonly findings: readonly string[];

  /** Whether content appears current */
  readonly isCurrent: boolean;

  /** Latest version information if applicable */
  readonly latestVersion?: string;
}

/**
 * Complete topic landscape for a learning goal.
 */
export interface TopicLandscape {
  /** Primary topic extracted from goal */
  readonly primaryTopic: string;

  /** High-level overview paragraph */
  readonly overview: string;

  /** Hierarchical subtopics */
  readonly subtopics: readonly TopicNode[];

  /** Prerequisites for this topic */
  readonly prerequisites: readonly Prerequisite[];

  /** Common learning paths */
  readonly learningPaths: readonly LearningPath[];

  /** Scope assessment */
  readonly scopeAssessment: ScopeAssessment;

  /** Volatility assessment */
  readonly volatility: VolatilityAssessment;

  /** Freshness information (if web search performed) */
  readonly freshness?: FreshnessInfo;

  /** Deprecation warnings */
  readonly deprecations: readonly DeprecationWarning[];

  /** Related topics worth exploring */
  readonly relatedTopics: readonly string[];

  /** Generation timestamp */
  readonly generatedAt: Timestamp;

  /** Generation method */
  readonly method: 'llm' | 'template' | 'hybrid';
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFINE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Aggregated context passed through the refine phase.
 *
 * Combines explore insights with landscape analysis.
 */
export interface RefineContext {
  /** Original goal statement */
  readonly goalStatement: string;

  /** Crystallized goal (from explore or original) */
  readonly crystallizedGoal: string;

  /** Topic landscape */
  readonly landscape: TopicLandscape;

  /** User interests (from explore) */
  readonly interests?: readonly string[];

  /** User constraints (from explore) */
  readonly constraints?: readonly string[];

  /** User background (from explore) */
  readonly background?: readonly string[];

  /** User motivations (from explore) */
  readonly motivations?: readonly string[];

  /** Recommended path (if determined) */
  readonly recommendedPath?: LearningPath;

  /** Prerequisite assessment results */
  readonly prerequisiteAssessment?: PrerequisiteAssessmentResult;
}

/**
 * Result of prerequisite assessment.
 */
export interface PrerequisiteAssessmentResult {
  /** Assessed prerequisites */
  readonly assessments: readonly PrerequisiteStatus[];

  /** Total additional weeks needed */
  readonly additionalWeeksNeeded: number;

  /** Summary of assessment */
  readonly summary: string;

  /** Whether user is ready to start */
  readonly readyToStart: boolean;
}

/**
 * Status of a single prerequisite after assessment.
 */
export interface PrerequisiteStatus {
  /** The prerequisite */
  readonly prerequisite: Prerequisite;

  /** Assessment status */
  readonly status: 'proficient' | 'familiar' | 'needs_review' | 'needs_learning' | 'skipped';

  /** User's response (if assessed) */
  readonly userResponse?: string;

  /** Confidence in assessment */
  readonly confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Web search request for freshness verification.
 */
export interface WebSearchRequest {
  /** Search query */
  readonly query: string;

  /** Maximum results to return */
  readonly maxResults?: number;

  /** Preferred domains (e.g., official docs) */
  readonly preferredDomains?: readonly string[];

  /** Domains to exclude */
  readonly excludeDomains?: readonly string[];

  /** Time range filter */
  readonly timeRange?: 'day' | 'week' | 'month' | 'year' | 'all';
}

/**
 * Web search result.
 */
export interface WebSearchResult {
  /** Result title */
  readonly title: string;

  /** Result URL */
  readonly url: string;

  /** Snippet/description */
  readonly snippet: string;

  /** Published date if available */
  readonly publishedDate?: string;

  /** Domain */
  readonly domain: string;

  /** Relevance score (0-1) */
  readonly score?: number;
}

/**
 * Web search response.
 */
export interface WebSearchResponse {
  /** Search results */
  readonly results: readonly WebSearchResult[];

  /** Query that was executed */
  readonly query: string;

  /** Total results found */
  readonly totalResults: number;

  /** Search timestamp */
  readonly searchedAt: Timestamp;
}

/**
 * Interface for web search service.
 *
 * Implement this with your Tavily integration.
 */
export interface IWebSearchService {
  /**
   * Perform a web search.
   */
  search(request: WebSearchRequest): Promise<WebSearchResponse>;

  /**
   * Check if service is available.
   */
  isAvailable(): boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for the refine module.
 */
export interface RefineModuleConfig {
  /** Enable landscape generation (default: true) */
  readonly enableLandscape: boolean;

  /** Enable volatility detection (default: true) */
  readonly enableVolatility: boolean;

  /** Enable web search enrichment (default: true) */
  readonly enableWebSearch: boolean;

  /** Enable prerequisite assessment (default: true) */
  readonly enablePrerequisites: boolean;

  /** Volatility thresholds */
  readonly volatilityThresholds: VolatilityThresholds;

  /** Maximum subtopic depth */
  readonly maxSubtopicDepth: number;

  /** Maximum learning paths to generate */
  readonly maxLearningPaths: number;

  /** OpenAI model for LLM operations */
  readonly llmModel: string;

  /** LLM temperature for generation */
  readonly llmTemperature: number;

  /** Maximum web search results */
  readonly maxSearchResults: number;
}

/**
 * Default refine module configuration.
 */
export const DEFAULT_REFINE_CONFIG: RefineModuleConfig = {
  enableLandscape: true,
  enableVolatility: true,
  enableWebSearch: true,
  enablePrerequisites: true,
  volatilityThresholds: DEFAULT_VOLATILITY_THRESHOLDS,
  maxSubtopicDepth: 3,
  maxLearningPaths: 3,
  llmModel: 'gpt-4o-mini',
  llmTemperature: 0.3,
  maxSearchResults: 5,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Valid volatility categories.
 */
export const VOLATILITY_CATEGORIES: readonly VolatilityCategory[] = [
  'tool_specific',
  'version_sensitive',
  'regulatory',
  'platform_dependent',
  'certification',
  'research_frontier',
  'market_dynamic',
  'best_practices',
  'security_threat',
  'api_dependent',
  'stable',
] as const;

/**
 * Check if value is a valid VolatilityCategory.
 */
export function isVolatilityCategory(value: unknown): value is VolatilityCategory {
  return typeof value === 'string' && VOLATILITY_CATEGORIES.includes(value as VolatilityCategory);
}

/**
 * Valid topic difficulties.
 */
export const TOPIC_DIFFICULTIES: readonly TopicDifficulty[] = [
  'foundational',
  'intermediate',
  'advanced',
] as const;

/**
 * Check if value is a valid TopicDifficulty.
 */
export function isTopicDifficulty(value: unknown): value is TopicDifficulty {
  return typeof value === 'string' && TOPIC_DIFFICULTIES.includes(value as TopicDifficulty);
}

/**
 * Valid scope assessments.
 */
export const SCOPE_ASSESSMENTS: readonly ScopeAssessment[] = [
  'narrow',
  'moderate',
  'broad',
  'vast',
] as const;

/**
 * Check if value is a valid ScopeAssessment.
 */
export function isScopeAssessment(value: unknown): value is ScopeAssessment {
  return typeof value === 'string' && SCOPE_ASSESSMENTS.includes(value as ScopeAssessment);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an empty volatility assessment (stable topic).
 */
export function createStableVolatilityAssessment(timestamp: Timestamp): VolatilityAssessment {
  return {
    score: 0.1,
    needsFreshness: false,
    signals: [{ signal: 'stable_topic', weight: -0.5, category: 'stable' }],
    confidence: 'high',
    method: 'pattern',
    reasoning: 'Topic appears stable with no significant volatility signals',
    assessedAt: timestamp,
  };
}

/**
 * Create a high volatility assessment.
 */
export function createHighVolatilityAssessment(
  signals: readonly VolatilitySignal[],
  suggestedSearchTopics: readonly string[],
  timestamp: Timestamp
): VolatilityAssessment {
  const score = Math.min(1, signals.reduce((sum, s) => sum + Math.max(0, s.weight), 0) / signals.length + 0.3);
  return {
    score,
    needsFreshness: true,
    signals,
    confidence: 'high',
    method: 'pattern',
    reasoning: `High volatility detected: ${signals.map(s => s.category).join(', ')}`,
    suggestedSearchTopics,
    assessedAt: timestamp,
  };
}

/**
 * Create an empty topic landscape (minimal structure).
 */
export function createMinimalLandscape(
  topic: string,
  volatility: VolatilityAssessment,
  timestamp: Timestamp
): TopicLandscape {
  return {
    primaryTopic: topic,
    overview: `Learning path for ${topic}`,
    subtopics: [],
    prerequisites: [],
    learningPaths: [],
    scopeAssessment: 'moderate',
    volatility,
    deprecations: [],
    relatedTopics: [],
    generatedAt: timestamp,
    method: 'template',
  };
}
