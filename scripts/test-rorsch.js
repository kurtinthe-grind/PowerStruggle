// Unit test for the Rorsch discharge detector in src/rorschshot.ts.
// The Rorsch charges for ~1 s while fire is held, then discharges once; the
// player must release and press again to fire the next shot. A shot is the
// moment ammo (magazine + reserve) drops during a hold.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "rorschshot.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { holdStep } = m.exports;

let failed = 0;
function eq(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log((ok ? "  ok   " : "  FAIL ") + label + " -> " + JSON.stringify(got) + (ok ? "" : " (want " + JSON.stringify(want) + ")"));
}

// Feed a sequence of [firing, ammo] ticks, return the tick indices that fire.
function run(ticks) {
    let st = undefined;
    const shots = [];
    ticks.forEach(([firing, ammo], i) => {
        const r = holdStep(st, firing, ammo);
        st = r.next;
        if (r.fire) shots.push(i);
    });
    return shots;
}
const hold = (n, ammo) => Array.from({ length: n }, () => [true, ammo]);

console.log("press alone does not fire (charge-up):");
eq("hold 20 ticks, ammo unchanged", run(hold(20, 9)), []);

console.log("fires on the tick ammo drops, once:");
eq("charge then discharge", run([...hold(30, 9), ...hold(10, 8)]), [30]);

console.log("released before discharge -> no shot:");
eq("press, release", run([...hold(15, 9), [false, 9], [false, 9]]), []);

console.log("holding after discharge never fires again:");
eq("discharge, keep holding, mag reload changes ammo",
    run([...hold(30, 9), ...hold(5, 8), ...hold(5, 9), ...hold(5, 8)]), [30]);

console.log("second press fires the second shot:");
eq("two separate presses",
    run([...hold(30, 9), [true, 8], [false, 8], ...hold(30, 8), [true, 7]]), [30, 62]);

console.log("ammo rising mid-hold (pickup/reload) re-baselines, does not fire:");
eq("rise then drop", run([...hold(5, 7), ...hold(5, 9), [true, 8]]), [10]);

console.log("not firing clears state:");
eq("idle", holdStep(undefined, false, 9), { next: undefined, fire: false });

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
