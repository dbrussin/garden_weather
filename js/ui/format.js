// Small formatting helpers shared by UI modules.
//
// Values coming in are always in metric (°C, mm, m/s). Display conversion
// to imperial happens here based on the current unit preference.

import { getUnits } from "../settings.js";

export function fmtNum(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return "–";
  return (Math.round(n * 10 ** digits) / 10 ** digits).toString();
}

export function fmtTemp(c) {
  if (c == null || Number.isNaN(c)) return "–";
  if (getUnits() === "imperial") return `${fmtNum(cToF(c))}°F`;
  return `${fmtNum(c)}°C`;
}

export function fmtTempDelta(c) {
  // A temperature difference, not an absolute reading.
  if (c == null || Number.isNaN(c)) return "–";
  if (getUnits() === "imperial") return `${fmtNum(c * 9 / 5)}°F`;
  return `${fmtNum(c)}°C`;
}

export function fmtPrecip(mm) {
  if (mm == null || Number.isNaN(mm)) return "–";
  if (getUnits() === "imperial") return `${fmtNum(mm / 25.4, 2)} in`;
  return `${fmtNum(mm)} mm`;
}

export function fmtWind(mps) {
  // Open-Meteo returns wind in km/h by default when no override is set on
  // the forecast request; we request metric so it's km/h. Convert to mph
  // for imperial display.
  if (mps == null || Number.isNaN(mps)) return "–";
  if (getUnits() === "imperial") return `${fmtNum(mps * 0.621371)} mph`;
  return `${fmtNum(mps)} km/h`;
}

export function fmtPct(n) {
  return n == null ? "–" : `${Math.round(n * 100)}%`;
}

export function fmtMoisture(n) {
  // Open-Meteo returns volumetric soil moisture in m³/m³ (0–1).
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

export function cToF(c) {
  return c * 9 / 5 + 32;
}

export function mmToIn(mm) {
  return mm / 25.4;
}

export function tempUnit() {
  return getUnits() === "imperial" ? "°F" : "°C";
}

export function precipUnit() {
  return getUnits() === "imperial" ? "in" : "mm";
}
