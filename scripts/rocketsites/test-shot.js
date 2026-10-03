// Launcher shots at the radar: ray geometry (copied from PowerStruggle's
// Rorsch turret test), the trigger-press edge and the 4-hit counter.
const loadTs = require("./load-ts.js");
const { ok, done } = require("./check.js");
const r = loadTs("src/rocketsites/raygeom.ts");
const s = loadTs("src/rocketsites/shotcore.ts");

const RADAR = [-725.57, 112.61, -102.47];
const P = { radius: 4, below: 6, above: 5, pointRadius: 5 };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const shooter = [-760, 103, -40];
const toRadar = norm([RADAR[0] - shooter[0], RADAR[1] - shooter[1], RADAR[2] - shooter[2]]);
const dist = Math.hypot(RADAR[0] - shooter[0], RADAR[1] - shooter[1], RADAR[2] - shooter[2]);

console.log("ray path through the radar's cylinder:");
ok("aimed at the radar, ray flew on (missed everything)", r.radarShotHits(shooter, toRadar, 900, undefined, RADAR, P));
ok("aimed at the radar, ray stopped just behind it", r.radarShotHits(shooter, toRadar, dist + 2, undefined, RADAR, P));
const wide = norm([toRadar[0] + 0.2, toRadar[1], toRadar[2]]);
ok("aimed ~11 deg to the side -> no hit", !r.radarShotHits(shooter, wide, 900, undefined, RADAR, P));
ok("aimed at the radar but a wall stops the ray 30 m short -> no hit", !r.radarShotHits(shooter, toRadar, dist - 30, undefined, RADAR, P));
const high = norm([toRadar[0], toRadar[1] + 0.3, toRadar[2]]);
ok("aimed well over the dish -> no hit", !r.radarShotHits(shooter, high, 900, undefined, RADAR, P));

console.log("ray hit point on or next to the radar:");
ok("hit point 3 m from the radar", r.radarShotHits(shooter, wide, 60, [RADAR[0] + 3, RADAR[1], RADAR[2]], RADAR, P));
ok("hit point 9 m from the radar -> no", !r.radarShotHits(shooter, wide, 60, [RADAR[0] + 9, RADAR[1], RADAR[2]], RADAR, P));

console.log("trigger press edge (one shot per press, not per tick held):");
ok("first tick of a press", s.pressed(undefined, true));
ok("still held", !s.pressed(true, true));
ok("released", !s.pressed(true, false));
ok("pressed again", s.pressed(false, true));

console.log("radar takes 4 hits:");
const h = new s.RadarHealth(4);
ok("hit 1 damages", h.hit() === "damaged" && h.left === 3);
h.hit();
h.hit();
ok("hit 4 destroys", h.hit() === "destroyed" && h.left === 0);
ok("hit 5 is ignored", h.hit() === "ignored" && h.left === 0);
ok("destroyed stays true", h.destroyed);
console.log("own-rocket rays (in-game 2026-10-03: launcher rays stopped 5-6 m out, at the shooter's rocket):");
// No recast (a RayCast sent from OnRayCastHit never answered in-game): the
// ray starts past the rocket, and a stop still inside ownRocketM of the eye
// is the rocket, so the shot is judged as if nothing blocked it.
ok("stop 4.7 m from the eye is the own rocket", s.ownRocketStop(4.7, 15));
ok("stop 12 m from the eye (rocket moved on before the cast resolved) is the own rocket", s.ownRocketStop(12, 15));
ok("stop 40 m out is a real hit", !s.ownRocketStop(40, 15));
ok("no hit at all is not the rocket", !s.ownRocketStop(undefined, 15));
const closeEye = [RADAR[0], RADAR[1], RADAR[2] - 6];
ok("6 m from the radar, judged from the eye (the ray itself starts 8 m out): hit",
    r.radarShotHits(closeEye, [0, 0, 1], 8 + 900, undefined, RADAR, P));
console.log("wet hits get the underwater C4 detonation too (owner 2026-10-03):");
const h2 = loadTs("src/rocketsites/hitcore.ts");
const dry = { inWater: false, diving: false, inVehicle: false, boat: false };
ok("on foot on land -> dry", !h2.wetHit(dry));
ok("swimming -> wet", h2.wetHit({ ...dry, inWater: true }));
ok("diving -> wet", h2.wetHit({ ...dry, diving: true }));
ok("in a boat -> wet", h2.wetHit({ ...dry, inVehicle: true, boat: true }));
ok("in a helicopter over the sea -> dry", !h2.wetHit({ ...dry, inVehicle: true }));
ok("boat flag ignored on foot (stale read) -> dry", !h2.wetHit({ ...dry, boat: true }));
ok("unreadable state -> dry", !h2.wetHit({ inWater: undefined, diving: undefined, inVehicle: undefined, boat: undefined }));
console.log("a ray result that never comes does not jam the shooter (in-game 2026-10-03: one never answered):");
ok("waiting for the answer", !s.rayExpired(1000, 1999, 1000));
ok("no answer after the timeout: give up and judge", s.rayExpired(1000, 2000, 1000));
console.log("several radars (8 sites, 2026-10-03): the shot goes to the nearest one it hits:");
const far = [RADAR[0] + toRadar[0] * 250, RADAR[1] + toRadar[1] * 250, RADAR[2] + toRadar[2] * 250];
const aside = [RADAR[0] + 250, RADAR[1], RADAR[2]];
ok("two radars in line: the nearer one", r.pickRadar(shooter, toRadar, 900, undefined, [far, RADAR], P) === 1);
ok("only the one it passes through", r.pickRadar(shooter, toRadar, 900, undefined, [aside, RADAR], P) === 1);
ok("a wall in front of the far one: still the near one", r.pickRadar(shooter, toRadar, dist + 20, undefined, [far, RADAR], P) === 1);
ok("aimed at nothing: none", r.pickRadar(shooter, high, 900, undefined, [far, aside, RADAR], P) === -1);
ok("no radars left: none", r.pickRadar(shooter, toRadar, 900, undefined, [], P) === -1);
ok("a hit point beside the far radar picks it", r.pickRadar(shooter, wide, 400, [far[0] + 2, far[1], far[2]], [aside, far], P) === 1);
console.log("a rocket chases until a definite death (owner 2026-10-03: rockets burst mid-air when the target left the zone):");
ok("alive -> chase", h2.chaseVerdict(false, true, true) === "chase");
ok("an unreadable state keeps the chase going", h2.chaseVerdict(false, undefined, undefined) === "chase");
ok("valid but the alive read failed -> chase", h2.chaseVerdict(false, true, undefined) === "chase");
ok("died (OnPlayerDied) -> gone", h2.chaseVerdict(true, true, true) === "died");
ok("left the game -> gone", h2.chaseVerdict(false, false, undefined) === "left");
ok("reads not alive -> gone", h2.chaseVerdict(false, true, false) === "not alive");
done("test-shot");
