// ═══════════════════════════════════════════════════════════════════════════════
// EVIDENCE PROCESSOR — Evidence Processing and Validation
// Deduplication, reliability scoring, conflict detection
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  EvidencePack,
  EvidenceItem,
  ReliabilityTier,
  VerifiedClaim,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────────
// RELIABILITY WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────────

const RELIABILITY_WEIGHTS: Record<ReliabilityTier, number> = {
  official: 1.0,
  wire: 0.9,
  authoritative: 0.8,
  reference: 0.7,
  community: 0.4,
};

// ─────────────────────────────────────────────────────────────────────────────────
// PROCESS EVIDENCE FOR HIGH TIER
// ─────────────────────────────────────────────────────────────────────────────────

export interface ProcessedEvidence {
  pack: EvidencePack;
  hasOfficialSource: boolean;
  hasMultipleSources: boolean;
  averageReliability: number;
  freshestDate?: string;
  conflicts: ConflictDetection[];
}

export interface ConflictDetection {
  topic: string;
  claims: string[];
  sources: string[];
  severity: 'low' | 'medium' | 'high';
}

export function processEvidence(pack: EvidencePack): ProcessedEvidence {
  const items = pack.items;

  // Check for official source
  const hasOfficialSource = items.some(item => item.isOfficial);

  // Check for multiple sources
  const uniqueDomains = new Set(items.map(item => extractDomain(item.url)));
  const hasMultipleSources = uniqueDomains.size >= 2;

  // Calculate average reliability
  const totalWeight = items.reduce((sum, item) => {
    return sum + RELIABILITY_WEIGHTS[item.reliability];
  }, 0);
  const averageReliability = items.length > 0 ? totalWeight / items.length : 0;

  // Find freshest date
  const dates = items
    .map(item => item.publishedAt)
    .filter((d): d is string => d !== undefined)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const freshestDate = dates[0];

  // Detect conflicts (basic implementation)
  const conflicts = detectConflicts(items);

  return {
    pack,
    hasOfficialSource,
    hasMultipleSources,
    averageReliability,
    freshestDate,
    conflicts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONFLICT DETECTION
// ─────────────────────────────────────────────────────────────────────────────────

function detectConflicts(items: EvidenceItem[]): ConflictDetection[] {
  const conflicts: ConflictDetection[] = [];

  // Group excerpts by potential topics
  // This is a simplified version - a more sophisticated approach would use NLP
  const numberPatterns = items.map(item => ({
    item,
    numbers: extractNumbers(item.excerpt),
  }));

  // Check for conflicting numbers
  const numberGroups = new Map<string, Array<{ value: string; source: string }>>();

  for (const { item, numbers } of numberPatterns) {
    for (const num of numbers) {
      // Group by surrounding context (simplified)
      const context = num.context.toLowerCase().slice(0, 50);
      if (!numberGroups.has(context)) {
        numberGroups.set(context, []);
      }
      numberGroups.get(context)!.push({
        value: num.value,
        source: item.url,
      });
    }
  }

  // Flag conflicts where same context has different values
  for (const [context, entries] of numberGroups) {
    const uniqueValues = new Set(entries.map(e => e.value));
    if (uniqueValues.size > 1) {
      conflicts.push({
        topic: context,
        claims: Array.from(uniqueValues),
        sources: entries.map(e => e.source),
        severity: uniqueValues.size > 2 ? 'high' : 'medium',
      });
    }
  }

  return conflicts;
}

function extractNumbers(text: string): Array<{ value: string; context: string }> {
  const results: Array<{ value: string; context: string }> = [];

  // Match various number formats
  const patterns = [
    /\$[\d,]+(?:\.\d{2})?/g,           // Currency
    /\d+(?:\.\d+)?%/g,                  // Percentages
    /\d{1,3}(?:,\d{3})+(?:\.\d+)?/g,   // Large numbers with commas
    /\d+(?:\.\d+)?\s*(million|billion|trillion)/gi, // Numbers with scale words
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      results.push({
        value: match[0],
        context: text.slice(start, end),
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────────
// VERIFY CLAIMS AGAINST EVIDENCE
// ─────────────────────────────────────────────────────────────────────────────────

export interface ClaimVerificationOptions {
  minSources: number;
  officialSourceException: boolean;
}

export function verifyClaimsAgainstEvidence(
  claims: string[],
  evidence: ProcessedEvidence,
  options: ClaimVerificationOptions = { minSources: 2, officialSourceException: true }
): {
  verified: VerifiedClaim[];
  unverified: string[];
  requirementsMet: boolean;
} {
  const verified: VerifiedClaim[] = [];
  const unverified: string[] = [];

  for (const claim of claims) {
    const claimLower = claim.toLowerCase();
    const supportingItems: EvidenceItem[] = [];

    // Find supporting evidence
    for (const item of evidence.pack.items) {
      if (excerptSupportsClaim(item.excerpt, claimLower)) {
        supportingItems.push(item);
      }
    }

    const hasOfficialSource = supportingItems.some(item => item.isOfficial);
    const sourceCount = supportingItems.length;

    // Check if claim is verified
    const meetsSourceRequirement =
      sourceCount >= options.minSources ||
      (options.officialSourceException && hasOfficialSource && sourceCount >= 1);

    // Check for conflicts
    const hasConflict = evidence.conflicts.some(c =>
      c.topic.includes(claimLower.slice(0, 20)) ||
      claimLower.includes(c.topic.slice(0, 20))
    );

    if (meetsSourceRequirement && !hasConflict) {
      verified.push({
        claim,
        supported: true,
        sources: supportingItems.map(item => item.url),
        sourceCount,
        hasOfficialSource,
        conflicting: false,
      });
    } else if (hasConflict) {
      verified.push({
        claim,
        supported: false,
        sources: supportingItems.map(item => item.url),
        sourceCount,
        hasOfficialSource,
        conflicting: true,
      });
    } else {
      unverified.push(claim);
    }
  }

  const requirementsMet = unverified.length === 0 && verified.every(v => v.supported);

  return { verified, unverified, requirementsMet };
}

function excerptSupportsClaim(excerpt: string, claim: string): boolean {
  const excerptLower = excerpt.toLowerCase();

  // Extract key terms from claim
  const claimTerms = claim
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['that', 'this', 'with', 'from', 'have', 'been'].includes(w));

  // Check if majority of terms appear in excerpt
  const matchingTerms = claimTerms.filter(term => excerptLower.includes(term));
  const matchRatio = claimTerms.length > 0 ? matchingTerms.length / claimTerms.length : 0;

  return matchRatio >= 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER: EXTRACT DOMAIN
// ─────────────────────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// SORT EVIDENCE BY RELIABILITY
// ─────────────────────────────────────────────────────────────────────────────────

export function sortByReliability(items: EvidenceItem[]): EvidenceItem[] {
  return [...items].sort((a, b) => {
    const weightA = RELIABILITY_WEIGHTS[a.reliability];
    const weightB = RELIABILITY_WEIGHTS[b.reliability];
    return weightB - weightA;
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// CHECK IF EVIDENCE SUFFICIENT FOR HIGH TIER
// ─────────────────────────────────────────────────────────────────────────────────

export function isEvidenceSufficient(
  evidence: ProcessedEvidence,
  requireOfficial: boolean = true,
  requireMultiple: boolean = true
): { sufficient: boolean; reason?: string } {
  if (evidence.pack.items.length === 0) {
    return { sufficient: false, reason: 'No evidence found' };
  }

  if (requireOfficial && !evidence.hasOfficialSource) {
    return { sufficient: false, reason: 'No official source found' };
  }

  if (requireMultiple && !evidence.hasMultipleSources) {
    return { sufficient: false, reason: 'Insufficient source diversity' };
  }

  if (evidence.conflicts.some(c => c.severity === 'high')) {
    return { sufficient: false, reason: 'High-severity conflicts detected' };
  }

  if (evidence.averageReliability < 0.5) {
    return { sufficient: false, reason: 'Low average source reliability' };
  }

  return { sufficient: true };
}
