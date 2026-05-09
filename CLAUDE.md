# Garden Weather — Claude Code guide

A single-page weather app for gardeners. Pulls Open-Meteo data and surfaces
soil temperature, soil moisture, frost risk, ET/water balance, UV, and growing
degree days, plus an "is today a good gardening day?" verdict.

Static site, **no build step**. Deployed to GitHub Pages by serving the repo
root. Open `index.html` directly from the filesystem (`file://`) or via
`python3 -m http.server` to develop.

## Repo map

```
index.html              Page shell + element ids the JS binds to
css/
  base.css              Variables, reset, typography, dark-mode palette
  layout.css            Page grid, containers, responsive rules
  components.css        Cards, buttons, badges, tables, lists
js/
  app.js                Entry point. Wires geo + storage + API + UI.
  api.js                Open-Meteo fetch (forecast + reverse geocode)
  geo.js                navigator.geolocation wrapper
  storage.js            Saved locations in localStorage
  cache.js              TTL cache backed by localStorage
  settings.js           User preferences (units) in localStorage
  metrics.js            Pure functions: frost, GDD, soil, water, sun
  advice.js             Combine metrics into gardener verdict + bullets
  ui/
    dashboard.js        Render forecast panels
    locations.js        Render saved locations list
    format.js           Number / date / coordinate formatters
    chart.js            SVG line and bar chart helpers
```

Every file is intentionally small (well under a few hundred lines) so a Claude
Code session can read the whole file cheaply and edit surgically. If a file
grows past ~300 lines, split it.

## Module system

The JS files use **plain `<script>` tags** (no ES modules, no bundler). Each
file is an IIFE that exposes its public API on `window`:

```js
(function () {
  // private helpers stay here
  function publicFn() { ... }
  window.publicFn = publicFn;
})();
```

`index.html` loads the scripts in dependency order (bottom of `<body>`):

```
cache → settings → storage → geo → metrics → api
→ ui/format → ui/chart → advice → ui/dashboard → ui/locations → app
```

**Why no ES modules?** Browsers block `type="module"` on `file://` origins, so
the app would silently break when opened directly from the filesystem. Plain
scripts work everywhere.

**Adding a function to a file:** declare it inside the IIFE and add
`window.myFn = myFn;` at the bottom. Other files can call it immediately since
scripts execute in order.

## Data flow

1. `app.js` gets a coordinate — either from `geo.js` (browser geolocation) or
   from a click in the saved locations list (`ui/locations.js` → `storage.js`).
2. `app.js` calls `fetchForecast({ lat, lon })` for the Open-Meteo bundle
   (current + hourly + daily, with past days so we can compute trailing
   metrics like GDD and water balance).
3. `renderDashboard(forecast)` derives metrics via `metrics.js`,
   builds the verdict via `advice.js`, and writes each panel's `.panel-body`.

`metrics.js` and `advice.js` are **pure**. They take the raw API response (or
the outputs of `metrics.js`) and return plain objects — no DOM access. Keep it
that way so they stay easy to unit test or swap.

## Open-Meteo fields used

Declared in `api.js` as three arrays:

- `CURRENT_VARS` — temperature, humidity, dew point, wind, precipitation.
- `HOURLY_VARS` — temperature, soil temp at 0/6/18 cm, soil moisture at
  0–1/1–3/3–9 cm, ET0, UV, shortwave radiation.
- `DAILY_VARS` — min/max temp, precipitation sum + probability, ET0, UV max,
  sunrise, sunset, weather code.

The request uses `past_days=3` and `forecast_days=7`. Trailing metrics
(GDD, water balance) use the past slice; frost and advice look forward.

## Saved locations

`storage.js` is the only file that touches `localStorage` for locations. Key:
`garden_weather.locations.v1`. Entry shape:

```js
{ id, name, lat, lon, createdAt }
```

Lat/lon are rounded to 4 decimals before compare so "add" is idempotent for
near-identical coords. Bump the key to `.v2` if the shape changes and migrate.

## Adding a new metric (common task)

1. Add the field(s) to `HOURLY_VARS` or `DAILY_VARS` in `js/api.js`.
2. Write a pure derivation in `js/metrics.js` (or extend an existing one).
   Expose it: `window.myMetric = myMetric;` at the bottom of the IIFE.
3. Render it in `js/ui/dashboard.js` — either a new panel (add a matching
   `<article class="card panel">` to `index.html`) or an extra line in an
   existing panel.
4. If it should influence the verdict, add a rule in `js/advice.js`.

## Styling conventions

- Use the CSS custom properties in `base.css` (`--ink`, `--accent`, etc.) so
  the dark-mode palette keeps working.
- Numeric cells in tables get `class="num"` so they align right with tabular
  numerals.
- Prefer adding a new class in `components.css` over inline styles.

## What not to add

- No build tooling, no frameworks, no package.json — GitHub Pages serves the
  repo root directly. If a task seems to need a bundler, stop and ask.
- No network calls outside Open-Meteo. No analytics or tracking.
- No API keys. If a future data source needs one, it probably doesn't belong
  in a static public site.

## Local dev

Open `index.html` directly in a browser — it works on `file://`. Geolocation
(`Use my location`) requires `http://localhost` or `https://`, so for that
feature run a local server:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy (GitHub Pages)

Serve from the repo root on the default branch. No workflow required.
