// ═══════════════════════════════════════════════════════════════════════════════
// NUMERIC TOKENS — Extract Tokens from Provider Data
// Phase 6: Evidence & Injection
// 
// This module extracts NumericTokens from provider data. Each token represents
// an allowed numeric value that the model can include in its response.
// 
// CRITICAL INVARIANT:
// The `formatted` field of each token must EXACTLY match the string that
// appears in the evidence injection. This ensures the leak guard can verify
// that model output only contains values from the evidence.
// ═══════════════════════════════════════════════════════════════════════════════

import type { LiveCategory } from '../../types/categories.js';
import type {
  NumericToken,
  NumericTokenSet,
  NumericContextKey,
} from '../../types/constraints.js';
import type {
  ProviderData,
  StockData,
  FxData,
  CryptoData,
  WeatherData,
  TimeData,
} from '../../types/provider-results.js';

import {
  formatCurrency,
  formatCurrencyChange,
  formatPercent,
  formatWithCommas,
  formatTemperature,
  formatTemperatureDual,
  formatWindSpeed,
  formatHumidity,
  formatPressure,
  formatUvIndex,
  formatVisibility,
  formatExchangeRate,
  formatRate,
  formatCryptoPrice,
  formatMarketCap,
  formatVolume,
  formatSupply,
  formatTime12,
  formatTime24,
  formatTimeWithZone,
  getDecimalPlaces,
} from './formatting.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Result of formatting provider data.
 * Contains both human-readable text and extracted tokens.
 */
export interface FormattedDataResult {
  /** Human-readable formatted text for evidence injection */
  readonly text: string;
  
  /** Extracted numeric tokens for allowlist */
  readonly tokens: readonly NumericToken[];
  
  /** Entity identifier (ticker, city, etc.) */
  readonly entity: string;
  
  /** Data category */
  readonly category: LiveCategory;
}

/**
 * Options for token extraction.
 */
export interface TokenExtractionOptions {
  /** Timestamp when data was fetched */
  readonly fetchedAt: number;
  
  /** Whether to include optional fields */
  readonly includeOptional?: boolean;
  
  /** Temperature unit preference */
  readonly temperatureUnit?: 'C' | 'F' | 'both';
  
  /** Speed unit preference */
  readonly speedUnit?: 'mph' | 'kph';
  
