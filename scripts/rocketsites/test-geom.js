const loadTs = require("./load-ts.js");
const { ok, near, done } = require("./check.js");
const g = loadTs("src/rocketsites/geom.ts");

console.log("angles (yaw 0 = +Z, 90 = +X):");
near("yaw to +Z is 0", g.aimDeg([0, 0, 0], [0, 0, 10]).yaw, 0, 1e-9);
near("yaw to +X is 90", g.aimDeg([0, 0, 0], [10, 0, 0]).yaw, 90, 1e-9);
near("yaw to -Z is 180", Math.abs(g.aimDeg([0, 0, 0], [0, 0, -10]).yaw), 180, 1e-9);
near("pitch 45 up", g.aimDeg([0, 0, 0], [10, 10, 0]).pitch, 45, 1e-9);
near("wrap 190 -> -170", g.wrapDeg(190), -170, 1e-9);
near("step from 350 toward 10 goes through 0", g.stepAngleDeg(350, 10, 5), 355, 1e-9);
near("step stops on the target", g.stepAngleDeg(10, 12, 5), 12, 1e-9);

console.log("rotation units from the radar's rest X (45 deg in Godot):");
ok("45 reads as degrees", g.detectUnits(45, 45) === "deg");
ok("0.785 reads as radians", g.detectUnits(0.7854, 45) === "rad");
ok("-45 still degrees", g.detectUnits(-45, 45) === "deg");
ok("12 is unknown", g.detectUnits(12, 45) === "unknown");
near("toEngine 90 in rad", g.toEngine(90, "rad"), Math.PI / 2, 1e-9);
near("toEngine 90 in deg", g.toEngine(90, "deg"), 90, 1e-9);
near("fromEngine pi/2 rad", g.fromEngine(Math.PI / 2, "rad"), 90, 1e-9);

console.log("trail rotation points along the flight:");
const e = g.dirToEulerDeg([1, 0, 0]);
near("flying +X: yaw 90", e[1], 90, 1e-9);
near("flying +X: X 0", e[0], 0, 1e-9);
near("flying up 45: X is -45 (Godot +X tilts +Z down)", g.dirToEulerDeg(g.norm([0, 1, 1]))[0], -45, 1e-9);

console.log("hit test catches fast rockets that skip past the target:");
ok("segment passes 2 m from the target -> hit (r 3)", g.segmentHits([-10, 2, 0], [10, 2, 0], [0, 0, 0], 3));
ok("segment ends 5 m short -> no hit", !g.segmentHits([-20, 0, 0], [-5, 0, 0], [0, 0, 0], 3));

console.log("beep speeds up as the rocket closes:");
ok("at launch: slow", g.beepIntervalMs(100, 100, 900, 120) === 900);
ok("halfway: between", g.beepIntervalMs(50, 100, 900, 120) === 510);
ok("on top: fast", g.beepIntervalMs(0, 100, 900, 120) === 120);
ok("farther than at launch: still slow", g.beepIntervalMs(150, 100, 900, 120) === 900);

