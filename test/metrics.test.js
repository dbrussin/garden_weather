// Regression tests for js/metrics.js — focused on the "what day/hour is it
// at the location" boundary logic, since that's where every past bug in
// this file lived (a hardcoded offset in frostRisk, and three separate
// UTC-vs-location-local mismatches). See CLAUDE.md's "Open-Meteo fields
// used" section for why these boundaries matter.
//
// Run with: node --test test/

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/load.js");

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function pad(n) { return String(n).padStart(2, "0"); }

// Render an instant as the naive local date/date-time string Open-Meteo
// would emit for a location at `offsetSec`, e.g. "2026-09-08" or
// "2026-09-08T14:00".
function localDateStr(ms, offsetSec) {
  const d = new Date(ms + offsetSec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function localDateTimeStr(ms, offsetSec) {
  const d = new Date(ms + offsetSec * 1000);
  return `${localDateStr(ms, offsetSec)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

test("todayIndex finds the location's local day, not UTC's", () => {
  const { todayIndex } = loadModule("js/metrics.js");

  // Pin "now" to 22:00 UTC. For a location at UTC-7 (Portland, PDT), local
  // time is 15:00 the same UTC calendar day — no mismatch. But for a
  // location at UTC+9 (Tokyo), local time is already 07:00 *tomorrow* by
  // UTC's own date. A UTC-based "today" would look for tomorrow's row and
  // miss today's.
  const nowMs = Date.parse("2026-09-08T22:00:00Z");
  const offsetSec = 9 * 3600; // Tokyo, no DST
  const times = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];

  const idx = todayIndex(times, offsetSec, nowMs);
  assert.equal(times[idx], "2026-09-09", "should land on Tokyo's actual local date, one day ahead of UTC's");
});

test("todayIndex with zero offset matches UTC's own date", () => {
  const { todayIndex } = loadModule("js/metrics.js");
  const nowMs = Date.parse("2026-09-08T22:00:00Z");
  const times = ["2026-09-07", "2026-09-08", "2026-09-09"];
  assert.equal(todayIndex(times, 0, nowMs), 1);
});

test("frostRisk looks at the next 3 days, not a hardcoded array offset", () => {
  // This is the original bug: frostRisk used to slice(3, 6), which only
  // lined up with "the next 3 days" when past_days was exactly 3. api.js
  // requests past_days=5, so today sits at index 5 in the merged array, and
  // the old code was reading indices 3-5 — two days ago through today.
  const { frostRisk } = loadModule("js/metrics.js");

  const nowMs = Date.now();
  const offsetSec = 0;
  const times = [];
  const mins = [];
  // 5 past days + today + 6 future days, matching api.js's real shape.
  for (let dayOffset = -5; dayOffset <= 6; dayOffset++) {
    times.push(localDateStr(nowMs + dayOffset * DAY_MS, offsetSec));
    // Past days and today are deliberately cold (would be misread as
    // "upcoming frost" by the old hardcoded-offset code). Only the day 2
    // days from now is actually cold.
    mins.push(dayOffset === 2 ? -3 : dayOffset <= 0 ? -3 : 10);
  }

  const result = frostRisk({ time: times, temperature_2m_min: mins }, { utcOffsetSeconds: offsetSec });
  assert.equal(result.level, "severe");
  assert.equal(result.day, localDateStr(nowMs + 2 * DAY_MS, offsetSec));
});

test("frostRisk ignores frost further out than 3 days and past frost", () => {
  const { frostRisk } = loadModule("js/metrics.js");
  const nowMs = Date.now();
  const times = [];
  const mins = [];
  for (let dayOffset = -5; dayOffset <= 6; dayOffset++) {
    times.push(localDateStr(nowMs + dayOffset * DAY_MS, 0));
    mins.push(dayOffset === 4 ? -5 : 10); // frost is 4 days out — outside the 3-day window
  }
  const result = frostRisk({ time: times, temperature_2m_min: mins });
  assert.equal(result.level, "none");
});

test("nearestHourIndex is immune to the browser's own timezone", () => {
  // The second bug: hourly.time entries ("2026-09-08T14:00") have no
  // timezone suffix, and per the ECMAScript Date Time String Format, a
  // date-TIME string without an offset parses as the *browser's* local
  // time (unlike a date-only string, which parses as UTC). Naively calling
  // Date.parse on these would silently reinterpret the location's local
  // time as wherever the code happens to be running.
  const { nearestHourIndex } = loadModule("js/metrics.js");

  const nowMs = Date.parse("2026-09-08T12:00:00Z");
  const offsetSec = -7 * 3600; // Portland, PDT
  const times = [];
  for (let h = -3; h <= 3; h++) {
    times.push(localDateTimeStr(nowMs + h * HOUR_MS, offsetSec));
  }
  // Index 3 (h=0) should be nearest, regardless of what timezone this test
  // process itself happens to run under.
  assert.equal(nearestHourIndex(times, offsetSec, nowMs), 3);
});

test("growingDegreeDays only sums through today's index, not future forecast days", () => {
  const { growingDegreeDays } = loadModule("js/metrics.js");
  const nowMs = Date.now();
  const times = [];
  const tmax = [];
  const tmin = [];
  for (let dayOffset = -2; dayOffset <= 3; dayOffset++) {
    times.push(localDateStr(nowMs + dayOffset * DAY_MS, 0));
    // Every day (past, today, and future) is warm enough to contribute GDD
    // if it were (wrongly) included, so a passing test proves future days
    // were excluded, not just that the sum happens to be small.
    tmax.push(20);
    tmin.push(20);
  }
  const result = growingDegreeDays({ time: times, temperature_2m_max: tmax, temperature_2m_min: tmin }, { base: 10 });
  assert.equal(result.days, 3, "should count only the 2 past days + today, not the 3 future days");
  assert.equal(result.total, 30); // 3 days * (20 - 10)
});

test("waterBalance sums exactly `window` days ending today", () => {
  const { waterBalance } = loadModule("js/metrics.js");
  const nowMs = Date.now();
  const times = [];
  const et = [];
  const precip = [];
  for (let dayOffset = -6; dayOffset <= 2; dayOffset++) {
    times.push(localDateStr(nowMs + dayOffset * DAY_MS, 0));
    et.push(1);
    precip.push(0);
  }
  const result = waterBalance({ time: times, et0_fao_evapotranspiration: et, precipitation_sum: precip }, { window: 7 });
  assert.equal(result.window, 7, "window=7 should mean 7 days, not 8");
  assert.equal(result.et, 7);
});

test("nextRain starts from today, not a day early or late", () => {
  const { nextRain } = loadModule("js/metrics.js");
  const nowMs = Date.now();
  const times = [];
  const precip = [];
  for (let dayOffset = -2; dayOffset <= 3; dayOffset++) {
    times.push(localDateStr(nowMs + dayOffset * DAY_MS, 0));
    precip.push(dayOffset === -1 ? 10 : dayOffset === 2 ? 5 : 0); // rain yesterday (ignore) and in 2 days (find this)
  }
  const result = nextRain({ time: times, precipitation_sum: precip });
  assert.equal(result.date, localDateStr(nowMs + 2 * DAY_MS, 0));
  assert.equal(result.amount, 5);
});

test("dailyWaterDetail splits historical/projected at the location's actual today", () => {
  // dailyWaterDetail doesn't expose a nowMs override (unlike the lower-level
  // todayIndex/nearestHourIndex), so — like the frostRisk/growingDegreeDays
  // tests above — this builds its fixture around the real clock rather than
  // a pinned instant.
  const { dailyWaterDetail } = loadModule("js/metrics.js");
  const nowMs = Date.now();
  const offsetSec = 9 * 3600; // Tokyo
  const times = [];
  const et = [];
  const precip = [];
  for (let dayOffset = -5; dayOffset <= 5; dayOffset++) {
    times.push(localDateStr(nowMs + dayOffset * DAY_MS, offsetSec));
    et.push(1);
    precip.push(0);
  }
  const result = dailyWaterDetail(
    { time: times, et0_fao_evapotranspiration: et, precipitation_sum: precip },
    null,
    { histDays: 5, futureDays: 5, utcOffsetSeconds: offsetSec },
  );
  assert.equal(result.historical.length, 5);
  assert.equal(result.projected.length, 5);
  assert.equal(result.projected[0].date, localDateStr(nowMs, offsetSec));
});
