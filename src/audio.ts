import { log } from "./util/log";
import { v } from "./util/vec";
import { teamHandle } from "./teams";

const cache: { [key: string]: mod.SFX } = {};

export type SfxKey =
    | "primary" | "buy" | "close" | "deny"
    | "capStart" | "capStartEnemy" | "capTick" | "capTickEnemy"
    | "capDone" | "capDoneEnemy" | "capNeutralize" | "capContested"
    | "siteYours" | "siteLost" | "siteFoe"
    | "nukeReady" | "nukeFire" | "turretDown" | "losOpen" | "killZone" | "hqHit";

const ASSETS: { [k: string]: mod.RuntimeSpawn_Common } = {
    primary: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_PrimarySelect_OneShot2D,
    buy: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ClickSelectLoadout_OneShot2D,
    close: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_GoBack_OneShot2D,
    deny: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_ZoomBlocked_OneShot2D,

    capStart: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByFriendly_OneShot2D,
    capStartEnemy: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByEnemy_OneShot2D,
    capTick: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickFriendly_OneShot2D,
    capTickEnemy: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickEnemy_OneShot2D,
    capDone: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinFriendly_OneShot2D,
    capDoneEnemy: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinEnemy_OneShot2D,
    capNeutralize: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureNeutralize_OneShot2D,
    capContested: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinThump_OneShot2D,

    siteYours: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_AreaUnlock_OneShot2D,
    siteLost: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureNeutralize_OneShot2D,
    siteFoe: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinEnemy_OneShot2D,

    nukeReady: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_AreaUnlock_OneShot2D,
    nukeFire: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop2D,
    turretDown: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_Wreckage_BombBeeping_OneShot3D,
    losOpen: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinNeutral_OneShot2D,
    killZone: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_RetrievalBeaconBeep_OneShot3D,
    hqHit: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop3D
};

function sfxFor(key: SfxKey): mod.SFX | undefined {
    let s: mod.SFX | undefined = cache[key];
    if (s !== undefined) {
        return s;
    }
    const asset: mod.RuntimeSpawn_Common | undefined = ASSETS[key];
    if (asset === undefined) {
        return undefined;
    }
    try {
        s = mod.SpawnObject(asset, v(0, 0, 0), v(0, 0, 0)) as mod.SFX;
        cache[key] = s;
    } catch (e) {
        log("sfx", "spawn failed for " + key);
        return undefined;
    }
    return s;
}

export function playSfxPlayer(key: SfxKey, p: mod.Player, amp: number): void {
    const s: mod.SFX | undefined = sfxFor(key);
    if (s === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp, p);
    } catch (e) {
    }
}

export function playSfxTeam(key: SfxKey, teamId: number, amp: number): void {
    const s: mod.SFX | undefined = sfxFor(key);
    if (s === undefined) {
        return;
    }
    // teamHandle, not mod.GetTeam: GetTeam takes the team id itself, so the old
    // GetTeam(teamId - 1) asked for team 0 when routing to team 1 and for team 1
    // when routing to team 2. Every call threw inside the catch and was silently
    // dropped, so all team-routed sounds were inaudible.
    const t: mod.Team | undefined = teamHandle(teamId);
    if (t === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp, t);
    } catch (e) {
    }
}

export function playSfxAll(key: SfxKey, amp: number): void {
    const s: mod.SFX | undefined = sfxFor(key);
    if (s === undefined) {
        return;
    }
    try {
        mod.PlaySound(s, amp);
    } catch (e) {
    }
}
