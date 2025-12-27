// ═══════════════════════════════════════════════════════════════════════════════
// LESSON PLAN GENERATOR — Goal → Curriculum Pipeline
// NovaOS Gates — Phase 13: SwordGate Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates lesson plan proposals from refined user inputs:
//   1. Extract topics from goal statement
//   2. Discover resources (Phase 6)
//   3. Generate capability-based progression (DYNAMIC via LLM)
//   4. Build LessonPlanProposal for user confirmation
//
// The Universal 5-Stage Competence Model:
//   1. REPRODUCE — Create basic outcome unaided
//   2. MODIFY    — Change it under constraints
//   3. DIAGNOSE  — Find and fix failures
//   4. DESIGN    — Build independently from requirements
//   5. SHIP      — Deploy and defend decisions
//
// ═══════════════════════════════════════════════════════════════════════════════

import { createTimestamp } from '../../types/branded.js';
import type { Timestamp } from '../../types/branded.js';
import type { AsyncAppResult, AppError } from '../../types/result.js';
import { ok, err, appError } from '../../types/result.js';

import type { LearningConfig, UserLevel, DayOfWeek } from '../../services/spark-engine/types.js';

import type {
  SwordRefinementInputs,
  SwordGateConfig,
  LessonPlanProposal,
  ProposedQuest,
} from './types.js';

import {
  CapabilityGenerator,
  createCapabilityGenerator,
  extractTopicsFromStages,
  type CapabilityStage,
} from './capability-generator.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 6 & 7 INTEGRATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verified resource from Phase 6.
 * Simplified interface for our needs.
 */
export interface VerifiedResource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly provider: string;
  readonly contentType: string;
  readonly topics: readonly string[];
  readonly estimatedMinutes?: number;
  readonly difficulty?: string;
  readonly quality?: {
    readonly score: number;
  };
}

/**
 * Resource discovery request.
 */
export interface ResourceDiscoveryRequest {
  readonly topics: readonly string[];
  readonly maxResults?: number;
  readonly contentTypes?: readonly string[];
  readonly difficulty?: string;
  /** Main search keywords (e.g., the goal: "coding", "python", "cybersecurity") */
  readonly keywords?: readonly string[];
}

/**
 * Resource discovery result.
 */
export interface ResourceDiscoveryResult {
  readonly resources: readonly VerifiedResource[];
  readonly topicsCovered: readonly string[];
  readonly gaps: readonly string[];
}

/**
 * Curriculum generation request.
 */
export interface CurriculumRequest {
  readonly goal: string;
  readonly resources: readonly VerifiedResource[];
  readonly days: number;
  readonly minutesPerDay: number;
  readonly targetDifficulty: string;
  readonly topics: readonly string[];
  readonly userId?: string;
  readonly preferences?: {
    readonly includeExercises?: boolean;
    readonly progression?: 'gradual' | 'intensive' | 'relaxed';
  };
}

/**
 * Generated curriculum structure.
 */
export interface GeneratedCurriculum {
  readonly days: readonly CurriculumDay[];
  readonly summary: string;
  readonly totalMinutes: number;
  readonly topicsCovered: readonly string[];
}

/**
 * Single day in the curriculum.
 */
export interface CurriculumDay {
  readonly day: number;
  readonly theme: string;
  readonly objectives: readonly string[];
  readonly resources: readonly {
    readonly resourceId: string;
    readonly title: string;
    readonly minutes: number;
    readonly focus?: string;
  }[];
  readonly exercises: readonly {
    readonly type: string;
    readonly description: string;
    readonly minutes: number;
  }[];
  readonly totalMinutes: number;
}

/**
 * Interface for resource discovery service.
 */
export interface IResourceDiscoveryService {
  discover(request: ResourceDiscoveryRequest): AsyncAppResult<ResourceDiscoveryResult>;
}

/**
 * Interface for curriculum generation service.
 */
