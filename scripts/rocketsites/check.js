// Tiny assertion helpers shared by the Node tests.
let failed = 0;

function ok(label, cond, detail) {
    if (!cond) failed++;
    console.log((cond ? "  ok   " : "  FAIL ") + label + (cond || detail === undefined ? "" : " (" + detail + ")"));
}

function near(label, got, want, eps) {
    ok(label, Math.abs(got - want) <= eps, "got " + got + ", want " + want);
}

function done(name) {
    if (failed > 0) {
        console.log(name + ": " + failed + " failed");
        process.exit(1);
    }
    console.log(name + ": all passed");
}

module.exports = { ok, near, done };
