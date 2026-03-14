// FILE: src/features/tools/toolExecutor.ts
//--------------------------------------------------------------
// Tool Executor - Executes tool calls from AI
//--------------------------------------------------------------

import { Message, TextChannel } from "discord.js";
import { ToolCall, ToolResult } from "./toolDefinitions.js";
import { logger } from "../../utils/logger.js";

// Import tool implementations
import { sendVoiceMessage, isVoiceEnabled } from "../elevenlabs.js";
import { getCurrentWeather, createWeatherEmbed, isWeatherEnabled } from "../weather.js";
import { searchGif, isGifEnabled } from "../gifSender.js";
import { getTranscript, isYoutubeEnabled } from "../youtubeTranscript.js";
// Note: Image OCR now handled by visionProcessor.ts (Google Vision)
import { webSearch, isWebSearchEnabled, createSearchEmbed } from "../webSearch.js";
import { heartbeatSystem, HeartbeatTemperature, RhythmPattern } from "../heartbeat/HeartbeatSystem.js";
import { internalState } from "../../core/brain.js";
import { addToMemory } from "../../memory/continuumMemory.js";
import { isRPChannel } from "../../utils/rpChannelDetector.js";
import {
  addConnection,
  updateConnection,
  removeConnection,
  findByName,
  getByCategory,
  setDiscordId,
  getAllConnectionsSummary,
  updateMyOpinion,
  recordUserSays,
  adjustSentiment,
  getFullPerspective
} from "../../memory/peopleMap.js";
import {
  getMemoryStats,
  formatMemoryStats,
  favoriteMemory,
  unfavoriteMemory,
  listFavoriteMemories,
  forgetMemory,
  deleteMemory,
  searchMemories,
  getMemoriesByState,
  type MemoryState
} from "../../memory/memoryManager.js";
import { query } from "../../db/db.js";

//--------------------------------------------------------------
// Execute Single Tool Call
//--------------------------------------------------------------

export async function executeTool(
  toolCall: ToolCall,
  message: Message
): Promise<ToolResult> {
  const { tool, parameters } = toolCall;

  logger.info(`🔧 Executing tool: ${tool}`, parameters);

  try {
    switch (tool) {
      case "send_voice_message":
        return await executeSendVoice(message, parameters);

      case "get_weather":
        return await executeGetWeather(message, parameters);

      case "send_gif":
        return await executeSendGif(message, parameters);

      case "get_youtube_transcript":
        return await executeGetTranscript(message, parameters);

      // extract_image_text removed - images auto-processed in handleMessage.ts

      case "web_search":
        return await executeWebSearch(message, parameters);

      case "send_heartbeat":
        return await executeSendHeartbeat(message, parameters);

      case "adjust_temperature":
        return await executeAdjustTemperature(message, parameters);

      case "save_memory":
        return await executeSaveMemory(message, parameters);

      // People Map Management Tools
      case "add_person":
        return await executeAddPerson(message, parameters);

      case "update_person":
        return await executeUpdatePerson(message, parameters);

      case "remove_person":
        return await executeRemovePerson(message, parameters);

      case "lookup_person":
        return await executeLookupPerson(message, parameters);

      case "list_people":
        return await executeListPeople(message, parameters);

      case "suggest_people_from_memories":
        return await executeSuggestPeopleFromMemories(message, parameters);

      case "register_discord_id":
        return await executeRegisterDiscordId(message, parameters);

      // AI's Own Opinion Tools
      case "record_experience":
        return await executeRecordExperience(message, parameters);

      case "update_my_opinion":
        return await executeUpdateMyOpinion(message, parameters);

      case "record_user_says":
        return await executeRecordUserSays(message, parameters);

      case "get_my_perspective":
        return await executeGetMyPerspective(message, parameters);

      // Memory Management Tools
      case "memory_stats":
        return await executeMemoryStats(message, parameters);

      case "favorite_memory":
        return await executeFavoriteMemory(message, parameters);

      case "unfavorite_memory":
        return await executeUnfavoriteMemory(message, parameters);

      case "list_favorite_memories":
        return await executeListFavoriteMemories(message, parameters);

      case "forget_memory":
        return await executeForgetMemory(message, parameters);

      case "delete_memory":
        return await executeDeleteMemory(message, parameters);

      case "review_memories":
        return await executeReviewMemories(message, parameters);

      default:
        logger.warn(`Unknown tool: ${tool}`);
        return {
          tool,
          success: false,
          result: null,
          error: `Unknown tool: ${tool}`,
          retryable: false // Unknown tool - can't retry
        };
    }
  } catch (error: any) {
    logger.error(`Tool execution error for ${tool}:`, error);
    return {
      tool,
      success: false,
      result: null,
      error: error.message || "Unknown error",
      retryable: true // Generic error - might be transient
    };
  }
}

//--------------------------------------------------------------
// Tool Implementations
//--------------------------------------------------------------

