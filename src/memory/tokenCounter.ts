//--------------------------------------------------------------
// FILE: src/memory/tokenCounter.ts
// Token counting and budget management for memory layers
//--------------------------------------------------------------

import { encoding_for_model, Tiktoken } from "tiktoken";
import { logger } from "../utils/logger.js";

// Token limits for each memory layer (total budget: 90k / 260k)
export const TOKEN_LIMITS = {
  GHOST_MEMORIES: 2000,       // Static system knowledge
  IDENTITY_CORE: 8000,        // Who we are to each other
  ACTIVE_STM: 20000,          // Raw recent messages
  COMPRESSED_STM: 15000,      // Compressed older conversation
  EPISODIC_LTM: 20000,        // Semantic memory recall
  BLOCK_MEMORIES: 10000,      // Reference knowledge
  SYSTEM_PROMPT: 10000,       // System instructions
  TOOLS: 5000,                // Tool definitions
  TOTAL_MEMORY_BUDGET: 90000, // Hard limit for all memory
  SAFETY_MARGIN: 170000       // Remaining for conversation
};

// Initialize encoder (GPT-4 tokenizer, close enough for Llama)
let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    try {
      encoder = encoding_for_model('gpt-4');
      logger.debug('🔢 Initialized tiktoken encoder (gpt-4)');
    } catch (error) {
      logger.error('Failed to initialize tiktoken encoder:', error);
      throw error;
    }
  }
  return encoder;
}

//--------------------------------------------------------------
// Count tokens in text
//--------------------------------------------------------------

export function countTokens(text: string): number {
  if (!text) return 0;

  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (error) {
    logger.error('Error counting tokens:', error);
    // Fallback: rough estimate (1 token ≈ 4 chars)
    return Math.ceil(text.length / 4);
  }
}

//--------------------------------------------------------------
// Count tokens in array of texts
//--------------------------------------------------------------

export function countTokensBatch(texts: string[]): number {
  return texts.reduce((total, text) => total + countTokens(text), 0);
}

//--------------------------------------------------------------
// Count tokens in structured content
//--------------------------------------------------------------

export interface TokenCounts {
  ghost: number;
  identity: number;
  activeSTM: number;
  compressedSTM: number;
  ltm: number;
  blocks: number;
  system: number;
  tools: number;
  total: number;
  remaining: number;
  withinBudget: boolean;
}

export function countMemoryTokens(content: {
  ghost?: string;
  identity?: string;
  activeSTM?: string;
  compressedSTM?: string;
  ltm?: string;
  blocks?: string;
  system?: string;
  tools?: string;
}): TokenCounts {
  const counts = {
    ghost: countTokens(content.ghost || ''),
    identity: countTokens(content.identity || ''),
    activeSTM: countTokens(content.activeSTM || ''),
    compressedSTM: countTokens(content.compressedSTM || ''),
    ltm: countTokens(content.ltm || ''),
    blocks: countTokens(content.blocks || ''),
    system: countTokens(content.system || ''),
    tools: countTokens(content.tools || ''),
    total: 0,
    remaining: 0,
    withinBudget: true
  };

  counts.total = counts.ghost + counts.identity + counts.activeSTM +
                 counts.compressedSTM + counts.ltm + counts.blocks +
                 counts.system + counts.tools;

  counts.remaining = TOKEN_LIMITS.TOTAL_MEMORY_BUDGET - counts.total;
  counts.withinBudget = counts.total <= TOKEN_LIMITS.TOTAL_MEMORY_BUDGET;

  return counts;
}

//--------------------------------------------------------------
// Truncate text to fit within token limit
//--------------------------------------------------------------

export function truncateToTokenLimit(text: string, limit: number): string {
  if (!text) return '';

  const currentTokens = countTokens(text);

  if (currentTokens <= limit) {
    return text;
  }

  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    const truncatedTokens = tokens.slice(0, limit);
    const decoded = enc.decode(truncatedTokens);

    logger.debug(`✂️ Truncated text from ${currentTokens} to ${limit} tokens`);
    return String.fromCharCode(...decoded);

  } catch (error) {
    logger.error('Error truncating text:', error);
    // Fallback: character-based truncation
    const estimatedChars = Math.floor(limit * 4);
    return text.slice(0, estimatedChars);
  }
}

//--------------------------------------------------------------
// Truncate array of texts to fit within token budget
//--------------------------------------------------------------

