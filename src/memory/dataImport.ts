//--------------------------------------------------------------
//  DATA INGEST - pulls txt/doc/docx files into LTM
//--------------------------------------------------------------

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { DistilledMemory } from "./types.js";
import { logger } from "../utils/logger.js";
import { processWordDocument } from "../features/documentProcessor.js";

const DATA_DIR = path.resolve("data");
const MAX_SUMMARY_LENGTH = 4000;

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_LENGTH) return text.trim();
  return `${text.slice(0, MAX_SUMMARY_LENGTH).trim()} ...`;
}

async function readTxt(filePath: string): Promise<string> {
  return fsp.readFile(filePath, "utf8");
}

async function readFileContents(filePath: string, ext: string, fileName: string): Promise<string> {
  switch (ext) {
    case ".txt":
      return readTxt(filePath);
    case ".docx":
    case ".doc":
      const extracted = await processWordDocument(filePath, fileName);
      return extracted || "";
    default:
      logger.warn(`Unsupported data file type: ${ext} (${filePath})`);
      return "";
  }
}

export async function importDataFiles(): Promise<DistilledMemory[]> {
  try {
    if (!fs.existsSync(DATA_DIR)) return [];

    const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
    const files = entries.filter(
      (e) =>
        e.isFile() && [".txt", ".docx", ".doc"].includes(path.extname(e.name).toLowerCase())
    );

    const memories: DistilledMemory[] = [];

    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      const fullPath = path.join(DATA_DIR, file.name);

      try {
        const text = (await readFileContents(fullPath, ext, file.name)).trim();
        if (!text) continue;

        const stats = await fsp.stat(fullPath);
        const summary = truncate(text);

        memories.push({
          summary: `File ${file.name}: ${summary}`,
          type: "data-import",
          enabled: true,
          source: `data-file:${file.name}`,
          tags: ["data-import", ext.replace(".", "")],
          createdAt: Math.round(stats.mtimeMs || Date.now()),
        });
      } catch (err) {
        logger.warn(`Failed to import data file ${file.name}:`, err);
      }
    }

    return memories;
  } catch (err) {
    logger.warn("Data import failed:", err);
    return [];
  }
}