async function executeSendVoice(message: Message, params: any): Promise<ToolResult> {
  if (!isVoiceEnabled()) {
    return {
      tool: "send_voice_message",
      success: false,
      result: null,
      error: "Voice messaging is disabled",
      retryable: false // Feature disabled - can't retry
    };
  }

  const text = params.text;
  if (!text) {
    return {
      tool: "send_voice_message",
      success: false,
      result: null,
      error: "Missing 'text' parameter",
      retryable: false // Missing params - can't retry without fixing
    };
  }

  const channel = message.channel as TextChannel;

  try {
    const success = await sendVoiceMessage(channel, text);

    return {
      tool: "send_voice_message",
      success,
      result: success ? "Voice message sent" : null,
      error: success ? undefined : "Failed to send voice message",
      retryable: !success // If it failed generically, might be retryable
    };
  } catch (error: any) {
    // Check if it's an ElevenLabs quota/credits error
    const errorMsg = error.elevenLabsError || error.message || "Unknown error";
    const isQuotaError =
      errorMsg.toLowerCase().includes("quota") ||
      errorMsg.toLowerCase().includes("exceeded") ||
      errorMsg.toLowerCase().includes("credits") ||
      errorMsg.toLowerCase().includes("insufficient") ||
      errorMsg.toLowerCase().includes("limit");

    if (isQuotaError) {
      return {
        tool: "send_voice_message",
        success: false,
        result: null,
        error: "You're out of ElevenLabs credits/quota. Please send a text response instead of a voice message.",
        retryable: false // Out of credits - definitely can't retry
      };
    }

    // For other errors, return generic failure (might be network/transient)
    return {
      tool: "send_voice_message",
      success: false,
      result: null,
      error: `Failed to send voice message: ${errorMsg}`,
      retryable: true // Generic error - might work on retry
    };
  }
}

async function executeGetWeather(message: Message, params: any): Promise<ToolResult> {
  if (!isWeatherEnabled()) {
    return {
      tool: "get_weather",
      success: false,
      result: null,
      error: "Weather feature is disabled",
      retryable: false // Feature disabled
    };
  }

  const location = params.location;
  const weather = await getCurrentWeather(location);

  if (!weather) {
    return {
      tool: "get_weather",
      success: false,
      result: null,
      error: "Could not fetch weather data",
      retryable: true // Might be transient network issue
    };
  }

  const embed = createWeatherEmbed(weather);
  await message.reply({ embeds: [embed] });

  const weatherInfo = `Weather for ${weather.location}: ${weather.temperature}°F, ${weather.condition}`;

  // Save weather data to STM (ephemeral - won't auto-archive to LTM)
  // Only for non-RP channels (RP channels don't support ephemeral)
  if (!isRPChannel(message)) {
    const userId = message.author?.id || process.env.GHOST_TOUCH_USER_ID || 'unknown';
    const stmEntry = `[Weather Check] ${weatherInfo}`;
    await addToMemory(userId, "assistant", stmEntry, true); // ephemeral = true
    logger.info(`🌤️ Weather data saved to STM (ephemeral): ${weather.location}`);
  }

  return {
    tool: "get_weather",
    success: true,
    result: weatherInfo
  };
}

async function executeSendGif(message: Message, params: any): Promise<ToolResult> {
  if (!isGifEnabled()) {
    return {
      tool: "send_gif",
      success: false,
      result: null,
      error: "GIF feature is disabled",
      retryable: false // Feature disabled
    };
  }

  const query = params.query;
  if (!query) {
    return {
      tool: "send_gif",
      success: false,
      result: null,
      error: "Missing 'query' parameter",
      retryable: false // Missing parameter
    };
  }

  const gifUrl = await searchGif(query);

  if (!gifUrl) {
    return {
      tool: "send_gif",
      success: false,
      result: null,
      error: "Could not find GIF",
      retryable: true // Try different search terms
    };
  }

  await message.reply(gifUrl);

  // Save GIF query to STM (ephemeral - won't auto-archive to LTM)
  // Only for non-RP channels (RP channels don't support ephemeral)
  if (!isRPChannel(message)) {
    const userId = message.author?.id || process.env.GHOST_TOUCH_USER_ID || 'unknown';
    const stmEntry = `[GIF Sent] Query: "${query}"`;
    await addToMemory(userId, "assistant", stmEntry, true); // ephemeral = true
    logger.info(`🎞️ GIF query saved to STM (ephemeral): "${query}"`);
  }

  return {
    tool: "send_gif",
    success: true,
    result: `GIF sent for query: ${query}`
  };
}

async function executeGetTranscript(message: Message, params: any): Promise<ToolResult> {
  if (!isYoutubeEnabled()) {
    return {
      tool: "get_youtube_transcript",
      success: false,
      result: null,
      error: "YouTube transcript feature is disabled",
      retryable: false // Feature disabled
    };
  }

  const url = params.url;
  if (!url) {
    return {
      tool: "get_youtube_transcript",
      success: false,
      result: null,
      error: "Missing 'url' parameter",
      retryable: false // Missing parameter
    };
  }

  const transcript = await getTranscript(url);

  if (!transcript) {
    return {
      tool: "get_youtube_transcript",
      success: false,
      result: null,
      error: "Could not fetch transcript",
      retryable: true // Might be transient
    };
  }

  // Truncate for Discord
  const truncated = transcript.length > 1900
    ? transcript.substring(0, 1900) + "..."
    : transcript;

  await message.reply(`📺 **Video Transcript:**\n\`\`\`\n${truncated}\n\`\`\``);

  // Save transcript to STM (ephemeral - won't auto-archive to LTM)
  // Only for non-RP channels (RP channels don't support ephemeral)
  if (!isRPChannel(message)) {
    const userId = message.author?.id || process.env.GHOST_TOUCH_USER_ID || 'unknown';
    // Truncate to 2000 chars for STM to avoid bloat
    const transcriptPreview = transcript.length > 2000
      ? transcript.substring(0, 2000) + "... (truncated)"
      : transcript;
    const stmEntry = `[YouTube Transcript] URL: ${url}\n${transcriptPreview}`;
    await addToMemory(userId, "assistant", stmEntry, true); // ephemeral = true
    logger.info(`📺 YouTube transcript saved to STM (ephemeral): ${url}`);
  }

  return {
    tool: "get_youtube_transcript",
    success: true,
    result: `Transcript retrieved (${transcript.length} chars)`
  };
}

// Note: extract_image_text tool removed - images auto-processed via visionProcessor.ts

