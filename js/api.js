// Open-Meteo fetch layer. No keys required.
// Docs: https://open-meteo.com/en/docs
//
// We always fetch in metric (°C, mm, km/h). Imperial display conversion
// happens in ui/format.js so metrics.js thresholds can stay unit-free.
//
// Slow-moving endpoints (reverse geocode, historical archive) are cached
// in localStorage via cache.js. The forecast is never cached — gardeners
// need current frost and watering data.

import { getCached, setCached } from "./cache.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_TTL_MS = 30 * DAY_MS;

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const REVERSE_URL = "https://geocoding-api.open-meteo.com/v1/reverse";

const CURRENT_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "apparent_temperature",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
];

const HOURLY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "precipitation",
  "precipitation_probability",
  "soil_temperature_0cm",
  "soil_temperature_6cm",
  "soil_temperature_18cm",
  "soil_moisture_0_to_1cm",
  "soil_moisture_1_to_3cm",
  "soil_moisture_3_to_9cm",
  "et0_fao_evapotranspiration",
  "uv_index",
  "shortwave_radiation",
  "wind_speed_10m",
  "cloud_cover",
];

const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "precipitation_hours",
  "et0_fao_evapotranspiration",
  "uv_index_max",
  "shortwave_radiation_sum",
  "wind_speed_10m_max",
  "sunrise",
  "sunset",
  "daylight_duration",
  "weather_code",
];

/**
 * Fetch a full gardener-relevant forecast bundle (always metric).
 * @param {{ lat: number, lon: number }} opts
 * @returns {Promise<object>} Raw Open-Meteo response.
 */
export async function fetchForecast({ lat, lon }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: CURRENT_VARS.join(","),
    hourly: HOURLY_VARS.join(","),
    daily: DAILY_VARS.join(","),
    timezone: "auto",
    past_days: "3",
    forecast_days: "7",
  });

  const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Forecast request failed (${res.status})`);
  return res.json();
}

/**
 * Fetch daily minimum temperatures from the ERA5 archive over a range of
 * years. Used to estimate USDA hardiness zone from the average annual
 * extreme minimum temperature.
 *
 * @param {{ lat: number, lon: number, years?: number }} opts
 * @returns {Promise<{ time: string[], temperature_2m_min: number[] }>}
 */
export async function fetchHistoricalMinima({ lat, lon, years = 5 }) {
  const end = new Date();
  // ERA5 has ~5-day ingest lag; use last-year's Dec 31 as the end to be safe.
  const endYear = end.getFullYear() - 1;
  const startYear = endYear - (years - 1);
  // ~11 km grid cells, so 2-decimal coords collapse near-duplicate lookups.
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)},${startYear}-${endYear}`;
  const hit = getCached("archive", cacheKey, ARCHIVE_TTL_MS);
  if (hit) return hit;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: `${startYear}-01-01`,
    end_date: `${endYear}-12-31`,
    daily: "temperature_2m_min",
    timezone: "auto",
  });
  const res = await fetch(`${ARCHIVE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Historical request failed (${res.status})`);
  const data = await res.json();
  const daily = data?.daily || { time: [], temperature_2m_min: [] };
  if (daily.time?.length) setCached("archive", cacheKey, daily);
  return daily;
}

/**
 * Reverse geocode a coordinate to a human-readable place name.
 * Falls back gracefully — returns null if the service is unreachable.
 */
export async function reverseGeocode({ lat, lon }) {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = getCached("geo", cacheKey, Infinity);
  if (hit) return hit;
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      count: "1",
      language: "en",
      format: "json",
    });
    const res = await fetch(`${REVERSE_URL}?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return null;
    const out = { name: result.name, admin1: result.admin1, country: result.country };
    setCached("geo", cacheKey, out);
    return out;
  } catch {
    return null;
  }
}
