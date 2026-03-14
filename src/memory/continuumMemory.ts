//--------------------------------------------------------------
// FILE: src/memory/continuumMemory.ts
// Main memory system - Simple STM + Continuum retrieval
//--------------------------------------------------------------

import {
  addToSTM as addToSTMBuffer,
  getSTM as getSTMBuffer,
  shouldArchive,
  getOldestForArchival,
  formatSTMForPrompt,
  updateSTMSize,
  getMaxSTMSize,
  STMEntry
} from './continuumSTM.js';

import { archiveEntries } from './continuumArchiver.js';
import { checkAndDistill } from './continuumDistiller.js';

import {
  getFullContext,
  formatPersonaForPrompt,
  formatHumanForPrompt,
  formatArchivalForPrompt
} from './continuumRetrieval.js';

/**
 * Add message to STM and auto-archive + distill if needed
 */
export async function addToMemory(
  userId: string,
  role: 'user' | 'assistant',
  text: string,
  ephemeral: boolean = false
): Promise<void> {
  // Add to STM
  addToSTMBuffer(userId, role, text, ephemeral);

  // Get recent STM for distillation check
  const recentSTM = getSTMBuffer(userId);

  // Filter out ephemeral messages (like heartbeats) before distilling
  const nonEphemeralSTM = recentSTM.filter(entry => !entry.ephemeral);

  // Check for distillation (every 12 messages) - only distill non-ephemeral
  await checkAndDistill(nonEphemeralSTM);

  // Archive every 10 messages to populate DB faster (but keep full context in STM)
  const stmSize = recentSTM.length;
  if (stmSize > 0 && stmSize % 10 === 0) {
    console.log(`🗄️  Archiving batch (every 10 messages) for user ${userId}... (STM size: ${stmSize})`);
    const toArchive = recentSTM.slice(-10); // Archive the most recent batch, not always the same oldest 10
    await archiveEntries(userId, toArchive);
  }

  // Also check if STM is completely full and needs emergency archival
  if (shouldArchive(userId)) {
    console.log(`⚠️  STM completely full! Emergency archival for user ${userId}...`);
    const toArchive = getOldestForArchival(userId, 50);
    await archiveEntries(userId, toArchive);
  }
}

/**
 * Get formatted memory context for prompt building (includes RP cross-reference)
 */
export async function getMemoryContext(
  userId: string,
  query: string,
  channel?: any, // Discord TextChannel (optional, for loading history on restart)
  botId?: string  // Bot ID (optional, for loading history on restart)
): Promise<{
  stm: string;
  persona: string;
  human: string;
  archival: string;
  referenceTexts: string;
  rpMemories: string; // Cross-reference RP memories
  stmEntries: STMEntry[];
}> {
  // Get STM (recent conversation)
  let stmEntries = getSTMBuffer(userId);

  // If STM is empty and we have channel access, load last 30 messages from Discord history
  if (stmEntries.length === 0 && channel && botId) {
    const { loadSTMFromChannel } = await import('./continuumSTM.js');
    await loadSTMFromChannel(channel, userId, botId);
    stmEntries = getSTMBuffer(userId);
  }

  const stm = formatSTMForPrompt(stmEntries);

  // Get LTM from continuum tables + reference texts + RP cross-reference
  const { persona: personaBlocks, human: humanBlocks, memories, referenceTexts: refTexts, rpMemories } = await getFullContext(query);

  const persona = formatPersonaForPrompt(personaBlocks);
  const human = formatHumanForPrompt(humanBlocks);
  const archival = formatArchivalForPrompt(memories);

  // Import formatting function from referenceLoader
  const { formatReferenceForPrompt } = await import('./referenceLoader.js');
  const referenceTexts = formatReferenceForPrompt(refTexts);

  // rpMemories is already formatted by getRPMemoriesForRegularMode
  return { stm, persona, human, archival, referenceTexts, rpMemories, stmEntries };
}

/**
 * Build full system prompt with all memory context
 */
export async function buildMemoryPrompt(userId: string, query: string): Promise<string> {
  const { stm, persona, human, archival, referenceTexts } = await getMemoryContext(userId, query);

  const sections = [];

  if (persona) sections.push(persona);
  if (human) sections.push(human);
  if (archival) sections.push(archival);
  if (referenceTexts) sections.push(referenceTexts);

  const longTermMemory = sections.join('\n\n---\n\n');

  return `${longTermMemory}\n\n---\n\n# RECENT CONVERSATION\n\n${stm}`;
}

/**
 * Recalculate STM size based on current CONTEXT_LENGTH env var
 */
export function recalculateSTMSize() {
  updateSTMSize();
}

/**
 * Get current STM capacity
 */
export function getSTMCapacity(): number {
  return getMaxSTMSize();
}

/**
 * Initialize the continuum memory system
 */
export async function initContinuumMemory(): Promise<void> {
  // Calculate initial STM size based on env vars
  updateSTMSize();
}

// Export sub-modules for direct access if needed
export * from './continuumSTM.js';
export * from './continuumRetrieval.js';
