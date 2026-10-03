// Builds src/rocketsites/sitemap.ts from PS_Isolated.spatial.json.
// Every rocket site owns one 100-block of ObjIds (owner, 2026-10-03):
// sites 1-4 (8100-8499) belong to team 1, sites 5-8 (8500-8899) to team 2.
// Inside a block (site 1 shown): 8100 kill zone, 8101 radar animation zone
// (the radar only turns while someone is in it), 8110 radar pillar (the
// pivot), 8111-8119 the other radar parts, 8120-8139 silos, 8140-8159 lids,
// 8160-8199 VFX. Lids are scenery only: the owner dropped the lid animation
// (2026-10-03), so the script never reads them.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SPATIAL = path.join(ROOT, "PS_Isolated.spatial.json");
const OUT = path.join(ROOT, "src", "rocketsites", "sitemap.ts");
const FIRST_SITE = 1;
const LAST_SITE = 8;
const TEAM1_LAST_SITE = 4;
const ZONE_AT = 0;
const ANIM_ZONE_AT = 1;
const RADAR_AT = [10, 19];      // the lowest (x10) is the pillar: the pivot the radar turns about
const SILO_AT = [20, 39];
const SCALE_TOL = 0.02;         // the README of bf6-MultiObjectTransform: scaled objects misalign when moved

function collect(node, out) {
    if (Array.isArray(node)) {
        for (const n of node) collect(n, out);
        return;
    }
    if (node && typeof node === "object") {
        if (typeof node.ObjId === "number" && node.position) {
            const o = { id: node.ObjId, name: node.name, x: node.position.x, y: node.position.y, z: node.position.z };
            if (node.right && node.up && node.front) {
                o.axes = [node.right, node.up, node.front].map(a => [a.x, a.y, a.z]);
            }
            out.push(o);
        }
        for (const k of Object.keys(node)) collect(node[k], out);
    }
}

function siteBase(n) {
    return 8000 + n * 100;
}

function teamOfSite(n) {
    return n <= TEAM1_LAST_SITE ? 1 : 2;
}

// Largest axis scale of an object (1 when the export has no axes).
function scaleOf(o) {
    const ax = o.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    return ax.map(a => Math.hypot(a[0], a[1], a[2])).reduce((w, l) => (Math.abs(l - 1) > Math.abs(w - 1) ? l : w), 1);
}

// An object's rest rotation, row-major (the export's right/up/front are the
// columns), with any scale divided out.
function basisOf(o) {
    const ax = o.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const [r, u, f] = ax.map(a => {
        const l = Math.hypot(a[0], a[1], a[2]);
        return a.map(v => v / l);
    });
    return [r[0], u[0], f[0], r[1], u[1], f[1], r[2], u[2], f[2]];
}

// The radar's objects with their rest bases, pivot first. Parts must be
// unscaled.
function radarParts(parts) {
    return [...parts].sort((a, b) => a.id - b.id).map(p => {
        const l = scaleOf(p);
        if (Math.abs(l - 1) > SCALE_TOL) {
            throw new Error("radar part " + p.id + " (" + p.name + ") is scaled " + l.toFixed(3) + "; scaled parts misalign when moved");
        }
        return { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, basis: basisOf(p) };
    });
}

function buildSite(n, objs) {
    const base = siteBase(n);
    const at = (r) => objs.filter(o => o.id >= base + r[0] && o.id <= base + r[1]);
    const zone = objs.find(o => o.id === base + ZONE_AT);
    const inBlock = objs.filter(o => o.id >= base && o.id < base + 100);
    if (!zone) {
        if (inBlock.length > 0) throw new Error("site " + n + ": objects " + inBlock[0].id + "... but no zone " + base);
        return undefined;
    }
    const animZone = objs.find(o => o.id === base + ANIM_ZONE_AT);
    if (!animZone) throw new Error("site " + n + ": no radar animation zone " + (base + ANIM_ZONE_AT));
    const parts = at(RADAR_AT);
    if (parts.length === 0) throw new Error("site " + n + ": no radar " + (base + RADAR_AT[0]) + "-" + (base + RADAR_AT[1]));
    if (!parts.some(p => p.id === base + RADAR_AT[0])) {
        throw new Error("site " + n + ": no radar pillar " + (base + RADAR_AT[0]) + " (the pivot must be the lowest radar number)");
    }
    const silos = at(SILO_AT);
    if (silos.length === 0) throw new Error("site " + n + ": no silos " + (base + SILO_AT[0]) + "-" + (base + SILO_AT[1]));
    const silosById = [...silos].sort((a, b) => a.id - b.id);
    const centre = [0, 1, 2].map(k => silos.reduce((sum, s) => sum + [s.x, s.y, s.z][k], 0) / silos.length);
    const rp = radarParts(parts);
    return { n, team: teamOfSite(n), zone, animZone, radar: rp[0], radarParts: rp, silos: silosById, centre };
}

