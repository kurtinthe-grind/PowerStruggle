export const PRESTIGE_STEP: number = 250;

// Debug-level logging is off by default. The hot paths (capture and turret
// ENTER/EXIT, nuke CAST/HIT, tint, paint, feed layout) concatenate their
// message at the call site, so leaving them on costs a string build per event
// even when nobody reads it. Flip to true to diagnose, then flip back.
export const LOG_DEBUG: boolean = false;
// Admin logs (DEBUG tab toggle, off by default). On a "Host" (dedicated)
// server the log only reaches the owner's PC through mod.SendPortalLogToAdmin,
// which writes PortalLog.txt on the admin's client and has a per-session quota;
// on "Host Locally" it does nothing and the file is written directly. While on:
// tags listed with 0 are dropped, every other tag is capped at its number of
// lines per minute (ADMIN_LOG_CAP_DEFAULT when not listed), a once-a-minute
// line counts what was dropped, and the log is sent every ADMIN_LOG_SEND_MS,
// when the toggle is switched on, at match end, and at most every
// ADMIN_LOG_MIN_GAP_MS after an error. Each send is numbered in the log, so the
// first hosted test shows the quota and whether a send carries the whole log.
export const ADMIN_LOG_CAPS: { [tag: string]: number } = {
    uiButton: 0, menu: 0, feed: 0, hud: 0, debug: 0, prestige: 0, bar: 0, gadget: 0,
    economy: 0, stats: 0, worldicons: 0, events: 10, join: 10, score: 10, scoreboard: 5,
    bots: 60, nav: 20, shop: 30, capture: 30, ERROR: 60, log: 1000
};
export const ADMIN_LOG_CAP_DEFAULT: number = 20;
export const ADMIN_LOG_SEND_MS: number = 120000;
export const ADMIN_LOG_MIN_GAP_MS: number = 30000;
// Debug: every item on the buy menu WEAPONS tab costs 0 prestige, so the Rorsch
// and the other test weapons are always available. Set false for real matches.
export const WEAPONS_TAB_FREE: boolean = true;
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
// Upright cylinder around each turret base for the Rorsch path test (RayCast
// passes through the AA turrets). Sized from the 17:38 playtest: shots aimed
// at a turret passed 2.3-6 m from its axis at 6-14 m above its base.
export const TURRET_RAY_RADIUS_M: number = 7;
export const TURRET_RAY_BELOW_M: number = 3;
export const TURRET_RAY_ABOVE_M: number = 16;

export const HQ_HIT_RADIUS_M: number = 100;
export const HQ_HITS_REQUIRED: number = 3;

export const RAY_MAX_DIST_M: number = 900;
// Push the ray origin past the soldier's own body so it cannot self-hit.
export const RAY_START_OFFSET_M: number = 2.5;
// Ignore impacts closer than this; they are the player's own geometry.
export const RAY_MIN_HIT_DIST_M: number = 3.0;
// The Rorsch shot is the moment IsFiring turns off after a full charge (see
// rorschshot.ts). Measured 2026-10-01: the discharge lands 2200-2212 ms after
// the press. A release shorter than this is a cancelled charge, no shot. Kept
// below the measured charge so tick jitter cannot drop a real shot.
export const RORSCH_MIN_CHARGE_MS: number = 2100;
// Diagnostic: log the active slot at each press, both IsReloading edges and
// every ray outcome while a player is in an HQ fire zone. One soldier-state read
// per tick per player in a fire zone. Set false once settled.
export const RORSCH_TRACE: boolean = true;
export const POWER_LEVEL_REQUIRED: number = 100;

