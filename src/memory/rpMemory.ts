//--------------------------------------------------------------
// FILE: src/memory/rpMemory.ts
// RP Memory System - Separate memory for roleplay channels
// HARD-CODED: All RP memories are marked as NARRATIVE ROLEPLAY
// CRITICAL: This system should ONLY be used for channels in RP_CATEGORY_ID
//--------------------------------------------------------------

import {
  addToSTM as addToRPSTMBuffer,
  getSTM as getRPSTMBuffer,
  shouldArchive as shouldArchiveRP,
  getOldestForArchival as getOldestForArchivalRP,
  formatSTMForPrompt as formatRPSTMForPrompt,
  updateSTMSize as updateRPSTMSize,
  getMaxSTMSize as getMaxRPSTMSize,
  STMEntry
} from './rpSTM.js';

import { archiveEntries as archiveRPEntries } from './rpArchiver.js';
import { checkAndDistill as checkAndDistillRP } from './rpDistiller.js';

import {
  getFullContext as getRPFullContext,
  formatPersonaForPrompt as formatRPPersonaForPrompt,
  formatHumanForPrompt as formatRPHumanForPrompt,
  formatArchivalForPrompt as formatRPArchivalForPrompt
} from './rpRetrieval.js';

import {
  searchReferenceTexts,
  formatReferenceForPrompt
} from './referenceLoader.js';

/**
 * SAFETY CHECK: Warn if RP memory is used without RP_CATEGORY_ID configured
 * This helps catch misuse of the RP memory system
 */
function validateRPMemoryUsage(callerFunction: string): void {
  const RP_CATEGORY_ID = process.env.RP_CATEGORY_ID?.trim();

  if (!RP_CATEGORY_ID) {
    console.warn(`⚠️  [RP MEMORY WARNING] ${callerFunction} called but RP_CATEGORY_ID is not configured!`);
    console.warn(`   This should only happen if you're intentionally using RP memory without channel detection.`);
  }
}

/**
 * Add message to RP STM and auto-archive + distill if needed
 * CRITICAL: Only call this for messages from channels in RP_CATEGORY_ID
 */
export async function addToRPMemory(
  userId: string,
  channelId: string,
  role: 'user' | 'assistant',
  text: string
): Promise<void> {
  validateRPMemoryUsage('addToRPMemory');

  // Add to RP STM (now with channelId for per-channel separation)
  addToRPSTMBuffer(userId, channelId, role, text);

  // Get recent STM for distillation check
  const recentSTM = getRPSTMBuffer(userId, channelId);

  // Check for distillation (every 12 messages)
  await checkAndDistillRP(userId, channelId, recentSTM);

  // Archive every 10 messages to populate DB faster (but keep full context in STM)
  const stmSize = recentSTM.length;
  if (stmSize > 0 && stmSize % 10 === 0) {
    console.log(`🎭 [RP] Archiving batch (every 10 messages) for user ${userId} in channel ${channelId}... (STM size: ${stmSize})`);
    const toArchive = getOldestForArchivalRP(userId, channelId, 10);
    await archiveRPEntries(userId, channelId, toArchive);
  }

  // Also check if STM is completely full and needs emergency archival
  if (shouldArchiveRP(userId, channelId)) {
    console.log(`⚠️  [RP] STM completely full! Emergency archival for user ${userId} in channel ${channelId}...`);
    const toArchive = getOldestForArchivalRP(userId, channelId, 50);
    await archiveRPEntries(userId, channelId, toArchive);
  }
}

/**
 * Get formatted RP memory context for prompt building
 * HARD-CODED: All memories are marked as NARRATIVE ROLEPLAY
 * CRITICAL: Only call this for messages from channels in RP_CATEGORY_ID
 */
export async function getRPMemoryContext(
  userId: string,
  channelId: string,
  query: string,
  channel?: any, // Discord TextChannel (optional, for loading history on restart)
  botId?: string  // Bot ID (optional, for loading history on restart)
): Promise<{
  stm: string;
  persona: string;
  human: string;
  archival: string;
  referenceTexts: string;
  stmEntries: STMEntry[];
}> {
  validateRPMemoryUsage('getRPMemoryContext');
  // Get RP STM (recent conversation) - now separated by channel
  let stmEntries = getRPSTMBuffer(userId, channelId);

  // If STM is empty and we have channel access, load last 30 messages from Discord history
  if (stmEntries.length === 0 && channel && botId) {
    const { loadSTMFromChannel } = await import('./rpSTM.js');
    await loadSTMFromChannel(channel, userId, channelId, botId);
    stmEntries = getRPSTMBuffer(userId, channelId);
  }

  const stm = formatRPSTMForPrompt(stmEntries);

  // Get LTM from RP continuum tables (filtered by channelId)
  const { persona: personaBlocks, human: humanBlocks, memories } = await getRPFullContext(query, channelId, userId);

  const persona = formatRPPersonaForPrompt(personaBlocks);
  const human = formatRPHumanForPrompt(humanBlocks);
  const archival = formatRPArchivalForPrompt(memories);

  // Selective reference texts for RP - only whitelisted files
  // Whitelist configured via RP_REFERENCE_WHITELIST env var (comma-separated filenames)
  let referenceTexts = '';

  const whitelist = process.env.RP_REFERENCE_WHITELIST?.split(',').map(f => f.trim()) || [];

  if (whitelist.length > 0) {
    // Search each whitelisted file and combine results
    const allResults = [];
    for (const filename of whitelist) {
      const results = await searchReferenceTexts(query, 5, filename);
      allResults.push(...results);
    }

    // Sort by similarity and take top results
    const topResults = allResults
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, 10);

    referenceTexts = formatReferenceForPrompt(topResults);
  }

  return { stm, persona, human, archival, referenceTexts, stmEntries };
}

/**
 * Build full system prompt with all RP memory context
 * HARD-CODED: Marked as NARRATIVE ROLEPLAY
 */
export async function buildRPMemoryPrompt(userId: string, channelId: string, query: string): Promise<string> {
  const { stm, persona, human, archival } = await getRPMemoryContext(userId, channelId, query);

  const sections = [];

  if (persona) sections.push(persona);
  if (human) sections.push(human);
  if (archival) sections.push(archival);
  // Note: referenceTexts intentionally omitted from RP

  const longTermMemory = sections.join('\n\n---\n\n');

  return `${longTermMemory}\n\n---\n\n# RECENT CONVERSATION (ROLEPLAY)\n\n${stm}`;
}

/**
 * Recalculate RP STM size based on current CONTEXT_LENGTH env var
 */
export function recalculateRPSTMSize() {
  updateRPSTMSize();
}

/**
 * Get current RP STM capacity
 */
export function getRPSTMCapacity(): number {
  return getMaxRPSTMSize();
}

/**
 * Initialize the RP continuum memory system
 */
export async function initRPContinuumMemory(): Promise<void> {
  // Calculate initial STM size based on env vars
  updateRPSTMSize();
}

// Export sub-modules for direct access if needed
export * from './rpSTM.js';
export * from './rpRetrieval.js';
