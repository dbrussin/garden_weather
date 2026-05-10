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
 * Pull ET and accumulated precipitation from an obs array.
 * The Tempest API returns obs as an array; for a day_offset request the last
 * entry contains the final accumulated values for the day.
 */
function extractDaily(obs) {
  if (!Array.isArray(obs) || !obs.length) return { et: null, precip: null };
  // Take the last observation — for completed days it holds final accumulations.
  const o = obs[obs.length - 1];
  if (!o) return { et: null, precip: null };

  // Prefer quality-controlled / finalized fields; fall back to raw.
  const precip =
    o.precip_accum_local_day_final ??
    o.precip_accum_local_day ??
    o.precip ??
    null;

  const et = o.et ?? null;

  return {
    precip: precip != null ? Math.round(precip * 10) / 10 : null,
    et: et != null ? Math.round(et * 10) / 10 : null,
  };
}

window.fetchTempestDailyStats = fetchTempestDailyStats;

})();
