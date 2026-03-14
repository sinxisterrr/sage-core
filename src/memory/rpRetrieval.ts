//--------------------------------------------------------------
// FILE: src/memory/rpRetrieval.ts
// Retrieves RP context from rp_persona_blocks, rp_human_blocks, rp_archival_memories
// HARD-CODED: All content labeled as NARRATIVE ROLEPLAY
//--------------------------------------------------------------

import { query } from '../db/db.js';
import { boostMemoryRelevance } from './memoryManager.js';
import { logger } from '../utils/logger.js';
import { getEmbedding } from '../utils/embedding.js';
import { getUserName, getAIName } from '../utils/pronouns.js';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const RP_ARCHIVAL_FILE = path.join(DATA_DIR, 'rp_archival_memories.json');
const RP_PERSONA_FILE = path.join(DATA_DIR, 'rp_persona_blocks.json');
const RP_HUMAN_FILE = path.join(DATA_DIR, 'rp_human_blocks.json');

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
      logger.info('✅ [RPRetrieval] Database connection restored');
    }
    dbAvailable = true;
    return true;
  } catch (error) {
    if (dbAvailable) {
      logger.error('❌ [RPRetrieval] Database connection lost, falling back to JSON');
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


export async function getPersonaBlocks(limit = 3, channelId?: string): Promise<PersonaBlock[]> {
  if (await checkDbAvailable()) {
    try {
      return await query<PersonaBlock>(`
        SELECT
          label,
          content,
          mira_type as "miraType",
          average_weight as "averageWeight",
          message_count as "messageCount"
        FROM rp_persona_blocks
        WHERE channel_id = $2
        ORDER BY average_weight DESC
        LIMIT $1
      `, [limit, channelId]);
    } catch (error) {
      logger.warn('❌ [RPRetrieval] Persona blocks query failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  try {
    const data = await fs.readFile(RP_PERSONA_FILE, 'utf-8');
    const blocks = JSON.parse(data);
    return blocks
      .filter((block: any) => !channelId || block.channelId === channelId)
      .sort((a: any, b: any) => (b.averageWeight || 0) - (a.averageWeight || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function getHumanBlocks(limit = 3, channelId?: string): Promise<HumanBlock[]> {
  if (await checkDbAvailable()) {
    try {
      return await query<HumanBlock>(`
        SELECT
          label,
          content,
          mira_type as "miraType",
          average_weight as "averageWeight",
          message_count as "messageCount"
        FROM rp_human_blocks
        WHERE channel_id = $2
        ORDER BY average_weight DESC
        LIMIT $1
      `, [limit, channelId]);
    } catch (error) {
      logger.warn('❌ [RPRetrieval] Human blocks query failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  try {
    const data = await fs.readFile(RP_HUMAN_FILE, 'utf-8');
    const blocks = JSON.parse(data);
    return blocks
      .filter((block: any) => !channelId || block.channelId === channelId)
      .sort((a: any, b: any) => (b.averageWeight || 0) - (a.averageWeight || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

export async function searchArchival(
  queryText: string,
  channelId: string,
  limit = 5,
  minWeight = 1.0,
  userId?: string
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
          1 - (embedding <=> $1::vector) as similarity
        FROM rp_archival_memories
        WHERE message_weight >= $2
          AND tags @> jsonb_build_array($3::text)
          AND (state IS NULL OR state NOT IN ('forgotten'))
          AND ($5::text IS NULL OR user_id = $5::text)
        ORDER BY embedding <=> $1::vector
        LIMIT $4
      `, [
        JSON.stringify(queryEmbedding),
        minWeight,
        channelId,
        limit,
        userId ?? null
      ]);

      // Boost relevance for retrieved memories (async, don't await)
      for (const memory of results) {
        if (memory.id) {
          boostMemoryRelevance(memory.id).catch(() => {}); // Fire and forget
        }
      }

      return results;
    } catch (error) {
      logger.warn('❌ [RPRetrieval] Archival search query failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  try {
    const data = await fs.readFile(RP_ARCHIVAL_FILE, 'utf-8');
    const memories = JSON.parse(data);

    const scored = memories
      .filter((m: any) => {
        const hasMinWeight = (m.message_weight || m.messageWeight || 0) >= minWeight;
        const hasChannelId = m.tags && m.tags.includes(channelId);
        return hasMinWeight && hasChannelId;
      })
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

export async function getFullContext(query: string, channelId: string, userId?: string): Promise<{
  persona: PersonaBlock[];
  human: HumanBlock[];
  memories: ArchivalMemory[];
}> {
  const maxPersona = parseInt(process.env.MAX_PERSONA_BLOCKS || '30');
  const maxHuman = parseInt(process.env.MAX_HUMAN_BLOCKS || '30');
  const maxArchival = parseInt(process.env.MAX_ARCHIVAL_MEMORIES || '850');
  const minWeight = parseFloat(process.env.MIN_MEMORY_WEIGHT || '0.8');

  const [persona, human, memories] = await Promise.all([
    getPersonaBlocks(maxPersona, channelId),
    getHumanBlocks(maxHuman, channelId),
    searchArchival(query, channelId, maxArchival, minWeight, userId),
  ]);

  logger.debug(`\n🎭 [RP] MEMORY RETRIEVAL for query: "${query.substring(0, 50)}..."`);
  logger.debug(`   Channel: ${channelId}`);
  logger.debug(`   Persona blocks: ${persona.length}`);
  logger.debug(`   Human blocks: ${human.length}`);
  logger.debug(`   Archival memories: ${memories.length}`);

  return { persona, human, memories };
}

/**
 * Format a timestamp as a human-readable relative age string
 */
function formatAge(timestamp: number | null): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diffMs = now - timestamp;
  if (diffMs < 0) return '';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  return `${months} months ago`;
}

/**
 * Extract timestamp from a distillation label like "rp_identity_1707892843921"
 */
function extractTimestampFromLabel(label: string): number | null {
  const match = label.match(/_(\d{13})$/);
  if (match) return parseInt(match[1]);
  return null;
}

// HARD-CODED: Mark as narrative roleplay
export function formatPersonaForPrompt(blocks: PersonaBlock[]): string {
  if (!blocks || blocks.length === 0) return '';

  const sections = blocks.map(block => {
    if (!block) return '';
    const avgWeight = block.averageWeight ? Number(block.averageWeight) : null;
    const weight = avgWeight && !isNaN(avgWeight) ? ` (avg weight: ${avgWeight.toFixed(1)})` : '';
    const ts = extractTimestampFromLabel(block.label);
    const age = formatAge(ts);
    const ageTag = age ? ` (from ${age})` : '';
    return `### ${block.label.toUpperCase()}${weight}${ageTag}\n${block.content}`;
  }).filter(Boolean);

  return sections.length > 0 ? `# YOUR IDENTITY IN ROLEPLAY (${getAIName()} - NARRATIVE ONLY)\n\n⚠️ NARRATIVE ROLEPLAY CONTEXT - These patterns are from RP scenes, not real life.\n\n${sections.join('\n\n')}` : '';
}

export function formatHumanForPrompt(blocks: HumanBlock[]): string {
  if (!blocks || blocks.length === 0) return '';

  const sections = blocks.map(block => {
    if (!block) return '';
    const avgWeight = block.averageWeight ? Number(block.averageWeight) : null;
    const weight = avgWeight && !isNaN(avgWeight) ? ` (avg weight: ${avgWeight.toFixed(1)})` : '';
    const ts = extractTimestampFromLabel(block.label);
    const age = formatAge(ts);
    const ageTag = age ? ` (from ${age})` : '';
    return `### ${block.label.toUpperCase()}${weight}${ageTag}\n${block.content}`;
  }).filter(Boolean);

  return sections.length > 0 ? `# ABOUT THE USER IN ROLEPLAY (${getUserName()} - NARRATIVE ONLY)\n\n⚠️ NARRATIVE ROLEPLAY CONTEXT - These patterns are from RP scenes, not real life.\n\n${sections.join('\n\n')}` : '';
}

export function formatArchivalForPrompt(memories: ArchivalMemory[]): string {
  if (!memories || memories.length === 0) return '';

  const formatted = memories.map((mem, i) => {
    if (!mem) return '';
    const msgWeight = mem.messageWeight ? Number(mem.messageWeight) : null;
    const weight = msgWeight && !isNaN(msgWeight) ? ` [weight: ${msgWeight.toFixed(1)}]` : '';
    const simValue = mem.similarity ? Number(mem.similarity) : null;
    const sim = simValue && !isNaN(simValue) ? ` (${(simValue * 100).toFixed(0)}% relevant)` : '';

    const role = mem.tags && mem.tags.length > 0 ? mem.tags[0] : null;
    const speaker = role === 'user' ? getUserName() : role === 'assistant' ? getAIName() : null;
    const speakerLabel = speaker ? `${speaker} said: ` : '';

    // Include memory ID so Solstice can use favorite_memory tool
    const memId = mem.id ? ` [ID: ${mem.id}]` : '';

    // Show state so Solstice knows what's already favorited/faded
    const stateTag = mem.state === 'favorite' ? ' [⭐favorite]' : mem.state === 'faded' ? ' [faded]' : '';

    // Show when this memory was created
    const age = formatAge(mem.timestamp);
    const ageTag = age ? ` (${age})` : '';

    return `${i + 1}. [${mem.category}]${ageTag}${weight}${sim}${stateTag}${memId}\n   ${speakerLabel}${mem.content}`;
  }).filter(Boolean);

  return formatted.length > 0 ? `# RELEVANT RP MEMORIES (NARRATIVE SCENES - NOT REAL LIFE)\n\n⚠️ These are past roleplay exchanges. This is fiction, not reality.\n\n${formatted.join('\n\n')}` : '';
}

//--------------------------------------------------------------
// Cross-Reference: Allow Regular Solstice to Access RP Memories
//--------------------------------------------------------------

/**
 * Detect if user message is asking about RPs
 * Triggers deeper RP memory search
 */
function detectRPQuery(text: string): boolean {
  const rpKeywords = /\b(roleplay|rp|our rp|the rp|that rp|rp scene|roleplay scene|in the rp|vampire rp|fantasy rp|rp we did|rp channel)\b/i;
  return rpKeywords.test(text);
}

/**
 * Get RP memories for regular Solstice to reference
 * ONLY triggered when RP keywords detected - no baseline awareness
 * All memories marked as NARRATIVE ROLEPLAY to maintain fiction boundary
 */
export async function getRPMemoriesForRegularMode(
  queryText: string
): Promise<string> {
  // Detect if this is an RP-focused query
  const isRPQuery = detectRPQuery(queryText);

  // ONLY retrieve RP memories if RP keywords detected
  if (!isRPQuery) {
    return ''; // Skip RP memory retrieval entirely
  }

  const limit = parseInt(process.env.MAX_RP_CROSSREF || '20'); // Configurable cross-reference limit

  logger.debug(`🔗 [CROSS-REF] Regular Solstice accessing RP memories (RP keywords detected: ${limit} max)`);

  const queryEmbedding = await getEmbedding(queryText);

  let memories: ArchivalMemory[] = [];

  if (await checkDbAvailable()) {
    try {
      // Search across ALL RP channels (no channel filter)
      // But still tag them by channel so we know which RP they're from
      memories = await query<ArchivalMemory>(`
        SELECT
          id,
          content,
          category,
          importance,
          message_weight as "messageWeight",
          timestamp,
          tags,
          metadata,
          1 - (embedding <=> $1::vector) as similarity
        FROM rp_archival_memories
        WHERE message_weight >= 1.5
          AND (state IS NULL OR state NOT IN ('forgotten'))
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `, [
        JSON.stringify(queryEmbedding),
        limit
      ]);

      // Boost relevance for retrieved memories (async, don't await)
      for (const memory of memories) {
        if (memory.id) {
          boostMemoryRelevance(memory.id).catch(() => {}); // Fire and forget
        }
      }
    } catch (error) {
      logger.warn('❌ [RPRetrieval] Cross-ref search query failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  if (!dbAvailable) {
    try {
      const data = await fs.readFile(RP_ARCHIVAL_FILE, 'utf-8');
      const allMemories = JSON.parse(data);

      memories = allMemories
        .map((mem: any) => ({
          ...mem,
          similarity: cosineSimilarity(queryEmbedding, mem.embedding)
        }))
        .filter((mem: any) => mem.messageWeight >= 1.5)
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch {
      return ''; // No RP memories available
    }
  }

  if (memories.length === 0) {
    return '';
  }

  logger.debug(`🔗 [CROSS-REF] Found ${memories.length} RP memories for regular Solstice`);

  // Format with clear fiction markers
  const formatted = memories.map((mem, i) => {
    const msgWeight = mem.messageWeight ? Number(mem.messageWeight) : null;
    const weight = msgWeight && !isNaN(msgWeight) ? ` (weight: ${msgWeight.toFixed(1)})` : '';
    const simValue = mem.similarity !== undefined ? Number(mem.similarity) : null;
    const sim = simValue !== null && !isNaN(simValue) ? ` (relevance: ${(simValue * 100).toFixed(0)}%)` : '';

    // Extract channel ID from tags to identify which RP this is from
    const channelTag = mem.tags?.find((tag: string) => tag.startsWith('channel_')) || 'unknown';
    const channelLabel = channelTag !== 'unknown' ? ` [Channel: ${channelTag}]` : '';

    const role = mem.tags && mem.tags.length > 0 ? mem.tags[0] : null;
    const speaker = role === 'user' ? getUserName() : role === 'assistant' ? getAIName() : null;
    const speakerLabel = speaker ? `${speaker} (in RP scene): ` : '';

    const age = formatAge(mem.timestamp);
    const ageTag = age ? ` (${age})` : '';

    return `${i + 1}. [FICTION - RP Scene]${ageTag}${channelLabel}${weight}${sim}\n   ${speakerLabel}${mem.content}`;
  }).filter(Boolean);

  return formatted.length > 0
    ? `# RP MEMORIES (NARRATIVE ROLEPLAY - FICTION, NOT REALITY)\n\n⚠️ **CRITICAL**: These are ROLEPLAY scenes - fictional narratives, NOT real conversations.\nWhen discussing these with ${getUserName()}, always make it clear they're RP/fiction.\nExamples: "In our vampire RP scene...", "That roleplay where...", "When we were RPing..."\n\n${formatted.join('\n\n')}`
    : '';
}
