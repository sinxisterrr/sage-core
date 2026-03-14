//--------------------------------------------------------------
// FILE: src/core/handleMessage.ts
//--------------------------------------------------------------

import { Message } from "discord.js";
import { logger } from "../utils/logger.js";
import { isRPChannel, getMemorySystemDescription } from "../utils/rpChannelDetector.js";

import {
  addToMemory,
  getMemoryContext
} from "../memory/continuumMemory.js";

import {
  addToRPMemory,
  getRPMemoryContext
} from "../memory/rpMemory.js";
import { getSTMSize, loadSTMFromChannel } from "../memory/continuumSTM.js";
import { getSTMSize as getRPSTMSize, loadSTMFromChannel as loadRPSTMFromChannel } from "../memory/rpSTM.js";

import { think } from "./brain.js";
import { sendLargeMessage } from "../discord/sendLargeMessage.js";
import { isWhisperEnabled, transcribeFromUrl } from "../features/whisper.js";
import { isPdfParsingEnabled, processAttachment } from "../features/ocrProcessor.js";
import { processWordDocument } from "../features/documentProcessor.js";
import { isVisionEnabled, describeImage, likelyContainsText } from "../features/visionProcessor.js";
import { archiveInternalMonologue } from "../memory/internalMonologueLogger.js";
import { extractUrls, fetchUrlContent, isUrlFetchEnabled } from "../features/urlFetcher.js";
import path from "path";
import fs from "fs/promises";
import fetch from "node-fetch";

//--------------------------------------------------------------
// Temp File Cleanup
//--------------------------------------------------------------

/**
 * Clean up old temp files from the temp directory.
 * Removes files older than specified age to prevent accumulation from crashes.
 * Safe to run on startup and during operation.
 *
 * @param maxAgeMs - Maximum age of files to keep (default: 1 hour). Set to 0 to delete all files.
 */
