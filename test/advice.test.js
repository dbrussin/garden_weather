// Regression tests for js/advice.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/load.js");

// advice.js calls fmtTemp/fmtPrecip/fmtNum (from ui/format.js) as bare
// identifiers. Stub them directly rather than loading the real format.js,
// which would in turn need settings.js's getUnits() and a localStorage
// stub — more sandbox setup than this test needs.
const FORMAT_STUBS = { fmtTemp: () => "0°C", fmtPrecip: () => "0 mm", fmtNum: () => "0" };

test("dry-window bullet fires when there is no frost risk", () => {
  // Original bug: the condition was `!frost`, but frostRisk() always
  // returns a truthy object (even at level "none"), so this bullet could
  // never render.
  const { buildAdvice } = loadModule("js/advice.js", { globals: FORMAT_STUBS });

  const advice = buildAdvice({
    frost: { level: "none", day: null, temp: null },
    soil: null,
    water: null,
    rain: null,
    sun: null,
    humidity: null,
    dryWindow: { hours: 12, start: "2026-09-08T06:00", end: "2026-09-08T18:00" },
  });

  assert.ok(
    advice.bullets.some((b) => b.includes("rain-free window")),
    `expected a rain-free-window bullet, got: ${JSON.stringify(advice.bullets)}`,
  );
});

test("dry-window bullet is suppressed when frost is a real concern", () => {
  const { buildAdvice } = loadModule("js/advice.js", { globals: FORMAT_STUBS });

  const advice = buildAdvice({
    frost: { level: "severe", day: "2026-09-09", temp: -2 },
    soil: null,
    water: null,
    rain: null,
    sun: null,
    humidity: null,
    dryWindow: { hours: 12, start: "2026-09-08T06:00", end: "2026-09-08T18:00" },
  });

  assert.ok(!advice.bullets.some((b) => b.includes("rain-free window")));
});

test("daysUntil accounts for the location's own offset, not just Date.now()", () => {
  const { daysUntil } = loadModule("js/advice.js", { globals: FORMAT_STUBS });

  // daysUntil measures distance to the target date's *midnight at the
  // location*. Since `iso` (a date-only string) parses as UTC midnight of
  // that literal date, and the offset-aware version shifts "now" by the
  // location's own offset before comparing, the two versions should differ
  // by exactly offsetSeconds worth of days — always, for any target date —
  // which is a stronger and more honest assertion than picking one date and
  // eyeballing whether the number "looks about right".
  const nowMs = Date.parse("2026-09-08T22:00:00Z");
  const offsetSec = 9 * 3600; // Tokyo
  const iso = "2026-09-10";

  const withOffset = daysUntil(iso, offsetSec, nowMs);
  const withoutOffset = daysUntil(iso, 0, nowMs);
  const expectedShift = offsetSec / 86_400;

  assert.ok(
    Math.abs((withoutOffset - withOffset) - expectedShift) < 1e-9,
    `expected the offset to shift the result by ${expectedShift} days; got withOffset=${withOffset}, withoutOffset=${withoutOffset}`,
  );
});
