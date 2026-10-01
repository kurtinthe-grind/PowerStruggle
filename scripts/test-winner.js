// Unit test for the pure end-of-match helpers in src/winner.ts.
// Transpiles the module with the project's own TypeScript and runs it in node.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "winner.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { winnerForDestroyedBase, winMessageKey, hqHpPercent, hqHitKeys } = m.exports;

let failed = 0;
function eq(label, got, want) {
    const ok = got === want;
    if (!ok) failed++;
    console.log((ok ? "  ok   " : "  FAIL ") + label + " -> " + got + (ok ? "" : " (want " + want + ")"));
}

console.log("winner for destroyed HQ:");
eq("HQ 1 (NATO) destroyed", winnerForDestroyedBase(1), 2);
eq("HQ 2 (PAX) destroyed", winnerForDestroyedBase(2), 1);
console.log("win message:");
eq("NATO wins", winMessageKey(1), "winT1");
eq("PAX wins", winMessageKey(2), "winT2");
console.log("HQ hp percent (3 hits):");
eq("0 hits", hqHpPercent(0, 3), 100);
eq("1 hit", hqHpPercent(1, 3), 67);
eq("2 hits", hqHpPercent(2, 3), 33);
eq("3 hits", hqHpPercent(3, 3), 0);
eq("overkill clamps", hqHpPercent(5, 3), 0);
console.log("HQ hit notifications:");
const k1 = hqHitKeys(1, 3), k2 = hqHitKeys(2, 3);
eq("1st hit defender", k1 && k1.defender, "hqUnderAttack");
eq("1st hit attacker", k1 && k1.attacker, "hqHit");
eq("2nd hit defender (1 left)", k2 && k2.defender, "hqCritical");
eq("2nd hit attacker (1 left)", k2 && k2.attacker, "hqFoeCritical");
eq("final hit: no hit notice (win message instead)", hqHitKeys(3, 3), null);

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
