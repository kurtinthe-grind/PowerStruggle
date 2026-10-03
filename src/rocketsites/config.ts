import { EulerOrder } from "./geom";
// RocketSiteTester tuning. Values marked PROBE were set from the one-off
// probe run of 2026-10-03 (see the outcome table in the plan, Task 4 step 9;
// the probe code was removed with the move to several sites).
// Each site's team comes from its ObjId block (scripts/gen-sitemap.js):
// sites 8100-8499 belong to team 1, 8500-8899 to team 2.

// Logged at start, so a log shows which upload ran (2026-10-03: a session
// ran an old script though the new bundle was built).
export const SCRIPT_VERSION: string = "2026-10-03 log-levels";
// 0 quiet (startup, problems, radars destroyed, server-load warnings, errors;
// for release), 1 events (+ shots, locks, launches, hits, radar wake/sleep,
// a stats line every STATS_EVERY_MS), 2 trace (+ zone enter/exit, alarm,
// launcher presses, radar read-backs). Messages above the level are never built.
export const LOG_LEVEL: number = 1;

// Owner, 2026-10-03: "make it so it doesn't kill me for now". Off: rockets
// still fly and explode on the target, but nobody is damaged or killed.
export const DAMAGE_ENABLED: boolean = false;

// Lock and fire
export const LOCK_MS: number = 3000;
export const SITE_COOLDOWN_MS: number = 1000;
export const SILO_RELOAD_MS: number = 8000;
export const MAX_ROCKETS_AIRBORNE: number = 4;
export const ALARM_LINGER_MS: number = 5000;         // owner: the alarm plays on after the zone empties and the rockets land

// Engine rotation conventions
export const DEFAULT_UNITS: "deg" | "rad" = "rad";   // confirmed in-game 2026-10-03 (radar rest X read 0.79)
// The engine's Euler order: Godot's ZYX, M = Rz*Ry*Rx (bf6-MultiObjectTransform
// README + its quaternion code). "XYZ" (2026-10-03 second session) rolled the dish.
export const ENGINE_EULER_ORDER: EulerOrder = "ZYX";
export const ENGINE_YAW_SIGN: number = 1;            // PROBE P3b
export const ENGINE_PITCH_SIGN: number = 1;          // PROBE P3c
export const POS_MATCH_M: number = 2;                // a handle counts as resolved when it reads within this of the map

// Radar: the owner's 7-object model (2026-10-03: pillar x10, the sheet at a
// fixed Godot X 40, a stud and four walls in x11-x16). It only turns
// left/right about the pillar's vertical axis; it never tilts. The Godot pose
// faces +Z.
export const RADAR_DRIVE: "absolute" | "off" = "absolute";
export const RADAR_TURN_PILLAR: boolean = true;      // false: the pillar stays still and only the head turns
export const RADAR_YAW_OFFSET_DEG: number = 0;       // turn this much extra if the sheet faces the wrong way
export const RADAR_SLEW_DEG_PER_S: number = 120;
export const RADAR_SWEEP_DEG_PER_S: number = 20;
// Smaller turns are not sent (7 objects per update). bf6-portal-utils Spatial
// only syncs a transform past 1 cm / ~10 deg by default; 1 deg is invisible
// on a radar and cuts the moves sent while tracking a slow target.
export const RADAR_MIN_STEP_DEG: number = 1;
export const RADAR_IDLE_UPDATE_MS: number = 100;     // a sweeping radar (no target) is redrawn this often, not every tick
// A tracking radar is redrawn this often rather than every tick
// (bf6-portal-utils animations throttle with minUpdateDeltaMs the same way).
export const RADAR_TRACK_UPDATE_MS: number = 50;
// Below this bf6-portal-utils PerformanceStats health (1 = 30 ticks/s) every
// radar drops to the idle cadence.
export const RADAR_HEALTH_MIN: number = 0.8;
export const SOUND_MOVE_MS: number = 100;            // a rocket's flight sound follows it this often
export const STATS_EVERY_MS: number = 10000;         // at LOG_LEVEL 1+: log tick rate, script time and object moves this often
export const RADAR_TRACE_READS: number = 3;          // at LOG_LEVEL 2: log a part's read-back pose this many times (all sites)
export const RADAR_TRACE_EVERY_MS: number = 5000;

// Rocket (homing numbers are pinned by scripts/test-geom.js)
export const ROCKET_MODE: "drag" | "segments" = "drag"; // PROBE P4
export const ROCKET_RISE_SECS: number = 0.4;
export const ROCKET_SPEED_START: number = 40;
export const ROCKET_ACCEL: number = 160;
export const ROCKET_SPEED_MAX: number = 220;
export const ROCKET_TURN_DEG_PER_S: number = 240;
export const ROCKET_CLOSE_RANGE_M: number = 60;
export const ROCKET_SPAWN_UP_M: number = 0.5;
export const SEGMENT_MS: number = 250;
export const HIT_RADIUS_M: number = 3;
export const MAX_FLIGHT_MS: number = 6000;
export const TARGET_AIM_UP_M: number = 1.0;
export const TRAIL_YAW_OFFSET_DEG: number = 0;       // PROBE P3a
export const TRAIL_PITCH_OFFSET_DEG: number = 0;     // PROBE P3a
export const VEHICLE_DAMAGE: number = 9999;

