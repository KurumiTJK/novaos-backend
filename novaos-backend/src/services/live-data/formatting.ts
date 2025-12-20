// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING UTILITIES — Deterministic Number Formatting
// Phase 6: Evidence & Injection
// 
// CRITICAL: All formatting functions are LOCALE-INDEPENDENT.
// Output must be identical regardless of system locale settings.
// 
// This ensures:
// 1. Tokens extracted from formatted strings are predictable
// 2. Leak guard pattern matching works consistently
// 3. Evidence injection produces reproducible output
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Currency symbols by code.
 */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CHF: 'CHF ',
  CAD: 'C$',
  AUD: 'A$',
  INR: '₹',
  KRW: '₩',
  BTC: '₿',
  ETH: 'Ξ',
};

/**
 * Default decimal places by currency.
 */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,  // Yen has no decimal places
  CNY: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  INR: 2,
  KRW: 0,  // Won has no decimal places
  BTC: 8,  // Bitcoin uses 8 decimal places
  ETH: 8,  // Ethereum uses 8 decimal places (but often shown with fewer)
};

// ─────────────────────────────────────────────────────────────────────────────────
// CORE FORMATTING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format a number with comma separators.
 * 
 * DETERMINISTIC: Always uses comma for thousands, period for decimal.
 * 
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string like "1,234.56"
 * 
 * @example
 * formatWithCommas(1234567.89, 2) // "1,234,567.89"
 * formatWithCommas(1234567.89, 0) // "1,234,568"
 */
export function formatWithCommas(value: number, decimals: number = 2): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  // Round to specified decimals
  const rounded = Number(value.toFixed(decimals));
  
  // Split into integer and decimal parts
  const [integerPart, decimalPart] = rounded.toFixed(decimals).split('.');
  
  // Add commas to integer part (manual implementation - no locale)
  const withCommas = addCommasToInteger(integerPart ?? '0');
  
  // Combine with decimal part if present
  if (decimalPart && decimals > 0) {
    return `${withCommas}.${decimalPart}`;
  }
  
  return withCommas;
}

/**
 * Add commas to an integer string.
 * Handles negative numbers.
 */
function addCommasToInteger(intStr: string): string {
  const isNegative = intStr.startsWith('-');
  const absStr = isNegative ? intStr.slice(1) : intStr;
  
  // Add commas from right to left
  let result = '';
  for (let i = 0; i < absStr.length; i++) {
    if (i > 0 && i % 3 === 0) {
      result = ',' + result;
    }
    result = absStr[absStr.length - 1 - i] + result;
  }
  
  return isNegative ? '-' + result : result;
}

/**
 * Format a currency value.
 * 
 * DETERMINISTIC: Always produces consistent format.
 * 
 * @param value - The numeric value
 * @param currencyCode - Currency code (USD, EUR, etc.)
 * @param decimals - Override decimal places (default: currency-specific)
 * @returns Formatted string like "$1,234.56"
 * 
 * @example
 * formatCurrency(1234.56, 'USD') // "$1,234.56"
 * formatCurrency(1234.56, 'EUR') // "€1,234.56"
 * formatCurrency(1234567, 'JPY') // "¥1,234,567"
 */
export function formatCurrency(
  value: number,
  currencyCode: string = 'USD',
  decimals?: number
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? `${currencyCode} `;
  const decimalPlaces = decimals ?? CURRENCY_DECIMALS[currencyCode] ?? 2;
  
  const absValue = Math.abs(value);
  const formatted = formatWithCommas(absValue, decimalPlaces);
  
  if (value < 0) {
    return `-${symbol}${formatted}`;
  }
  
  return `${symbol}${formatted}`;
}

/**
 * Format a percentage value.
 * 
 * DETERMINISTIC: Always produces consistent format.
 * 
 * @param value - The percentage value (e.g., 1.5 for 1.5%)
 * @param decimals - Number of decimal places (default: 2)
 * @param showSign - Whether to show + for positive values (default: false)
 * @returns Formatted string like "1.50%" or "+1.50%"
 * 
 * @example
 * formatPercent(1.5, 2, false) // "1.50%"
 * formatPercent(1.5, 2, true)  // "+1.50%"
 * formatPercent(-1.5, 2, true) // "-1.50%"
 */
export function formatPercent(
  value: number,
  decimals: number = 2,
  showSign: boolean = false
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const formatted = Math.abs(value).toFixed(decimals);
  
  if (value > 0 && showSign) {
    return `+${formatted}%`;
  }
  
  if (value < 0) {
    return `-${formatted}%`;
  }
  
  return `${formatted}%`;
}

