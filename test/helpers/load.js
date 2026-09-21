// Loads the app's plain-<script> IIFE files (js/*.js) into an isolated vm
// sandbox and returns whatever they attached to `window`.
//
// The app has no module system by design (see CLAUDE.md — plain scripts so
// `file://` keeps working): each file is an IIFE that reads/writes a global
// `window`, and cross-file calls are bare identifiers (`fmtTemp(...)`, not
// `window.fmtTemp(...)`) that only resolve because browsers make
// `window === globalThis`. To run these files under Node without changing
// any app code, the sandbox's global object doubles as `window` (mirroring
// the browser), and dependency files can be loaded into the same sandbox
// first so later files see their globals — exactly like index.html's
// `<script>` load order.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");

/** A fresh sandbox where `window` and the context's global object are the same thing. */
function createSandbox(extraGlobals = {}) {
  const sandbox = { console, ...extraGlobals };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function runFile(sandbox, relPath) {
  const fullPath = path.join(ROOT, relPath);
  const code = fs.readFileSync(fullPath, "utf8");
  vm.runInContext(code, sandbox, { filename: fullPath });
  return sandbox;
}

/**
 * Load one file (optionally after some dependency files, in order) into a
 * fresh, isolated sandbox — never the real Node global object.
 *
 * @param {string} relPath  Path to a js/*.js file, relative to the repo root.
 * @param {{ deps?: string[], globals?: object }} [opts]
 *   `deps`: other js/*.js files to load into the same sandbox first.
 *   `globals`: stub functions/values to seed into the sandbox before any
 *     file runs (e.g. `{ fmtTemp: () => "" }` in place of loading the real
 *     ui/format.js and its own dependencies).
 * @returns {object} The sandbox's `window` — i.e. that file's public API.
 */
function loadModule(relPath, { deps = [], globals = {} } = {}) {
  const sandbox = createSandbox(globals);
  for (const dep of deps) runFile(sandbox, dep);
  runFile(sandbox, relPath);
  return sandbox.window;
}

module.exports = { loadModule };
