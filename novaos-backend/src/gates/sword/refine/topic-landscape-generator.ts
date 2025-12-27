// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC LANDSCAPE GENERATOR — Learning Terrain Mapping
// NovaOS Gates — Phase 14B: SwordGate Refine Expansion
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates comprehensive topic landscapes for learning goals:
//   - Hierarchical subtopic structure with dependencies
//   - Prerequisite identification with assessment questions
//   - Multiple learning paths with different approaches
//   - Scope assessment (narrow → vast)
//   - Related topics for exploration
//
// Uses ExploreContext from Phase 14A to personalize recommendations.
//
// ═══════════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { createTimestamp } from '../../../types/branded.js';
import type { Timestamp } from '../../../types/branded.js';
import type { AsyncAppResult } from '../../../types/result.js';
import { ok, err, appError } from '../../../types/result.js';

import type { ExploreContext } from '../explore/types.js';

import type {
  TopicLandscape,
  TopicNode,
  Prerequisite,
  LearningPath,
  DeprecationWarning,
  ScopeAssessment,
  TopicDifficulty,
  VolatilityAssessment,
  RefineModuleConfig,
  IWebSearchService,
  WebSearchResponse,
  FreshnessInfo,
} from './types.js';
import {
  DEFAULT_REFINE_CONFIG,
  createMinimalLandscape,
  isTopicDifficulty,
  isScopeAssessment,
} from './types.js';
import { VolatilityDetector, createVolatilityDetector } from './volatility-detector.js';

// ═══════════════════════════════════════════════════════════════════════════════
// LLM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

const LANDSCAPE_GENERATION_PROMPT = `You are generating a comprehensive learning landscape for a topic. This landscape maps the learning terrain to help plan an effective curriculum.

OUTPUT FORMAT (JSON only, no markdown):
{
  "primaryTopic": "main topic name",
  "overview": "2-3 sentence overview of the topic and what learning it involves",
  "subtopics": [
    {
      "id": "unique-id",
      "name": "Subtopic Name",
      "description": "Brief description",
      "difficulty": "foundational|intermediate|advanced",
      "estimatedWeeks": 1-8,
      "children": [...nested subtopics...],
      "dependsOn": ["parent-id"],
      "keywords": ["keyword1", "keyword2"]
    }
  ],
  "prerequisites": [
    {
      "topic": "Prerequisite Topic",
      "importance": "required|recommended|helpful",
      "reason": "Why this is needed",
      "estimatedWeeks": 1-4,
      "assessmentQuestion": "Question to assess if user knows this"
    }
  ],
  "learningPaths": [
    {
      "id": "path-id",
      "name": "Path Name (e.g., 'Practical Developer Path')",
      "description": "What this path emphasizes",
      "targetRole": "Target outcome/role",
      "topicSequence": ["subtopic-id-1", "subtopic-id-2"],
      "estimatedWeeks": 4-16,
      "difficulty": "gradual|intensive|self-paced",
      "bestFor": ["learner type 1", "learner type 2"]
    }
  ],
  "scopeAssessment": "narrow|moderate|broad|vast",
  "deprecations": [
    {
      "subject": "What is deprecated",
      "reason": "Why",
      "alternative": "What to use instead",
      "severity": "info|warning|critical"
    }
  ],
  "relatedTopics": ["related topic 1", "related topic 2"]
}

GUIDELINES:
1. Create 3-8 subtopics organized hierarchically
2. Include 1-4 prerequisites based on topic complexity
3. Generate 2-3 learning paths with different approaches
4. Scope assessment: narrow (few weeks), moderate (1-2 months), broad (3-6 months), vast (6+ months)
5. Only include deprecations if there are known outdated approaches
6. Related topics should be adjacent areas worth exploring

DIFFICULTY MAPPING:
- foundational: Core concepts, no prior knowledge needed
- intermediate: Requires foundational knowledge
- advanced: Requires intermediate mastery, complex topics

PATH DIFFICULTIES:
- gradual: Slow, thorough, lots of practice
- intensive: Fast-paced, assumes quick learning
- self-paced: Flexible, project-based learning`;

