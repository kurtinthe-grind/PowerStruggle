// Build guard for two bf6-portal-bundler behaviours that silently corrupt the
// emitted bundle while leaving `tsc --noEmit -p tsconfig.json` perfectly happy.
//
// Verified against bundler 1.4.1 by re-introducing each one and rebuilding:
//   1. A backtick anywhere inside a // comment. The bundler's strip-comments
//      pass mangles the line and swallows the code that follows, so the module's
//      functions vanish from dist/bundle.ts and the Portal editor's compiler
//      reports "Cannot find name" for every call site.
//   2. A pure re-export (`export { a, b } from "./x"`). The bundler cannot
//      resolve it and drops the whole module that contains it.
// Both failures are silent at build time without verify:bundle, and both were
// hit for real on src/teams.ts.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const problems = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".ts")) {
      check(full);
    }
  }
}

// 3. The victory condition. Round victory belongs to mod.EndGameMode in
//    turrets.ts and nowhere else. mod.SetGameModeScore / SetGameModeTargetScore
//    are forbidden outright: SetGameModeScore writes the live gamemode score,
//    which is how the round is decided, so calling it with a player score total
//    ended the match the instant the first capture paid out. That is a real bug
//    this guard was added after.
//    SetGameModeInitialScore is allowed only in stats.ts, where it merely
//    zeroes tickets at round start.
const VICTORY_OWNER = "turrets.ts";
const INITIAL_SCORE_OWNER = "stats.ts";
const FORBIDDEN_ANYWHERE = ["SetGameModeScore", "SetGameModeTargetScore"];

// Code only: drops everything from // onward so that documentation which names
// a forbidden API in prose never trips the rule, on a full-line comment or a
// trailing one alike.
function stripComment(line) {
  const at = line.indexOf("//");
  return at >= 0 ? line.slice(0, at) : line;
}

function checkVictory(rel, at, line) {
  const code = stripComment(line);
  if (code.trim() === "") {
    return;
  }
  for (const sym of FORBIDDEN_ANYWHERE) {
    if (code.indexOf(sym) >= 0) {
      problems.push(
        at + "  " + sym + " is the round win condition and must not be used for display"
      );
    }
  }
  if (code.indexOf("EndGameMode") >= 0 && path.basename(rel) !== VICTORY_OWNER) {
    problems.push(at + "  EndGameMode is owned by " + VICTORY_OWNER + " only");
  }
  if (
    code.indexOf("SetGameModeInitialScore") >= 0 &&
    path.basename(rel) !== INITIAL_SCORE_OWNER
  ) {
    problems.push(at + "  SetGameModeInitialScore is owned by " + INITIAL_SCORE_OWNER + " only");
  }
}

// 4. Bare re-export of an IMPORTED binding, e.g. "export { Logging };".
//    tsc is happy with it, but the bundler flattens every module into one scope,
//    so the name is emitted twice and the Portal compiler rejects the bundle with
//    "Export declaration conflicts with exported declaration of 'Logging'". The
//    module it came from already exports that name itself, so the second copy is
//    a duplicate by construction. Exporting a locally declared symbol this way is
//    fine, so only imported names are flagged.
function importedNames(lines) {
  const names = new Set();
  lines.forEach((line) => {
    const m = /^\s*import\s*\{([^}]*)\}\s*from\s*["']/.exec(line);
    if (!m) return;
    m[1].split(",").forEach((part) => {
      const cleaned = part.trim().split(/\s+as\s+/).pop();
      if (cleaned) names.add(cleaned.trim());
    });
  });
  return names;
}

function check(file) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const imports = importedNames(lines);
  lines.forEach((line, i) => {
    const at = rel + ":" + (i + 1);
    // 1. backtick inside a comment
    const comment = line.indexOf("//");
    if (comment >= 0 && line.indexOf(String.fromCharCode(96), comment) >= 0) {
      problems.push(at + "  backtick inside a comment corrupts the bundle");
    }
    // 2. pure re-export
    if (/^\s*export\s*\{[^}]*\}\s*from\s*["']/.test(line)) {
      problems.push(at + "  pure re-export drops the module from the bundle");
    }
    // 4. bare re-export of an imported binding
    const bare = /^\s*export\s*\{([^}]*)\}\s*;/.exec(line);
    if (bare) {
      bare[1].split(",").forEach((part) => {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && imports.has(name)) {
          problems.push(
            at +
              "  re-exporting imported '" +
              name +
              "' duplicates that export in the bundle"
          );
        }
      });
    }
    checkVictory(rel, at, line);
  });
}

walk(SRC_DIR);

if (problems.length > 0) {
  console.error("SOURCE GUARD FAILED:");
  for (const p of problems) {
    console.error("  " + p);
  }
  process.exit(1);
}
console.log(
  "source guard ok (no backtick-comments, no re-exports, victory condition intact)"
);
