// FILE: src/features/autonomous/AutonomousSystem.ts
//--------------------------------------------------------------
// Autonomous Behavior System with Loop Prevention
// Prevents bot-to-bot ping-pong and self-spam
//--------------------------------------------------------------

import { Message } from "discord.js";
import { logger } from "../../utils/logger.js";
import { internalState } from "../../core/brain.js";

//--------------------------------------------------------------
// CONFIGURATION
//--------------------------------------------------------------

const BOT_PINGPONG_MAX = parseInt(process.env.BOT_PINGPONG_MAX || "1");
const BOT_LOOP_COOLDOWN_MS = parseInt(process.env.BOT_LOOP_COOLDOWN_MS || "60000");
const MAX_CONSECUTIVE_SELF_MESSAGES = parseInt(process.env.MAX_CONSECUTIVE_SELF_MESSAGES || "3");
const MAX_BOT_RESPONSES_PER_HUMAN = parseInt(process.env.MAX_BOT_RESPONSES_PER_HUMAN || "2"); // How many times each bot can respond per human message
const REQUIRE_HUMAN_WHITELIST = (process.env.REQUIRE_HUMAN_WHITELIST || "").split(",").filter(Boolean);

//--------------------------------------------------------------
// CONVERSATION TRACKING
//--------------------------------------------------------------

interface ConversationMessage {
  authorId: string;
  authorUsername: string;
  content: string;
  timestamp: number;
  isBot: boolean;
}

interface ChannelConversation {
  messages: ConversationMessage[];
  botToBotCounter: number;
  consecutiveSelfMessages: number;
  cooldownUntil: number;
  lastBotId?: string;
  botResponsesSinceHuman: Map<string, number>; // Track HOW MANY TIMES each bot has responded
}

//--------------------------------------------------------------
// AUTONOMOUS SYSTEM
//--------------------------------------------------------------

export class AutonomousSystem {
  private enabled: boolean;
  private conversations: Map<string, ChannelConversation> = new Map();
  private botId: string;
  private allowedDmUserId?: string;

  constructor(botId: string) {
    this.enabled = process.env.ENABLE_AUTONOMOUS === "true";
    this.botId = botId;
    this.allowedDmUserId = process.env.ALLOWED_DM_USER_ID;

    logger.info(`🤖 Autonomous system ${this.enabled ? "enabled" : "disabled"}`);
    logger.info(`🤖 RESPOND_TO_BOTS: ${process.env.RESPOND_TO_BOTS || "not set"}`);
    logger.info(`🤖 RESPOND_TO_GENERIC: ${process.env.RESPOND_TO_GENERIC || "not set"}`);

    if (this.allowedDmUserId) {
      logger.info(`🤖 DM whitelist: ${this.allowedDmUserId}`);
    }

    // Log temperature control state on startup
    const allowTempOverride = process.env.ALLOW_TEMPERATURE_OVERRIDE !== 'false';
    const tempMode = internalState.temperatureOverride !== null ? `manual (${internalState.temperatureOverride})` : `automatic (${internalState.cognitiveTemperature})`;
    logger.info(`🌡️ Temperature control: ${allowTempOverride ? 'enabled' : 'disabled'} | Current: ${tempMode}`);
  }

  //--------------------------------------------------------------
  // TRACK MESSAGE
  //--------------------------------------------------------------

  trackMessage(message: Message): void {
    const channelId = message.channelId;
    let conv = this.conversations.get(channelId);

    if (!conv) {
      conv = {
        messages: [],
        botToBotCounter: 0,
        consecutiveSelfMessages: 0,
        cooldownUntil: 0,
        lastBotId: undefined,
        botResponsesSinceHuman: new Map<string, number>()
      };
      this.conversations.set(channelId, conv);
    }

    // Add message to history
    conv.messages.push({
      authorId: message.author.id,
      authorUsername: message.author.username,
      content: message.content,
      timestamp: Date.now(),
      isBot: message.author.bot
    });

    // Keep only last 50 messages
    if (conv.messages.length > 50) {
      conv.messages = conv.messages.slice(-50);
    }

    // Reset bot-to-bot counter if human posts
    if (!message.author.bot) {
      conv.botToBotCounter = 0;
      conv.consecutiveSelfMessages = 0;
      conv.botResponsesSinceHuman.clear(); // Clear the set of bots that have responded
      logger.debug("🤖 Human message received, counters reset");
    }

    // Track consecutive self messages
    if (message.author.id === this.botId) {
      conv.consecutiveSelfMessages++;
    } else {
      conv.consecutiveSelfMessages = 0;
    }

    // Track last bot
    if (message.author.bot) {
      conv.lastBotId = message.author.id;
    }
  }

