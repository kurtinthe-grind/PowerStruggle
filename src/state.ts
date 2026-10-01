export const baseVal: { [t: number]: number } = { 1: 100, 2: 100 };
export let protoOwner: number = 0;
export const dbgMe: { [id: number]: number } = {};
export const siteState: { [t: number]: number[] } = {};
export const pPrestige: { [id: number]: number } = {};
// Monotonic banked charge, 0-100. Advanced by the global tick in factory.ts
// and only ever increases; losing sites stops the rate but never refunds it.
// This single value drives the HUD power bar and the nuke unlock check.
export const powerVal: { [t: number]: number } = { 1: 0, 2: 0 };

export function nukeReady(team: number): boolean {
    return powerVal[team] >= 100;
}

export function setProtoOwner(owner: number): void {
    protoOwner = owner;
}

export function getProtoOwner(): number {
    return protoOwner;
}

export function resetRoundState(): void {
    baseVal[1] = 100;
    baseVal[2] = 100;
    powerVal[1] = 0;
    powerVal[2] = 0;
    setProtoOwner(0);
    delete siteState[1];
    delete siteState[2];
    for (const id of Object.keys(pPrestige)) {
        delete pPrestige[Number(id)];
    }
}

export function playerIdOf(id: number): number {
    return id;
}
