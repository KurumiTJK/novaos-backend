// ═══════════════════════════════════════════════════════════════════════════════
// WEB SERVICES — Hardened Fetch + Verification
// ═══════════════════════════════════════════════════════════════════════════════

export {
  HardenedFetchClient,
  getFetchClient,
  createFetchClient,
  isPrivateIP,
  isBlockedHostname,
  resolveHostname,
  validateUrl,
  type FetchResult,
  type FetchOptions,
  type URLValidation,
} from './fetch-client.js';

export {
  VerificationExecutor,
  getVerificationExecutor,
  type VerificationStatus,
  type VerificationSource,
  type VerificationResult,
  type VerificationRequest,
} from './verification-executor.js';

export {
  WebObserver,
  getWebObserver,
  type WebMetrics,
  type WebEvent,
} from './observer.js';
