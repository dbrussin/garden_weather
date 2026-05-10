// WeatherFlow Tempest REST API — fetch daily precipitation and ET actuals.
//
// Flow:
//   1. GET /stations/{station_id}  →  find the ST device_id (cached 24 h)
//   2. GET /observations/device/{device_id}?time_start=...&time_end=...
//      →  obs_st positional arrays (one row per ~1-min interval)
//
// obs_st column indices (API docs — type obs_st):
//   0  timestamp (epoch s)     2  wind_avg (m/s)
//   6  pressure (mb)           7  air_temperature (°C)
//   8  relative_humidity (%)  11  solar_radiation (W/m²)
//  18  local_day_rain_accumulation (mm) — resets at local midnight
//
// Daily aggregation per local date:
//   precip  = max( col 18 )          → final daily sensor total
//   tmax    = max( col 7 )
//   tmin    = min( col 7 )
//   rh_mean = mean( col 8 )
//   wind    = mean( col 2 )
//   solar   = max( col 11 )          → peak for FAO-56 sinusoidal model
//   pres    = mean( col 6 )

(function () {

const BASE    = "https://swd.weatherflow.com/swd/rest";
const OBS_TTL    = 60 * 60 * 1000;       // 1 h  — re-fetch each hour
const DEVICE_TTL = 24 * 60 * 60 * 1000; // 24 h — device_id rarely changes

/** YYYY-MM-DD in the browser's local timezone. */
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayOfYear(date) {
  return Math.round((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
}

/** Resolve the Tempest ST device_id for a station (cached 24 h). */
async function resolveDeviceId(stationId, token) {
  const hit = getCached("tempest_device_v2", String(stationId), DEVICE_TTL);
  if (hit) return hit;

  const res = await fetch(
    `${BASE}/stations/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`
  );
  if (!res.ok) throw new Error(`Tempest /stations/ HTTP ${res.status}`);
  const data = await res.json();

  // Device_id appears in capabilities array entries.
  const station = Array.isArray(data.stations) ? data.stations[0] : null;
  const caps = station?.capabilities || [];
  const deviceId = caps.find((c) => c.device_id)?.device_id
    ?? station?.devices?.find((d) => d.device_type === "ST")?.device_id;

  if (!deviceId) throw new Error("No Tempest device_id found in /stations/ response");
  setCached("tempest_device_v2", String(stationId), deviceId);
  return deviceId;
}

/**
 * Fetch daily precipitation and ET actuals for the past `days` complete days.
 * @param {{ stationId: string|number, token: string, days?: number, lat?: number|null }} opts
 */
async function fetchTempestDailyStats({ stationId, token, days = 5, lat = null }) {
  const now   = new Date();
  const today = localDateStr(now);

  const latKey   = lat != null ? (+lat).toFixed(2) : "x";
  const cacheKey = `${stationId},${today},${latKey}`;
  const hit = getCached("tempest_v12", cacheKey, OBS_TTL);
  if (hit) return hit;

  // time_end = local midnight today so the range covers only complete past days.
  const end   = new Date(now); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - days);
  const timeStart = Math.floor(start.getTime() / 1000);
  const timeEnd   = Math.floor(end.getTime() / 1000);

  try {
    const deviceId = await resolveDeviceId(stationId, token);

    const url =
      `${BASE}/observations/device/${encodeURIComponent(deviceId)}` +
      `?token=${encodeURIComponent(token)}&time_start=${timeStart}&time_end=${timeEnd}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tempest device HTTP ${res.status}`);
    const data = await res.json();

    const obs = data.obs;
    const results = aggregateDaily(obs, days, now, today, lat);
    setCached("tempest_v12", cacheKey, results);
    return results;
  } catch (err) {
    console.error("[Tempest] fetch error:", err);
    return emptyDays(days, now);
  }
}

/** Aggregate obs_st minute rows into per-day summaries. */
function aggregateDaily(obs, days, now, today, lat) {
  if (!Array.isArray(obs) || !obs.length) {
    console.warn("[Tempest] device endpoint returned no obs rows");
    return emptyDays(days, now);
  }

  const byDate = new Map();

  for (const row of obs) {
    if (!Array.isArray(row) || row[0] == null) continue;
    const dateStr = localDateStr(new Date(row[0] * 1000));
    if (dateStr === today) continue;

    if (!byDate.has(dateStr)) {
      byDate.set(dateStr, { precipMax: 0, temps: [], rhs: [], winds: [], solars: [], pressures: [] });
    }
    const d = byDate.get(dateStr);
    if (typeof row[18] === "number") d.precipMax = Math.max(d.precipMax, row[18]);
    if (typeof row[7]  === "number") d.temps.push(row[7]);
    if (typeof row[8]  === "number") d.rhs.push(row[8]);
    if (typeof row[2]  === "number") d.winds.push(row[2]);
    if (typeof row[11] === "number") d.solars.push(row[11]);
    if (typeof row[6]  === "number") d.pressures.push(row[6]);
  }

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const result = [];
  for (let offset = days; offset >= 1; offset--) {
    const d = new Date(now); d.setDate(d.getDate() - offset);
    const dateStr = localDateStr(d);
    const agg = byDate.get(dateStr);

    if (!agg || !agg.temps.length) {
      result.push({ date: dateStr, precip: null, et: null });
      continue;
    }

    const doy = dayOfYear(new Date(dateStr + "T12:00:00"));
    const rhMean  = agg.rhs.length       ? mean(agg.rhs)       : null;
    const presMean = agg.pressures.length ? mean(agg.pressures) : null;

    const et = lat != null ? calcEt0PM({
      tmax:           Math.max(...agg.temps),
      tmin:           Math.min(...agg.temps),
      rhHigh:         rhMean,
      rhLow:          rhMean,
      pressureHighMb: presMean,
      pressureLowMb:  presMean,
      windAvgMs:      agg.winds.length  ? mean(agg.winds)  : null,
      solarPeakWm2:   agg.solars.length ? Math.max(...agg.solars) : null,
      lat, doy,
    }) : null;

    result.push({ date: dateStr, precip: agg.precipMax, et });
  }
  return result;
}

function emptyDays(days, now) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (days - i));
    return { date: localDateStr(d), precip: null, et: null };
  });
}

window.fetchTempestDailyStats = fetchTempestDailyStats;

})();