// ---- Bots: custom AI_Spawner objective players (no UI, no buy, no nuke) ----
// Bots are spawned and maintained entirely by src/bots.ts. The AI_Spawner
// prefab carries no count or respawn property, so every number below is
// script-owned. All bot pathing is plain distance math over a static position
// cache in src/botobjectives.ts; the only per-sweep FFI is one GetPosition
// per processed bot plus a behavior call when its intent changes.
// 32 a side, was 24: the owner reports 24 a side runs smoothly. Humans and bot
// corpses take team slots too (the scoreboard counts them), so the live bot
// count also stays within BOT_TEAM_SLOTS minus the humans on that team, and a
// spawn waits while a corpse still holds a slot.
export const BOT_COUNT_PER_TEAM: number = 32;
export const BOT_TEAM_SLOTS: number = 32;
// Dedicated 1 Hz sweep timer, separate from OngoingGlobal so bot thinking
// never competes with the per-frame HUD and charge work.
export const BOT_SWEEP_MS: number = 1000;
// Roster slice re-thought per sweep. 64 bots at 16 per sweep refresh fully
// every 4 sweeps, as 48 at 12 did; ownership changes force a full re-think
// (see bots.ts).
export const BOT_SLICE: number = 16;
// Spawn burst cap per sweep. Matches the 0.5 s stagger the official
// PortalPerformanceExample uses between SpawnAIFromAISpawner calls.
export const BOT_SPAWN_PER_SWEEP: number = 2;
// Persistent bots, as the CustomConquest V15 template runs them: a bot stays in
// the game when it dies and redeploys by itself as the same player, so its
// scoreboard row, name and stats live all match. The owner's scoreboard showed
// every bot at 0 while the log had 550 successful row writes a minute and bots
// with score (one at 1950, 17 kills); the template, which never turns on
// unspawn-on-dead, shows bot scores. false restores the old path: the bot
// leaves the game on death and a new one is spawned under its name.
export const BOT_PERSISTENT: boolean = true;
// Persistent bots: redeploy timer (the engine allows 0-60 s), and a dead bot
// not redeployed after BOT_REDEPLOY_WATCHDOG_MS is deployed by force.
export const BOT_REDEPLOY_S: number = 10;
export const BOT_REDEPLOY_WATCHDOG_MS: number = 25000;
// Persistent bots: population check (top up, trim for humans) this often.
export const BOT_MAINTAIN_MS: number = 5000;
// Non-persistent path only. Longer than the corpse lifetime below, so a
// respawn never reuses the name of a body still lying on the map.
export const BOT_RESPAWN_DELAY_MS: number = 11000;
// Bunker spawning (CustomConquest V15 AI_ObjectiveSpawn): on deploy this share
// of bots is teleported from the AI_Spawner onto the flag of a random owned
// bunker. The template uses about 0.9; the mode owner wants only some, 0.25.
export const BOT_BUNKER_SPAWN_CHANCE: number = 0.25;
// The teleport waits this long after deploy, as the template does (it waits
// 0.5 s after OnSpawnerSpawned). Teleported at once from OnPlayerDeployed, 69
// bots were logged as sent to a bunker in the 2026-10-02 playtest and none
// arrived: the spawn placed them back at the AI_Spawner.
export const BOT_TELEPORT_DELAY_MS: number = 500;
// Corpse lifetime before the engine unspawns the dead bot. 10 s, was 3: the
// owner found bodies gone the moment they were killed, before the name could
// be read.
export const BOT_CORPSE_SECONDS: number = 10;
// Global damage bot -> human, applied once at mode start (AcePursuit pattern).
export const BOT_DAMAGE_MULT: number = 0.5;
// Per-bot damage taken, applied at spawn (ObliterationExample pattern).
export const BOT_INCOMING_DAMAGE: number = 0.5;
// Every live bot's scoreboard row is written again this often. The owner saw
// every bot at zero (score, kills, deaths, assists) although rows are written
// on each award, death and spawn; a row written right at spawn may come too
// early for the engine, and a regular rewrite does not depend on that.
export const BOT_ROW_REFRESH_MS: number = 5000;
// Range cap for picking an objective. Was 500 m (CustomCQ README); on
// PS_Isolated that hid half the map, and the 2026-10-02 playtest spent the
// whole match on the two or three nearest objectives. Now the whole map.
export const BOT_MAX_PATH_M: number = 3000;
// Capture radius per objective kind (bunker, energy, proto, war, air, naval),
// horizontal metres around the anchor that are safely inside the capture
// volume. Measured from the PS_Isolated polygons: the bunker volume is only
// about 6 x 9 m, the aviation factory about 13 x 16 m with the anchor near one
// edge, the energy sites 40 x 46 m. Bots spread inside half of this radius,
// count as arrived inside 0.6 of it (or when the trigger reports them inside),
// and capture on a leash of half of it. The old fixed 6-18 m spread and 30 m
// hold radius put almost every bot outside the bunker and aviation volumes,
// which is why no bunker was captured all match.
export const BOT_CAPTURE_RADIUS_M: number[] = [2.0, 12, 6, 6, 2.5, 5];
// How long a bot avoids an objective it could not reach (MoveTo failed, or it
// stalled on the way). Per bot, and kept across respawns: the 18:48 playtest
// showed recycled bots walking straight back to the same unreachable bunker.
export const BOT_FAIL_COOLDOWN_MS: number = 90000;
// A MoveTo failure reported this soon after a new behavior was issued is the
// engine cancelling the previous move, not a real failure.
export const BOT_FAIL_GRACE_MS: number = 1500;
// Zero means issue a behavior only when the intent changes (dirty-check).
// Raised from 0 to 8: with a pure dirty-check a bot whose behavior silently
// expired never re-issued anything and wedged in place permanently.
export const BOT_REISSUE_SWEEPS: number = 8;
// Defend and hold leashes are the capture radius, at least this much, so a
// defender stands where it actually blocks a capture.
export const BOT_LEASH_MIN_M: number = 4;
// Beyond this distance the bot Sprints to its attack target, else runs.
export const BOT_SPRINT_DIST_M: number = 30;