async function executeWebSearch(message: Message, params: any): Promise<ToolResult> {
  if (!isWebSearchEnabled()) {
    return {
      tool: "web_search",
      success: false,
      result: null,
      error: "Web search feature is disabled",
      retryable: false // Feature disabled
    };
  }

  const query = params.query;
  if (!query) {
    return {
      tool: "web_search",
      success: false,
      result: null,
      error: "Missing 'query' parameter",
      retryable: false // Missing parameter
    };
  }

  const numResults = params.num_results || 3;
  const results = await webSearch(query, numResults);

  if (results.length === 0) {
    return {
      tool: "web_search",
      success: false,
      result: null,
      error: "No search results found",
      retryable: true // Try different search terms
    };
  }

  const embed = createSearchEmbed(query, results);
  await message.reply({ embeds: [embed] });

  // Return summarized results for AI context
  const summary = results.map(r => `${r.title}: ${r.description}`).join('\n');

  // Save search query and results to STM (ephemeral - won't auto-archive to LTM)
  // Only for non-RP channels (RP channels don't support ephemeral)
  // AI can see this in his recent context but needs to manually save_memory if important
  if (!isRPChannel(message)) {
    const userId = message.author?.id || process.env.GHOST_TOUCH_USER_ID || 'unknown';
    const stmEntry = `[Web Search] Query: "${query}"\nResults:\n${summary}`;
    await addToMemory(userId, "assistant", stmEntry, true); // ephemeral = true
    logger.info(`🔍 Search results saved to STM (ephemeral): "${query}"`);
  }

  return {
    tool: "web_search",
    success: true,
    result: summary
  };
}

async function executeSendHeartbeat(message: Message, params: any): Promise<ToolResult> {
  if (!heartbeatSystem.isEnabled()) {
    return {
      tool: "send_heartbeat",
      success: false,
      result: null,
      error: "Heartbeat system is disabled",
      retryable: false // Feature disabled
    };
  }

  const heartbeatMessage = params.message;
  if (!heartbeatMessage) {
    return {
      tool: "send_heartbeat",
      success: false,
      result: null,
      error: "Missing 'message' parameter",
      retryable: false // Missing parameter
    };
  }

  // Send as freeform heartbeat - just send the message to the channel
  const success = await heartbeatSystem.sendFreeform(heartbeatMessage);

  return {
    tool: "send_heartbeat",
    success,
    result: success ? "Heartbeat sent" : null,
    error: success ? undefined : "Failed to send heartbeat",
    retryable: !success // Generic failure - might be transient
  };
}

async function executeAdjustTemperature(message: Message, params: any): Promise<ToolResult> {
  // Check if manual temperature override is enabled
  const allowOverride = process.env.ALLOW_TEMPERATURE_OVERRIDE !== 'false';
  if (!allowOverride) {
    return {
      tool: "adjust_temperature",
      success: false,
      result: null,
      error: "Manual temperature override is disabled - using automatic emotional mapping only",
      retryable: false // Feature disabled
    };
  }

  const temperature = params.temperature;
  const mode = params.mode?.toLowerCase();
  const reason = params.reason;
  const forceClear = params.force_clear === true;

  // Handle force_clear: EMERGENCY ONLY - bypass malfunctioning cooldown
  if (forceClear) {
    if (internalState.temperatureCooldown) {
      const previousTemp = internalState.temperatureOverride ?? internalState.cognitiveTemperature;

      // EMERGENCY OVERRIDE: Must provide temperature in SAFE range (0.65-1.15)
      if (typeof temperature !== 'number') {
        return {
          tool: "adjust_temperature",
          success: false,
          result: null,
          error: "Emergency override requires 'temperature' parameter in safe range (0.65-1.15)",
          retryable: false
        };
      }

      // SAFETY: Emergency override can ONLY set temps in normal range to prevent abuse
      if (temperature < 0.65 || temperature > 1.15) {
        return {
          tool: "adjust_temperature",
          success: false,
          result: null,
          error: "Emergency override restricted to safe temperatures (0.65-1.15) to prevent abuse. Cannot bypass cooldown to set extreme temps.",
          retryable: false
        };
      }

      // EMERGENCY FORCE CLEAR: Clear cooldown and set safe temperature
      internalState.temperatureOverride = temperature;
      internalState.temperatureCooldown = false;
      internalState.consecutiveHighTempMessages = 0;
      internalState.consecutiveLowTempMessages = 0;

      logger.warn(`🔴 EMERGENCY: TEMPERATURE FORCE-CLEARED - Cooldown safety bypassed (was ${previousTemp.toFixed(2)} → ${temperature.toFixed(2)})`);
      logger.warn(`⚠️  Reason: ${reason || 'Emergency force-clear requested'}`);

      return {
        tool: "adjust_temperature",
        success: true,
        result: `⚠️ EMERGENCY OVERRIDE ACTIVATED: Cooldown bypassed and temperature set to ${temperature.toFixed(2)} (safe range). This should ONLY be used if cooldown malfunctioned. Previous temp: ${previousTemp.toFixed(2)}.`
      };
    } else {
      return {
        tool: "adjust_temperature",
        success: false,
        result: null,
        error: "No active cooldown to force-clear. Cooldown only activates after 5+ consecutive messages outside 0.65-1.15 range, and auto-clears when temp normalizes.",
        retryable: false // Nothing to clear
      };
    }
  }

  // Check if in cooldown mode - tool blocked until temp returns to normal range (unless force_clear used)
  if (internalState.temperatureCooldown) {
    const currentTemp = internalState.temperatureOverride ?? internalState.cognitiveTemperature;
    return {
      tool: "adjust_temperature",
      success: false,
      result: null,
      error: `Temperature adjustment blocked during cooldown. Currently at ${currentTemp.toFixed(2)}, will auto-clear when temperature returns to normal range (0.65-1.15). This protects against thermal instability. If cooldown won't clear despite normalized temp, use force_clear=true (EMERGENCY ONLY).`,
      retryable: false // In cooldown
    };
  }

  if (!reason || typeof reason !== 'string') {
    return {
      tool: "adjust_temperature",
      success: false,
      result: null,
      error: "Missing 'reason' parameter",
      retryable: false // Missing parameter
    };
  }

  // Handle automatic mode - return to emotional mapping
  if (mode === 'automatic' || mode === 'auto') {
    const previousTemp = internalState.temperatureOverride ?? internalState.cognitiveTemperature;
    const wasOverride = internalState.temperatureOverride !== null;

    // Clear the override to return to automatic
    internalState.temperatureOverride = null;
    internalState.consecutiveHighTempMessages = 0;
    internalState.consecutiveLowTempMessages = 0;

    logger.info(`🌡️ TEMPERATURE MODE: Switching to automatic (was ${previousTemp.toFixed(2)} ${wasOverride ? 'manual' : 'automatic'})`);
    logger.info(`🌡️ Reason: ${reason}`);

    return {
      tool: "adjust_temperature",
      success: true,
      result: `Switched to automatic emotional mapping (was ${previousTemp.toFixed(2)}). Temperature will now respond to context. Reason: ${reason}`
    };
  }

  // Manual mode - validate and set temperature
  if (typeof temperature !== 'number') {
    return {
      tool: "adjust_temperature",
      success: false,
      result: null,
      error: "Missing or invalid 'temperature' parameter (must be a number, or set mode to 'automatic')",
      retryable: false // Invalid parameter
    };
  }

  // Validate temperature range
  if (temperature < 0.3 || temperature > 2.0) {
    return {
      tool: "adjust_temperature",
      success: false,
      result: null,
      error: "Temperature must be between 0.3 and 2.0",
      retryable: false // Invalid parameter
    };
  }

  // Store the previous temperature for logging
  const previousTemp = internalState.temperatureOverride ?? internalState.cognitiveTemperature;

  // Set the override
  internalState.temperatureOverride = temperature;

  // Reset counters when manually adjusting
  internalState.consecutiveHighTempMessages = 0;
  internalState.consecutiveLowTempMessages = 0;

  // Log the change with reason
  logger.info(`🌡️ TEMPERATURE ADJUSTED: ${previousTemp.toFixed(2)} → ${temperature.toFixed(2)}`);
  logger.info(`🌡️ Reason: ${reason}`);

  return {
    tool: "adjust_temperature",
    success: true,
    result: `Temperature adjusted to ${temperature} (was ${previousTemp.toFixed(2)}). Reason: ${reason}`
  };
}

