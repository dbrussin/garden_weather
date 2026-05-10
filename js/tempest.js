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
 * Returns oldest-first (index 0 = furthest back, last = yesterday).
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

    const cacheKey = `v2,${stationId},${dateStr}`;
    const ttl = offset <= 1 ? RECENT_TTL : OLD_TTL;
    const hit = getCached("tempest_v2", cacheKey, ttl);
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
      // Pass the full response + offset so extractDaily can check summary fields.
      const entry = extractDaily(data, offset);
      setCached("tempest_v2", cacheKey, entry);
      results.push({ date: dateStr, ...entry });
    } catch {
      results.push({ date: dateStr, et: null, precip: null });
    }
  }

  return results; // oldest to newest (day-N … day-1)
}

/**
 * Pull ET and accumulated precipitation from a full station observation response.
 *
 * WeatherFlow returns observations in two shapes depending on station firmware
 * and API version:
 *
 *   Object format — obs entries are plain objects with named fields.
 *   Array format  — obs entries are positional arrays (Tempest obs_st):
 *     col  0: timestamp
 *     col 12: precip per observation interval (NOT daily total — tiny values)
 *     col 18: local_daily_rain_accum (accumulated since local midnight)
 *     col 19: rain_accum_final (per-interval NC value — NOT daily total)
 *     col 20: local_daily_rain_accum_final (quality-controlled daily total)
 *
 * Priority:
 *   1. data.summary fields (most reliable for the most recent completed day)
 *   2. Named fields on the last obs entry
 *   3. Array cols 20 then 18 (col 19 is per-interval, not daily — skip it)
 *   4. Sum of all per-interval precip values across the day
 *
 * @param {object} data   Full API response object.
 * @param {number} offset day_offset value used in the request.
 */
function extractDaily(data, offset) {
  let precip = null;
  let et = null;

  // ---- 1. Top-level summary (most authoritative) ----
  // For day_offset=1, summary.precip_accum_local_yesterday_final is the
  // quality-controlled total for the most recently completed day.
  const s = data?.summary;
  if (s) {
    const sp =
      s.precip_accum_local_yesterday_final ??
      s.precip_accum_local_yesterday ??
      null;
    // Only trust "yesterday" fields when offset===1; for older days they're stale.
    if (sp != null && offset === 1) precip = sp;
    if (s.et != null) et = s.et;
  }

  const obs = data?.obs;
  if (!Array.isArray(obs) || !obs.length) {
    return {
      precip: precip != null ? Math.round(precip * 10) / 10 : null,
      et: et != null ? Math.round(et * 10) / 10 : null,
    };
  }

  const last = obs[obs.length - 1];

  if (Array.isArray(last)) {
    // ---- 2a. Positional array format (Tempest obs_st) ----
    // col 20 = local_daily_rain_accum_final (QC'd daily total)
    // col 18 = local_daily_rain_accum (raw daily running total)
    // col 19 = rain_accum_final (per-interval NC value — do NOT use for daily total)
    if (precip == null) {
      precip = last[20] ?? last[18] ?? null;
    }
    if (precip == null) {
      // Last resort: sum per-interval precip (col 12) across all obs for the day.
      const total = obs.reduce((sum, row) => sum + (Array.isArray(row) ? (row[12] ?? 0) : 0), 0);
      if (total > 0) precip = total;
    }
    // ET is not in raw Tempest obs arrays; falls back to Open-Meteo.
  } else if (last && typeof last === "object") {
    // ---- 2b. Named-field object format ----
    if (precip == null) {
      precip =
        last.precip_accum_local_day_final ??
        last.local_daily_rain_accum_final ??
        last.precip_accum_local_day ??
        last.local_daily_rain_accum ??
        null;
    }
    if (precip == null) {
      // Sum per-interval precip across all obs as last resort.
      const total = obs.reduce((sum, o) => sum + (typeof o?.precip === "number" ? o.precip : 0), 0);
      if (total > 0) precip = total;
    }
    if (et == null) et = last.et ?? null;
  }

  return {
    precip: precip != null ? Math.round(precip * 10) / 10 : null,
    et: et != null ? Math.round(et * 10) / 10 : null,
  };
}

window.fetchTempestDailyStats = fetchTempestDailyStats;

})();
