// Combine raw metrics into short, actionable gardener advice.
// Inputs come from metrics.js; outputs are plain data for the UI to render.

/**
 * @param {object} ctx
 * @param {ReturnType<typeof import("./metrics.js").frostRisk>} ctx.frost
 * @param {ReturnType<typeof import("./metrics.js").soilSnapshot>} ctx.soil
 * @param {ReturnType<typeof import("./metrics.js").waterBalance>} ctx.water
 * @param {ReturnType<typeof import("./metrics.js").nextRain>} ctx.rain
 * @param {ReturnType<typeof import("./metrics.js").sunSnapshot>} ctx.sun
 * @returns {{ headline: string, level: "ok"|"warn"|"danger", bullets: string[] }}
 */
export function buildAdvice({ frost, soil, water, rain, sun }) {
  const bullets = [];
  let level = "ok";
  let headline = "Good gardening day.";

  if (frost?.level === "severe") {
    level = "danger";
    headline = `Hard frost expected ${shortDate(frost.day)} (${fmt(frost.temp)}°).`;
    bullets.push("Cover tender plants or bring containers in before sundown.");
  } else if (frost?.level === "warn") {
    level = "warn";
    headline = `Light frost possible ${shortDate(frost.day)} (${fmt(frost.temp)}°).`;
    bullets.push("Hold off on setting out warm-season seedlings.");
  }

  if (soil?.surfaceTemp != null && soil.surfaceTemp < 10) {
    bullets.push(`Surface soil is ${fmt(soil.surfaceTemp)}° — too cold to direct-sow most warm-season crops.`);
  } else if (soil?.surfaceTemp != null && soil.surfaceTemp >= 15) {
    bullets.push(`Soil is ${fmt(soil.surfaceTemp)}° at the surface — good for most transplants.`);
  }

  if (water) {
    if (water.deficit > 15) {
      if (level === "ok") level = "warn";
      bullets.push(`Dry week: ~${fmt(water.deficit)} mm water deficit over ${water.window} days. Consider a deep watering.`);
    } else if (water.deficit < -5) {
      bullets.push(`Soggy week: ${fmt(-water.deficit)} mm surplus. Skip irrigation, check drainage.`);
    }
  }

  if (rain && daysUntil(rain.date) <= 2) {
    bullets.push(`Rain coming ${shortDate(rain.date)} (~${fmt(rain.amount)} mm) — delay watering.`);
  }

  if (sun?.uvMax != null && sun.uvMax >= 8) {
    bullets.push(`High UV today (max ${fmt(sun.uvMax)}). Water at dawn or dusk to reduce leaf stress.`);
  }

  if (!bullets.length) {
    bullets.push("Nothing urgent — a calm day in the garden.");
  }

  return { headline, level, bullets };
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "–";
  return Math.round(n * 10) / 10;
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