export function truncateArrayToLimit<T extends { text?: string; summary?: string; content?: string }>(
  items: T[],
  limit: number,
  getTextField: (item: T) => string = (item) => item.text || item.summary || item.content || ''
): T[] {
  if (items.length === 0) return [];

  const result: T[] = [];
  let totalTokens = 0;

  for (const item of items) {
    const text = getTextField(item);
    const tokens = countTokens(text);

    if (totalTokens + tokens <= limit) {
      result.push(item);
      totalTokens += tokens;
    } else {
      // Check if we can fit a truncated version
      const remainingTokens = limit - totalTokens;
      if (remainingTokens > 50) {  // Only include if we have at least 50 tokens space
        logger.debug(`✂️ Truncating last item to fit budget (${remainingTokens} tokens remaining)`);
        // We can't easily modify the item, so just stop here
        break;
      } else {
        break;
      }
    }
  }

  logger.debug(`📊 Truncated array from ${items.length} to ${result.length} items (${totalTokens} tokens)`);
  return result;
}

//--------------------------------------------------------------
// Smart truncation with priority
//--------------------------------------------------------------

export interface PrioritizedItem {
  content: string;
  priority: number;  // Higher = more important
  id?: string;
}

export function truncateByPriority(
  items: PrioritizedItem[],
  limit: number
): PrioritizedItem[] {
  if (items.length === 0) return [];

  // Sort by priority (descending)
  const sorted = [...items].sort((a, b) => b.priority - a.priority);

  const result: PrioritizedItem[] = [];
  let totalTokens = 0;

  for (const item of sorted) {
    const tokens = countTokens(item.content);

    if (totalTokens + tokens <= limit) {
      result.push(item);
      totalTokens += tokens;
    } else {
      break;
    }
  }

  logger.debug(`📊 Selected ${result.length}/${items.length} items by priority (${totalTokens} tokens)`);
  return result;
}

//--------------------------------------------------------------
// Log token usage breakdown
//--------------------------------------------------------------

export function logTokenUsage(counts: TokenCounts): void {
  const overBudget = !counts.withinBudget;

  logger.info(`
📊 Token Usage Breakdown:
  Ghost Memories:  ${counts.ghost.toLocaleString()}/${TOKEN_LIMITS.GHOST_MEMORIES.toLocaleString()}
  Identity Core:   ${counts.identity.toLocaleString()}/${TOKEN_LIMITS.IDENTITY_CORE.toLocaleString()}
  Active STM:      ${counts.activeSTM.toLocaleString()}/${TOKEN_LIMITS.ACTIVE_STM.toLocaleString()}
  Compressed STM:  ${counts.compressedSTM.toLocaleString()}/${TOKEN_LIMITS.COMPRESSED_STM.toLocaleString()}
  Episodic LTM:    ${counts.ltm.toLocaleString()}/${TOKEN_LIMITS.EPISODIC_LTM.toLocaleString()}
  Block Memories:  ${counts.blocks.toLocaleString()}/${TOKEN_LIMITS.BLOCK_MEMORIES.toLocaleString()}
  System Prompt:   ${counts.system.toLocaleString()}/${TOKEN_LIMITS.SYSTEM_PROMPT.toLocaleString()}
  Tools:           ${counts.tools.toLocaleString()}/${TOKEN_LIMITS.TOOLS.toLocaleString()}
  ─────────────────────────────────────────────
  TOTAL:           ${counts.total.toLocaleString()}/${TOKEN_LIMITS.TOTAL_MEMORY_BUDGET.toLocaleString()} ${overBudget ? '❌ OVER BUDGET' : '✅'}
  Remaining:       ${counts.remaining.toLocaleString()}
  `);

  if (overBudget) {
    logger.warn(`⚠️ Memory token budget exceeded by ${(counts.total - TOKEN_LIMITS.TOTAL_MEMORY_BUDGET).toLocaleString()} tokens!`);
  }
}

//--------------------------------------------------------------
// Calculate percentage of budget used
//--------------------------------------------------------------

export function getBudgetUsage(counts: TokenCounts): number {
  return (counts.total / TOKEN_LIMITS.TOTAL_MEMORY_BUDGET) * 100;
}

//--------------------------------------------------------------
// Check if adding content would exceed budget
//--------------------------------------------------------------

export function willExceedBudget(
  currentTokens: number,
  additionalContent: string
): boolean {
  const additionalTokens = countTokens(additionalContent);
  return (currentTokens + additionalTokens) > TOKEN_LIMITS.TOTAL_MEMORY_BUDGET;
}

//--------------------------------------------------------------
// Estimate tokens without full encoding (fast approximation)
//--------------------------------------------------------------

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimate: 1 token ≈ 4 characters
  // This is faster than full encoding but less accurate
  return Math.ceil(text.length / 4);
}

//--------------------------------------------------------------
// Cleanup encoder on shutdown
//--------------------------------------------------------------

export function cleanup(): void {
  if (encoder) {
    encoder.free();
    encoder = null;
    logger.debug('🗑️ Freed tiktoken encoder');
  }
}

// Register cleanup on process exit
process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
