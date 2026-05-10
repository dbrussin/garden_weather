// User preferences persisted in localStorage.
//
// Currently just a units toggle. Forecast data is always fetched from
// Open-Meteo in metric (°C, mm, m/s); display conversion happens in
// ui/format.js so metrics.js thresholds can stay unit-free.

(function () {

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

function getSettings() {
  return { ...state };
}

function getUnits() {
  return state.units;
}

function setUnits(units) {
  if (units !== "metric" && units !== "imperial") return;
  state = { ...state, units };
  write(state);
  for (const fn of listeners) fn(state);
}

function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Tempest station configuration

const TEMPEST_KEY = "garden_weather.tempest.v1";

function getTempestConfig() {
  try {
    const raw = localStorage.getItem(TEMPEST_KEY);
    if (!raw) return null;
    const { stationId, token } = JSON.parse(raw);
    if (!stationId || !token) return null;
    return { stationId: String(stationId), token: String(token) };
  } catch {
    return null;
  }
}

function setTempestConfig({ stationId, token } = {}) {
  if (!stationId || !token) {
    localStorage.removeItem(TEMPEST_KEY);
    return;
  }
  localStorage.setItem(TEMPEST_KEY, JSON.stringify({
    stationId: String(stationId).trim(),
    token: String(token).trim(),
  }));
}

function clearTempestConfig() {
  localStorage.removeItem(TEMPEST_KEY);
}

window.getSettings = getSettings;
window.getUnits = getUnits;
window.setUnits = setUnits;
window.onSettingsChange = onSettingsChange;
window.getTempestConfig = getTempestConfig;
window.setTempestConfig = setTempestConfig;
window.clearTempestConfig = clearTempestConfig;

})();
