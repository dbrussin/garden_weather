// WeatherFlow Tempest REST API — fetch daily precipitation actuals.
//
// Single request covering the past N days; the API returns daily summary
// observations (one row per day) when querying a multi-day time range.
// Column layout confirmed by user testing:
//   col  0 : timestamp (epoch seconds, start of day)
//   col 13 : precip_accum_local_day_final — Rain Check corrected daily total (mm)
//
// ET is not available in this summary format; it falls back to Open-Meteo.

(function () {

const BASE = "https://swd.weatherflow.com/swd/rest";
const TTL_MS = 60 * 60 * 1000; // 1 hour — refresh each hour, QC values may update

/** YYYY-MM-DD in the browser's local timezone. */
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Fetch daily precipitation actuals for the past `days` complete days.
 * Returns an array oldest-first: [{date, precip, et}, …].
 * `precip` is mm from the Tempest Rain Check algorithm; `et` is always null
 * (not in the daily summary format — Open-Meteo ET is used as the fallback).
 *
 * @param {{ stationId: string|number, token: string, days?: number }} opts
 */
async function fetchTempestDailyStats({ stationId, token, days = 5 }) {
  const now = new Date();
  const today = localDateStr(now);

  // Cache the whole block keyed by station + today's date.
  const cacheKey = `${stationId},${today}`;
  const hit = getCached("tempest_v4", cacheKey, TTL_MS);
  if (hit) return hit;

  // time_start: local midnight N days ago  (matches Python: now - 5*24*60*60)
  // time_end:   now  (API will include today's partial row; we skip it in parsing)
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);

  const timeStart = Math.floor(start.getTime() / 1000);
  const timeEnd   = Math.floor(now.getTime() / 1000);

  try {
    const url =
      `${BASE}/observations/station/${encodeURIComponent(stationId)}` +
      `?token=${encodeURIComponent(token)}&time_start=${timeStart}&time_end=${timeEnd}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tempest HTTP ${res.status}`);
    const data = await res.json();
    const results = parseDailyObs(data.obs, days, now, today);
    setCached("tempest_v4", cacheKey, results);
    return results;
  } catch {
    return emptyDays(days, now);
  }
}

/**
 * Parse the obs array returned by a multi-day Tempest query.
 *
 * Each row is a positional array. We group by local date and take the maximum
 * col-13 value seen per day — in case there is more than one row per day,
 * the maximum equals the end-of-day Rain Check total.
 *
 * Today's row (partial day) is skipped.
 */
function parseDailyObs(obs, days, now, today) {
  if (!Array.isArray(obs) || !obs.length) return emptyDays(days, now);

  const byDate = new Map();

  for (const row of obs) {
    if (!Array.isArray(row) || row[0] == null) continue;

    const dateStr = localDateStr(new Date(row[0] * 1000));
    if (dateStr === today) continue; // skip incomplete current day

    // col 13 = precip_accum_local_day_final (Rain Check corrected daily total)
    const precip = typeof row[13] === "number" ? row[13] : null;

    // Keep maximum — handles multiple rows per day, or accumulated-running fields.
    const prev = byDate.get(dateStr);
    if (!prev || (precip != null && (prev.precip == null || precip > prev.precip))) {
      byDate.set(dateStr, { date: dateStr, precip, et: null });
    }
  }

  // Build result oldest-first, filling missing dates with nulls.
  const result = [];
  for (let offset = days; offset >= 1; offset--) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const dateStr = localDateStr(d);
    result.push(byDate.get(dateStr) ?? { date: dateStr, precip: null, et: null });
  }
  return result;
}

function emptyDays(days, now) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - i));
    return { date: localDateStr(d), precip: null, et: null };
  });
}

window.fetchTempestDailyStats = fetchTempestDailyStats;

})();
