// Unit test for the turret ray test in src/raygeom.ts.
// Evidence (playtest 2026-10-01 17:38): mod.RayCast passes straight through the
// VEH_Stationary_AutomaticAA turrets. Every shot aimed at one went on to the HQ
// 500 m away or into the sky, passing 2.3-6 m from the turret's axis at 6-14 m
// above its base. So a turret is hit when the ray's path crosses an upright
// cylinder around it, not when the ray's hit point lands near it.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "raygeom.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { rayThroughUpright } = m.exports;

let failed = 0;
function eq(label, got, want) {
    const ok = got === want;
    if (!ok) failed++;
    console.log((ok ? "  ok   " : "  FAIL ") + label + " -> " + got + (ok ? "" : " (want " + want + ")"));
}

// Turret bases from PS_Isolated.tscn (T2_HQ + BASE_Protection_Turret_n_T2).
const T7004 = [-1305.92, 111.905, -255.86];
const T7005 = [-1225.99, 111.905, -255.86];
const T7006 = [-1146.11, 111.905, -255.86];
const R = 7, BELOW = 3, ABOVE = 16;

function hits(eye, dir, len, t) {
    return rayThroughUpright(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], len, t[0], t[1], t[2], R, BELOW, ABOVE);
}

const shot1706 = [[-1208.9056, 113.1583, -141.9926], [-0.12832, 0.056405, -0.99013]];
const shot3853 = [[-1213.094, 112.9716, -136.348], [-0.58973, 0.069211, -0.80463]];

console.log("real shots from the 17:38 log hit the turret they were aimed at:");
eq("17:39:06 -> 7005 (ray then hit HQ at 500 m)", hits(shot1706[0], shot1706[1], 500, T7005), true);
eq("17:38:53 -> 7004 (ray missed, 900 m)", hits(shot3853[0], shot3853[1], 900, T7004), true);
console.log("and not the neighbouring turrets 80 m away:");
eq("17:39:06 vs 7006", hits(shot1706[0], shot1706[1], 500, T7006), false);
eq("17:38:53 vs 7005", hits(shot3853[0], shot3853[1], 900, T7005), false);
console.log("a ray stopped by something before the turret does not reach it:");
eq("17:39:06 cut at 50 m", hits(shot1706[0], shot1706[1], 50, T7005), false);
console.log("a ray well over the top misses:");
const n = Math.hypot(-0.12832, 0.3, -0.99013);
eq("pitched 0.3 up", hits(shot1706[0], [-0.12832 / n, 0.3 / n, -0.99013 / n], 500, T7005), false);
console.log("a turret behind the shooter is not hit:");
eq("reversed ray", hits(shot1706[0], [0.12832, -0.056405, 0.99013], 500, T7005), false);
console.log("a straight-down ray inside the radius hits, outside misses:");
eq("down, 2 m off axis", rayThroughUpright(2, 20, 0, 0, -1, 0, 30, 0, 0, 0, R, BELOW, ABOVE), true);
eq("down, 9 m off axis", rayThroughUpright(9, 20, 0, 0, -1, 0, 30, 0, 0, 0, R, BELOW, ABOVE), false);

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
