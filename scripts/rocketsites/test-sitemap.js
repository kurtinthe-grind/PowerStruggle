// Rocket sites from the map: one 100-block per site (8100-8899), team from
// the block. Lids are scenery (no lid animation since 2026-10-03).
const fs = require("fs");
const path = require("path");
const { buildSitemap, teamOfSite } = require("./gen-sitemap.js");
const { ok, done } = require("./check.js");

const unit = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, front: { x: 0, y: 0, z: 1 } };

// A site's objects, the 3 x 4 silo grid turned turnDeg about the vertical.
function siteObjs(n, turnDeg) {
    const base = 8000 + n * 100;
    const t = (turnDeg * Math.PI) / 180;
    const at = (x, z) => ({ x: x * Math.cos(t) + z * Math.sin(t), y: 100, z: -x * Math.sin(t) + z * Math.cos(t) });
    const out = [{ name: "zone", ObjId: base, position: at(0, 0) }, { name: "animZone", ObjId: base + 1, position: at(20, 0) }];
    out.push({ name: "pillar", ObjId: base + 10, ...unit, position: at(20, 0) });
    out.push({ name: "sheet", ObjId: base + 11, ...unit, position: at(20, 1) });
    for (let i = 0; i < 12; i++) {
        const x = (i % 4) * 1.4;
        const z = Math.floor(i / 4) * 1.1;
        out.push({ name: "silo" + i, ObjId: base + 20 + i, position: at(x, z) });
        out.push({ name: "lid" + i, ObjId: base + 40 + i, right: { x: 0.25, y: 0, z: 0 }, up: { x: 0, y: 0.25, z: 0 }, front: { x: 0, y: 0, z: 0.25 },
            position: at(x, z + 0.38) });
    }
    return out;
}

function throws(label, fn, text) {
    let msg = "";
    try { fn(); } catch (e) { msg = e.message; }
    ok(label, msg.includes(text), "message: " + (msg || "none"));
}

console.log("teams come from the block:");
ok("sites 1-4 are team 1", [1, 2, 3, 4].every(n => teamOfSite(n) === 1));
ok("sites 5-8 are team 2", [5, 6, 7, 8].every(n => teamOfSite(n) === 2));

console.log("silos in number order; lids (even scaled ones) are ignored:");
const one = buildSitemap({ Portal_Dynamic: siteObjs(3, 30) }).sites[0];
ok("12 silos 8320-8331 in order", one.silos.map(o => o.id).join(",") === Array.from({ length: 12 }, (_, i) => 8320 + i).join(","));

console.log("only the blocks that have a zone become sites:");
const two = buildSitemap({ Portal_Dynamic: [...siteObjs(2, 0), ...siteObjs(7, 45)] });
ok("sites 2 and 7, in order", two.sites.map(s => s.n).join(",") === "2,7");
ok("site 2 is team 1, site 7 team 2", two.sites[0].team === 1 && two.sites[1].team === 2);
ok("the pillar (x10) comes first", two.sites[1].radarParts[0].id === 8710);
ok("each site has its radar animation zone (x01)", two.sites[0].animZone.id === 8201 && two.sites[1].animZone.id === 8701);

console.log("broken sites fail loudly:");
throws("no silos", () => buildSitemap({ Portal_Dynamic: siteObjs(1, 0).filter(o => o.ObjId < 8120 || o.ObjId > 8139) }), "no silos");
throws("no pillar x10", () => buildSitemap({ Portal_Dynamic: siteObjs(1, 0).filter(o => o.ObjId !== 8110) }), "no radar pillar 8110");
throws("no animation zone x01", () => buildSitemap({ Portal_Dynamic: siteObjs(1, 0).filter(o => o.ObjId !== 8101) }), "no radar animation zone 8101");
throws("objects but no zone", () => buildSitemap({ Portal_Dynamic: siteObjs(1, 0).filter(o => o.ObjId !== 8100) }), "no zone 8100");
throws("no sites at all", () => buildSitemap({ Portal_Dynamic: [] }), "no rocket sites");
const scaledPart = siteObjs(1, 0).map(o => (o.ObjId === 8111 ? { ...o, right: { x: 0.5, y: 0, z: 0 } } : o));
throws("a scaled radar part", () => buildSitemap({ Portal_Dynamic: scaledPart }), "scaled");

// The real map. PS_Isolated has no rocket sites until they are copied in
// from the RocketSiteTester map; until then this part is skipped.
const psMap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "PS_Isolated.spatial.json"), "utf8"));
const psObjs = [];
require("./gen-sitemap.js").collect(psMap, psObjs);
if (!psObjs.some(o => o.id >= 8100 && o.id <= 8899)) {
    console.log("the real map: no rocket sites in PS_Isolated yet, skipped");
} else {
    console.log("the real map (update only if you change the map on purpose):");
    const m = buildSitemap(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "PS_Isolated.spatial.json"), "utf8")));
    ok("6 sites: 1-3 and 5-7 (sites 4 and 8 deleted 2026-10-03)", m.sites.map(s => s.n).join(",") === "1,2,3,5,6,7", m.sites.map(s => s.n).join(","));
    for (const s of m.sites) {
        const base = 8000 + s.n * 100;
        ok("site " + s.n + ": team " + (s.n <= 4 ? 1 : 2) + ", zone " + base + ", radar " + (base + 10) + "-" + (base + 16) + ", 12 silos",
            s.team === (s.n <= 4 ? 1 : 2) && s.zone.id === base && s.radarParts.length === 7 && s.radarParts[0].id === base + 10
            && s.radarParts[6].id === base + 16 && s.silos.length === 12 && s.animZone.id === base + 1);
    }
    const sheet = m.sites[0].radarParts.find(p => p.name === "radar_metalsheet");
    ok("the sheet's basis is Godot X 40 (up column y 0.766, z 0.643)",
        sheet !== undefined && Math.abs(sheet.basis[4] - 0.766) < 1e-3 && Math.abs(sheet.basis[7] - 0.643) < 1e-3);
}
done("test-sitemap");
