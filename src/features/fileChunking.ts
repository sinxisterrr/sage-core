// FILE: src/features/fileChunking.ts
//--------------------------------------------------------------
// File Chunking & Attachment Handling
// Smart file handling with size management
//--------------------------------------------------------------

import { AttachmentBuilder, Message, TextChannel } from "discord.js";
import { logger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "25");
const CHUNK_SIZE_MB = parseInt(process.env.CHUNK_SIZE_MB || "8");

const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const CHUNK_SIZE_BYTES = CHUNK_SIZE_MB * 1024 * 1024;

const TEMP_DIR = path.join(process.cwd(), "temp");

//--------------------------------------------------------------
// Initialize
//--------------------------------------------------------------

export async function initFileChunking() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    logger.info("📁 File chunking system initialized");
  } catch (error) {
    logger.error("Error initializing file chunking:", error);
  }
}

//--------------------------------------------------------------
// Download attachment to temp folder
//--------------------------------------------------------------

export async function downloadAttachment(
  url: string,
  filename: string
): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const tempPath = path.join(TEMP_DIR, filename);

    await fs.writeFile(tempPath, Buffer.from(buffer));
    logger.info(`📥 Downloaded attachment: ${filename}`);

    return tempPath;
  } catch (error) {
    logger.error("Error downloading attachment:", error);
    return null;
  }
}

//--------------------------------------------------------------
// Check if file needs chunking
//--------------------------------------------------------------

export async function needsChunking(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size > MAX_FILE_SIZE_BYTES;
  } catch (error) {
    logger.error("Error checking file size:", error);
    return false;
  }
}

//--------------------------------------------------------------
// Split file into chunks
//--------------------------------------------------------------

export async function splitFile(filePath: string): Promise<string[]> {
  try {
    const stats = await fs.stat(filePath);
    const totalChunks = Math.ceil(stats.size / CHUNK_SIZE_BYTES);
    const chunkPaths: string[] = [];

    const fileBuffer = await fs.readFile(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE_BYTES;
      const end = Math.min((i + 1) * CHUNK_SIZE_BYTES, stats.size);
      const chunk = fileBuffer.slice(start, end);

      const chunkPath = path.join(
        TEMP_DIR,
        `${baseName}.part${i + 1}of${totalChunks}${ext}`
      );

      await fs.writeFile(chunkPath, chunk);
      chunkPaths.push(chunkPath);
    }

    logger.info(`📦 Split file into ${totalChunks} chunks`);
    return chunkPaths;
  } catch (error) {
    logger.error("Error splitting file:", error);
    return [];
  }
}

//--------------------------------------------------------------
// Send file (with chunking if needed)
//--------------------------------------------------------------

export async function sendFile(
  channel: TextChannel,
  filePath: string,
  message?: string
): Promise<boolean> {
  try {
    const needsChunkingFlag = await needsChunking(filePath);

    if (!needsChunkingFlag) {
      // Send as single file
      const attachment = new AttachmentBuilder(filePath);
      await channel.send({
        content: message || undefined,
        files: [attachment],
      });
      return true;
    }

    // Split and send chunks
    const chunks = await splitFile(filePath);
    if (chunks.length === 0) {
      logger.error("Failed to split file into chunks");
      return false;
    }

    // Send first chunk with message
    const firstAttachment = new AttachmentBuilder(chunks[0]);
    await channel.send({
      content:
        message ||
        `📦 Sending file in ${chunks.length} parts (file too large)...`,
      files: [firstAttachment],
    });

    // Send remaining chunks
    for (let i = 1; i < chunks.length; i++) {
      const attachment = new AttachmentBuilder(chunks[i]);
      await channel.send({ files: [attachment] });
      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Cleanup chunks
    for (const chunkPath of chunks) {
      await fs.unlink(chunkPath).catch(() => {});
    }

    logger.info(`✅ Sent file in ${chunks.length} parts`);
    return true;
  } catch (error) {
    logger.error("Error sending file:", error);
    return false;
  }
}

//--------------------------------------------------------------
// Forward attachment to another channel
//--------------------------------------------------------------

export async function forwardAttachment(
  message: Message,
  targetChannelId: string
): Promise<boolean> {
  try {
    if (message.attachments.size === 0) {
      return false;
    }

    const targetChannel = await message.client.channels.fetch(targetChannelId);
    if (!targetChannel || !targetChannel.isTextBased()) {
      logger.error("Invalid target channel for forwarding");
      return false;
    }

    for (const [, attachment] of message.attachments) {
      // Download attachment
      const tempPath = await downloadAttachment(
        attachment.url,
        attachment.name
      );

      if (!tempPath) continue;

      // Send to target channel
      const forwardMessage = `📎 Forwarded from ${message.author.tag}`;
      await sendFile(targetChannel as TextChannel, tempPath, forwardMessage);

      // Cleanup
      await fs.unlink(tempPath).catch(() => {});
    }

    return true;
  } catch (error) {
    logger.error("Error forwarding attachment:", error);
    return false;
  }
}

//--------------------------------------------------------------
// Cleanup temp directory
//--------------------------------------------------------------

export async function cleanupTempFiles() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = await fs.stat(filePath);

      // Delete files older than 1 hour
      const ageInMs = Date.now() - stats.mtimeMs;
      if (ageInMs > 3600000) {
        await fs.unlink(filePath);
      }
    }
  } catch (error) {
    logger.error("Error cleaning up temp files:", error);
  }
}

//--------------------------------------------------------------
// Get file size in human-readable format
//--------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
