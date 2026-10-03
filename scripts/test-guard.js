const fs = require("fs");
const { spawnSync } = require("child_process");

let failures = 0;

function guard() {
  return spawnSync("node", ["scripts/guard-sources.js"], { encoding: "utf8" });
}

function expectGuardFail(label, rel, lineToInject) {
  const backup = fs.readFileSync(rel, "utf8");
  try {
    fs.writeFileSync(rel, backup + "\n" + lineToInject + "\n");
    const r = guard();
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status === 0) {
      console.log("  GUARD HOLE  " + label + "  (this would have shipped)");
      failures++;
    } else {
      const hit = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.indexOf("src") === 0)
        .pop();
      console.log("  blocked     " + label + "  ->  " + (hit || "").replace(/\s+/g, " "));
    }
  } finally {
    fs.writeFileSync(rel, backup);
  }
}

function stripComments(src) {
  return src
    .split(/\r?\n/)
    .map((l) => {
      const at = l.indexOf("//");
      return at >= 0 ? l.slice(0, at) : l;
    })
    .join("\n");
}

console.log("guard self-test - the exact bug that ended the match:");
expectGuardFail("SetGameModeScore anywhere", "src/stats.ts", "mod.SetGameModeScore(h, 1);");
expectGuardFail("SetGameModeTargetScore anywhere", "src/stats.ts", "mod.SetGameModeTargetScore(1);");
expectGuardFail("EndGameMode outside hq", "src/stats.ts", "mod.EndGameMode(t);");
expectGuardFail("SetGameModeInitialScore outside stats", "src/hq.ts", "mod.SetGameModeInitialScore(t, 0);");
expectGuardFail("backtick in comment", "src/stats.ts", "// a `b` c");
expectGuardFail("pure re-export", "src/stats.ts", 'export { x } from "./state";');

const clean = guard();
console.log("\nclean tree  exit=" + clean.status + "  " + (clean.stdout || "").trim());

console.log("\nendgame integrity:");
const hqSrc = stripComments(fs.readFileSync("src/hq.ts", "utf8"));
const hasEnd = hqSrc.indexOf("mod.EndGameMode(") >= 0;
console.log("  hq.ts still owns EndGameMode: " + (hasEnd ? "YES" : "NO -- REGRESSION"));
if (!hasEnd) {
  failures++;
}

const statsCode = stripComments(fs.readFileSync("src/stats.ts", "utf8"));
const stray = ["SetGameModeScore", "SetGameModeTargetScore", "EndGameMode"].filter(
  (s) => statsCode.indexOf(s) >= 0
);
console.log("  stats.ts mode-mutating code: " + (stray.length === 0 ? "none" : stray.join(", ")));
if (stray.length > 0) {
  failures++;
}
const hasInit = statsCode.indexOf("SetGameModeInitialScore") >= 0;
console.log("  stats.ts ticket reset retained: " + (hasInit ? "yes (initialiser, safe)" : "no"));

console.log("\nguard is not over-strict on documentation:");
{
  const p = "src/stats.ts";
  const backup = fs.readFileSync(p, "utf8");
  try {
    fs.writeFileSync(p, backup + "\nconst _probe = 1; // never call SetGameModeScore here\n");
    const r = guard();
    console.log("  trailing comment naming a forbidden API: " + (r.status === 0 ? "ignored, as intended" : "TOO STRICT"));
    if (r.status !== 0) {
      failures++;
    }
  } finally {
    fs.writeFileSync(p, backup);
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\n" + failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
