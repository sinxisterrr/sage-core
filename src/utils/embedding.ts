import { getConfig } from './configValidator.js';
import { withRetry, isTransientError } from './retry.js';

/**
 * Centralized embedding utility for all memory systems.
 * Fetches text embeddings from the external embedding service.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  return withRetry(async () => {
    const response = await fetch(`${getConfig().EMBEDDING_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = new Error(`Embedding service error: ${response.status} ${response.statusText}`);
      if (response.status >= 500 || response.status === 429) {
        (error as any).transient = true;
      }
      throw error;
    }

    const result = await response.json();
    if (!result.embedding || !Array.isArray(result.embedding)) {
      throw new Error(`Invalid embedding response: missing embedding array`);
    }
    return result.embedding;
  }, {
    maxAttempts: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    isRetryable: (error: any) => isTransientError(error) || (error as any).transient === true,
    label: 'getEmbedding'
  });
}
