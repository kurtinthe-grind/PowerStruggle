import { log, safe } from "./util/log";

export type FeedTone = "info" | "good" | "bad" | "warn";

type FeedSink = (t: FeedTone, teamId: number, key: string, a0: string | number, a1: string | number) => void;

let sink: FeedSink | undefined;

export function setFeedSink(fn: FeedSink): void {
    sink = fn;
}

export function notifyTeam(
    teamId: number,
    key: string,
    a0: string | number,
    a1: string | number
): void {
    const fn = sink;
    if (fn === undefined) {
        log("notify", "no sink for " + key);
        return;
    }
    safe("notify.team", () => {
        fn("info", teamId, key, a0, a1);
    });
    log("notify", "t" + String(teamId) + " <- " + key);
}

export function notifyPlayer(
    p: mod.Player,
    key: string,
    a0: string | number,
    a1: string | number
): void {
    const fn = sink;
    if (fn === undefined) {
        log("notify", "no sink for " + key);
        return;
    }
    const pid: number = mod.GetObjId(p);
    if (pid < 0) {
        return;
    }
    safe("notify.player", () => {
        fn("info", 0, key, a0, a1);
        pushPlayerFeedFromNotify(p, key, a0, a1);
    });
}

let playerSink: ((p: mod.Player, key: string, a0: string | number, a1: string | number) => void) | undefined;

export function setPlayerFeedSink(
    fn: (p: mod.Player, key: string, a0: string | number, a1: string | number) => void
): void {
    playerSink = fn;
}

function pushPlayerFeedFromNotify(
    p: mod.Player,
    key: string,
    a0: string | number,
    a1: string | number
): void {
    const fn = playerSink;
    if (fn === undefined) {
        return;
    }
    fn(p, key, a0, a1);
}
