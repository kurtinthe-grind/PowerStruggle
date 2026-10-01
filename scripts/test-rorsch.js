// Unit test for the Rorsch shot detector in src/rorschshot.ts.
// Evidence from the 2026-10-01 15:20 playtest: IsFiring goes false 2200-2212 ms
// after the press on every one of 7 shots, even when fire was kept held, and
// IsReloading follows ~150-450 ms later. A release at 1644 ms was followed by no
// reload, so the gun did not fire. So the shot is the IsFiring falling edge
// after a hold of at least minChargeMs; an earlier release cancels the charge.
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

const MIN_CHARGE = 2100;
// samples: [firing, nowMs]; returns the nowMs values at which a shot fires.
function run(samples) {
    let st = undefined;
    const shots = [];
    for (const [firing, now] of samples) {
        const r = holdStep(st, firing, now, MIN_CHARGE);
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

console.log("holding never fires by itself, however long:");
eq("held 0..5000 ms, still firing", run(held(0, 5000)), []);
console.log("the discharge (IsFiring off after a full charge) fires once:");
eq("held 0..2178, off at 2211", run([...held(0, 2178), [false, 2211]]), [2211]);
console.log("release before the charge completes cancels (15:21:14 case):");
eq("off at 1644", run([...held(0, 1617), [false, 1644]]), []);
eq("tap, off at 33", run([[true, 0], [false, 33]]), []);
console.log("exactly at the minimum counts:");
eq("off at 2100", run([[true, 0], [false, 2100]]), [2100]);
console.log("not-firing samples after the shot do not fire again:");
eq("off, off, off", run([[true, 0], [false, 2200], [false, 2233], [false, 2266]]), [2200]);
console.log("two full charges fire twice:");
eq("two shots", run([...held(0, 2178), [false, 2211], ...held(6000, 8178), [false, 8211]]), [2211, 8211]);
console.log("a gap in sampling (lag) still uses wall time:");
eq("samples at 0 and 2300 only", run([[true, 0], [false, 2300]]), [2300]);
console.log("an ignored hold (not the Rorsch) never fires:");
eq("ignored", holdStep({ pressMs: 0, ignored: true }, false, 3000, MIN_CHARGE), { next: undefined, fire: false });
console.log("idle stays idle:");
eq("idle", holdStep(undefined, false, 0, MIN_CHARGE), { next: undefined, fire: false });

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
