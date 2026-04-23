// Simple TTL cache backed by localStorage.
//
// We only cache data that moves slowly or not at all — reverse-geocode
// lookups and multi-year historical climate minima. The forecast itself is
// intentionally uncached so frost and watering advice never come from
// stale data.

const KEY = "garden_weather.cache.v1";

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or disabled — caching is best-effort, so swallow.
  }
}

/**
 * @param {string} ns      Namespace, e.g. "geo" or "archive".
 * @param {string} key     Lookup key within the namespace.
 * @param {number} ttlMs   Max age in ms. Use Infinity for no expiry.
 */
export function getCached(ns, key, ttlMs) {
  const entry = read()[ns]?.[key];
  if (!entry) return null;
  if (Number.isFinite(ttlMs) && Date.now() - entry.t > ttlMs) return null;
  return entry.v;
}

export function setCached(ns, key, value) {
  const store = read();
  store[ns] = { ...(store[ns] || {}), [key]: { v: value, t: Date.now() } };
  write(store);
}

export function clearCache() {
  try { localStorage.removeItem(KEY); } catch {}
}