export async function cleanupTempDirectory(maxAgeMs: number = 60 * 60 * 1000): Promise<void> {
  const tempDir = path.join(process.cwd(), "temp");

  try {
    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Read all files in temp directory
    const files = await fs.readdir(tempDir);

    if (files.length === 0) {
      return; // Nothing to clean
    }

    const cutoffTime = Date.now() - maxAgeMs;
    let cleanedCount = 0;

    for (const file of files) {
      try {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);

        // Check if file is old enough to delete (or delete all if maxAgeMs is 0)
        if (maxAgeMs === 0 || stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          cleanedCount++;
          // Only log individual files in debug mode to avoid log spam
          if (process.env.LOG_LEVEL === 'debug') {
            const ageMinutes = Math.round((Date.now() - stats.mtimeMs) / 60000);
            logger.debug(`🧹 Cleaned up temp file: ${file}${maxAgeMs === 0 ? '' : ` (${ageMinutes} min old)`}`);
          }
        }
      } catch (error: any) {
        // Skip files that can't be deleted (might be in use)
        logger.warn(`⚠️ Could not delete temp file ${file}: ${error.message}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`🧹 Temp cleanup complete: removed ${cleanedCount} file(s)`);
    }
  } catch (error: any) {
    // Non-critical error - just log it
    logger.warn(`⚠️ Temp directory cleanup failed (non-critical): ${error.message}`);
  }
}

//--------------------------------------------------------------
// Manual Memory Commands
//--------------------------------------------------------------

type ManualMemoryCommand = {
  summary: string;
  type?: string;
  tags?: string[];
};

function parseManualMemoryCommand(text: string): { command: ManualMemoryCommand; error?: string } | null {
  const match = text.match(
    /^(?:save\s+to\s+ltm|ltm(?:\s*save)?|remember\s+to\s+ltm)\s*(?:[:\-]\s*|\s+)(.+)$/i
  );

  if (!match) return null;
  const payload = match[1].trim();

  if (!payload) {
    return { command: { summary: "" }, error: "No content provided after save command" };
  }

  const segments = payload.split("|").map((s) => s.trim());
  const summary = segments.shift();

  if (!summary) {
    return { command: { summary: "" }, error: "Memory summary cannot be empty" };
  }

  let type: string | undefined;
  let tags: string[] | undefined;

  for (const seg of segments) {
    const lower = seg.toLowerCase();

    if (lower.startsWith("type")) {
      const [, rest] = seg.split(/type\s*[:=]/i);
      if (rest?.trim()) {
        type = rest.trim();
      } else {
        logger.warn(`⚠️ Manual memory: type specified but empty`);
      }
    }

    if (lower.startsWith("tags")) {
      const [, rest] = seg.split(/tags\s*[:=]/i);
      if (rest?.trim()) {
        tags = rest
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean);

        if (tags.length === 0) {
          logger.warn(`⚠️ Manual memory: tags specified but empty after parsing`);
          tags = undefined;
        }
      } else {
        logger.warn(`⚠️ Manual memory: tags specified but empty`);
      }
    }
  }

  return { command: { summary, type, tags } };
}

export async function handleMessage(message: Message): Promise<string | null> {
  let userText = message.content?.trim();
  const channelId = message.channelId; // Get channel ID for per-channel memory

  // Check for voice messages or audio attachments
  if (isWhisperEnabled() && message.attachments.size > 0) {
    for (const [, attachment] of message.attachments) {
      // Check if it's an audio file
      const isAudio =
        attachment.contentType?.startsWith("audio/") ||
        /\.(mp3|wav|ogg|m4a|webm|flac)$/i.test(attachment.name || "");

      if (isAudio) {
        logger.info(`🎤 Voice message detected: ${attachment.name}`);

        try {
          const transcription = await transcribeFromUrl(attachment.url);

          if (transcription) {
            const transcribedText = `[Voice Message Transcription]: ${transcription.text}`;
            logger.info(`✅ Transcribed: "${transcription.text}"`);

            // Add transcription to user text
            if (userText) {
              userText = `${userText}\n\n${transcribedText}`;
            } else {
              userText = transcribedText;
            }

            // Optionally send transcription back to user
            if (process.env.WHISPER_SEND_TRANSCRIPTION === "true") {
              await message.reply(`📝 Transcription: "${transcription.text}"`);
            }
          }
        } catch (error: any) {
          logger.error(`❌ Voice transcription failed: ${error.message}`);
        }
      }
    }
  }

  // Check for file attachments (text, images, PDFs, etc.)
  if (message.attachments.size > 0) {
    for (const [, attachment] of message.attachments) {
      const fileName = attachment.name || "";
      const ext = path.extname(fileName).toLowerCase();

      // Check if it's a plain text file
      const isTextFile = [".txt", ".md", ".json", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h", ".css", ".html", ".xml", ".yaml", ".yml", ".log"].includes(ext);

      // Check if it's a Word document
      const isWordDoc = [".doc", ".docx"].includes(ext);

      // Check if it's an image
      const isImage =
        attachment.contentType?.startsWith("image/") ||
        [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg", ".avif", ".heic"].includes(ext);

      // Check if it's a PDF
      const isPdf = ext === ".pdf";

      // Process plain text files (no OCR needed, just download and read)
      if (isTextFile) {
        logger.info(`📄 Text file detected: ${fileName}`);

        try {
          const response = await fetch(attachment.url);

          if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
          }

          const fileContent = await response.text();
          const truncatedContent = fileContent.length > 50000
            ? fileContent.substring(0, 50000) + "\n... (truncated, file too large)"
            : fileContent;

          const textFileContent = `[File Content from ${fileName}]:\n${truncatedContent}`;
          logger.info(`✅ Read ${fileContent.length} characters from text file: ${fileName}`);

          // Add file content to user text
          if (userText) {
            userText = `${userText}\n\n${textFileContent}`;
          } else {
            userText = textFileContent;
          }

          logger.info(`📄 Text file content added to message context for AI processing`);
        } catch (error: any) {
          logger.error(`❌ Text file reading failed: ${error.message}`);
        }
      } else if (isWordDoc) {
        logger.info(`📝 Word document detected: ${fileName}`);

        try {
          // Download the Word document to temp directory
          const tempDir = path.join(process.cwd(), "temp");
          await fs.mkdir(tempDir, { recursive: true });

          const tempPath = path.join(tempDir, `doc_${Date.now()}_${fileName}`);
          const response = await fetch(attachment.url);

          if (!response.ok) {
            throw new Error(`Failed to download document: ${response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

          const extractedText = await processWordDocument(tempPath, fileName);

          // Clean up temp file
          await fs.unlink(tempPath).catch(() => {});

          if (extractedText && extractedText.trim()) {
            const truncatedText = extractedText.length > 50000
              ? extractedText.substring(0, 50000) + "\n... (truncated, document too large)"
              : extractedText;

            const docText = `[Word Document Content from ${fileName}]:\n${truncatedText}`;
            logger.info(`✅ Extracted ${extractedText.length} characters from Word document`);

            // Add document text to user text
            if (userText) {
              userText = `${userText}\n\n${docText}`;
            } else {
              userText = docText;
            }
          }
        } catch (error: any) {
          logger.error(`❌ Word document extraction failed: ${error.message}`);
        }
      } else if (isImage) {
        // Use hybrid vision processing (auto-routes to OpenRouter or Google Vision based on filename)
        logger.info(`📷 Image detected: ${fileName}`);

        if (isVisionEnabled()) {
          try {
            // Download the image to temp directory
            const tempDir = path.join(process.cwd(), "temp");
            await fs.mkdir(tempDir, { recursive: true });

            const tempPath = path.join(tempDir, `vision_${Date.now()}_${fileName}`);
            const response = await fetch(attachment.url);

            if (!response.ok) {
              throw new Error(`Failed to download image: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

            // Pass filename so describeImage can route to the appropriate service
            const description = await describeImage(tempPath, fileName);

            // Clean up temp file
            await fs.unlink(tempPath).catch(() => {});

            if (description && description.trim()) {
              const visionText = `[Image Analysis]: ${description.trim()}`;
              logger.info(`✅ Image analysis completed`);

              // Add vision description to user text
              if (userText) {
                userText = `${userText}\n\n${visionText}`;
              } else {
                userText = visionText;
              }
            }
          } catch (error: any) {
            logger.error(`❌ Image analysis failed: ${error.message}`);
          }
        }
      } else if (isPdf && isPdfParsingEnabled()) {
        logger.info(`📄 PDF detected for text extraction: ${fileName}`);

        try {
          // Download the PDF to temp directory
          const tempDir = path.join(process.cwd(), "temp");
          await fs.mkdir(tempDir, { recursive: true });

          const tempPath = path.join(tempDir, `pdf_${Date.now()}_${fileName}`);
          const response = await fetch(attachment.url);

          if (!response.ok) {
            throw new Error(`Failed to download PDF: ${response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

          const extractedText = await processAttachment(tempPath, fileName);

          // Clean up temp file
          await fs.unlink(tempPath).catch(() => {});

          if (extractedText && extractedText.trim()) {
            const pdfText = `[PDF Content]: ${extractedText.trim()}`;
            logger.info(`✅ Extracted ${extractedText.length} characters from PDF`);

            // Add PDF text to user text
            if (userText) {
              userText = `${userText}\n\n${pdfText}`;
            } else {
              userText = pdfText;
            }
          }
        } catch (error: any) {
          logger.error(`❌ PDF extraction failed: ${error.message}`);
        }
      }
    }
  }

  if (!userText) return null;

  const userId = message.author.id;
  const userName = message.author.username;
  const userDisplayName = message.author.displayName || userName;

  // Ghost Touch: Check if this is the known person
  const GHOST_TOUCH_USER_ID = process.env.GHOST_TOUCH_USER_ID;
  const isKnownPerson = !!(GHOST_TOUCH_USER_ID && userId === GHOST_TOUCH_USER_ID);

  if (isKnownPerson) {
    logger.info(`👻 Ghost Touch: Recognized known person - ${userDisplayName} (${userId})`);
  }

  // STRICT MEMORY SYSTEM SEPARATION
  // Detect if this is an RP channel (based on category) or regular channel/DM
  const useRPMemory = isRPChannel(message);
  const memorySystemDesc = getMemorySystemDescription(message);
  logger.info(`🧠 Memory System: ${memorySystemDesc}`);

  // Check for URLs in the message and fetch their content
  // Fetch for all channels, but only save separately as ephemeral for non-RP channels
  if (isUrlFetchEnabled()) {
    const urls = extractUrls(userText);

    if (urls.length > 0) {
      logger.info(`🔗 Detected ${urls.length} URL(s) in message`);

      // Fetch content for each URL (limit to 3 to avoid spam)
      for (const url of urls.slice(0, 3)) {
        const fetched = await fetchUrlContent(url);

        if (fetched.success && fetched.content) {
          // Format differently for YouTube transcripts vs regular webpages
          const contentType = fetched.isYouTube ? "YouTube Transcript" : "URL Content";
          const urlContent = `[${contentType}] ${url}${fetched.title ? `\nTitle: ${fetched.title}` : ''}\n${fetched.content}`;

          // Add to current message context so the AI can respond to it immediately
          userText = `${userText}\n\n${urlContent}`;

          // For non-RP channels, also save URL content separately as ephemeral
          // (RP channels don't support ephemeral, so URL content just goes in the conversation)
          if (!useRPMemory) {
            await addToMemory(userId, "assistant", urlContent, true); // ephemeral = true
            logger.info(`✅ ${contentType} fetched and saved to STM (ephemeral): ${url}`);
          } else {
            logger.info(`✅ ${contentType} fetched (added to current context): ${url}`);
          }
        }
      }
    }
  }

  // Route to appropriate memory system based on channel type
  let memory;
  if (useRPMemory) {
    // RP CATEGORY CHANNELS → Use RP memory tables (rp_*) with PER-CHANNEL separation
    logger.info(`🎭 Using RP memory system (rp_* tables) - Channel: ${channelId}`);
    // Bootstrap RP STM from channel history BEFORE adding current message (e.g. after redeploy)
    if (getRPSTMSize(userId, channelId) === 0 && message.client.user?.id) {
      await loadRPSTMFromChannel(message.channel as any, userId, channelId, message.client.user.id);
    }
    await addToRPMemory(userId, channelId, "user", userText);
    memory = await getRPMemoryContext(userId, channelId, userText, message.channel, message.client.user?.id);
  } else {
    // REGULAR CHANNELS & DMs → Use regular memory tables
    logger.info(`💬 Using regular memory system (continuum tables)`);
    // Bootstrap STM from channel history BEFORE adding current message (e.g. after redeploy)
    if (getSTMSize(userId) === 0 && message.client.user?.id) {
      await loadSTMFromChannel(message.channel as any, userId, message.client.user.id);
    }
    await addToMemory(userId, "user", userText);
    memory = await getMemoryContext(userId, userText, message.channel, message.client.user?.id);
  }

  const packet = {
    userText,
    stm: memory.stm,
    persona: memory.persona,
    human: memory.human,
    archival: memory.archival,
    referenceTexts: memory.referenceTexts || '',
    rpMemories: 'rpMemories' in memory ? memory.rpMemories : '', // Cross-reference RP memories (only in regular mode)
    authorId: message.author.id,
    authorName: message.author.username,
    authorDisplayName: userDisplayName,
    isKnownPerson, // Ghost Touch
    isRPMode: useRPMemory, // Pass RP channel flag for tool filtering
    message, // Pass Discord message for tool execution
  };

  try {
    let { reply } = await think(packet);

    // Check if AI chose to skip responding (when AUTOMATIC_RESPONSES=false)
    if (reply && (reply.toLowerCase().includes("[skip]") || reply.toLowerCase().trim() === "skip")) {
      logger.info("💬 AI chose to skip responding to this message");
      return null;
    }

    // Check if reply has actual content (not just whitespace or braces)
    let hasActualContent = reply && reply.trim().length > 0 && !/^[\s\{\}]+$/.test(reply.trim());

    // If response is empty and skip mode is enabled, retry once to ask for explicit skip/respond choice
    if (!hasActualContent && process.env.AUTOMATIC_RESPONSES === "false") {
      logger.warn("⚠️ AI generated empty response - asking for explicit skip or respond choice");

      // Add a system prompt to the packet asking for explicit choice
      const retryPacket = {
        ...packet,
        userText: `[SYSTEM: Your previous response was empty. Please choose: respond to the message above, or explicitly say "[skip]" if you don't want to respond.]`
      };

      const retryResult = await think(retryPacket);
      reply = retryResult.reply;

      // Check again for skip
      if (reply && (reply.toLowerCase().includes("[skip]") || reply.toLowerCase().trim() === "skip")) {
        logger.info("💬 AI chose to skip responding after retry");
        return null;
      }

      // Check if retry generated content
      hasActualContent = reply && reply.trim().length > 0 && !/^[\s\{\}]+$/.test(reply.trim());

      if (!hasActualContent) {
        logger.warn("💬 AI still generated empty response after retry - treating as implicit skip");
        return null;
      }
    }

    if (hasActualContent) {
      // In NON-RP mode: strip internal thoughts from visible message (but still archive them separately)
      // In RP mode: keep thoughts visible for narrative immersion
      // Internal thoughts use [brackets] to avoid conflicting with markdown *asterisks*
      let visibleReply = reply;
      if (!useRPMemory) {
        // Strip thoughts (text in [brackets]) from non-RP messages
        // Thoughts are still archived separately below - user can ask to see them later
        // Replace with space (not empty) to prevent words from bleeding together
        // Uses * instead of + to also catch empty brackets []
        // IMPORTANT: Only collapse multiple spaces, NOT newlines (preserve line breaks)
        visibleReply = reply.replace(/\[[^\]]*\]/g, ' ').replace(/ +/g, ' ').trim();

        // If stripping thoughts left the message empty, send the original
        // (This handles cases where the entire response was just thoughts)
        if (visibleReply.length === 0 || /^[\s\{\}]+$/.test(visibleReply)) {
          visibleReply = reply;
        }
      }

      // Clean up excessive line breaks (reduce 3+ newlines to just 2, which shows as one blank line)
      visibleReply = visibleReply.replace(/\n{3,}/g, '\n\n');

      await sendLargeMessage(message, visibleReply);

      // Save VISIBLE reply (without thoughts in non-RP) to the same memory system used for user message
      if (useRPMemory) {
        await addToRPMemory(userId, channelId, "assistant", reply);
      } else {
        await addToMemory(userId, "assistant", visibleReply); // Save visible version (thoughts stripped)
      }

      // Extract and archive internal monologue (thoughts in [brackets]) SEPARATELY
      // In non-RP: thoughts are hidden from user but archived - shareable when user asks
      // In RP: thoughts are visible AND archived
      // This archives to the appropriate memory system (RP or regular)
      await archiveInternalMonologue(userId, reply, useRPMemory, channelId);

      // Auto-archives when STM fills up
    } else {
      logger.info("💬 Response was empty or only whitespace/braces (tool-only response or no response)");
    }

    return reply || null;
  } catch (err) {
    logger.error("Brain error:", err);
    return "Something glitched in my head for a second. Can you say that again?";
  }
}
