// Loads a TypeScript file with no imports into Node. rel is from the repo root.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

module.exports = function loadTs(rel) {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
    const js = ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const m = { exports: {} };
    new Function("module", "exports", js)(m, m.exports);
    return m.exports;
};
