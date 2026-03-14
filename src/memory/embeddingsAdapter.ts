//--------------------------------------------------------------
// FILE: src/memory/embeddingsAdapter.ts
// Local embedding service adapter for Railway
//--------------------------------------------------------------

import { logger } from "../utils/logger.js";
import * as LocalEmbeddings from "./embeddingsLocal.js";

let providerChecked = false;
let isAvailable = false;

//--------------------------------------------------------------
// Check if embeddings are available
//--------------------------------------------------------------

async function checkProvider(): Promise<boolean> {
  if (providerChecked) {
    return isAvailable;
  }

  isAvailable = await LocalEmbeddings.isEmbeddingAvailable();
  providerChecked = true;

  if (isAvailable) {
    logger.info('✅ Using BIG embedding service (bge-large-en-v1.5, 1024 dims)');
  } else {
    logger.warn('⚠️ BIG embedding service not available, semantic search will use keyword fallback');
  }

  return isAvailable;
}

//--------------------------------------------------------------
// Unified embedding functions
//--------------------------------------------------------------

export async function embedText(text: string): Promise<number[]> {
  const available = await checkProvider();

  if (available) {
    return LocalEmbeddings.embedText(text);
  }

  // Return zero vector if no provider
  return new Array(1024).fill(0); // bge-large-en-v1.5 uses 1024 dims
}

export async function batchEmbed(texts: string[]): Promise<number[][]> {
  const available = await checkProvider();

  if (available) {
    return LocalEmbeddings.batchEmbed(texts);
  }

  return texts.map(() => new Array(1024).fill(0));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  return LocalEmbeddings.cosineSimilarity(a, b);
}

export async function isEmbeddingAvailable(): Promise<boolean> {
  return await checkProvider();
}

export function clearEmbeddingCache(): void {
  LocalEmbeddings.clearEmbeddingCache();
}

export function getCacheStats() {
  return { ...LocalEmbeddings.getCacheStats(), provider: 'local' };
}

export function getActiveProvider(): string {
  return isAvailable ? 'local' : 'none';
}
