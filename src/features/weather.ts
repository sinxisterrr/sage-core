// FILE: src/features/weather.ts
//--------------------------------------------------------------
// Weather Integration using OpenWeatherMap
//--------------------------------------------------------------

import axios from "axios";
import { logger } from "../utils/logger.js";
import { EmbedBuilder } from "discord.js";

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_LOCATION = process.env.DEFAULT_LOCATION || "New York";
const WEATHER_UNITS = (process.env.WEATHER_UNITS || "imperial").toLowerCase(); // "imperial" (F) or "metric" (C)
const WEATHER_ENABLED = !!OPENWEATHER_API_KEY;

interface WeatherData {
  location: string;
  temperature: number;
  feelsLike: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  icon: string;
}

type LocationType = "city" | "zip" | "coords";

interface ParsedLocation {
  type: LocationType;
  params: Record<string, string | number>;
}

//--------------------------------------------------------------
// Parse location to detect city name, ZIP code, or coordinates
// Supports:
//   - City names: "New York", "London,UK"
//   - ZIP codes: "10001", "10001,US", "SW1A 1AA,GB"
//   - Coordinates: "40.7128,-74.0060", "40.7128, -74.0060", "lat:40.7128,lon:-74.0060"
//--------------------------------------------------------------
function parseLocation(location: string): ParsedLocation {
  const trimmed = location.trim();

  // Check for explicit coordinate format: "lat:40.7128,lon:-74.0060"
  const explicitCoordMatch = trimmed.match(/^lat:\s*(-?\d+\.?\d*)\s*,\s*lon:\s*(-?\d+\.?\d*)$/i);
  if (explicitCoordMatch) {
    return {
      type: "coords",
      params: {
        lat: parseFloat(explicitCoordMatch[1]),
        lon: parseFloat(explicitCoordMatch[2]),
      },
    };
  }

  // Check for coordinate format: "40.7128,-74.0060" or "40.7128, -74.0060"
  // Must have decimal points to distinguish from ZIP codes
  const coordMatch = trimmed.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
  if (coordMatch) {
    return {
      type: "coords",
      params: {
        lat: parseFloat(coordMatch[1]),
        lon: parseFloat(coordMatch[2]),
      },
    };
  }

  // Check for US ZIP code: 5 digits, optionally with country code
  // Examples: "10001", "10001,US", "90210"
  const usZipMatch = trimmed.match(/^(\d{5})(?:\s*,\s*([A-Za-z]{2}))?$/);
  if (usZipMatch) {
    const zipCode = usZipMatch[1];
    const country = usZipMatch[2]?.toUpperCase() || "US";
    return {
      type: "zip",
      params: { zip: `${zipCode},${country}` },
    };
  }

  // Check for international postal codes with country code
  // Examples: "SW1A 1AA,GB", "M5V 3L9,CA", "75001,FR"
  const intlZipMatch = trimmed.match(/^([A-Za-z0-9]{2,10}(?:\s+[A-Za-z0-9]{2,5})?)\s*,\s*([A-Za-z]{2})$/);
  if (intlZipMatch) {
    const postalCode = intlZipMatch[1];
    const country = intlZipMatch[2].toUpperCase();
    // Only treat as ZIP if it looks like a postal code (has numbers)
    if (/\d/.test(postalCode)) {
      return {
        type: "zip",
        params: { zip: `${postalCode},${country}` },
      };
    }
  }

  // Default: treat as city name
  return {
    type: "city",
    params: { q: trimmed },
  };
}

//--------------------------------------------------------------
// Get current weather
//--------------------------------------------------------------

export async function getCurrentWeather(location?: string): Promise<WeatherData | null> {
  if (!WEATHER_ENABLED) {
    logger.warn("Weather API not configured");
    return null;
  }

  const locationStr = location || DEFAULT_LOCATION;
  const parsed = parseLocation(locationStr);

  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather`,
      {
        params: {
          ...parsed.params,
          appid: OPENWEATHER_API_KEY,
          units: WEATHER_UNITS,
        },
      }
    );

    const data = response.data;

    return {
      location: data.name,
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      condition: data.weather[0].description,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed),
      icon: data.weather[0].icon,
    };
  } catch (error: any) {
    logger.error("Error fetching weather:", error.response?.data || error.message);
    return null;
  }
}

//--------------------------------------------------------------
// Create weather embed
//--------------------------------------------------------------

export function createWeatherEmbed(weather: WeatherData): EmbedBuilder {
  const tempUnit = WEATHER_UNITS === "metric" ? "°C" : "°F";
  const speedUnit = WEATHER_UNITS === "metric" ? "m/s" : "mph";

  return new EmbedBuilder()
    .setTitle(`🌤️ Weather for ${weather.location}`)
    .setColor(0x5865f2)
    .setThumbnail(`https://openweathermap.org/img/wn/${weather.icon}@2x.png`)
    .addFields(
      { name: "Temperature", value: `${weather.temperature}${tempUnit}`, inline: true },
      { name: "Feels Like", value: `${weather.feelsLike}${tempUnit}`, inline: true },
      { name: "Condition", value: weather.condition, inline: true },
      { name: "Humidity", value: `${weather.humidity}%`, inline: true },
      { name: "Wind Speed", value: `${weather.windSpeed} ${speedUnit}`, inline: true }
    )
    .setTimestamp();
}

//--------------------------------------------------------------
// Get weather forecast
//--------------------------------------------------------------

export async function getWeatherForecast(location?: string, days: number = 3): Promise<any[] | null> {
  if (!WEATHER_ENABLED) {
    return null;
  }

  const locationStr = location || DEFAULT_LOCATION;
  const parsed = parseLocation(locationStr);

  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/forecast`,
      {
        params: {
          ...parsed.params,
          appid: OPENWEATHER_API_KEY,
          units: WEATHER_UNITS,
          cnt: days * 8, // 8 forecasts per day (every 3 hours)
        },
      }
    );

    return response.data.list;
  } catch (error) {
    logger.error("Error fetching forecast:", error);
    return null;
  }
}

export function isWeatherEnabled(): boolean {
  return WEATHER_ENABLED;
}
