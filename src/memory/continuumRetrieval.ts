//--------------------------------------------------------------
// FILE: src/memory/continuumRetrieval.ts
// Retrieves context from persona_blocks, human_blocks, archival_memories, reference_texts
// Falls back to JSON if DB unavailable
//--------------------------------------------------------------

import { query } from '../db/db.js';
import { searchReferenceTexts, formatReferenceForPrompt } from './referenceLoader.js';
import { getRPMemoriesForRegularMode } from './rpRetrieval.js';
import { boostMemoryRelevance } from './memoryManager.js';
import { logger } from '../utils/logger.js';
import { getAIName, getUserName } from '../utils/pronouns.js';
import fs from 'fs/promises';
import path from 'path';

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://localhost:3000';
const DATA_DIR = path.join(process.cwd(), 'data');
const ARCHIVAL_FILE = path.join(DATA_DIR, 'archival_memories.json');
const PERSONA_FILE = path.join(DATA_DIR, 'persona_blocks.json');
const HUMAN_FILE = path.join(DATA_DIR, 'human_blocks.json');

let dbAvailable = true;
let lastDbCheck = 0;
const DB_RECHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if database is available, with periodic retry logic.
 * If DB was down, only rechecks every 5 minutes to avoid spam.
 */
async function checkDbAvailable(): Promise<boolean> {
  const now = Date.now();

  // If DB was down, only recheck every 5 minutes
  if (!dbAvailable && now - lastDbCheck < DB_RECHECK_INTERVAL) {
    return false;
  }

  lastDbCheck = now;

  try {
    await query('SELECT 1'); // Simple health check
    if (!dbAvailable) {
      logger.info('✅ [ContinuumRetrieval] Database connection restored');
    }
    dbAvailable = true;
    return true;
  } catch (error) {
    if (dbAvailable) {
      logger.error('❌ [ContinuumRetrieval] Database connection lost, falling back to JSON');
    }
    dbAvailable = false;
    return false;
  }
}

interface PersonaBlock {
  label: string;
  content: string;
  miraType: string;
  averageWeight: number;
  messageCount: number;
}

interface HumanBlock {
  label: string;
  content: string;
  miraType: string;
  averageWeight: number;
  messageCount: number;
}

interface ArchivalMemory {
  id?: string;
  content: string;
  category: string;
  importance: number;
  messageWeight: number;
  timestamp: number | null;
  similarity: number;
  tags?: string[];
  metadata?: Record<string, any>;
  state?: string; // Memory lifecycle state: 'active', 'favorite', 'faded', 'forgotten'
}

/**
 * Get embedding from local service
 */
