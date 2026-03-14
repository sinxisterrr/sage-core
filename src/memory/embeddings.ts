//--------------------------------------------------------------
// FILE: src/memory/embeddings.ts
// Ollama-based embedding generation for semantic memory search
//--------------------------------------------------------------

import { logger } from "../utils/logger.js";
import fetch from "node-fetch";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";  // 768 dimensions, fast, good quality
const EMBEDDING_CACHE_SIZE = 1000;  // Cache last 1000 embeddings

// In-memory cache for embeddings (text -> embedding vector)
const embeddingCache = new Map<string, number[]>();
let cacheHits = 0;
let cacheMisses = 0;

//--------------------------------------------------------------
// Types
//--------------------------------------------------------------

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  cached: boolean;
}

export interface SimilarityResult {
  text: string;
  similarity: number;
  index: number;
}

//--------------------------------------------------------------
// Generate embedding for a single text
//--------------------------------------------------------------

export async function embedText(text: string): Promise<number[]> {
  // Normalize text for cache key
  const cacheKey = text.trim().toLowerCase();

  // Check cache first
  if (embeddingCache.has(cacheKey)) {
    cacheHits++;
    logger.debug(`📦 Embedding cache hit (${cacheHits}/${cacheHits + cacheMisses} = ${(cacheHits / (cacheHits + cacheMisses) * 100).toFixed(1)}%)`);
    return embeddingCache.get(cacheKey)!;
  }

  cacheMisses++;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text
      }),
      signal: AbortSignal.timeout(10000)  // 10s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { embedding: number[] };

    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error('Invalid embedding response from Ollama');
    }

    // Cache the result
    embeddingCache.set(cacheKey, data.embedding);

    // Evict oldest if cache too large (simple LRU)
    if (embeddingCache.size > EMBEDDING_CACHE_SIZE) {
      const firstKey = embeddingCache.keys().next().value;
      embeddingCache.delete(firstKey!);
    }

    logger.debug(`🔢 Generated embedding (${data.embedding.length} dims)`);
    return data.embedding;

  } catch (error: any) {
    logger.error(`❌ Failed to generate embedding: ${error.message}`);
    // Return zero vector as fallback (will have low similarity to everything)
    return new Array(768).fill(0);
  }
}

//--------------------------------------------------------------
// Generate embeddings for multiple texts (batched)
//--------------------------------------------------------------

export async function batchEmbed(texts: string[]): Promise<number[][]> {
  logger.info(`🔢 Generating embeddings for ${texts.length} texts...`);

  // Process in parallel with rate limiting (max 5 concurrent)
  const results: number[][] = [];
  const batchSize = 5;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(embedText));
    results.push(...batchResults);

    // Small delay to avoid overwhelming Ollama
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  logger.info(`✅ Generated ${results.length} embeddings`);
  return results;
}

//--------------------------------------------------------------
// Cosine similarity between two vectors
//--------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    logger.warn(`⚠️ Vector length mismatch: ${a.length} vs ${b.length}`);
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

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

//--------------------------------------------------------------
// Find most similar texts to query
//--------------------------------------------------------------

export async function findSimilar(
  query: string,
  candidates: string[],
  topK: number = 5
): Promise<SimilarityResult[]> {
  if (candidates.length === 0) {
    return [];
  }

  // Generate query embedding
  const queryEmbedding = await embedText(query);

  // Generate candidate embeddings (will use cache for repeated texts)
  const candidateEmbeddings = await batchEmbed(candidates);

  // Calculate similarities
  const similarities = candidateEmbeddings.map((embedding, index) => ({
    text: candidates[index],
    similarity: cosineSimilarity(queryEmbedding, embedding),
    index
  }));

  // Sort by similarity (descending) and return top K
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

//--------------------------------------------------------------
// Find similar embeddings when you already have the embeddings
//--------------------------------------------------------------

export async function findSimilarEmbeddings(
  query: string,
  candidateEmbeddings: Array<{ text: string; embedding: number[] }>,
  topK: number = 5
): Promise<SimilarityResult[]> {
  if (candidateEmbeddings.length === 0) {
    return [];
  }

  // Generate query embedding
  const queryEmbedding = await embedText(query);

  // Calculate similarities
  const similarities = candidateEmbeddings.map((candidate, index) => ({
    text: candidate.text,
    similarity: cosineSimilarity(queryEmbedding, candidate.embedding),
    index
  }));

  // Sort by similarity (descending) and return top K
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

//--------------------------------------------------------------
// Check if Ollama embeddings are available
//--------------------------------------------------------------

export async function isEmbeddingAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json() as { models: Array<{ name: string }> };

    // Check if embedding model is available
    const hasModel = data.models?.some(m => m.name.includes('nomic-embed'));

    if (!hasModel) {
      logger.warn(`⚠️ Embedding model '${EMBEDDING_MODEL}' not found in Ollama. Please run: ollama pull nomic-embed-text`);
    }

    return hasModel;

  } catch (error: any) {
    logger.warn(`⚠️ Ollama not available at ${OLLAMA_BASE_URL}: ${error.message}`);
    return false;
  }
}

//--------------------------------------------------------------
// Clear embedding cache (useful for testing/debugging)
//--------------------------------------------------------------

export function clearEmbeddingCache(): void {
  const size = embeddingCache.size;
  embeddingCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  logger.info(`🗑️ Cleared embedding cache (${size} entries)`);
}

//--------------------------------------------------------------
// Get cache statistics
//--------------------------------------------------------------

export function getCacheStats() {
  return {
    size: embeddingCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0
      ? (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(1) + '%'
      : 'N/A'
  };
}
