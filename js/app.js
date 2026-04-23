// App entry point. Wires together geo, storage, API, and UI modules.
//
// Keep this file small: it only orchestrates. Feature logic lives in the
// modules it imports.

import { fetchForecast, fetchHistoricalMinima, reverseGeocode } from "./api.js";
import { getCurrentPosition } from "./geo.js";
import { addLocation } from "./storage.js";
import { renderDashboard } from "./ui/dashboard.js";
import { initLocations } from "./ui/locations.js";
import { fmtCoords } from "./ui/format.js";
import { getUnits, setUnits } from "./settings.js";

const els = {
  useMine: document.getElementById("use-my-location"),
  save: document.getElementById("save-location"),
  current: document.getElementById("current-location"),
  status: document.getElementById("location-status"),
  unitMetric: document.getElementById("unit-metric"),
  unitImperial: document.getElementById("unit-imperial"),
};

// The location currently displayed in the dashboard.
let active = null; // { lat, lon, name }
// Cache of forecast + historical data so unit toggles rerender without refetch.
let cache = { forecast: null, historical: null, key: null };

const locations = initLocations((loc) => {
  activate({ lat: loc.lat, lon: loc.lon, name: loc.name });
});

els.useMine.addEventListener("click", onUseMyLocation);
els.save.addEventListener("click", onSave);
els.unitMetric.addEventListener("click", () => switchUnits("metric"));
els.unitImperial.addEventListener("click", () => switchUnits("imperial"));

syncUnitButtons();

async function onUseMyLocation() {
  setStatus("Locating…");
  try {
    const { lat, lon } = await getCurrentPosition();
    const place = await reverseGeocode({ lat, lon });
    const name = place ? [place.name, place.admin1].filter(Boolean).join(", ") : "Current location";
    await activate({ lat, lon, name });
  } catch (err) {
    setStatus(err.message || "Could not get location.", true);
  }
}

function onSave() {
  if (!active) return;
  addLocation(active);
  locations.render();
  setStatus(`Saved "${active.name}".`);
}

async function activate({ lat, lon, name }) {
  active = { lat, lon, name };
  renderCurrent(active);
  els.save.disabled = false;
  setStatus("Fetching forecast…");
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  try {
    const forecast = await fetchForecast({ lat, lon });
    cache = { forecast, historical: null, key };
    renderDashboard(forecast, null);
    setStatus("");
    // Historical data for hardiness zone loads after — it's slower and the
    // rest of the dashboard shouldn't wait on it.
    fetchHistoricalMinima({ lat, lon }).then((historical) => {
      if (cache.key !== key) return; // user moved on
      cache.historical = historical;
      renderDashboard(forecast, historical);
    }).catch(() => { /* non-fatal */ });
  } catch (err) {
    setStatus(err.message || "Forecast failed.", true);
  }
}

function switchUnits(units) {
  if (units === getUnits()) return;
  setUnits(units);
  syncUnitButtons();
  if (cache.forecast) renderDashboard(cache.forecast, cache.historical);
}

function syncUnitButtons() {
  const u = getUnits();
  els.unitMetric.setAttribute("aria-pressed", String(u === "metric"));
  els.unitImperial.setAttribute("aria-pressed", String(u === "imperial"));
  els.unitMetric.classList.toggle("active", u === "metric");
  els.unitImperial.classList.toggle("active", u === "imperial");
}

function renderCurrent({ name, lat, lon }) {
  els.current.innerHTML = `
    <strong>${escapeHtml(name)}</strong>
    <span class="coords">${fmtCoords(lat, lon)}</span>
  `;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", !!isError);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
