// App entry point. Wires together geo, storage, API, and UI modules.
//
// Keep this file small: it only orchestrates. Feature logic lives in the
// modules it imports.

import { fetchForecast, reverseGeocode } from "./api.js";
import { getCurrentPosition } from "./geo.js";
import { addLocation } from "./storage.js";
import { renderDashboard } from "./ui/dashboard.js";
import { initLocations } from "./ui/locations.js";
import { fmtCoords } from "./ui/format.js";

const els = {
  useMine: document.getElementById("use-my-location"),
  save: document.getElementById("save-location"),
  current: document.getElementById("current-location"),
  status: document.getElementById("location-status"),
};

// The location currently displayed in the dashboard.
let active = null; // { lat, lon, name }

const locations = initLocations((loc) => {
  activate({ lat: loc.lat, lon: loc.lon, name: loc.name });
});

els.useMine.addEventListener("click", onUseMyLocation);
els.save.addEventListener("click", onSave);

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
  try {
    const forecast = await fetchForecast({ lat, lon });
    renderDashboard(forecast);
    setStatus("");
  } catch (err) {
    setStatus(err.message || "Forecast failed.", true);
  }
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
