// Open-Meteo fetch layer. No keys required.
// Docs: https://open-meteo.com/en/docs

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
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
  "dew_point_2m",
  "precipitation",
  "soil_temperature_0cm",
  "soil_temperature_6cm",
  "soil_temperature_18cm",
  "soil_moisture_0_to_1cm",
  "soil_moisture_1_to_3cm",
  "soil_moisture_3_to_9cm",
  "et0_fao_evapotranspiration",
  "uv_index",
  "shortwave_radiation",
];

const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "et0_fao_evapotranspiration",
  "uv_index_max",
  "sunrise",
  "sunset",
  "weather_code",
];

/**
 * Fetch a full gardener-relevant forecast bundle.
 * @param {{ lat: number, lon: number, units?: "metric"|"imperial" }} opts
 * @returns {Promise<object>} Raw Open-Meteo response.
 */
export async function fetchForecast({ lat, lon, units = "metric" }) {
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

  if (units === "imperial") {
    params.set("temperature_unit", "fahrenheit");
    params.set("wind_speed_unit", "mph");
    params.set("precipitation_unit", "inch");
  }

  const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Forecast request failed (${res.status})`);
  return res.json();
}

/**
 * Reverse geocode a coordinate to a human-readable place name.
 * Falls back gracefully — returns null if the service is unreachable.
 * @param {{ lat: number, lon: number }} opts
 * @returns {Promise<{ name: string, admin1?: string, country?: string } | null>}
 */
export async function reverseGeocode({ lat, lon }) {
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
    const hit = data?.results?.[0];
    if (!hit) return null;
    return { name: hit.name, admin1: hit.admin1, country: hit.country };
  } catch {
    return null;
  }
}
