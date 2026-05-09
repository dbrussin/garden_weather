// App entry point. Wires together geo, storage, API, and UI modules.
//
// Keep this file small: it only orchestrates. Feature logic lives in the
// modules it imports.

(function () {

const els = {
  useMine: document.getElementById("use-my-location"),
  save: document.getElementById("save-location"),
  current: document.getElementById("current-location"),
  status: document.getElementById("location-status"),
  unitMetric: document.getElementById("unit-metric"),
  unitImperial: document.getElementById("unit-imperial"),
  coordGo: document.getElementById("coord-go"),
  coordLat: document.getElementById("coord-lat"),
  coordLon: document.getElementById("coord-lon"),
  coordName: document.getElementById("coord-name"),
  coordError: document.getElementById("coord-error"),
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
els.coordGo.addEventListener("click", onManualCoord);
// Enter key in any coord input triggers Go.
for (const input of [els.coordLat, els.coordLon, els.coordName]) {
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onManualCoord(); } });
}

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

async function onManualCoord() {
  const lat = parseFloat(els.coordLat.value);
  const lon = parseFloat(els.coordLon.value);
  const nameInput = els.coordName.value.trim();
  els.coordError.hidden = true;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    els.coordError.textContent = "Latitude must be a number between -90 and 90.";
    els.coordError.hidden = false;
    return;
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    els.coordError.textContent = "Longitude must be a number between -180 and 180.";
    els.coordError.hidden = false;
    return;
  }
  // Activate immediately with a coord-string name so the dashboard loads
  // without waiting on the network. Geocode in the background and update
  // the display name if it succeeds.
  const coordName = nameInput || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  await activate({ lat, lon, name: coordName });
  if (!nameInput) {
    reverseGeocode({ lat, lon }).then((place) => {
      if (!place) return;
      if (active?.lat !== lat || active?.lon !== lon) return; // user moved on
      const geocodedName = [place.name, place.admin1].filter(Boolean).join(", ");
      active = { ...active, name: geocodedName };
      renderCurrent(active);
    }).catch(() => { /* non-fatal */ });
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

})();