export interface ICurriculumService {
  generate(request: CurriculumRequest): AsyncAppResult<GeneratedCurriculum>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY-BASED LEARNING PROGRESSIONS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Learning plans must build COMPETENCE, not just expose CONTENT.
//
// Each stage answers: "What can the learner reliably DO after this stage?"
// If you can't phrase it as a verb, it doesn't count.
//
// Structure:
//   - capability: Verb-based outcome (diagnose, produce, explain, decide, repair)
//   - artifact: Inspectable, falsifiable output (not quizzes)
//   - designedFailure: Intentional mistake to expose and recover from
//   - transfer: Force application in new context without scaffolding
//
// The 5-stage model:
//   1. REPRODUCE: Create a basic outcome unaided
//   2. MODIFY: Change it under constraints
//   3. DIAGNOSE: Find and fix failures
//   4. DESIGN: Build independently from requirements
//   5. SHIP: Deploy and defend decisions
//
// ═══════════════════════════════════════════════════════════════════════════════

// NOTE: CapabilityStage is now imported from capability-generator.ts
// The 5-stage competence model is generated dynamically for ANY topic.

/**
 * STATIC CACHE: Common topic progressions for instant response.
 * These are pre-built for popular topics to avoid LLM latency.
 * The CapabilityGenerator is used for all other topics.
 */
const CAPABILITY_PROGRESSIONS: Record<string, readonly CapabilityStage[]> = {
  'rust': [
    {
      title: 'Build & Run Your First Program',
      capability: 'Create, compile, and run a Rust program that takes input and produces output',
      artifact: 'CLI tool that greets a user by name (cargo new → cargo run)',
      designedFailure: 'Ownership error when trying to use a moved String',
      transfer: 'Modify the greeting to read from a file instead of stdin',
      topics: ['cargo', 'main', 'println', 'stdin', 'String'],
    },
    {
      title: 'Own Your Data',
      capability: 'Predict and fix ownership/borrowing errors without compiler hints',
      artifact: 'Function that processes a Vec without cloning unnecessarily',
      designedFailure: 'Dangling reference from returning borrowed data',
      transfer: 'Refactor existing code to eliminate all .clone() calls',
      topics: ['ownership', 'borrowing', 'references', 'lifetimes'],
    },
    {
      title: 'Model Real Data',
      capability: 'Design structs and enums that make invalid states unrepresentable',
      artifact: 'Type system that prevents invalid state transitions',
      designedFailure: 'Runtime bug from allowing invalid state',
      transfer: 'Model a different domain using the same patterns',
      topics: ['structs', 'enums', 'pattern-matching', 'Option', 'Result'],
    },
    {
      title: 'Handle Failure Gracefully',
      capability: 'Propagate and transform errors through a call stack',
      artifact: 'Application with custom error types and ? operator throughout',
      designedFailure: 'Unwrap panic in production path',
      transfer: 'Add error handling to an existing panic-prone codebase',
      topics: ['Result', 'Option', 'error-handling', 'thiserror', 'anyhow'],
    },
    {
      title: 'Ship a Real Tool',
      capability: 'Build, test, document, and publish a crate others can use',
      artifact: 'Published crate on crates.io with tests, docs, and CI',
      designedFailure: 'Breaking change without semver bump',
      transfer: 'Contribute a fix to an existing open-source Rust project',
      topics: ['testing', 'documentation', 'ci-cd', 'publishing', 'semver'],
    },
  ],

  'python': [
    {
      title: 'Automate a Manual Task',
      capability: 'Write a script that replaces a repetitive manual process',
      artifact: 'Script that processes files in a directory and produces a report',
      designedFailure: 'Script crashes on unexpected file format',
      transfer: 'Adapt the script to work with a different data source',
      topics: ['files', 'os', 'pathlib', 'csv', 'json'],
    },
    {
      title: 'Structure Your Code',
      capability: 'Organize code into functions and modules that others can understand',
      artifact: 'Refactored script with clear module boundaries and docstrings',
      designedFailure: 'Circular import error',
      transfer: 'Explain your code structure to someone else and incorporate feedback',
      topics: ['functions', 'modules', 'packages', 'docstrings', 'imports'],
    },
    {
      title: 'Debug Like a Detective',
      capability: 'Systematically find and fix bugs in unfamiliar code',
      artifact: 'Fixed bug in a codebase you didnt write, with explanation',
      designedFailure: 'Silent data corruption from type coercion',
      transfer: 'Debug a different type of bug (logic vs runtime vs performance)',
      topics: ['debugging', 'pdb', 'logging', 'exceptions', 'testing'],
    },
    {
      title: 'Build a Data Pipeline',
      capability: 'Extract, transform, and load data reliably with error recovery',
      artifact: 'Pipeline that handles failures gracefully and is idempotent',
      designedFailure: 'Partial failure leaves data inconsistent',
      transfer: 'Add a new data source to your existing pipeline',
      topics: ['pandas', 'requests', 'databases', 'error-handling', 'idempotency'],
    },
    {
      title: 'Deploy and Monitor',
      capability: 'Package, deploy, and maintain a Python application in production',
      artifact: 'Running service with logging, monitoring, and alerting',
      designedFailure: 'Memory leak discovered via monitoring',
      transfer: 'Respond to a production incident and write a post-mortem',
      topics: ['packaging', 'docker', 'logging', 'monitoring', 'deployment'],
    },
  ],

  'javascript': [
    {
      title: 'Make Something Interactive',
      capability: 'Build a UI that responds to user actions in real-time',
      artifact: 'Interactive widget (calculator, quiz, or form validator)',
      designedFailure: 'Event handler memory leak from not removing listeners',
      transfer: 'Add keyboard shortcuts to your existing UI',
      topics: ['dom', 'events', 'querySelector', 'addEventListener'],
    },
    {
      title: 'Fetch and Display Data',
      capability: 'Load data from an API and handle loading/error/success states',
      artifact: 'App that fetches, displays, and refreshes external data',
      designedFailure: 'UI shows stale data after failed refresh',
      transfer: 'Add caching and optimistic updates',
      topics: ['fetch', 'promises', 'async-await', 'error-handling', 'loading-states'],
    },
    {
      title: 'Manage Complex State',
      capability: 'Organize application state so changes are predictable and debuggable',
      artifact: 'App with undo/redo and state persistence across sessions',
      designedFailure: 'State mutation bug causing inconsistent UI',
      transfer: 'Add time-travel debugging to your state management',
      topics: ['state-management', 'immutability', 'reducers', 'localStorage'],
    },
    {
      title: 'Test Your Assumptions',
      capability: 'Write tests that catch bugs before users do',
      artifact: 'Test suite with unit, integration, and E2E tests',
      designedFailure: 'Flaky test that passes/fails randomly',
      transfer: 'Add tests to untested legacy code',
      topics: ['jest', 'testing-library', 'cypress', 'mocking', 'tdd'],
    },
    {
      title: 'Ship to Real Users',
      capability: 'Deploy, measure, and iterate on a production application',
      artifact: 'Deployed app with analytics, error tracking, and CI/CD',
      designedFailure: 'JavaScript error in production affecting 10% of users',
      transfer: 'A/B test a feature and make a data-driven decision',
      topics: ['bundling', 'deployment', 'analytics', 'error-tracking', 'ci-cd'],
    },
  ],

  'web development': [
    {
      title: 'Build a Static Site',
      capability: 'Create a multi-page website with consistent styling and navigation',
      artifact: 'Personal portfolio or landing page deployed to the web',
      designedFailure: 'Layout breaks on mobile devices',
      transfer: 'Rebuild the same site using a different CSS approach',
      topics: ['html', 'css', 'responsive', 'deployment', 'accessibility'],
    },
    {
      title: 'Add Dynamic Behavior',
      capability: 'Make pages interactive without a framework',
      artifact: 'Site feature that responds to user input (form, filter, or animation)',
      designedFailure: 'JavaScript error prevents form submission',
      transfer: 'Add the same feature to a different page structure',
      topics: ['javascript', 'dom', 'events', 'forms', 'validation'],
    },
    {
      title: 'Connect to a Backend',
      capability: 'Build a full-stack feature that persists user data',
      artifact: 'Feature where users can create, read, update, and delete data',
      designedFailure: 'Race condition causes data loss',
      transfer: 'Add authentication to your existing CRUD feature',
      topics: ['fetch', 'rest-api', 'database', 'crud', 'authentication'],
    },
    {
      title: 'Handle Scale and Failure',
      capability: 'Build features that work under load and recover from errors',
      artifact: 'Feature with loading states, error boundaries, and retry logic',
      designedFailure: 'API timeout causes infinite loading spinner',
      transfer: 'Add offline support to your feature',
      topics: ['error-handling', 'loading-states', 'caching', 'offline', 'performance'],
    },
    {
      title: 'Ship and Maintain',
      capability: 'Deploy, monitor, and iterate on a production web application',
      artifact: 'Production app with CI/CD, monitoring, and documentation',
      designedFailure: 'Deployment breaks a feature for subset of users',
      transfer: 'Write runbook for handling common production issues',
      topics: ['ci-cd', 'monitoring', 'documentation', 'deployment', 'maintenance'],
    },
  ],

  'full-stack web development': [
    {
      title: 'Build End-to-End',
      capability: 'Create a feature that spans UI, API, and database',
      artifact: 'Working feature: user submits form → API saves → page updates',
      designedFailure: 'Data saved but UI shows error (partial failure)',
      transfer: 'Build same feature with different tech stack',
      topics: ['frontend', 'backend', 'database', 'api', 'integration'],
    },
    {
      title: 'Secure Your Stack',
      capability: 'Implement authentication that actually protects user data',
      artifact: 'Auth system with registration, login, sessions, and protected routes',
      designedFailure: 'JWT stored in localStorage stolen via XSS',
      transfer: 'Add OAuth provider to existing auth system',
      topics: ['authentication', 'authorization', 'jwt', 'sessions', 'security'],
    },
    {
      title: 'Debug Across Boundaries',
      capability: 'Trace and fix bugs that span frontend, backend, and database',
      artifact: 'Fixed cross-cutting bug with documented root cause analysis',
      designedFailure: 'Timezone bug causes data to appear on wrong day',
      transfer: 'Add distributed tracing to your application',
      topics: ['debugging', 'logging', 'tracing', 'devtools', 'monitoring'],
    },
    {
      title: 'Optimize for Reality',
      capability: 'Make your application fast and reliable under real conditions',
      artifact: 'Performance improvements measured with before/after metrics',
      designedFailure: 'N+1 query discovered under load',
      transfer: 'Optimize a different bottleneck (network, render, memory)',
      topics: ['performance', 'caching', 'database-optimization', 'profiling', 'cdn'],
    },
    {
      title: 'Own Your System',
      capability: 'Deploy, monitor, and maintain a system you can be on-call for',
      artifact: 'Production system with alerts, runbooks, and incident response',
      designedFailure: 'Wake up to alert, diagnose, and resolve without help',
      transfer: 'Hand off your system to another developer with documentation',
      topics: ['devops', 'monitoring', 'alerting', 'incident-response', 'documentation'],
    },
  ],

  'back-end web development': [
    {
      title: 'Build an API',
      capability: 'Create a REST API that another developer can use correctly',
      artifact: 'Documented API with consistent responses and error handling',
      designedFailure: 'Inconsistent error format breaks client integration',
      transfer: 'Add versioning to your API without breaking existing clients',
      topics: ['rest', 'express', 'routing', 'error-handling', 'documentation'],
    },
    {
      title: 'Persist Data Correctly',
      capability: 'Design a database schema that supports your features without corruption',
      artifact: 'Schema with migrations, constraints, and documented relationships',
      designedFailure: 'Missing foreign key allows orphaned records',
      transfer: 'Add a new feature requiring schema migration',
      topics: ['sql', 'schema-design', 'migrations', 'constraints', 'normalization'],
    },
    {
      title: 'Handle Concurrent Access',
      capability: 'Build features that work correctly when multiple users act simultaneously',
      artifact: 'Feature that handles race conditions with optimistic locking',
      designedFailure: 'Double-submit causes duplicate records',
      transfer: 'Add rate limiting to prevent abuse',
      topics: ['concurrency', 'transactions', 'locking', 'idempotency', 'rate-limiting'],
    },
    {
      title: 'Integrate External Services',
      capability: 'Build reliable integrations that handle third-party failures gracefully',
      artifact: 'Integration with retry logic, circuit breaker, and fallbacks',
      designedFailure: 'Third-party timeout causes cascade failure',
      transfer: 'Add a new external service to your existing integration pattern',
      topics: ['integrations', 'retry', 'circuit-breaker', 'queues', 'webhooks'],
    },
    {
      title: 'Scale and Operate',
      capability: 'Run a backend service that stays up and performs under load',
      artifact: 'Service with health checks, metrics, and horizontal scaling',
      designedFailure: 'Memory leak causes gradual degradation',
      transfer: 'Perform a zero-downtime deployment with database migration',
      topics: ['scaling', 'containers', 'health-checks', 'metrics', 'deployment'],
    },
  ],

  'cybersecurity': [
    {
      title: 'Understand the Threat Landscape',
      capability: 'Identify and classify common attack vectors and vulnerabilities',
      artifact: 'Threat model for a sample application with ranked risks',
      designedFailure: 'Miss a critical vulnerability category in your assessment',
      transfer: 'Create a threat model for a different system architecture',
      topics: ['threat-modeling', 'vulnerabilities', 'attack-vectors', 'risk-assessment'],
    },
    {
      title: 'Defend the Network',
      capability: 'Configure firewalls and IDS/IPS to detect and block attacks',
      artifact: 'Working firewall rules and IDS alerts for common attack patterns',
      designedFailure: 'Overly permissive rule allows lateral movement',
      transfer: 'Audit and harden an existing firewall configuration',
      topics: ['firewalls', 'ids', 'ips', 'network-security', 'packet-filtering'],
    },
    {
      title: 'Secure Systems and Endpoints',
      capability: 'Harden operating systems and detect endpoint compromises',
      artifact: 'Hardening checklist applied to a test system with before/after scan',
      designedFailure: 'Default credentials left on a service',
      transfer: 'Create a hardening guide for a different OS or platform',
      topics: ['hardening', 'endpoints', 'patch-management', 'antivirus', 'edr'],
    },
    {
      title: 'Respond to Incidents',
      capability: 'Detect, investigate, and contain a security incident',
      artifact: 'Incident report with timeline, root cause, and remediation steps',
      designedFailure: 'Evidence destroyed by improper response procedure',
      transfer: 'Run a tabletop exercise for a different incident type',
      topics: ['incident-response', 'forensics', 'containment', 'recovery', 'post-mortem'],
    },
    {
      title: 'Build a Security Program',
      capability: 'Design and implement security policies and monitoring',
      artifact: 'Security policy document with monitoring dashboard',
      designedFailure: 'Alert fatigue causes real threat to be ignored',
      transfer: 'Present security posture to stakeholders and get buy-in',
      topics: ['security-policy', 'monitoring', 'compliance', 'siem', 'metrics'],
    },
  ],
};

/**
 * Get capability-based progression for a topic.
 */
/**
 * Topic aliases for matching variations to canonical progressions.
 */
const TOPIC_ALIASES: Record<string, string> = {
  // Backend variations
  'backend': 'back-end web development',
  'backend coding': 'back-end web development',
  'backend development': 'back-end web development',
  'back-end': 'back-end web development',
  'back-end coding': 'back-end web development',
  'server-side': 'back-end web development',
  'server side': 'back-end web development',
  'api development': 'back-end web development',
  
  // Frontend variations
  'frontend': 'web development',
  'frontend coding': 'web development',
  'front-end': 'web development',
  'front-end coding': 'web development',
  'client-side': 'web development',
  
  // Full-stack variations
  'fullstack': 'full-stack web development',
  'full stack': 'full-stack web development',
  'fullstack coding': 'full-stack web development',
  'full-stack coding': 'full-stack web development',
  
  // Generic coding
  'coding': 'web development',
  'programming': 'python',
  'code': 'web development',
  'learn to code': 'web development',
  'how to code': 'web development',
  
  // Language variations
  'js': 'javascript',
  'py': 'python',
  'ts': 'typescript',
  'node': 'javascript',
  'nodejs': 'javascript',
  
  // Cybersecurity variations
  'cybersecurity': 'cybersecurity',
  'cyber security': 'cybersecurity',
  'security': 'cybersecurity',
  'infosec': 'cybersecurity',
  'information security': 'cybersecurity',
  'network security': 'cybersecurity',
  'firewall': 'cybersecurity',
  'firewalls': 'cybersecurity',
  'intrusion detection': 'cybersecurity',
  'ids': 'cybersecurity',
  'ips': 'cybersecurity',
  'ethical hacking': 'cybersecurity',
  'penetration testing': 'cybersecurity',
  'pentest': 'cybersecurity',
  'security analyst': 'cybersecurity',
  'soc': 'cybersecurity',
  'threat detection': 'cybersecurity',
  'vulnerability': 'cybersecurity',
  'vulnerabilities': 'cybersecurity',
  'protect systems': 'cybersecurity',
  'protecting systems': 'cybersecurity',
  'system protection': 'cybersecurity',
};

/**
 * Get capability-based progression for a topic.
 */
function getCapabilityProgression(topic: string): readonly CapabilityStage[] | null {
  const normalized = topic.toLowerCase().trim()
    .replace(/^learn\s+(to\s+)?/i, '')  // Remove "learn" / "learn to" prefix
    .replace(/^how\s+to\s+/i, '')       // Remove "how to" prefix
    .trim();
  
  // Direct match
  if (CAPABILITY_PROGRESSIONS[normalized]) {
    console.log(`[CAPABILITY] Direct match: "${normalized}"`);
    return CAPABILITY_PROGRESSIONS[normalized];
  }
  
  // Check aliases
  if (TOPIC_ALIASES[normalized] && CAPABILITY_PROGRESSIONS[TOPIC_ALIASES[normalized]]) {
    console.log(`[CAPABILITY] Alias match: "${normalized}" -> "${TOPIC_ALIASES[normalized]}"`);
    return CAPABILITY_PROGRESSIONS[TOPIC_ALIASES[normalized]];
  }
  
  // Partial match on keys
  for (const [key, progression] of Object.entries(CAPABILITY_PROGRESSIONS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      console.log(`[CAPABILITY] Partial key match: "${key}" in "${normalized.substring(0, 30)}..."`);
      return progression;
    }
  }
  
  // Partial match on aliases
  for (const [alias, canonical] of Object.entries(TOPIC_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      if (CAPABILITY_PROGRESSIONS[canonical]) {
        console.log(`[CAPABILITY] Partial alias match: "${alias}" -> "${canonical}"`);
        return CAPABILITY_PROGRESSIONS[canonical];
      }
    }
  }
  
  console.log(`[CAPABILITY] No match for: "${normalized.substring(0, 50)}..."`);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY TOPIC PROGRESSIONS (for topics without capability-based versions)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Topic-specific learning progressions (legacy format).
 * Used as fallback when capability-based progression doesn't exist.
 */
const TOPIC_PROGRESSIONS: Record<string, readonly { title: string; description: string; topics: string[] }[]> = {
  'typescript': [
    { title: 'TypeScript Setup & Basics', description: 'Install TypeScript, configure tsconfig, basic types', topics: ['installation', 'tsconfig', 'basic-types'] },
    { title: 'Type Annotations & Inference', description: 'Explicit types, type inference, type assertions', topics: ['annotations', 'inference', 'assertions'] },
    { title: 'Interfaces & Type Aliases', description: 'Define object shapes, extend interfaces, union types', topics: ['interfaces', 'type-aliases', 'unions', 'intersections'] },
    { title: 'Functions & Generics', description: 'Typed functions, generic functions and classes', topics: ['typed-functions', 'generics', 'constraints'] },
    { title: 'Classes & OOP in TypeScript', description: 'Access modifiers, abstract classes, implements', topics: ['classes', 'access-modifiers', 'abstract', 'implements'] },
    { title: 'Advanced Types', description: 'Mapped types, conditional types, utility types', topics: ['mapped-types', 'conditional-types', 'utility-types'] },
    { title: 'Modules & Declaration Files', description: 'ES modules, ambient declarations, DefinitelyTyped', topics: ['modules', 'declarations', 'd-ts-files'] },
    { title: 'Build a Type-Safe Project', description: 'Create a fully typed application', topics: ['project', 'type-safety'] },
  ],
  'react': [
    { title: 'React Fundamentals', description: 'JSX, components, props, and rendering', topics: ['jsx', 'components', 'props', 'rendering'] },
    { title: 'State & Events', description: 'useState hook, event handling, controlled components', topics: ['useState', 'events', 'controlled-components'] },
    { title: 'Component Lifecycle & Effects', description: 'useEffect hook, cleanup, dependencies', topics: ['useEffect', 'lifecycle', 'cleanup'] },
    { title: 'Lists, Forms & Conditional Rendering', description: 'Rendering lists, form handling, conditional display', topics: ['lists', 'forms', 'conditional-rendering', 'keys'] },
    { title: 'Context & State Management', description: 'useContext, useReducer, lifting state up', topics: ['useContext', 'useReducer', 'state-management'] },
    { title: 'Custom Hooks & Performance', description: 'Create reusable hooks, useMemo, useCallback, React.memo', topics: ['custom-hooks', 'useMemo', 'useCallback', 'optimization'] },
    { title: 'Routing & Data Fetching', description: 'React Router, fetching data, loading states', topics: ['react-router', 'data-fetching', 'suspense'] },
    { title: 'Build a React Application', description: 'Create a complete React app from scratch', topics: ['project', 'deployment'] },
  ],
  'go': [
    { title: 'Go Fundamentals', description: 'Installation, workspace, variables, types, and fmt', topics: ['installation', 'workspace', 'variables', 'types'] },
    { title: 'Control Flow & Functions', description: 'If/else, loops, functions, multiple return values', topics: ['control-flow', 'functions', 'multiple-returns'] },
    { title: 'Arrays, Slices & Maps', description: 'Work with Go\'s built-in data structures', topics: ['arrays', 'slices', 'maps', 'range'] },
    { title: 'Structs & Methods', description: 'Define types with structs, attach methods, pointers', topics: ['structs', 'methods', 'pointers', 'receivers'] },
    { title: 'Interfaces & Error Handling', description: 'Implicit interfaces, error handling patterns', topics: ['interfaces', 'errors', 'panic-recover'] },
    { title: 'Packages & Modules', description: 'Organize code, go modules, importing packages', topics: ['packages', 'modules', 'go-mod'] },
    { title: 'Concurrency with Goroutines', description: 'Goroutines, channels, select, sync package', topics: ['goroutines', 'channels', 'select', 'sync'] },
    { title: 'Build a Go Service', description: 'Create a web service or CLI tool', topics: ['project', 'http', 'json'] },
  ],
  'sql': [
    { title: 'SQL Basics & SELECT', description: 'Database concepts, SELECT queries, filtering with WHERE', topics: ['select', 'where', 'basics'] },
    { title: 'Sorting, Limiting & Functions', description: 'ORDER BY, LIMIT, aggregate functions', topics: ['order-by', 'limit', 'count', 'sum', 'avg'] },
    { title: 'JOINs & Relationships', description: 'INNER JOIN, LEFT JOIN, table relationships', topics: ['joins', 'inner-join', 'left-join', 'foreign-keys'] },
    { title: 'Grouping & Subqueries', description: 'GROUP BY, HAVING, nested queries', topics: ['group-by', 'having', 'subqueries'] },
    { title: 'Data Modification', description: 'INSERT, UPDATE, DELETE, transactions', topics: ['insert', 'update', 'delete', 'transactions'] },
    { title: 'Table Design & Constraints', description: 'CREATE TABLE, constraints, indexes', topics: ['create-table', 'constraints', 'indexes'] },
    { title: 'Advanced Queries', description: 'Window functions, CTEs, query optimization', topics: ['window-functions', 'cte', 'optimization'] },
    { title: 'Database Project', description: 'Design and query a complete database', topics: ['project', 'schema-design'] },
  ],
  'docker': [
    { title: 'Docker Fundamentals', description: 'Install Docker, understand containers vs VMs, basic commands', topics: ['installation', 'containers', 'images'] },
    { title: 'Working with Images', description: 'Pull, build, and manage Docker images', topics: ['pull', 'build', 'dockerfile'] },
    { title: 'Container Management', description: 'Run, stop, remove containers, logs, exec', topics: ['run', 'stop', 'logs', 'exec'] },
    { title: 'Dockerfile Deep Dive', description: 'Write efficient Dockerfiles, multi-stage builds', topics: ['dockerfile', 'multi-stage', 'layers'] },
    { title: 'Volumes & Networking', description: 'Persist data, connect containers, expose ports', topics: ['volumes', 'networking', 'ports'] },
    { title: 'Docker Compose', description: 'Define multi-container apps with docker-compose', topics: ['compose', 'yaml', 'services'] },
    { title: 'Best Practices & Security', description: 'Image optimization, security scanning, secrets', topics: ['best-practices', 'security', 'optimization'] },
    { title: 'Containerize a Project', description: 'Dockerize a complete application', topics: ['project', 'deployment'] },
  ],
  'git': [
    { title: 'Git Basics', description: 'Install git, init, add, commit, status', topics: ['install', 'init', 'add', 'commit'] },
    { title: 'Branching & Merging', description: 'Create branches, merge, resolve conflicts', topics: ['branch', 'merge', 'conflicts'] },
    { title: 'Remote Repositories', description: 'Clone, push, pull, work with GitHub/GitLab', topics: ['clone', 'push', 'pull', 'remote'] },
    { title: 'History & Undoing Changes', description: 'Log, diff, reset, revert, checkout', topics: ['log', 'diff', 'reset', 'revert'] },
    { title: 'Collaboration Workflows', description: 'Pull requests, code review, gitflow', topics: ['pull-requests', 'code-review', 'gitflow'] },
    { title: 'Advanced Git', description: 'Rebase, cherry-pick, stash, tags', topics: ['rebase', 'cherry-pick', 'stash', 'tags'] },
  ],
  'machine learning': [
    { title: 'ML Fundamentals', description: 'What is ML, types of learning, basic terminology', topics: ['introduction', 'supervised', 'unsupervised'] },
    { title: 'Data Preparation', description: 'Data cleaning, feature engineering, train/test split', topics: ['data-cleaning', 'features', 'train-test-split'] },
    { title: 'Linear Models', description: 'Linear regression, logistic regression, evaluation metrics', topics: ['linear-regression', 'logistic-regression', 'metrics'] },
    { title: 'Tree-Based Models', description: 'Decision trees, random forests, gradient boosting', topics: ['decision-trees', 'random-forest', 'xgboost'] },
    { title: 'Model Evaluation', description: 'Cross-validation, hyperparameter tuning, overfitting', topics: ['cross-validation', 'hyperparameters', 'overfitting'] },
    { title: 'Unsupervised Learning', description: 'Clustering, dimensionality reduction, PCA', topics: ['clustering', 'kmeans', 'pca'] },
    { title: 'Neural Networks Intro', description: 'Perceptrons, backpropagation, basic neural nets', topics: ['neural-networks', 'backpropagation', 'activation'] },
    { title: 'ML Project', description: 'Build an end-to-end ML pipeline', topics: ['project', 'pipeline', 'deployment'] },
  ],
  'front-end web development': [
    { title: 'HTML Structure', description: 'Semantic HTML, accessibility, SEO basics', topics: ['html', 'semantic', 'accessibility', 'seo'] },
    { title: 'CSS Mastery', description: 'Advanced layouts, animations, CSS architecture', topics: ['css', 'animations', 'bem', 'sass'] },
    { title: 'JavaScript Fundamentals', description: 'Core language, DOM, browser APIs', topics: ['javascript', 'dom', 'browser-api'] },
    { title: 'Modern JavaScript', description: 'ES6+, modules, tooling (Webpack, Vite)', topics: ['es6', 'modules', 'webpack', 'vite'] },
    { title: 'React Fundamentals', description: 'Components, JSX, props, state, hooks', topics: ['react', 'jsx', 'hooks', 'state'] },
    { title: 'Advanced React', description: 'Context, reducers, performance, testing', topics: ['context', 'reducer', 'testing', 'performance'] },
    { title: 'State Management', description: 'Redux, Zustand, React Query', topics: ['redux', 'zustand', 'react-query'] },
    { title: 'Build a Portfolio', description: 'Create production-ready front-end projects', topics: ['project', 'portfolio', 'deployment'] },
  ],
};

/**
 * Get topic progression for a given topic, or null if not found.
 */
function getTopicProgression(topic: string): readonly { title: string; description: string; topics: string[] }[] | null {
  const normalized = topic.toLowerCase().trim();
  
  // Direct match
  if (TOPIC_PROGRESSIONS[normalized]) {
    return TOPIC_PROGRESSIONS[normalized];
  }
  
  // Partial match
  for (const [key, progression] of Object.entries(TOPIC_PROGRESSIONS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return progression;
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common topic mappings for learning goals.
 * Maps keywords to topic IDs for resource discovery.
 */
const TOPIC_MAPPINGS: Record<string, readonly string[]> = {
  // Programming languages
  'rust': ['language:rust', 'language:rust:basics', 'language:rust:ownership'],
  'python': ['language:python', 'language:python:basics', 'language:python:stdlib'],
  'javascript': ['language:javascript', 'language:javascript:basics', 'language:javascript:es6'],
  'typescript': ['language:typescript', 'language:typescript:basics', 'language:typescript:types'],
  'go': ['language:go', 'language:go:basics', 'language:go:concurrency'],
  'java': ['language:java', 'language:java:basics', 'language:java:oop'],
  'c++': ['language:cpp', 'language:cpp:basics', 'language:cpp:memory'],
  'c#': ['language:csharp', 'language:csharp:basics', 'language:csharp:dotnet'],

  // Web development
  'react': ['framework:react', 'framework:react:basics', 'framework:react:hooks'],
  'vue': ['framework:vue', 'framework:vue:basics', 'framework:vue:composition'],
  'angular': ['framework:angular', 'framework:angular:basics', 'framework:angular:components'],
  'node': ['runtime:node', 'runtime:node:basics', 'runtime:node:express'],
  'express': ['framework:express', 'framework:express:routing', 'framework:express:middleware'],
  'web': ['topic:web-development', 'topic:html', 'topic:css', 'topic:javascript'],
  'frontend': ['topic:frontend', 'topic:html', 'topic:css', 'topic:javascript'],
  'backend': ['topic:backend', 'topic:api', 'topic:databases', 'topic:servers'],
  'full-stack': ['topic:fullstack', 'topic:frontend', 'topic:backend', 'topic:databases'],
  'fullstack': ['topic:fullstack', 'topic:frontend', 'topic:backend', 'topic:databases'],

  // Data & AI
  'machine learning': ['topic:machine-learning', 'topic:ml:supervised', 'topic:ml:unsupervised'],
  'ml': ['topic:machine-learning', 'topic:ml:basics'],
  'ai': ['topic:artificial-intelligence', 'topic:ml:basics'],
  'data science': ['topic:data-science', 'topic:python', 'topic:statistics'],
  'deep learning': ['topic:deep-learning', 'topic:neural-networks', 'topic:tensorflow'],

  // Databases
  'sql': ['topic:sql', 'topic:databases', 'topic:sql:queries'],
  'postgresql': ['topic:postgresql', 'topic:sql', 'topic:databases'],
  'mysql': ['topic:mysql', 'topic:sql', 'topic:databases'],
  'mongodb': ['topic:mongodb', 'topic:nosql', 'topic:databases'],

  // DevOps & Tools
  'git': ['tool:git', 'tool:git:basics', 'tool:git:branching'],
  'docker': ['tool:docker', 'tool:docker:basics', 'tool:containers'],
  'kubernetes': ['tool:kubernetes', 'tool:k8s:basics', 'tool:containers'],
  'aws': ['cloud:aws', 'cloud:aws:basics', 'cloud:compute'],
  'linux': ['topic:linux', 'topic:linux:basics', 'topic:command-line'],

  // Mobile
  'ios': ['mobile:ios', 'mobile:swift', 'mobile:xcode'],
  'android': ['mobile:android', 'mobile:kotlin', 'mobile:studio'],
  'react native': ['mobile:react-native', 'mobile:cross-platform', 'framework:react'],
  'flutter': ['mobile:flutter', 'mobile:dart', 'mobile:cross-platform'],

  // Generic
  'coding': ['topic:programming', 'topic:basics', 'topic:fundamentals'],
  'programming': ['topic:programming', 'topic:basics', 'topic:fundamentals'],
  'code': ['topic:programming', 'topic:basics', 'topic:fundamentals'],
  
  // Cybersecurity
  'cybersecurity': ['topic:cybersecurity', 'topic:network-security', 'topic:security-fundamentals'],
  'cyber security': ['topic:cybersecurity', 'topic:network-security', 'topic:security-fundamentals'],
  'security': ['topic:cybersecurity', 'topic:security', 'topic:infosec'],
  'infosec': ['topic:infosec', 'topic:cybersecurity', 'topic:security'],
  'network security': ['topic:network-security', 'topic:firewalls', 'topic:ids-ips'],
  'firewall': ['topic:firewalls', 'topic:network-security', 'topic:packet-filtering'],
  'firewalls': ['topic:firewalls', 'topic:network-security', 'topic:packet-filtering'],
  'intrusion detection': ['topic:ids', 'topic:ips', 'topic:network-monitoring'],
  'ids': ['topic:ids', 'topic:intrusion-detection', 'topic:network-security'],
  'ips': ['topic:ips', 'topic:intrusion-prevention', 'topic:network-security'],
  'ethical hacking': ['topic:ethical-hacking', 'topic:penetration-testing', 'topic:security'],
  'penetration testing': ['topic:penetration-testing', 'topic:security-testing', 'topic:vulnerability-assessment'],
  'pentest': ['topic:penetration-testing', 'topic:security-testing', 'topic:ethical-hacking'],
  'incident response': ['topic:incident-response', 'topic:forensics', 'topic:security-operations'],
  'soc': ['topic:security-operations', 'topic:monitoring', 'topic:incident-response'],
};

/**
 * Extract topic IDs from a goal statement.
 */
function extractTopicIds(goalStatement: string, extractedTopic?: string): string[] {
  const text = (extractedTopic ?? goalStatement).toLowerCase();
  const topics: string[] = [];

  // Check against known mappings
  for (const [keyword, topicIds] of Object.entries(TOPIC_MAPPINGS)) {
    if (text.includes(keyword)) {
      topics.push(...topicIds);
    }
  }

  // If no mappings found, create a generic topic
  if (topics.length === 0) {
    const cleanTopic = text
      .replace(/^(learn|study|master|understand)\s+/i, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    topics.push(`topic:${cleanTopic}`);
  }

  // Deduplicate
  return [...new Set(topics)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// LESSON PLAN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates lesson plan proposals from refinement inputs.
 * 
 * Uses dynamic capability-based progression generation for ANY topic.
 */
export class LessonPlanGenerator {
  private readonly config: SwordGateConfig;
  private readonly resourceService?: IResourceDiscoveryService;
  private readonly curriculumService?: ICurriculumService;
  private readonly capabilityGenerator: CapabilityGenerator;

  constructor(
    config: SwordGateConfig,
    resourceService?: IResourceDiscoveryService,
    curriculumService?: ICurriculumService,
    capabilityGenerator?: CapabilityGenerator
  ) {
    this.config = config;
    this.resourceService = resourceService;
    this.curriculumService = curriculumService;
    this.capabilityGenerator = capabilityGenerator ?? createCapabilityGenerator();
  }

  /**
   * Generate a lesson plan proposal from refined inputs.
   */
  async generate(inputs: SwordRefinementInputs): AsyncAppResult<LessonPlanProposal> {
    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Validate required inputs
    // ─────────────────────────────────────────────────────────────────────────
    if (!inputs.goalStatement) {
      return err(appError('VALIDATION_ERROR', 'Goal statement is required'));
    }

    if (!inputs.userLevel) {
      return err(appError('VALIDATION_ERROR', 'User level is required'));
    }

    if (typeof inputs.dailyTimeCommitment !== 'number') {
      return err(appError('VALIDATION_ERROR', 'Daily time commitment is required'));
    }

    if (!inputs.totalDuration || typeof inputs.totalDays !== 'number') {
      return err(appError('VALIDATION_ERROR', 'Total duration is required'));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Generate capability-based progression (DYNAMIC)
    // ─────────────────────────────────────────────────────────────────────────
    const topic = inputs.extractedTopic ?? inputs.goalStatement;
    console.log(`[LESSON_PLAN] Generating capability progression for: "${topic.substring(0, 50)}..."`);
    
    const capabilityResult = await this.capabilityGenerator.generate(
      topic,
      inputs.userLevel,
      inputs.totalDays
    );
    
    if (!capabilityResult.ok) {
      console.warn('[LESSON_PLAN] Capability generation failed:', capabilityResult.error);
      // Continue with fallback - the generator already provides fallback stages
    }
    
    const stages = capabilityResult.ok ? capabilityResult.value : [];
    console.log(`[LESSON_PLAN] Generated ${stages.length} capability stages`);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Extract topics for resource discovery
    // ─────────────────────────────────────────────────────────────────────────
    const topicIds = stages.length > 0 
      ? extractTopicsFromStages(stages)
      : extractTopicIds(inputs.goalStatement, inputs.extractedTopic);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Discover resources (if service available)
    // ─────────────────────────────────────────────────────────────────────────
    let resources: readonly VerifiedResource[] = [];
    let topicsCovered: readonly string[] = topicIds;
    let gaps: readonly string[] = [];

    if (this.resourceService) {
      // Extract main goal for keyword search (more effective than granular topics)
      const mainGoal = inputs.extractedTopic ?? inputs.goalStatement ?? '';
      const keywords = this.extractKeywords(mainGoal);
      
      console.log(`[LESSON_PLAN] Resource discovery with keywords: ${keywords.join(', ')}`);
      
      const discoveryResult = await this.resourceService.discover({
        topics: topicIds,
        keywords,
        maxResults: 50,
        difficulty: inputs.userLevel,
      });

      if (discoveryResult.ok) {
        resources = discoveryResult.value.resources;
        topicsCovered = discoveryResult.value.topicsCovered;
        gaps = discoveryResult.value.gaps;
      } else {
        console.warn('[LESSON_PLAN] Resource discovery failed:', discoveryResult.error);
        // Continue with fallback
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Generate curriculum structure (if service available)
    // ─────────────────────────────────────────────────────────────────────────
    let curriculum: GeneratedCurriculum | null = null;

    if (this.curriculumService && resources.length > 0) {
      const curriculumResult = await this.curriculumService.generate({
        goal: inputs.goalStatement,
        resources,
        days: inputs.totalDays,
        minutesPerDay: inputs.dailyTimeCommitment,
        targetDifficulty: inputs.userLevel,
        topics: topicIds,
        preferences: {
          includeExercises: true,
          progression: 'gradual',
        },
      });

      if (curriculumResult.ok) {
        curriculum = curriculumResult.value;
      } else {
        console.warn('[LESSON_PLAN] Curriculum generation failed:', curriculumResult.error);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 6: Build proposal (with or without full curriculum)
    // ─────────────────────────────────────────────────────────────────────────
    if (curriculum) {
      return ok(this.buildProposalFromCurriculum(inputs, curriculum, resources, gaps));
    } else {
      // Use dynamically generated capability stages
      return ok(this.buildCapabilityProposal(inputs, stages, resources.length, gaps));
    }
  }

  /**
   * Build a full proposal from generated curriculum.
   */
  private buildProposalFromCurriculum(
    inputs: SwordRefinementInputs,
    curriculum: GeneratedCurriculum,
    resources: readonly VerifiedResource[],
    gaps: readonly string[]
  ): LessonPlanProposal {
    // Group days into quests (weeks)
    const quests = this.groupDaysIntoQuests(curriculum.days, inputs.totalDays!);

    return {
      title: this.generateTitle(inputs),
      description: this.generateDescription(inputs),
      learningConfig: this.buildLearningConfig(inputs),
      quests,
      totalDuration: inputs.totalDuration!,
      totalDays: inputs.totalDays!,
      topicsCovered: curriculum.topicsCovered,
      gaps: gaps.length > 0 ? gaps : undefined,
      resourcesFound: resources.length,
      confidence: this.calculateConfidence(resources.length, gaps.length, curriculum.days.length),
      generatedAt: createTimestamp(),
    };
  }

  /**
   * Build a proposal from dynamically generated capability stages.
   * This is the primary path - works for ANY topic.
   */
  private buildCapabilityProposal(
    inputs: SwordRefinementInputs,
    stages: readonly CapabilityStage[],
    resourceCount: number,
    gaps: readonly string[]
  ): LessonPlanProposal {
    const totalDays = inputs.totalDays!;
    const topic = inputs.extractedTopic ?? inputs.goalStatement ?? '';

    console.log(`[LESSON_PLAN] Building capability proposal for: "${topic.substring(0, 50)}..." with ${stages.length} stages`);

    // If no stages (shouldn't happen - generator has fallback), use legacy fallback
    if (stages.length === 0) {
      console.warn('[LESSON_PLAN] No stages provided, using legacy fallback');
      const topicIds = extractTopicIds(inputs.goalStatement, inputs.extractedTopic);
      return this.buildFallbackProposal(inputs, topicIds, resourceCount, gaps);
    }

    // Distribute days across stages
    const baseDaysPerStage = Math.floor(totalDays / stages.length);
    const extraDays = totalDays % stages.length;

    // Build quests from capability stages
    const quests: ProposedQuest[] = stages.map((stage, index) => {
      // Distribute extra days to earlier stages
      const daysForStage = baseDaysPerStage + (index < extraDays ? 1 : 0);
      
      return {
        title: `Stage ${index + 1}: ${stage.title}`,
        description: this.formatCapabilityDescription(stage),
        topics: stage.topics,
        estimatedDays: daysForStage,
        order: index + 1,
      };
    });

    // Extract all topics for topicsCovered
    const allTopics = stages.flatMap(s => s.topics);
    const uniqueTopics = [...new Set(allTopics)];

    return {
      title: this.generateTitle(inputs),
      description: this.generateDescription(inputs),
      learningConfig: this.buildLearningConfig(inputs),
      quests,
      totalDuration: inputs.totalDuration!,
      totalDays,
      topicsCovered: uniqueTopics,
      gaps: gaps.length > 0 ? gaps : undefined,
      resourcesFound: resourceCount,
      confidence: this.calculateConfidence(resourceCount, gaps.length, stages.length * 5),
      generatedAt: createTimestamp(),
    };
  }

  /**
   * Build a fallback proposal when curriculum generation isn't available.
   * Uses topic-specific progressions for meaningful quest titles.
   * @deprecated Use buildCapabilityProposal with CapabilityGenerator instead
   */
  private buildFallbackProposal(
    inputs: SwordRefinementInputs,
    topicIds: readonly string[],
    resourceCount: number,
    gaps: readonly string[]
  ): LessonPlanProposal {
    const totalDays = inputs.totalDays!;
    const weeksCount = Math.ceil(totalDays / 7);
    const topic = inputs.extractedTopic ?? inputs.goalStatement ?? '';

    console.log(`[LESSON_PLAN] Building proposal for topic: "${topic.substring(0, 50)}..."`);

    // ★ FIRST: Try capability-based progressions (preferred)
    const capabilityProgression = getCapabilityProgression(topic);
    
    if (capabilityProgression) {
      console.log(`[LESSON_PLAN] Found capability progression with ${capabilityProgression.length} stages`);
    } else {
      console.log(`[LESSON_PLAN] No capability progression found, trying legacy...`);
    }
    
    // ★ FALLBACK: Try legacy topic progressions
    const legacyProgression = capabilityProgression ? null : getTopicProgression(topic);

    // Generate quest structure
    const quests: ProposedQuest[] = [];
    let daysCovered = 0;

    for (let week = 1; week <= weeksCount; week++) {
      const daysInWeek = Math.min(7, totalDays - daysCovered);
      if (daysInWeek <= 0) break;

      const progressionIndex = week - 1;

      // ★ CAPABILITY-BASED: Full competence model
      if (capabilityProgression) {
        const stage = capabilityProgression[progressionIndex];
        
        if (stage) {
          // Format description with full capability model
          const description = this.formatCapabilityDescription(stage);
          
          quests.push({
            title: `Stage ${week}: ${stage.title}`,
            description,
            topics: stage.topics,
            estimatedDays: daysInWeek,
            order: week,
          });
        } else if (progressionIndex >= capabilityProgression.length) {
          // Extended timeline beyond progression
          const isLastWeek = week === weeksCount;
          const lastStage = capabilityProgression[capabilityProgression.length - 1];
          
          if (isLastWeek) {
            quests.push({
              title: `Stage ${week}: Ship & Defend`,
              description: `**Capability:** Deploy your work and defend your decisions to others.\n**Artifact:** Production deployment with documentation and handoff.\n**Challenge:** Present your work and handle critical feedback.\n**Transfer:** Mentor someone else through their first deployment.`,
              topics: ['deployment', 'documentation', 'review'],
              estimatedDays: daysInWeek,
              order: week,
            });
          } else {
            quests.push({
              title: `Stage ${week}: Expand & Integrate`,
              description: `**Capability:** Apply your skills to a new problem domain.\n**Artifact:** Working solution in an unfamiliar context.\n**Challenge:** Constraints you haven't encountered before.\n**Transfer:** Combine multiple techniques from earlier stages.`,
              topics: lastStage?.topics ?? topicIds.slice(0, 3) as string[],
              estimatedDays: daysInWeek,
              order: week,
            });
          }
        }
      }
      // ★ LEGACY: Topic-based progressions
      else if (legacyProgression) {
        const progressionItem = legacyProgression[progressionIndex];
        
        if (progressionItem) {
          quests.push({
            title: `Week ${week}: ${progressionItem.title}`,
            description: progressionItem.description,
            topics: progressionItem.topics,
            estimatedDays: daysInWeek,
            order: week,
          });
        } else if (progressionIndex >= legacyProgression.length) {
          const isLastWeek = week === weeksCount;
          const lastProgression = legacyProgression[legacyProgression.length - 1];
          
          if (isLastWeek) {
            quests.push({
              title: `Week ${week}: Review & Practice`,
              description: 'Consolidate your learning, revisit challenging topics, and practice with projects.',
              topics: ['review', 'practice', 'projects'],
              estimatedDays: daysInWeek,
              order: week,
            });
          } else {
            quests.push({
              title: `Week ${week}: Advanced ${this.capitalize(topic)}`,
              description: `Build on your knowledge with more advanced ${topic} concepts and real-world applications.`,
              topics: lastProgression?.topics ?? topicIds.slice(0, 3) as string[],
              estimatedDays: daysInWeek,
              order: week,
            });
          }
        }
      }
      // ★ GENERIC FALLBACK: Use improved generic titles
      else {
        quests.push({
          title: this.generateQuestTitle(week, weeksCount, topic),
          description: this.generateQuestDescription(week, weeksCount, inputs.userLevel!, topic),
          topics: topicIds.slice(0, 3) as string[],
          estimatedDays: daysInWeek,
          order: week,
        });
      }

      daysCovered += daysInWeek;
    }

    return {
      title: this.generateTitle(inputs),
      description: this.generateDescription(inputs),
      learningConfig: this.buildLearningConfig(inputs),
      quests,
      totalDuration: inputs.totalDuration!,
      totalDays,
      topicsCovered: topicIds,
      gaps: gaps.length > 0 ? gaps : undefined,
      resourcesFound: resourceCount,
      confidence: resourceCount > 0 ? 'medium' : 'low',
      generatedAt: createTimestamp(),
    };
  }

  /**
   * Format a capability stage into a rich description.
   * 
   * Includes:
   * - Capability: What learner CAN DO after (verb-based)
   * - Artifact: What they must PRODUCE (inspectable, falsifiable)
   * - Challenge: Designed failure to expose and recover from
   * - Transfer: How to apply in new context without scaffolding
   * - Consideration: What you're gaining vs trading off (only prominent if warning)
   */
  private formatCapabilityDescription(stage: CapabilityStage): string {
    const lines = [
      `**Capability:** ${stage.capability}`,
      `**Artifact:** ${stage.artifact}`,
      `**Challenge:** ${stage.designedFailure}`,
      `**Transfer:** ${stage.transfer}`,
    ];

    // Add consideration - the tradeoff awareness layer
    // Only show prominently if there's a warning, otherwise subtle
    if (stage.consideration) {
      const c = stage.consideration;
      
      if (c.severity === 'warning') {
        // Warning: prominent, requires acknowledgment
        lines.push('');
        lines.push(`**⚠️ Warning:** ${c.tradingOff}`);
        if (c.checkpoint) {
          lines.push(`_${c.checkpoint}_`);
        }
      } else if (c.severity === 'caution') {
        // Caution: visible but not alarming
        lines.push('');
        lines.push(`_Note: You're gaining ${c.gaining.toLowerCase()}, but trading off ${c.tradingOff.toLowerCase()}._`);
      }
      // 'info' severity: don't show, it's obvious
    }

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Extract main keywords from a goal statement for resource discovery.
   * 
   * Examples:
   * - "I want to learn coding" → ["coding"]
   * - "learn python for data science" → ["python", "data science"]
   * - "technical aspects like firewalls" → ["firewalls", "security"]
   */
  private extractKeywords(goal: string): string[] {
    const keywords: string[] = [];
    const normalized = goal.toLowerCase().trim();
    
    // Remove common filler words
    const cleaned = normalized
      .replace(/^(i want to|i'd like to|help me|teach me|learn|study|understand)\s*/gi, '')
      .replace(/^(how to|about)\s*/gi, '')
      .replace(/^(more about|the basics of|basics of)\s*/gi, '')
      .trim();
    
    // Check for known programming languages/technologies
    const knownTerms = [
      'python', 'javascript', 'typescript', 'rust', 'go', 'java', 'c++', 'c#',
      'react', 'vue', 'angular', 'node', 'nodejs', 'express',
      'sql', 'database', 'mongodb', 'postgresql', 'mysql',
      'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'devops',
      'machine learning', 'ml', 'ai', 'artificial intelligence', 'data science',
      'web development', 'frontend', 'backend', 'full stack', 'fullstack',
      'cybersecurity', 'security', 'hacking', 'penetration testing',
      'coding', 'programming', 'software development',
      'firewalls', 'networking', 'linux', 'git', 'api',
    ];
    
    // First, extract any known terms
    for (const term of knownTerms) {
      if (cleaned.includes(term)) {
        keywords.push(term);
        if (keywords.length >= 3) break;
      }
    }
    
    // If no known terms, use the first few meaningful words
    if (keywords.length === 0) {
      const words = cleaned.split(/\s+/).filter(w => w.length > 2);
      keywords.push(...words.slice(0, 3));
    }
    
    // Ensure we have at least something
    if (keywords.length === 0) {
      keywords.push('programming');
    }
    
    return [...new Set(keywords)]; // Deduplicate
  }

  /**
   * Group curriculum days into weekly quests.
   */
  private groupDaysIntoQuests(
    days: readonly CurriculumDay[],
    totalDays: number
  ): ProposedQuest[] {
    const quests: ProposedQuest[] = [];
    const daysPerQuest = 7;
    let currentQuestDays: CurriculumDay[] = [];
    let questOrder = 1;

    for (const day of days) {
      currentQuestDays.push(day);

      if (currentQuestDays.length >= daysPerQuest || day.day === days.length) {
        quests.push(this.buildQuestFromDays(currentQuestDays, questOrder));
        currentQuestDays = [];
        questOrder++;
      }
    }

    // Handle remaining days
    if (currentQuestDays.length > 0) {
      quests.push(this.buildQuestFromDays(currentQuestDays, questOrder));
    }

    return quests;
  }

  /**
   * Build a quest from a group of days.
   */
  private buildQuestFromDays(days: CurriculumDay[], order: number): ProposedQuest {
    const themes = days.map((d) => d.theme);
    const allTopics = days.flatMap((d) =>
      d.resources.map((r) => r.title.split(':')[0])
    ).filter((t): t is string => t !== undefined);
    const uniqueTopics = [...new Set(allTopics)].slice(0, 5);

    return {
      title: `Week ${order}: ${this.summarizeThemes(themes)}`,
      description: days[0]?.objectives[0] ?? `Days ${days[0]?.day}-${days[days.length - 1]?.day}`,
      topics: uniqueTopics,
      estimatedDays: days.length,
      order,
    };
  }

  /**
   * Summarize multiple day themes into a quest title.
   */
  private summarizeThemes(themes: readonly string[]): string {
    if (themes.length === 0) return 'Learning';
    if (themes.length === 1) return themes[0] ?? 'Learning';

    // Find common words
    const words = themes.flatMap((t) => t.toLowerCase().split(/\s+/));
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      if (word.length > 3) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }

    // Get most common meaningful words
    const sorted = [...wordCounts.entries()]
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0) {
      return sorted
        .slice(0, 2)
        .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' & ');
    }

    return (themes[0] ?? 'Learning').split(' ').slice(0, 3).join(' ');
  }

  /**
   * Generate a goal title from inputs.
   */
  private generateTitle(inputs: SwordRefinementInputs): string {
    const topic = inputs.extractedTopic ?? 'your topic';
    const level = inputs.userLevel ?? 'beginner';

    const levelPrefix = {
      beginner: 'Learn',
      intermediate: 'Master',
      advanced: 'Expert',
    }[level] ?? 'Learn';

    return `${levelPrefix} ${this.capitalize(topic)}`;
  }

  /**
   * Generate a goal description from inputs.
   */
  private generateDescription(inputs: SwordRefinementInputs): string {
    const topic = inputs.extractedTopic ?? 'this topic';
    const duration = inputs.totalDuration ?? 'the planned period';
    const daily = inputs.dailyTimeCommitment ?? 30;

    return `A structured learning path to ${inputs.userLevel === 'advanced' ? 'master' : 'learn'} ${topic} over ${duration}, with ${daily} minutes of daily practice.`;
  }

  /**
   * Generate a quest title for fallback proposals (when no topic progression exists).
   */
  private generateQuestTitle(week: number, totalWeeks: number, topic?: string): string {
    const topicName = topic ? this.capitalize(topic) : 'Your Topic';
    
    if (week === 1) {
      return `Week 1: Introduction to ${topicName}`;
    }
    if (week === 2 && totalWeeks > 2) {
      return `Week 2: ${topicName} Core Concepts`;
    }
    if (week === 3 && totalWeeks > 3) {
      return `Week 3: Intermediate ${topicName}`;
    }
    if (week === totalWeeks) {
      return `Week ${week}: ${topicName} Projects & Review`;
    }
    if (week === totalWeeks - 1 && totalWeeks > 4) {
      return `Week ${week}: Advanced ${topicName}`;
    }
    // For middle weeks
    return `Week ${week}: ${topicName} Practice & Application`;
  }

  /**
   * Generate a quest description for fallback proposals.
   */
  private generateQuestDescription(
    week: number,
    totalWeeks: number,
    level: UserLevel,
    topic?: string
  ): string {
    const topicName = topic ?? 'the subject';
    
    if (week === 1) {
      return level === 'beginner'
        ? `Start your ${topicName} journey with foundational concepts and basic setup.`
        : `Review ${topicName} fundamentals and establish your baseline knowledge.`;
    }
    if (week === 2 && totalWeeks > 2) {
      return `Dive deeper into core ${topicName} concepts and essential techniques.`;
    }
    if (week === totalWeeks) {
      return `Apply everything you've learned with hands-on projects and comprehensive review.`;
    }
    if (week === totalWeeks - 1 && totalWeeks > 3) {
      return `Tackle advanced ${topicName} topics and real-world applications.`;
    }
    return `Continue building your ${topicName} skills with practical exercises.`;
  }

  /**
   * Build LearningConfig from inputs.
   */
  private buildLearningConfig(inputs: SwordRefinementInputs): LearningConfig {
    return {
      userLevel: inputs.userLevel,
      dailyTimeCommitment: inputs.dailyTimeCommitment,
      learningStyle: inputs.learningStyle ?? 'mixed',
      totalDuration: inputs.totalDuration,
      startDate: inputs.startDate ?? this.getDefaultStartDate(),
      activeDays: inputs.activeDays ?? this.getDefaultActiveDays(),
    };
  }

  /**
   * Get default start date (tomorrow).
   */
  private getDefaultStartDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0] ?? '';
  }

  /**
   * Get default active days (weekdays).
   */
  private getDefaultActiveDays(): readonly DayOfWeek[] {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }

  /**
   * Calculate confidence level based on available data.
   */
  private calculateConfidence(
    resourceCount: number,
    gapCount: number,
    dayCount: number
  ): 'high' | 'medium' | 'low' {
    if (resourceCount >= 20 && gapCount === 0 && dayCount > 0) {
      return 'high';
    }
    if (resourceCount >= 5 && gapCount <= 2) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Capitalize first letter of each word.
   */
  private capitalize(text: string): string {
    return text
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a LessonPlanGenerator instance.
 */
export function createLessonPlanGenerator(
  config: SwordGateConfig,
  resourceService?: IResourceDiscoveryService,
  curriculumService?: ICurriculumService
): LessonPlanGenerator {
  return new LessonPlanGenerator(config, resourceService, curriculumService);
}
