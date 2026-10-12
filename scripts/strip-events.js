// Un-exports the engine event handlers nothing subscribes to in dist/bundle.ts.
//
// bf6-portal-utils/events exports every Portal event handler so any module can
// subscribe to any event. The engine calls each exported handler, and the
// Ongoing* ones run once per server tick for every player, vehicle, spawn
// point, area trigger, spawner and world icon ("This will trigger per server
// tick for each Player", bf6-portal-mod-types event-handler-signatures). With
// no subscriber the call does nothing, but it is still made. DICE's own
// examples export only OngoingGlobal.
//
// The engine only calls exported handlers (AGENT.md section 5: events must be
// top-level exports), so dropping the export keyword stops the calls. The
// functions themselves stay: the events module lists every one of them in
// its EventsTypes.Type table, and deleting them broke the Portal compile
// (TS18004, 2026-10-04).
//
// The list is worked out from the bundle itself on every build, so a new
// subscription keeps its handler automatically. Only names that are engine
// events in the Tier 0 types are touched. The build fails if a subscribed
// event would lose its handler or if the bundle does not look as expected.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BUNDLE = path.join(ROOT, "dist", "bundle.ts");
const TYPES = path.join(ROOT, "..", "main_resources", "types_original", "mod", "index.d.ts");

function fail(msg) {
  console.error("strip-events: " + msg);
  process.exit(1);
}

// Engine event names: the EventHandlerSignatures namespace of the Tier 0 types.
function engineEvents() {
  const types = fs.readFileSync(TYPES, "utf8");
  const start = types.indexOf("namespace EventHandlerSignatures");
  if (start < 0) {
    fail("EventHandlerSignatures not found in " + TYPES);
  }
  const names = new Set();
  const re = /export function ((?:On|Ongoing)[A-Za-z0-9]+)\(/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(types)) !== null) {
    names.add(m[1]);
  }
  return names;
}

// Subscriptions in code (lines that are comments are ignored: the events
// module documents Events.OngoingInteractPoint.subscribe in a comment).
function subscribed(src) {
  const out = new Set();
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
      continue;
    }
    const re = /Events\.((?:On|Ongoing)[A-Za-z0-9]+)\.subscribe\(/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      out.add(m[1]);
    }
    const re2 = /Events\.subscribe\(\s*Events\.Type\.((?:On|Ongoing)[A-Za-z0-9]+)/g;
    while ((m = re2.exec(line)) !== null) {
      out.add(m[1]);
    }
  }
  // OnTickStart is the events module's alias of OngoingGlobal.
  if (out.has("OnTickStart")) {
    out.add("OngoingGlobal");
  }
  return out;
}

let src = fs.readFileSync(BUNDLE, "utf8");
const events = engineEvents();
const subs = subscribed(src);
if (!/^export function OngoingGlobal\(/m.test(src)) {
  fail("the bundle has no OngoingGlobal export; is bf6-portal-utils/events still bundled?");
}
const exported = [...src.matchAll(/^export function ((?:On|Ongoing)[A-Za-z0-9]+)\(/gm)].map((m) => m[1]);
const strip = exported.filter((n) => events.has(n) && !subs.has(n) && n !== "OngoingGlobal");
for (const name of strip) {
  const re = new RegExp("^export function " + name + "\\(", "m");
  if (!re.test(src)) {
    fail("could not find the export of " + name);
  }
  src = src.replace(re, "function " + name + "(");
}
for (const name of subs) {
  if (events.has(name) && !new RegExp("^export function " + name + "\\(", "m").test(src)) {
    fail(name + " is subscribed but has no exported handler after stripping");
  }
}
fs.writeFileSync(BUNDLE, src);
const kept = exported.filter((n) => events.has(n) && !strip.includes(n));
console.log("strip-events: un-exported " + strip.length + " unused engine event handlers, kept " + kept.length
  + " (" + kept.join(", ") + ")");