// Sound
export const BEEP_SLOW_MS: number = 900;
export const BEEP_FAST_MS: number = 120;
export const BEEP_AMP: number = 1;
export const BEEP_RANGE_M: number = 40;
export const ALARM_AMP: number = 1;
export const ALARM_RANGE_M: number = 250;
export const FLIGHT_AMP: number = 1;
export const FLIGHT_RANGE_M: number = 300;

// Effects
export const VFX_LIFETIME_MS: number = 12000;        // the Stinger streak lasts ~10 s
export const BURST_LIFETIME_MS: number = 6000;
export const PILLAR_MS: number = 1500;               // the smoke pillar at a silo after it fires
export const PILLAR_MAX_MS: number = 6000;           // safety lifetime if the stop is missed
export const MAX_LIVE_VFX: number = 80;
export const SPAWNS_PER_TICK: number = 3;

// Radar destruction. Owner, 2026-10-03: same method as the PowerStruggle
// turrets (ray along the shooter's aim, tested against an upright cylinder
// around the target), but with rocket launchers except lock-on ones; 8 hits (owner raised it from 4 after the 4th session);
// the site stays destroyed for the rest of the round.
export const RADAR_HITS: number = 8;
export const ALLOWED_LAUNCHERS: { gadget: mod.Gadgets; name: string }[] = [
    { gadget: mod.Gadgets.Launcher_Unguided_Rocket, name: "Unguided_Rocket" },
    { gadget: mod.Gadgets.Launcher_High_Explosive, name: "High_Explosive" },
    { gadget: mod.Gadgets.Launcher_Aim_Guided, name: "Aim_Guided" }
];
// HasEquipment means "carried", not "held" (PowerStruggle Rorsch finding), so
// a press only counts while a gadget slot is active. If the trace shows the
// slots never active with a launcher up, set this false.
export const LAUNCHER_REQUIRE_ACTIVE_SLOT: boolean = true;
export const LAUNCHER_TRACE_PRESSES: number = 12;    // at LOG_LEVEL 2: log slot states for the first presses
export const LAUNCHER_RANGE_M: number = 400;          // only watch shooters this close to the radar
export const LAUNCHER_ROCKET_SPEED_MPS: number = 120; // delays the hit until the real rocket arrives
export const RAY_MAX_DIST_M: number = 900;           // PowerStruggle values
// PowerStruggle starts 2.5 m out (past the body); a launcher's own rocket is
// 4.7-6.5 m out when the ray is cast (in-game 2026-10-03), so start past it.
export const RAY_START_OFFSET_M: number = 8;
export const RAY_OWN_ROCKET_M: number = 15;          // a stop this close to the eye is the own rocket: judged as clear
export const RAY_RESULT_TIMEOUT_MS: number = 1000;   // a ray with no answer by then is judged along its path
export const RADAR_HIT_SHAPE = { radius: 4, below: 6, above: 5, pointRadius: 5 };
export const RADAR_WRECK_DELAY_MS: number = 600;
export const WRECK_LIFETIME_MS: number = 600000;     // the wreck effect ends on its own

// Owner picks from SfxVfxShowcase (spec "Asset picks").
export const ASSET = {
    trail: mod.RuntimeSpawn_Common.FX_Missile_Stinger_Trail,
    hit: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Hit,
    hitWet: mod.RuntimeSpawn_Common.FX_Gadget_C4_Explosives_Detonation_Underwater, // with hit, target in water or a boat
    burst: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Hit_Critical,
    shockwave: mod.RuntimeSpawn_Common.VFX_Launchers_GroundShockwave_Dirt,
    pillar: mod.RuntimeSpawn_Common.FX_BASE_Smoke_Pillar_White_L,
    alarm: mod.RuntimeSpawn_Common.SFX_GameModes_BR_RespawnTower_Activate_Distant_SimpleLoop3D,
    lockBeep: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_Wreckage_BombBeeping_Loop_SimpleLoop3D,
    incomingBeep: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Beacons_Beeping_SimpleLoop3D,
    flight: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Shared_Projectile_MissileTrail_SimpleLoop3D,
    radarExplosion: mod.RuntimeSpawn_Common.FX_Vehicle_Car_Destruction_Death_Explosion_PTV,
    radarWreck: mod.RuntimeSpawn_Common.FX_Vehicle_Wreck_PTV
};
