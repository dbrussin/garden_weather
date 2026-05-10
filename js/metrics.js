// Derived gardening metrics from a raw Open-Meteo forecast.
//
// All functions here are pure. They take the raw API response (metric units
// throughout) and return small objects the UI can render directly. Keep
// this free of DOM code and unit conversion — display-side modules handle °F.

(function () {

/**
 * Frost risk: look at the next 3 days of min temperatures. Thresholds in °C.
 */
function frostRisk(daily, { warnBelow = 2, severeBelow = 0 } = {}) {
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
 * Growing degree days accumulated over the past + today.
 * Daily GDD = max(0, ((tmax+tmin)/2) - base). Base in °C.
 */
function growingDegreeDays(daily, { base = 10 } = {}) {
  const tmax = daily?.temperature_2m_max || [];
  const tmin = daily?.temperature_2m_min || [];
  const times = daily?.time || [];
  let total = 0;
  let days = 0;
  const now = Date.now();
  for (let i = 0; i < tmax.length; i++) {
    const date = times[i] ? Date.parse(times[i]) : null;
    if (date == null || date > now) continue;
    const hi = tmax[i];
    const lo = tmin[i];
    if (hi == null || lo == null) continue;
    total += Math.max(0, (hi + lo) / 2 - base);
    days += 1;
  }
  return { total: Math.round(total * 10) / 10, days, base };
}

function soilSnapshot(hourly) {
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
 * Per-day ET, precipitation, and deficit for the last `histDays` and next
 * `futureDays` (including today). Positive deficit = more ET than rain.
 *
 * When `tempestActuals` is provided (array of { date, et, precip } from the
 * Tempest API), those values override the Open-Meteo historical values for
 * matching dates. If a Tempest field is null, the Open-Meteo value is kept.
 *
 * @param {object} daily  Raw Open-Meteo daily object.
 * @param {Array<{ date: string, et: number|null, precip: number|null }>|null} tempestActuals
 * @param {{ histDays?: number, futureDays?: number }} opts
 */
function dailyWaterDetail(daily, tempestActuals, { histDays = 5, futureDays = 5 } = {}) {
  // Support legacy two-arg call: dailyWaterDetail(daily, opts)
  if (tempestActuals && !Array.isArray(tempestActuals)) {
    const opts = tempestActuals;
    tempestActuals = null;
    histDays = opts.histDays ?? histDays;
    futureDays = opts.futureDays ?? futureDays;
  }

  const times = daily?.time || [];
  const et = daily?.et0_fao_evapotranspiration || [];
  const precip = daily?.precipitation_sum || [];
  const precipProb = daily?.precipitation_probability_max || [];

  // Build a lookup map for Tempest actuals by date string.
  const tempestByDate = new Map();
  if (Array.isArray(tempestActuals)) {
    for (const obs of tempestActuals) {
      if (obs?.date) tempestByDate.set(obs.date, obs);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayIdx = times.findIndex((t) => t?.slice(0, 10) === today);
  if (todayIdx < 0) return { historical: [], projected: [], cumulative: 0, hasTempest: false };

  const historical = [];
  const histStart = Math.max(0, todayIdx - histDays);
  for (let i = histStart; i < todayIdx; i++) {
    const dateStr = times[i]?.slice(0, 10);
    const tObs = tempestByDate.get(dateStr);
    const etv = (tObs?.et != null ? tObs.et : et[i]) ?? 0;
    const pv = (tObs?.precip != null ? tObs.precip : precip[i]) ?? 0;
    historical.push({
      date: times[i],
      et: round(etv),
      precip: round(pv),
      deficit: round(etv - pv),
      fromTempest: !!(tObs?.et != null || tObs?.precip != null),
    });
  }

  const projected = [];
  for (let i = todayIdx; i < Math.min(todayIdx + futureDays, times.length); i++) {
    const etv = et[i] ?? 0;
    const pv = precip[i] ?? 0;
    projected.push({
      date: times[i],
      et: round(etv),
      precip: round(pv),
      deficit: round(etv - pv),
      precipProb: precipProb[i] ?? null,
    });
  }

  const all = [...historical, ...projected];
  const cumulative = round(all.reduce((s, d) => s + d.deficit, 0));
  const hasTempest = tempestByDate.size > 0;
  return { historical, projected, cumulative, hasTempest };
}

function waterBalance(daily, { window = 7 } = {}) {
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

function nextRain(daily) {
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

function sunSnapshot(daily) {
  const i = todayIndex(daily?.time || []);
  if (i < 0) return null;
  return {
    uvMax: daily.uv_index_max?.[i] ?? null,
    sunrise: daily.sunrise?.[i] ?? null,
    sunset: daily.sunset?.[i] ?? null,
    daylightSec: daily.daylight_duration?.[i] ?? null,
    shortwaveSum: daily.shortwave_radiation_sum?.[i] ?? null,
  };
}

/**
 * Humidity + disease pressure indicators over the next 24 hourly slots.
 *
 * VPD (vapor pressure deficit, kPa) — higher = more water loss / stress.
 *   Roughly: <0.4 risk of fungal disease, 0.4–1.2 ideal, >1.6 stressed.
 * Leaf wetness hours — hours with RH ≥ 90% or temp within ~1°C of dewpoint.
 */
function humidityMetrics(current, hourly) {
  const idx = nearestHourIndex(hourly?.time || []);
  const nowTemp = current?.temperature_2m ?? hourly?.temperature_2m?.[idx];
  const nowRh = current?.relative_humidity_2m ?? hourly?.relative_humidity_2m?.[idx];
  const nowDew = current?.dew_point_2m ?? hourly?.dew_point_2m?.[idx];
  const vpdNow = (nowTemp != null && nowRh != null) ? vpd(nowTemp, nowRh) : null;

  let wetHours = 0;
  let counted = 0;
  const t = hourly?.temperature_2m || [];
  const rh = hourly?.relative_humidity_2m || [];
  const dp = hourly?.dew_point_2m || [];
  for (let i = idx; i < idx + 24 && i < t.length; i++) {
    if (rh[i] == null || t[i] == null) continue;
    counted++;
    const nearDew = dp[i] != null && (t[i] - dp[i]) <= 1;
    if (rh[i] >= 90 || nearDew) wetHours++;
  }
  return {
    temp: nowTemp ?? null,
    rh: nowRh ?? null,
    dewPoint: nowDew ?? null,
    vpd: vpdNow != null ? Math.round(vpdNow * 100) / 100 : null,
    leafWetHours: counted ? wetHours : null,
    windowHours: counted,
  };
}

// Saturation vapor pressure (Tetens) → VPD in kPa.
function vpd(tempC, rhPct) {
  const es = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  return es * (1 - rhPct / 100);
}

/**
 * Longest upcoming stretch of hours with precipitation below `threshold` mm,
 * starting from now. Useful for scheduling spraying, transplanting, mowing.
 */
function rainFreeWindow(hourly, { threshold = 0.1, lookahead = 72 } = {}) {
  const times = hourly?.time || [];
  const precip = hourly?.precipitation || [];
  const probs = hourly?.precipitation_probability || [];
  const start = nearestHourIndex(times);
  if (start < 0) return null;
  const end = Math.min(start + lookahead, times.length);
  let best = { startIdx: null, length: 0 };
  let curStart = null;
  let curLen = 0;
  for (let i = start; i < end; i++) {
    const dry = (precip[i] ?? 0) < threshold && (probs[i] ?? 0) < 50;
    if (dry) {
      if (curStart == null) curStart = i;
      curLen++;
      if (curLen > best.length) best = { startIdx: curStart, length: curLen };
    } else {
      curStart = null;
      curLen = 0;
    }
  }
  if (!best.length || best.startIdx == null) return null;
  return {
    start: times[best.startIdx],
    end: times[Math.min(best.startIdx + best.length - 1, times.length - 1)],
    hours: best.length,
  };
}

/**
 * Estimate USDA hardiness zone from daily minimum temperatures over multiple
 * years. The USDA system is defined on the average annual extreme minimum
 * temperature over a 30-year window. We approximate with 5 years of ERA5
 * data — good enough to place most places within ±1 subzone.
 *
 * @param {{ time: string[], temperature_2m_min: number[] }} daily
 * @returns {{
 *   zone: string, zoneNumber: number, sub: "a"|"b",
 *   avgMinC: number, avgMinF: number, years: number[]
 * } | null}
 */
function hardinessZone(daily) {
  const times = daily?.time || [];
  const mins = daily?.temperature_2m_min || [];
  if (!times.length) return null;
  const byYear = new Map();
  for (let i = 0; i < times.length; i++) {
    const year = times[i]?.slice(0, 4);
    const t = mins[i];
    if (!year || t == null) continue;
    const prev = byYear.get(year);
    if (prev == null || t < prev) byYear.set(year, t);
  }
  if (!byYear.size) return null;
  const yearly = [...byYear.values()];
  const avgMinC = yearly.reduce((a, b) => a + b, 0) / yearly.length;
  const avgMinF = avgMinC * 9 / 5 + 32;
  // USDA zone N spans [-60 + (N-1)*10, -60 + N*10] °F. Zone 1 starts at
  // -60°F. Each zone is split into a (colder 5°F) and b (warmer 5°F).
  let zoneNumber = Math.floor((avgMinF + 60) / 10) + 1;
  zoneNumber = Math.max(1, Math.min(13, zoneNumber));
  const zoneFloorF = -60 + (zoneNumber - 1) * 10;
  const sub = avgMinF - zoneFloorF < 5 ? "a" : "b";
  return {
    zone: `${zoneNumber}${sub}`,
    zoneNumber,
    sub,
    avgMinC: Math.round(avgMinC * 10) / 10,
    avgMinF: Math.round(avgMinF * 10) / 10,
    years: [...byYear.keys()].sort(),
  };
}

/**
 * Planting guide: given current soil temp (surface) and forecast min temps,
 * flag which common crops are sowable. Temps are in °C.
 *
 * Minimum soil germination temps are classic extension-service figures.
 */
const CROPS = [
  { name: "Peas", min: 4 },
  { name: "Spinach", min: 5 },
  { name: "Lettuce", min: 5 },
  { name: "Radish", min: 5 },
  { name: "Kale", min: 7 },
  { name: "Carrots", min: 7 },
  { name: "Beets", min: 10 },
  { name: "Chard", min: 10 },
  { name: "Corn", min: 13 },
  { name: "Beans", min: 16 },
  { name: "Cucumber", min: 18 },
  { name: "Squash", min: 18 },
  { name: "Tomato (transplant)", min: 15 },
  { name: "Pepper (transplant)", min: 18 },
  { name: "Melon", min: 21 },
];

function plantingGuide(soil, frost) {
  const surface = soil?.surfaceTemp ?? null;
  const frostSoon = frost && frost.level !== "none";
  return CROPS.map((crop) => {
    if (surface == null) return { ...crop, status: "unknown" };
    if (surface >= crop.min && !frostSoon) return { ...crop, status: "go" };
    if (surface >= crop.min - 2) return { ...crop, status: "soon" };
    return { ...crop, status: "wait" };
  });
}

/**
 * FAO-56 Penman-Monteith reference ET₀ (mm/day) from Tempest daily summary columns.
 *
 * Solar radiation column gives the daily PEAK (W/m²), not the average. We
 * convert it to a daily total using a sinusoidal daylight model and the
 * computed astronomical day length for the given latitude and day-of-year.
 *
 * Returns null if any required input is absent or non-finite.
 */
function calcEt0PM({ tmax, tmin, rhHigh, rhLow, windAvgMs, solarPeakWm2,
                     pressureHighMb, pressureLowMb, lat, doy }) {
  if ([tmax, tmin, rhHigh, rhLow, windAvgMs, solarPeakWm2,
       pressureHighMb, pressureLowMb, lat, doy]
      .some((v) => v == null || !Number.isFinite(v))) return null;

  const T = (tmax + tmin) / 2;
  const rhMean = (rhHigh + rhLow) / 2;
  const P = (pressureHighMb + pressureLowMb) / 2 / 10; // mb → kPa

  const eSat = (t) => 0.6108 * Math.exp(17.27 * t / (t + 237.3));
  const es = (eSat(tmax) + eSat(tmin)) / 2;
  const ea = (rhMean / 100) * es;
  const delta = 4098 * eSat(T) / Math.pow(T + 237.3, 2);
  const gamma = 0.000665 * P;

  // Extraterrestrial radiation Ra (MJ/m²/day) and daylight hours N
  const phi = lat * Math.PI / 180;
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI / 365 * doy);
  const sdec = 0.409 * Math.sin(2 * Math.PI / 365 * doy - 1.39);
  const omegas = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(sdec))));
  const Ra = (24 * 60 / Math.PI) * 0.0820 * dr *
    (omegas * Math.sin(phi) * Math.sin(sdec) + Math.cos(phi) * Math.cos(sdec) * Math.sin(omegas));
  const N = (24 / Math.PI) * omegas; // daylight hours

  // Rs from peak: sinusoidal integral over daylight period → MJ/m²/day
  const Rs = solarPeakWm2 * (2 / Math.PI) * N * 3600 / 1e6;

  // Net radiation
  const Rso = 0.75 * Ra;
  const Rns = 0.77 * Rs;
  const sigma = 4.903e-9; // MJ/m²/day/K⁴
  const Rnl = sigma *
    ((Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) *
    Math.max(0, 1.35 * Rs / Math.max(Rso, 0.01) - 0.35);
  const Rn = Rns - Rnl;

  const u2 = windAvgMs;
  const et0 = (0.408 * delta * Rn + gamma * (900 / (T + 273)) * u2 * (es - ea)) /
              (delta + gamma * (1 + 0.34 * u2));

  return Math.max(0, Math.round(et0 * 10) / 10);
}

// ---------------------------------------------------------------------------
// helpers

function todayIndex(times) {
  const today = new Date().toISOString().slice(0, 10);
  return times.findIndex((t) => t?.slice(0, 10) === today);
}

function nearestHourIndex(times) {
  if (!times?.length) return -1;
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

/**
 * Return the index of the first hourly sample at or after "now". Useful
 * when callers want to slice the forecast window for charts.
 */
function hourlyNowIndex(hourly) {
  return nearestHourIndex(hourly?.time || []);
}

function round(n) {
  return Math.round(n * 10) / 10;
}

window.calcEt0PM = calcEt0PM;
window.frostRisk = frostRisk;
window.growingDegreeDays = growingDegreeDays;
window.soilSnapshot = soilSnapshot;
window.dailyWaterDetail = dailyWaterDetail;
window.waterBalance = waterBalance;
window.nextRain = nextRain;
window.sunSnapshot = sunSnapshot;
window.humidityMetrics = humidityMetrics;
window.rainFreeWindow = rainFreeWindow;
window.hardinessZone = hardinessZone;
window.plantingGuide = plantingGuide;
window.hourlyNowIndex = hourlyNowIndex;

})();