/**
 * Format a currency change (signed currency value).
 * 
 * @param value - The change value
 * @param currencyCode - Currency code
 * @param decimals - Override decimal places
 * @returns Formatted string like "+$2.30" or "-$1.50"
 * 
 * @example
 * formatCurrencyChange(2.30, 'USD') // "+$2.30"
 * formatCurrencyChange(-1.50, 'USD') // "-$1.50"
 */
export function formatCurrencyChange(
  value: number,
  currencyCode: string = 'USD',
  decimals?: number
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? `${currencyCode} `;
  const decimalPlaces = decimals ?? CURRENCY_DECIMALS[currencyCode] ?? 2;
  
  const absValue = Math.abs(value);
  const formatted = formatWithCommas(absValue, decimalPlaces);
  
  if (value > 0) {
    return `+${symbol}${formatted}`;
  }
  
  if (value < 0) {
    return `-${symbol}${formatted}`;
  }
  
  return `${symbol}${formatted}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TEMPERATURE FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Temperature unit.
 */
export type TemperatureUnit = 'C' | 'F';

/**
 * Format a temperature value.
 * 
 * @param value - Temperature value
 * @param unit - Temperature unit ('C' or 'F')
 * @param decimals - Decimal places (default: 0 for display)
 * @returns Formatted string like "72°F" or "22°C"
 * 
 * @example
 * formatTemperature(72, 'F') // "72°F"
 * formatTemperature(22.5, 'C', 1) // "22.5°C"
 */
export function formatTemperature(
  value: number,
  unit: TemperatureUnit,
  decimals: number = 0
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const formatted = value.toFixed(decimals);
  return `${formatted}°${unit}`;
}

/**
 * Format temperature with both units.
 * 
 * @param celsius - Temperature in Celsius
 * @param fahrenheit - Temperature in Fahrenheit
 * @returns Formatted string like "72°F (22°C)"
 */
export function formatTemperatureDual(
  celsius: number,
  fahrenheit: number
): string {
  const f = formatTemperature(fahrenheit, 'F');
  const c = formatTemperature(celsius, 'C');
  return `${f} (${c})`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SPEED FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Speed unit.
 */
export type SpeedUnit = 'mph' | 'kph' | 'm/s';

/**
 * Format a speed value.
 * 
 * @param value - Speed value
 * @param unit - Speed unit
 * @param decimals - Decimal places (default: 0)
 * @returns Formatted string like "15 mph" or "24 kph"
 * 
 * @example
 * formatSpeed(15, 'mph') // "15 mph"
 * formatSpeed(24.5, 'kph', 1) // "24.5 kph"
 */
export function formatSpeed(
  value: number,
  unit: SpeedUnit,
  decimals: number = 0
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const formatted = value.toFixed(decimals);
  return `${formatted} ${unit}`;
}

/**
 * Format wind speed with direction.
 * 
 * @param speed - Wind speed value
 * @param unit - Speed unit
 * @param direction - Wind direction (e.g., "NW", "SSE")
 * @returns Formatted string like "15 mph NW"
 */
export function formatWindSpeed(
  speed: number,
  unit: SpeedUnit,
  direction?: string
): string {
  const speedStr = formatSpeed(speed, unit);
  
  if (direction) {
    return `${speedStr} ${direction}`;
  }
  
  return speedStr;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIME FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse a time string or Date into components.
 */
interface TimeComponents {
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Extract time components from various inputs.
 */
function parseTimeComponents(time: string | Date | number): TimeComponents | null {
  if (time instanceof Date) {
    return {
      hours: time.getHours(),
      minutes: time.getMinutes(),
      seconds: time.getSeconds(),
    };
  }
  
  if (typeof time === 'number') {
    // Unix timestamp
    const date = new Date(time);
    return {
      hours: date.getHours(),
      minutes: date.getMinutes(),
      seconds: date.getSeconds(),
    };
  }
  
  if (typeof time === 'string') {
    // Try to parse ISO format or time string
    // Supports: "14:30:00", "14:30", "2024-01-15T14:30:00Z"
    const isoMatch = time.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (isoMatch) {
      return {
        hours: parseInt(isoMatch[1] ?? '0', 10),
        minutes: parseInt(isoMatch[2] ?? '0', 10),
        seconds: parseInt(isoMatch[3] ?? '0', 10),
      };
    }
  }
  
  return null;
}

/**
 * Format time in 12-hour format.
 * 
 * DETERMINISTIC: Always produces "HH:MM AM/PM" format.
 * 
 * @param time - Time as string, Date, or unix timestamp
 * @param includeSeconds - Whether to include seconds (default: false)
 * @returns Formatted string like "2:30 PM" or "2:30:45 PM"
 * 
 * @example
 * formatTime12("14:30:00") // "2:30 PM"
 * formatTime12("09:05:00") // "9:05 AM"
 */
export function formatTime12(
  time: string | Date | number,
  includeSeconds: boolean = false
): string {
  const components = parseTimeComponents(time);
  if (!components) {
    return 'N/A';
  }
  
  const { hours, minutes, seconds } = components;
  
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;  // Convert 0 to 12
  
  const minuteStr = minutes.toString().padStart(2, '0');
  
  if (includeSeconds) {
    const secondStr = seconds.toString().padStart(2, '0');
    return `${hour12}:${minuteStr}:${secondStr} ${period}`;
  }
  
  return `${hour12}:${minuteStr} ${period}`;
}

/**
 * Format time in 24-hour format.
 * 
 * DETERMINISTIC: Always produces "HH:MM" or "HH:MM:SS" format.
 * 
 * @param time - Time as string, Date, or unix timestamp
 * @param includeSeconds - Whether to include seconds (default: false)
 * @returns Formatted string like "14:30" or "14:30:45"
 * 
 * @example
 * formatTime24("14:30:00") // "14:30"
 * formatTime24("09:05:00") // "09:05"
 */
export function formatTime24(
  time: string | Date | number,
  includeSeconds: boolean = false
): string {
  const components = parseTimeComponents(time);
  if (!components) {
    return 'N/A';
  }
  
  const { hours, minutes, seconds } = components;
  
  const hourStr = hours.toString().padStart(2, '0');
  const minuteStr = minutes.toString().padStart(2, '0');
  
  if (includeSeconds) {
    const secondStr = seconds.toString().padStart(2, '0');
    return `${hourStr}:${minuteStr}:${secondStr}`;
  }
  
  return `${hourStr}:${minuteStr}`;
}

/**
 * Format time with timezone.
 * 
 * @param time - Time as string
 * @param timezone - Timezone name or abbreviation
 * @param format - '12h' or '24h'
 * @returns Formatted string like "2:30 PM EST"
 */
export function formatTimeWithZone(
  time: string | Date | number,
  timezone: string,
  format: '12h' | '24h' = '12h'
): string {
  const timeStr = format === '12h' 
    ? formatTime12(time) 
    : formatTime24(time);
  
  if (timeStr === 'N/A') {
    return 'N/A';
  }
  
  return `${timeStr} ${timezone}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// MEASUREMENT FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format pressure value.
 * 
 * @param value - Pressure value
 * @param unit - Pressure unit ('mb', 'hPa', 'inHg')
 * @returns Formatted string like "1013 mb"
 */
export function formatPressure(
  value: number,
  unit: 'mb' | 'hPa' | 'inHg' = 'mb'
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const decimals = unit === 'inHg' ? 2 : 0;
  const formatted = value.toFixed(decimals);
  return `${formatted} ${unit}`;
}

/**
 * Format humidity percentage.
 * 
 * @param value - Humidity value (0-100)
 * @returns Formatted string like "65%"
 */
export function formatHumidity(value: number): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  return `${Math.round(value)}%`;
}

