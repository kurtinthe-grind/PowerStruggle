const loadTs = require("./load-ts.js");
const { ok, done } = require("./check.js");
const { AlarmLinger, LockCore, busyFromOthers, nextReadySilo } = loadTs("src/rocketsites/lockcore.ts");

const O = [0, 0, 0];
const man = (key, pid, x) => ({ key, pid, x, y: 0, z: 0 });
const kinds = (evs) => evs.map(e => e.kind + ":" + e.key).join(",");
const none = () => new Set();

console.log("one intruder who stays:");
let L = new LockCore(3000, 1000);
ok("tracks on entry", kinds(L.update(0, [man("p1", 1, 50)], none(), O, true)) === "track:p1");
ok("target is p1", L.target === "p1");
ok("no fire at 2999 ms", kinds(L.update(2999, [man("p1", 1, 50)], none(), O, true)) === "");
ok("fires at 3000 ms", kinds(L.update(3000, [man("p1", 1, 50)], none(), O, true)) === "fire:p1");
ok("no target after firing", L.target === null);

console.log("leaving before the lock cancels it:");
L = new LockCore(3000, 1000);
L.update(0, [man("p1", 1, 50)], none(), O, true);
ok("cancel when gone", kinds(L.update(1500, [], none(), O, true)) === "cancel:p1");
ok("nothing fires later", kinds(L.update(4000, [], none(), O, true)) === "");

console.log("re-entering restarts the full 3 s lock:");
ok("track again at 5000", kinds(L.update(5000, [man("p1", 1, 50)], none(), O, true)) === "track:p1");
ok("no fire at 7999", kinds(L.update(7999, [man("p1", 1, 50)], none(), O, true)) === "");
ok("fire at 8000", kinds(L.update(8000, [man("p1", 1, 50)], none(), O, true)) === "fire:p1");

console.log("two intruders: nearest first, the other after the cooldown:");
L = new LockCore(3000, 1000);
const two = [man("p2", 2, 80), man("p1", 1, 30)];
ok("tracks the nearer one", kinds(L.update(0, two, none(), O, true)) === "track:p1");
ok("fires at p1", kinds(L.update(3000, two, none(), O, true)) === "fire:p1");
const busy = new Set(["p1"]);
ok("cooldown: nothing at 3500", kinds(L.update(3500, two, busy, O, true)) === "");
ok("tracks p2 at 4000 and skips p1 (rocket in the air)", kinds(L.update(4000, two, busy, O, true)) === "track:p2");
ok("fires at p2 at 7000", kinds(L.update(7000, two, busy, O, true)) === "fire:p2");

console.log("two passengers in one vehicle are one target:");
L = new LockCore(3000, 1000);
const heli = [man("v3", 3, 60), man("v3", 4, 60)];
ok("one track", kinds(L.update(0, heli, none(), O, true)) === "track:v3");
ok("one fire", kinds(L.update(3000, heli, none(), O, true)) === "fire:v3");
ok("no second lock on the same vehicle", kinds(L.update(4500, heli, new Set(["v3"]), O, true)) === "");

console.log("no silo ready: the lock holds and fires once one is:");
L = new LockCore(3000, 1000);
L.update(0, [man("p1", 1, 50)], none(), O, false);
ok("held at 5000", kinds(L.update(5000, [man("p1", 1, 50)], none(), O, false)) === "");
ok("fires when a silo frees up", kinds(L.update(5100, [man("p1", 1, 50)], none(), O, true)) === "fire:p1");

console.log("after a cancel the next intruder is tracked at once:");
L = new LockCore(3000, 1000);
L.update(0, [man("p1", 1, 10), man("p2", 2, 90)], none(), O, true);
ok("cancel p1 and track p2 in one update", kinds(L.update(1000, [man("p2", 2, 90)], none(), O, true)) === "cancel:p1,track:p2");

console.log("silo round-robin:");
ok("all ready: the start index", nextReadySilo([0, 0, 0], 10, 1) === 1);
ok("start busy: the next one", nextReadySilo([0, 99, 0], 10, 1) === 2);
ok("wraps around", nextReadySilo([0, 99, 99], 10, 1) === 0);
ok("all busy: -1", nextReadySilo([99, 99, 99], 10, 0) === -1);
console.log("zone members: only an invalid player is dropped (review Important 1):");
const { memberAction } = loadTs("src/rocketsites/lockcore.ts");
ok("valid and alive: keep", memberAction(true, true) === "keep");
ok("player left the game: drop", memberAction(false, undefined) === "drop");
ok("read threw: skip this tick, stay in the zone", memberAction(undefined, undefined) === "skip");
ok("valid but alive read threw: skip", memberAction(true, undefined) === "skip");
ok("valid but not alive (downed): skip", memberAction(true, false) === "skip");
console.log("the alarm keeps playing after the zone empties (owner, 2026-10-03):");
const A = new AlarmLinger(5000);
ok("quiet before anything happens", !A.wanted(0, false));
ok("on while busy", A.wanted(100, true));
ok("still on 4.9 s after the last busy tick", A.wanted(5099, false));
ok("off 5 s after", !A.wanted(5100, false));
ok("on again when busy again", A.wanted(6000, true));
ok("a quick exit and re-entry never cuts it", A.wanted(6500, false) && A.wanted(7000, true) && A.wanted(7500, false));
console.log("one target per site, and no two sites on one player (owner, 2026-10-03):");
ok("a site's own claims never block it", busyFromOthers([{ site: 5, pids: [1] }], 5, [man("p1", 1, 50)]).size === 0);
ok("another site's claim blocks that player", [...busyFromOthers([{ site: 5, pids: [1] }, { site: 6, pids: [] }], 6, [man("p1", 1, 50)])].join() === "p1");
ok("a vehicle keyed by a claimed pid is blocked too", busyFromOthers([{ site: 5, pids: [3] }], 6, [man("v3", 3, 50)]).has("v3"));
const SA = new LockCore(3000, 1000);
const SB = new LockCore(3000, 1000);
const both = [man("p1", 1, 50), man("p2", 2, 80)];
SA.update(0, both, none(), O, true);
ok("site A takes the nearest, p1", SA.target === "p1" && SA.targetPid === 1);
SB.update(0, both, busyFromOthers([{ site: 1, pids: [SA.targetPid] }], 2, both), O, true);
ok("site B, seeing the same two, takes p2 instead", SB.target === "p2");
const solo = [man("p1", 1, 50)];
const SC = new LockCore(3000, 1000);
ok("p1 alone and claimed by another site: no track", kinds(SC.update(0, solo, busyFromOthers([{ site: 1, pids: [1] }], 2, solo), O, true)) === "");
ok("released (rocket landed): the other site may take p1", kinds(SC.update(500, solo, busyFromOthers([{ site: 1, pids: [] }], 2, solo), O, true)) === "track:p1");
ok("no target: targetPid is null", new LockCore(3000, 1000).targetPid === null);
done("test-lockcore");
