// Render gardener metrics into the dashboard panels.
// Each panel is wired by id in index.html.

(function () {

/**
 * @param {object} forecast  Raw Open-Meteo forecast response (metric).
 * @param {object} [historical]  Optional archive daily {time, temperature_2m_min}.
 */
function renderDashboard(forecast, historical) {
  document.getElementById("dashboard").hidden = false;
  document.getElementById("advice").hidden = false;

  const frost = frostRisk(forecast.daily);
  const soil = soilSnapshot(forecast.hourly);
  const water = waterBalance(forecast.daily);
  const waterDetail = dailyWaterDetail(forecast.daily);
  const rain = nextRain(forecast.daily);
  const sun = sunSnapshot(forecast.daily);
  const gdd = growingDegreeDays(forecast.daily);
  const humidity = humidityMetrics(forecast.current, forecast.hourly);
  const dryWindow = rainFreeWindow(forecast.hourly);
  const zone = historical ? hardinessZone(historical) : null;
  const planting = plantingGuide(soil, frost);

  renderNow(forecast.current);
  renderFrost(frost);
  renderSoil(soil);
  renderWater(waterDetail, rain);
  renderSun(sun);
  renderGdd(gdd);
  renderHumidity(humidity);
  renderDryWindow(dryWindow);
  renderZone(zone);
  renderPlanting(planting);
  renderCharts(forecast);
  renderForecast(forecast.daily);
  renderAdvice(buildAdvice({ frost, soil, water, rain, sun, humidity, dryWindow }));
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
    <div class="sub">Wind ${fmtWind(current.wind_speed_10m)} (gust ${fmtWind(current.wind_gusts_10m)})</div>
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
    <div class="sub">Deep (18 cm): ${fmtTemp(soil.deepTemp)}</div>
    <div class="sub">Moisture 0–1 cm: ${fmtMoisture(soil.surfaceMoisture)}</div>
    <div class="sub">Moisture 1–3 cm: ${fmtMoisture(soil.rootMoisture)}</div>
  `;
}

function renderWater(waterDetail, rain) {
  const el = body("panel-water");
  const imperial = getUnits() === "imperial";
  const unit = imperial ? "in" : "mm";

  function fmtWaterVal(mm) {
    const v = imperial ? mmToIn(mm) : mm;
    return fmtNum(v, imperial ? 2 : 1);
  }

  function deficitCell(deficit) {
    const v = imperial ? mmToIn(deficit) : deficit;
    const cls = v > 0.05 ? "num water-deficit" : v < -0.05 ? "num water-surplus" : "num";
    const sign = v > 0.05 ? "+" : "";
    return `<td class="${cls}">${sign}${fmtNum(v, imperial ? 2 : 1)}</td>`;
  }

  const histRows = (waterDetail.historical || []).map((d) => `
    <tr class="water-hist">
      <td>${fmtDay(d.date)}</td>
      <td class="num">${fmtWaterVal(d.et)}</td>
      <td class="num">${fmtWaterVal(d.precip)}</td>
      ${deficitCell(d.deficit)}
    </tr>`).join("");

  const projRows = (waterDetail.projected || []).map((d, i) => {
    const isToday = i === 0;
    const probStr = d.precipProb != null ? `<span class="water-prob">${d.precipProb}%</span>` : "";
    return `
    <tr class="${isToday ? "water-today" : "water-proj"}">
      <td>${fmtDay(d.date)}${isToday ? " <span class='water-today-label'>today</span>" : ""}</td>
      <td class="num">${fmtWaterVal(d.et)}</td>
      <td class="num">${fmtWaterVal(d.precip)} ${probStr}</td>
      ${deficitCell(d.deficit)}
    </tr>`;
  }).join("");

  const cum = imperial ? mmToIn(waterDetail.cumulative ?? 0) : (waterDetail.cumulative ?? 0);
  const cumSign = cum > 0.05 ? "+" : "";
  const cumCls = cum > 0.05 ? "water-deficit" : cum < -0.05 ? "water-surplus" : "";
  const rainNote = rain
    ? `Next rain: ${fmtDay(rain.date)} (~${fmtPrecip(rain.amount)})`
    : "No rain in 7-day forecast.";

  el.innerHTML = `
    <table class="water-table">
      <thead>
        <tr>
          <th>Day</th>
          <th class="num">ET (${unit})</th>
          <th class="num">Rain</th>
          <th class="num">Deficit</th>
        </tr>
      </thead>
      <tbody>
        ${histRows}
        <tr class="water-divider"><td colspan="4"></td></tr>
        ${projRows}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="water-cum-label">10-day cumulative</td>
          <td class="num ${cumCls}">${cumSign}${fmtNum(cum, imperial ? 2 : 1)} ${unit}</td>
        </tr>
      </tfoot>
    </table>
    <div class="sub" style="margin-top:0.4rem">${rainNote}</div>
  `;
}

function renderSun(sun) {
  const el = body("panel-sun");
  if (!sun) { el.textContent = "No data."; return; }
  const daylight = sun.daylightSec != null
    ? `${Math.floor(sun.daylightSec / 3600)}h ${Math.round((sun.daylightSec % 3600) / 60)}m`
    : "–";
  el.innerHTML = `
    <div class="big">UV ${fmtNum(sun.uvMax)}</div>
    <div class="sub">Sunrise ${fmtTime(sun.sunrise)} &middot; Sunset ${fmtTime(sun.sunset)}</div>
    <div class="sub">Daylight: ${daylight}</div>
  `;
}

function renderGdd(gdd) {
  const el = body("panel-gdd");
  const baseTxt = getUnits() === "imperial"
    ? `base ${Math.round(cToF(gdd.base))}°F`
    : `base ${gdd.base}°C`;
  const total = getUnits() === "imperial"
    ? Math.round(gdd.total * 9 / 5 * 10) / 10
    : gdd.total;
  el.innerHTML = `
    <div class="big">${fmtNum(total)}</div>
    <div class="sub">${gdd.days}-day GDD (${baseTxt})</div>
  `;
}

function renderHumidity(h) {
  const el = body("panel-humidity");
  if (!el || !h || h.temp == null) { if (el) el.textContent = "No data."; return; }
  const vpdLabel = h.vpd == null
    ? "–"
    : h.vpd < 0.4 ? `${h.vpd} kPa · damp`
    : h.vpd < 1.2 ? `${h.vpd} kPa · healthy`
    : h.vpd < 1.6 ? `${h.vpd} kPa · dry`
    : `${h.vpd} kPa · stressed`;
  el.innerHTML = `
    <div class="big">${fmtTemp(h.dewPoint)}</div>
    <div class="sub">Dew point &middot; RH ${fmtNum(h.rh, 0)}%</div>
    <div class="sub">VPD: ${vpdLabel}</div>
    <div class="sub">Leaf-wet hours (next ${h.windowHours}h): ${h.leafWetHours ?? "–"}</div>
  `;
}

function renderDryWindow(win) {
  const el = body("panel-dry");
  if (!el) return;
  if (!win) { el.innerHTML = `<div class="sub">No rain-free window found in the next 72 hours.</div>`; return; }
  el.innerHTML = `
    <div class="big">${win.hours}h</div>
    <div class="sub">Rain-free window</div>
    <div class="sub">${fmtDay(win.start)} ${fmtTime(win.start)} → ${fmtDay(win.end)} ${fmtTime(win.end)}</div>
  `;
}

function renderZone(zone) {
  const el = body("panel-zone");
  if (!el) return;
  if (!zone) {
    el.innerHTML = `<div class="sub">Pick a location to estimate hardiness zone.</div>`;
    return;
  }
  const tempLabel = getUnits() === "imperial"
    ? `${zone.avgMinF}°F`
    : `${zone.avgMinC}°C`;
  el.innerHTML = `
    <div class="big">${zone.zone}</div>
    <div class="sub">USDA hardiness zone</div>
    <div class="sub">Avg annual extreme min: ${tempLabel}</div>
    <div class="sub">From ${zone.years[0]}–${zone.years[zone.years.length - 1]} ERA5</div>
  `;
}

function renderPlanting(list) {
  const el = body("panel-planting");
  if (!el) return;
  const imperial = getUnits() === "imperial";
  const rows = list.map((c) => {
    const cls = c.status === "go" ? "ok" : c.status === "soon" ? "warn" : c.status === "wait" ? "muted" : "muted";
    const label = c.status === "go" ? "Sow" : c.status === "soon" ? "Soon" : c.status === "wait" ? "Wait" : "–";
    const minT = imperial ? `${Math.round(cToF(c.min))}°F` : `${c.min}°C`;
    return `<tr><td>${c.name}</td><td class="num">${minT}</td><td><span class="badge ${cls}">${label}</span></td></tr>`;
  }).join("");
  el.innerHTML = `
    <table class="compact-table">
      <thead><tr><th>Crop</th><th class="num">Min soil</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderCharts(forecast) {
  const tempEl = document.querySelector("#panel-chart-temp .panel-body");
  const precipEl = document.querySelector("#panel-chart-precip .panel-body");
  const soilEl = document.querySelector("#panel-chart-soil .panel-body");
  if (!tempEl || !precipEl || !soilEl) return;

  const imperial = getUnits() === "imperial";
  const hourly = forecast.hourly || {};
  const daily = forecast.daily || {};
  const nowIdx = hourlyNowIndex(hourly);
  const span = 48;
  const end = Math.min((hourly.time || []).length, nowIdx + span);

  const hourTimes = (hourly.time || []).slice(nowIdx, end);
  const temp = (hourly.temperature_2m || []).slice(nowIdx, end).map((v) => v == null ? null : imperial ? cToF(v) : v);
  const apparent = (hourly.dew_point_2m || []).slice(nowIdx, end).map((v) => v == null ? null : imperial ? cToF(v) : v);
  tempEl.innerHTML = lineChart({
    times: hourTimes,
    series: [
      { name: "Air", values: temp, color: "var(--accent)" },
      { name: "Dew point", values: apparent, color: "#3e7ca1" },
    ],
    yUnit: tempUnit(),
    xFormat: hourFormatter(hourTimes),
  });

  const days = 7;
  const startIdx = Math.max(0, (daily.time || []).findIndex((t) => Date.parse(t) >= Date.now() - 86_400_000));
  const dayTimes = (daily.time || []).slice(startIdx, startIdx + days);
  const precipVals = (daily.precipitation_sum || []).slice(startIdx, startIdx + days)
    .map((v) => v == null ? null : imperial ? mmToIn(v) : v);
  precipEl.innerHTML = barChart({
    labels: dayTimes.map((t) => new Date(t).toLocaleDateString(undefined, { weekday: "short" })),
    values: precipVals,
    unit: precipUnit(),
    color: "#3e7ca1",
  });

  const soilTop = (hourly.soil_temperature_0cm || []).slice(nowIdx, end).map((v) => v == null ? null : imperial ? cToF(v) : v);
  const soilMid = (hourly.soil_temperature_6cm || []).slice(nowIdx, end).map((v) => v == null ? null : imperial ? cToF(v) : v);
  const soilLow = (hourly.soil_temperature_18cm || []).slice(nowIdx, end).map((v) => v == null ? null : imperial ? cToF(v) : v);
  soilEl.innerHTML = lineChart({
    times: hourTimes,
    series: [
      { name: "0 cm", values: soilTop, color: "var(--accent)" },
      { name: "6 cm", values: soilMid, color: "#c26a1f" },
      { name: "18 cm", values: soilLow, color: "#7a3f9e" },
    ],
    yUnit: tempUnit(),
    xFormat: hourFormatter(hourTimes),
  });
}

function hourFormatter(times) {
  // Show hour for short windows; switch to day label when crossing days.
  return (iso) => {
    const d = new Date(iso);
    if (d.getHours() === 0) return d.toLocaleDateString(undefined, { weekday: "short" });
    return d.toLocaleTimeString([], { hour: "numeric" });
  };
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
        <td class="num">${fmtPrecip(daily.precipitation_sum[i])}</td>
        <td class="num">${fmtNum(daily.precipitation_probability_max?.[i], 0)}%</td>
        <td class="num">${fmtPrecip(daily.et0_fao_evapotranspiration[i])}</td>
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
          <th class="num">PoP</th>
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

window.renderDashboard = renderDashboard;

})();
