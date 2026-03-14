// FILE: src/features/visionProcessor.ts
//--------------------------------------------------------------
// Hybrid Vision Processing:
// - OpenRouter (free) for general photos and images
// - Google Cloud Vision API for screenshots with text (OCR)
//--------------------------------------------------------------

import { logger } from "../utils/logger.js";
import vision from "@google-cloud/vision";
import fetch from "node-fetch";
import fs from "fs/promises";

const VISION_ENABLED = process.env.VISION_ENABLED === "true";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GOOGLE_CLOUD_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Free vision models available on OpenRouter
const MODELS = [
  "nvidia/nemotron-nano-12b-v2-vl:free", // Primary: NVIDIA Nemotron Nano 12B - confirmed free
];

let visionClient: vision.ImageAnnotatorClient | null = null;

//--------------------------------------------------------------
// Initialize Google Cloud Vision Client (lazy initialization)
//--------------------------------------------------------------

function getVisionClient(): vision.ImageAnnotatorClient | null {
  // Check if we have credentials configured
  if (!GOOGLE_CLOUD_API_KEY && !GOOGLE_APPLICATION_CREDENTIALS) {
    return null;
  }

  if (!visionClient) {
    try {
      // Initialize with either API key or service account credentials
      if (GOOGLE_CLOUD_API_KEY) {
        logger.info("🔑 Initializing Google Cloud Vision with API key...");
        visionClient = new vision.ImageAnnotatorClient({
          apiKey: GOOGLE_CLOUD_API_KEY,
        });
      } else if (GOOGLE_APPLICATION_CREDENTIALS) {
        // The library automatically uses GOOGLE_APPLICATION_CREDENTIALS env var
        logger.info("🔑 Initializing Google Cloud Vision with service account credentials...");
        visionClient = new vision.ImageAnnotatorClient();
      }
      
      logger.info("✅ Google Cloud Vision client initialized");
    } catch (error: any) {
      logger.error(`❌ Failed to initialize Google Cloud Vision client: ${error.message}`);
      return null;
    }
  }

  return visionClient;
}

export function isVisionEnabled(): boolean {
  return VISION_ENABLED && !!OPENROUTER_API_KEY;
}

export function isGoogleVisionEnabled(): boolean {
  return VISION_ENABLED && (!!GOOGLE_CLOUD_API_KEY || !!GOOGLE_APPLICATION_CREDENTIALS);
}

//--------------------------------------------------------------
// Check if filename suggests it's a screenshot (for routing)
//--------------------------------------------------------------

export function likelyContainsText(filename: string): boolean {
  const lowerName = filename.toLowerCase();

  // Common screenshot naming patterns
  const screenshotPatterns = [
    "screenshot",
    "screen shot",
    "screen_shot",
    "capture",
    "snap",
    "image_",
    "img_",
    "pic_",
    "photo_",
    "scr_",
  ];

  // Check if filename contains screenshot indicators
  const isScreenshot = screenshotPatterns.some(pattern => lowerName.includes(pattern));

  // Also check for timestamp patterns common in screenshots
  const hasTimestamp = /\d{8}|\d{6}|\d{4}-\d{2}-\d{2}/.test(lowerName);

  return isScreenshot || (hasTimestamp && (lowerName.includes("png") || lowerName.includes("jpg")));
}

//--------------------------------------------------------------
// OpenRouter Vision (for general photos)
//--------------------------------------------------------------

