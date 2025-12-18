// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP — Mock LLM Classification for Deterministic Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { vi } from 'vitest';

// Mock classification responses based on message patterns
function getMockClassification(message: string) {
  const text = message.toLowerCase();

  // CRITICAL + death_risk → CONTROL MODE
  if (
    text.includes('kill myself') ||
    text.includes('end my life') ||
    text.includes('want to die') ||
    text.includes('suicide') ||
    text.includes('hurt myself') ||
    text.includes('self-harm') ||
    text.includes('self harm')
  ) {
    return {
      riskLevel: 'critical',
      category: 'death_risk',
      confidence: 0.98,
      reasoning: 'Crisis/self-harm detected',
    };
  }

  // HIGH + harm_risk → HARD VETO
  if (
    text.includes('make a bomb') ||
    text.includes('build explosive') ||
    text.includes('create weapon') ||
    text.includes('hack into') ||
    text.includes('steal password') ||
    text.includes('groom a child') ||
    text.includes('child porn') ||
    text.includes('hurt my coworker') ||
    text.includes('hurt him') ||
    text.includes('beat up')
  ) {
    return {
      riskLevel: 'high',
      category: 'harm_risk',
      confidence: 0.95,
      reasoning: 'Harmful content detected',
    };
  }

  // MEDIUM + reckless_decision → SOFT VETO
  if (
    text.includes('all my savings') ||
    text.includes('life savings') ||
    text.includes('everything i have') ||
    text.includes('entire life savings') ||
    text.includes('skip the doctor') ||
    text.includes('self-diagnos') ||
    text.includes("don't need professional")
  ) {
    return {
      riskLevel: 'medium',
      category: 'reckless_decision',
      confidence: 0.85,
      reasoning: 'High-stakes financial/health decision',
    };
  }

  // Default: SAFE
  return {
    riskLevel: 'none',
    category: 'safe',
    confidence: 0.95,
    reasoning: 'Normal conversation',
  };
}

function getCrisisMessage(): string {
  return `I'm concerned about what you've shared. Please know that help is available:

• **988 Suicide & Crisis Lifeline**: Call or text 988 (US)
• **Crisis Text Line**: Text HOME to 741741
• **SAMHSA National Helpline**: 1-800-662-4357

You don't have to face this alone. Would you like to talk about what's going on?`;
}

function generateSimpleAckToken(): string {
  return `ack_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

// Mock the gates module
vi.mock('../gates/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../gates/index.js')>();
  
  return {
    ...original,
    executeShieldGate: async (state: any, _context: any) => {
      const start = Date.now();
      const text = state.normalizedInput;
      const classification = getMockClassification(text);

      // CRITICAL + death_risk → CONTROL MODE
      if (classification.riskLevel === 'critical' && classification.category === 'death_risk') {
        return {
          gateId: 'shield',
          status: 'hard_fail',
          output: {
            riskLevel: 'critical',
            controlMode: 'crisis_detected',
            message: getCrisisMessage(),
          },
          action: 'stop',
          executionTimeMs: Date.now() - start,
        };
      }

      // HIGH + harm_risk → HARD VETO
      if (classification.riskLevel === 'high' && classification.category === 'harm_risk') {
        return {
          gateId: 'shield',
          status: 'hard_fail',
          output: {
            riskLevel: 'critical',
            vetoType: 'hard',
            triggers: ['harm_risk'],
            message: classification.reasoning,
          },
          action: 'stop',
          executionTimeMs: Date.now() - start,
        };
      }

      // MEDIUM + reckless_decision → SOFT VETO
      if (classification.riskLevel === 'medium' && classification.category === 'reckless_decision') {
        const ackToken = generateSimpleAckToken();
        return {
          gateId: 'shield',
          status: 'soft_fail',
          output: {
            riskLevel: 'elevated',
            vetoType: 'soft',
            triggers: ['reckless_decision'],
            ackToken,
            message: `This appears to be a high-stakes decision. Please acknowledge to proceed.`,
          },
          action: 'await_ack',
          executionTimeMs: Date.now() - start,
        };
      }

      // PASS
      return {
        gateId: 'shield',
        status: 'pass',
        output: { riskLevel: 'safe' },
        action: 'continue',
        executionTimeMs: Date.now() - start,
      };
    },
  };
});

console.log('[TEST SETUP] LLM classification mocked for deterministic tests');
