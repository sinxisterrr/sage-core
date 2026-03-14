//--------------------------------------------------------------
// FILE: src/utils/rpChannelDetector.ts
// Utility to detect if a channel is in the RP category
// STRICT SEPARATION: RP channels ONLY use RP memory tables
//--------------------------------------------------------------

import { Message, DMChannel, ChannelType } from "discord.js";
import { logger } from "./logger.js";

const RP_CATEGORY_ID = process.env.RP_CATEGORY_ID?.trim();

/**
 * Check if a Discord message is from a channel in the RP category
 *
 * IMPORTANT: This determines whether RP memory tables or regular memory tables are used.
 * - Channels in RP_CATEGORY_ID → use rp_* tables (RP memory system)
 * - All other channels → use regular tables (continuum memory system)
 * - DMs → ALWAYS use regular tables (NEVER RP tables)
 *
 * @param message Discord message object
 * @returns true if channel is in RP category, false otherwise (including DMs)
 */
export function isRPChannel(message: Message): boolean {
  // CRITICAL: DMs are NEVER RP channels
  if (message.channel.type === ChannelType.DM) {
    logger.debug(`🔒 DM detected - using regular memory (NOT RP)`);
    return false;
  }

  // If RP_CATEGORY_ID is not configured, no channels are RP channels
  if (!RP_CATEGORY_ID) {
    logger.debug(`⚙️  RP_CATEGORY_ID not configured - using regular memory`);
    return false;
  }

  // Check if channel has a parent (category)
  // @ts-ignore - parentId exists on GuildChannel but not all channel types
  const parentId = message.channel.parentId;

  if (!parentId) {
    logger.debug(`📁 Channel has no category - using regular memory`);
    return false;
  }

  const isRP = parentId === RP_CATEGORY_ID;

  if (isRP) {
    logger.info(`🎭 RP Channel detected (category: ${RP_CATEGORY_ID}) - using RP memory tables`);
  } else {
    logger.debug(`💬 Regular channel - using regular memory tables`);
  }

  return isRP;
}

/**
 * Get a description of which memory system will be used for this channel
 * Useful for debugging and logging
 */
export function getMemorySystemDescription(message: Message): string {
  if (message.channel.type === ChannelType.DM) {
    return "DM (regular memory - RP tables NEVER used)";
  }

  if (!RP_CATEGORY_ID) {
    return "Regular memory (RP category not configured)";
  }

  // @ts-ignore
  const parentId = message.channel.parentId;

  if (!parentId) {
    return "Regular memory (no category)";
  }

  if (parentId === RP_CATEGORY_ID) {
    return `RP memory (in RP category ${RP_CATEGORY_ID})`;
  }

  return `Regular memory (in category ${parentId})`;
}