const PERSONALIZED_LANDSCAPE_PROMPT = `You are generating a PERSONALIZED learning landscape based on the user's exploration conversation.

USER CONTEXT:
- Interests: {interests}
- Constraints: {constraints}
- Background: {background}
- Motivations: {motivations}
- Crystallized Goal: {goal}

Use this context to:
1. Prioritize subtopics that align with their interests
2. Adjust time estimates based on their constraints
3. Consider their background when assessing prerequisites
4. Tailor learning paths to their motivations
5. Highlight connections to their stated goals

${LANDSCAPE_GENERATION_PROMPT}`;

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE LANDSCAPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Known topic templates for common learning goals.
 * Falls back to LLM if topic not found.
 */
const TOPIC_TEMPLATES: Record<string, Partial<TopicLandscape>> = {
  'rust': {
    primaryTopic: 'Rust Programming',
    overview: 'Rust is a systems programming language focused on safety, concurrency, and performance. Learning Rust involves understanding ownership, borrowing, lifetimes, and building safe concurrent systems.',
    subtopics: [
      {
        id: 'rust-basics',
        name: 'Rust Basics',
        description: 'Syntax, variables, data types, and control flow',
        difficulty: 'foundational',
        estimatedWeeks: 2,
        keywords: ['syntax', 'variables', 'types', 'control flow'],
      },
      {
        id: 'rust-ownership',
        name: 'Ownership & Borrowing',
        description: 'The core memory safety concepts unique to Rust',
        difficulty: 'intermediate',
        estimatedWeeks: 2,
        dependsOn: ['rust-basics'],
        keywords: ['ownership', 'borrowing', 'lifetimes', 'references'],
      },
      {
        id: 'rust-structs-enums',
        name: 'Structs & Enums',
        description: 'Custom types, pattern matching, and data modeling',
        difficulty: 'intermediate',
        estimatedWeeks: 1,
        dependsOn: ['rust-basics'],
        keywords: ['struct', 'enum', 'pattern matching', 'Option', 'Result'],
      },
      {
        id: 'rust-error-handling',
        name: 'Error Handling',
        description: 'Result type, error propagation, and custom errors',
        difficulty: 'intermediate',
        estimatedWeeks: 1,
        dependsOn: ['rust-structs-enums'],
        keywords: ['Result', 'Error', 'panic', 'unwrap', '?'],
      },
      {
        id: 'rust-traits',
        name: 'Traits & Generics',
        description: 'Abstract behavior and generic programming',
        difficulty: 'intermediate',
        estimatedWeeks: 2,
        dependsOn: ['rust-ownership', 'rust-structs-enums'],
        keywords: ['trait', 'generic', 'impl', 'where'],
      },
      {
        id: 'rust-concurrency',
        name: 'Concurrency',
        description: 'Threads, async/await, channels, and safe parallelism',
        difficulty: 'advanced',
        estimatedWeeks: 2,
        dependsOn: ['rust-traits'],
        keywords: ['thread', 'async', 'await', 'channel', 'Mutex', 'Arc'],
      },
    ],
    prerequisites: [
      {
        topic: 'Programming fundamentals',
        importance: 'required',
        reason: 'Need to understand basic programming concepts',
        estimatedWeeks: 4,
        assessmentQuestion: 'Can you explain what a function is and write a simple loop?',
      },
      {
        topic: 'Command line basics',
        importance: 'recommended',
        reason: 'Rust development relies heavily on cargo CLI',
        estimatedWeeks: 1,
        assessmentQuestion: 'Are you comfortable navigating directories and running commands in a terminal?',
      },
    ],
    learningPaths: [
      {
        id: 'rust-practical',
        name: 'Practical Systems Developer',
        description: 'Focus on building real CLI tools and understanding memory management',
        targetRole: 'Systems Developer',
        topicSequence: ['rust-basics', 'rust-ownership', 'rust-structs-enums', 'rust-error-handling', 'rust-traits'],
        estimatedWeeks: 8,
        difficulty: 'gradual',
        bestFor: ['developers new to systems programming', 'those coming from GC languages'],
      },
      {
        id: 'rust-intensive',
        name: 'Fast Track for Experienced Developers',
        description: 'Assumes programming experience, focuses on Rust-specific concepts',
        targetRole: 'Rust Developer',
        topicSequence: ['rust-basics', 'rust-ownership', 'rust-traits', 'rust-concurrency'],
        estimatedWeeks: 4,
        difficulty: 'intensive',
        bestFor: ['experienced C/C++ developers', 'those with systems programming background'],
      },
    ],
    scopeAssessment: 'moderate',
    relatedTopics: ['WebAssembly', 'Systems programming', 'Memory management', 'Concurrent programming'],
  },

  'python': {
    primaryTopic: 'Python Programming',
    overview: 'Python is a versatile, beginner-friendly language used in web development, data science, automation, and AI. Learning Python involves understanding its clean syntax, powerful libraries, and diverse applications.',
    subtopics: [
      {
        id: 'python-basics',
        name: 'Python Basics',
        description: 'Syntax, variables, data types, and control structures',
        difficulty: 'foundational',
        estimatedWeeks: 2,
        keywords: ['syntax', 'variables', 'lists', 'dictionaries', 'loops'],
      },
      {
        id: 'python-functions',
        name: 'Functions & Modules',
        description: 'Defining functions, importing modules, and code organization',
        difficulty: 'foundational',
        estimatedWeeks: 1,
        dependsOn: ['python-basics'],
        keywords: ['def', 'import', 'module', 'package'],
      },
      {
        id: 'python-oop',
        name: 'Object-Oriented Python',
        description: 'Classes, inheritance, and object-oriented design',
        difficulty: 'intermediate',
        estimatedWeeks: 2,
        dependsOn: ['python-functions'],
        keywords: ['class', 'inheritance', 'self', '__init__'],
      },
      {
        id: 'python-stdlib',
        name: 'Standard Library',
        description: 'Key modules: os, json, datetime, collections, itertools',
        difficulty: 'intermediate',
        estimatedWeeks: 1,
        dependsOn: ['python-functions'],
        keywords: ['os', 'json', 'datetime', 'collections'],
      },
    ],
    prerequisites: [
      {
        topic: 'Basic computer skills',
        importance: 'required',
        reason: 'Need to install software and navigate files',
        assessmentQuestion: 'Can you install programs and organize files on your computer?',
      },
    ],
    learningPaths: [
      {
        id: 'python-beginner',
        name: 'Complete Beginner Path',
        description: 'From zero to comfortable Python developer',
        topicSequence: ['python-basics', 'python-functions', 'python-oop', 'python-stdlib'],
        estimatedWeeks: 6,
        difficulty: 'gradual',
        bestFor: ['absolute beginners', 'first-time programmers'],
      },
    ],
    scopeAssessment: 'moderate',
    relatedTopics: ['Data Science', 'Web Development', 'Automation', 'Machine Learning'],
  },

  'react': {
    primaryTopic: 'React Development',
    overview: 'React is a JavaScript library for building user interfaces. Learning React involves understanding components, state management, hooks, and the React ecosystem.',
    subtopics: [
      {
        id: 'react-basics',
        name: 'React Fundamentals',
        description: 'JSX, components, props, and basic rendering',
        difficulty: 'foundational',
        estimatedWeeks: 2,
        keywords: ['JSX', 'component', 'props', 'render'],
      },
      {
        id: 'react-state',
        name: 'State & Events',
        description: 'useState, event handling, and controlled components',
        difficulty: 'intermediate',
        estimatedWeeks: 2,
        dependsOn: ['react-basics'],
        keywords: ['useState', 'events', 'controlled', 'forms'],
      },
      {
        id: 'react-hooks',
        name: 'Hooks Deep Dive',
        description: 'useEffect, useContext, useRef, custom hooks',
        difficulty: 'intermediate',
        estimatedWeeks: 2,
        dependsOn: ['react-state'],
        keywords: ['useEffect', 'useContext', 'useRef', 'custom hooks'],
      },
      {
        id: 'react-advanced',
        name: 'Advanced Patterns',
        description: 'Performance optimization, code splitting, and advanced state management',
        difficulty: 'advanced',
        estimatedWeeks: 2,
        dependsOn: ['react-hooks'],
        keywords: ['memo', 'lazy', 'Suspense', 'Context'],
      },
    ],
    prerequisites: [
      {
        topic: 'JavaScript fundamentals',
        importance: 'required',
        reason: 'React is a JavaScript library - you need solid JS foundations',
        estimatedWeeks: 4,
        assessmentQuestion: 'Are you comfortable with ES6 features like arrow functions, destructuring, and async/await?',
      },
      {
        topic: 'HTML & CSS',
        importance: 'required',
        reason: 'React renders HTML and you\'ll style components with CSS',
        estimatedWeeks: 2,
        assessmentQuestion: 'Can you create a basic webpage with HTML and style it with CSS?',
      },
    ],
    learningPaths: [
      {
        id: 'react-modern',
        name: 'Modern React Developer',
        description: 'Focus on hooks-based React with modern patterns',
        topicSequence: ['react-basics', 'react-state', 'react-hooks', 'react-advanced'],
        estimatedWeeks: 8,
        difficulty: 'gradual',
        bestFor: ['JavaScript developers', 'frontend engineers'],
      },
    ],
    scopeAssessment: 'moderate',
    relatedTopics: ['Next.js', 'TypeScript', 'State Management', 'Testing'],
  },
};

