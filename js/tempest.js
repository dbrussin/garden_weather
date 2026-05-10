// WeatherFlow Tempest REST API — fetch daily precipitation and ET actuals.
//
// The /observations/station endpoint only ever returns the current snapshot;
// day_offset is silently ignored. Historical data requires the device endpoint:
//
//   GET /swd/rest/observations/device/{device_id}?token=...&time_start=...&time_end=...
//
// Returns minute-by-minute obs_st positional arrays. We aggregate into daily
// summaries by grouping rows by local date.
//
// Minute-by-minute obs_st column indices (Tempest ST device):
//   0  time_epoch          (s)
//   2  wind_avg            (m/s)
//   6  station_pressure    (mb)
//   7  air_temperature     (°C)
//   8  relative_humidity   (%)
//  11  solar_radiation     (W/m²)
//  12  precip_accumulated  (mm, per-interval)
//  18  local_day_rain_accumulation  (mm, daily running total — resets at local midnight)
//
// For precipitation we take the maximum of col 18 per local date, which equals
// the day's final sensor total. For ET₀ we derive daily tmax/tmin, mean RH,
// mean wind speed, peak solar radiation, and mean pressure, then apply FAO-56.

(function () {

const BASE = "https://swd.weatherflow.com/swd/rest";
const OBS_TTL_MS    = 60 * 60 * 1000;  // 1 hour
const DEVICE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — device ID rarely changes

// Minute-by-minute obs_st column indices.
const D_TIME   = 0;
const D_WIND   = 2;
const D_PRES   = 6;
const D_TEMP   = 7;
const D_RH     = 8;
const D_SOLAR  = 11;
const D_PRECIP_DAY = 18; // local_day_rain_accumulation, daily running total

/** YYYY-MM-DD in the browser's local timezone. */
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Resolve the Tempest (ST) device ID for a station.
 * Calls /stations/{station_id} once and caches for 24 h.
 */
async function resolveDeviceId(stationId, token) {
  const cacheKey = String(stationId);
  const hit = getCached("tempest_device_v1", cacheKey, DEVICE_TTL_MS);
  if (hit) return hit;

  const url = `${BASE}/stations/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tempest stations HTTP ${res.status}`);
  const data = await res.json();

  const station = Array.isArray(data.stations) ? data.stations[0] : null;
  const device = station?.devices?.find((d) => d.device_type === "ST");
  if (!device?.device_id) throw new Error("No Tempest ST device found in station metadata");

  console.log("[Tempest] resolved device_id:", device.device_id, "for station:", stationId);
  setCached("tempest_device_v1", cacheKey, device.device_id);
  return device.device_id;
}

/**
 * Fetch daily precipitation and ET actuals for the past `days` complete days.
 * Returns array oldest-first: [{date, precip, et}, …].
 *
 * @param {{ stationId: string|number, token: string, days?: number, lat?: number|null }} opts
 */
async function fetchTempestDailyStats({ stationId, token, days = 5, lat = null }) {
  const now = new Date();
  const today = localDateStr(now);

  const latKey = lat != null ? (+lat).toFixed(2) : "x";
  const cacheKey = `${stationId},${today},${latKey}`;
  const hit = getCached("tempest_v8", cacheKey, OBS_TTL_MS);
  if (hit) return hit;

  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  const timeStart = Math.floor(start.getTime() / 1000);
  const timeEnd   = Math.floor(now.getTime() / 1000);

  try {
    const deviceId = await resolveDeviceId(stationId, token);

    const url =
      `${BASE}/observations/device/${encodeURIComponent(deviceId)}` +
      `?token=${encodeURIComponent(token)}&time_start=${timeStart}&time_end=${timeEnd}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tempest device HTTP ${res.status}`);
    const data = await res.json();

    console.log("[Tempest] device obs count:", data.obs?.length, "first row:", data.obs?.[0]);

    const results = aggregateDaily(data.obs, days, now, today, lat);
    setCached("tempest_v8", cacheKey, results);
    return results;
  } catch (err) {
    console.error("[Tempest] fetch error:", err);
    return emptyDays(days, now);
  }
}

/**
 * Aggregate minute-by-minute obs_st rows into per-day summaries.
 * For precip: max of col 18 (daily running total) per local date.
 * For ET₀: daily tmax/tmin, mean RH, mean wind, peak solar, mean pressure.
 */
function aggregateDaily(obs, days, now, today, lat) {
  if (!Array.isArray(obs) || !obs.length) return emptyDays(days, now);

  const byDate = new Map(); // dateStr → { precipMax, temps, rhs, winds, solars, pressures }

  for (const row of obs) {
    if (!Array.isArray(row) || row[D_TIME] == null) continue;
    const dateStr = localDateStr(new Date(row[D_TIME] * 1000));
    if (dateStr === today) continue; // skip partial current day

    if (!byDate.has(dateStr)) {
      byDate.set(dateStr, { precipMax: 0, temps: [], rhs: [], winds: [], solars: [], pressures: [] });
    }
    const d = byDate.get(dateStr);

    if (typeof row[D_PRECIP_DAY] === "number") d.precipMax = Math.max(d.precipMax, row[D_PRECIP_DAY]);
    if (typeof row[D_TEMP]  === "number") d.temps.push(row[D_TEMP]);
    if (typeof row[D_RH]    === "number") d.rhs.push(row[D_RH]);
    if (typeof row[D_WIND]  === "number") d.winds.push(row[D_WIND]);
    if (typeof row[D_SOLAR] === "number") d.solars.push(row[D_SOLAR]);
    if (typeof row[D_PRES]  === "number") d.pressures.push(row[D_PRES]);
  }

  const result = [];
  for (let offset = days; offset >= 1; offset--) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const dateStr = localDateStr(d);
    const agg = byDate.get(dateStr);

    if (!agg || !agg.temps.length) {
      result.push({ date: dateStr, precip: null, et: null });
      continue;
    }

    const precip = agg.precipMax;

    const tmax = Math.max(...agg.temps);
    const tmin = Math.min(...agg.temps);
    const mean  = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const rhMean    = agg.rhs.length    ? mean(agg.rhs)       : null;
    const windAvg   = agg.winds.length  ? mean(agg.winds)     : null;
    const solarPeak = agg.solars.length ? Math.max(...agg.solars) : null;
    const presMean  = agg.pressures.length ? mean(agg.pressures) : null;
    const doy = dayOfYear(new Date(dateStr + "T12:00:00"));

    const et = lat != null ? calcEt0PM({
      tmax, tmin,
      rhHigh: rhMean, rhLow: rhMean,
      pressureHighMb: presMean, pressureLowMb: presMean,
      windAvgMs: windAvg,
      solarPeakWm2: solarPeak,
      lat, doy,
    }) : null;

    result.push({ date: dateStr, precip, et });
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
