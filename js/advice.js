// Combine raw metrics into short, actionable gardener advice.
// Inputs come from metrics.js; outputs are plain data for the UI to render.
// Display strings are unit-aware via ui/format.js.

import { fmtTemp, fmtPrecip, fmtNum } from "./ui/format.js";

export function buildAdvice({ frost, soil, water, rain, sun, humidity, dryWindow }) {
  const bullets = [];
  let level = "ok";
  let headline = "Good gardening day.";

  if (frost?.level === "severe") {
    level = "danger";
    headline = `Hard frost expected ${shortDate(frost.day)} (${fmtTemp(frost.temp)}).`;
    bullets.push("Cover tender plants or bring containers in before sundown.");
  } else if (frost?.level === "warn") {
    level = "warn";
    headline = `Light frost possible ${shortDate(frost.day)} (${fmtTemp(frost.temp)}).`;
    bullets.push("Hold off on setting out warm-season seedlings.");
  }

  if (soil?.surfaceTemp != null && soil.surfaceTemp < 10) {
    bullets.push(`Surface soil is ${fmtTemp(soil.surfaceTemp)} — too cold to direct-sow most warm-season crops.`);
  } else if (soil?.surfaceTemp != null && soil.surfaceTemp >= 15) {
    bullets.push(`Soil is ${fmtTemp(soil.surfaceTemp)} at the surface — good for most transplants.`);
  }

  if (water) {
    if (water.deficit > 15) {
      if (level === "ok") level = "warn";
      bullets.push(`Dry week: ~${fmtPrecip(water.deficit)} water deficit over ${water.window} days. Consider a deep watering.`);
    } else if (water.deficit < -5) {
      bullets.push(`Soggy week: ${fmtPrecip(-water.deficit)} surplus. Skip irrigation, check drainage.`);
    }
  }

  if (rain && daysUntil(rain.date) <= 2) {
    bullets.push(`Rain coming ${shortDate(rain.date)} (~${fmtPrecip(rain.amount)}) — delay watering.`);
  }

  if (sun?.uvMax != null && sun.uvMax >= 8) {
    bullets.push(`High UV today (max ${fmtNum(sun.uvMax)}). Water at dawn or dusk to reduce leaf stress.`);
  }

  if (humidity?.leafWetHours != null && humidity.leafWetHours >= 10) {
    if (level === "ok") level = "warn";
    bullets.push(`Prolonged leaf wetness (${humidity.leafWetHours}h of ${humidity.windowHours}h). Watch for fungal disease — avoid overhead watering.`);
  }

  if (humidity?.vpd != null && humidity.vpd > 2) {
    bullets.push(`Very dry air (VPD ${humidity.vpd} kPa). Expect rapid wilting of unestablished plants.`);
  }

  if (dryWindow && dryWindow.hours >= 6 && !frost) {
    bullets.push(`${dryWindow.hours}h rain-free window starting ${shortDate(dryWindow.start)} — good for spraying or transplanting.`);
  }

  if (!bullets.length) {
    bullets.push("Nothing urgent — a calm day in the garden.");
  }

  return { headline, level, bullets };
}

function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function daysUntil(iso) {
  const d = Date.parse(iso);
  if (!d) return Infinity;
  return (d - Date.now()) / 86_400_000;
}
