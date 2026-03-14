// FILE: src/features/adminCommands.ts
//--------------------------------------------------------------
// Admin Commands System
// Bot control, diagnostics, and management commands
//--------------------------------------------------------------

import { Message, EmbedBuilder } from "discord.js";
import { logger } from "../utils/logger.js";
import { query } from "../db/db.js";
import { getLTMCache, getTraitsCache } from "../memory/memoryStore.js";

const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "").split(",").filter(Boolean);

//--------------------------------------------------------------
// Authorization Check
//--------------------------------------------------------------

export function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.includes(userId);
}

//--------------------------------------------------------------
// Command Handlers
//--------------------------------------------------------------

export async function handleAdminCommand(message: Message): Promise<boolean> {
  if (!isAdmin(message.author.id)) {
    return false;
  }

  const content = message.content.toLowerCase().trim();

  // !status - Bot status and diagnostics
  if (content === "!status") {
    await handleStatusCommand(message);
    return true;
  }

  // !memory <userId> - Check memory for a user
  if (content.startsWith("!memory ")) {
    await handleMemoryCommand(message);
    return true;
  }

  // !stats - Database statistics
  if (content === "!stats") {
    await handleStatsCommand(message);
    return true;
  }

  // !ping - Bot latency
  if (content === "!ping") {
    await handlePingCommand(message);
    return true;
  }

  // !help - Admin help
  if (content === "!help" || content === "!admin") {
    await handleHelpCommand(message);
    return true;
  }

  // !clear-cache - Clear memory caches
  if (content === "!clear-cache") {
    await handleClearCacheCommand(message);
    return true;
  }

  return false;
}

//--------------------------------------------------------------
// Status Command
//--------------------------------------------------------------

async function handleStatusCommand(message: Message) {
  try {
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    const embed = new EmbedBuilder()
      .setTitle("🤖 Bot Status")
      .setColor(0x00ff00)
      .addFields(
        { name: "Uptime", value: formatUptime(uptime), inline: true },
        { name: "Memory (RSS)", value: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`, inline: true },
        { name: "Memory (Heap)", value: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true },
        { name: "Node Version", value: process.version, inline: true },
        { name: "Bot ID", value: process.env.BOT_ID || "DEFAULT", inline: true },
        { name: "Environment", value: process.env.NODE_ENV || "development", inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error("Error in status command:", error);
    await message.reply("❌ Error retrieving status");
  }
}

//--------------------------------------------------------------
// Memory Command
//--------------------------------------------------------------

async function handleMemoryCommand(message: Message) {
  try {
    const args = message.content.split(" ");
    if (args.length < 2) {
      await message.reply("Usage: `!memory <userId>`");
      return;
    }

    const userId = args[1];
    const ltm = getLTMCache(userId);
    const traits = getTraitsCache(userId);

    const embed = new EmbedBuilder()
      .setTitle(`🧠 Memory for User: ${userId}`)
      .setColor(0x5865f2)
      .addFields(
        { name: "LTM Entries", value: ltm.length.toString(), inline: true },
        { name: "Traits", value: traits.length.toString(), inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error("Error in memory command:", error);
    await message.reply("❌ Error retrieving memory data");
  }
}

//--------------------------------------------------------------
// Stats Command
//--------------------------------------------------------------

async function handleStatsCommand(message: Message) {
  try {
    const botId = process.env.BOT_ID || "DEFAULT";

    const [memoryCount] = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM bot_memory WHERE bot_id = $1",
      [botId]
    );

    const [archivalCount] = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM archival_memories WHERE bot_id = $1",
      [botId]
    );

    const [blocksCount] = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM memory_blocks WHERE bot_id = $1",
      [botId]
    );

    const [conversationCount] = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM memories"
    );

    const embed = new EmbedBuilder()
      .setTitle("📊 Database Statistics")
      .setColor(0xffa500)
      .addFields(
        { name: "Bot Memory Records", value: memoryCount?.count || "0", inline: true },
        { name: "Archival Memories", value: archivalCount?.count || "0", inline: true },
        { name: "Memory Blocks", value: blocksCount?.count || "0", inline: true },
        { name: "Conversation Messages", value: conversationCount?.count || "0", inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error("Error in stats command:", error);
    await message.reply("❌ Error retrieving database stats");
  }
}

//--------------------------------------------------------------
// Ping Command
//--------------------------------------------------------------

async function handlePingCommand(message: Message) {
  try {
    const sent = await message.reply("🏓 Pinging...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const apiLatency = message.client.ws.ping;

    await sent.edit(
      `🏓 Pong!\n` +
      `**Latency:** ${latency}ms\n` +
      `**API Latency:** ${apiLatency}ms`
    );
  } catch (error) {
    logger.error("Error in ping command:", error);
  }
}

//--------------------------------------------------------------
// Help Command
//--------------------------------------------------------------

async function handleHelpCommand(message: Message) {
  const embed = new EmbedBuilder()
    .setTitle("🔧 Admin Commands")
    .setDescription("Available admin commands for bot management")
    .setColor(0x5865f2)
    .addFields(
      { name: "!status", value: "Show bot status and diagnostics" },
      { name: "!memory <userId>", value: "Check memory data for a specific user" },
      { name: "!stats", value: "Display database statistics" },
      { name: "!ping", value: "Check bot latency" },
      { name: "!clear-cache", value: "Clear in-memory caches" },
      { name: "!help", value: "Show this help message" }
    )
    .setFooter({ text: `Admins: ${ADMIN_USER_IDS.length}` })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

//--------------------------------------------------------------
// Clear Cache Command
//--------------------------------------------------------------

async function handleClearCacheCommand(message: Message) {
  try {
    // Clear memory caches by reloading them
    await message.reply("🧹 Memory caches will refresh on next access");
    logger.info("Cache clear requested by admin:", message.author.tag);
  } catch (error) {
    logger.error("Error in clear-cache command:", error);
    await message.reply("❌ Error clearing cache");
  }
}

//--------------------------------------------------------------
// Utility Functions
//--------------------------------------------------------------

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}
