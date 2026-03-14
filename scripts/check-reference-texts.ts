#!/usr/bin/env tsx
//--------------------------------------------------------------
// Diagnostic script to check reference texts in database
//--------------------------------------------------------------

import '../src/utils/env.js';
import { query } from '../src/db/db.js';
import { searchReferenceTexts } from '../src/memory/referenceLoader.js';

async function main() {
  console.log('🔍 Checking reference texts in database...\n');

  // Check if table exists
  const tableCheck = await query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'reference_texts'
    ) as exists
  `);

  if (!tableCheck[0]?.exists) {
    console.log('❌ Table "reference_texts" does not exist!');
    process.exit(1);
  }

  console.log('✅ Table "reference_texts" exists\n');

  // Count total entries
  const countResult = await query<{ count: string }>(`
    SELECT COUNT(*) as count FROM reference_texts
  `);
  const total = parseInt(countResult[0]?.count || '0');

  console.log(`📊 Total paragraphs in database: ${total}\n`);

  if (total === 0) {
    console.log('⚠️  No reference texts found. Have you loaded them yet?');
    console.log('   Run the bot to load them, or manually run loadAllTextFiles()');
    process.exit(0);
  }

  // Show sample entries
  const samples = await query<{
    id: string;
    source_file: string;
    paragraph_number: number;
    content: string;
  }>(`
    SELECT
      id,
      source_file,
      paragraph_number,
      LEFT(content, 100) as content
    FROM reference_texts
    ORDER BY source_file, paragraph_number
    LIMIT 5
  `);

  console.log('📋 Sample entries:');
  for (const sample of samples) {
    console.log(`\n  File: ${sample.source_file}`);
    console.log(`  Paragraph: ${sample.paragraph_number}`);
    console.log(`  Content: "${sample.content}..."`);
    console.log(`  ID: ${sample.id}`);
  }

  // Test search
  console.log('\n\n🔎 Testing semantic search with query: "who I am"...\n');

  try {
    const results = await searchReferenceTexts('who I am', 3);

    if (results.length === 0) {
      console.log('❌ No results found from search');
    } else {
      console.log(`✅ Found ${results.length} results:\n`);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        console.log(`${i + 1}. [${result.sourceFile} - ¶${result.paragraphNumber}] (${(result.similarity * 100).toFixed(0)}% relevant)`);
        console.log(`   "${result.content.substring(0, 150)}..."\n`);
      }
    }
  } catch (error: any) {
    console.log(`❌ Search failed: ${error.message}`);
  }

  console.log('\n✅ Diagnostic complete');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