  //--------------------------------------------------------------
  // SHOULD RESPOND AUTONOMOUSLY
  //--------------------------------------------------------------

  shouldRespond(message: Message): {
    shouldRespond: boolean;
    reason: string;
  } {
    // Always respond if not autonomous
    if (!this.enabled) {
      return { shouldRespond: true, reason: "Autonomous mode disabled" };
    }

    const conv = this.conversations.get(message.channelId);

    // 1. Check if in DM
    if (message.channel.isDMBased()) {
      // If DM whitelist is set, only respond to that user
      if (this.allowedDmUserId) {
        if (message.author.id === this.allowedDmUserId) {
          return { shouldRespond: true, reason: "DM from whitelisted user" };
        } else {
          return { shouldRespond: false, reason: "DM from non-whitelisted user" };
        }
      }
      return { shouldRespond: true, reason: "DM" };
    }

    // 2. Check if mentioned (STRICT - direct mentions only, no reply detection)
    if (message.mentions.users.has(this.botId)) {
      // Check if we're in cooldown
      if (conv && Date.now() < conv.cooldownUntil) {
        return { shouldRespond: false, reason: "In cooldown (loop prevention)" };
      }

      // Check if this bot has hit its response limit (applies to mentions from ANYONE - bots OR humans)
      if (conv) {
        const responseCount = conv.botResponsesSinceHuman.get(this.botId) || 0;
        if (responseCount >= MAX_BOT_RESPONSES_PER_HUMAN) {
          logger.warn(`🤖 Mentioned but hit response limit (${responseCount}/${MAX_BOT_RESPONSES_PER_HUMAN}) - waiting for human to reset`);
          return { shouldRespond: false, reason: `Mentioned but response limit reached (${responseCount}/${MAX_BOT_RESPONSES_PER_HUMAN})` };
        }
      }

      return { shouldRespond: true, reason: "Mentioned directly" };
    }

    // 3. CHECK RESPOND_TO_GENERIC - Block ALL non-mention messages if disabled
    const respondToGeneric = process.env.RESPOND_TO_GENERIC !== "false";
    if (!respondToGeneric) {
      // This blocks BOTH bots AND humans if not mentioned
      return { shouldRespond: false, reason: "Generic responses disabled (RESPOND_TO_GENERIC=false) - only mentions trigger responses" };
    }

    // 4. Check if from another bot (only reached if RESPOND_TO_GENERIC=true)
    if (message.author.bot) {
      // Log the bot check with current settings
      const respondToBots = process.env.RESPOND_TO_BOTS === "true";
      logger.info(`🤖 Bot message detected from ${message.author.username} (${message.author.id})`);
      logger.info(`🤖 RESPOND_TO_BOTS setting: ${process.env.RESPOND_TO_BOTS} (evaluated as: ${respondToBots})`);

      // Respect RESPOND_TO_BOTS setting
      if (!respondToBots) {
        return { shouldRespond: false, reason: "Bot message (RESPOND_TO_BOTS=false)" };
      }

      // Check if THIS bot has hit its response limit since last human message
      if (conv) {
        const responseCount = conv.botResponsesSinceHuman.get(this.botId) || 0;
        logger.info(`🤖 Response count for bot ${this.botId}: ${responseCount}/${MAX_BOT_RESPONSES_PER_HUMAN}`);

        if (responseCount >= MAX_BOT_RESPONSES_PER_HUMAN) {
          logger.warn(`🤖 Hit response limit (${responseCount}/${MAX_BOT_RESPONSES_PER_HUMAN}) - waiting for human`);
          return { shouldRespond: false, reason: `Response limit reached (${responseCount}/${MAX_BOT_RESPONSES_PER_HUMAN})` };
        }

        logger.info(`🤖 Under limit (${responseCount}/${MAX_BOT_RESPONSES_PER_HUMAN}) - will respond to bot message`);
      }

      // Check bot-to-bot counter (global across all bots)
      if (conv) {
        // If last message was from a different bot, increment counter
        if (conv.lastBotId && conv.lastBotId !== this.botId) {
          conv.botToBotCounter++;
        }

        if (conv.botToBotCounter >= BOT_PINGPONG_MAX) {
          logger.warn(`🤖 Bot-to-bot ping-pong limit reached (${BOT_PINGPONG_MAX})`);
          this.activateCooldown(message.channelId);
          return { shouldRespond: false, reason: "Bot-to-bot ping-pong limit" };
        }
      }

      return { shouldRespond: true, reason: "Bot message (RESPOND_TO_BOTS=true)" };
    }

    // 5. Check if in cooldown
    if (conv && Date.now() < conv.cooldownUntil) {
      // Only respond to humans after cooldown
      if (!message.author.bot) {
        logger.info("🤖 Cooldown active, but responding to human");
        return { shouldRespond: true, reason: "Human message during cooldown" };
      }
      return { shouldRespond: false, reason: "In cooldown" };
    }

    // 6. Check consecutive self messages
    if (conv && conv.consecutiveSelfMessages >= MAX_CONSECUTIVE_SELF_MESSAGES) {
      logger.warn(`🤖 Self-spam limit reached (${MAX_CONSECUTIVE_SELF_MESSAGES})`);
      this.activateCooldown(message.channelId);
      return { shouldRespond: false, reason: "Self-spam limit (too many consecutive bot messages)" };
    }

    // 7. Server whitelist check
    if (REQUIRE_HUMAN_WHITELIST.length > 0 && message.guildId) {
      if (!REQUIRE_HUMAN_WHITELIST.includes(message.guildId)) {
        return { shouldRespond: false, reason: "Server not in whitelist" };
      }
    }

    // 8. LET AI DECIDE (return true and let the AI make final call in prompt)
    return { shouldRespond: true, reason: "AI will decide" };
  }

