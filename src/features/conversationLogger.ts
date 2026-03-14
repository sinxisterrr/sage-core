// FILE: src/features/conversationLogger.ts
//--------------------------------------------------------------
// Conversation Logging & Analytics
// Tracks messages, API usage, and generates insights
//--------------------------------------------------------------

import { Message } from "discord.js";
import { logger } from "../utils/logger.js";
import { query } from "../db/db.js";
import fs from "fs/promises";
import path from "path";

const ANALYTICS_ENABLED = process.env.ANALYTICS_ENABLED === "true";
const LOGS_DIR = path.join(process.cwd(), "logs");

//--------------------------------------------------------------
// Analytics Data Structure
//--------------------------------------------------------------

interface ConversationStats {
  totalMessages: number;
  userMessages: number;
  botMessages: number;
  averageResponseTime: number;
  activeUsers: Set<string>;
  messagesByHour: Record<string, number>;
}

let dailyStats: ConversationStats = {
  totalMessages: 0,
  userMessages: 0,
  botMessages: 0,
  averageResponseTime: 0,
  activeUsers: new Set(),
  messagesByHour: {},
};

let responseTimestamps: Map<string, number> = new Map();

//--------------------------------------------------------------
// Initialize logging system
//--------------------------------------------------------------

export async function initConversationLogger() {
  if (!ANALYTICS_ENABLED) {
    logger.info("📊 Conversation analytics disabled");
    return;
  }

  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    logger.info("📊 Conversation logger initialized");
  } catch (error) {
    logger.error("Error initializing conversation logger:", error);
  }
}

//--------------------------------------------------------------
// Log user message
//--------------------------------------------------------------

export async function logUserMessage(
  message: Message,
  parserWeights?: Record<string, any>,
  relevanceScore?: number,
  importanceScore?: number
) {
  if (!ANALYTICS_ENABLED) return;

  try {
    dailyStats.totalMessages++;
    dailyStats.userMessages++;
    dailyStats.activeUsers.add(message.author.id);

    const hour = new Date().getHours().toString().padStart(2, "0");
    dailyStats.messagesByHour[hour] = (dailyStats.messagesByHour[hour] || 0) + 1;

    // Store timestamp for response time tracking
    responseTimestamps.set(message.id, Date.now());

    // Save to database
    await query(
      `INSERT INTO conversation_log
       (message_id, user_id, guild_id, channel_id, content_length, parser_weights, relevance_score, importance_score, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (message_id) DO NOTHING`,
      [
        message.id,
        message.author.id,
        message.guildId || null,
        message.channelId,
        message.content.length,
        parserWeights ? JSON.stringify(parserWeights) : null,
        relevanceScore || null,
        importanceScore || null,
      ]
    ).catch(() => {
      // Table might not exist yet, ignore error
    });
  } catch (error) {
    logger.error("Error logging user message:", error);
  }
}

//--------------------------------------------------------------
// Log bot response
//--------------------------------------------------------------

export async function logBotResponse(
  message: Message,
  replyToId?: string,
  parserWeights?: Record<string, any>,
  relevanceScore?: number,
  importanceScore?: number
) {
  if (!ANALYTICS_ENABLED) return;

  try {
    dailyStats.totalMessages++;
    dailyStats.botMessages++;

    // Calculate response time if we have the original message timestamp
    if (replyToId && responseTimestamps.has(replyToId)) {
      const originalTime = responseTimestamps.get(replyToId)!;
      const responseTime = Date.now() - originalTime;

      // Update running average
      const total = dailyStats.averageResponseTime * (dailyStats.botMessages - 1);
      dailyStats.averageResponseTime = (total + responseTime) / dailyStats.botMessages;

      responseTimestamps.delete(replyToId);
    }

    // Save to database
    await query(
      `INSERT INTO conversation_log
       (message_id, user_id, guild_id, channel_id, content_length, is_bot, parser_weights, relevance_score, importance_score, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (message_id) DO NOTHING`,
      [
        message.id,
        message.author.id,
        message.guildId || null,
        message.channelId,
        message.content.length,
        true,
        parserWeights ? JSON.stringify(parserWeights) : null,
        relevanceScore || null,
        importanceScore || null,
      ]
    ).catch(() => {
      // Table might not exist yet, ignore error
    });
  } catch (error) {
    logger.error("Error logging bot response:", error);
  }
}

//--------------------------------------------------------------
// Get daily stats
//--------------------------------------------------------------

export function getDailyStats(): ConversationStats {
  return {
    ...dailyStats,
    activeUsers: new Set(dailyStats.activeUsers), // Clone the set
  };
}

//--------------------------------------------------------------
// Reset daily stats (called at midnight)
//--------------------------------------------------------------

export function resetDailyStats() {
  const stats = getDailyStats();

  dailyStats = {
    totalMessages: 0,
    userMessages: 0,
    botMessages: 0,
    averageResponseTime: 0,
    activeUsers: new Set(),
    messagesByHour: {},
  };

  return stats;
}

//--------------------------------------------------------------
// Generate daily summary
//--------------------------------------------------------------

export async function generateDailySummary(): Promise<string> {
  const stats = getDailyStats();

  const summary = [
    "📊 **Daily Conversation Summary**",
    "",
    `**Total Messages:** ${stats.totalMessages}`,
    `**User Messages:** ${stats.userMessages}`,
    `**Bot Responses:** ${stats.botMessages}`,
    `**Active Users:** ${stats.activeUsers.size}`,
    `**Avg Response Time:** ${Math.round(stats.averageResponseTime)}ms`,
    "",
    "**Messages by Hour:**",
  ];

  // Sort hours and display message counts
  const hours = Object.keys(stats.messagesByHour).sort();
  for (const hour of hours.slice(0, 5)) {
    summary.push(`${hour}:00 - ${stats.messagesByHour[hour]} messages`);
  }

  return summary.join("\n");
}

//--------------------------------------------------------------
// Save daily log to file
//--------------------------------------------------------------

export async function saveDailyLog() {
  if (!ANALYTICS_ENABLED) return;

  try {
    const stats = resetDailyStats();
    const date = new Date().toISOString().split("T")[0];
    const logFile = path.join(LOGS_DIR, `conversation-${date}.json`);

    const logData = {
      date,
      stats: {
        ...stats,
        activeUsers: Array.from(stats.activeUsers),
      },
    };

    await fs.writeFile(logFile, JSON.stringify(logData, null, 2));
    logger.info(`📊 Daily log saved: ${logFile}`);
  } catch (error) {
    logger.error("Error saving daily log:", error);
  }
}

//--------------------------------------------------------------
// Get conversation history from database
//--------------------------------------------------------------

export async function getConversationHistory(
  channelId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const messages = await query(
      `SELECT message_id, user_id, content_length, is_bot, timestamp
       FROM conversation_log
       WHERE channel_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [channelId, limit]
    ).catch(() => []);

    return messages;
  } catch (error) {
    logger.error("Error fetching conversation history:", error);
    return [];
  }
}
