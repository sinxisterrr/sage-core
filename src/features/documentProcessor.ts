// FILE: src/features/documentProcessor.ts
//--------------------------------------------------------------
// Word Document Processing (.doc, .docx)
//--------------------------------------------------------------

import mammoth from "mammoth";
// @ts-ignore - word-extractor has no type definitions
import WordExtractor from "word-extractor";
import { logger } from "../utils/logger.js";
import fs from "fs/promises";

//--------------------------------------------------------------
// Extract text from .docx file (modern Word)
//--------------------------------------------------------------

export async function extractTextFromDocx(filePath: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });

    logger.info(`✅ DOCX parsed: extracted ${result.value.length} characters`);
    return result.value.trim();
  } catch (error) {
    logger.error("Error extracting text from DOCX:", error);
    return null;
  }
}

//--------------------------------------------------------------
// Extract text from .doc file (legacy Word)
//--------------------------------------------------------------

export async function extractTextFromDoc(filePath: string): Promise<string | null> {
  try {
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(filePath);
    const text = extracted.getBody();

    logger.info(`✅ DOC parsed: extracted ${text.length} characters`);
    return text.trim();
  } catch (error) {
    logger.error("Error extracting text from DOC:", error);
    return null;
  }
}

//--------------------------------------------------------------
// Auto-detect and process Word document
//--------------------------------------------------------------

export async function processWordDocument(
  filePath: string,
  filename: string
): Promise<string | null> {
  const ext = filename.toLowerCase();

  if (ext.endsWith(".docx")) {
    return await extractTextFromDocx(filePath);
  }

  if (ext.endsWith(".doc")) {
    return await extractTextFromDoc(filePath);
  }

  logger.warn(`Unsupported Word document format: ${ext}`);
  return null;
}