/**
 * Format UV index.
 * 
 * @param value - UV index value
 * @returns Formatted string with category like "6 (High)"
 */
export function formatUvIndex(value: number): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const rounded = Math.round(value);
  let category: string;
  
  if (rounded <= 2) {
    category = 'Low';
  } else if (rounded <= 5) {
    category = 'Moderate';
  } else if (rounded <= 7) {
    category = 'High';
  } else if (rounded <= 10) {
    category = 'Very High';
  } else {
    category = 'Extreme';
  }
  
  return `${rounded} (${category})`;
}

/**
 * Format visibility distance.
 * 
 * @param value - Visibility value
 * @param unit - Distance unit ('km', 'mi')
 * @returns Formatted string like "10 km"
 */
export function formatVisibility(
  value: number,
  unit: 'km' | 'mi' = 'km'
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const formatted = value.toFixed(1);
  return `${formatted} ${unit}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// LARGE NUMBER FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format a large number with abbreviation.
 * 
 * @param value - The number to format
 * @param decimals - Decimal places for abbreviated form
 * @returns Formatted string like "1.5B" or "250M"
 * 
 * @example
 * formatLargeNumber(1500000000) // "1.50B"
 * formatLargeNumber(250000000) // "250.00M"
 * formatLargeNumber(50000) // "50.00K"
 */
export function formatLargeNumber(
  value: number,
  decimals: number = 2
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  
  if (absValue >= 1_000_000_000_000) {
    return `${sign}${(absValue / 1_000_000_000_000).toFixed(decimals)}T`;
  }
  
  if (absValue >= 1_000_000_000) {
    return `${sign}${(absValue / 1_000_000_000).toFixed(decimals)}B`;
  }
  
  if (absValue >= 1_000_000) {
    return `${sign}${(absValue / 1_000_000).toFixed(decimals)}M`;
  }
  
  if (absValue >= 1_000) {
    return `${sign}${(absValue / 1_000).toFixed(decimals)}K`;
  }
  
  return `${sign}${absValue.toFixed(decimals)}`;
}

/**
 * Format market cap value.
 * 
 * @param value - Market cap value
 * @param currencyCode - Currency code
 * @returns Formatted string like "$1.50B"
 */
export function formatMarketCap(
  value: number,
  currencyCode: string = 'USD'
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? `${currencyCode} `;
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  
  if (absValue >= 1_000_000_000_000) {
    return `${sign}${symbol}${(absValue / 1_000_000_000_000).toFixed(2)}T`;
  }
  
  if (absValue >= 1_000_000_000) {
    return `${sign}${symbol}${(absValue / 1_000_000_000).toFixed(2)}B`;
  }
  
  if (absValue >= 1_000_000) {
    return `${sign}${symbol}${(absValue / 1_000_000).toFixed(2)}M`;
  }
  
  return formatCurrency(value, currencyCode);
}

/**
 * Format volume number.
 * 
 * @param value - Volume value
 * @returns Formatted string like "1.5M" or "250K"
 */
export function formatVolume(value: number): string {
  return formatLargeNumber(value, 2);
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXCHANGE RATE FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format an exchange rate.
 * 
 * @param rate - The exchange rate
 * @param baseCurrency - Base currency code
 * @param quoteCurrency - Quote currency code
 * @param decimals - Decimal places (default: 4 for FX)
 * @returns Formatted string like "1 USD = 0.9234 EUR"
 * 
 * @example
 * formatExchangeRate(0.9234, 'USD', 'EUR') // "1 USD = 0.9234 EUR"
 */
export function formatExchangeRate(
  rate: number,
  baseCurrency: string,
  quoteCurrency: string,
  decimals: number = 4
): string {
  if (!Number.isFinite(rate)) {
    return 'N/A';
  }
  
  const formatted = rate.toFixed(decimals);
  return `1 ${baseCurrency} = ${formatted} ${quoteCurrency}`;
}

/**
 * Format just the rate value (for tokens).
 * 
 * @param rate - The exchange rate
 * @param decimals - Decimal places
 * @returns Formatted rate string
 */
export function formatRate(rate: number, decimals: number = 4): string {
  if (!Number.isFinite(rate)) {
    return 'N/A';
  }
  
  return rate.toFixed(decimals);
}

// ─────────────────────────────────────────────────────────────────────────────────
// CRYPTO-SPECIFIC FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format a cryptocurrency price.
 * 
 * Automatically adjusts decimal places based on value.
 * 
 * @param value - Price value
 * @param currencyCode - Quote currency (default: USD)
 * @returns Formatted string
 */
export function formatCryptoPrice(
  value: number,
  currencyCode: string = 'USD'
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  // Determine appropriate decimal places based on price magnitude
  let decimals: number;
  if (value >= 1000) {
    decimals = 2;
  } else if (value >= 1) {
    decimals = 2;
  } else if (value >= 0.01) {
    decimals = 4;
  } else if (value >= 0.0001) {
    decimals = 6;
  } else {
    decimals = 8;
  }
  
  return formatCurrency(value, currencyCode, decimals);
}

/**
 * Format a supply number (for circulating/max supply).
 * 
 * @param value - Supply value
 * @returns Formatted string like "19.5M" or "21M"
 */
export function formatSupply(value: number): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  
  return formatLargeNumber(value, 2);
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get decimal places for a value (for token extraction).
 */
export function getDecimalPlaces(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) {
    return 0;
  }
  
  const str = Math.abs(value).toString();
  const decimalIndex = str.indexOf('.');
  
  if (decimalIndex === -1) {
    return 0;
  }
  
  return str.length - decimalIndex - 1;
}

/**
 * Round to significant figures.
 */
export function roundToSignificant(value: number, figures: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }
  
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const scale = Math.pow(10, figures - magnitude - 1);
  
  return Math.round(value * scale) / scale;
}

/**
 * Check if a value should be formatted as a large number.
 */
export function shouldAbbreviate(value: number, threshold: number = 10000): boolean {
  return Math.abs(value) >= threshold;
}
