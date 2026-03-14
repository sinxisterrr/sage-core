// FILE: src/features/ocrProcessor.ts
//--------------------------------------------------------------
// PDF Text Extraction
// Note: Image OCR is handled by visionProcessor.ts (Google Vision)
//--------------------------------------------------------------

import pdfParse from "pdf-parse";
import { logger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";

const PDF_PARSING_ENABLED = process.env.PDF_PARSING_ENABLED === "true";

//--------------------------------------------------------------
// Extract text from PDF
//--------------------------------------------------------------

export async function extractTextFromPDF(pdfPath: string): Promise<string | null> {
  if (!PDF_PARSING_ENABLED) {
    logger.warn("PDF parsing feature not enabled");
    return null;
  }

  try {
    const dataBuffer = await fs.readFile(pdfPath);
    const data = await pdfParse(dataBuffer);

    logger.info(`✅ PDF parsed: extracted ${data.text.length} characters from ${data.numpages} pages`);
    return data.text.trim();
  } catch (error) {
    logger.error("Error extracting text from PDF:", error);
    return null;
  }
}

//--------------------------------------------------------------
// Process PDF attachment
//--------------------------------------------------------------

export async function processAttachment(
  filePath: string,
  filename: string
): Promise<string | null> {
  const ext = path.extname(filename).toLowerCase();

  if (ext === ".pdf") {
    return await extractTextFromPDF(filePath);
  }

  // Images are handled by visionProcessor.ts (Google Vision + OpenRouter)
  logger.warn(`Unsupported file type for PDF extraction: ${ext}`);
  return null;
}

//--------------------------------------------------------------
// Status checks
//--------------------------------------------------------------

export function isPdfParsingEnabled(): boolean {
  return PDF_PARSING_ENABLED;
}
