//--------------------------------------------------------------
// FILE: src/memory/embeddingsLocal.ts
// Local embedding service client (shared transformers.js service)
//--------------------------------------------------------------

import { logger } from "../utils/logger.js";

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://big-embedder.railway.internal:3000';
const EMBEDDING_DIMS = 1024; // bge-large-en-v1.5 (upgraded from 384)

// Cache for embeddings (memory-efficient with LRU)
const embeddingCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 1000;

// Request queue to prevent overwhelming the connection pool
const MAX_CONCURRENT_REQUESTS = 5;
let activeRequests = 0;
const requestQueue: Array<() => void> = [];

//--------------------------------------------------------------
// Request queue management
//--------------------------------------------------------------

async function queueRequest<T>(fn: () => Promise<T>): Promise<T> {
  // If under limit, execute immediately
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    try {
      return await fn();
    } finally {
      activeRequests--;
      // Process next queued request
      const next = requestQueue.shift();
      if (next) next();
    }
  }

  // Otherwise, queue it
  return new Promise<T>((resolve, reject) => {
    requestQueue.push(async () => {
      activeRequests++;
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        activeRequests--;
        const next = requestQueue.shift();
        if (next) next();
      }
    });
  });
}

//--------------------------------------------------------------
// Check if local embedding service is available
//--------------------------------------------------------------

export async function isEmbeddingAvailable(): Promise<boolean> {
  const healthUrl = `${EMBEDDING_SERVICE_URL}/health`;
  logger.info(`🔍 Checking embedding service at: ${healthUrl}`);

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(30000) // 30 second timeout for public URLs
    });

    logger.info(`📡 Health check response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`⚠️ Embedding service health check failed: ${response.status} - ${errorText}`);
      return false;
    }

    const data = await response.json();
    logger.info(`✅ Embedding service health: ${JSON.stringify(data)}`);
    return data.ready === true;

  } catch (error: any) {
    logger.error(`❌ Local embedding service error: ${error.message}`);
    return false;
  }
}

//--------------------------------------------------------------
// Embed single text
//--------------------------------------------------------------

export async function embedText(text: string): Promise<number[]> {
  // Check cache first
  const cacheKey = text.slice(0, 200);
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  // Queue the request to avoid overwhelming the connection pool
  return queueRequest(async () => {
    try {
      const response = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 500) }),
        signal: AbortSignal.timeout(120000) // 2 minute timeout (includes queue wait time)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding service error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const embedding = result.embedding as number[];

      // Validate dimensions
      if (embedding.length !== EMBEDDING_DIMS) {
        logger.warn(`⚠️ Unexpected embedding dimensions: ${embedding.length}, expected ${EMBEDDING_DIMS}`);
      }

      // Cache it
      if (embeddingCache.size >= MAX_CACHE_SIZE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey) {
          embeddingCache.delete(firstKey);
        }
      }
      embeddingCache.set(cacheKey, embedding);

      return embedding;

    } catch (error: any) {
      logger.error(`❌ Failed to get embedding from local service: ${error.message}`);
      return new Array(EMBEDDING_DIMS).fill(0);
    }
  });
}

//--------------------------------------------------------------
// Batch embed multiple texts
//--------------------------------------------------------------

export async function batchEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  // Queue the request to avoid overwhelming the connection pool
  return queueRequest(async () => {
    try {
      const response = await fetch(`${EMBEDDING_SERVICE_URL}/embed/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: texts.map(t => t.slice(0, 500)) }),
        signal: AbortSignal.timeout(180000) // 3 minute timeout for batch (includes queue wait time)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Batch embedding error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      return result.embeddings as number[][];

    } catch (error: any) {
      logger.error(`❌ Batch embedding failed: ${error.message}`);
      return texts.map(() => new Array(EMBEDDING_DIMS).fill(0));
    }
  });
}

//--------------------------------------------------------------
// Cosine similarity between two embeddings
//--------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    logger.warn(`⚠️ Embedding dimension mismatch: ${a.length} vs ${b.length}`);
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

//--------------------------------------------------------------
// Cache management
//--------------------------------------------------------------

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
  logger.info('🧹 Embedding cache cleared');
}

export function getCacheStats() {
  return {
    size: embeddingCache.size,
    maxSize: MAX_CACHE_SIZE,
    hitRate: embeddingCache.size > 0 ? 1 : 0
  };
}

//--------------------------------------------------------------
// Get embedding dimensions
//--------------------------------------------------------------

export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMS;
}