function buildSitemap(json) {
    const objs = [];
    collect(json, objs);
    const sites = [];
    for (let n = FIRST_SITE; n <= LAST_SITE; n++) {
        const s = buildSite(n, objs);
        if (s) sites.push(s);
    }
    if (sites.length === 0) throw new Error("no rocket sites in the map (zones 8100, 8200, ... 8800)");
    return { sites };
}

function render(m) {
    const n = (v) => String(Number(v.toFixed(4)));
    const v3 = (o) => "[" + [o.x, o.y, o.z].map(n).join(", ") + "]";
    const lines = [
        "// GENERATED by scripts/rocketsites/gen-sitemap.js from PS_Isolated.spatial.json. Do not edit.",
        "// One entry per rocket site.",
        "export interface SiloDef { siloId: number; x: number; y: number; z: number; }",
        "export interface RadarPartDef { id: number; name: string; x: number; y: number; z: number; basis: number[]; }",
        "// radarParts: the radar model's objects, the pivot (radarId) first; basis is the rest rotation, row-major.",
        "// animZoneId: the radar only turns while a player is inside this trigger.",
        "export interface SiteDef { n: number; team: number; zoneId: number; animZoneId: number; radarId: number; radarPos: [number, number, number];",
        "    gridCentre: [number, number, number]; radarParts: RadarPartDef[]; silos: SiloDef[]; }",
        "export const SITES: SiteDef[] = ["
    ];
    for (const s of m.sites) {
        lines.push("    {");
        lines.push("        n: " + s.n + ", team: " + s.team + ", zoneId: " + s.zone.id + ", animZoneId: " + s.animZone.id + ", radarId: " + s.radar.id
            + ", radarPos: " + v3(s.radar) + ",");
        lines.push("        gridCentre: [" + s.centre.map(n).join(", ") + "],");
        lines.push("        radarParts: [");
        for (const p of s.radarParts) {
            lines.push("            { id: " + p.id + ", name: \"" + p.name + "\", x: " + n(p.x) + ", y: " + n(p.y) + ", z: " + n(p.z)
                + ", basis: [" + p.basis.map(v => String(Number(v.toFixed(6)))).join(", ") + "] },");
        }
        lines.push("        ],");
        lines.push("        silos: [");
        for (const o of s.silos) {
            lines.push("            { siloId: " + o.id + ", x: " + n(o.x) + ", y: " + n(o.y) + ", z: " + n(o.z) + " },");
        }
        lines.push("        ]");
        lines.push("    },");
    }
    lines.push("];", "");
    return lines.join("\n");
}

function main() {
    const json = JSON.parse(fs.readFileSync(SPATIAL, "utf8"));
    // Part of npm run build: until the sites are placed in PS_Isolated the
    // build goes on with the empty sitemap.ts (both HQs open, no sites).
    const found = [];
    collect(json, found);
    if (!found.some(o => o.id >= siteBase(FIRST_SITE) && o.id <= siteBase(LAST_SITE) + 99)) {
        console.log("sitemap: no rocket sites in the map yet (ObjIds 8100-8899); sitemap.ts left as it is");
        return;
    }
    const m = buildSitemap(json);
    fs.writeFileSync(OUT, render(m));
    console.log("sitemap: " + m.sites.length + " sites");
    for (const s of m.sites) {
        console.log("  site " + s.n + " (team " + s.team + "): zone " + s.zone.id + ", animation zone " + s.animZone.id + ", radar " + s.radarParts.length + " parts, "
            + s.silos.length + " silos");
    }
}

module.exports = { basisOf, collect, buildSite, buildSitemap, render, siteBase, teamOfSite };

if (require.main === module) {
    try {
        main();
    } catch (e) {
        console.error("gen-sitemap FAILED: " + e.message);
        process.exit(1);
    }
}
