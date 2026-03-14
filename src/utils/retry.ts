//--------------------------------------------------------------
// FILE: src/utils/retry.ts
// Retry utility with exponential backoff for transient failures
//--------------------------------------------------------------

import { logger } from './logger.js';

export interface RetryOptions {
  /** Maximum number of retry attempts (including initial attempt) */
  maxAttempts?: number;
  /** Initial delay in milliseconds */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds */
  maxDelayMs?: number;
  /** Backoff multiplier (delay = delay * multiplier after each attempt) */
  backoffMultiplier?: number;
  /** Function to determine if an error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Label for logging purposes */
  label?: string;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'isRetryable' | 'label'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Execute a function with automatic retry on failure
 * Uses exponential backoff between attempts
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let lastError: Error = new Error('Unknown error');
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we've exhausted all attempts
      if (attempt === opts.maxAttempts) {
        const label = opts.label ? `[${opts.label}] ` : '';
        logger.error(`${label}All ${opts.maxAttempts} attempts failed: ${lastError.message}`);
        break;
      }

      // Check if error is retryable
      if (opts.isRetryable && !opts.isRetryable(lastError)) {
        const label = opts.label ? `[${opts.label}] ` : '';
        logger.warn(`${label}Error is not retryable: ${lastError.message}`);
        break;
      }

      // Log retry attempt
      const label = opts.label ? `[${opts.label}] ` : '';
      logger.warn(`${label}Attempt ${attempt} failed, retrying in ${delay}ms: ${lastError.message}`);

      // Wait before next attempt
      await sleep(delay);

      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Default retry predicate - retries on network/timeout errors, not on 4xx errors
 */
export function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Don't retry on client errors (4xx)
  if (/\b(400|401|403|404|422)\b/.test(message)) {
    return false;
  }

  // Retry on network/timeout errors
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket') ||
    message.includes('fetch failed') ||
    /\b(500|502|503|504)\b/.test(message)
  ) {
    return true;
  }

  // Retry on rate limits
  if (message.includes('rate limit') || message.includes('429')) {
    return true;
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a function to automatically retry on transient failures
 * Returns a new function with the same signature
 */
export function withRetryWrapper<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}
