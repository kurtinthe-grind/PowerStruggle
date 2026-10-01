// Unit test for the Rorsch discharge detector in src/rorschshot.ts.
// A shot is the tick the Rorsch's ammo (magazine + reserve) drops while the
// player is in an HQ fire zone. IsFiring is NOT used to decide: the 2026-10-01
// playtest showed a press being seen but never a discharge inside the hold.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "rorschshot.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { ammoStep } = m.exports;

let failed = 0;
function eq(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log((ok ? "  ok   " : "  FAIL ") + label + " -> " + JSON.stringify(got) + (ok ? "" : " (want " + JSON.stringify(want) + ")"));
}

// Feed a sequence of ammo readings, return the tick indices that fire.
function run(seq) {
    let last = undefined;
    const shots = [];
    seq.forEach((ammo, i) => {
        const r = ammoStep(last, ammo);
        last = r.next;
        if (r.fire) shots.push(i);
    });
    return shots;
}
const same = (n, a) => Array.from({ length: n }, () => a);

console.log("first reading only sets the baseline:");
eq("entering zone", run([9]), []);
console.log("charging (ammo unchanged) never fires:");
eq("30 ticks at 9", run(same(30, 9)), []);
console.log("a drop fires exactly once:");
eq("9 x30 then 8 x10", run([...same(30, 9), ...same(10, 8)]), [30]);
console.log("two discharges fire twice:");
eq("9 -> 8 -> 7", run([...same(5, 9), ...same(5, 8), ...same(5, 7)]), [5, 10]);
console.log("ammo rising (pickup/resupply) does not fire:");
eq("7 -> 9", run([...same(5, 7), ...same(5, 9)]), []);
console.log("mag->reserve reload transfer keeps the sum, no fire:");
eq("sum constant", run(same(10, 8)), []);
console.log("negative/invalid reading is ignored and does not move the baseline:");
eq("9, -1, 9", run([9, -1, 9]), []);

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