// Stuck recovery. A bot walking to an attack target that has stayed within
// BOT_STUCK_MIN_M of one spot for BOT_STUCK_WINDOW_MS is wedged: either it is
// against a wall it cannot path around, or the behavior it was given expired
// without the engine reporting a move failure. Strike 1 jumps and re-issues the
// move; strikes 2 and 3 (strike 2 with another jump) make the waypoint link the
// bot is on more expensive for everyone and re-plan, or, off a link, give up on
// the target for this bot so it picks another; strike 4 kills it so it respawns
// at a spawner, about 40 s in. A bot stalled beside its target only jumps.
// Measured in time, not thinks: the third 2026-10-02 playtest counted "2
// thinks", which a capture flip (every bot re-thought every second) shrank to
// 2 s, and recycled 235 bots in 20 minutes; the recycled bots respawned in
// clumps at the spawners and bunkers.
export const BOT_STUCK_MIN_M: number = 4;
export const BOT_STUCK_WINDOW_MS: number = 10000;
export const BOT_STUCK_STRIKES: number = 4;
export const BOT_JUMP_S: number = 0.4;

// Objective scoring (src/botscore.ts). Each think a bot scores every objective
// and takes the best; there are no fixed roles. Score =
//   base x kind weight - distance / BOT_SCORE_DIST_M - crowd x claims^2
//   + stick (current target) + jitter (stable per bot).
// Bases: attack anything not ours; defend an owned point with at least
// BOT_THREAT_MIN enemies near it (plus per uncovered threat); hold a safe owned
// point (low, and zero once held longer than BOT_ROAM_MS, which is the roam).
// Claims count every bot that picked the objective, walking or standing, which
// is what splits the team up. An objective below its quota (the Prototype
// Factory) adds BOT_W_QUOTA, which outbids any ordinary attack.
export const BOT_W_ATTACK: number = 10;
export const BOT_W_DEFEND: number = 10;
export const BOT_W_PER_THREAT: number = 3;
export const BOT_W_HOLD: number = 1.5;
export const BOT_W_QUOTA: number = 15;
// The Prototype Factory is the most important building: the owner keeps this
// many bots on it at all times, the other team sends at least this many.
export const BOT_PROTO_DEFENDERS: number = 4;
export const BOT_PROTO_ATTACKERS: number = 6;
export const BOT_W_CROWD: number = 0.15;
export const BOT_W_STICK: number = 1.5;
export const BOT_W_JITTER: number = 0.5;
// 250 rather than 100 now that the range cap is the whole map: an objective
// 750 m away loses 3 points, not 7.5, so far objectives still get attacked.
export const BOT_SCORE_DIST_M: number = 250;
export const BOT_THREAT_MIN: number = 2;
// Kind weights, indexed by botobjectives OBJ_* (bunker, energy, proto, war,
// air, naval). Proto and energy first: they are what wins the power race.
export const BOT_KIND_WEIGHT: number[] = [1.1, 1.3, 1.5, 1.0, 0.9, 0.7];
// Combat interrupt: a bot shot by an enemy hands over to the engine's own
// combat AI (AIBattlefieldBehavior) for this long, then resumes its objective.
// Idea from bf6-portal-bots-brain (BattleSensor, 10 s TTL).
export const BOT_BATTLE_MS: number = 10000;
// One line per team every BOT_TRACE_MS showing where the bots are going, plus a
// line per give-up, boarding and eject. Diagnostic; set false once tuned.
export const BOT_TRACE: boolean = true;
export const BOT_TRACE_MS: number = 15000;

