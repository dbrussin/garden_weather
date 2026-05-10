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
// Tempest station configuration — stored per coordinate (lat/lon rounded to
// 4 decimal places) so each saved location carries its own station.

const TEMPEST_MAP_KEY = "garden_weather.tempest_map.v1";

function tempestCoordKey(lat, lon) {
  return `${(+lat).toFixed(4)},${(+lon).toFixed(4)}`;
}

function readTempestMap() {
  try {
    const raw = localStorage.getItem(TEMPEST_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTempestMap(map) {
  try { localStorage.setItem(TEMPEST_MAP_KEY, JSON.stringify(map)); } catch {}
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{ stationId: string, token: string } | null}
 */
function getTempestConfig(lat, lon) {
  if (lat == null || lon == null) return null;
  const entry = readTempestMap()[tempestCoordKey(lat, lon)];
  if (!entry?.stationId || !entry?.token) return null;
  return { stationId: String(entry.stationId), token: String(entry.token) };
}

/**
 * @param {{ lat: number, lon: number, stationId: string, token: string }} opts
 */
function setTempestConfig({ lat, lon, stationId, token } = {}) {
  if (lat == null || lon == null) return;
  const map = readTempestMap();
  if (!stationId || !token) {
    delete map[tempestCoordKey(lat, lon)];
  } else {
    map[tempestCoordKey(lat, lon)] = {
      stationId: String(stationId).trim(),
      token: String(token).trim(),
    };
  }
  writeTempestMap(map);
}

/**
 * @param {number} lat
 * @param {number} lon
 */
function clearTempestConfig(lat, lon) {
  if (lat == null || lon == null) return;
  const map = readTempestMap();
  delete map[tempestCoordKey(lat, lon)];
  writeTempestMap(map);
}

window.getSettings = getSettings;
window.getUnits = getUnits;
window.setUnits = setUnits;
window.onSettingsChange = onSettingsChange;
window.getTempestConfig = getTempestConfig;
window.setTempestConfig = setTempestConfig;
window.clearTempestConfig = clearTempestConfig;

})();