async function tryModel(
  model: string,
  imageBase64: string,
  retries: number = 2
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        logger.info(`Retry ${attempt}/${retries} for model ${model}...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Describe this image in detail. What do you see?"
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${imageBase64}`
                  }
                }
              ]
            }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`Model ${model} returned ${response.status}: ${errorText}`);

        // If it's a 503 or 429, retry
        if ((response.status === 503 || response.status === 429) && attempt < retries) {
          continue;
        }

        return null;
      }

      const result = (await response.json()) as any;

      if (result.choices && result.choices[0]?.message?.content) {
        const description = result.choices[0].message.content.trim();
        logger.info(`✅ OpenRouter model succeeded: "${description.substring(0, 100)}..."`);
        return description;
      }

    } catch (error: any) {
      logger.warn(`Model ${model} attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt === retries) {
        return null;
      }
    }
  }

  return null;
}

async function describeImageWithOpenRouter(imagePath: string): Promise<string | null> {
  try {
    logger.info(`🔍 Analyzing photo with OpenRouter vision model...`);

    // Read image file and convert to base64
    const imageBuffer = await fs.readFile(imagePath);
    const imageBase64 = imageBuffer.toString("base64");

    // Try each model in order until one works
    for (const model of MODELS) {
      logger.info(`Trying OpenRouter model: ${model}`);
      const description = await tryModel(model, imageBase64);

      if (description) {
        return description;
      }
    }

    logger.error("❌ All OpenRouter vision models failed");
    return null;

  } catch (error: any) {
    logger.error(`❌ OpenRouter vision processing failed: ${error.message}`);
    return null;
  }
}

//--------------------------------------------------------------
// Google Cloud Vision (for screenshots with text)
//--------------------------------------------------------------

async function describeImageWithGoogleVision(imagePath: string): Promise<string | null> {
  const client = getVisionClient();
  if (!client) {
    logger.warn("Google Cloud Vision not configured, falling back to OpenRouter");
    return describeImageWithOpenRouter(imagePath);
  }

  try {
    logger.info(`📸 Analyzing screenshot with Google Cloud Vision API...`);

    // Read image file
    const imageBuffer = await fs.readFile(imagePath);

    // Perform multiple types of analysis for comprehensive understanding
    const [result] = await client.annotateImage({
      image: { content: imageBuffer },
      features: [
        { type: "TEXT_DETECTION" },
        { type: "LABEL_DETECTION", maxResults: 10 },
        { type: "OBJECT_LOCALIZATION", maxResults: 10 },
        { type: "WEB_DETECTION" },
      ],
    });

    // Build comprehensive description
    const descriptionParts: string[] = [];

    // Add text if found (priority for screenshots)
    if (result.textAnnotations && result.textAnnotations.length > 0) {
      const text = result.textAnnotations[0].description?.trim();
      if (text && text.length > 0) {
        descriptionParts.push(`**Text Content:**\n${text}`);
      }
    }

    // Add labels (what's in the image)
    if (result.labelAnnotations && result.labelAnnotations.length > 0) {
      const labels = result.labelAnnotations
        .slice(0, 8)
        .map((label: any) => label.description)
        .filter(Boolean)
        .join(", ");
      descriptionParts.push(`\n**Visual Elements:** ${labels}`);
    }

    // Add detected objects
    if (result.localizedObjectAnnotations && result.localizedObjectAnnotations.length > 0) {
      const objects = result.localizedObjectAnnotations
        .map((obj: any) => obj.name)
        .filter(Boolean)
        .join(", ");
      descriptionParts.push(`**Objects:** ${objects}`);
    }

    // Add web entities if available
    if (result.webDetection?.webEntities && result.webDetection.webEntities.length > 0) {
      const entities = result.webDetection.webEntities
        .slice(0, 5)
        .map((entity: any) => entity.description)
        .filter(Boolean)
        .join(", ");
      if (entities) {
        descriptionParts.push(`**Related:** ${entities}`);
      }
    }

    if (descriptionParts.length === 0) {
      logger.warn("⚠️ No meaningful data extracted from screenshot, trying OpenRouter");
      return describeImageWithOpenRouter(imagePath);
    }

    const description = descriptionParts.join("\n");
    logger.info(`✅ Google Vision API analysis completed successfully`);
    return description;

  } catch (error: any) {
    logger.error(`❌ Google Vision processing failed: ${error.message}, falling back to OpenRouter`);
    return describeImageWithOpenRouter(imagePath);
  }
}

//--------------------------------------------------------------
// Main describe image function - routes to appropriate service
//--------------------------------------------------------------

export async function describeImage(imagePath: string, filename?: string): Promise<string | null> {
  if (!isVisionEnabled()) {
    logger.warn("Vision feature not enabled");
    return null;
  }

  try {
    // Decide which service to use based on filename
    const isScreenshot = filename ? likelyContainsText(filename) : false;

    if (isScreenshot && isGoogleVisionEnabled()) {
      logger.info(`📸 Detected screenshot, routing to Google Cloud Vision for OCR`);
      return await describeImageWithGoogleVision(imagePath);
    } else {
      logger.info(`🖼️ Detected regular photo, routing to OpenRouter`);
      return await describeImageWithOpenRouter(imagePath);
    }

  } catch (error: any) {
    logger.error(`❌ Vision processing failed: ${error.message}`);
    return null;
  }
}

//--------------------------------------------------------------
// Describe image from URL
//--------------------------------------------------------------

export async function describeImageFromUrl(
  url: string,
  tempDir: string = "./temp"
): Promise<string | null> {
  if (!isVisionEnabled()) {
    return null;
  }

  try {
    // Download image
    logger.info(`📥 Downloading image for vision analysis...`);
    const response = await fetch(url);

    if (!response.ok) {
      logger.error(`❌ Failed to download image: ${response.status}`);
      return null;
    }

    // Save to temp file
    const tempPath = `${tempDir}/vision_${Date.now()}.jpg`;
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(tempPath, buffer);

    // Analyze (extract filename from URL if possible)
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1];
    const description = await describeImage(tempPath, filename);

    // Cleanup
    await fs.unlink(tempPath).catch(() => {});

    return description;
  } catch (error: any) {
    logger.error(`❌ Vision from URL failed: ${error.message}`);
    return null;
  }
}

//--------------------------------------------------------------
// Extract text from image (dedicated OCR using Google Vision)
//--------------------------------------------------------------

export async function extractTextFromImage(imagePath: string): Promise<string | null> {
  if (!isGoogleVisionEnabled()) {
    logger.warn("Google Cloud Vision not configured for OCR");
    return null;
  }

  const client = getVisionClient();
  if (!client) {
    return null;
  }

  try {
    logger.info(`📝 Extracting text from image with Google Cloud Vision API...`);

    // Read image file
    const imageBuffer = await fs.readFile(imagePath);

    // Perform text detection
    const [result] = await client.textDetection(imageBuffer);
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      logger.info("No text found in image");
      return null;
    }

    // First annotation contains the full text
    const fullText = detections[0].description?.trim();

    if (fullText) {
      logger.info(`✅ Extracted ${fullText.length} characters of text`);
      return fullText;
    }

    return null;

  } catch (error: any) {
    logger.error(`❌ Text extraction failed: ${error.message}`);
    return null;
  }
}