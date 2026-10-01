// Unit test for the pure end-of-match helpers in src/winner.ts.
// Transpiles the module with the project's own TypeScript and runs it in node.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "winner.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { winnerForDestroyedBase, winMessageKey } = m.exports;

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

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
