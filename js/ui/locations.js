// Saved-locations list UI.
// Wires up the <ul id="saved-list"> and exposes a render() function.

import { listLocations, removeLocation, renameLocation } from "../storage.js";
import { fmtCoords } from "./format.js";

/**
 * @param {(loc: { id: string, name: string, lat: number, lon: number }) => void} onSelect
 *   Called when the user clicks a saved location.
 */
export function initLocations(onSelect) {
  const list = document.getElementById("saved-list");
  const empty = document.getElementById("saved-empty");

  function render() {
    const items = listLocations();
    list.innerHTML = "";
    empty.hidden = items.length > 0;
    for (const loc of items) {
      list.appendChild(renderItem(loc, onSelect, render));
    }
  }

  render();
  return { render };
}

function renderItem(loc, onSelect, rerender) {
  const li = document.createElement("li");

  const name = document.createElement("button");
  name.className = "name ghost";
  name.type = "button";
  name.textContent = loc.name;
  name.addEventListener("click", () => onSelect(loc));

  const coords = document.createElement("span");
  coords.className = "coords";
  coords.textContent = fmtCoords(loc.lat, loc.lon);

  const rename = document.createElement("button");
  rename.type = "button";
  rename.textContent = "Rename";
  rename.addEventListener("click", () => {
    const next = prompt("Rename location", loc.name);
    if (next != null) {
      renameLocation(loc.id, next);
      rerender();
    }
  });

  const del = document.createElement("button");
  del.type = "button";
  del.textContent = "Remove";
  del.addEventListener("click", () => {
    if (confirm(`Remove "${loc.name}"?`)) {
      removeLocation(loc.id);
      rerender();
    }
  });

  li.append(name, coords, rename, del);
  return li;
}
