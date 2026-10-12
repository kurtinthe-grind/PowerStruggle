// Unit test for the fake 4th gadget slot trigger in src/fakeslotcore.ts.
// Evidence from the 2026-10-04 14:02 playtest (slot trace): pressing 3 while
// the Portal Gadget is in hand puts it away and returns to the weapon held
// before it ("g1 -> pri" after "pri -> g1"); scrolling goes on to slot 4
// ("g1 -> g2"). Scripts see no key presses, only the active slots.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "fakeslotcore.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { newWatch, slotStep, markUsed, markSwapped } = m.exports;

let failed = 0;
function eq(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log((ok ? "  ok   " : "  FAIL ") + label + " -> " + JSON.stringify(got) + (ok ? "" : " (want " + JSON.stringify(want) + ")"));
}

// steps: [set, nowMs] or ["used"] / ["swapped", nowMs]; returns the nowMs of each swap.
function run(steps, busyMs = 600) {
    let w = newWatch("pri");
    const swaps = [];
    for (const s of steps) {
        if (s[0] === "used") { w = markUsed(w); continue; }
        if (s[0] === "swapped") { w = markSwapped(w, s[1], busyMs); continue; }
        const r = slotStep(w, s[0], s[1]);
        w = r.next;
        if (r.swap) swaps.push(s[1]);
    }
    return swaps;
}

console.log("3 again while holding slot 3 (back to the weapon before it) swaps:");
eq("pri -> g1 -> pri", run([["g1", 1000], ["pri", 1865]]), [1865]);
console.log("used before putting it away (menu opened, rocket fired): no swap:");
eq("used", run([["g1", 1000], ["used"], ["pri", 3000]]), []);
console.log("scrolling on to slot 4: no swap:");
eq("g1 -> g2", run([["g1", 1000], ["g2", 1500]]), []);
console.log("drawn from the sidearm, then 1 for the primary: no swap:");
eq("sec -> g1 -> pri", run([["sec", 500], ["g1", 1000], ["pri", 1500]]), []);
console.log("drawn from the sidearm, 3 again goes back to the sidearm: swap:");
eq("sec -> g1 -> sec", run([["sec", 500], ["g1", 1000], ["sec", 1500]]), [1500]);
console.log("changes caused by the swap itself are ignored until busy ends:");
eq("swap then flicker", run([["g1", 1000], ["pri", 1500], ["swapped", 1500], ["g1", 1550], ["pri", 1600], ["g1", 1650]]), [1500]);
console.log("after busy, 3 again swaps back:");
eq("swap twice", run([["g1", 1000], ["pri", 1500], ["swapped", 1500], ["g1", 1550], ["pri", 2500]]), [1500, 2500]);
console.log("unchanged set does nothing:");
eq("same", slotStep(newWatch("pri"), "pri", 10).swap, false);
console.log("no weapon before slot 3 (spawned holding it): no swap:");
eq("none -> g1 -> pri", run([["none", 0], ["g1", 100], ["pri", 900]]), []);

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
