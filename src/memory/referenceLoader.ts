//--------------------------------------------------------------
// FILE: src/memory/referenceLoader.ts
// Loads .txt files from /data and commits them to reference_texts table
// Each paragraph becomes a separate entry with embeddings
// On boot: checks for file changes, deduplicates, and updates
//--------------------------------------------------------------

import { query } from '../db/db.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { processWordDocument } from '../features/documentProcessor.js';

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://localhost:3000';
const DATA_DIR = path.join(process.cwd(), 'data');

// Files to EXCLUDE from reference text loading
// These contain backstory/lore that shouldn't influence current relationship tracking
const EXCLUDED_FILES: string[] = [
  'Valentino Family',  // Contains family backstory lore, not current relationships
  // Add more exclusions here as needed
];

/**
 * Check if a file should be excluded from reference loading
 */
function isExcludedFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return EXCLUDED_FILES.some(pattern =>
    lowerName.includes(pattern.toLowerCase())
  );
}

/**
 * Generate SHA256 hash of file contents for change detection
 */
function hashFileContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate stable content hash for paragraph deduplication
 */
function hashParagraph(sourceFile: string, paragraphNumber: number, content: string): string {
  // Use source file + paragraph number + content for stable ID
  // This ensures same paragraph = same ID across reloads
  const canonical = `${sourceFile}::${paragraphNumber}::${content.trim()}`;
  return crypto.createHash('sha256').update(canonical).digest('hex').substring(0, 32);
}

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Embedding service error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.embedding || !Array.isArray(result.embedding)) {
      throw new Error(`Invalid embedding response: missing embedding array`);
    }
    return result.embedding;
  } catch (error: any) {
    logger.error(`❌ Embedding failed for text "${text.substring(0, 50)}...": ${error.message}`);
    throw error;
  }
}

/**
 * Split text into paragraphs (separated by blank lines or double newlines)
 */
function splitIntoParagraphs(text: string): string[] {
  // Split on double newlines or multiple consecutive newlines
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return paragraphs;
}

/**
 * Check if file has changed since last load
 */
async function hasFileChanged(fileName: string, fileHash: string): Promise<boolean> {
  const result = await query<{ file_hash: string }>(`
    SELECT metadata->>'file_hash' as file_hash
    FROM reference_texts
    WHERE source_file = $1
    LIMIT 1
  `, [fileName]);

  if (result.length === 0) {
    return true; // File not in DB yet
  }

  return result[0].file_hash !== fileHash;
}

/**
 * Load a single .txt or .docx file and commit it to the database
 * Checks for changes and deduplicates
 */