// Roaming. A bot that reached a safely-held objective used to sit on it for the
// rest of the match. Every BOT_ROAM_MS it is told to relocate to a different
// objective, which is what CustomConquest V15 AI_Scouting does: move to another
// CapturePoint in range and defend it, so the team circulates instead of
// stacking on one flag.
export const BOT_ROAM_MS: number = 22000;

// Navigation waypoints (src/botnav.ts, ObjIds 9000-9199, props or WorldIcons). A bot whose
// attack target is more than BOT_NAV_MIN_M away walks the cheapest route
// through the waypoint graph instead of straight there, advancing to the next
// waypoint inside BOT_NAV_REACH_M. Waypoints link automatically within
// BOT_NAV_LINK_M. A link a bot swam on or got stuck on costs
// BOT_NAV_WATER_PENALTY / BOT_NAV_STUCK_PENALTY times more for every bot for
// the rest of the match. Bots with no objective to pick roam between
// waypoints within BOT_NAV_ROAM_M. BOT_NAV_SHOW leaves WorldIcon waypoints
// visible, for checking placement in game (props are never touched).
// 250, was 160 (and 150 before that): at 160 site2, site3, bunker1 and naval2
// had no waypoint in reach, and site2's only link, straight from proto1, was
// penalised to x100 while bots kept failing on it (2026-10-03 log).
export const BOT_NAV_LINK_M: number = 250;
export const BOT_NAV_MIN_M: number = 100;
export const BOT_NAV_REACH_M: number = 10;
export const BOT_NAV_WATER_PENALTY: number = 8;
export const BOT_NAV_STUCK_PENALTY: number = 3;
export const BOT_NAV_ROAM_M: number = 250;
export const BOT_NAV_MISS_STOP: number = 25;
export const BOT_NAV_SHOW: boolean = false;

// Enemy pressure radius around an owned objective, for the DEFEND score. Read
// from PlayerLocations' cached positions, no FFI. Was 220 m for the old
// picker; that marks half the map as threatened once fighting starts.
export const BOT_THREAT_REACH_M: number = 90;

