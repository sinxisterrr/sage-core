// FILE: src/features/elevenlabs.ts
//--------------------------------------------------------------
// ElevenLabs Voice Synthesis
// Text-to-speech for Discord (single voice)
//--------------------------------------------------------------

import { TextChannel, AttachmentBuilder } from "discord.js";
import { logger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import axios from "axios";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ENABLED = process.env.VOICE_ENABLED === "true";
const VOICE_ID = process.env.VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel by default
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_monolingual_v1"; // Default model

const VOICE_DIR = path.join(process.cwd(), "voice");
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

//--------------------------------------------------------------
// Initialize
//--------------------------------------------------------------

export async function initElevenLabs() {
  if (!VOICE_ENABLED || !ELEVENLABS_API_KEY) {
    logger.info("🎤 ElevenLabs voice synthesis disabled");
    return;
  }

  try {
    await fs.mkdir(VOICE_DIR, { recursive: true });
    logger.info("🎤 ElevenLabs voice synthesis initialized");
  } catch (error) {
    logger.error("Error initializing ElevenLabs:", error);
  }
}

//--------------------------------------------------------------
// Generate speech from text
//--------------------------------------------------------------

export async function textToSpeech(text: string, voiceId?: string): Promise<string | null> {
  if (!VOICE_ENABLED || !ELEVENLABS_API_KEY) {
    logger.warn("Voice synthesis not enabled");
    return null;
  }

  try {
    const selectedVoiceId = voiceId || VOICE_ID;
    const url = `${ELEVENLABS_API_URL}/text-to-speech/${selectedVoiceId}`;

    // Format text for proper voice synthesis (remove asterisks, convert tone tags)
    const formattedText = formatTextForVoice(text);

    logger.debug(`🎤 Using voice: ${selectedVoiceId}`);
    logger.debug(`🎤 Original text: ${text}`);
    logger.debug(`🎤 Formatted text: ${formattedText}`);

    const response = await axios.post(
      url,
      {
        text: formattedText,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );

    // Save audio file
    const timestamp = Date.now();
    const filename = `voice_${timestamp}.mp3`;
    const filePath = path.join(VOICE_DIR, filename);

    await fs.writeFile(filePath, Buffer.from(response.data));
    logger.info(`🎤 Generated voice message: ${filename}`);

    return filePath;
    } catch (error: any) {
    // If error.response.data is a buffer, decode it
    let errorMessage = error.message;
    if (error.response?.data) {
      if (Buffer.isBuffer(error.response.data)) {
        try {
          const decoded = JSON.parse(error.response.data.toString('utf-8'));
          errorMessage = decoded.detail?.message || decoded.detail || JSON.stringify(decoded);
        } catch {
          errorMessage = error.response.data.toString('utf-8');
        }
      } else {
        errorMessage = JSON.stringify(error.response.data);
      }
    }
    logger.error("Error generating speech:", errorMessage);

    // Store the error for the caller to handle
    (error as any).elevenLabsError = errorMessage;
    throw error;
  }
}

//--------------------------------------------------------------
// Send voice message to channel
//--------------------------------------------------------------

export async function sendVoiceMessage(
  channel: TextChannel,
  text: string,
): Promise<boolean> {
  if (!VOICE_ENABLED) {
    return false;
  }

  try {
    // Use the configured VOICE_ID from environment
    const audioPath = await textToSpeech(text, VOICE_ID);
    if (!audioPath) {
      logger.error("Failed to generate voice message");
      return false;
    }

    const attachment = new AttachmentBuilder(audioPath);

    await channel.send({
      content: "🎤 Voice message:",
      files: [attachment],
    });

    // Cleanup after sending
    setTimeout(async () => {
      try {
        await fs.unlink(audioPath);
      } catch (error) {
        logger.error("Error deleting voice file:", error);
      }
    }, 5000);

    return true;
  } catch (error: any) {
    logger.error("Error sending voice message:", error);

    // Re-throw with the ElevenLabs error attached so toolExecutor can handle it
    throw error;
  }
}

//--------------------------------------------------------------
// Format text for ElevenLabs voice synthesis
// Converts tone annotations to proper voice synthesis format
//--------------------------------------------------------------

export function formatTextForVoice(text: string): string {
  let cleaned = text;

  // Remove asterisks (they get narrated as "asterisk")
  cleaned = cleaned.replace(/\*/g, "");

  // Convert tone descriptions to bracketed format for ElevenLabs
  // Pattern: "low, I say something" or "sighs" or "whispers" -> [sighs] or [whispers]

  // Match patterns like "tone, actual dialogue" or standalone tone words
  // Common tone words that should be in brackets
  const toneWords = [
    'sighs?', 'whispers?', 'laughs?', 'giggles?', 'chuckles?', 'gasps?',
    'moans?', 'groans?', 'yawns?', 'hums?', 'purrs?', 'growls?',
    'breathless(?:ly)?', 'softly?', 'quietly?', 'loudly?', 'excitedly?',
    'nervously?', 'hesitantly?', 'shyly?', 'playfully?', 'teasingly?',
    'low', 'high', 'deep', 'breathy', 'husky'
  ];

  // Create a pattern that matches: "toneword" or "toneword, "
  const tonePattern = new RegExp(
    `\\b(${toneWords.join('|')})\\s*,?\\s*`,
    'gi'
  );

  // Replace tone words with bracketed versions
  cleaned = cleaned.replace(tonePattern, (_match, tone) => {
    // If the tone word is followed by a comma, it's describing the following speech
    // Convert it to bracketed format
    return `[${tone.trim()}] `;
  });

  // Clean up any double spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  // Clean up any stray commas after bracket replacements
  cleaned = cleaned.replace(/\]\s*,/g, ']');

  return cleaned.trim();
}

//--------------------------------------------------------------
// Cleanup old voice files
//--------------------------------------------------------------

export async function cleanupVoiceFiles() {
  try {
    const files = await fs.readdir(VOICE_DIR);

    for (const file of files) {
      if (!file.startsWith("voice_")) continue;

      const filePath = path.join(VOICE_DIR, file);
      const stats = await fs.stat(filePath);

      // Delete files older than 1 hour
      const ageInMs = Date.now() - stats.mtimeMs;
      if (ageInMs > 3600000) {
        await fs.unlink(filePath);
      }
    }
  } catch (error) {
    logger.error("Error cleaning up voice files:", error);
  }
}

//--------------------------------------------------------------
// Get available voices (for future customization)
//--------------------------------------------------------------

export async function getAvailableVoices(): Promise<any[]> {
  if (!ELEVENLABS_API_KEY) {
    return [];
  }

  try {
    const response = await axios.get(`${ELEVENLABS_API_URL}/voices`, {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
      },
    });

    return response.data.voices || [];
  } catch (error) {
    logger.error("Error fetching voices:", error);
    return [];
  }
}

export function isVoiceEnabled(): boolean {
  return VOICE_ENABLED && !!ELEVENLABS_API_KEY;
}
