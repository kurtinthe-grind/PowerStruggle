export const PRESTIGE_STEP: number = 250;

// Debug-level logging is off by default. The hot paths (capture and turret
// ENTER/EXIT, nuke CAST/HIT, tint, paint, feed layout) concatenate their
// message at the call site, so leaving them on costs a string build per event
// even when nobody reads it. Flip to true to diagnose, then flip back.
export const LOG_DEBUG: boolean = false;
export const POWER_MILESTONES: number[] = [50, 75, 100];
export const ART_BUDGET: number = 32;
export const SITE_LETTER: string[] = ["A", "B", "C"];

export const PRESTIGE_ON_DEPLOY: number = 0;

// Prestige paid per scoring action. Captures are split by what was taken so
// bunkers, energy points and factories are worth different amounts.
export const PRESTIGE_BUNKER: number = 150;
export const PRESTIGE_ENERGY: number = 200;
export const PRESTIGE_FACTORY: number = 250;
export const PRESTIGE_KILL: number = 50;
export const PRESTIGE_ASSIST: number = 25;

// DEFERRED - vehicle destruction is not scored. Tier 0 has no damager/killer
// accessor and no OnVehicleDamaged event, so the destroyer cannot be identified.
// The values below are held here so the decision and its numbers are recorded;
// they are intentionally not referenced by stats.ts.
export const PRESTIGE_VEHICLE: number = 100;

// Scoreboard score is tracked separately from prestige and is the primary
// sort column. It is not spendable.
export const SCORE_BUNKER: number = 150;
export const SCORE_ENERGY: number = 200;
export const SCORE_FACTORY: number = 250;
export const SCORE_KILL: number = 100;
export const SCORE_ASSIST: number = 50;
// DEFERRED - see PRESTIGE_VEHICLE.
export const SCORE_VEHICLE: number = 200;

export const CAPTURE_SECONDS: number = 20;
export const CAPTURE_TICK_HZ: number = 4;
export const CAPTURE_DECAY: number = 0.5;

export const BUNKER_CAPTURE_SECONDS: number = 20;
export const BUNKER_NEUTRALIZE_SECONDS: number = 10;
export const BUNKER_CAPTURE_MULTIPLIER: number = 3;

export const CHARGE_BASE_SECONDS: number = 300;
export const CHARGE_PER_SITE: number = 1.5;
export const CHARGE_REQUIRES_FACTORY: boolean = true;
export const CHARGE_UNLOCK_50: number = 50;
export const CHARGE_UNLOCK_100: number = 100;

export const TURRET_WARNING_SECS: number = 3;
export const TURRET_CLUSTER_REQ: number = 3;
export const TURRET_HIT_RADIUS_M: number = 12;

export const HQ_HIT_RADIUS_M: number = 100;
export const HQ_HITS_REQUIRED: number = 2;

export const RAY_MAX_DIST_M: number = 900;
// Push the ray origin past the soldier's own body so it cannot self-hit.
export const RAY_START_OFFSET_M: number = 2.5;
// Ignore impacts closer than this; they are the player's own geometry.
export const RAY_MIN_HIT_DIST_M: number = 3.0;
export const POWER_LEVEL_REQUIRED: number = 100;

// ---- Bots: custom AI_Spawner objective players (no UI, no buy, no nuke) ----
// Bots are spawned and maintained entirely by src/bots.ts. The AI_Spawner
// prefab carries no count or respawn property, so every number below is
// script-owned. All bot pathing is plain distance math over a static position
// cache in src/botobjectives.ts; the only per-sweep FFI is one GetPosition
// per processed bot plus a behavior call when its intent changes.
export const BOT_COUNT_PER_TEAM: number = 24;
// Dedicated 1 Hz sweep timer, separate from OngoingGlobal so bot thinking
// never competes with the per-frame HUD and charge work.
export const BOT_SWEEP_MS: number = 1000;
// Roster slice re-thought per sweep. 48 bots at 12 per sweep refresh fully
// every 4 sweeps; ownership changes force a full re-think (see bots.ts).
export const BOT_SLICE: number = 12;
// Spawn burst cap per sweep. Matches the 0.5 s stagger the official
// PortalPerformanceExample uses between SpawnAIFromAISpawner calls.
export const BOT_SPAWN_PER_SWEEP: number = 2;
export const BOT_RESPAWN_DELAY_MS: number = 5000;
// Corpse lifetime on the spawner before the engine unspawns the dead bot.
export const BOT_CORPSE_SECONDS: number = 3;
// Global damage bot -> human, applied once at mode start (AcePursuit pattern).
export const BOT_DAMAGE_MULT: number = 0.5;
// Per-bot damage taken, applied at spawn (ObliterationExample pattern).
export const BOT_INCOMING_DAMAGE: number = 0.5;
// Pathfinding radius cap. Source is TIER 2 CustomCQ README (500 m) -
// UNVERIFIED against PS_Isolated, tune after the first playtest.
export const BOT_MAX_PATH_M: number = 500;
// Arrival radius: inside this the bot is treated as on the objective and the
// capture system takes over, no further MoveTo needed.
export const BOT_ARRIVE_M: number = 8;
// Failed MoveTo handling: defend-in-place retries before re-picking.
export const BOT_RETRY_LIMIT: number = 2;
export const BOT_FAIL_COOLDOWN_MS: number = 15000;
// Zero means issue a behavior only when the intent changes (dirty-check).
// Raised from 0 to 8: with a pure dirty-check a bot whose behavior silently
// expired never re-issued anything and wedged in place permanently.
export const BOT_REISSUE_SWEEPS: number = 8;
// Defend leash around the objective anchor, and hold radius when owned-safe.
export const BOT_DEFEND_MIN_M: number = 5;
export const BOT_DEFEND_MAX_M: number = 25;
export const BOT_HOLD_RADIUS_M: number = 30;
// Beyond this distance the bot Sprints to its attack target, else runs.
export const BOT_SPRINT_DIST_M: number = 30;

