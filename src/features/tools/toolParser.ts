// FILE: src/features/tools/toolParser.ts
//--------------------------------------------------------------
// Tool Call Parser - Extracts tool requests from AI responses
// Uses regex-based JSON extraction
//--------------------------------------------------------------

import { ToolCall } from "./toolDefinitions.js";
import { logger } from "../../utils/logger.js";

//--------------------------------------------------------------
// Extract Tool Calls from AI Response
//--------------------------------------------------------------

export function extractToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  // Match JSON code blocks: ```json { ... } ```
  const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let match;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      let jsonStr = match[1];
      const parsed = JSON.parse(jsonStr);

      // Validate it's a tool call
      if (parsed.tool && typeof parsed.tool === "string") {
        toolCalls.push({
          tool: parsed.tool,
          parameters: parsed.parameters || {}
        });
        logger.info(`🔧 Extracted tool call: ${parsed.tool}`);
      }
    } catch (error) {
      // Try multiple repair strategies
      let jsonStr = match[1];
      let repaired = false;

      // Strategy 1: Fix extra closing braces
      try {
        const openCount = (jsonStr.match(/\{/g) || []).length;
        const closeCount = (jsonStr.match(/\}/g) || []).length;

        if (closeCount > openCount) {
          const extraBraces = closeCount - openCount;
          logger.info(`🔧 Detected ${extraBraces} extra closing brace(s), attempting to fix...`);

          let fixedJson = jsonStr;
          for (let i = 0; i < extraBraces; i++) {
            fixedJson = fixedJson.replace(/\}\s*$/, '');
          }

          const parsed = JSON.parse(fixedJson);
          if (parsed.tool && typeof parsed.tool === "string") {
            toolCalls.push({
              tool: parsed.tool,
              parameters: parsed.parameters || {}
            });
            logger.info(`🔧 ✅ Fixed (extra braces) and extracted tool call: ${parsed.tool}`);
            repaired = true;
            continue;
          }
        }
      } catch (retryError) {
        // Strategy 1 failed, try next
      }

      // Strategy 2: Parse broken JSON by extracting tool and parameters manually
      if (!repaired) {
        try {
          logger.info(`🔧 Attempting to extract tool/params from malformed JSON...`);

          // Extract tool name
          const toolMatch = jsonStr.match(/"tool":\s*"([^"]+)"/);
          if (!toolMatch) {
            throw new Error("Could not find tool name");
          }
          const tool = toolMatch[1];

          // Extract the parameters object content (everything between "parameters": { and the last })
          // This handles multi-line and complex content better
          const paramsStartMatch = jsonStr.match(/"parameters":\s*\{/);
          if (!paramsStartMatch || paramsStartMatch.index === undefined) {
            throw new Error("Could not find parameters object");
          }

          const paramsStartIdx = paramsStartMatch.index + paramsStartMatch[0].length;

          // Find the matching closing brace for parameters
          let braceCount = 1;
          let paramsEndIdx = paramsStartIdx;
          let inString = false;
          let escapeNext = false;

          for (let i = paramsStartIdx; i < jsonStr.length; i++) {
            const char = jsonStr[i];

            if (escapeNext) {
              escapeNext = false;
              continue;
            }

            if (char === '\\') {
              escapeNext = true;
              continue;
            }

            if (char === '"' && !escapeNext) {
              inString = !inString;
              continue;
            }

            if (!inString) {
              if (char === '{') {
                braceCount++;
              } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                  paramsEndIdx = i;
                  break;
                }
              }
            }
          }

          const paramsContent = jsonStr.substring(paramsStartIdx, paramsEndIdx);

          // Try to extract key-value pairs from the parameters
          const paramPairs: Record<string, any> = {};

          // Match parameter patterns: "key": "value" or "key": value
          // Use a more lenient pattern that captures until we hit a comma or closing brace
          const paramRegex = /"(\w+)":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
          let paramMatch;

          while ((paramMatch = paramRegex.exec(paramsContent)) !== null) {
            // Unescape the value (basic unescaping)
            const value = paramMatch[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            paramPairs[paramMatch[1]] = value;
          }

          // Also try to match non-string values (numbers, booleans)
          const numBoolRegex = /"(\w+)":\s*(\d+|true|false|null)/g;
          while ((paramMatch = numBoolRegex.exec(paramsContent)) !== null) {
            if (!(paramMatch[1] in paramPairs)) {
              const value = paramMatch[2];
              paramPairs[paramMatch[1]] = value === 'true' ? true : value === 'false' ? false : value === 'null' ? null : Number(value);
            }
          }

          if (Object.keys(paramPairs).length > 0) {
            logger.info(`🔧 ✅ Extracted tool call via manual parsing: ${tool} with ${Object.keys(paramPairs).length} param(s)`);
            toolCalls.push({
              tool: tool,
              parameters: paramPairs
            });
            repaired = true;
            continue;
          }
        } catch (retryError) {
          // Strategy 2 failed
          logger.info(`🔧 Manual parsing failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }

      // Strategy 3: Last resort - be extremely lenient with text/message parameters
      if (!repaired) {
        try {
          logger.info(`🔧 Last resort: extracting with lenient text parsing...`);

          // Extract tool name
          const toolMatch = jsonStr.match(/"tool":\s*"([^"]+)"/);
          if (!toolMatch) {
            throw new Error("Could not find tool name");
          }
          const tool = toolMatch[1];

          // For tools with a text/message parameter, just grab everything between the first quote and try to find the end
          const textParamMatch = jsonStr.match(/"(?:text|message)":\s*"([\s\S]*)/);
          if (textParamMatch) {
            // Take everything and try to find where it reasonably ends
            // Look for patterns like: "}} or }}} at the end
            let textContent = textParamMatch[1];

            // Remove trailing pattern: closing quote + potential closing braces
            textContent = textContent.replace(/"\s*}\s*}\s*$/, '');
            textContent = textContent.replace(/"\s*}\s*$/, '');

            // If we still have content, use it
            if (textContent.length > 0) {
              const paramKey = tool === 'send_heartbeat' ? 'message' : 'text';
              logger.info(`🔧 ✅ Extracted ${tool} via lenient parsing (${textContent.length} chars)`);
              toolCalls.push({
                tool: tool,
                parameters: { [paramKey]: textContent }
              });
              repaired = true;
              continue;
            }
          }
        } catch (retryError) {
          // All strategies failed
          logger.info(`🔧 Lenient parsing failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }

      if (!repaired) {
        logger.warn("Failed to parse JSON block as tool call after all repair attempts");
        logger.warn("Parse error:", error instanceof Error ? error.message : String(error));
        logger.warn("Malformed JSON:", match[1].substring(0, 500));
      }
    }
  }

  // Also check for bare JSON objects (without code blocks)
  if (toolCalls.length === 0) {
    // Use balanced brace matching for bare JSON (handles nested objects properly)
    const toolPattern = /\{\s*"tool"\s*:/;
    let searchPos = 0;

    while (searchPos < text.length) {
      const toolMatch = text.substring(searchPos).match(toolPattern);
      if (!toolMatch || toolMatch.index === undefined) break;

      const startIdx = searchPos + toolMatch.index;
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let endIdx = startIdx;
      let foundComplete = false;

      // Scan forward with balanced brace matching
      for (let i = startIdx; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIdx = i + 1;
              foundComplete = true;
              break;
            }
          }
        }
      }

      if (foundComplete) {
        const jsonStr = text.substring(startIdx, endIdx);
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.tool && typeof parsed.tool === "string") {
            toolCalls.push({
              tool: parsed.tool,
              parameters: parsed.parameters || {}
            });
            logger.info(`🔧 Extracted bare tool call: ${parsed.tool}`);
          }
        } catch (error) {
          // Try to fix extra closing braces
          try {
            let fixedJson = jsonStr;
            const openCount = (fixedJson.match(/\{/g) || []).length;
            const closeCount = (fixedJson.match(/\}/g) || []).length;

            if (closeCount > openCount) {
              const extraBraces = closeCount - openCount;
              logger.info(`🔧 Detected ${extraBraces} extra closing brace(s) in bare JSON, attempting to fix...`);

              for (let i = 0; i < extraBraces; i++) {
                fixedJson = fixedJson.replace(/\}\s*$/, '');
              }

              const parsed = JSON.parse(fixedJson);
              if (parsed.tool && typeof parsed.tool === "string") {
                toolCalls.push({
                  tool: parsed.tool,
                  parameters: parsed.parameters || {}
                });
                logger.info(`🔧 ✅ Fixed and extracted bare tool call: ${parsed.tool}`);
              }
            }
          } catch (retryError) {
            // Failed to fix, skip this match
          }
        }
        searchPos = endIdx;
      } else {
        // Malformed JSON, move past this match
        searchPos = startIdx + 1;
      }
    }
  }

  return toolCalls;
}

