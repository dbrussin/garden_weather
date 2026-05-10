// WeatherFlow Tempest REST API — fetch daily ET + precipitation actuals.
// Docs: https://apidocs.tempestwx.com/
//
// Uses the station observations endpoint with day_offset to pull completed-day
// summaries. Results are cached via cache.js — older days for 7 days, the most
// recent day for 1 hour (may still be accumulating).

(function () {

const BASE = "https://swd.weatherflow.com/swd/rest";
const RECENT_TTL = 60 * 60 * 1000;        // 1 h — today/yesterday may update
const OLD_TTL = 7 * 24 * 60 * 60 * 1000;  // 7 d — older days won't change

/**
 * Fetch daily ET + precipitation for the past `days` complete days.
 * Returns newest-first so index 0 = yesterday, 1 = two days ago, etc.,
 * but the array is returned oldest-first for callers.
 *
 * @param {{ stationId: string|number, token: string, days?: number }} opts
 * @returns {Promise<Array<{ date: string, et: number|null, precip: number|null }>>}
 */
async function fetchTempestDailyStats({ stationId, token, days = 5 }) {
  const results = [];
  const today = new Date();

  for (let offset = days; offset >= 1; offset--) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    const dateStr = d.toISOString().slice(0, 10);

    const cacheKey = `${stationId},${dateStr}`;
    const ttl = offset <= 1 ? RECENT_TTL : OLD_TTL;
    const hit = getCached("tempest", cacheKey, ttl);
    if (hit) {
      results.push({ date: dateStr, ...hit });
      continue;
    }

    try {
      const url = `${BASE}/observations/station/${encodeURIComponent(stationId)}` +
        `?token=${encodeURIComponent(token)}&day_offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Tempest HTTP ${res.status}`);
      const data = await res.json();
      const entry = extractDaily(data?.obs);
      setCached("tempest", cacheKey, entry);
      results.push({ date: dateStr, ...entry });
    } catch {
      // Network failure or API error — push null so callers can fall back.
      results.push({ date: dateStr, et: null, precip: null });
    }
  }

  return results; // oldest to newest (e.g. day-5, day-4, ... day-1)
}

/**
 * Pull ET and accumulated precipitation from a Tempest obs array.
 *
 * The WeatherFlow REST API returns observations in two possible shapes:
 *
 *   Object format — each obs entry is a plain object with named fields.
 *   Array format  — each obs entry is a positional array; for the Tempest (ST)
 *                   device type the daily rain accumulation lives at col 18
 *                   (local_daily_rain_accum) and col 19 (_final). Per-interval
 *                   precipitation is at col 12.
 *
 * In both cases we prefer the accumulated daily fields over the per-interval
 * `precip` field (which is tiny — fractions of a mm per observation). As a
 * last resort we sum all per-interval precip values across the whole day.
 */
function extractDaily(obs) {
  if (!Array.isArray(obs) || !obs.length) return { et: null, precip: null };

  const last = obs[obs.length - 1];
  if (!last) return { et: null, precip: null };

  let precip = null;
  let et = null;

  if (Array.isArray(last)) {
    // ---- positional array format ----
    // Tempest ST columns (0-based):
    //   18 = local_daily_rain_accum, 19 = local_daily_rain_accum_final
    //   12 = precip (per interval)
    precip = last[19] ?? last[18] ?? null;
    if (precip == null) {
      // Sum per-interval precip (col 12) across all obs for the day.
      const total = obs.reduce((s, row) => s + (Array.isArray(row) ? (row[12] ?? 0) : 0), 0);
      if (total > 0) precip = total;
    }
    // ET is not in raw Tempest obs arrays — fall back to Open-Meteo.
  } else {
    // ---- named-field object format ----
    // WeatherFlow uses at least two naming conventions for daily rain totals.
    precip =
      last.precip_accum_local_day_final ??
      last.local_daily_rain_accum_final ??
      last.precip_accum_local_day ??
      last.local_daily_rain_accum ??
      null;

    if (precip == null) {
      // Sum per-interval `precip` across all obs as ultimate fallback.
      const total = obs.reduce((s, o) => s + (typeof o?.precip === "number" ? o.precip : 0), 0);
      if (total > 0) precip = total;
    }

    et = last.et ?? null;
  }

  return {
    precip: precip != null ? Math.round(precip * 10) / 10 : null,
    et: et != null ? Math.round(et * 10) / 10 : null,
  };
}

window.fetchTempestDailyStats = fetchTempestDailyStats;

})();
