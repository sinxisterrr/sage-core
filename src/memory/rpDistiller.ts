//--------------------------------------------------------------
// FILE: src/memory/rpDistiller.ts
// Every 12 RP messages, distill into rp_persona/rp_human blocks
// Identical to continuumDistiller but uses rp_ tables
//--------------------------------------------------------------

import { query } from '../db/db.js';
import type { STMEntry } from './rpSTM.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../utils/configValidator.js';
import { getEmbedding } from '../utils/embedding.js';
import { getUserName, getAIName } from '../utils/pronouns.js';
import { generateModelOutput } from '../model/Llm.js';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const RP_PERSONA_FILE = path.join(DATA_DIR, 'rp_persona_blocks.json');
const RP_HUMAN_FILE = path.join(DATA_DIR, 'rp_human_blocks.json');

let dbAvailable = true;
let lastDbCheck = 0;
const DB_RECHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if database is available, with periodic retry logic.
 */
async function checkDbAvailable(): Promise<boolean> {
  const now = Date.now();
  if (!dbAvailable && now - lastDbCheck < DB_RECHECK_INTERVAL) {
    return false;
  }
  lastDbCheck = now;
  try {
    await query('SELECT 1');
    if (!dbAvailable) {
      logger.info('✅ [RP Distiller] Database connection restored');
    }
    dbAvailable = true;
    return true;
  } catch {
    if (dbAvailable) {
      logger.error('❌ [RP Distiller] Database connection lost, falling back to JSON');
    }
    dbAvailable = false;
    return false;
  }
}

// Per-user-channel message counters for RP distillation timing
const rpMessageCounters = new Map<string, number>();

/** Get distillation interval from config (defaults to 12) */
function getDistillInterval(): number {
  return getConfig().DISTILL_INTERVAL;
}

/** Check if AI distillation is enabled */
function isAIDistillationEnabled(): boolean {
  return process.env.AI_DISTILLATION_ENABLED === 'true';
}

/** AI evaluation result for distillation */
interface AIDistillationResult {
  shouldDistill: boolean;
  miraType: 'rp_identity' | 'rp_memory' | 'rp_relationship' | 'rp_agent' | 'rp_unknown';
  importance: number; // 1-10
  summary?: string;
  reasoning?: string;
}

/**
 * AI-driven evaluation for RP memory distillation
 * Uses low temperature (0.3) for consistent decisions
 */
async function aiEvaluateForDistillation(
  texts: string[],
  role: 'user' | 'assistant'
): Promise<AIDistillationResult | null> {
  try {
    const roleLabel = role === 'assistant' ? `${getAIName()} (AI assistant)` : `${getUserName()} (human user)`;
    const combined = texts.join('\n---\n');

    const systemPrompt = `You are a memory distillation evaluator for an AI roleplay system.
Your job is to analyze RP conversation messages and decide if they should be stored as long-term memories.

MIRA Types (RP-specific):
- rp_identity: Character identity, traits, personality, self-concept in roleplay
- rp_memory: Events and experiences within the roleplay narrative
- rp_relationship: Bonds and dynamics between characters in the story
- rp_agent: Character preferences, habits, intentions, plans within roleplay

Importance Scale (1-10):
- 1-3: Mundane RP exchanges, forgettable
- 4-6: Moderately interesting, some narrative value
- 7-8: Significant character development, emotionally meaningful
- 9-10: Critical story moments, deeply character-defining

Respond ONLY with valid JSON in this exact format:
{
  "shouldDistill": true/false,
  "miraType": "rp_identity|rp_memory|rp_relationship|rp_agent|rp_unknown",
  "importance": 1-10,
  "summary": "optional brief summary if distilling",
  "reasoning": "brief explanation of your decision"
}`;

    const userPrompt = `Evaluate these RP messages from ${roleLabel}:

${combined}

Should these messages be distilled into long-term RP memory? What type and importance?`;

    const response = await generateModelOutput({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3, // Low temperature for consistent decisions
      maxTokens: 300
    });

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('[RP] AI distillation returned non-JSON response');
      return null;
    }

    const result = JSON.parse(jsonMatch[0]) as AIDistillationResult;

    // Validate result
    if (typeof result.shouldDistill !== 'boolean' ||
        !['rp_identity', 'rp_memory', 'rp_relationship', 'rp_agent', 'rp_unknown'].includes(result.miraType) ||
        typeof result.importance !== 'number' ||
        result.importance < 1 || result.importance > 10) {
      logger.warn('[RP] AI distillation returned invalid structure');
      return null;
    }

    logger.debug(`[RP] AI distillation evaluation: type=${result.miraType}, importance=${result.importance}, shouldDistill=${result.shouldDistill}`);
    return result;

  } catch (error: any) {
    logger.warn(`[RP] AI distillation evaluation failed: ${error.message}`);
    return null;
  }
}

