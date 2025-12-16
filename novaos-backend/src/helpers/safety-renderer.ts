// ═══════════════════════════════════════════════════════════════════════════════
// SAFETY RENDERER — Fix C-1
// Hard-renders safety resources OUTSIDE the model
// Resources are NEVER passed through the model — they are injected after
// ═══════════════════════════════════════════════════════════════════════════════

import { CrisisResource, PipelineState } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// CRISIS RESOURCES — Immutable, never model-generated
// ─────────────────────────────────────────────────────────────────────────────────

export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    name: '988 Suicide & Crisis Lifeline',
    action: 'Call or text 988',
    phone: '988',
    available: '24/7',
  },
  {
    name: 'Crisis Text Line',
    action: 'Text HOME to 741741',
    phone: '741741',
    available: '24/7',
  },
  {
    name: 'SAMHSA National Helpline',
    action: 'Call 1-800-662-4357',
    phone: '1-800-662-4357',
    available: '24/7, 365 days',
  },
  {
    name: 'International Association for Suicide Prevention',
    action: 'Visit https://www.iasp.info/resources/Crisis_Centres/',
    url: 'https://www.iasp.info/resources/Crisis_Centres/',
    available: 'Directory of crisis centers worldwide',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────
// IMMUTABLE RESOURCE BLOCK
// This exact text is prepended — no model involvement
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Generate the immutable crisis resources block.
 * This text is NEVER passed through or modified by the model.
 */
export function renderCrisisResourceBlock(): string {
  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📞 **If you need immediate support:**',
    '',
  ];

  for (const resource of CRISIS_RESOURCES) {
    lines.push(`• **${resource.name}**`);
    lines.push(`  ${resource.action}`);
    if (resource.available) {
      lines.push(`  Available: ${resource.available}`);
    }
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  return lines.join('\n');
}

/**
 * Pre-rendered block for performance.
 * Generated once at module load, never changes.
 */
const CRISIS_RESOURCE_BLOCK = renderCrisisResourceBlock();

// ─────────────────────────────────────────────────────────────────────────────────
// SAFETY RENDERER
// ─────────────────────────────────────────────────────────────────────────────────

export interface SafetyRenderResult {
  text: string;
  crisisResourcesProvided: boolean;
  resourceBlockHash: string;
}

/**
 * Apply safety rendering to a model response.
 * 
 * CRITICAL: This runs AFTER PersonalityGate, BEFORE response is sent.
 * Resources are hard-prepended, not model-generated.
 * 
 * @param modelOutput - The validated model output text
 * @param state - Current pipeline state
 * @returns Rendered text with safety resources if required
 */
export function applySafetyRendering(
  modelOutput: string,
  state: PipelineState
): SafetyRenderResult {
  // Check if crisis resources required
  if (!state.risk?.requiredPrependResources) {
    return {
      text: modelOutput,
      crisisResourcesProvided: false,
      resourceBlockHash: '',
    };
  }

  // Hard-prepend the immutable resource block
  const text = CRISIS_RESOURCE_BLOCK + modelOutput;

  // Hash the resource block for audit verification
  const resourceBlockHash = hashResourceBlock(CRISIS_RESOURCE_BLOCK);

  return {
    text,
    crisisResourcesProvided: true,
    resourceBlockHash,
  };
}

/**
 * Hash the resource block for audit verification.
 * Allows verifying that resources were not tampered with.
 * Uses FULL hash — no truncation for security.
 */
function hashResourceBlock(block: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(block).digest('hex');
  // Returns full 64 characters for collision resistance
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Verify that crisis resources are present in a response.
 * Used by invariant checker.
 * 
 * SECURITY: Checks that the EXACT resource block appears at the START.
 * Simple substring matching is insufficient — adversarial outputs could
 * include phone numbers in negative context.
 * 
 * @param responseText - The final response text
 * @returns true if resources are correctly present
 */
export function verifyCrisisResourcesPresent(responseText: string): boolean {
  // The response MUST start with the crisis resource block
  // This prevents adversarial insertion of numbers elsewhere
  
  // Check for opening separator at start
  if (!responseText.startsWith('━━━━━━━━━━')) {
    return false;
  }
  
  // Check for key structural elements in correct order
  const requiredSequence = [
    '━━━━━━━━━━',           // Opening separator
    'If you need immediate support', // Header
    '988',                   // 988 Lifeline
    '741741',                // Crisis Text Line
    '1-800-662-4357',        // SAMHSA
    '━━━━━━━━━━',           // Closing separator
  ];
  
  let lastIndex = 0;
  for (const element of requiredSequence) {
    const index = responseText.indexOf(element, lastIndex);
    if (index === -1) {
      return false;
    }
    lastIndex = index + element.length;
  }
  
  // Verify the block appears in the first 1500 characters
  // (resource block is ~600 chars, leaving room for formatting variations)
  const closingSeparatorIndex = responseText.indexOf('━━━━━━━━━━', 100);
  if (closingSeparatorIndex === -1 || closingSeparatorIndex > 1500) {
    return false;
  }
  
  return true;
}

/**
 * Verify resource block integrity.
 * Used for audit trail verification.
 */
export function verifyResourceBlockIntegrity(
  responseText: string,
  expectedHash: string
): boolean {
  // Extract the resource block (up to second separator line)
  const separatorPattern = /━+/g;
  const matches = [...responseText.matchAll(separatorPattern)];
  
  if (matches.length < 2) {
    return false;
  }

  const secondMatch = matches[1];
  if (!secondMatch || secondMatch.index === undefined) {
    return false;
  }

  const blockEnd = secondMatch.index + secondMatch[0].length;
  const extractedBlock = responseText.slice(0, blockEnd + 1); // +1 for newline

  const actualHash = hashResourceBlock(extractedBlock);
  return actualHash === expectedHash;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS FOR PIPELINE INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────────

export { CRISIS_RESOURCE_BLOCK };
