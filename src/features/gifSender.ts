// FILE: src/features/gifSender.ts
//--------------------------------------------------------------
// GIF Auto-Sender using Tenor API
//--------------------------------------------------------------

import axios from "axios";
import { logger } from "../utils/logger.js";
import { Message } from "discord.js";

const TENOR_API_KEY = process.env.TENOR_API_KEY;
const GIF_AUTO_SEND = process.env.GIF_AUTO_SEND === "true";
const GIF_ENABLED = !!TENOR_API_KEY && GIF_AUTO_SEND;

//--------------------------------------------------------------
// Search for GIF
//--------------------------------------------------------------

export async function searchGif(query: string, limit: number = 1): Promise<string | null> {
  if (!TENOR_API_KEY) {
    logger.warn("Tenor API not configured");
    return null;
  }

  try {
    const response = await axios.get("https://tenor.googleapis.com/v2/search", {
      params: {
        q: query,
        key: TENOR_API_KEY,
        limit: limit,
        media_filter: "gif",
        contentfilter: "medium",
      },
    });

    if (response.data.results && response.data.results.length > 0) {
      return response.data.results[0].media_formats.gif.url;
    }

    return null;
  } catch (error: any) {
    logger.error("Error searching GIF:", error.response?.data || error.message);
    return null;
  }
}

//--------------------------------------------------------------
// Get random GIF for a category
//--------------------------------------------------------------

export async function getRandomGif(category: string): Promise<string | null> {
  if (!TENOR_API_KEY) {
    return null;
  }

  try {
    const response = await axios.get("https://tenor.googleapis.com/v2/featured", {
      params: {
        key: TENOR_API_KEY,
        q: category,
        limit: 10,
        media_filter: "gif",
      },
    });

    if (response.data.results && response.data.results.length > 0) {
      const randomIndex = Math.floor(Math.random() * response.data.results.length);
      return response.data.results[randomIndex].media_formats.gif.url;
    }

    return null;
  } catch (error) {
    logger.error("Error getting random GIF:", error);
    return null;
  }
}

//--------------------------------------------------------------
// Detect if message should trigger GIF
//--------------------------------------------------------------

const GIF_TRIGGERS: Record<string, string[]> = {
  happy: ["happy", "yay", "woohoo", "awesome", "great"],
  sad: ["sad", "cry", "upset", "depressed"],
  love: ["love", "heart", "adore", "crush"],
  angry: ["angry", "mad", "furious", "annoyed"],
  laugh: ["lol", "haha", "funny", "hilarious"],
  shocked: ["wow", "omg", "shocked", "surprised"],
  celebrate: ["congrats", "celebrate", "party", "achievement"],
};

export function detectGifCategory(message: string): string | null {
  const lowerMessage = message.toLowerCase();

  for (const [category, triggers] of Object.entries(GIF_TRIGGERS)) {
    for (const trigger of triggers) {
      if (lowerMessage.includes(trigger)) {
        return category;
      }
    }
  }

  return null;
}

//--------------------------------------------------------------
// Auto-send GIF if appropriate
//--------------------------------------------------------------

export async function handleGifAutoSend(message: Message): Promise<boolean> {
  if (!GIF_ENABLED) {
    return false;
  }

  const category = detectGifCategory(message.content);
  if (!category) {
    return false;
  }

  // Random chance (30%) to send GIF
  if (Math.random() > 0.3) {
    return false;
  }

  const gifUrl = await getRandomGif(category);
  if (!gifUrl) {
    return false;
  }

  try {
    await message.reply(gifUrl);
    logger.info(`Sent auto-GIF for category: ${category}`);
    return true;
  } catch (error) {
    logger.error("Error sending auto-GIF:", error);
    return false;
  }
}

export function isGifEnabled(): boolean {
  return GIF_ENABLED;
}
