// FILE: src/features/youtubeTranscript.ts
//--------------------------------------------------------------
// YouTube Transcript Fetching
//--------------------------------------------------------------

import { YoutubeTranscript } from "youtube-transcript";
import { logger } from "../utils/logger.js";

const YOUTUBE_ENABLED = process.env.YOUTUBE_TRANSCRIPT_ENABLED === "true";

//--------------------------------------------------------------
// Extract video ID from URL
//--------------------------------------------------------------

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

//--------------------------------------------------------------
// Fetch transcript for video
//--------------------------------------------------------------

export async function getTranscript(videoUrl: string): Promise<string | null> {
  if (!YOUTUBE_ENABLED) {
    logger.warn("YouTube transcript feature not enabled");
    return null;
  }

  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      logger.error("Invalid YouTube URL");
      return null;
    }

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcript || transcript.length === 0) {
      return null;
    }

    // Combine all text segments
    const fullText = transcript.map((entry: any) => entry.text).join(" ");
    return fullText;
  } catch (error: any) {
    logger.error("Error fetching YouTube transcript:", error.message);
    return null;
  }
}

//--------------------------------------------------------------
// Get transcript with timestamps
//--------------------------------------------------------------

export async function getTranscriptWithTimestamps(
  videoUrl: string
): Promise<Array<{ timestamp: number; text: string }> | null> {
  if (!YOUTUBE_ENABLED) {
    return null;
  }

  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return null;
    }

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcript || transcript.length === 0) {
      return null;
    }

    return transcript.map((entry: any) => ({
      timestamp: entry.offset,
      text: entry.text,
    }));
  } catch (error) {
    logger.error("Error fetching YouTube transcript with timestamps:", error);
    return null;
  }
}

//--------------------------------------------------------------
// Format transcript for display
//--------------------------------------------------------------

export function formatTranscript(
  transcript: string,
  maxLength: number = 2000
): string {
  if (transcript.length <= maxLength) {
    return transcript;
  }

  return transcript.substring(0, maxLength - 3) + "...";
}

export function isYoutubeEnabled(): boolean {
  return YOUTUBE_ENABLED;
}