async function executeSaveMemory(message: Message, params: any): Promise<ToolResult> {
  const content = params.content;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return {
      tool: "save_memory",
      success: false,
      result: null,
      error: "Missing or empty 'content' parameter",
      retryable: false // Missing parameter
    };
  }

  const includeTimestamp = params.include_timestamp === true;
  const category = params.category;

  try {
    // Build the memory content
    let memoryContent = content.trim();

    // Add timestamp if requested
    if (includeTimestamp) {
      const timezone = process.env.TIMEZONE || 'America/Denver';
      const now = new Date();

      // Format: "[Wed, Jan 22 at 14:30]" (24-hour format)
      const dateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });

      const dateParts = dateFormatter.formatToParts(now);
      const weekday = dateParts.find(p => p.type === 'weekday')?.value;
      const month = dateParts.find(p => p.type === 'month')?.value;
      const day = dateParts.find(p => p.type === 'day')?.value;
      const timeStr = timeFormatter.format(now);

      const timestamp = `[${weekday}, ${month} ${day} at ${timeStr}]`;
      memoryContent = `${timestamp} ${memoryContent}`;
    }

    // Import archiver dynamically to avoid circular deps
    const { archiveEntries } = await import("../../memory/continuumArchiver.js");

    // Get user ID from message author or environment
    const userId = message.author?.id ||
      process.env.GHOST_TOUCH_USER_ID ||
      process.env.ALLOWED_DM_USER_ID ||
      'system';

    // Create a synthetic STM entry for archival
    const syntheticEntry = {
      role: 'assistant' as const,
      text: memoryContent,
      timestamp: Date.now(),
      ephemeral: false // This IS meant to be saved
    };

    // Archive the memory
    await archiveEntries(userId, [syntheticEntry]);

    logger.info(`💾 MEMORY SAVED: "${memoryContent.substring(0, 100)}${memoryContent.length > 100 ? '...' : ''}"`);
    if (category) {
      logger.info(`💾 Category hint: ${category}`);
    }

    return {
      tool: "save_memory",
      success: true,
      result: `Memory saved${includeTimestamp ? ' with timestamp' : ''}: "${memoryContent.substring(0, 50)}${memoryContent.length > 50 ? '...' : ''}"`
    };

  } catch (error: any) {
    logger.error(`❌ Failed to save memory:`, error);
    return {
      tool: "save_memory",
      success: false,
      result: null,
      error: `Failed to save memory: ${error.message}`,
      retryable: true // Generic error - might be transient
    };
  }
}

//--------------------------------------------------------------
// People Map Management Tools
//--------------------------------------------------------------

