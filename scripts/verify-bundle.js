// Compile check of dist/bundle.ts against the Tier 0 types (AGENT.md section 8).
//
// The bundler writes "// @ts-nocheck" at the top of the bundle, so a plain
// tsc run over dist/bundle.ts reports nothing at all. That is how a bundle
// with 48 TS18004 errors passed this step and then failed to compile on the
// Portal site (2026-10-04). This copies the bundle without that line into a
// temp folder and compiles it with the options of tsconfig.bundle.json.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BUNDLE = path.join(ROOT, "dist", "bundle.ts");
const TYPES = path.join(ROOT, "..", "main_resources", "types_original", "mod", "index.d.ts");
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-verify-"));
const copy = path.join(dir, "bundle.ts");
const src = fs.readFileSync(BUNDLE, "utf8").replace(/^\/\/ @ts-nocheck\s*$/m, "");
fs.writeFileSync(copy, src);

// The options of tsconfig.bundle.json, with the copy in place of the bundle.
const config = path.join(dir, "tsconfig.json");
fs.writeFileSync(config, JSON.stringify({
  compilerOptions: {
    target: "ES2020", module: "ES2020", lib: ["ES2020", "DOM"], strict: true, noEmit: true,
    skipLibCheck: true, types: []
  },
  files: [copy, TYPES]
}));
const r = spawnSync(process.execPath, [TSC, "--pretty", "false", "-p", config], { encoding: "utf8" });
fs.rmSync(dir, { recursive: true, force: true });

const out = (r.stdout || "") + (r.stderr || "");
if (r.status !== 0) {
  process.stdout.write(out.split(copy).join("dist/bundle.ts"));
  console.error("verify-bundle: dist/bundle.ts does not compile against the Tier 0 types");
  process.exit(1);
}
console.log("verify-bundle: dist/bundle.ts compiles against the Tier 0 types (strict, no @ts-nocheck)");