// Vehicles (existing ones only). mod.AllVehicles() is a list FFI, so the
// candidate scan runs once per BOT_VEHICLE_SCAN_MS for the whole population.
// A bot on foot whose attack target is more than BOT_VEHICLE_MIN_TRIP_M away
// walks to a free vehicle within BOT_VEHICLE_RADIUS_M (one bot per vehicle per
// scan) and is seated once within BOT_VEHICLE_SEAT_M, or gives up after
// BOT_VEHICLE_APPROACH_MS. Only vehicles with fewer than BOT_VEHICLE_FREE_SEATS
// occupants are candidates.
export const BOT_VEHICLE_SCAN_MS: number = 3000;
// 90 and 120, were 60 and 150: bots rarely used a vehicle in the 2026-10-02
// playtest. 90 m is about 15 s at a sprint, inside BOT_VEHICLE_APPROACH_MS.
export const BOT_VEHICLE_RADIUS_M: number = 90;
export const BOT_VEHICLE_FREE_SEATS: number = 2;
export const BOT_VEHICLE_MIN_TRIP_M: number = 120;
// 7 m, was 4: the distance is to the vehicle's centre, and the 2026-10-02 log
// had bots timing out over and over beside a vehicle they never got close
// enough to.
export const BOT_VEHICLE_SEAT_M: number = 7;
export const BOT_VEHICLE_APPROACH_MS: number = 20000;
// After an eject or a failed walk to a vehicle the bot stays on foot this long.
export const BOT_VEHICLE_BAN_MS: number = 60000;
// Seated bots: ejected when the vehicle moved less than BOT_VEHICLE_STUCK_M in
// BOT_VEHICLE_STUCK_MS (CustomConquest V15 pattern), after BOT_VEHICLE_MAX_MS
// in one vehicle, or (drivers) within BOT_VEHICLE_DISMOUNT_M of the objective.
// Never from an aircraft (it would drop the bot out of the sky), and a
// passenger is never ejected for those reasons while a human drives.
export const BOT_VEHICLE_STUCK_MS: number = 15000;
export const BOT_VEHICLE_STUCK_M: number = 3;
export const BOT_VEHICLE_MAX_MS: number = 120000;
export const BOT_VEHICLE_DISMOUNT_M: number = 35;
// Riding with a player. A bot on foot, not fighting, within BOT_RIDE_RADIUS_M
// of a vehicle a human on its team drives walks to it and takes a passenger
// seat, whatever its job, if the vehicle has a free seat and moved less than
// BOT_RIDE_SLOW_M between two vehicle scans (landed, or hovering low). It gets
// out once the vehicle has carried it BOT_RIDE_DELIVER_M from where it got in
// and then stood still (less than BOT_VEHICLE_STUCK_M) for BOT_RIDE_STILL_MS,
// and does not get back into that vehicle for BOT_RIDE_BAN_MS. An aircraft
// held still in the air that long counts as landed too.
export const BOT_RIDE_RADIUS_M: number = 40;
export const BOT_RIDE_SLOW_M: number = 10;
export const BOT_RIDE_DELIVER_M: number = 100;
export const BOT_RIDE_STILL_MS: number = 4000;
export const BOT_RIDE_BAN_MS: number = 30000;
// Driver steering (bf6-portal-bots-brain): exit, re-seat in seat 0 two ticks
// later, then AIDefendPositionBehavior on the objective so the vehicle AI
// drives there. If the driver has not closed BOT_DRIVE_PROGRESS_M on the
// objective within BOT_DRIVE_CHECK_MS it falls back to AIBattlefieldBehavior.
// The 2026-10-02 playtest showed it works (an AH64 flew 789 m to its
// objective) but was repeated every think; the same vehicle and objective are
// now steered once per BOT_STEER_REPEAT_MS. A re-seat that left the driver on
// foot beside its vehicle is retried BOT_RESEAT_TRIES times without the exit.
export const BOT_DRIVE_CHECK_MS: number = 20000;
export const BOT_DRIVE_PROGRESS_M: number = 20;
export const BOT_STEER_REPEAT_MS: number = 60000;
export const BOT_RESEAT_TRIES: number = 2;

// Radius used to spot vehicles parked on a spawner's pad. The war factory pads
// are 8-18 m apart, so the old 25 m let one parked tank block every pad.
export const VEHICLE_SLOT_RADIUS_M: number = 4;
// A spawn not confirmed within this time is retried once on a runtime spawner,
// then refunded. Forced spawns landed 31-34 ms after the call in the
// 2026-10-02 playtest, so this is generous.
export const VEHICLE_SPAWN_CONFIRM_MS: number = 4000;
// A refunded spawn that turns up this much later still records its owner, so
// its spawner is not handed out again while that vehicle lives.
export const VEHICLE_LATE_MATCH_MS: number = 30000;
// A VehicleSpawner refuses to spawn while the vehicle it made last is alive,
// wherever that vehicle is. A purchase on a pad whose placed spawner is held
// gets a runtime duplicate on the same pad instead (slots.ts). This caps the
// duplicates per factory; idle ones are reused, never unspawned.
export const VEHICLE_RUNTIME_SPAWNERS_MAX: number = 8;
// Only physically blocked pads refuse a purchase now.
export const VEHICLE_NO_SLOT_FEED: string = "shopNoSlot";