console.log("homing, same numbers as config.ts:");
const P = { riseSecs: 0.4, speedStart: 40, accel: 160, speedMax: 220, turnDegPerSec: 240, closeRangeM: 60 };
const r0 = g.newRocket([0, 0, 0], P);
for (let i = 0; i < 10; i++) g.stepRocket(r0, [100, 0, 0], 1 / 30, P);
ok("rises straight up for the first 0.4 s", Math.abs(r0.pos[0]) < 1e-9 && r0.pos[1] > 5, r0.pos.join(", "));
function fly(target0, vel) {
    const r = g.newRocket([0, 0, 0], P);
    let t = target0.slice();
    let topSpeed = 0;
    for (let i = 0; i < 30 * 6; i++) {
        t = g.add(t, g.scale(vel, 1 / 30));
        const prev = r.pos.slice();
        g.stepRocket(r, t, 1 / 30, P);
        topSpeed = Math.max(topSpeed, r.speed);
        if (g.segmentHits(prev, r.pos, t, 3)) return { secs: r.age, topSpeed };
    }
    return { secs: Infinity, topSpeed };
}
const cases = [
    ["infantry 150 m", [0, 0, 150], [0, 0, 0]],
    ["infantry 10 m from the silo", [10, 0, 0], [0, 0, 0]],
    ["target right on the silo", [0, -1, 1], [0, 0, 0]],
    ["runner 200 m", [0, 0, 200], [4, 0, 0]],
    ["heli crossing at 60 m/s, 120 m out", [0, 40, 120], [60, 0, 0]],
    ["heli fleeing at 70 m/s, 250 m out", [0, 60, 250], [0, 0, 70]],
    ["heli behind the site", [0, 30, -80], [-50, 0, 30]]
];
for (const [label, t0, v] of cases) {
    const res = fly(t0, v);
    ok(label + ": hit in " + (isFinite(res.secs) ? res.secs.toFixed(2) + " s" : "never") + " (< 3 s)", res.secs < 3);
    ok(label + ": speed never above 220", res.topSpeed <= 220 + 1e-9);
}
console.log("engine Euler order XYZ (in-game 2026-10-03: the radar wobbled with YXZ angles):");
const D = Math.PI / 180;
const Rx = a => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const Ry = b => [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
const Rz = c => [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
const mul = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
const maxDiff = (A, B) => Math.max(...A.map((v, i) => Math.abs(v - B[i])));
let worst = 0;
for (let yaw = -180; yaw <= 180; yaw += 15) {
    for (let x = -80; x <= 80; x += 10) {
        const e = g.yxzToXyzDeg(x, yaw);
        worst = Math.max(worst, maxDiff(mul(mul(Rx(e[0] * D), Ry(e[1] * D)), Rz(e[2] * D)), mul(Ry(yaw * D), Rx(x * D))));
    }
}
ok("Rx*Ry*Rz of the result equals Ry(yaw)*Rx(x) for every yaw/tilt (worst " + worst.toExponential(1) + ")", worst < 1e-9);
const pureYaw = g.yxzToXyzDeg(0, 60);
ok("pure yaw stays pure yaw", Math.abs(pureYaw[0]) < 1e-9 && Math.abs(pureYaw[1] - 60) < 1e-9 && Math.abs(pureYaw[2]) < 1e-9, pureYaw.join(", "));
const pureX = g.yxzToXyzDeg(45, 0);
ok("pure tilt stays pure tilt (the radar's rest pose)", Math.abs(pureX[0] - 45) < 1e-9 && Math.abs(pureX[1]) < 1e-9 && Math.abs(pureX[2]) < 1e-9, pureX.join(", "));
console.log("engine Euler order ZYX (bf6-MultiObjectTransform: Godot rotation order ZYX, q = qz*qy*qx):");
// The library's Quaternions.fromEuler, copied: the reference for the engine's
// convention. Its matrix must be Rz*Ry*Rx.
const libQuat = (x, y, z) => {
    const cx = Math.cos(x / 2), cy = Math.cos(y / 2), cz = Math.cos(z / 2);
    const sx = Math.sin(x / 2), sy = Math.sin(y / 2), sz = Math.sin(z / 2);
    return { w: cx * cy * cz + sx * sy * sz, x: sx * cy * cz - cx * sy * sz, y: cx * sy * cz + sx * cy * sz, z: cx * cy * sz - sx * sy * cz };
};
const quatMat = q => [
    1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y - q.w * q.z), 2 * (q.x * q.z + q.w * q.y),
    2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z - q.w * q.x),
    2 * (q.x * q.z - q.w * q.y), 2 * (q.y * q.z + q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)];
const engineMat = e => quatMat(libQuat(e[0] * D, e[1] * D, e[2] * D));
ok("library quaternion = Rz*Ry*Rx", maxDiff(engineMat([30, 50, 70]), mul(mul(Rz(70 * D), Ry(50 * D)), Rx(30 * D))) < 1e-12);
let worstZyx = 0;
let worstXyz = 0;
for (let yaw = -180; yaw <= 180; yaw += 15) {
    for (let x = 0; x <= 65; x += 5) {
        const want = mul(Ry(yaw * D), Rx(x * D));
        worstZyx = Math.max(worstZyx, maxDiff(engineMat(g.engineAimDeg("ZYX", x, yaw)), want));
        worstXyz = Math.max(worstXyz, maxDiff(engineMat(g.engineAimDeg("XYZ", x, yaw)), want));
    }
}
ok("ZYX aim: the engine builds exactly Ry(yaw)*Rx(tilt) (worst " + worstZyx.toExponential(1) + ")", worstZyx < 1e-9);
ok("the XYZ conversion shipped 2026-10-03 rolls the dish under ZYX (worst " + worstXyz.toFixed(2) + ")", worstXyz > 0.1);