  //--------------------------------------------------------------
  // ACTIVATE COOLDOWN
  //--------------------------------------------------------------

  private activateCooldown(channelId: string): void {
    const conv = this.conversations.get(channelId);
    if (!conv) return;

    conv.cooldownUntil = Date.now() + BOT_LOOP_COOLDOWN_MS;
    conv.botToBotCounter = 0;
    conv.consecutiveSelfMessages = 0;

    logger.warn(`🤖 Cooldown activated for ${BOT_LOOP_COOLDOWN_MS / 1000}s`);
  }

  //--------------------------------------------------------------
  // PREPARE FAREWELL (when hitting limits)
  //--------------------------------------------------------------

  getFarewellSuggestion(): string {
    const farewells = [
      "gotta go",
      "catch you later",
      "step away for a bit",
      "talk soon",
      "be back later",
      "need a break"
    ];

    return farewells[Math.floor(Math.random() * farewells.length)];
  }

  //--------------------------------------------------------------
  // GET CONVERSATION CONTEXT
  //--------------------------------------------------------------

  getConversationContext(channelId: string, limit: number = 10): ConversationMessage[] {
    const conv = this.conversations.get(channelId);
    if (!conv) return [];

    return conv.messages.slice(-limit);
  }

  //--------------------------------------------------------------
  // CHECK IF CONVERSATION IS STALE
  //--------------------------------------------------------------

  isConversationStale(channelId: string, maxAgeMs: number = 300000): boolean {
    const conv = this.conversations.get(channelId);
    if (!conv || conv.messages.length === 0) return true;

    const lastMessage = conv.messages[conv.messages.length - 1];
    return Date.now() - lastMessage.timestamp > maxAgeMs;
  }

  //--------------------------------------------------------------
  // GET STATUS
  //--------------------------------------------------------------

  getStatus(channelId: string): any {
    const conv = this.conversations.get(channelId);
    if (!conv) {
      return {
        tracked: false,
        messageCount: 0,
        botToBotCounter: 0,
        consecutiveSelfMessages: 0,
        inCooldown: false
      };
    }

    return {
      tracked: true,
      messageCount: conv.messages.length,
      botToBotCounter: conv.botToBotCounter,
      consecutiveSelfMessages: conv.consecutiveSelfMessages,
      inCooldown: Date.now() < conv.cooldownUntil,
      cooldownRemaining: Math.max(0, conv.cooldownUntil - Date.now())
    };
  }

  //--------------------------------------------------------------
  // MARK BOT RESPONDED
  //--------------------------------------------------------------

  markBotResponded(channelId: string): void {
    const conv = this.conversations.get(channelId);
    if (conv) {
      const currentCount = conv.botResponsesSinceHuman.get(this.botId) || 0;
      conv.botResponsesSinceHuman.set(this.botId, currentCount + 1);
      logger.info(`🤖 Bot ${this.botId} response count: ${currentCount + 1}/${MAX_BOT_RESPONSES_PER_HUMAN}`);
    }
  }

  //--------------------------------------------------------------
  // ENABLED CHECK
  //--------------------------------------------------------------

  isEnabled(): boolean {
    return this.enabled;
  }
}