async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Embedding service error: ${response.status}`);
  }

  const result = await response.json();
  return result.embedding;
}

/**
 * Get AI's core identity and understanding from persona blocks
 */
export async function getPersonaBlocks(limit = 3): Promise<PersonaBlock[]> {
  if (await checkDbAvailable()) {
    try {
      return await query<PersonaBlock>(`
        SELECT
          label,
          content,
          mira_type as "miraType",
          average_weight as "averageWeight",
          message_count as "messageCount"
        FROM persona_blocks
        ORDER BY average_weight DESC
        LIMIT $1
      `, [limit]);
    } catch (error) {
      logger.warn('❌ [ContinuumRetrieval] Persona blocks query failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  // JSON fallback
  try {
    const data = await fs.readFile(PERSONA_FILE, 'utf-8');
    const blocks = JSON.parse(data);
    return blocks
      .sort((a: any, b: any) => (b.averageWeight || 0) - (a.averageWeight || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Get user's identity and information from human blocks
 */
export async function getHumanBlocks(limit = 3): Promise<HumanBlock[]> {
  if (await checkDbAvailable()) {
    try {
      return await query<HumanBlock>(`
        SELECT
          label,
          content,
          mira_type as "miraType",
          average_weight as "averageWeight",
          message_count as "messageCount"
        FROM human_blocks
        ORDER BY average_weight DESC
        LIMIT $1
      `, [limit]);
    } catch (error) {
      logger.warn('❌ [ContinuumRetrieval] Human blocks query failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  // JSON fallback
  try {
    const data = await fs.readFile(HUMAN_FILE, 'utf-8');
    const blocks = JSON.parse(data);
    return blocks
      .sort((a: any, b: any) => (b.averageWeight || 0) - (a.averageWeight || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Semantic search for relevant archival memories
 */
export async function searchArchival(
  queryText: string,
  limit = 5,
  minWeight = 1.0
): Promise<ArchivalMemory[]> {
  const queryEmbedding = await getEmbedding(queryText);

  if (await checkDbAvailable()) {
    try {
      const results = await query<ArchivalMemory>(`
        SELECT
          id,
          content,
          category,
          importance,
          message_weight as "messageWeight",
          timestamp,
          tags,
          metadata,
          state,
          1 - (embedding <=> $1::vector) as similarity
        FROM archival_memories
        WHERE message_weight >= $2
          AND (state IS NULL OR state NOT IN ('forgotten'))
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `, [
        JSON.stringify(queryEmbedding),
        minWeight,
        limit
      ]);

      // Apply 50% penalty to faded memories (human-like forgetting curve)
      // Faded memories can still surface if VERY relevant, but deprioritized
      for (const memory of results) {
        if (memory.state === 'faded' && memory.similarity !== undefined) {
          memory.similarity *= 0.5; // Half the relevance for faded memories
        }
      }

      // Boost relevance for retrieved memories (async, don't await)
      for (const memory of results) {
        if (memory.id) {
          boostMemoryRelevance(memory.id).catch(() => {}); // Fire and forget
        }
      }

      return results;
    } catch (error) {
      logger.warn('❌ [ContinuumRetrieval] Archival search query failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  // JSON fallback with manual similarity calculation
  try {
    const data = await fs.readFile(ARCHIVAL_FILE, 'utf-8');
    const memories = JSON.parse(data);

    const scored = memories
      .filter((m: any) => (m.message_weight || m.messageWeight || 0) >= minWeight)
      .map((m: any) => ({
        content: m.content,
        category: m.category,
        importance: m.importance,
        messageWeight: m.message_weight || m.messageWeight,
        timestamp: m.timestamp,
        tags: m.tags,
        metadata: m.metadata,
        similarity: cosineSimilarity(queryEmbedding, m.embedding)
      }))
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored;
  } catch {
    return [];
  }
}

/**
 * Get high-importance archival memories (by weight)
 */
export async function getImportantMemories(limit = 5, minWeight = 2.5): Promise<ArchivalMemory[]> {
  const results = await query<ArchivalMemory>(`
    SELECT
      id,
      content,
      category,
      importance,
      message_weight as "messageWeight",
      timestamp,
      tags,
      metadata,
      state,
      0 as similarity
    FROM archival_memories
    WHERE message_weight >= $1
      AND (state IS NULL OR state NOT IN ('forgotten'))
    ORDER BY message_weight DESC, timestamp DESC
    LIMIT $2
  `, [minWeight, limit]);

  // Apply 50% penalty to faded memories (same as searchArchival)
  // Even "important" memories fade over time - just like human memory
  for (const memory of results) {
    if (memory.state === 'faded' && memory.similarity !== undefined) {
      memory.similarity *= 0.5;
    }
  }

  return results;
}

/**
 * Get full context for building a prompt (includes reference texts + RP cross-reference)
 */
export async function getFullContext(query: string): Promise<{
  persona: PersonaBlock[];
  human: HumanBlock[];
  memories: ArchivalMemory[];
  referenceTexts: Array<{
    content: string;
    sourceFile: string;
    paragraphNumber: number;
    similarity: number;
  }>;
  rpMemories: string; // Cross-reference RP memories (formatted string)
}> {
  // Optimized for 260k context window with 2000 char user messages
  // Total budget: ~200k tokens for LTM retrieval
  const maxPersona = parseInt(process.env.MAX_PERSONA_BLOCKS || '30');
  const maxHuman = parseInt(process.env.MAX_HUMAN_BLOCKS || '30');
  const maxArchival = parseInt(process.env.MAX_ARCHIVAL_MEMORIES || '850');
  const maxReferenceTexts = parseInt(process.env.MAX_REFERENCE_TEXTS || '5');
  const minWeight = parseFloat(process.env.MIN_MEMORY_WEIGHT || '0.8');

  const [persona, human, memories, referenceTexts, rpMemories] = await Promise.all([
    getPersonaBlocks(maxPersona),
    getHumanBlocks(maxHuman),
    searchArchival(query, maxArchival, minWeight),
    searchReferenceTexts(query, maxReferenceTexts),
    getRPMemoriesForRegularMode(query), // Cross-reference RP memories (only if RP keywords detected)
  ]);

  // Compressed memory retrieval logging
  const topArchival = memories.length > 0 ? `"${memories[0]?.content?.substring(0, 40)}..." (${(Number(memories[0]?.similarity || 0) * 100).toFixed(0)}%)` : 'none';
  console.log(`📚 Retrieved: ${persona.length}p/${human.length}h/${memories.length}a/${referenceTexts.length}r${rpMemories ? '+RP' : ''} | Top: ${topArchival}`);

  // Verbose logging (enable with VERBOSE_MEMORY_LOGS=true)
  if (process.env.VERBOSE_MEMORY_LOGS === 'true') {
    console.log(`\n📖 ═══ MEMORY RETRIEVAL DETAILS ═══`);

    // Reference texts
    if (referenceTexts.length > 0) {
      console.log(`\n📄 REFERENCE TEXTS (from /data/*.txt):`);
      referenceTexts.forEach((ref, i) => {
        const sim = ref.similarity ? `${(Number(ref.similarity) * 100).toFixed(0)}%` : '?%';
        console.log(`   ${i + 1}. [${ref.sourceFile}:¶${ref.paragraphNumber}] (${sim})`);
        console.log(`      "${ref.content.substring(0, 80)}${ref.content.length > 80 ? '...' : ''}"`);
      });
    } else {
      console.log(`\n📄 REFERENCE TEXTS: none retrieved`);
    }

    // Archival memories (top 5)
    if (memories.length > 0) {
      console.log(`\n🧠 ARCHIVAL MEMORIES (top 5 of ${memories.length}):`);
      memories.slice(0, 5).forEach((mem, i) => {
        const sim = mem.similarity ? `${(Number(mem.similarity) * 100).toFixed(0)}%` : '?%';
        console.log(`   ${i + 1}. (${sim}) "${mem.content?.substring(0, 80)}${(mem.content?.length || 0) > 80 ? '...' : ''}"`);
      });
    } else {
      console.log(`\n🧠 ARCHIVAL MEMORIES: none retrieved`);
    }

    // Persona blocks
    if (persona.length > 0) {
      console.log(`\n👤 PERSONA BLOCKS (${persona.length}):`);
      persona.forEach((block, i) => {
        console.log(`   ${i + 1}. ${block.label} (weight: ${Number(block.averageWeight || 0).toFixed(1)})`);
      });
    }

    // Human blocks
    if (human.length > 0) {
      console.log(`\n👥 HUMAN BLOCKS (${human.length}):`);
      human.forEach((block, i) => {
        console.log(`   ${i + 1}. ${block.label} (weight: ${Number(block.averageWeight || 0).toFixed(1)})`);
      });
    }

    // RP memories (cross-reference from RP system)
    if (rpMemories) {
      console.log(`\n🎭 RP MEMORIES (cross-reference):`);
      // rpMemories is a formatted string, show a preview
      const lines = rpMemories.split('\n').filter(l => l.trim());
      const preview = lines.slice(0, 5);
      preview.forEach(line => {
        console.log(`   ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
      });
      if (lines.length > 5) {
        console.log(`   ... and ${lines.length - 5} more lines`);
      }
    } else {
      console.log(`\n🎭 RP MEMORIES: none (no RP keywords detected)`);
    }

    console.log(`📖 ═══════════════════════════════\n`);
  }

  return { persona, human, memories, referenceTexts, rpMemories };
}

/**
 * Format persona blocks for system prompt
 */
export function formatPersonaForPrompt(blocks: PersonaBlock[]): string {
  if (!blocks || blocks.length === 0) return '';

  const sections = blocks.map(block => {
    if (!block) return '';
    const avgWeight = block.averageWeight ? Number(block.averageWeight) : null;
    const weight = avgWeight && !isNaN(avgWeight) ? ` (avg weight: ${avgWeight.toFixed(1)})` : '';
    return `### ${block.label.toUpperCase()}${weight}\n${block.content}`;
  }).filter(Boolean);

  return sections.length > 0 ? `# YOUR IDENTITY (${getAIName()})\n\nThese are distilled patterns from YOUR past responses - things YOU (${getAIName()}) have said.\n\n${sections.join('\n\n')}` : '';
}

/**
 * Format human blocks for system prompt
 */
export function formatHumanForPrompt(blocks: HumanBlock[]): string {
  if (!blocks || blocks.length === 0) return '';

  const sections = blocks.map(block => {
    if (!block) return '';
    const avgWeight = block.averageWeight ? Number(block.averageWeight) : null;
    const weight = avgWeight && !isNaN(avgWeight) ? ` (avg weight: ${avgWeight.toFixed(1)})` : '';
    return `### ${block.label.toUpperCase()}${weight}\n${block.content}`;
  }).filter(Boolean);

  return sections.length > 0 ? `# ABOUT THE USER (${getUserName()})\n\nThese are distilled patterns from ${getUserName()}'s messages - things ${getUserName()} has said, not you.\n\n${sections.join('\n\n')}` : '';
}

/**
 * Format archival memories for context
 */
export function formatArchivalForPrompt(memories: ArchivalMemory[]): string {
  if (!memories || memories.length === 0) return '';

  const formatted = memories.map((mem, i) => {
    if (!mem) return '';
    const msgWeight = mem.messageWeight ? Number(mem.messageWeight) : null;
    const weight = msgWeight && !isNaN(msgWeight) ? ` [weight: ${msgWeight.toFixed(1)}]` : '';
    const simValue = mem.similarity ? Number(mem.similarity) : null;
    const sim = simValue && !isNaN(simValue) ? ` (${(simValue * 100).toFixed(0)}% relevant)` : '';

    // CRITICAL: Preserve speaker attribution to prevent identity confusion
    // Extract role from tags (first tag is role: 'user' or 'assistant')
    const role = mem.tags && mem.tags.length > 0 ? mem.tags[0] : null;
    const speaker = role === 'user' ? getUserName() : role === 'assistant' ? getAIName() : null;
    const speakerLabel = speaker ? `${speaker} said: ` : '';

    // Include memory ID so AI can use favorite_memory tool
    const memId = mem.id ? ` [ID: ${mem.id}]` : '';

    // Show state so AI knows what's already favorited/faded
    const stateTag = mem.state === 'favorite' ? ' [⭐favorite]' : mem.state === 'faded' ? ' [faded]' : '';

    return `${i + 1}. [${mem.category}]${weight}${sim}${stateTag}${memId}\n   ${speakerLabel}${mem.content}`;
  }).filter(Boolean);

  return formatted.length > 0 ? `# RELEVANT MEMORIES\n\nThese are past exchanges. Pay attention to who said what.\n\n${formatted.join('\n\n')}` : '';
}