/**
 * Extract template key from topic string.
 */
function findTemplateKey(topic: string): string | null {
  const lower = topic.toLowerCase();
  for (const key of Object.keys(TOPIC_TEMPLATES)) {
    if (lower.includes(key)) {
      return key;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC LANDSCAPE GENERATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates comprehensive topic landscapes for learning goals.
 */
export class TopicLandscapeGenerator {
  private openai: OpenAI | null = null;
  private readonly volatilityDetector: VolatilityDetector;
  private readonly config: RefineModuleConfig;
  private readonly webSearchService?: IWebSearchService;

  constructor(
    openaiApiKey?: string,
    config?: Partial<RefineModuleConfig>,
    webSearchService?: IWebSearchService
  ) {
    this.config = { ...DEFAULT_REFINE_CONFIG, ...config };
    this.webSearchService = webSearchService;

    const key = openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    }

    this.volatilityDetector = createVolatilityDetector(key, {
      useLlm: this.config.enableVolatility,
      llmModel: this.config.llmModel,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a topic landscape for a learning goal.
   *
   * @param topic - The learning topic/goal
   * @param exploreContext - Optional context from explore phase
   */
  async generate(
    topic: string,
    exploreContext?: ExploreContext
  ): AsyncAppResult<TopicLandscape> {
    const timestamp = createTimestamp();

    try {
      // Step 1: Assess volatility
      const volatilityResult = await this.volatilityDetector.assess(topic);
      const volatility = volatilityResult.ok
        ? volatilityResult.value
        : { score: 0.4, needsFreshness: false, signals: [], confidence: 'low' as const, method: 'pattern' as const, assessedAt: timestamp };

      // Step 2: Check for template
      const templateKey = findTemplateKey(topic);
      if (templateKey && !exploreContext) {
        // Use template for known topics without explore context
        const template = TOPIC_TEMPLATES[templateKey]!;
        const landscape = this.applyTemplate(template, volatility, timestamp);
        
        // Optionally enrich with web search if volatile
        if (volatility.needsFreshness && this.webSearchService) {
          return ok(await this.enrichWithSearch(landscape, volatility));
        }
        
        return ok(landscape);
      }

      // Step 3: Generate with LLM
      if (this.openai) {
        const llmLandscape = await this.generateWithLlm(topic, volatility, exploreContext, timestamp);
        if (llmLandscape) {
          // Optionally enrich with web search if volatile
          if (volatility.needsFreshness && this.webSearchService) {
            return ok(await this.enrichWithSearch(llmLandscape, volatility));
          }
          return ok(llmLandscape);
        }
      }

      // Step 4: Fall back to minimal landscape
      console.warn('[LANDSCAPE_GENERATOR] Falling back to minimal landscape');
      return ok(createMinimalLandscape(topic, volatility, timestamp));

    } catch (error) {
      console.error('[LANDSCAPE_GENERATOR] Generation error:', error);
      return err(appError('GENERATION_ERROR', 'Failed to generate topic landscape'));
    }
  }

  /**
   * Quick synchronous generation using templates only.
   */
  generateSync(topic: string): TopicLandscape | null {
    const templateKey = findTemplateKey(topic);
    if (!templateKey) {
      return null;
    }

    const timestamp = createTimestamp();
    const volatility = this.volatilityDetector.assessSync(topic);
    const template = TOPIC_TEMPLATES[templateKey]!;
    
    return this.applyTemplate(template, volatility, timestamp);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE APPLICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Apply a template to create a full landscape.
   */
  private applyTemplate(
    template: Partial<TopicLandscape>,
    volatility: VolatilityAssessment,
    timestamp: Timestamp
  ): TopicLandscape {
    return {
      primaryTopic: template.primaryTopic ?? 'Unknown Topic',
      overview: template.overview ?? '',
      subtopics: (template.subtopics ?? []) as readonly TopicNode[],
      prerequisites: (template.prerequisites ?? []) as readonly Prerequisite[],
      learningPaths: (template.learningPaths ?? []) as readonly LearningPath[],
      scopeAssessment: template.scopeAssessment ?? 'moderate',
      volatility,
      deprecations: (template.deprecations ?? []) as readonly DeprecationWarning[],
      relatedTopics: (template.relatedTopics ?? []) as readonly string[],
      generatedAt: timestamp,
      method: 'template',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate landscape using LLM.
   */
  private async generateWithLlm(
    topic: string,
    volatility: VolatilityAssessment,
    exploreContext: ExploreContext | undefined,
    timestamp: Timestamp
  ): Promise<TopicLandscape | null> {
    if (!this.openai) {
      return null;
    }

    try {
      // Build prompt based on whether we have explore context
      let systemPrompt: string;
      let userMessage: string;

      if (exploreContext) {
        systemPrompt = PERSONALIZED_LANDSCAPE_PROMPT
          .replace('{interests}', (exploreContext.interests ?? []).join(', ') || 'not specified')
          .replace('{constraints}', (exploreContext.constraints ?? []).join(', ') || 'not specified')
          .replace('{background}', (exploreContext.background ?? []).join(', ') || 'not specified')
          .replace('{motivations}', (exploreContext.motivations ?? []).join(', ') || 'not specified')
          .replace('{goal}', exploreContext.crystallizedGoal || topic);
        
        userMessage = `Generate a personalized learning landscape for: "${exploreContext.crystallizedGoal || topic}"

User's original statement: "${exploreContext.originalStatement}"
${exploreContext.summary ? `Conversation summary: ${exploreContext.summary}` : ''}`;
      } else {
        systemPrompt = LANDSCAPE_GENERATION_PROMPT;
        userMessage = `Generate a learning landscape for: "${topic}"`;
      }

      const response = await this.openai.chat.completions.create({
        model: this.config.llmModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2000,
        temperature: this.config.llmTemperature,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '';
      const parsed = this.parseLlmLandscape(content);

      if (!parsed) {
        return null;
      }

      return {
        ...parsed,
        volatility,
        generatedAt: timestamp,
        method: 'llm',
      };
    } catch (error) {
      console.error('[LANDSCAPE_GENERATOR] LLM generation error:', error);
      return null;
    }
  }

  /**
   * Parse LLM landscape response.
   */
  private parseLlmLandscape(content: string): Omit<TopicLandscape, 'volatility' | 'generatedAt' | 'method'> | null {
    try {
      // Handle potential markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        jsonStr = match?.[1]?.trim() ?? content;
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Validate and normalize subtopics
      const subtopics = Array.isArray(parsed.subtopics)
        ? parsed.subtopics.map(this.normalizeTopicNode).filter(Boolean) as TopicNode[]
        : [];

      // Validate and normalize prerequisites
      const prerequisites = Array.isArray(parsed.prerequisites)
        ? parsed.prerequisites.map(this.normalizePrerequisite).filter(Boolean) as Prerequisite[]
        : [];

      // Validate and normalize learning paths
      const learningPaths = Array.isArray(parsed.learningPaths)
        ? parsed.learningPaths.map(this.normalizeLearningPath).filter(Boolean) as LearningPath[]
        : [];

      // Validate scope assessment
      const scopeAssessment = isScopeAssessment(parsed.scopeAssessment)
        ? parsed.scopeAssessment
        : 'moderate';

      // Validate deprecations
      const deprecations = Array.isArray(parsed.deprecations)
        ? parsed.deprecations.map(this.normalizeDeprecation).filter(Boolean) as DeprecationWarning[]
        : [];

      return {
        primaryTopic: String(parsed.primaryTopic || ''),
        overview: String(parsed.overview || ''),
        subtopics,
        prerequisites,
        learningPaths,
        scopeAssessment,
        deprecations,
        relatedTopics: Array.isArray(parsed.relatedTopics)
          ? parsed.relatedTopics.map(String)
          : [],
      };
    } catch {
      console.warn('[LANDSCAPE_GENERATOR] Failed to parse LLM response');
      return null;
    }
  }

  /**
   * Normalize a topic node from LLM output.
   */
  private normalizeTopicNode = (node: any): TopicNode | null => {
    if (!node || typeof node !== 'object') {
      return null;
    }

    const difficulty = isTopicDifficulty(node.difficulty)
      ? node.difficulty
      : 'intermediate';

    return {
      id: String(node.id || `topic-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      name: String(node.name || 'Untitled Topic'),
      description: String(node.description || ''),
      difficulty,
      estimatedWeeks: Math.max(1, Math.min(52, Number(node.estimatedWeeks) || 2)),
      children: Array.isArray(node.children)
        ? node.children.map(this.normalizeTopicNode).filter(Boolean) as TopicNode[]
        : undefined,
      dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn.map(String) : undefined,
      keywords: Array.isArray(node.keywords) ? node.keywords.map(String) : undefined,
    };
  };

  /**
   * Normalize a prerequisite from LLM output.
   */
  private normalizePrerequisite = (prereq: any): Prerequisite | null => {
    if (!prereq || typeof prereq !== 'object') {
      return null;
    }

    const importance = ['required', 'recommended', 'helpful'].includes(prereq.importance)
      ? prereq.importance as 'required' | 'recommended' | 'helpful'
      : 'recommended';

    return {
      topic: String(prereq.topic || ''),
      importance,
      reason: String(prereq.reason || ''),
      estimatedWeeks: prereq.estimatedWeeks ? Number(prereq.estimatedWeeks) : undefined,
      assessmentQuestion: prereq.assessmentQuestion ? String(prereq.assessmentQuestion) : undefined,
    };
  };

  /**
   * Normalize a learning path from LLM output.
   */
  private normalizeLearningPath = (path: any): LearningPath | null => {
    if (!path || typeof path !== 'object') {
      return null;
    }

    const difficulty = ['gradual', 'intensive', 'self-paced'].includes(path.difficulty)
      ? path.difficulty as 'gradual' | 'intensive' | 'self-paced'
      : 'gradual';

    return {
      id: String(path.id || `path-${Date.now()}`),
      name: String(path.name || 'Learning Path'),
      description: String(path.description || ''),
      targetRole: path.targetRole ? String(path.targetRole) : undefined,
      topicSequence: Array.isArray(path.topicSequence) ? path.topicSequence.map(String) : [],
      estimatedWeeks: Math.max(1, Math.min(52, Number(path.estimatedWeeks) || 4)),
      difficulty,
      bestFor: Array.isArray(path.bestFor) ? path.bestFor.map(String) : [],
    };
  };

  /**
   * Normalize a deprecation warning from LLM output.
   */
  private normalizeDeprecation = (dep: any): DeprecationWarning | null => {
    if (!dep || typeof dep !== 'object') {
      return null;
    }

    const severity = ['info', 'warning', 'critical'].includes(dep.severity)
      ? dep.severity as 'info' | 'warning' | 'critical'
      : 'info';

    return {
      subject: String(dep.subject || ''),
      reason: String(dep.reason || ''),
      alternative: dep.alternative ? String(dep.alternative) : undefined,
      since: dep.since ? String(dep.since) : undefined,
      severity,
    };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // WEB SEARCH ENRICHMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enrich landscape with web search results.
   */
  private async enrichWithSearch(
    landscape: TopicLandscape,
    volatility: VolatilityAssessment
  ): Promise<TopicLandscape> {
    if (!this.webSearchService || !volatility.suggestedSearchTopics?.length) {
      return landscape;
    }

    try {
      const searchResults: WebSearchResponse[] = [];

      // Search for each suggested topic
      for (const query of volatility.suggestedSearchTopics.slice(0, 3)) {
        const response = await this.webSearchService.search({
          query,
          maxResults: this.config.maxSearchResults,
          timeRange: 'year',
        });
        searchResults.push(response);
      }

      // Build freshness info
      const freshness: FreshnessInfo = {
        checkedAt: createTimestamp(),
        sources: searchResults.flatMap(r => r.results.map(res => res.domain)),
        findings: this.extractFindings(searchResults),
        isCurrent: true, // Assume current since we just searched
        latestVersion: this.extractLatestVersion(searchResults),
      };

      // Extract any deprecation warnings from search results
      const newDeprecations = this.extractDeprecations(searchResults, landscape.deprecations);

      return {
        ...landscape,
        freshness,
        deprecations: newDeprecations,
      };
    } catch (error) {
      console.error('[LANDSCAPE_GENERATOR] Web search enrichment error:', error);
      return landscape;
    }
  }

  /**
   * Extract key findings from search results.
   */
  private extractFindings(searchResults: WebSearchResponse[]): string[] {
    const findings: string[] = [];
    const currentYear = new Date().getFullYear();

    for (const response of searchResults) {
      for (const result of response.results.slice(0, 2)) {
        // Look for version mentions or recent changes
        if (result.snippet.match(/\b(version|v)\s*\d+/i) ||
            result.snippet.includes(String(currentYear))) {
          findings.push(result.snippet.substring(0, 200));
        }
      }
    }

    return findings.slice(0, 5);
  }

  /**
   * Extract latest version from search results.
   */
  private extractLatestVersion(searchResults: WebSearchResponse[]): string | undefined {
    for (const response of searchResults) {
      for (const result of response.results) {
        // Look for version patterns
        const versionMatch = result.snippet.match(/\b(version|v)\s*(\d+(\.\d+)*)/i);
        if (versionMatch) {
          return versionMatch[2];
        }
      }
    }
    return undefined;
  }

  /**
   * Extract deprecation warnings from search results.
   */
  private extractDeprecations(
    searchResults: WebSearchResponse[],
    existing: readonly DeprecationWarning[]
  ): readonly DeprecationWarning[] {
    const newDeprecations: DeprecationWarning[] = [...existing];

    for (const response of searchResults) {
      for (const result of response.results) {
        // Look for deprecation mentions
        if (result.snippet.toLowerCase().includes('deprecated') ||
            result.snippet.toLowerCase().includes('no longer supported')) {
          // Simple extraction - could be more sophisticated
          newDeprecations.push({
            subject: result.title,
            reason: result.snippet.substring(0, 200),
            severity: 'info',
          });
        }
      }
    }

    return newDeprecations;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the volatility detector for external use.
   */
  getVolatilityDetector(): VolatilityDetector {
    return this.volatilityDetector;
  }

  /**
   * Check if web search service is available.
   */
  hasWebSearch(): boolean {
    return !!this.webSearchService?.isAvailable();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a TopicLandscapeGenerator instance.
 */
export function createTopicLandscapeGenerator(
  openaiApiKey?: string,
  config?: Partial<RefineModuleConfig>,
  webSearchService?: IWebSearchService
): TopicLandscapeGenerator {
  return new TopicLandscapeGenerator(openaiApiKey, config, webSearchService);
}