  /** Time format preference */
  readonly timeFormat?: '12h' | '24h';
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN CREATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Create a numeric token with all required fields.
 */
function createToken(
  value: number,
  contextKey: NumericContextKey,
  sourceCategory: LiveCategory,
  sourceEntity: string,
  fetchedAt: number,
  formatted: string,
  unit?: string,
  precision?: number
): NumericToken {
  return {
    value,
    contextKey,
    sourceCategory,
    sourceEntity,
    fetchedAt,
    formatted,
    unit,
    precision: precision ?? getDecimalPlaces(value),
  };
}

/**
 * Create a unique key for a token.
 */
export function createTokenKey(token: NumericToken): string {
  return `${token.sourceCategory}:${token.sourceEntity}:${token.contextKey}`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// STOCK DATA FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format stock data into evidence text and extract tokens.
 * 
 * @param data - Stock data from provider
 * @param options - Extraction options
 * @returns Formatted result with text and tokens
 * 
 * @example
 * formatStockData(stockData, { fetchedAt: Date.now() })
 * // {
 * //   text: "AAPL (Apple Inc.):\n- Current: $178.50 (+$2.30, +1.31%)\n...",
 * //   tokens: [{ value: 178.50, contextKey: 'price', ... }, ...],
 * //   entity: "AAPL",
 * //   category: "market"
 * // }
 */
export function formatStockData(
  data: StockData,
  options: TokenExtractionOptions
): FormattedDataResult {
  const { fetchedAt, includeOptional = true } = options;
  const tokens: NumericToken[] = [];
  const lines: string[] = [];
  
  const entity = data.symbol;
  const category: LiveCategory = 'market';
  
  // Header
  lines.push(`${data.symbol} (${data.exchange}):`);
  
  // Current price - ALWAYS included
  const priceFormatted = formatCurrency(data.price, data.currency);
  tokens.push(createToken(
    data.price,
    'price',
    category,
    entity,
    fetchedAt,
    priceFormatted,
    data.currency,
    2
  ));
  
  // Change values
  const changeFormatted = formatCurrencyChange(data.change, data.currency);
  const changePercentFormatted = formatPercent(data.changePercent, 2, true);
  
  tokens.push(createToken(
    data.change,
    'change_absolute',
    category,
    entity,
    fetchedAt,
    changeFormatted,
    data.currency,
    2
  ));
  
  tokens.push(createToken(
    data.changePercent,
    'change_percent',
    category,
    entity,
    fetchedAt,
    changePercentFormatted,
    '%',
    2
  ));
  
  lines.push(`- Current: ${priceFormatted} (${changeFormatted}, ${changePercentFormatted})`);
  
  // Day range (if available)
  if (includeOptional && data.dayHigh !== undefined && data.dayLow !== undefined) {
    const highFormatted = formatCurrency(data.dayHigh, data.currency);
    const lowFormatted = formatCurrency(data.dayLow, data.currency);
    
    tokens.push(createToken(
      data.dayHigh,
      'high',
      category,
      entity,
      fetchedAt,
      highFormatted,
      data.currency,
      2
    ));
    
    tokens.push(createToken(
      data.dayLow,
      'low',
      category,
      entity,
      fetchedAt,
      lowFormatted,
      data.currency,
      2
    ));
    
    lines.push(`- Day Range: ${lowFormatted} - ${highFormatted}`);
  }
  
  // Previous close (if available)
  if (includeOptional && data.previousClose !== undefined) {
    const prevCloseFormatted = formatCurrency(data.previousClose, data.currency);
    
    tokens.push(createToken(
      data.previousClose,
      'previous_close',
      category,
      entity,
      fetchedAt,
      prevCloseFormatted,
      data.currency,
      2
    ));
    
    lines.push(`- Previous Close: ${prevCloseFormatted}`);
  }
  
  // Open (if available)
  if (includeOptional && data.open !== undefined) {
    const openFormatted = formatCurrency(data.open, data.currency);
    
    tokens.push(createToken(
      data.open,
      'open',
      category,
      entity,
      fetchedAt,
      openFormatted,
      data.currency,
      2
    ));
    
    lines.push(`- Open: ${openFormatted}`);
  }
  
  // Volume (if available)
  if (includeOptional && data.volume !== undefined) {
    const volumeFormatted = formatVolume(data.volume);
    
    tokens.push(createToken(
      data.volume,
      'volume',
      category,
      entity,
      fetchedAt,
      volumeFormatted,
      undefined,
      0
    ));
    
    lines.push(`- Volume: ${volumeFormatted}`);
  }
  
  // Market cap (if available)
  if (includeOptional && data.marketCap !== undefined) {
    const marketCapFormatted = formatMarketCap(data.marketCap, data.currency);
    
    tokens.push(createToken(
      data.marketCap,
      'market_cap',
      category,
      entity,
      fetchedAt,
      marketCapFormatted,
      data.currency,
      2
    ));
    
    lines.push(`- Market Cap: ${marketCapFormatted}`);
  }
  
  return {
    text: lines.join('\n'),
    tokens,
    entity,
    category,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// FX DATA FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format FX data into evidence text and extract tokens.
 */
export function formatFxData(
  data: FxData,
  options: TokenExtractionOptions
): FormattedDataResult {
  const { fetchedAt, includeOptional = true } = options;
  const tokens: NumericToken[] = [];
  const lines: string[] = [];
  
  const entity = `${data.baseCurrency}/${data.quoteCurrency}`;
  const category: LiveCategory = 'fx';
  
  // Header
  lines.push(`${entity}:`);
  
  // Exchange rate - ALWAYS included
  const rateFormatted = formatRate(data.rate, 4);
  const rateFullFormatted = formatExchangeRate(
    data.rate,
    data.baseCurrency,
    data.quoteCurrency
  );
  
  tokens.push(createToken(
    data.rate,
    'exchange_rate',
    category,
    entity,
    fetchedAt,
    rateFormatted,
    data.quoteCurrency,
    4
  ));
  
  lines.push(`- Rate: ${rateFullFormatted}`);
  
  // Bid/Ask (if available)
  if (includeOptional && data.bid !== undefined && data.ask !== undefined) {
    const bidFormatted = formatRate(data.bid, 4);
    const askFormatted = formatRate(data.ask, 4);
    
    tokens.push(createToken(
      data.bid,
      'bid',
      category,
      entity,
      fetchedAt,
      bidFormatted,
      data.quoteCurrency,
      4
    ));
    
    tokens.push(createToken(
      data.ask,
      'ask',
      category,
      entity,
      fetchedAt,
      askFormatted,
      data.quoteCurrency,
      4
    ));
    
    lines.push(`- Bid/Ask: ${bidFormatted} / ${askFormatted}`);
  }
  
  // Spread (if available)
  if (includeOptional && data.spread !== undefined) {
    const spreadFormatted = formatRate(data.spread, 4);
    
    tokens.push(createToken(
      data.spread,
      'spread',
      category,
      entity,
      fetchedAt,
      spreadFormatted,
      data.quoteCurrency,
      4
    ));
    
    lines.push(`- Spread: ${spreadFormatted}`);
  }
  
  // 24h change (if available)
  if (includeOptional && data.changePercent24h !== undefined) {
    const changeFormatted = formatPercent(data.changePercent24h, 2, true);
    
    tokens.push(createToken(
      data.changePercent24h,
      'change_24h',
      category,
      entity,
      fetchedAt,
      changeFormatted,
      '%',
      2
    ));
    
    lines.push(`- 24h Change: ${changeFormatted}`);
  }
  
  return {
    text: lines.join('\n'),
    tokens,
    entity,
    category,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// CRYPTO DATA FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format crypto data into evidence text and extract tokens.
 */
export function formatCryptoData(
  data: CryptoData,
  options: TokenExtractionOptions
): FormattedDataResult {
  const { fetchedAt, includeOptional = true } = options;
  const tokens: NumericToken[] = [];
  const lines: string[] = [];
  
  const entity = data.symbol;
  const category: LiveCategory = 'crypto';
  
  // Header
  lines.push(`${data.symbol} (${data.name}):`);
  
  // Price USD - ALWAYS included
  const priceFormatted = formatCryptoPrice(data.priceUsd, 'USD');
  
  tokens.push(createToken(
    data.priceUsd,
    'price_usd',
    category,
    entity,
    fetchedAt,
    priceFormatted,
    'USD',
    data.priceUsd >= 1 ? 2 : 6
  ));
  
  lines.push(`- Price: ${priceFormatted}`);
  
  // Price BTC (if available)
  if (includeOptional && data.priceBtc !== undefined) {
    const priceBtcFormatted = `₿${data.priceBtc.toFixed(8)}`;
    
    tokens.push(createToken(
      data.priceBtc,
      'price_btc',
      category,
      entity,
      fetchedAt,
      priceBtcFormatted,
      'BTC',
      8
    ));
    
    lines.push(`- Price (BTC): ${priceBtcFormatted}`);
  }
  
  // 24h change - common for crypto
  if (data.change24h !== undefined) {
    const change24hFormatted = formatPercent(data.change24h, 2, true);
    
    tokens.push(createToken(
      data.change24h,
      'change_24h',
      category,
      entity,
      fetchedAt,
      change24hFormatted,
      '%',
      2
    ));
    
    lines.push(`- 24h Change: ${change24hFormatted}`);
  }
  
  // 1h change (if available)
  if (includeOptional && data.change1h !== undefined) {
    const change1hFormatted = formatPercent(data.change1h, 2, true);
    
    tokens.push(createToken(
      data.change1h,
      'change_1h',
      category,
      entity,
      fetchedAt,
      change1hFormatted,
      '%',
      2
    ));
    
    lines.push(`- 1h Change: ${change1hFormatted}`);
  }
  
  // 7d change (if available)
  if (includeOptional && data.change7d !== undefined) {
    const change7dFormatted = formatPercent(data.change7d, 2, true);
    
    tokens.push(createToken(
      data.change7d,
      'change_7d',
      category,
      entity,
      fetchedAt,
      change7dFormatted,
      '%',
      2
    ));
    
    lines.push(`- 7d Change: ${change7dFormatted}`);
  }
  
  // Market cap (if available)
  if (includeOptional && data.marketCapUsd !== undefined) {
    const marketCapFormatted = formatMarketCap(data.marketCapUsd, 'USD');
    
    tokens.push(createToken(
      data.marketCapUsd,
      'market_cap',
      category,
      entity,
      fetchedAt,
      marketCapFormatted,
      'USD',
      2
    ));
    
    lines.push(`- Market Cap: ${marketCapFormatted}`);
  }
  
  // 24h volume (if available)
  if (includeOptional && data.volume24hUsd !== undefined) {
    const volumeFormatted = formatMarketCap(data.volume24hUsd, 'USD');
    
    tokens.push(createToken(
      data.volume24hUsd,
      'volume',
      category,
      entity,
      fetchedAt,
      volumeFormatted,
      'USD',
      2
    ));
    
    lines.push(`- 24h Volume: ${volumeFormatted}`);
  }
  
  // Circulating supply (if available)
  if (includeOptional && data.circulatingSupply !== undefined) {
    const supplyFormatted = formatSupply(data.circulatingSupply);
    
    tokens.push(createToken(
      data.circulatingSupply,
      'circulating_supply',
      category,
      entity,
      fetchedAt,
      supplyFormatted,
      data.symbol,
      0
    ));
    
    lines.push(`- Circulating Supply: ${supplyFormatted} ${data.symbol}`);
  }
  
  // Max supply (if available)
  if (includeOptional && data.maxSupply !== undefined) {
    const maxSupplyFormatted = formatSupply(data.maxSupply);
    
    tokens.push(createToken(
      data.maxSupply,
      'max_supply',
      category,
      entity,
      fetchedAt,
      maxSupplyFormatted,
      data.symbol,
      0
    ));
    
    lines.push(`- Max Supply: ${maxSupplyFormatted} ${data.symbol}`);
  }
  
  return {
    text: lines.join('\n'),
    tokens,
    entity,
    category,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// WEATHER DATA FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format weather data into evidence text and extract tokens.
 */
export function formatWeatherData(
  data: WeatherData,
  options: TokenExtractionOptions
): FormattedDataResult {
  const { 
    fetchedAt, 
    includeOptional = true,
    temperatureUnit = 'both',
    speedUnit = 'mph',
  } = options;
  const tokens: NumericToken[] = [];
  const lines: string[] = [];
  
  const entity = data.location;
  const category: LiveCategory = 'weather';
  
  // Header
  lines.push(`Weather in ${data.location}:`);
  
  // Condition (text, no token needed)
  lines.push(`- Condition: ${data.condition}`);
  
  // Temperature - format based on preference
  if (temperatureUnit === 'both') {
    const tempFormatted = formatTemperatureDual(
      data.temperatureCelsius,
      data.temperatureFahrenheit
    );
    
    // Add both tokens
    tokens.push(createToken(
      data.temperatureFahrenheit,
      'temperature_f',
      category,
      entity,
      fetchedAt,
      formatTemperature(data.temperatureFahrenheit, 'F'),
      '°F',
      0
    ));
    
    tokens.push(createToken(
      data.temperatureCelsius,
      'temperature_c',
      category,
      entity,
      fetchedAt,
      formatTemperature(data.temperatureCelsius, 'C'),
      '°C',
      0
    ));
    
    lines.push(`- Temperature: ${tempFormatted}`);
  } else if (temperatureUnit === 'F') {
    const tempFormatted = formatTemperature(data.temperatureFahrenheit, 'F');
    
    tokens.push(createToken(
      data.temperatureFahrenheit,
      'temperature_f',
      category,
      entity,
      fetchedAt,
      tempFormatted,
      '°F',
      0
    ));
    
    lines.push(`- Temperature: ${tempFormatted}`);
  } else {
    const tempFormatted = formatTemperature(data.temperatureCelsius, 'C');
    
    tokens.push(createToken(
      data.temperatureCelsius,
      'temperature_c',
      category,
      entity,
      fetchedAt,
      tempFormatted,
      '°C',
      0
    ));
    
    lines.push(`- Temperature: ${tempFormatted}`);
  }
  
  // Feels like (if available)
  if (includeOptional && data.feelsLikeFahrenheit !== undefined && data.feelsLikeCelsius !== undefined) {
    if (temperatureUnit === 'both') {
      const feelsLikeFormatted = formatTemperatureDual(
        data.feelsLikeCelsius,
        data.feelsLikeFahrenheit
      );
      
      tokens.push(createToken(
        data.feelsLikeFahrenheit,
        'feels_like',
        category,
        entity,
        fetchedAt,
        formatTemperature(data.feelsLikeFahrenheit, 'F'),
        '°F',
        0
      ));
      
      lines.push(`- Feels Like: ${feelsLikeFormatted}`);
    } else {
      const temp = temperatureUnit === 'F' ? data.feelsLikeFahrenheit : data.feelsLikeCelsius;
      const feelsLikeFormatted = formatTemperature(temp, temperatureUnit);
      
      tokens.push(createToken(
        temp,
        'feels_like',
        category,
        entity,
        fetchedAt,
        feelsLikeFormatted,
        `°${temperatureUnit}`,
        0
      ));
      
      lines.push(`- Feels Like: ${feelsLikeFormatted}`);
    }
  }
  
  // Humidity (if available)
  if (includeOptional && data.humidity !== undefined) {
    const humidityFormatted = formatHumidity(data.humidity);
    
    tokens.push(createToken(
      data.humidity,
      'humidity',
      category,
      entity,
      fetchedAt,
      humidityFormatted,
      '%',
      0
    ));
    
    lines.push(`- Humidity: ${humidityFormatted}`);
  }
  
  // Wind (if available)
  if (includeOptional) {
    const windSpeed = speedUnit === 'mph' ? data.windSpeedMph : data.windSpeedKph;
    
    if (windSpeed !== undefined) {
      const windFormatted = formatWindSpeed(
        windSpeed,
        speedUnit,
        data.windDirection
      );
      
      tokens.push(createToken(
        windSpeed,
        speedUnit === 'mph' ? 'wind_speed_mph' : 'wind_speed_kph',
        category,
        entity,
        fetchedAt,
        `${windSpeed} ${speedUnit}`,
        speedUnit,
        0
      ));
      
      lines.push(`- Wind: ${windFormatted}`);
    }
  }
  
  // Pressure (if available)
  if (includeOptional && data.pressure !== undefined) {
    const pressureFormatted = formatPressure(data.pressure, 'mb');
    
    tokens.push(createToken(
      data.pressure,
      'pressure',
      category,
      entity,
      fetchedAt,
      pressureFormatted,
      'mb',
      0
    ));
    
    lines.push(`- Pressure: ${pressureFormatted}`);
  }
  
  // UV Index (if available)
  if (includeOptional && data.uvIndex !== undefined) {
    const uvFormatted = formatUvIndex(data.uvIndex);
    
    tokens.push(createToken(
      data.uvIndex,
      'uv_index',
      category,
      entity,
      fetchedAt,
      uvFormatted,
      undefined,
      0
    ));
    
    lines.push(`- UV Index: ${uvFormatted}`);
  }
  
  // Visibility (if available)
  if (includeOptional && data.visibility !== undefined) {
    const visFormatted = formatVisibility(data.visibility, 'km');
    
    tokens.push(createToken(
      data.visibility,
      'visibility',
      category,
      entity,
      fetchedAt,
      visFormatted,
      'km',
      1
    ));
    
    lines.push(`- Visibility: ${visFormatted}`);
  }
  
  return {
    text: lines.join('\n'),
    tokens,
    entity,
    category,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIME DATA FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format time data into evidence text and extract tokens.
 * 
 * NOTE: Time data DOES have tokens. The localTime and utcTime strings
 * are allowed in output.
 */
export function formatTimeData(
  data: TimeData,
  options: TokenExtractionOptions
): FormattedDataResult {
  const { fetchedAt, timeFormat = '12h' } = options;
  const tokens: NumericToken[] = [];
  const lines: string[] = [];
  
  const entity = data.timezone;
  const category: LiveCategory = 'time';
  
  // Header
  lines.push(`Time in ${data.timezone}:`);
  
  // Local time - ALWAYS included
  const localTimeFormatted = timeFormat === '12h'
    ? formatTime12(data.localTime)
    : formatTime24(data.localTime);
  
  const localTimeWithZone = formatTimeWithZone(
    data.localTime,
    data.abbreviation ?? data.timezone,
    timeFormat
  );
  
  // Extract hour and minute as tokens (for leak guard validation)
  const timeComponents = parseTimeString(data.localTime);
  if (timeComponents) {
    // The formatted time string itself
    tokens.push(createToken(
      timeComponents.hours * 100 + timeComponents.minutes, // Encode as HHMM
      'timestamp',
      category,
      entity,
      fetchedAt,
      localTimeFormatted,
      undefined,
      0
    ));
  }
  
  lines.push(`- Local Time: ${localTimeWithZone}`);
  
  // UTC time
  const utcTimeFormatted = timeFormat === '12h'
    ? formatTime12(data.utcTime)
    : formatTime24(data.utcTime);
  
  lines.push(`- UTC: ${formatTimeWithZone(data.utcTime, 'UTC', timeFormat)}`);
  
  // Unix timestamp
  tokens.push(createToken(
    data.unixTimestamp,
    'unix_timestamp',
    category,
    entity,
    fetchedAt,
    data.unixTimestamp.toString(),
    undefined,
    0
  ));
  
  // UTC offset
  lines.push(`- UTC Offset: ${data.utcOffset}`);
  
  // DST info (if available)
  if (data.isDst !== undefined) {
    lines.push(`- Daylight Saving: ${data.isDst ? 'Yes' : 'No'}`);
  }
  
  return {
    text: lines.join('\n'),
    tokens,
    entity,
    category,
  };
}

/**
 * Parse a time string into components.
 */
function parseTimeString(time: string): { hours: number; minutes: number; seconds: number } | null {
  const match = time.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return {
      hours: parseInt(match[1] ?? '0', 10),
      minutes: parseInt(match[2] ?? '0', 10),
      seconds: parseInt(match[3] ?? '0', 10),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// GENERIC PROVIDER DATA FORMATTING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format any provider data based on its type.
 * 
 * @param data - Provider data (discriminated union)
 * @param options - Extraction options
 * @returns Formatted result with text and tokens
 */
export function formatProviderData(
  data: ProviderData,
  options: TokenExtractionOptions
): FormattedDataResult {
  switch (data.type) {
    case 'stock':
      return formatStockData(data, options);
    case 'fx':
      return formatFxData(data, options);
    case 'crypto':
      return formatCryptoData(data, options);
    case 'weather':
      return formatWeatherData(data, options);
    case 'time':
      return formatTimeData(data, options);
    default:
      // Exhaustive check
      const _exhaustive: never = data;
      throw new Error(`Unknown provider data type: ${(_exhaustive as ProviderData).type}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// TOKEN SET BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Extract tokens from provider data.
 * 
 * @param data - Provider data
 * @param fetchedAt - When data was fetched
 * @returns Array of numeric tokens
 */
export function extractTokensFromData(
  data: ProviderData,
  fetchedAt: number
): NumericToken[] {
  const result = formatProviderData(data, { fetchedAt });
  return [...result.tokens];
}

/**
 * Build a NumericTokenSet from an array of tokens.
 * 
 * @param tokens - Array of numeric tokens
 * @returns Token set with indexed lookups
 */
export function buildTokenSet(tokens: readonly NumericToken[]): NumericTokenSet {
  const tokenMap = new Map<string, NumericToken>();
  const byValue = new Map<number, NumericToken[]>();
  const byContext = new Map<NumericContextKey, NumericToken[]>();
  
  for (const token of tokens) {
    const key = createTokenKey(token);
    tokenMap.set(key, token);
    
    // Index by value
    const valueTokens = byValue.get(token.value) ?? [];
    valueTokens.push(token);
    byValue.set(token.value, valueTokens);
    
    // Index by context
    const contextTokens = byContext.get(token.contextKey) ?? [];
    contextTokens.push(token);
    byContext.set(token.contextKey, contextTokens);
  }
  
  return {
    tokens: tokenMap,
    byValue,
    byContext,
  };
}

/**
 * Merge multiple token sets into one.
 * 
 * @param sets - Array of token sets to merge
 * @returns Combined token set
 */
export function mergeTokenSets(sets: readonly NumericTokenSet[]): NumericTokenSet {
  const allTokens: NumericToken[] = [];
  
  for (const set of sets) {
    for (const token of set.tokens.values()) {
      allTokens.push(token);
    }
  }
  
  return buildTokenSet(allTokens);
}

/**
 * Build token set from multiple provider data results.
 * 
 * @param dataItems - Array of provider data
 * @param fetchedAt - When data was fetched
 * @returns Combined token set
 */
export function buildTokenSetFromData(
  dataItems: readonly ProviderData[],
  fetchedAt: number
): NumericTokenSet {
  const allTokens: NumericToken[] = [];
  
  for (const data of dataItems) {
    const tokens = extractTokensFromData(data, fetchedAt);
    allTokens.push(...tokens);
  }
  
  return buildTokenSet(allTokens);
}

// ─────────────────────────────────────────────────────────────────────────────────
// FORMATTED EVIDENCE BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format multiple provider data items into combined evidence.
 * 
 * @param dataItems - Array of provider data
 * @param options - Extraction options
 * @returns Combined formatted result
 */
export function formatMultipleData(
  dataItems: readonly ProviderData[],
  options: TokenExtractionOptions
): {
  text: string;
  tokens: NumericTokenSet;
  categories: readonly LiveCategory[];
} {
  const allTokens: NumericToken[] = [];
  const textBlocks: string[] = [];
  const categories = new Set<LiveCategory>();
  
  for (const data of dataItems) {
    const result = formatProviderData(data, options);
    textBlocks.push(result.text);
    allTokens.push(...result.tokens);
    categories.add(result.category);
  }
  
  return {
    text: textBlocks.join('\n\n'),
    tokens: buildTokenSet(allTokens),
    categories: [...categories],
  };
}