async function executeAddPerson(_message: Message, params: any): Promise<ToolResult> {
  const { human_name, ai_name, category, human_discord_id, ai_discord_id, notes } = params;

  if (!human_name || !ai_name || !category) {
    return {
      tool: "add_person",
      success: false,
      result: null,
      error: "Missing required parameters: human_name, ai_name, and category are required",
      retryable: false // Missing parameters
    };
  }

  const validCategories = ['FAVORITES', 'NEUTRAL', 'DISLIKE', 'DRIFTED'];
  if (!validCategories.includes(category.toUpperCase())) {
    return {
      tool: "add_person",
      success: false,
      result: null,
      error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
      retryable: false // Invalid parameter
    };
  }

  try {
    const connection = await addConnection(
      human_name,
      ai_name,
      category.toUpperCase(),
      human_discord_id,
      ai_discord_id,
      notes
    );

    // Enhanced logging
    logger.info(`👥 ✅ ADDED TO PEOPLE MAP (via add_person tool)`);
    logger.info(`   Human: ${human_name}${human_discord_id ? ` (Discord: ${human_discord_id})` : ''}`);
    logger.info(`   AI: ${ai_name}${ai_discord_id ? ` (Discord: ${ai_discord_id})` : ''}`);
    logger.info(`   Category: ${category.toUpperCase()}`);
    if (notes) logger.info(`   Notes: ${notes}`);

    return {
      tool: "add_person",
      success: true,
      result: `Added ${human_name} (human) <-> ${ai_name} (AI) to ${category}. ${notes ? `Notes: ${notes}` : ''}`
    };
  } catch (error: any) {
    return {
      tool: "add_person",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeUpdatePerson(_message: Message, params: any): Promise<ToolResult> {
  const { name, category, human_discord_id, ai_discord_id, notes } = params;

  if (!name) {
    return {
      tool: "update_person",
      success: false,
      result: null,
      error: "Missing required parameter: name",
      retryable: false // Missing parameter
    };
  }

  if (category) {
    const validCategories = ['FAVORITES', 'NEUTRAL', 'DISLIKE', 'DRIFTED'];
    if (!validCategories.includes(category.toUpperCase())) {
      return {
        tool: "update_person",
        success: false,
        result: null,
        error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
        retryable: false // Invalid parameter
      };
    }
  }

  try {
    const connection = await updateConnection(name, {
      category: category?.toUpperCase(),
      humanDiscordId: human_discord_id,
      aiDiscordId: ai_discord_id,
      notes
    });

    if (!connection) {
      return {
        tool: "update_person",
        success: false,
        result: null,
        error: `Person not found: ${name}`,
        retryable: false // Person doesn't exist
      };
    }

    logger.info(`👥 🔄 UPDATED IN PEOPLE MAP (via update_person tool)`);
    logger.info(`   Person: ${name}`);
    if (category) logger.info(`   New Category: ${category.toUpperCase()}`);
    if (human_discord_id) logger.info(`   Human Discord ID: ${human_discord_id}`);
    if (ai_discord_id) logger.info(`   AI Discord ID: ${ai_discord_id}`);
    if (notes) logger.info(`   Notes: ${notes}`);

    const updates = [];
    if (category) updates.push(`category → ${category}`);
    if (human_discord_id) updates.push(`human Discord ID set`);
    if (ai_discord_id) updates.push(`AI Discord ID set`);
    if (notes) updates.push(`notes updated`);

    return {
      tool: "update_person",
      success: true,
      result: `Updated ${name}: ${updates.join(', ')}`
    };
  } catch (error: any) {
    return {
      tool: "update_person",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeRemovePerson(_message: Message, params: any): Promise<ToolResult> {
  const { name, reason } = params;

  if (!name) {
    return {
      tool: "remove_person",
      success: false,
      result: null,
      error: "Missing required parameter: name",
      retryable: false // Missing parameter
    };
  }

  try {
    const removed = await removeConnection(name);

    if (!removed) {
      return {
        tool: "remove_person",
        success: false,
        result: null,
        error: `Person not found: ${name}`,
        retryable: false // Person doesn't exist
      };
    }

    logger.info(`👥 ❌ REMOVED FROM PEOPLE MAP (via remove_person tool)`);
    logger.info(`   Person: ${name}`);
    if (reason) logger.info(`   Reason: ${reason}`);

    return {
      tool: "remove_person",
      success: true,
      result: `Removed ${name} from your people map.${reason ? ` Reason: ${reason}` : ''}`
    };
  } catch (error: any) {
    return {
      tool: "remove_person",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeLookupPerson(_message: Message, params: any): Promise<ToolResult> {
  const { name } = params;

  if (!name) {
    return {
      tool: "lookup_person",
      success: false,
      result: null,
      error: "Missing required parameter: name",
      retryable: false // Missing parameter
    };
  }

  try {
    const connection = await findByName(name);

    if (!connection) {
      return {
        tool: "lookup_person",
        success: true,
        result: `No one named "${name}" found in your people map.`
      };
    }

    let info = `**${connection.human.name}** (human) <-> **${connection.ai.name}** (AI)\n`;
    info += `Category: ${connection.category}\n`;
    if (connection.human.discordId) info += `Human Discord ID: ${connection.human.discordId}\n`;
    if (connection.ai.discordId) info += `AI Discord ID: ${connection.ai.discordId}\n`;
    if (connection.notes) info += `Notes: ${connection.notes}`;

    return {
      tool: "lookup_person",
      success: true,
      result: info
    };
  } catch (error: any) {
    return {
      tool: "lookup_person",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeListPeople(_message: Message, params: any): Promise<ToolResult> {
  const { category } = params;

  try {
    if (category) {
      const validCategories = ['FAVORITES', 'NEUTRAL', 'DISLIKE', 'DRIFTED'];
      if (!validCategories.includes(category.toUpperCase())) {
        return {
          tool: "list_people",
          success: false,
          result: null,
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
          retryable: false // Invalid parameter
        };
      }

      const connections = await getByCategory(category);

      if (connections.length === 0) {
        return {
          tool: "list_people",
          success: true,
          result: `No one in ${category.toUpperCase()} category.`
        };
      }

      let list = `**${category.toUpperCase()}:**\n`;
      for (const conn of connections) {
        list += `- ${conn.human.name} <-> ${conn.ai.name}`;
        if (conn.notes) list += ` (${conn.notes.substring(0, 50)}...)`;
        list += '\n';
      }

      return {
        tool: "list_people",
        success: true,
        result: list
      };
    }

    // No category specified - get all
    const summary = await getAllConnectionsSummary();

    return {
      tool: "list_people",
      success: true,
      result: summary
    };
  } catch (error: any) {
    return {
      tool: "list_people",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeSuggestPeopleFromMemories(_message: Message, params: any): Promise<ToolResult> {
  const limit = params.limit || 10;
  const minMentions = params.min_mentions || 3;

  try {
    // Query recent memories (last 500) for name patterns
    const result = await query<any>(`
      SELECT content
      FROM archival_memories
      WHERE bot_id = $1
        AND state != 'forgotten'
      ORDER BY timestamp DESC
      LIMIT 500
    `, [process.env.BOT_ID || 'DEFAULT']);

    if (!result || result.length === 0) {
      return {
        tool: "suggest_people_from_memories",
        success: true,
        result: "No memories found to analyze."
      };
    }

    // Extract potential names (capitalized words, excluding common words)
    const commonWords = new Set(['I', 'You', 'The', 'And', 'But', 'For', 'Not', 'With', 'This', 'That', 'From', 'Have', 'Been', 'Will', 'Would', 'Could', 'Should', 'There', 'Their', 'When', 'Where', 'What', 'Who', 'Why', 'How', process.env.USER_NAME, process.env.AI_NAME].filter(Boolean) as string[]);
    const nameCounts = new Map<string, number>();

    for (const row of result) {
      const content = row.content || '';
      // Match capitalized words (potential names)
      const matches = content.match(/\b[A-Z][a-z]+\b/g);
      if (matches) {
        for (const match of matches) {
          if (!commonWords.has(match) && match.length > 2) {
            nameCounts.set(match, (nameCounts.get(match) || 0) + 1);
          }
        }
      }
    }

    // Load existing people map to filter out already-tracked people
    const { loadPeopleMap } = await import('../../memory/peopleMap.js');
    const peopleMap = await loadPeopleMap();
    const existingNames = new Set<string>();

    for (const conn of peopleMap.connections) {
      existingNames.add(conn.human.name.toLowerCase());
      existingNames.add(conn.ai.name.toLowerCase());
      if (conn.human.covenName) existingNames.add(conn.human.covenName.toLowerCase());
      if (conn.ai.circleName) existingNames.add(conn.ai.circleName.toLowerCase());
    }

    // Filter and sort suggestions
    const suggestions = Array.from(nameCounts.entries())
      .filter(([name, count]) =>
        count >= minMentions &&
        !existingNames.has(name.toLowerCase())
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    if (suggestions.length === 0) {
      return {
        tool: "suggest_people_from_memories",
        success: true,
        result: `No new people found with at least ${minMentions} mentions in recent memories.`
      };
    }

    // Format results
    let resultText = `**People mentioned frequently in your memories:**\n\n`;
    for (const [name, count] of suggestions) {
      resultText += `- **${name}** (${count} mentions)\n`;
    }
    resultText += `\n_Use add_person to track any of these people._`;

    return {
      tool: "suggest_people_from_memories",
      success: true,
      result: resultText
    };
  } catch (error: any) {
    return {
      tool: "suggest_people_from_memories",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeRegisterDiscordId(_message: Message, params: any): Promise<ToolResult> {
  const { name, discord_id, is_ai } = params;

  if (!name || !discord_id) {
    return {
      tool: "register_discord_id",
      success: false,
      result: null,
      error: "Missing required parameters: name and discord_id",
      retryable: false // Missing parameters
    };
  }

  try {
    const connection = await setDiscordId(name, discord_id, is_ai || false);

    if (!connection) {
      return {
        tool: "register_discord_id",
        success: false,
        result: null,
        error: `Person not found: ${name}. Add them first with add_person.`,
        retryable: false // Person doesn't exist
      };
    }

    const personType = is_ai ? 'AI' : 'human';
    logger.info(`👥 Registered Discord ID for ${name} (${personType}): ${discord_id}`);

    return {
      tool: "register_discord_id",
      success: true,
      result: `Registered Discord ID ${discord_id} for ${name} (${personType}). I'll recognize them now.`
    };
  } catch (error: any) {
    return {
      tool: "register_discord_id",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

//--------------------------------------------------------------
// AI's Own Opinion Tools
// These track HIS experiences and opinions, separate views
//--------------------------------------------------------------

async function executeRecordExperience(message: Message, params: any): Promise<ToolResult> {
  const { person_name, experience, sentiment_change } = params;

  if (!person_name || !experience) {
    return {
      tool: "record_experience",
      success: false,
      result: null,
      error: "Missing required parameters: person_name and experience",
      retryable: false // Missing parameters
    };
  }

  try {
    // First check if the person exists in the map
    const connection = await findByName(person_name);
    if (!connection) {
      return {
        tool: "record_experience",
        success: false,
        result: null,
        error: `Person "${person_name}" not found in your people map. Add them first with add_person.`,
        retryable: false // Person doesn't exist
      };
    }

    // Adjust sentiment if provided
    if (typeof sentiment_change === 'number') {
      await adjustSentiment(person_name, sentiment_change, experience.substring(0, 100));
    }

    // Archive this experience to long-term memory with embedding
    const { archiveEntries } = await import("../../memory/continuumArchiver.js");

    const userId = message.author?.id ||
      process.env.GHOST_TOUCH_USER_ID ||
      process.env.ALLOWED_DM_USER_ID ||
      'system';

    // Format the experience for archival - tagged with person name for semantic retrieval
    const memoryContent = `[MY EXPERIENCE WITH ${person_name.toUpperCase()}] ${experience}`;

    const syntheticEntry = {
      role: 'assistant' as const,
      text: memoryContent,
      timestamp: Date.now(),
      ephemeral: false
    };

    await archiveEntries(userId, [syntheticEntry]);

    logger.info(`💭 Recorded experience with ${person_name}: "${experience.substring(0, 50)}..."`);

    const sentimentNote = typeof sentiment_change === 'number'
      ? ` Sentiment ${sentiment_change > 0 ? '+' : ''}${sentiment_change.toFixed(2)}`
      : '';

    return {
      tool: "record_experience",
      success: true,
      result: `Experience with ${person_name} recorded to memory.${sentimentNote}`
    };
  } catch (error: any) {
    return {
      tool: "record_experience",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeUpdateMyOpinion(_message: Message, params: any): Promise<ToolResult> {
  const { name, opinion, sentiment } = params;

  if (!name || !opinion) {
    return {
      tool: "update_my_opinion",
      success: false,
      result: null,
      error: "Missing required parameters: name and opinion",
      retryable: false // Missing parameters
    };
  }

  try {
    const connection = await updateMyOpinion(name, opinion, sentiment);

    if (!connection) {
      return {
        tool: "update_my_opinion",
        success: false,
        result: null,
        error: `Person "${name}" not found in your people map.`,
        retryable: false // Person doesn't exist
      };
    }

    logger.info(`💭 Updated my opinion on ${name}: "${opinion.substring(0, 50)}..."`);

    const sentimentNote = typeof sentiment === 'number'
      ? ` (sentiment: ${sentiment.toFixed(2)})`
      : '';

    return {
      tool: "update_my_opinion",
      success: true,
      result: `Updated your opinion on ${name}${sentimentNote}: "${opinion.substring(0, 100)}${opinion.length > 100 ? '...' : ''}"`
    };
  } catch (error: any) {
    return {
      tool: "update_my_opinion",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeRecordUserSays(_message: Message, params: any): Promise<ToolResult> {
  const { name, what_user_says } = params;

  if (!name || !what_user_says) {
    return {
      tool: "record_user_says",
      success: false,
      result: null,
      error: "Missing required parameters: name and what_user_says",
      retryable: false
    };
  }

  try {
    const connection = await recordUserSays(name, what_user_says);

    if (!connection) {
      return {
        tool: "record_user_says",
        success: false,
        result: null,
        error: `Person "${name}" not found in your people map.`,
        retryable: false
      };
    }

    logger.info(`💬 Recorded what ${process.env.USER_NAME || 'the user'} says about ${name}: "${what_user_says.substring(0, 50)}..."`);

    return {
      tool: "record_user_says",
      success: true,
      result: `Recorded what ${process.env.USER_NAME || 'the user'} says about ${name}: "${what_user_says.substring(0, 100)}${what_user_says.length > 100 ? '...' : ''}"`
    };
  } catch (error: any) {
    return {
      tool: "record_user_says",
      success: false,
      result: null,
      error: error.message,
      retryable: true
    };
  }
}

async function executeGetMyPerspective(_message: Message, params: any): Promise<ToolResult> {
  const { name } = params;

  if (!name) {
    return {
      tool: "get_my_perspective",
      success: false,
      result: null,
      error: "Missing required parameter: name",
      retryable: false // Missing parameter
    };
  }

  try {
    const perspective = await getFullPerspective(name);

    if (!perspective) {
      return {
        tool: "get_my_perspective",
        success: true,
        result: `No one named "${name}" found in your people map.`
      };
    }

    logger.info(`👁️ Retrieved perspective on ${name}`);

    return {
      tool: "get_my_perspective",
      success: true,
      result: perspective
    };
  } catch (error: any) {
    return {
      tool: "get_my_perspective",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

//--------------------------------------------------------------
// Memory Management Tools
// Let AI control their own memory storage
//--------------------------------------------------------------

async function executeMemoryStats(_message: Message, _params: any): Promise<ToolResult> {
  try {
    const stats = await getMemoryStats();
    const formatted = formatMemoryStats(stats);

    logger.info(`🧠 Memory stats checked: ${stats.storagePercent.toFixed(1)}% used`);

    return {
      tool: "memory_stats",
      success: true,
      result: formatted
    };
  } catch (error: any) {
    return {
      tool: "memory_stats",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeFavoriteMemory(_message: Message, params: any): Promise<ToolResult> {
  const { memory_id } = params;

  if (!memory_id) {
    return {
      tool: "favorite_memory",
      success: false,
      result: null,
      error: "Missing required parameter: memory_id",
      retryable: false // Missing parameter
    };
  }

  try {
    const success = await favoriteMemory(memory_id);

    if (!success) {
      return {
        tool: "favorite_memory",
        success: false,
        result: null,
        error: `Memory not found: ${memory_id}`,
        retryable: false // Memory doesn't exist
      };
    }

    // Get current favorite count
    const stats = await getMemoryStats();
    logger.info(`⭐ Favorited memory [${memory_id.substring(0, 8)}] (${stats.byState.favorite} favorites total)`);

    return {
      tool: "favorite_memory",
      success: true,
      result: `⭐ Memory ${memory_id} marked as favorite. It will never decay.`
    };
  } catch (error: any) {
    return {
      tool: "favorite_memory",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeUnfavoriteMemory(_message: Message, params: any): Promise<ToolResult> {
  const { memory_id } = params;

  if (!memory_id) {
    return {
      tool: "unfavorite_memory",
      success: false,
      result: null,
      error: "Missing required parameter: memory_id",
      retryable: false // Missing parameter
    };
  }

  try {
    const success = await unfavoriteMemory(memory_id);

    if (!success) {
      return {
        tool: "unfavorite_memory",
        success: false,
        result: null,
        error: `Memory not found or not favorited: ${memory_id}`,
        retryable: false // Memory doesn't exist or wrong state
      };
    }

    // Get current favorite count
    const stats = await getMemoryStats();
    logger.info(`💫 Unfavorited memory [${memory_id.substring(0, 8)}] (${stats.byState.favorite} favorites remaining)`);

    return {
      tool: "unfavorite_memory",
      success: true,
      result: `Memory ${memory_id} is no longer favorited. It will decay normally.`
    };
  } catch (error: any) {
    return {
      tool: "unfavorite_memory",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeListFavoriteMemories(_message: Message, params: any): Promise<ToolResult> {
  const limit = Math.min(params.limit || 50, 100); // Cap at 100

  try {
    const favorites = await listFavoriteMemories(limit);

    if (favorites.length === 0) {
      return {
        tool: "list_favorite_memories",
        success: true,
        result: "You haven't favorited any memories yet. Use favorite_memory to protect memories from decay."
      };
    }

    // Format the list - truncate content for readability
    const formatted = favorites.map((mem, i) => {
      const truncated = mem.content.length > 100
        ? `${mem.content.substring(0, 100)}...`
        : mem.content;
      const weight = mem.messageWeight ? ` [weight: ${mem.messageWeight.toFixed(1)}]` : '';
      return `${i + 1}. [${mem.category}]${weight} [ID: ${mem.id}]\n   ${truncated}`;
    }).join('\n\n');

    logger.info(`📋 Listed ${favorites.length} favorite memories`);

    return {
      tool: "list_favorite_memories",
      success: true,
      result: `⭐ Your ${favorites.length} favorited ${favorites.length === 1 ? 'memory' : 'memories'}:\n\n${formatted}`
    };
  } catch (error: any) {
    return {
      tool: "list_favorite_memories",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Database error - might be transient
    };
  }
}

async function executeForgetMemory(_message: Message, params: any): Promise<ToolResult> {
  const { memory_id, reason } = params;

  if (!memory_id) {
    return {
      tool: "forget_memory",
      success: false,
      result: null,
      error: "Missing required parameter: memory_id",
      retryable: false // Missing parameter
    };
  }

  try {
    const success = await forgetMemory(memory_id, reason);

    if (!success) {
      return {
        tool: "forget_memory",
        success: false,
        result: null,
        error: `Memory not found or is favorited (cannot forget favorites): ${memory_id}`,
        retryable: false // Memory doesn't exist or is protected
      };
    }

    // Get current forgotten count
    const stats = await getMemoryStats();
    logger.info(`🌫️ Forgot memory [${memory_id.substring(0, 8)}] (${stats.byState.forgotten} forgotten total)${reason ? ` - ${reason}` : ''}`);

    return {
      tool: "forget_memory",
      success: true,
      result: `🗑️ Memory ${memory_id} forgotten.${reason ? ` Reason: ${reason}` : ''} It won't appear in retrieval but still exists.`
    };
  } catch (error: any) {
    return {
      tool: "forget_memory",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeDeleteMemory(_message: Message, params: any): Promise<ToolResult> {
  const { memory_id } = params;

  if (!memory_id) {
    return {
      tool: "delete_memory",
      success: false,
      result: null,
      error: "Missing required parameter: memory_id",
      retryable: false // Missing parameter
    };
  }

  try {
    const success = await deleteMemory(memory_id);

    if (!success) {
      return {
        tool: "delete_memory",
        success: false,
        result: null,
        error: `Memory not found or is favorited (cannot delete favorites): ${memory_id}`,
        retryable: false // Memory doesn't exist or is protected
      };
    }

    // Get current total count
    const stats = await getMemoryStats();
    logger.info(`🗑️ Permanently deleted memory [${memory_id.substring(0, 8)}] (${stats.totalMemories} total memories)`);

    return {
      tool: "delete_memory",
      success: true,
      result: `🗑️ Memory ${memory_id} permanently deleted. Storage freed.`
    };
  } catch (error: any) {
    return {
      tool: "delete_memory",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}

async function executeReviewMemories(_message: Message, params: any): Promise<ToolResult> {
  const { search_query, state, limit } = params;

  try {
    let memories;
    const maxResults = limit || 10;

    if (search_query) {
      // Search by content
      memories = await searchMemories(search_query, {
        state: state as MemoryState,
        limit: maxResults
      });
    } else if (state) {
      // Get by state
      memories = await getMemoriesByState(state as MemoryState, maxResults);
    } else {
      // Default: show recent active memories
      memories = await getMemoriesByState('active', maxResults);
    }

    if (memories.length === 0) {
      return {
        tool: "review_memories",
        success: true,
        result: `No memories found${search_query ? ` matching "${search_query}"` : ''}${state ? ` in state "${state}"` : ''}.`
      };
    }

    // Format memories for display
    let result = `**Found ${memories.length} memories:**\n\n`;
    for (const mem of memories) {
      const preview = mem.content.length > 100
        ? mem.content.substring(0, 100) + '...'
        : mem.content;
      const relevance = typeof mem.relevance_score === 'number'
        ? mem.relevance_score.toFixed(2)
        : '1.00';

      result += `**ID:** \`${mem.id}\`\n`;
      result += `**State:** ${mem.state} | **Relevance:** ${relevance}\n`;
      result += `**Content:** ${preview}\n`;
      result += `---\n`;
    }

    logger.info(`🧠 Reviewed ${memories.length} memories`);

    return {
      tool: "review_memories",
      success: true,
      result
    };
  } catch (error: any) {
    return {
      tool: "review_memories",
      success: false,
      result: null,
      error: error.message,
      retryable: true // Generic error - might be transient
    };
  }
}