// Stuck recovery. A bot that has moved less than BOT_STUCK_MIN_M over
// BOT_STUCK_WINDOW_SWEEPS consecutive thinks is wedged: either it is against a
// wall it cannot path around, or the behavior it was given expired without the
// engine reporting a move failure. It is first re-issued toward a different
// objective; after BOT_STUCK_STRIKES it is killed outright, which recycles it
// through the normal death and respawn path and puts it back at a spawner
// instead of leaving it parked in a corner.
export const BOT_STUCK_MIN_M: number = 4;
export const BOT_STUCK_WINDOW_SWEEPS: number = 6;
export const BOT_STUCK_STRIKES: number = 3;

// Spread, so 24 bots do not all converge on one identical point and shove each
// other off it. Each bot nudges its own target by up to this radius, seeded from
// its player id so the offset is stable across sweeps.
export const BOT_SPREAD_M: number = 18;
// How strongly a bot avoids an already-crowded objective. Expressed in metres
// and squared-distance weighted in pickObjective: each bot already standing on
// a point counts as this much extra distance, so the 13th bot walks to the next
// point instead of piling onto the 12 that are there.
export const BOT_CROWD_PENALTY_M: number = 22;

// Role split. A bot whose player id mod BOT_ROLE_MOD equals its team id is a
// dedicated factory guard, which for a 24 bot team is 4 of every 6 ids - so
// roughly the 3-4 guards per team asked for, with no extra spawn pass. Ids are
// stable for a soldier's whole life, so a guard stays a guard instead of
// flipping roles between sweeps.
export const BOT_ROLE_MOD: number = 6;

// Roaming. A bot that reached a safely-held objective used to sit on it for the
// rest of the match. Every BOT_ROAM_MS it is told to relocate to a different
// objective, which is what CustomConquest V15 AI_Scouting does: move to another
// CapturePoint in range and defend it, so the team circulates instead of
// stacking on one flag.
export const BOT_ROAM_MS: number = 22000;

// Reactive defence. botobjectives.pickDefendObjective considers owned objectives
// with enemies inside this radius, and sends a bot across when a point is
// under-defended. The pressure count itself comes from PlayerLocations, which
// answers it from cached positions at no FFI cost, so this radius is the only
// tuning knob.
export const BOT_THREAT_REACH_M: number = 220;

// Vehicles. mod.AllVehicles() is a list FFI, so the candidate scan runs once
// per BOT_VEHICLE_SCAN_MS for the whole team instead of once per bot per sweep.
// Only bots whose id mod BOT_VEHICLE_MOD equals their team try to board, and
// only a vehicle with fewer than BOT_VEHICLE_FREE_SEATS occupants is taken, so
// a parked tank is not stripped by every bot in the area at once.
export const BOT_VEHICLE_SCAN_MS: number = 3000;
export const BOT_VEHICLE_RADIUS_M: number = 60;
export const BOT_VEHICLE_MOD: number = 4;
export const BOT_VEHICLE_FREE_SEATS: number = 2;

// Radius used to spot vehicles already parked on a factory's spawner slots.
export const VEHICLE_SLOT_RADIUS_M: number = 25;
// A VehicleSpawner refuses to spawn while it still holds a vehicle, so a
// second purchase of the same type needs a free slot or it is refused.
export const VEHICLE_NO_SLOT_FEED: string = "shopNoSlot";
