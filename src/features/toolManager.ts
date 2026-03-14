// FILE: src/features/toolManager.ts
//--------------------------------------------------------------
// Tool Manager - Autonomous Feature Selection
// Allows bot to choose when to use voice, weather, GIFs, etc.
//--------------------------------------------------------------

import { Message, TextChannel } from "discord.js";
import { logger } from "../utils/logger.js";

// Import all features
import { sendVoiceMessage, isVoiceEnabled } from "./elevenlabs.js";
import { getCurrentWeather, createWeatherEmbed, isWeatherEnabled } from "./weather.js";
import { searchGif, isGifEnabled } from "./gifSender.js";
import { getTranscript, isYoutubeEnabled, extractVideoId } from "./youtubeTranscript.js";
// Note: Image OCR now handled by visionProcessor.ts (Google Vision)
import { quickSearch, isWebSearchEnabled, createSearchEmbed, webSearch } from "./webSearch.js";

//--------------------------------------------------------------
// Available Tools
//--------------------------------------------------------------

export interface BotTool {
  name: string;
  description: string;
  enabled: boolean;
  trigger: (message: Message) => boolean;
  execute: (message: Message, params?: any) => Promise<boolean>;
}

//--------------------------------------------------------------
// Tool Definitions
//--------------------------------------------------------------

export const AVAILABLE_TOOLS: BotTool[] = [
  {
    name: "send_voice_message",
    description: "Send a voice message using text-to-speech. Use when you want to respond with voice instead of text.",
    enabled: isVoiceEnabled(),
    trigger: (message) => {
      // Bot can choose to use voice based on context
      // For example: emotional moments, important announcements
      const content = message.content.toLowerCase();
      return (
        content.includes("voice") ||
        content.includes("say it") ||
        content.includes("speak")
      );
    },
    execute: async (message, params) => {
      const text = params?.text || "I'm sending you a voice message.";
      const channel = message.channel as TextChannel;
      return await sendVoiceMessage(channel, text);
    },
  },

  {
    name: "get_weather",
    description: "Get current weather information. Use when asked about weather or when discussing outdoor plans.",
    enabled: isWeatherEnabled(),
    trigger: (message) => {
      const content = message.content.toLowerCase();
      return (
        content.includes("weather") ||
        content.includes("temperature") ||
        content.includes("forecast") ||
        content.includes("outside") && content.includes("like")
      );
    },
    execute: async (message, params) => {
      const location = params?.location;
      const weather = await getCurrentWeather(location);

      if (!weather) {
        await message.reply("Sorry, I couldn't fetch the weather right now.");
        return false;
      }

      const embed = createWeatherEmbed(weather);
      await message.reply({ embeds: [embed] });
      return true;
    },
  },

  {
    name: "send_gif",
    description: "Send a GIF to express emotion or add humor. Use when appropriate for the mood.",
    enabled: isGifEnabled(),
    trigger: (message) => {
      // Bot can choose to send GIF based on detected emotion
      return false; // Auto-detection handled by gifSender.ts
    },
    execute: async (message, params) => {
      const query = params?.query || "happy";
      const gifUrl = await searchGif(query);

      if (!gifUrl) {
        return false;
      }

      await message.reply(gifUrl);
      return true;
    },
  },

  {
    name: "get_youtube_transcript",
    description: "Extract transcript from a YouTube video. Use when a YouTube link is shared and context is needed.",
    enabled: isYoutubeEnabled(),
    trigger: (message) => {
      return /(?:youtube\.com|youtu\.be)/.test(message.content);
    },
    execute: async (message, params) => {
      const videoUrl = params?.url || message.content;
      const transcript = await getTranscript(videoUrl);

      if (!transcript) {
        await message.reply("I couldn't get the transcript for that video.");
        return false;
      }

      // Truncate if too long for Discord
      const truncated = transcript.length > 1900
        ? transcript.substring(0, 1900) + "..."
        : transcript;

      await message.reply(`📺 **Video Transcript:**\n\`\`\`\n${truncated}\n\`\`\``);
      return true;
    },
  },

  // Note: extract_image_text tool removed - images auto-processed via visionProcessor.ts

  {
    name: "web_search",
    description: "Search the web using Exa.ai. Use when you need current information or facts.",
    enabled: isWebSearchEnabled(),
    trigger: (message) => {
      const content = message.content.toLowerCase();
      return (
        content.includes("search for") ||
        content.includes("look up") ||
        content.includes("find information") ||
        content.includes("what is") ||
        content.includes("who is")
      );
    },
    execute: async (message, params) => {
      const query = params?.query || message.content;
      const results = await webSearch(query, 3);

      if (results.length === 0) {
        await message.reply("I couldn't find any search results.");
        return false;
      }

      const embed = createSearchEmbed(query, results);
      await message.reply({ embeds: [embed] });
      return true;
    },
  },
];

//--------------------------------------------------------------
// Check if any tools should be triggered
//--------------------------------------------------------------

export async function checkAndExecuteTools(message: Message): Promise<boolean> {
  for (const tool of AVAILABLE_TOOLS) {
    if (!tool.enabled) continue;

    if (tool.trigger(message)) {
      logger.info(`🔧 Triggering tool: ${tool.name}`);

      try {
        const success = await tool.execute(message);
        if (success) {
          return true;
        }
      } catch (error) {
        logger.error(`Error executing tool ${tool.name}:`, error);
      }
    }
  }

  return false;
}

//--------------------------------------------------------------
// Manual tool execution (bot can call directly)
// NOTE: We don't export a "getAvailableToolsList" to avoid bloating
// Ollama prompts. Tools are triggered automatically via checkAndExecuteTools.
//--------------------------------------------------------------

export async function executeTool(
  toolName: string,
  message: Message,
  params?: any
): Promise<boolean> {
  const tool = AVAILABLE_TOOLS.find((t) => t.name === toolName);

  if (!tool || !tool.enabled) {
    logger.warn(`Tool not found or disabled: ${toolName}`);
    return false;
  }

  try {
    logger.info(`🔧 Manually executing tool: ${toolName}`);
    return await tool.execute(message, params);
  } catch (error) {
    logger.error(`Error executing tool ${toolName}:`, error);
    return false;
  }
}

//--------------------------------------------------------------
// Tool suggestions for bot context
//--------------------------------------------------------------

export function suggestTools(messageContent: string): string[] {
  const suggestions: string[] = [];

  for (const tool of AVAILABLE_TOOLS) {
    if (!tool.enabled) continue;

    // Create a mock message for trigger check
    const mockMessage = { content: messageContent } as Message;

    if (tool.trigger(mockMessage)) {
      suggestions.push(tool.name);
    }
  }

  return suggestions;
}
