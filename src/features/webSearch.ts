// FILE: src/features/webSearch.ts
//--------------------------------------------------------------
// Web Search Integration using Exa.ai
//--------------------------------------------------------------

import axios from "axios";
import { logger } from "../utils/logger.js";
import { EmbedBuilder } from "discord.js";

const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED === "true";
const EXA_API_KEY = process.env.EXA_API_KEY;

interface SearchResult {
  title: string;
  url: string;
  description: string;
  publishedDate?: string;
  author?: string;
}

//--------------------------------------------------------------
// Search using Exa.ai (primary method)
//--------------------------------------------------------------

export async function webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  if (!WEB_SEARCH_ENABLED) {
    logger.warn("Web search feature not enabled");
    return [];
  }

  if (!EXA_API_KEY) {
    logger.warn("EXA_API_KEY not configured, falling back to basic search");
    return await fallbackSearch(query, maxResults);
  }

  try {
    const response = await axios.post(
      "https://api.exa.ai/search",
      {
        query: query,
        numResults: maxResults,
        type: "auto", // auto, keyword, or neural
        contents: {
          text: true,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": EXA_API_KEY,
        },
      }
    );

    const results: SearchResult[] = [];

    for (const item of response.data.results || []) {
      results.push({
        title: item.title || "Untitled",
        url: item.url,
        description: item.text?.substring(0, 200) || item.snippet || "",
        publishedDate: item.publishedDate,
        author: item.author,
      });
    }

    logger.info(`🔍 Exa.ai search for "${query}": found ${results.length} results`);
    return results;
  } catch (error: any) {
    logger.error("Error performing Exa.ai search:", error.response?.data || error.message);
    return await fallbackSearch(query, maxResults);
  }
}

//--------------------------------------------------------------
// Fallback: DuckDuckGo (no API key required)
//--------------------------------------------------------------

async function fallbackSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  try {
    const response = await axios.get("https://html.duckduckgo.com/html/", {
      params: { q: query },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const results: SearchResult[] = [];
    const html = response.data;

    const resultRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]+)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      results.push({
        url: match[1],
        title: match[2].trim(),
        description: match[3].trim(),
      });
    }

    logger.info(`🔍 DuckDuckGo fallback search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    logger.error("Error in fallback search:", error);
    return [];
  }
}

//--------------------------------------------------------------
// Alternative: Use SerpAPI if preferred
//--------------------------------------------------------------

const SERPAPI_KEY = process.env.SERPAPI_KEY;

export async function webSearchSerpAPI(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  if (!SERPAPI_KEY) {
    return await webSearch(query, maxResults); // Fallback to DuckDuckGo
  }

  try {
    const response = await axios.get("https://serpapi.com/search", {
      params: {
        q: query,
        api_key: SERPAPI_KEY,
        num: maxResults,
      },
    });

    const results: SearchResult[] = [];
    const organicResults = response.data.organic_results || [];

    for (const result of organicResults.slice(0, maxResults)) {
      results.push({
        title: result.title,
        url: result.link,
        description: result.snippet || "",
      });
    }

    return results;
  } catch (error) {
    logger.error("Error with SerpAPI search:", error);
    return await webSearch(query, maxResults); // Fallback
  }
}

//--------------------------------------------------------------
// Create search results embed
//--------------------------------------------------------------

export function createSearchEmbed(query: string, results: SearchResult[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Search Results: ${query}`)
    .setColor(0x5865f2)
    .setTimestamp();

  if (results.length === 0) {
    embed.setDescription("No results found.");
    return embed;
  }

  for (const result of results.slice(0, 5)) {
    embed.addFields({
      name: result.title,
      value: `${result.description.substring(0, 100)}...\n[View](${result.url})`,
    });
  }

  return embed;
}

//--------------------------------------------------------------
// Quick search - just return text summary
//--------------------------------------------------------------

export async function quickSearch(query: string): Promise<string> {
  const results = await webSearch(query, 3);

  if (results.length === 0) {
    return `No search results found for "${query}".`;
  }

  let summary = `Search results for "${query}":\n\n`;

  for (let i = 0; i < results.length; i++) {
    summary += `${i + 1}. **${results[i].title}**\n`;
    summary += `   ${results[i].description}\n`;
    summary += `   ${results[i].url}\n\n`;
  }

  return summary.trim();
}

//--------------------------------------------------------------
// Check if web search is enabled
//--------------------------------------------------------------

export function isWebSearchEnabled(): boolean {
  return WEB_SEARCH_ENABLED;
}
