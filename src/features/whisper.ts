// FILE: src/features/whisper.ts
//--------------------------------------------------------------
// Groq Whisper Voice Transcription
// Transcribes voice messages and audio files using Groq's Whisper API
//--------------------------------------------------------------

import { logger } from "../utils/logger.js";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import path from "path";

const WHISPER_ENABLED = process.env.WHISPER_ENABLED === "true";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-large-v3-turbo";
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE; // Optional: "en", "es", etc.

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

//--------------------------------------------------------------
// Initialize Whisper
//--------------------------------------------------------------

export function initWhisper() {
  if (!WHISPER_ENABLED) {
    logger.info("🎤 Whisper transcription disabled");
    return;
  }

  if (!GROQ_API_KEY) {
    logger.warn("⚠️  Whisper enabled but GROQ_API_KEY not set");
    return;
  }

  logger.info(`🎤 Whisper transcription enabled via Groq (model: ${WHISPER_MODEL})`);
}

//--------------------------------------------------------------
// Check if Whisper is available
//--------------------------------------------------------------

export function isWhisperEnabled(): boolean {
  return WHISPER_ENABLED && !!GROQ_API_KEY;
}

//--------------------------------------------------------------
// Transcribe audio file
//--------------------------------------------------------------

export async function transcribeAudio(
  audioPath: string
): Promise<TranscriptionResult | null> {
  if (!isWhisperEnabled()) {
    logger.warn("⚠️  Whisper not enabled");
    return null;
  }

  try {
    logger.info(`🎤 Transcribing audio: ${path.basename(audioPath)}`);

    // Check if file exists
    if (!fs.existsSync(audioPath)) {
      logger.error(`❌ Audio file not found: ${audioPath}`);
      return null;
    }

    // Check file size (max 25MB for Whisper API)
    const stats = fs.statSync(audioPath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > 25) {
      logger.warn(
        `⚠️  Audio file too large (${fileSizeMB.toFixed(2)}MB > 25MB)`
      );
      return null;
    }

    // Create form data
    const formData = new FormData();
    formData.append("file", fs.createReadStream(audioPath));
    formData.append("model", WHISPER_MODEL);

    if (WHISPER_LANGUAGE) {
      formData.append("language", WHISPER_LANGUAGE);
    }

    // Optional: Add response format
    formData.append("response_format", "verbose_json");

    // Call Groq Whisper API
    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          ...formData.getHeaders(),
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`❌ Whisper API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = (await response.json()) as any;

    const transcription: TranscriptionResult = {
      text: result.text || "",
      language: result.language,
      duration: result.duration,
    };

    logger.info(
      `✅ Transcription complete (${transcription.text.length} chars, ${transcription.duration?.toFixed(1)}s)`
    );

    return transcription;
  } catch (error: any) {
    logger.error(`❌ Transcription failed: ${error.message}`);
    return null;
  }
}

//--------------------------------------------------------------
// Transcribe from URL (download first)
//--------------------------------------------------------------

export async function transcribeFromUrl(
  url: string,
  tempDir: string = "./temp"
): Promise<TranscriptionResult | null> {
  if (!isWhisperEnabled()) {
    return null;
  }

  try {
    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Download audio file
    logger.info(`📥 Downloading audio from URL...`);
    const response = await fetch(url);

    if (!response.ok) {
      logger.error(`❌ Failed to download audio: ${response.status}`);
      return null;
    }

    // Get file extension from URL or Content-Type
    const contentType = response.headers.get("content-type") || "";
    let extension = ".mp3";

    if (contentType.includes("ogg")) extension = ".ogg";
    else if (contentType.includes("wav")) extension = ".wav";
    else if (contentType.includes("m4a")) extension = ".m4a";
    else if (contentType.includes("webm")) extension = ".webm";

    // Save to temp file
    const tempFile = path.join(
      tempDir,
      `audio_${Date.now()}${extension}`
    );

    const buffer = await response.buffer();
    fs.writeFileSync(tempFile, buffer);

    logger.info(`✅ Audio downloaded: ${path.basename(tempFile)}`);

    // Transcribe
    const result = await transcribeAudio(tempFile);

    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch (err) {
      logger.warn(`⚠️  Failed to delete temp file: ${tempFile}`);
    }

    return result;
  } catch (error: any) {
    logger.error(`❌ Transcription from URL failed: ${error.message}`);
    return null;
  }
}

//--------------------------------------------------------------
// Translate audio to English
//--------------------------------------------------------------

export async function translateAudio(
  audioPath: string
): Promise<TranscriptionResult | null> {
  if (!isWhisperEnabled()) {
    logger.warn("⚠️  Whisper not enabled");
    return null;
  }

  try {
    logger.info(`🌐 Translating audio to English: ${path.basename(audioPath)}`);

    // Check if file exists
    if (!fs.existsSync(audioPath)) {
      logger.error(`❌ Audio file not found: ${audioPath}`);
      return null;
    }

    // Create form data
    const formData = new FormData();
    formData.append("file", fs.createReadStream(audioPath));
    formData.append("model", WHISPER_MODEL);
    formData.append("response_format", "verbose_json");

    // Call Groq Whisper translation API
    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/translations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          ...formData.getHeaders(),
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`❌ Whisper API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = (await response.json()) as any;

    const translation: TranscriptionResult = {
      text: result.text || "",
      language: "en", // Always English for translations
      duration: result.duration,
    };

    logger.info(`✅ Translation complete (${translation.text.length} chars)`);

    return translation;
  } catch (error: any) {
    logger.error(`❌ Translation failed: ${error.message}`);
    return null;
  }
}