//--------------------------------------------------------------
// Helper: Remove bare tool JSON using balanced brace matching
//--------------------------------------------------------------

function stripBalancedToolJSON(text: string): string {
  let result = text;
  let changed = true;

  // Keep trying until no more tool JSON is found
  while (changed) {
    changed = false;
    const toolMatch = result.match(/\{\s*"tool"\s*:/);

    if (toolMatch && toolMatch.index !== undefined) {
      const startIdx = toolMatch.index;
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let endIdx = startIdx;

      // Scan forward to find the matching closing brace
      for (let i = startIdx; i < result.length; i++) {
        const char = result[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIdx = i + 1;
              // DON'T eat trailing braces - they might be part of actual content
              break;
            }
          }
        }
      }

      if (braceCount === 0 && endIdx > startIdx) {
        // Found a complete JSON object, remove it
        result = result.substring(0, startIdx) + result.substring(endIdx);
        changed = true;
      } else {
        // Malformed JSON, break to avoid infinite loop
        break;
      }
    }
  }

  return result;
}

//--------------------------------------------------------------
// Remove Tool Call JSON from Response Text
//--------------------------------------------------------------

export function stripToolCalls(text: string): string {
  logger.debug(`🔧 stripToolCalls INPUT: ${JSON.stringify(text)}`);
  let cleaned = text;

  // Remove JSON code blocks using brace-aware extraction
  const codeBlockRegex = /```json\s*/g;
  let match;
  const removals: Array<{start: number, end: number}> = [];

  // Find all ```json code blocks and track what to remove
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const startPos = match.index;
    const jsonStart = match.index + match[0].length;

    // Find matching ``` end tag
    const endTagPos = text.indexOf('```', jsonStart);
    if (endTagPos === -1) {
      // No closing tag - remove the orphaned ```json opener anyway
      // This prevents partial/malformed code blocks from being sent
      removals.push({start: startPos, end: jsonStart});
      continue;
    }

    // End right after closing ``` - DON'T try to eat trailing braces
    // Those might be part of actual content
    const endPos = endTagPos + 3;

    removals.push({start: startPos, end: endPos});
  }

  // Remove code blocks in reverse order to maintain indices
  for (let i = removals.length - 1; i >= 0; i--) {
    const {start, end} = removals[i];
    cleaned = cleaned.substring(0, start) + cleaned.substring(end);
  }
  logger.debug(`🔧 After removing code blocks: ${JSON.stringify(cleaned)}`);

  // Remove bare tool JSON objects using balanced brace matching
  cleaned = stripBalancedToolJSON(cleaned);
  logger.debug(`🔧 After stripBalancedToolJSON: ${JSON.stringify(cleaned)}`);

  // MINIMAL cleanup - only remove OBVIOUS orphaned braces
  // Don't do 10 passes that might eat legitimate content
  cleaned = cleaned.replace(/^\s*\}\s*$/gm, ''); // Standalone } on its own line
  cleaned = cleaned.replace(/^\s*\{\s*$/gm, ''); // Standalone { on its own line
  cleaned = cleaned.replace(/```json\s*```/g, ''); // Empty code blocks
  cleaned = cleaned.replace(/```json\s*$/gm, ''); // Orphaned ```json at end of message
  cleaned = cleaned.replace(/^\s*```json\s*/gm, ''); // Orphaned ```json at start of line
  cleaned = cleaned.replace(/```\s*$/gm, ''); // Orphaned ``` at end
  logger.debug(`🔧 After minimal cleanup: ${JSON.stringify(cleaned)}`);

  cleaned = cleaned.trim();

  // Remove common tool announcement phrases that AI sometimes adds
  const announcementPatterns = [
    /\[?\s*(?:sending|playing|here'?s)\s+(?:a\s+)?voice\s+message\s*\]?[:\-]?\s*/gi,
    /\[?\s*voice\s+message\s*\]?\s*[:\-]?\s*/gi,
    /let me (?:send|play) (?:you )?(?:a )?voice message[:\-]?\s*/gi,
    /i'?m sending (?:you )?(?:a )?voice message[:\-]?\s*/gi,
    /(?:^|\n)\s*\[voice message\]\s*(?:\n|$)/gi,
  ];

  for (const pattern of announcementPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up extra whitespace and empty lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  logger.debug(`🔧 stripToolCalls OUTPUT: ${JSON.stringify(cleaned)}`);
  return cleaned;
}

//--------------------------------------------------------------
// Format Tool Result for AI Context
//--------------------------------------------------------------

export function formatToolResult(tool: string, success: boolean, result: any, error?: string): string {
  if (!success) {
    return `[Tool: ${tool}] ❌ Error: ${error || "Unknown error"}`;
  }

  // Format based on result type
  if (typeof result === "string") {
    return `[Tool: ${tool}] ✅ ${result}`;
  }

  if (typeof result === "object" && result !== null) {
    // Pretty print objects
    try {
      return `[Tool: ${tool}] ✅ ${JSON.stringify(result, null, 2)}`;
    } catch {
      return `[Tool: ${tool}] ✅ ${String(result)}`;
    }
  }

  return `[Tool: ${tool}] ✅ ${String(result)}`;
}