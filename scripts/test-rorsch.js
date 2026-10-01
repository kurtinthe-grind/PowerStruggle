// Unit test for the Rorsch shot detector in src/rorschshot.ts.
// Evidence (playtest 2026-10-01): IsFiring stays true for the whole hold, and
// the inventory ammo APIs do not report the Rorsch at all. The Rorsch fires
// ~1 s into a hold and needs a new press for the next shot, so a shot is a
// press held continuously for chargeMs, counted once per press.
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

const CHARGE = 1000;
// samples: [firing, nowMs]; returns the nowMs values at which a shot fires.
function run(samples) {
    let st = undefined;
    const shots = [];
    for (const [firing, now] of samples) {
        const r = holdStep(st, firing, now, CHARGE);
        st = r.next;
        if (r.fire) shots.push(now);
    }
    return shots;
}
// Held from t0 to t1 inclusive, sampled every 33 ms (~30 Hz).
function held(t0, t1, step = 33) {
    const out = [];
    for (let t = t0; t <= t1; t += step) out.push([true, t]);
    return out;
}

console.log("press alone does not fire:");
eq("held 900 ms", run(held(0, 900)), []);
console.log("fires once when the hold reaches the charge time:");
eq("held 0..1500 ms", run(held(0, 1500)), [1023]);
console.log("holding long after the shot never fires again:");
eq("held 0..5000 ms", run(held(0, 5000)), [1023]);
console.log("release before charge cancels:");
eq("tap 500 ms then release", run([...held(0, 500), [false, 533]]), []);
console.log("two separate presses fire twice:");
eq("two holds", run([...held(0, 1200), [false, 1300], ...held(2000, 3200)]), [1023, 3023]);
console.log("a gap in sampling (lag) still uses wall time:");
eq("samples at 0 and 1500 only", run([[true, 0], [true, 1500]]), [1500]);
console.log("not firing clears state:");
eq("idle", holdStep(undefined, false, 0, CHARGE), { next: undefined, fire: false });

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
