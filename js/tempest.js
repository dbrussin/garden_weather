// WeatherFlow Tempest REST API — fetch daily precipitation and ET actuals.
//
// Endpoint: GET /observations/station/{station_id}?token=...&time_start=...&time_end=...
//
// When time_end is set to local midnight (range entirely in the past) the
// station endpoint should return positional-array rows rather than the live
// named-field snapshot.  Two positional formats may be returned:
//
// obs_st_ext  — Tempest Daily Observation (one row per day, 34 cols)
//   0  timestamp         5  temp_high        6  temp_low
//   7  avg_humidity       8  rh_high          9  rh_low
//  16  avg_solar         17  solar_high      19  avg_wind
//   2  pressure_high      3  pressure_low    28  local_day_rain_accumulation
//  29  nearcast_rain_accum (Rain Check analog)
//
// obs_st  — Tempest Minute-by-Minute (one row per ~1 min interval, 22 cols)
//   0  timestamp   2  wind_avg   6  pressure   7  air_temp   8  rh
//  11  solar_radiation          18  local_day_rain_accumulation
//
// If neither positional format is received (named-field current snapshot
// returned instead), precip is taken from precip_accum_local_yesterday_final
// for yesterday only; Open-Meteo covers the rest.

(function () {

const BASE = "https://swd.weatherflow.com/swd/rest";
const TTL_MS = 60 * 60 * 1000; // 1 hour

/** YYYY-MM-DD in the browser's local timezone. */
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Day-of-year (1–366). */
function dayOfYear(date) {
  return Math.round((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
}

/**
 * Fetch daily precipitation and ET actuals for the past `days` complete days.
 * @param {{ stationId: string|number, token: string, days?: number, lat?: number|null }} opts
 */
async function fetchTempestDailyStats({ stationId, token, days = 5, lat = null }) {
  const now = new Date();
  const today = localDateStr(now);

  const latKey = lat != null ? (+lat).toFixed(2) : "x";
  const cacheKey = `${stationId},${today},${latKey}`;
  const hit = getCached("tempest_v11", cacheKey, TTL_MS);
  if (hit) return hit;

  // Use local midnight as time_end so the range is entirely in the past,
  // which should trigger the historical positional-array response format.
  const end = new Date(now); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - days);
  const timeStart = Math.floor(start.getTime() / 1000);
  const timeEnd   = Math.floor(end.getTime() / 1000);

  try {
    const url =
      `${BASE}/observations/station/${encodeURIComponent(stationId)}` +
      `?token=${encodeURIComponent(token)}&time_start=${timeStart}&time_end=${timeEnd}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tempest HTTP ${res.status}`);
    const data = await res.json();

    const obs = data.obs;
    const firstRow = Array.isArray(obs) && obs.length ? obs[0] : null;
    const isPositional = Array.isArray(firstRow);
    const rowLen = isPositional ? firstRow.length : 0;

    console.log("[Tempest] response: obs count =", obs?.length,
      "| first row type =", isPositional ? `array[${rowLen}]` : typeof firstRow,
      "| outdoor_keys =", data.outdoor_keys,
      "| station_id =", data.station_id);

    // Try to resolve device_id from /stations/ metadata endpoint.
    let deviceId = null;
    try {
      const stMeta = await fetch(
        `${BASE}/stations/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`
      ).then((r) => r.json());
      console.log("[Tempest] /stations/ response:", JSON.stringify(stMeta).slice(0, 500));
      const st = Array.isArray(stMeta.stations) ? stMeta.stations[0] : null;
      const dev = st?.devices?.find((d) => d.device_type === "ST");
      if (dev?.device_id) deviceId = dev.device_id;
    } catch (e) {
      console.warn("[Tempest] /stations/ lookup failed:", e.message);
    }
    console.log("[Tempest] resolved deviceId:", deviceId);

    let results;
    if (isPositional && rowLen >= 30) {
      // obs_st_ext: Tempest Daily Observation — one row per day
      results = parseExtRows(obs, days, now, today, lat);
    } else if (isPositional && rowLen >= 18) {
      // obs_st: minute-by-minute — aggregate into daily summaries
      results = aggregateMinuteRows(obs, days, now, today, lat);
    } else {
      // Named-field current snapshot — extract what we can
      console.warn("[Tempest] Got live named-field snapshot instead of historical rows.",
        "time_start:", new Date(timeStart * 1000).toISOString(),
        "time_end:", new Date(timeEnd * 1000).toISOString());
      results = parseNamedSnapshot(firstRow, days, now);
    }

    setCached("tempest_v11", cacheKey, results);
    return results;
  } catch (err) {
    console.error("[Tempest] fetch error:", err);
    return emptyDays(days, now);
  }
}

// ---------------------------------------------------------------------------
// obs_st_ext: Tempest Daily Observation (one row per complete day, ~34 cols)

function parseExtRows(obs, days, now, today, lat) {
  const byDate = new Map();
  for (const row of obs) {
    if (!Array.isArray(row) || row[0] == null) continue;
    const dateStr = localDateStr(new Date(row[0] * 1000));
    if (dateStr === today) continue;
    byDate.set(dateStr, row);
  }

  const result = [];
  for (let offset = days; offset >= 1; offset--) {
    const d = new Date(now); d.setDate(d.getDate() - offset);
    const dateStr = localDateStr(d);
    const row = byDate.get(dateStr);
    if (!row) { result.push({ date: dateStr, precip: null, et: null }); continue; }

    const precip = typeof row[28] === "number" ? row[28] : null;
    const doy = dayOfYear(new Date(dateStr + "T12:00:00"));

    const et = lat != null ? calcEt0PM({
      tmax:           typeof row[5]  === "number" ? row[5]  : null, // highest temp
      tmin:           typeof row[6]  === "number" ? row[6]  : null, // lowest temp
      rhHigh:         typeof row[8]  === "number" ? row[8]  : null, // highest RH
      rhLow:          typeof row[9]  === "number" ? row[9]  : null, // lowest RH
      pressureHighMb: typeof row[2]  === "number" ? row[2]  : null, // highest pressure
      pressureLowMb:  typeof row[3]  === "number" ? row[3]  : null, // lowest pressure
      windAvgMs:      typeof row[19] === "number" ? row[19] : null, // avg wind
      solarPeakWm2:   typeof row[17] === "number" ? row[17] : null, // highest solar
      lat, doy,
    }) : null;

    result.push({ date: dateStr, precip, et });
  }
  return result;
}

// ---------------------------------------------------------------------------
// obs_st: minute-by-minute (aggregate into daily summaries)
// Column indices per API docs:
//   0=timestamp  2=wind_avg  6=pressure  7=air_temp  8=rh
//  11=solar_radiation  18=local_day_rain_accumulation

function aggregateMinuteRows(obs, days, now, today, lat) {
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
    if (!agg || !agg.temps.length) { result.push({ date: dateStr, precip: null, et: null }); continue; }

    const doy = dayOfYear(new Date(dateStr + "T12:00:00"));
    const et = lat != null ? calcEt0PM({
      tmax: Math.max(...agg.temps), tmin: Math.min(...agg.temps),
      rhHigh: agg.rhs.length ? mean(agg.rhs) : null,
      rhLow:  agg.rhs.length ? mean(agg.rhs) : null,
      pressureHighMb: agg.pressures.length ? mean(agg.pressures) : null,
      pressureLowMb:  agg.pressures.length ? mean(agg.pressures) : null,
      windAvgMs:    agg.winds.length  ? mean(agg.winds)  : null,
      solarPeakWm2: agg.solars.length ? Math.max(...agg.solars) : null,
      lat, doy,
    }) : null;

    result.push({ date: dateStr, precip: agg.precipMax, et });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Named-field snapshot fallback: only yesterday's final precip is available.

function parseNamedSnapshot(obs, days, now) {
  const result = emptyDays(days, now);
  if (!obs || typeof obs !== "object" || Array.isArray(obs)) return result;
  // Overwrite the most recent entry (yesterday) with whatever precip field exists.
  const precip = typeof obs.precip_accum_local_yesterday_final === "number"
    ? obs.precip_accum_local_yesterday_final : null;
  if (result.length > 0) result[result.length - 1].precip = precip;
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
