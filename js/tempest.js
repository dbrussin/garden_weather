// WeatherFlow Tempest REST API — fetch daily ET + precipitation actuals.
// Docs: https://apidocs.tempestwx.com/
//
// Strategy: query each past day with explicit time_start / time_end parameters
// (epoch seconds). This is more reliable than day_offset, which may be ignored
// or may return the current observation rather than historical data.
//
// Within each day's response, local_daily_rain_accum accumulates monotonically
// from local midnight until the next midnight, then resets. Taking the MAXIMUM
// value across all observations for the window gives the day's total regardless
// of whether the API returns data in ascending or descending order.
//
// All 5 daily fetches run in parallel; each result is cached independently so
// older days (TTL 7 d) don't re-fetch on every page load.

(function () {

const BASE = "https://swd.weatherflow.com/swd/rest";
const RECENT_TTL = 60 * 60 * 1000;        // yesterday may still update (QC)
const OLD_TTL = 7 * 24 * 60 * 60 * 1000;  // older days are final

/**
 * Return a YYYY-MM-DD string for a Date in the browser's local timezone.
 * We use local time because Tempest's `local_daily_rain_accum` resets at the
 * station's local midnight, which should match the user's browser timezone.
 */
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Fetch daily ET + precipitation for the past `days` complete days.
 * Returns oldest-first (index 0 = furthest back, last = yesterday).
 *
 * @param {{ stationId: string|number, token: string, days?: number }} opts
 * @returns {Promise<Array<{ date: string, et: number|null, precip: number|null }>>}
 */
async function fetchTempestDailyStats({ stationId, token, days = 5 }) {
  const now = new Date();

  // Build one fetch task per past day (oldest → newest, offsets days…1).
  const tasks = [];
  for (let offset = days; offset >= 1; offset--) {
    const dayDate = new Date(now);
    dayDate.setDate(dayDate.getDate() - offset);

    const dateStr = localDateStr(dayDate);
    const cacheKey = `v3,${stationId},${dateStr}`;
    const ttl = offset <= 1 ? RECENT_TTL : OLD_TTL;

    tasks.push({ offset, dateStr, cacheKey, ttl, dayDate });
  }

  // Run all fetches concurrently; serve from cache when available.
  const settled = await Promise.all(tasks.map(async ({ dateStr, cacheKey, ttl, dayDate }) => {
    const hit = getCached("tempest_v3", cacheKey, ttl);
    if (hit) return { date: dateStr, ...hit };

    // Build the day window in local time so it aligns with Tempest's midnight.
    const start = new Date(dayDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dayDate);
    end.setHours(23, 59, 59, 0);

    const timeStart = Math.floor(start.getTime() / 1000);
    const timeEnd = Math.floor(end.getTime() / 1000);

    try {
      const url = `${BASE}/observations/station/${encodeURIComponent(stationId)}` +
        `?token=${encodeURIComponent(token)}&time_start=${timeStart}&time_end=${timeEnd}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Tempest HTTP ${res.status}`);
      const data = await res.json();
      const entry = extractDayTotal(data.obs);
      setCached("tempest_v3", cacheKey, entry);
      return { date: dateStr, ...entry };
    } catch {
      return { date: dateStr, precip: null, et: null };
    }
  }));

  return settled; // already oldest-first because tasks were built that way
}

/**
 * Extract the daily precipitation total and ET from an observations array.
 *
 * WeatherFlow returns obs in two formats:
 *
 *   Array format (Tempest obs_st, most common):
 *     col  0 = timestamp (epoch seconds)
 *     col 12 = precip, mm per observation interval  ← per-minute, NOT daily total
 *     col 18 = local_daily_rain_accum, mm           ← running total from midnight
 *     col 19 = rain_accum_final (per-interval NC)   ← also NOT daily total
 *     col 20 = local_daily_rain_accum_final, mm     ← QC'd running total (best)
 *
 *   Object format (newer API):
 *     named fields: local_daily_rain_accum_final, local_daily_rain_accum,
 *                   precip_accum_local_day_final, precip_accum_local_day, precip
 *
 * Strategy: take the MAXIMUM accumulated value seen across all obs.
 * Because local_daily_rain_accum only increases during a day and resets at
 * midnight, max(obs) = the day's total, regardless of sort order.
 *
 * Fallback: sum all per-interval precip values — correct but less precise if
 * the station reports in multi-minute intervals.
 */
function extractDayTotal(obs) {
  if (!Array.isArray(obs) || !obs.length) return { precip: null, et: null };

  const sample = obs[0];
  let maxAccum = null;   // best running-total field
  let sumInterval = 0;   // sum of per-interval amounts (fallback)
  let et = null;

  if (Array.isArray(sample)) {
    // ---- positional array format ----
    for (const row of obs) {
      if (!Array.isArray(row)) continue;
      // Prefer col 20 (QC'd daily accum) over col 18 (raw daily accum).
      // Never use col 19 — it is the per-interval NC value, not the daily total.
      const accum = row[20] ?? row[18] ?? null;
      if (accum != null && (maxAccum === null || accum > maxAccum)) maxAccum = accum;
      // Sum col 12 as fallback (per-interval precip in mm).
      if (typeof row[12] === "number") sumInterval += row[12];
    }
  } else {
    // ---- object format ----
    for (const o of obs) {
      if (!o) continue;
      const accum =
        o.local_daily_rain_accum_final ??
        o.precip_accum_local_day_final ??
        o.local_daily_rain_accum ??
        o.precip_accum_local_day ??
        null;
      if (accum != null && (maxAccum === null || accum > maxAccum)) maxAccum = accum;
      if (typeof o.precip === "number") sumInterval += o.precip;
      // ET (reference evapotranspiration) appears in some station responses.
      if (o.et != null) et = o.et;
    }
  }

  const precip = maxAccum !== null ? maxAccum : (sumInterval > 0 ? sumInterval : 0);
  return {
    precip: Math.round(precip * 10) / 10,
    et: et !== null ? Math.round(et * 10) / 10 : null,
  };
}

window.fetchTempestDailyStats = fetchTempestDailyStats;

})();
