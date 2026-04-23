// Saved locations persisted in localStorage.
//
// Location shape: { id, name, lat, lon, createdAt }
// - id: stable identifier used for list keys and removal
// - name: user-editable display name
// - lat/lon: numbers, rounded to 4 decimals for stability
// - createdAt: ISO timestamp

const KEY = "garden_weather.locations.v1";

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function listLocations() {
  return read();
}

export function addLocation({ name, lat, lon }) {
  const list = read();
  const rounded = { lat: round(lat), lon: round(lon) };
  const existing = list.find((l) => l.lat === rounded.lat && l.lon === rounded.lon);
  if (existing) return existing;
  const entry = {
    id: crypto.randomUUID(),
    name: name?.trim() || `${rounded.lat}, ${rounded.lon}`,
    lat: rounded.lat,
    lon: rounded.lon,
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  write(list);
  return entry;
}

export function removeLocation(id) {
  write(read().filter((l) => l.id !== id));
}

export function renameLocation(id, name) {
  const list = read();
  const entry = list.find((l) => l.id === id);
  if (!entry) return null;
  entry.name = name.trim() || entry.name;
  write(list);
  return entry;
}

/**
 * Update any subset of { name, lat, lon } on a saved location.
 * Lat/lon are re-rounded to 4 decimals for stability.
 */
export function updateLocation(id, patch = {}) {
  const list = read();
  const entry = list.find((l) => l.id === id);
  if (!entry) return null;
  if (patch.name != null) {
    const trimmed = String(patch.name).trim();
    if (trimmed) entry.name = trimmed;
  }
  if (patch.lat != null && Number.isFinite(+patch.lat)) entry.lat = round(+patch.lat);
  if (patch.lon != null && Number.isFinite(+patch.lon)) entry.lon = round(+patch.lon);
  write(list);
  return entry;
}

function round(n) {
  return Math.round(n * 10_000) / 10_000;
}
