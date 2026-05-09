// Saved-locations list UI.
// Wires up the <ul id="saved-list"> and exposes a render() function.

(function () {

/**
 * @param {(loc: { id: string, name: string, lat: number, lon: number }) => void} onSelect
 *   Called when the user clicks a saved location.
 */
function initLocations(onSelect) {
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
  li.className = "saved-item";

  const name = document.createElement("button");
  name.className = "name ghost";
  name.type = "button";
  name.textContent = loc.name;
  name.addEventListener("click", () => onSelect(loc));

  const coords = document.createElement("span");
  coords.className = "coords";
  coords.textContent = fmtCoords(loc.lat, loc.lon);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => {
    li.replaceWith(renderEditForm(loc, onSelect, rerender));
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

  li.append(name, coords, edit, del);
  return li;
}

function renderEditForm(loc, onSelect, rerender) {
  const li = document.createElement("li");
  li.className = "saved-item saved-edit";

  const form = document.createElement("form");
  form.className = "edit-form";
  form.innerHTML = `
    <label class="field"><span>Name</span><input name="name" type="text" required value="${attr(loc.name)}" /></label>
    <label class="field"><span>Latitude</span><input name="lat" type="number" step="0.0001" min="-90" max="90" required value="${loc.lat}" /></label>
    <label class="field"><span>Longitude</span><input name="lon" type="number" step="0.0001" min="-180" max="180" required value="${loc.lon}" /></label>
    <div class="edit-actions">
      <button type="submit" class="primary">Save</button>
      <button type="button" data-role="cancel">Cancel</button>
    </div>
    <div class="edit-error" role="alert" hidden></div>
  `;

  const err = form.querySelector(".edit-error");
  form.querySelector("[data-role=cancel]").addEventListener("click", () => rerender());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const lat = Number(data.get("lat"));
    const lon = Number(data.get("lon"));
    if (!name) { showErr("Name required."); return; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { showErr("Latitude must be between -90 and 90."); return; }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) { showErr("Longitude must be between -180 and 180."); return; }
    const next = updateLocation(loc.id, { name, lat, lon });
    rerender();
    if (next) onSelect(next);
  });

  function showErr(msg) {
    err.textContent = msg;
    err.hidden = false;
  }

  li.appendChild(form);
  return li;
}

function attr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

window.initLocations = initLocations;

})();