/**
 * Generate stable content hash for deduplication
 * Strips date/time references before hashing
 */
function generateContentHash(text: string): string {
  // Remove common date/time patterns
  const normalized = text
    .replace(/\d{4}-\d{2}-\d{2}/g, '') // YYYY-MM-DD
    .replace(/\d{1,2}:\d{2}(:\d{2})?( ?[AP]M)?/gi, '') // HH:MM(:SS) (AM/PM)
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, '')
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim()
    .toLowerCase();

  return createHash('sha256').update(normalized).digest('hex');
}

function classifyMIRA(texts: string[], role: 'user' | 'assistant'): string {
  const combined = texts.join(' ').toLowerCase();

  if (role === 'assistant') {
    if (/\b(i am|i'm|who i am|my identity|i feel)\b/i.test(combined)) return 'rp_identity';
    if (/\b(i remember|i recall|memory|happened|was)\b/i.test(combined)) return 'rp_memory';
    if (/\b(we|us|our|you and i|between us)\b/i.test(combined)) return 'rp_relationship';
    if (/\b(i will|i can|i'll|going to|planning)\b/i.test(combined)) return 'rp_agent';
  } else {
    if (/\b(i am|i'm|who i am|my|me)\b/i.test(combined)) return 'rp_identity';
    if (/\b(remember|recall|when|happened)\b/i.test(combined)) return 'rp_memory';
    if (/\b(we|us|our|you and i)\b/i.test(combined)) return 'rp_relationship';
  }

  return 'rp_unknown';
}

function calculateAverageWeight(entries: STMEntry[]): number {
  const weights = entries.map(entry => {
    let weight = 1.0;
    const text = entry.text.toLowerCase();

    if (entry.text.length > 500) weight += 0.5;
    if (entry.text.length > 1000) weight += 0.5;

    const emotionalPatterns = /\b(feel|love|hate|afraid|happy|sad|worried|excited)\b/gi;
    const matches = text.match(emotionalPatterns);
    if (matches) weight += Math.min(1.0, matches.length * 0.3);

    return weight;
  });

  return weights.reduce((sum, w) => sum + w, 0) / weights.length;
}

async function savePersonaBlock(block: {
  id: string;
  label: string;
  content: string;
  miraType: string;
  averageWeight: number;
  messageCount: number;
  embedding: number[];
  channelId: string;
}): Promise<void> {
  const id = block.id;

  if (await checkDbAvailable()) {
    try {
      await query(`
        INSERT INTO rp_persona_blocks
        (id, label, content, mira_type, average_weight, min_weight, max_weight, message_count, embedding, channel_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          -- Use exponential moving average: 70% old + 30% new
          average_weight = (rp_persona_blocks.average_weight * 0.7 + EXCLUDED.average_weight * 0.3),
          min_weight = LEAST(rp_persona_blocks.min_weight, EXCLUDED.min_weight),
          max_weight = GREATEST(rp_persona_blocks.max_weight, EXCLUDED.max_weight),
          message_count = rp_persona_blocks.message_count + EXCLUDED.message_count,
          embedding = EXCLUDED.embedding
      `, [
        id,
        block.label,
        block.content,
        block.miraType,
        block.averageWeight,
        block.averageWeight - 0.5,
        block.averageWeight + 0.5,
        block.messageCount,
        JSON.stringify(block.embedding),
        block.channelId
      ]);
      logger.info(`✅ [RP] Saved/updated persona block (channel: ${block.channelId}): ${block.label} (weight: ${block.averageWeight.toFixed(2)})`);
      return;
    } catch (error) {
      logger.error('[RP] DB save failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let existing: any[] = [];
    try {
      const data = await fs.readFile(RP_PERSONA_FILE, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    existing.push(block);
    await fs.writeFile(RP_PERSONA_FILE, JSON.stringify(existing, null, 2));
    logger.info(`✅ [RP] Saved persona block to JSON: ${block.label}`);
  } catch (error) {
    logger.error('[RP] Failed to save persona block:', error);
  }
}

async function saveHumanBlock(block: {
  id: string;
  label: string;
  content: string;
  miraType: string;
  averageWeight: number;
  messageCount: number;
  embedding: number[];
  channelId: string;
}): Promise<void> {
  const id = block.id;

  if (await checkDbAvailable()) {
    try {
      await query(`
        INSERT INTO rp_human_blocks
        (id, label, content, mira_type, average_weight, min_weight, max_weight, message_count, embedding, channel_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          -- Use exponential moving average: 70% old + 30% new
          average_weight = (rp_human_blocks.average_weight * 0.7 + EXCLUDED.average_weight * 0.3),
          min_weight = LEAST(rp_human_blocks.min_weight, EXCLUDED.min_weight),
          max_weight = GREATEST(rp_human_blocks.max_weight, EXCLUDED.max_weight),
          message_count = rp_human_blocks.message_count + EXCLUDED.message_count,
          embedding = EXCLUDED.embedding
      `, [
        id,
        block.label,
        block.content,
        block.miraType,
        block.averageWeight,
        block.averageWeight - 0.5,
        block.averageWeight + 0.5,
        block.messageCount,
        JSON.stringify(block.embedding),
        block.channelId
      ]);
      logger.info(`✅ [RP] Saved/updated human block (channel: ${block.channelId}): ${block.label} (weight: ${block.averageWeight.toFixed(2)})`);
      return;
    } catch (error) {
      logger.error('[RP] DB save failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let existing: any[] = [];
    try {
      const data = await fs.readFile(RP_HUMAN_FILE, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    existing.push(block);
    await fs.writeFile(RP_HUMAN_FILE, JSON.stringify(existing, null, 2));
    logger.info(`✅ [RP] Saved human block to JSON: ${block.label}`);
  } catch (error) {
    logger.error('[RP] Failed to save human block:', error);
  }
}

/**
 * Check if it's time to distill RP messages
 * Now processes only the last batch of messages, not entire STM
 */
export async function checkAndDistill(userId: string, channelId: string, recentMessages: STMEntry[]): Promise<void> {
  // Get or initialize counter for this user-channel combination
  const counterKey = `${userId}:${channelId}`;
  const currentCount = rpMessageCounters.get(counterKey) || 0;
  rpMessageCounters.set(counterKey, currentCount + 1);

  const distillInterval = getDistillInterval();

  if (currentCount + 1 < distillInterval) {
    return;
  }

  logger.info(`🔄 [RP] Distilling blocks from last ${distillInterval} messages for user ${userId} in channel ${channelId}...`);
  rpMessageCounters.set(counterKey, 0);

  // Process only the last N messages (batch distillation)
  const batch = recentMessages.slice(-distillInterval);

  const assistantMessages = batch.filter(m => m.role === 'assistant');
  const userMessages = batch.filter(m => m.role === 'user');

  const useAI = isAIDistillationEnabled();

  // Distill persona block (assistant messages)
  if (assistantMessages.length > 0) {
    try {
      const texts = assistantMessages.map(m => m.text);
      const combined = texts.join('\n\n');

      // Try AI evaluation first if enabled
      let miraType: string;
      let averageWeight: number;
      let shouldDistill = true;

      if (useAI) {
        const aiResult = await aiEvaluateForDistillation(texts, 'assistant');
        if (aiResult) {
          shouldDistill = aiResult.shouldDistill;
          miraType = aiResult.miraType;
          // Convert importance (1-10) to weight (1-5)
          averageWeight = Math.max(1, Math.min(5, aiResult.importance / 2));
          logger.info(`🤖 [RP] AI distillation (persona): type=${miraType}, importance=${aiResult.importance}, distill=${shouldDistill}`);
        } else {
          // Fallback to rule-based
          miraType = classifyMIRA(texts, 'assistant');
          averageWeight = calculateAverageWeight(assistantMessages);
          logger.debug('[RP] Falling back to rule-based distillation for persona');
        }
      } else {
        // Rule-based distillation
        miraType = classifyMIRA(texts, 'assistant');
        averageWeight = calculateAverageWeight(assistantMessages);
      }

      // Skip if AI decided not to distill
      if (!shouldDistill) {
        logger.debug('[RP] AI decided to skip persona distillation');
      } else {
        // Generate content hash for deduplication
        const contentHash = generateContentHash(combined);
        const id = `rp_persona_${contentHash}`;

        const embedding = await getEmbedding(combined);

        await savePersonaBlock({
          id,
          label: `${miraType}_${Date.now()}`,
          content: combined,
          miraType,
          averageWeight,
          messageCount: assistantMessages.length,
          embedding,
          channelId
        });
      }
    } catch (error: any) {
      logger.error(`❌ [RP] Failed to distill persona block (${assistantMessages.length} messages):`, error.message);
    }
  }

  // Distill human block (user messages)
  if (userMessages.length > 0) {
    try {
      const texts = userMessages.map(m => m.text);
      const combined = texts.join('\n\n');

      // Try AI evaluation first if enabled
      let miraType: string;
      let averageWeight: number;
      let shouldDistill = true;

      if (useAI) {
        const aiResult = await aiEvaluateForDistillation(texts, 'user');
        if (aiResult) {
          shouldDistill = aiResult.shouldDistill;
          miraType = aiResult.miraType;
          // Convert importance (1-10) to weight (1-5)
          averageWeight = Math.max(1, Math.min(5, aiResult.importance / 2));
          logger.info(`🤖 [RP] AI distillation (human): type=${miraType}, importance=${aiResult.importance}, distill=${shouldDistill}`);
        } else {
          // Fallback to rule-based
          miraType = classifyMIRA(texts, 'user');
          averageWeight = calculateAverageWeight(userMessages);
          logger.debug('[RP] Falling back to rule-based distillation for human');
        }
      } else {
        // Rule-based distillation
        miraType = classifyMIRA(texts, 'user');
        averageWeight = calculateAverageWeight(userMessages);
      }

      // Skip if AI decided not to distill
      if (!shouldDistill) {
        logger.debug('[RP] AI decided to skip human distillation');
      } else {
        // Generate content hash for deduplication
        const contentHash = generateContentHash(combined);
        const id = `rp_human_${contentHash}`;

        const embedding = await getEmbedding(combined);

        await saveHumanBlock({
          id,
          label: `${miraType}_${Date.now()}`,
          content: combined,
          miraType,
          averageWeight,
          messageCount: userMessages.length,
          embedding,
          channelId
        });
      }
    } catch (error: any) {
      logger.error(`❌ [RP] Failed to distill human block (${userMessages.length} messages):`, error.message);
    }
  }
}
