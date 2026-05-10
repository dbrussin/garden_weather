// WeatherFlow Tempest REST API — fetch daily precipitation and ET actuals.
//
// Single request covering the past N days; the API returns daily summary
// observations (one row per day) when querying a multi-day time range.
//
// Column layout (station day summary endpoint):
//   col  0 : timestamp          — Unix epoch (seconds), start of local day
//   col  1 : air_temp_high      — daily max air temp (°C)
//   col  2 : air_temp_low       — daily min air temp (°C)
//   col  3 : rh_high            — daily max relative humidity (%)
//   col  4 : rh_low             — daily min relative humidity (%)
//   col  5 : pressure_high      — daily max station pressure (mb)
//   col  6 : pressure_low       — daily min station pressure (mb)
//   col  7 : wind_avg           — daily avg wind speed (m/s)
//   col 11 : solar_radiation_high — peak solar radiation (W/m²)
//   col 13 : precip_accum_final — Rain Check corrected daily total (mm)
//
// ET₀ is computed via FAO-56 Penman-Monteith using the above columns.
// The solar_radiation_high (peak W/m²) is converted to a daily total
// using a sinusoidal daylight model and the astronomical day length for
// the station's latitude and day-of-year.

(function () {

const BASE = "https://swd.weatherflow.com/swd/rest";
const TTL_MS = 60 * 60 * 1000; // 1 hour — QC values may update

/** YYYY-MM-DD in the browser's local timezone. */
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Fetch daily precipitation and ET actuals for the past `days` complete days.
 * Returns an array oldest-first: [{date, precip, et}, …].
 * `precip` is mm from the Tempest Rain Check algorithm (col 13).
 * `et` is FAO-56 Penman-Monteith ET₀ computed from daily obs columns;
 *  null if `lat` is omitted or any required column is missing.
 *
 * @param {{ stationId: string|number, token: string, days?: number, lat?: number|null }} opts
 */
async function fetchTempestDailyStats({ stationId, token, days = 5, lat = null }) {
  const now = new Date();
  const today = localDateStr(now);

  // Cache the whole block keyed by station + today's date + lat bucket.
  const latKey = lat != null ? (+lat).toFixed(2) : "x";
  const cacheKey = `${stationId},${today},${latKey}`;
  const hit = getCached("tempest_v4", cacheKey, TTL_MS);
  if (hit) return hit;

  // time_start: local midnight N days ago  (matches Python: now - N*24*60*60)
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
    const results = parseDailyObs(data.obs, days, now, today, lat);
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
 * the maximum equals the end-of-day Rain Check total. ET is computed from
 * that same winning row.
 *
 * Today's row (partial day) is skipped.
 */
function parseDailyObs(obs, days, now, today, lat) {
  if (!Array.isArray(obs) || !obs.length) return emptyDays(days, now);

  const byDate = new Map();

  for (const row of obs) {
    if (!Array.isArray(row) || row[0] == null) continue;

    const rowDate = new Date(row[0] * 1000);
    const dateStr = localDateStr(rowDate);
    if (dateStr === today) continue; // skip incomplete current day

    // col 13 = precip_accum_local_day_final (Rain Check corrected daily total)
    const precip = typeof row[13] === "number" ? row[13] : null;

    // FAO-56 PM ET₀ from daily summary columns
    const doy = dayOfYear(rowDate);
    const et = lat != null ? calcEt0PM({
      tmax:           typeof row[1]  === "number" ? row[1]  : null,
      tmin:           typeof row[2]  === "number" ? row[2]  : null,
      rhHigh:         typeof row[3]  === "number" ? row[3]  : null,
      rhLow:          typeof row[4]  === "number" ? row[4]  : null,
      pressureHighMb: typeof row[5]  === "number" ? row[5]  : null,
      pressureLowMb:  typeof row[6]  === "number" ? row[6]  : null,
      windAvgMs:      typeof row[7]  === "number" ? row[7]  : null,
      solarPeakWm2:   typeof row[11] === "number" ? row[11] : null,
      lat,
      doy,
    }) : null;

    // Keep the row with the highest precip; that row also provides the ET.
    const prev = byDate.get(dateStr);
    if (!prev || (precip != null && (prev.precip == null || precip > prev.precip))) {
      byDate.set(dateStr, { date: dateStr, precip, et });
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

/** Day-of-year (1–366) for a given Date. */
function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.round((date - start) / 86400000);
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
