// WeatherFlow Tempest REST API — fetch daily precipitation and ET actuals.
//
// The station observations endpoint returns the CURRENT named-field observation.
// When queried with day_offset=N it returns the named-field observation for
// day N (1 = yesterday, 2 = two days ago, etc.) — same format, different day.
//
// Named-field format (what the /observations/station endpoint returns):
//   precip_accum_local_yesterday_final — Rain Check corrected yesterday total (mm)
//   precip_accum_local_day             — today's running accumulation (mm)
//   air_temperature                    — instantaneous °C
//   relative_humidity                  — instantaneous %
//   station_pressure                   — instantaneous mb
//   wind_avg                           — instantaneous m/s
//   solar_radiation                    — instantaneous W/m²
//
// When the endpoint returns positional arrays (daily summary format from some
// account types), parseDailyPositional handles that path using the column
// mapping the user confirmed:
//   col  0: timestamp, col  1: air_temp_high, col  2: air_temp_low,
//   col  3: rh_high,   col  4: rh_low,        col  5: pressure_high,
//   col  6: pressure_low, col 7: wind_avg,    col 11: solar_radiation_high,
//   col 13: precip_accum_final

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

/**
 * Fetch daily precipitation and ET actuals for the past `days` complete days.
 * Returns array oldest-first: [{date, precip, et}, …].
 *
 * Makes up to `days` requests (one per day_offset) to get historical data.
 * Handles both named-field and positional-array response formats.
 *
 * @param {{ stationId: string|number, token: string, days?: number, lat?: number|null }} opts
 */
async function fetchTempestDailyStats({ stationId, token, days = 5, lat = null }) {
  const now = new Date();
  const today = localDateStr(now);

  const latKey = lat != null ? (+lat).toFixed(2) : "x";
  const cacheKey = `${stationId},${today},${latKey}`;
  const hit = getCached("tempest_v7", cacheKey, TTL_MS);
  if (hit) return hit;

  try {
    // First fetch with no day_offset (current/today) to detect response format.
    // Also fetches with day_offset=1..days to cover history.
    const requests = [];
    for (let offset = 1; offset <= days; offset++) {
      requests.push(fetchDayOffset(stationId, token, offset));
    }
    const responses = await Promise.all(requests);

    const results = responses.map((data, i) => {
      const offset = i + 1; // 1 = yesterday, 2 = two days ago, …
      const d = new Date(now);
      d.setDate(d.getDate() - offset);
      const dateStr = localDateStr(d);

      if (!data?.obs?.length) {
        console.log(`[Tempest] day_offset=${offset}: no obs`);
        return { date: dateStr, precip: null, et: null };
      }

      const firstRow = data.obs[0];

      // Log precip fields and timestamp so we can identify the correct field name.
      if (Array.isArray(firstRow)) {
        console.log(`[Tempest] day_offset=${offset} (positional): row=`, firstRow);
      } else {
        const ts = firstRow.timestamp ? new Date(firstRow.timestamp * 1000).toISOString() : "?";
        console.log(`[Tempest] day_offset=${offset} timestamp=${ts}`, {
          precip_accum_local_day:               firstRow.precip_accum_local_day,
          precip_accum_local_day_final:         firstRow.precip_accum_local_day_final,
          precip_accum_local_yesterday:         firstRow.precip_accum_local_yesterday,
          precip_accum_local_yesterday_final:   firstRow.precip_accum_local_yesterday_final,
          air_temperature:                      firstRow.air_temperature,
          air_temperature_high:                 firstRow.air_temperature_high,
          air_temperature_low:                  firstRow.air_temperature_low,
          solar_radiation:                      firstRow.solar_radiation,
          solar_radiation_high:                 firstRow.solar_radiation_high,
        });
      }

      // Positional array format (daily summary — some account types)
      if (Array.isArray(firstRow)) {
        return parseDailyPositional(firstRow, dateStr, lat);
      }

      // Named-field format (current observation for that day)
      return parseDailyNamed(firstRow, dateStr, lat);
    });

    // Reverse so oldest is first.
    results.reverse();

    setCached("tempest_v7", cacheKey, results);
    return results;
  } catch (err) {
    console.error("[Tempest] fetch error:", err);
    return emptyDays(days, now);
  }
}

async function fetchDayOffset(stationId, token, dayOffset) {
  const url =
    `${BASE}/observations/station/${encodeURIComponent(stationId)}` +
    `?token=${encodeURIComponent(token)}&day_offset=${dayOffset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tempest HTTP ${res.status} (day_offset=${dayOffset})`);
  return res.json();
}

/**
 * Parse a single named-field observation object (what /observations/station returns).
 * Extracts precip and computes ET₀ from instantaneous sensor readings.
 * ET from instantaneous values is less accurate than from daily high/low,
 * but it's the best available from this endpoint.
 */
function parseDailyNamed(obs, dateStr, lat) {
  const precip = typeof obs.precip_accum_local_yesterday_final === "number"
    ? obs.precip_accum_local_yesterday_final
    : typeof obs.precip_accum_local_day === "number"
    ? obs.precip_accum_local_day
    : null;

  // ET from instantaneous values: use current temp as both tmax and tmin
  // (a rough approximation; Open-Meteo ET will be more accurate for historical days).
  const t = typeof obs.air_temperature === "number" ? obs.air_temperature : null;
  const rh = typeof obs.relative_humidity === "number" ? obs.relative_humidity : null;
  const pressure = typeof obs.station_pressure === "number" ? obs.station_pressure : null;
  const wind = typeof obs.wind_avg === "number" ? obs.wind_avg : null;
  const solar = typeof obs.solar_radiation === "number" ? obs.solar_radiation : null;
  const rowDate = new Date(dateStr + "T12:00:00");
  const doy = dayOfYear(rowDate);

  const et = (lat != null && t != null) ? calcEt0PM({
    tmax: t, tmin: t,
    rhHigh: rh, rhLow: rh,
    pressureHighMb: pressure, pressureLowMb: pressure,
    windAvgMs: wind,
    solarPeakWm2: solar,
    lat, doy,
  }) : null;

  return { date: dateStr, precip, et };
}

/**
 * Parse a single positional-array daily summary row.
 * Column mapping confirmed by user:
 *   0=timestamp, 1=air_temp_high, 2=air_temp_low, 3=rh_high, 4=rh_low,
 *   5=pressure_high, 6=pressure_low, 7=wind_avg, 11=solar_radiation_high,
 *   13=precip_accum_final
 */
function parseDailyPositional(row, dateStr, lat) {
  const precip = typeof row[13] === "number" ? row[13] : null;
  const rowDate = new Date(dateStr + "T12:00:00");
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
    lat, doy,
  }) : null;

  return { date: dateStr, precip, et };
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
