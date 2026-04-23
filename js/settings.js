// User preferences persisted in localStorage.
//
// Currently just a units toggle. Forecast data is always fetched from
// Open-Meteo in metric (°C, mm, m/s); display conversion happens in
// ui/format.js so metrics.js thresholds can stay unit-free.

const KEY = "garden_weather.settings.v1";
const DEFAULTS = { units: "metric" }; // "metric" | "imperial"

const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

let state = read();

export function getSettings() {
  return { ...state };
}

export function getUnits() {
  return state.units;
}

export function setUnits(units) {
  if (units !== "metric" && units !== "imperial") return;
  state = { ...state, units };
  write(state);
  for (const fn of listeners) fn(state);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
