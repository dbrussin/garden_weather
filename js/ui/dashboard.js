// Render gardener metrics into the dashboard panels.
// Each panel is wired by id in index.html.

import {
  frostRisk,
  growingDegreeDays,
  soilSnapshot,
  waterBalance,
  nextRain,
  sunSnapshot,
} from "../metrics.js";
import { buildAdvice } from "../advice.js";
import { fmtNum, fmtTemp, fmtMoisture, fmtTime, fmtDay } from "./format.js";

/**
 * @param {object} forecast  Raw Open-Meteo response.
 */
export function renderDashboard(forecast) {
  document.getElementById("dashboard").hidden = false;
  document.getElementById("advice").hidden = false;

  const frost = frostRisk(forecast.daily);
  const soil = soilSnapshot(forecast.hourly);
  const water = waterBalance(forecast.daily);
  const rain = nextRain(forecast.daily);
  const sun = sunSnapshot(forecast.daily);
  const gdd = growingDegreeDays(forecast.daily);

  renderNow(forecast.current);
  renderFrost(frost);
  renderSoil(soil);
  renderWater(water, rain);
  renderSun(sun);
  renderGdd(gdd);
  renderForecast(forecast.daily);
  renderAdvice(buildAdvice({ frost, soil, water, rain, sun }));
}

function body(id) {
  return document.querySelector(`#${id} .panel-body`);
}

function renderNow(current) {
  const el = body("panel-now");
  if (!current) { el.textContent = "No data."; return; }
  el.innerHTML = `
    <div class="big">${fmtTemp(current.temperature_2m)}</div>
    <div class="sub">Feels ${fmtTemp(current.apparent_temperature)} &middot; ${fmtNum(current.relative_humidity_2m, 0)}% RH</div>
    <div class="sub">Wind ${fmtNum(current.wind_speed_10m)} (gust ${fmtNum(current.wind_gusts_10m)})</div>
  `;
}

function renderFrost(frost) {
  const el = body("panel-frost");
  if (!frost || frost.level === "none") {
    el.innerHTML = `<div class="big"><span class="badge">Clear</span></div>
      <div class="sub">No frost in the next 3 days.</div>`;
    return;
  }
  const cls = frost.level === "severe" ? "danger" : "warn";
  const label = frost.level === "severe" ? "Hard frost" : "Light frost";
  el.innerHTML = `
    <div class="big"><span class="badge ${cls}">${label}</span></div>
    <div class="sub">${fmtDay(frost.day)} &middot; low ${fmtTemp(frost.temp)}</div>
  `;
}

function renderSoil(soil) {
  const el = body("panel-soil");
  if (!soil) { el.textContent = "No data."; return; }
  el.innerHTML = `
    <div class="big">${fmtTemp(soil.surfaceTemp)}</div>
    <div class="sub">Surface temp</div>
    <div class="sub">Root zone (6 cm): ${fmtTemp(soil.rootTemp)}</div>
    <div class="sub">Moisture 0–1 cm: ${fmtMoisture(soil.surfaceMoisture)}</div>
    <div class="sub">Moisture 1–3 cm: ${fmtMoisture(soil.rootMoisture)}</div>
  `;
}

function renderWater(water, rain) {
  const el = body("panel-water");
  const deficit = water?.deficit ?? 0;
  const sign = deficit > 0 ? "deficit" : "surplus";
  el.innerHTML = `
    <div class="big">${fmtNum(Math.abs(deficit))} mm</div>
    <div class="sub">${water.window}-day ${sign} (ET ${fmtNum(water.et)} &minus; rain ${fmtNum(water.precip)})</div>
    <div class="sub">${rain ? `Next rain: ${fmtDay(rain.date)} (~${fmtNum(rain.amount)} mm)` : "No rain in forecast."}</div>
  `;
}

function renderSun(sun) {
  const el = body("panel-sun");
  if (!sun) { el.textContent = "No data."; return; }
  el.innerHTML = `
    <div class="big">UV ${fmtNum(sun.uvMax)}</div>
    <div class="sub">Sunrise ${fmtTime(sun.sunrise)} &middot; Sunset ${fmtTime(sun.sunset)}</div>
  `;
}

function renderGdd(gdd) {
  const el = body("panel-gdd");
  el.innerHTML = `
    <div class="big">${fmtNum(gdd.total)}</div>
    <div class="sub">${gdd.days}-day GDD (base ${gdd.base}°)</div>
  `;
}

function renderForecast(daily) {
  const el = body("panel-forecast");
  if (!daily?.time?.length) { el.textContent = "No data."; return; }
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < daily.time.length; i++) {
    const d = Date.parse(daily.time[i]);
    if (!d || d < now - 86_400_000) continue;
    rows.push(`
      <tr>
        <td>${fmtDay(daily.time[i])}</td>
        <td class="num">${fmtTemp(daily.temperature_2m_min[i])}</td>
        <td class="num">${fmtTemp(daily.temperature_2m_max[i])}</td>
        <td class="num">${fmtNum(daily.precipitation_sum[i])} mm</td>
        <td class="num">${fmtNum(daily.et0_fao_evapotranspiration[i])} mm</td>
        <td class="num">${fmtNum(daily.uv_index_max[i])}</td>
      </tr>
    `);
  }
  el.innerHTML = `
    <table class="forecast-table">
      <thead>
        <tr>
          <th>Day</th>
          <th class="num">Low</th>
          <th class="num">High</th>
          <th class="num">Rain</th>
          <th class="num">ET</th>
          <th class="num">UV</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

function renderAdvice(advice) {
  const el = document.getElementById("advice-body");
  const badgeClass = advice.level === "danger" ? "danger" : advice.level === "warn" ? "warn" : "";
  el.innerHTML = `
    <div class="verdict">
      <span class="badge ${badgeClass}">${advice.level.toUpperCase()}</span>
      <strong>${advice.headline}</strong>
    </div>
    <ul>${advice.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>
  `;
}