export async function loadTextFile(filePath: string, forceReload = false): Promise<void> {
  try {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Read file - handle both .txt and .docx
    let content: string;
    if (ext === '.docx' || ext === '.doc') {
      const extracted = await processWordDocument(filePath, fileName);
      if (!extracted) {
        logger.warn(`⚠️  Failed to extract text from ${fileName} - skipping`);
        return;
      }
      content = extracted;
    } else {
      content = await fs.readFile(filePath, 'utf-8');
    }

    const fileHash = hashFileContent(content);

    // Check if file has changed
    if (!forceReload && !(await hasFileChanged(fileName, fileHash))) {
      // No changes - skip silently to reduce log spam
      return;
    }

    // Only log when actually processing changes
    logger.info(`📖 Reloading reference text: ${fileName}`);

    // Delete old entries for this file
    await query(`DELETE FROM reference_texts WHERE source_file = $1`, [fileName]);

    // Split into paragraphs
    const paragraphs = splitIntoParagraphs(content);
    logger.info(`  → Processing ${paragraphs.length} paragraphs`);

    // Process each paragraph
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const paragraphNumber = i + 1;

      try {
        // Generate stable ID based on content for deduplication
        const id = `ref_${hashParagraph(fileName, paragraphNumber, paragraph)}`;

        // Get embedding
        const embedding = await getEmbedding(paragraph);

        // Insert into database
        const result = await query<{ id: string }>(`
          INSERT INTO reference_texts
          (id, source_file, paragraph_number, content, embedding, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            source_file = EXCLUDED.source_file,
            paragraph_number = EXCLUDED.paragraph_number,
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata
          RETURNING id
        `, [
          id,
          fileName,
          paragraphNumber,
          paragraph,
          JSON.stringify(embedding),
          JSON.stringify({
            file_hash: fileHash,
            loaded_at: Date.now(),
            char_count: paragraph.length,
            word_count: paragraph.split(/\s+/).length
          })
        ]);

        if (result.length > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (error: any) {
        logger.error(`  ❌ Failed to process paragraph ${paragraphNumber}: ${error.message}`);
      }
    }

    logger.info(`  ✅ ${fileName}: ${inserted} paragraphs loaded, ${skipped} skipped (duplicates)`);
  } catch (error: any) {
    logger.error(`❌ Failed to load file ${filePath}: ${error.message}`);
  }
}

/**
 * Load all .txt and .docx files from /data directory
 * Checks for changes on boot, deduplicates, and updates
 */
export async function loadAllTextFiles(forceReload = false): Promise<void> {
  try {
    logger.info(`📚 Loading reference texts from ${DATA_DIR}`);

    // Check if reference_texts table is empty - if so, force reload
    const countResult = await query<{ count: string }>(`SELECT COUNT(*) as count FROM reference_texts`);
    const existingCount = parseInt(countResult[0]?.count || '0');

    if (existingCount === 0) {
      logger.info(`📚 Reference texts table is empty - forcing full reload`);
      forceReload = true;
    } else {
      logger.info(`📚 Found ${existingCount} existing reference text paragraphs`);
    }

    // Ensure data directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Read directory
    const files = await fs.readdir(DATA_DIR);
    const supportedExtensions = ['.txt', '.docx', '.doc'];
    const textFiles = files.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return supportedExtensions.includes(ext);
    });

    if (textFiles.length === 0) {
      logger.warn(`⚠️  No .txt, .doc, or .docx files found in ${DATA_DIR}`);
      return;
    }

    logger.info(`📁 Found ${textFiles.length} text file(s) (.txt, .doc, .docx)`);

    // Process each file
    let processed = 0;
    let skipped = 0;
    let excluded = 0;

    for (const file of textFiles) {
      // Check if file should be excluded
      if (isExcludedFile(file)) {
        logger.info(`📁 Skipping excluded file: ${file}`);
        excluded++;
        continue;
      }

      const filePath = path.join(DATA_DIR, file);
      const beforeCount = await query<{ count: string }>(`SELECT COUNT(*) as count FROM reference_texts`);

      await loadTextFile(filePath, forceReload);

      const afterCount = await query<{ count: string }>(`SELECT COUNT(*) as count FROM reference_texts`);
      const added = parseInt(afterCount[0].count) - parseInt(beforeCount[0].count);

      if (added > 0) {
        processed++;
      } else {
        skipped++;
      }
    }

    // Final count
    const finalCount = await query<{ count: string }>(`SELECT COUNT(*) as count FROM reference_texts`);
    const totalParagraphs = parseInt(finalCount[0]?.count || '0');

    logger.info(`✅ Reference texts loaded: ${processed} files updated, ${skipped} unchanged, ${excluded} excluded`);
    logger.info(`📚 Total reference text paragraphs in database: ${totalParagraphs}`);

    if (totalParagraphs === 0) {
      logger.warn(`⚠️  WARNING: No reference texts in database! Check embedding service at ${EMBEDDING_SERVICE_URL}`);
    }
  } catch (error: any) {
    logger.error(`❌ Failed to load reference texts: ${error.message}`);
  }
}

/**
 * Search reference texts by semantic similarity
 */
export async function searchReferenceTexts(
  queryText: string,
  limit = 5,
  sourceFile?: string
): Promise<Array<{
  content: string;
  sourceFile: string;
  paragraphNumber: number;
  similarity: number;
}>> {
  try {
    // First check if we have any reference texts at all
    const countResult = await query<{ count: string }>(`SELECT COUNT(*) as count FROM reference_texts`);
    const totalTexts = parseInt(countResult[0]?.count || '0');

    if (totalTexts === 0) {
      logger.debug(`📖 No reference texts found in database (table is empty)`);
      return [];
    }

    logger.debug(`📖 Searching ${totalTexts} reference text paragraphs for query: "${queryText.substring(0, 50)}..."`);

    const queryEmbedding = await getEmbedding(queryText);

    let sql = `
      SELECT
        content,
        source_file as "sourceFile",
        paragraph_number as "paragraphNumber",
        1 - (embedding <=> $1::vector) as similarity
      FROM reference_texts
    `;

    const params: any[] = [JSON.stringify(queryEmbedding)];

    if (sourceFile) {
      sql += ` WHERE source_file = $2`;
      params.push(sourceFile);
      sql += ` ORDER BY embedding <=> $1::vector LIMIT $3`;
      params.push(limit);
    } else {
      sql += ` ORDER BY embedding <=> $1::vector LIMIT $2`;
      params.push(limit);
    }

    const results = await query(sql, params);
    logger.debug(`📖 Found ${results.length} relevant reference text paragraphs`);

    return results;
  } catch (error: any) {
    logger.error(`❌ Failed to search reference texts: ${error.message}`);
    return [];
  }
}

/**
 * Format reference texts for prompt
 */
export function formatReferenceForPrompt(results: Array<{
  content: string;
  sourceFile: string;
  paragraphNumber: number;
  similarity: number;
}>): string {
  if (!results || results.length === 0) return '';

  const formatted = results.map((ref, i) => {
    const simValue = ref.similarity ? Number(ref.similarity) : null;
    const sim = simValue !== null && !isNaN(simValue) ? ` (${(simValue * 100).toFixed(0)}% relevant)` : '';
    return `${i + 1}. [${ref.sourceFile} - ¶${ref.paragraphNumber}]${sim}\n   ${ref.content}`;
  }).join('\n\n');

  return `# REFERENCE MATERIALS\n\n${formatted}`;
}
