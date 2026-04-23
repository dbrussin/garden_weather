// Derived gardening metrics from a raw Open-Meteo forecast.
//
// All functions here are pure. They take the raw API response and return
// small objects the UI can render directly. Keep this free of DOM code.

/**
 * Frost risk: look at the next 3 days of min temperatures.
 * Thresholds assume °C. If imperial, the caller should convert beforehand
 * or pass thresholds explicitly.
 */
export function frostRisk(daily, { warnBelow = 2, severeBelow = 0 } = {}) {
  const mins = (daily?.temperature_2m_min || []).slice(3, 6); // skip 3 past_days
  const dates = (daily?.time || []).slice(3, 6);
  let worst = { level: "none", day: null, temp: null };
  for (let i = 0; i < mins.length; i++) {
    const t = mins[i];
    if (t == null) continue;
    let level = "none";
    if (t <= severeBelow) level = "severe";
    else if (t <= warnBelow) level = "warn";
    if (rank(level) > rank(worst.level)) {
      worst = { level, day: dates[i], temp: t };
    }
  }
  return worst;
}

function rank(level) {
  return { none: 0, warn: 1, severe: 2 }[level] ?? 0;
}

/**
 * Growing degree days accumulated over the past 30 days (or however many
 * past days are present). Base temperature defaults to 10°C (common for
 * warm-season vegetables). Daily GDD = max(0, ((tmax+tmin)/2) - base).
 */
export function growingDegreeDays(daily, { base = 10 } = {}) {
  const tmax = daily?.temperature_2m_max || [];
  const tmin = daily?.temperature_2m_min || [];
  const times = daily?.time || [];
  let total = 0;
  let days = 0;
  const now = Date.now();
  for (let i = 0; i < tmax.length; i++) {
    const date = times[i] ? Date.parse(times[i]) : null;
    if (date == null || date > now) continue; // only accumulate past + today
    const hi = tmax[i];
    const lo = tmin[i];
    if (hi == null || lo == null) continue;
    total += Math.max(0, (hi + lo) / 2 - base);
    days += 1;
  }
  return { total: Math.round(total * 10) / 10, days, base };
}

/**
 * Soil snapshot from the hourly series nearest "now".
 */
export function soilSnapshot(hourly) {
  const idx = nearestHourIndex(hourly?.time || []);
  if (idx < 0) return null;
  return {
    surfaceTemp: hourly.soil_temperature_0cm?.[idx] ?? null,
    rootTemp: hourly.soil_temperature_6cm?.[idx] ?? null,
    deepTemp: hourly.soil_temperature_18cm?.[idx] ?? null,
    surfaceMoisture: hourly.soil_moisture_0_to_1cm?.[idx] ?? null,
    rootMoisture: hourly.soil_moisture_1_to_3cm?.[idx] ?? null,
    deepMoisture: hourly.soil_moisture_3_to_9cm?.[idx] ?? null,
  };
}

/**
 * Water balance: compare recent ET (water lost) against recent rainfall.
 * Positive deficit means plants are losing more than they're receiving.
 */
export function waterBalance(daily, { window = 7 } = {}) {
  const times = daily?.time || [];
  const et = daily?.et0_fao_evapotranspiration || [];
  const precip = daily?.precipitation_sum || [];
  const now = Date.now();
  let etSum = 0, precipSum = 0, days = 0;
  for (let i = 0; i < times.length; i++) {
    const d = Date.parse(times[i]);
    if (!d || d > now) continue;
    if ((now - d) / 86_400_000 > window) continue;
    etSum += et[i] ?? 0;
    precipSum += precip[i] ?? 0;
    days += 1;
  }
  return {
    window: days,
    et: round(etSum),
    precip: round(precipSum),
    deficit: round(etSum - precipSum),
  };
}

/**
 * Next rain: scan upcoming daily precipitation for the first day over 1 mm.
 */
export function nextRain(daily) {
  const times = daily?.time || [];
  const precip = daily?.precipitation_sum || [];
  const now = Date.now();
  for (let i = 0; i < times.length; i++) {
    const d = Date.parse(times[i]);
    if (!d || d < now - 86_400_000) continue;
    if ((precip[i] ?? 0) >= 1) return { date: times[i], amount: precip[i] };
  }
  return null;
}

/**
 * Sun/UV snapshot for today.
 */
export function sunSnapshot(daily) {
  const i = todayIndex(daily?.time || []);
  if (i < 0) return null;
  return {
    uvMax: daily.uv_index_max?.[i] ?? null,
    sunrise: daily.sunrise?.[i] ?? null,
    sunset: daily.sunset?.[i] ?? null,
  };
}

function todayIndex(times) {
  const today = new Date().toISOString().slice(0, 10);
  return times.findIndex((t) => t?.slice(0, 10) === today);
}

function nearestHourIndex(times) {
  if (!times.length) return -1;
  const now = Date.now();
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]);
    const d = Math.abs(t - now);
    if (d < bestDelta) { bestDelta = d; best = i; }
  }
  return best;
}

function round(n) {
  return Math.round(n * 10) / 10;
}