console.log("matrix -> ZYX Euler (radians) round trips, gimbal lock included:");
const radMat = e => engineMat(e.map(v => v / D));
let worstRt = 0;
for (let a = -170; a <= 170; a += 34) {
    for (let b = -90; b <= 90; b += 15) {
        for (let c = -170; c <= 170; c += 34) {
            const m = mul(mul(Rz(c * D), Ry(b * D)), Rx(a * D));
            worstRt = Math.max(worstRt, maxDiff(radMat(g.eulerZYX(m)), m));
        }
    }
}
ok("Rz*Ry*Rx of eulerZYX(m) rebuilds m (worst " + worstRt.toExponential(1) + ")", worstRt < 1e-9);
// The 2026-10-03 radar sheet: Godot X 40 under a pillar with no rotation
// (spatial right/up/front are the basis columns).
const sheetBasis = g.basisFromAxes([1, 0, 0], [0, 0.7660444, 0.6427875], [0, -0.6427875, 0.7660444]);
const sheetE = g.eulerZYX(sheetBasis);
ok("the sheet's spatial axes read as X 40, Y 0, Z 0", Math.abs(sheetE[0] / D - 40) < 1e-3 && Math.abs(sheetE[1]) < 1e-6 && Math.abs(sheetE[2]) < 1e-6,
    sheetE.map(v => (v / D).toFixed(3)).join(", "));

console.log("radar parts turn as one rigid piece about the pillar's vertical axis:");
const pivot = [-725.69, 112.0, -102.29];
const parts = [
    { pos: pivot, basis: g.basisFromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1]) },                     // pillar
    { pos: [-725.64, 113.61, -100.65], basis: sheetBasis },                                        // sheet
    { pos: [-726.51, 113.73, -101.30], basis: g.basisFromAxes([1, 0, 0], [0, -0.6427875, 0.7660443], [0, -0.7660443, -0.6427875]) } // wall
];
const v3d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
for (const yaw of [0, 37, 90, -90, 180, -123]) {
    const posed = parts.map(p => g.yawPart(pivot, p.pos, p.basis, yaw * D));
    const tag = "yaw " + yaw + ": ";
    ok(tag + "the pillar stays on its spot", v3d(posed[0].pos, pivot) < 1e-9);
    ok(tag + "heights never change (no tilt)", posed.every((q, i) => Math.abs(q.pos[1] - parts[i].pos[1]) < 1e-9));
    let worstGap = 0;
    let worstRel = 0;
    for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
            worstGap = Math.max(worstGap, Math.abs(v3d(posed[i].pos, posed[j].pos) - v3d(parts[i].pos, parts[j].pos)));
        }
        // Every part's rotation is its rest basis turned by exactly Ry(yaw).
        worstRel = Math.max(worstRel, maxDiff(radMat(posed[i].rot), mul(Ry(yaw * D), parts[i].basis)));
    }
    ok(tag + "gaps between parts are kept (worst " + worstGap.toExponential(1) + ")", worstGap < 1e-9);
    ok(tag + "each part = Ry(yaw) * its rest pose (worst " + worstRel.toExponential(1) + ")", worstRel < 1e-6);
}
const at90 = g.yawPart(pivot, parts[1].pos, parts[1].basis, 90 * D);
ok("yaw 90 swings the sheet from +Z of the pillar to +X", at90.pos[0] - pivot[0] > 1.6 && Math.abs(at90.pos[2] - pivot[2]) < 0.06,
    at90.pos.map(v => v.toFixed(2)).join(", "));
done("test-geom");
