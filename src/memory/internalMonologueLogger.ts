//--------------------------------------------------------------
// FILE: src/memory/internalMonologueLogger.ts
// Extracts and archives internal monologue
// - Regular mode: thoughts in [brackets] (stripped from visible message)
// - RP mode: thoughts in *asterisks* (visible as italics)
//--------------------------------------------------------------

import { archiveEntries as archiveToRegular } from './continuumArchiver.js';
import { archiveEntries as archiveToRP } from './rpArchiver.js';
import type { STMEntry } from './continuumSTM.js';

/**
 * Extract internal thoughts from text
 * - RP mode: extracts *asterisks* (visible italics in Discord)
 * - Regular mode: extracts [brackets] (stripped from visible message)
 * Returns array of thought strings
 */
function extractInternalThoughts(text: string, isRPMode: boolean): string[] {
  // Different patterns for RP vs regular mode
  // RP: *asterisks* render as visible italics
  // Regular: [brackets] are stripped from visible message
  const thoughtPattern = isRPMode ? /\*([^*]+)\*/g : /\[([^\]]+)\]/g;
  const thoughts: string[] = [];
  let match;

  while ((match = thoughtPattern.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.length === 0) continue;

    // SAFETY NET for RP mode: Filter out obvious physical actions that mistakenly used asterisks
    // Not needed for bracket mode since brackets are unambiguous
    if (isRPMode) {
      const bodyParts = /\b(hand|hands|finger|fingers|thumb|lips|mouth|eyes|eye|face|arm|arms|leg|legs|body|chest|head|hair|neck|throat|skin|cheek|ear|shoulder|back|hip|waist|thigh|knee|foot|feet)\b/i;
      const actionVerbs = /\b(reach|touch|grab|pull|push|step|lean|shift|turn|move|take|hold|press|trace|brush|drag|slide|wrap|grip|hover|find|drop|lift|trail|skim)\b/i;

      // If it clearly describes a physical action (body part + action verb), skip it
      if (bodyParts.test(content) && actionVerbs.test(content)) {
        console.log(`⚠️ Filtered action mistakenly marked as thought: *${content}*`);
        continue;
      }
    }

    // Otherwise, keep it (assume it's a legitimate thought)
    thoughts.push(content);
  }

  return thoughts;
}

/**
 * Archive internal monologue from AI's response
 * Automatically routes to RP or regular memory based on isRPMode flag
 */
export async function archiveInternalMonologue(
  userId: string,
  responseText: string,
  isRPMode: boolean,
  channelId?: string
): Promise<void> {
  const thoughts = extractInternalThoughts(responseText, isRPMode);

  if (thoughts.length === 0) {
    return; // No internal thoughts to archive
  }

  // Compressed thought logging
  console.log(`💭 Archiving ${thoughts.length} thought(s): "${thoughts[0].substring(0, 30)}${thoughts[0].length > 30 ? '...' : ''}"${isRPMode ? ' [RP]' : ''}`);

  // Create STM entries for each thought
  const thoughtEntries: STMEntry[] = thoughts.map(thought => ({
    role: 'assistant' as const,
    text: `[INTERNAL THOUGHT] ${thought}`,
    timestamp: Date.now(),
    ephemeral: false, // Internal thoughts should be archived
  }));

  // Route to appropriate memory system
  if (isRPMode && channelId) {
    await archiveToRP(userId, channelId, thoughtEntries);
  } else {
    await archiveToRegular(userId, thoughtEntries);
  }
}
