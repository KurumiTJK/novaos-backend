// ═══════════════════════════════════════════════════════════════════════════════
// LEAK RESPONSE — Safe Fallback Responses When Leak Guard Triggers
// Phase 5: Leak Guard
// 
// When the leak guard catches a violation, the model's response is REPLACED
// with a safe fallback. These responses are TERMINAL - there is no retry.
// 
// CRITICAL DESIGN PRINCIPLES:
// 1. Never include ANY numeric data
// 2. Never suggest the data might be available elsewhere in the conversation
// 3. Direct users to authoritative external sources
// 4. Be honest about the failure without technical details
// 5. No retry language - this is the final response
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../types/categories.js';

// ─────────────────────────────────────────────────────────────────────────────────
// SAFE RESPONSE TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Safe response templates by category.
 * 
 * Each template:
 * - Contains NO numeric data
 * - Directs to authoritative sources
 * - Is honest about the limitation
 * - Has NO retry language
 */
const SAFE_RESPONSE_TEMPLATES: Readonly<Record<LiveCategory, string>> = {
  // ═══════════════════════════════════════════════════════════════════════════════
  // MARKET DATA
  // ═══════════════════════════════════════════════════════════════════════════════
  
  market: `I was unable to retrieve current market data for your query.

For live stock prices and market information, please check:
• **Yahoo Finance**: finance.yahoo.com
• **Google Finance**: google.com/finance
• **Bloomberg**: bloomberg.com/markets

These sources provide real-time quotes and comprehensive market data.`,

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRYPTOCURRENCY
  // ═══════════════════════════════════════════════════════════════════════════════
  
  crypto: `I was unable to retrieve current cryptocurrency data for your query.

For live crypto prices and market information, please check:
• **CoinGecko**: coingecko.com
• **CoinMarketCap**: coinmarketcap.com
• **Your exchange's official app or website**

These sources provide real-time prices across multiple exchanges.`,

  // ═══════════════════════════════════════════════════════════════════════════════
  // FOREIGN EXCHANGE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  fx: `I was unable to retrieve current exchange rate data for your query.

For live currency exchange rates, please check:
• **XE.com**: xe.com/currencyconverter
• **Google**: search "USD to EUR" (or your currency pair)
• **Your bank's official rates**

Exchange rates fluctuate continuously, so real-time sources are recommended.`,

  // ═══════════════════════════════════════════════════════════════════════════════
  // WEATHER
  // ═══════════════════════════════════════════════════════════════════════════════
  
  weather: `I was unable to retrieve current weather data for your query.

For live weather information, please check:
• **Weather.com**: weather.com
• **AccuWeather**: accuweather.com
• **Your device's built-in weather app**
• **National Weather Service**: weather.gov (US)

These sources provide current conditions and forecasts.`,

  // ═══════════════════════════════════════════════════════════════════════════════
  // TIME
  // ═══════════════════════════════════════════════════════════════════════════════
  
  time: `I was unable to retrieve the current time for your query.

For accurate time information:
• **Check your device's clock** (most reliable for your timezone)
• **Time.is**: time.is (world clock with timezone support)
• **WorldTimeBuddy**: worldtimebuddy.com (for comparing timezones)

Your device clock is typically synchronized with official time servers.`,
};

// ─────────────────────────────────────────────────────────────────────────────────
// RESPONSE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get the safe response template for a category.
 * 
 * @param category - The live data category
 * @returns Safe response template
 */
export function getSafeResponse(category: LiveCategory): string {
  return SAFE_RESPONSE_TEMPLATES[category];
}

/**
 * Build a safe response, optionally with a reason prefix.
 * 
 * @param category - The live data category
 * @param reason - Optional reason to include (sanitized)
 * @returns Complete safe response
 */
export function buildSafeResponse(
  category: LiveCategory,
  reason?: string
): string {
  const template = getSafeResponse(category);
  
  if (!reason) {
    return template;
  }
  
  // Sanitize reason to remove any numeric data that might have leaked in
  const sanitizedReason = sanitizeReason(reason);
  
  if (sanitizedReason) {
    return `${sanitizedReason}\n\n${template}`;
  }
  
  return template;
}

/**
 * Sanitize a reason string to remove any numeric data.
 * 
 * This is a safety measure in case the reason itself contains numbers.
 */
function sanitizeReason(reason: string): string {
  // Remove any numbers, currency symbols, percentages
  let sanitized = reason
    // Remove currency amounts
    .replace(/[$€£¥₹₽₩][\d,]+(?:\.\d+)?/g, '[data unavailable]')
    // Remove percentages
    .replace(/[\d,]+(?:\.\d+)?%/g, '[data unavailable]')
    // Remove decimal numbers
    .replace(/\d+\.\d+/g, '[data unavailable]')
    // Remove large numbers (likely data)
    .replace(/\d{4,}/g, '[data unavailable]')
    // Remove remaining isolated numbers that aren't small counts
    .replace(/\b(?:1[1-9]|[2-9]\d|\d{3,})\b/g, '[data unavailable]');
  
  // Clean up multiple replacements
  sanitized = sanitized.replace(/\[data unavailable\](\s*\[data unavailable\])+/g, '[data unavailable]');
  
  // If the sanitized version is mostly replacements, don't include it
  if ((sanitized.match(/\[data unavailable\]/g) || []).length > 2) {
    return '';
  }
  
  return sanitized.trim();
}

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXTUAL RESPONSES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Contextual safe response with entity information.
 * 
 * @param category - The live data category
 * @param entity - The entity that was queried (e.g., "AAPL", "Bitcoin", "New York")
 * @returns Safe response mentioning the entity
 */
export function buildContextualSafeResponse(
  category: LiveCategory,
  entity?: string
): string {
  if (!entity) {
    return getSafeResponse(category);
  }
  
  // Sanitize entity name (remove any numeric content)
  const sanitizedEntity = entity.replace(/[\d$€£¥%]+/g, '').trim();
  
  if (!sanitizedEntity) {
    return getSafeResponse(category);
  }
  
  const template = getSafeResponse(category);
  
  // Create contextual prefix based on category
  let prefix: string;
  
  switch (category) {
    case 'market':
      prefix = `I was unable to retrieve current market data for **${sanitizedEntity}**.`;
      break;
    case 'crypto':
      prefix = `I was unable to retrieve current price data for **${sanitizedEntity}**.`;
      break;
    case 'fx':
      prefix = `I was unable to retrieve the current exchange rate for **${sanitizedEntity}**.`;
      break;
    case 'weather':
      prefix = `I was unable to retrieve current weather data for **${sanitizedEntity}**.`;
      break;
    case 'time':
      prefix = `I was unable to retrieve the current time for **${sanitizedEntity}**.`;
      break;
    default:
      prefix = `I was unable to retrieve current data for **${sanitizedEntity}**.`;
  }
  
  // Replace the first line of the template with the contextual prefix
  const lines = template.split('\n');
  lines[0] = prefix;
  
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────────
// INVALID STATE RESPONSES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Response for invalid system state.
 * 
 * This is used when the system reaches a state that should be impossible
 * (e.g., time category in FORBID mode).
 */
export const INVALID_STATE_RESPONSE = `I encountered an unexpected issue while processing your request.

This has been logged for investigation. Please try your request again, or check the relevant external sources for the information you need.

If this issue persists, please report it through the feedback system.`;

/**
 * Get response for an invalid state.
 * 
 * @param category - The category (for fallback sources)
 * @param stateDescription - Description of the invalid state (for logging, not shown to user)
 * @returns Safe response for invalid state
 */
export function getInvalidStateResponse(
  category: LiveCategory,
  _stateDescription?: string
): string {
  // Include category-specific sources as a fallback
  const template = getSafeResponse(category);
  const sources = template.split('\n').filter(line => line.startsWith('•'));
  
  if (sources.length > 0) {
    return `I encountered an unexpected issue while processing your request.

In the meantime, you can check these sources:
${sources.join('\n')}

If this issue persists, please report it through the feedback system.`;
  }
  
  return INVALID_STATE_RESPONSE;
}

// ─────────────────────────────────────────────────────────────────────────────────
// PARTIAL RESPONSE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build a response that acknowledges partial data availability.
 * 
 * Used when some but not all requested data is available.
 * 
 * @param category - The live data category
 * @param availableInfo - Information that IS available (must be pre-validated)
 * @param unavailableAspect - What aspect is unavailable
 * @returns Response with partial information
 */
export function buildPartialResponse(
  category: LiveCategory,
  availableInfo: string,
  unavailableAspect: string
): string {
  // Validate that availableInfo doesn't contain disallowed numeric patterns
  // This is a safety check - the caller should have already validated
  if (containsDisallowedNumerics(availableInfo)) {
    // Fall back to full safe response if validation fails
    return getSafeResponse(category);
  }
  
  const template = getSafeResponse(category);
  const sources = template.split('\n').filter(line => line.startsWith('•')).join('\n');
  
  return `${availableInfo}

However, I was unable to retrieve ${unavailableAspect}.

For complete information, please check:
${sources}`;
}

/**
 * Check if text contains disallowed numeric patterns.
 * 
 * Simple check for obvious numeric data that shouldn't appear in safe responses.
 */
function containsDisallowedNumerics(text: string): boolean {
  // Currency amounts
  if (/[$€£¥₹][\d,]+(?:\.\d+)?/.test(text)) return true;
  
  // Percentages
  if (/[\d,]+(?:\.\d+)?%/.test(text)) return true;
  
  // Decimal numbers that look like prices/rates
  if (/\b\d+\.\d{2,}\b/.test(text)) return true;
  
  // Large integers that look like data values
  if (/\b\d{5,}\b/.test(text)) return true;
  
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────────
// RESPONSE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate that a safe response is actually safe.
 * 
 * This is a paranoia check to ensure safe responses don't accidentally
 * contain numeric data.
 * 
 * @param response - The response to validate
 * @returns True if the response is safe
 */
export function validateSafeResponse(response: string): boolean {
  return !containsDisallowedNumerics(response);
}

/**
 * Get all safe response templates (for testing/validation).
 */
export function getAllSafeResponses(): ReadonlyMap<LiveCategory, string> {
  return new Map(Object.entries(SAFE_RESPONSE_TEMPLATES) as [LiveCategory, string][]);
}

/**
 * Validate all safe response templates.
 * 
 * Used during testing to ensure templates are actually safe.
 */
export function validateAllTemplates(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const [category, template] of Object.entries(SAFE_RESPONSE_TEMPLATES)) {
    if (!validateSafeResponse(template)) {
      errors.push(`Template for '${category}' contains disallowed numeric patterns`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export {
  SAFE_RESPONSE_TEMPLATES,
  INVALID_STATE_RESPONSE,
};
