// Unit test for the bot name pool and spawn/claim queue in src/botnames.ts.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "botnames.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const {
    initBotNames, takeBotName, claimBotName, releaseBotName, botNamePoolFree, expiredBotNames, NAME_CLAIM_MS
} = m.exports;

let failed = 0;
function ok(label, cond, detail) {
    if (!cond) failed++;
    console.log((cond ? "  ok   " : "  FAIL ") + label + (detail === undefined ? "" : " -> " + detail));
}

console.log("spawns and claims pair first in, first out:");
{
    initBotNames();
    const a = takeBotName(1, "", 0);
    const b = takeBotName(1, "", 10);
    ok("two different names", a !== b, a + " " + b);
    ok("first claim gets the first name", claimBotName(1, 100) === a);
    ok("second claim gets the second name", claimBotName(1, 110) === b);
    ok("nothing queued -> empty", claimBotName(1, 120) === "");
    ok("teams are separate", claimBotName(2, 120) === "");
}

console.log("a respawn keeps its name when it is free:");
{
    initBotNames();
    const a = takeBotName(2, "", 0);
    ok("claimed", claimBotName(2, 10) === a);
    releaseBotName(2, a);
    const again = takeBotName(2, a, 20);
    ok("preferred name reused", again === a, again);
    ok("and claimed in order", claimBotName(2, 30) === a);
    const other = takeBotName(2, a, 40);
    ok("preferred name in use -> another one", other !== a, other);
}

console.log("a spawn that never produced a soldier does not shift later names:");
{
    initBotNames();
    const free0 = botNamePoolFree(1);
    const lost = takeBotName(1, "", 0);
    const later = takeBotName(1, "", NAME_CLAIM_MS + 5000);
    const expiredBefore = expiredBotNames();
    const got = claimBotName(1, NAME_CLAIM_MS + 5100);
    ok("the later spawn gets its own name", got === later, got + " (lost " + lost + ")");
    ok("the lost name was counted as expired", expiredBotNames() === expiredBefore + 1);
    ok("and went back to the pool", botNamePoolFree(1) === free0 - 1, String(botNamePoolFree(1)));
    ok("a fresh name is not expired early", claimBotName(1, NAME_CLAIM_MS + 5200) === "");
}

console.log("a name released before its claim leaves the queue:");
{
    initBotNames();
    const a = takeBotName(1, "", 0);
    const b = takeBotName(1, "", 0);
    releaseBotName(1, a);
    ok("claim skips the released name", claimBotName(1, 10) === b);
}

if (failed > 0) { console.log(failed + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");
