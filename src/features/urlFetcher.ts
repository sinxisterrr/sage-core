// FILE: src/features/urlFetcher.ts
//--------------------------------------------------------------
// URL Content Fetcher - Automatically fetches and summarizes URLs
//--------------------------------------------------------------

import axios from "axios";
import { logger } from "../utils/logger.js";
import { extractVideoId, getTranscript, isYoutubeEnabled } from "./youtubeTranscript.js";

const URL_FETCH_ENABLED = process.env.URL_FETCH_ENABLED !== "false"; // Enabled by default

interface FetchedContent {
  url: string;
  title?: string;
  content: string;
  success: boolean;
  isYouTube?: boolean;
}

//--------------------------------------------------------------
// Detect URLs in text
//--------------------------------------------------------------

export function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

//--------------------------------------------------------------
// Fetch URL content - auto-detects YouTube and fetches transcript
//--------------------------------------------------------------

export async function fetchUrlContent(url: string): Promise<FetchedContent> {
  if (!URL_FETCH_ENABLED) {
    logger.warn("URL fetch feature is disabled");
    return {
      url,
      content: "",
      success: false
    };
  }

  // Check if this is a YouTube URL and transcript feature is enabled
  const videoId = extractVideoId(url);
  if (videoId && isYoutubeEnabled()) {
    try {
      logger.info(`📺 Detected YouTube URL, fetching transcript: ${url}`);
      const transcript = await getTranscript(url);

      if (transcript) {
        // Truncate transcript to 3000 chars for STM
        const truncatedTranscript = transcript.length > 3000
          ? transcript.substring(0, 3000) + "\n... (truncated)"
          : transcript;

        logger.info(`✅ Fetched YouTube transcript: ${url} (${transcript.length} chars)`);

        return {
          url,
          title: "YouTube Video",
          content: truncatedTranscript,
          success: true,
          isYouTube: true
        };
      } else {
        logger.warn(`⚠️ No transcript available for YouTube video: ${url}`);
        return {
          url,
          content: "",
          success: false,
          isYouTube: true
        };
      }
    } catch (error: any) {
      logger.error(`❌ Failed to fetch YouTube transcript ${url}:`, error.message);
      return {
        url,
        content: "",
        success: false,
        isYouTube: true
      };
    }
  }

  // Not YouTube or transcript disabled - fetch regular webpage content
  try {
    // Use Jina.ai Reader to convert webpage to markdown
    const jinaUrl = `https://r.jina.ai/${url}`;

    const response = await axios.get(jinaUrl, {
      headers: {
        "User-Agent": `Mozilla/5.0 (compatible; ${process.env.AI_NAME || 'Bot'}/1.0)`
      },
      timeout: 10000 // 10 second timeout
    });

    const content = response.data;

    // Extract title from markdown (first # heading)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : undefined;

    // Truncate content to 3000 chars for STM
    const truncatedContent = content.length > 3000
      ? content.substring(0, 3000) + "\n... (truncated)"
      : content;

    logger.info(`🔗 Fetched webpage content: ${url} (${content.length} chars)`);

    return {
      url,
      title,
      content: truncatedContent,
      success: true
    };

  } catch (error: any) {
    logger.error(`❌ Failed to fetch URL ${url}:`, error.message);
    return {
      url,
      content: "",
      success: false
    };
  }
}

//--------------------------------------------------------------
// Check if URL fetch is enabled
//--------------------------------------------------------------

export function isUrlFetchEnabled(): boolean {
  return URL_FETCH_ENABLED;
}
