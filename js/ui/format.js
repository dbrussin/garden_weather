// Small formatting helpers shared by UI modules.

export function fmtNum(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return "–";
  return (Math.round(n * 10 ** digits) / 10 ** digits).toString();
}

export function fmtTemp(n, unit = "°C") {
  return n == null ? "–" : `${fmtNum(n)}${unit}`;
}

export function fmtPct(n) {
  return n == null ? "–" : `${Math.round(n * 100)}%`;
}

export function fmtMoisture(n) {
  // Open-Meteo returns volumetric soil moisture in m³/m³ (0–1).
  // Display as percent with one decimal.
  if (n == null) return "–";
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtTime(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtDay(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function fmtCoords(lat, lon) {
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}
