# Power Struggle — Locked ObjId Allocation

> ## 🔒 LOCKED — DO NOT RENUMBER
>
> These ObjIds are **frozen and reserved**. They are already referenced by design in
> `config.ts` and by the Godot scene layout. Reusing a number for a different object
> type, or renumbering, silently breaks building binding, turret destruction, and the
> per-player WorldIcon highlight.
>
> - If a category needs more slots, **take the next free block** — never renumber.
> - Gaps between sub-blocks are **intentional headroom**. Do not collapse them.
> - Every ObjId defaults to `0` in config until you fill it from the exported
>   `.spatial.json`. `0` means "unconfigured" and every binding path must no-op on it.
>
> **AGENT.md §87: never guess an ObjId. Read it from the `.tscn` / `.spatial.json`.**
> This file defines the *targets*; Godot must be authored to match.

- **SDK:** Portal SDK 1.4.3.0
- **Authority source:** `main_resources/types_original/mod/index.d.ts`
- **Status:** Frozen 2026-09-28
- **Companion doc:** `PowerStruggleMod_Workflow_and_Findings.md`

---

## Verification reference — why these classes

| Class needed | Tier 0 fact | Line |
|---|---|---|
| `CapturePoint` | In `mod.Object` union → `GetObjectPosition` works | 206 |
| `HQ` | In `mod.Object` union (I was wrong earlier that it wasn't) | 209 |
| `EmplacementSpawner` | In `mod.Object` union → `GetObjectPosition` works | 208 |
| `AreaTrigger` | In `mod.Object` union | 204 |
| `WorldIcon` | In `mod.Object` union | 229 |
| `SpawnPoint` | In `mod.Object` union — **but no ObjId needed, see §1** | 217 |

---

## 1000–1999 — BUNKERS (native Conquest capture)

Bunkers are **captured, not purchased**. They serve as field spawn points only.
They use the **native** Conquest capture system.

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `1000–1099` | Bunker CapturePoint | `CapturePoint` | 20 | Needs `CapturePointArea` volume. Owner drives `EnableCapturePointDeploying`. |
| `1100–1199` | Bunker WorldIcon | `WorldIcon` | 20 | Required: a CapturePoint with no Sector gets no native sector icon. |

### 1.1 SpawnPoints deliberately have NO ObjId range

**Design decision — do not add one.** SpawnPoints attached to a bunker CapturePoint are
managed entirely by the engine via `mod.EnableCapturePointDeploying` (33292) +
`mod.SetSpawnMode(mod.SpawnModes.Deploy)` (33349). The script never references a
SpawnPoint, so it never needs one. (Correction the user made — my original table wrongly
allocated `1100–1299` for SpawnPoints.)

### 1.2 Bunkers have NO purchase terminal

**Design decision.** Bunkers do not sell. All purchasing happens at factories via the
Portal Gadget buy menu (§4.1). My original table wrongly allocated `1400–1499`.

---

## 2000–2999 — ENERGY SITES (custom AreaTrigger capture)

**No CapturePoint.** Ownership comes from our own capture system built on `AreaTrigger`.

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `2000–2099` | Energy Site AreaTrigger | `AreaTrigger` | 20 | Needs `CollisionPolygon3D` volume. This is both the capture zone **and** the presence gate. |
| `2100–2199` | Energy Site WorldIcon | `WorldIcon` | 20 | Parent anchor — see §6. |

> Cryxis maps use **2–4** energy sites. 3 is planned. 20 slots gives headroom.
> More sites owned = faster prototype factory charge.

---

## 3000–3999 — PROTOTYPE FACTORY (custom AreaTrigger capture)

**No CapturePoint. No purchase terminal.** The most important building: owns the
nuke unlock path.

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `3000–3099` | Proto Factory AreaTrigger | `AreaTrigger` | 20 | Capture zone + buy-menu presence gate (one trigger serves both). |
| `3100–3199` | Proto Factory WorldIcon | `WorldIcon` | 20 | |

> Unlocks: miniguns from 0%, MOAC + MOAR at 50%, TAC launcher / TAC tank / heavy
> singularity tank at 100%. Charge rate is multiplied by energy sites held.

---

## 4000–4999 — WAR FACTORY (custom AreaTrigger capture)

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `4000–4099` | War Factory AreaTrigger | `AreaTrigger` | 20 | Capture zone + buy-menu gate. |
| `4100–4199` | War Factory WorldIcon | `WorldIcon` | 20 | |
| `4200–4299` | War Factory garage | `VehicleSpawner` | 20 | `SetVehicleSpawnerVehicleType` (34459) + `ForceVehicleSpawnerSpawn` (34408). The **only** vehicle-spawn path in Portal. |

---

## 5000–5999 — AVIATION FACTORY (custom AreaTrigger capture)

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `5000–5099` | Aviation Factory AreaTrigger | `AreaTrigger` | 20 | Capture zone + buy-menu gate. |
| `5100–5199` | Aviation WorldIcon | `WorldIcon` | 20 | |
| `5200–5299` | Aviation hangar | `VehicleSpawner` | 20 | |

---

## 6000–6999 — NAVAL FACTORY (custom AreaTrigger capture)

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `6000–6099` | Naval Factory AreaTrigger | `AreaTrigger` | 20 | Capture zone + buy-menu gate. |
| `6100–6199` | Naval WorldIcon | `WorldIcon` | 20 | |
| `6200–6299` | Naval dock | `VehicleSpawner` | 20 | |

---

## 7000–7999 — HQ

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `7300–7309` | HQ dummy target | `SpatialObject` | 2 | One per base. A Rorsch hit within `HQ_HIT_RADIUS_M` (350 m) of it damages that HQ once it is open. |
| `7400–7409` | HQ explosion VFX | `SpatialObject` | 2 | One per base. Fires on victory. |

**Retired 2026-10-03** (the rocket sites replaced the turrets; delete them from
the map): `7000–7099` turret emplacements, `7100–7199` turret warning zones,
`7200–7299` turret destroyed VFX, `7500–7509` enemy-base proximity gates. The
Rorsch now fires from anywhere, so the gates have no use.

---

## 8100–8899 — ROCKET SITES

One 100-block per site (`src/rocketsites/`). Sites 8100, 8200, 8300, 8400
belong to team 1; 8500, 8600, 8700, 8800 to team 2. PowerStruggle uses three
per team; an enemy HQ opens when 2 of its team's sites are down
(`SITES_TO_OPEN_HQ`). A block without a kill zone is not a site.

| ObjId (site 1) | Object | Rules |
|---|---|---|
| `8100` | Kill zone (AreaTrigger + PolygonVolume) | Required |
| `8101` | Radar animation zone (AreaTrigger + PolygonVolume) | Required; centred on the radar, 190 m each way, 80 m tall |
| `8110` | Radar pillar | Required; the pivot; the lowest radar number |
| `8111–8119` | Other radar parts | Unscaled (scale 1); the build fails on a scaled part |
| `8120–8139` | Silos | Launch points; any scale |
| `8140–8159` | Lids | Scenery; ignored by the script |
| `8160–8199` | Reserved for VFX | |

**Positions are read from the map file at build time**: `npm run build` runs
`scripts/rocketsites/gen-sitemap.js`, which writes `src/rocketsites/sitemap.ts`
from `PS_Isolated.spatial.json`. Never rotate a scaled object from script; keep
every radar part at scale 1 with no scaled parent.

---

## 9000–9199 — BOT NAVIGATION WAYPOINTS

| ObjId range | Object | Class | Max | Godot notes |
|---|---|---|---|---|
| `9000–9199` | Bot navigation waypoint | any object with an ObjId | 200 | Any prop with an ObjId (PS_Isolated uses `AmmoChest_Small_Int_01` scaled to 0.001). Place it **on walkable ground** where bot pathing is poor. Any two nodes within 160 m (`BOT_NAV_LINK_M`) are linked automatically: waypoint to waypoint, waypoint to objective, and objective to objective. Keep neighbours within 160 m with dry, walkable ground between them. The start-up log lists any waypoint with no neighbour and any objective with no waypoint nearby. |

**Positions are read from the map file at build time.** In the 2026-10-02 playtest the props never resolved at runtime (`GetSpatialObject` returned invalid for all 14), so `scripts/gen-navpoints.js` (the first step of `npm run build`) reads every object with an ObjId in this block from `PS_Isolated.spatial.json` into `src/navpoints.ts`. **After moving or adding waypoints: export the map, then `npm run build`.** If the build has no map file, the script falls back to a runtime lookup (SpatialObject, then WorldIcon, numbered from 9000 without gaps of 25 or more; a WorldIcon found that way is hidden unless `BOT_NAV_SHOW`). The start-up line says which source was used: `[nav] graph: N waypoints (map file) + ...`.

---

## §4 — Buy menu placement (no terminals)

**Design decision — the user removed all purchase terminals.**
My original table wrongly allocated `1400–1499` (bunker) and `3200–3299` /
`4200–4299` (proto/war factory).

Buy menus open via the **Portal Gadget**, gated on which factory `AreaTrigger` the
player currently occupies:

1. `mod.OnPortalGadgetFireStart(player)` fires.
2. Look up the player's occupied factory via our `AreaTrigger` occupancy registry.
3. Open **that factory's** buy menu (Proto / War / Aviation / Naval each own their list).
4. DEBUG mode: post a feed notification — *"Buy menu available at Prototype Factory"* —
   instead of opening the real menu, so the flow is testable before items are final.

**Consequence:** the existing `itGauss` (Rorsch) and `itMoac` (RMG) buy-menu rows move
out of the global Weapons/Equipment/Addons tabs into factory-specific menus.

---

## §5 — Removed from this allocation

These were proposed by me and **rejected by the user**. Do not re-add them.

| Rejected item | Why |
|---|---|
| SpawnPoint ObjIds (was `1100–1299`) | Engine manages attached spawn points |
| Bunker purchase terminal (was `1400–1499`) | Bunkers are captured, not purchased |
| Command Post CapturePoint (was `5000–5099`) | **Command posts do not exist in this mode.** I fabricated them — they are not in the Crysis source material. |
| Command Post WorldIcon (was `5100–5199`) | Same as above |
| Command Post AreaTrigger (was `5200–5299`) | Same as above |
| "Command Post bonus" (was `7000–7099`) | Same as above |
| Proto Factory terminal (was `3200–3299`) | Buy menu is Portal-Gadget driven |
| Proto Factory AreaTrigger — *charge-rate zone* as separate range | Merged into `3000–3099`; one trigger serves capture **and** buy-menu presence |
| Turret LOS marker (was `6500–6599`) | Replaced by an in-zone notification |

---

## §6 — Open items requiring in-game verification

Flagged honestly, not hidden. Both may change the layout above.

### 6.1 `UnspawnObject` on a Godot-*placed* emplacement
`mod.UnspawnObject(obj: mod.Object)` (33227) accepts any Object-union member, so
`EmplacementSpawner` typechecks. **But its doc says "Unspawn an Object spawned using
`SpawnObject`"** — so whether it removes a *placed* (scene-authored) emplacement is
**unverified**. There is no `Enable*`/`Disable*` API for any spawner, so this is the only
removal path.

- If it works: no 72xx VFX needed.
- If it fails: reveal the 72xx `SpatialObject` and accept the emplacement visual remains.
- **Test early — it gates turret destruction entirely.** *(Moot since the turrets were retired.)*

### 6.2 WorldIcon parent anchor
`mod.AddUIIcon(parentObject, image, verticalOffset, iconColour, iconText, visibility)`
(33658 / 33668) needs a **world-positioned** parent. `AreaTrigger` *is* in the Object
union, but a volume's "position" semantics are unconfirmed.

- Plan: anchor each icon to its building's `AreaTrigger` (placed centred on the building).
- **Fallback:** add a `SpatialObject` anchor per building and re-parent.
- **Test early** — affects every icon in the game.

### 6.3 Kill-zone UI
No LOS marker object. A human entering a live enemy rocket site's kill zone
(`8x00`) gets the feed warning **"ENEMY ROCKET SITE - leave now!"**

---

## §7 — Summary — what to place in Godot

| Place in Godot | Count | ObjIds |
|---|---|---|
| Bunker CapturePoint | as many bunkers as you build (Cryxis: 4–8) | 1000+ |
| Bunker WorldIcon | one per bunker | 1100+ |
| Energy Site AreaTrigger | 3 planned (2–4 allowed) | 2000+ |
| Energy Site WorldIcon | one per site | 2100+ |
| Proto Factory AreaTrigger | 1 per base | 3000+ |
| Proto Factory WorldIcon | 1 per base | 3100+ |
| War Factory AreaTrigger | 1 per base | 4000+ |
| War Factory WorldIcon | 1 per base | 4100+ |
| War Factory VehicleSpawner | garage slots | 4200+ |
| Aviation Factory AreaTrigger | 0–1 per base | 5000+ |
| Aviation WorldIcon | 0–1 per base | 5100+ |
| Aviation VehicleSpawner | hangar slots | 5200+ |
| Naval Factory AreaTrigger | 0–1 (water maps) | 6000+ |
| Naval WorldIcon | 0–1 | 6100+ |
| Naval VehicleSpawner | dock slots | 6200+ |
| HQ dummy SpatialObject | 1 per base | 7300+ |
| HQ explosion VFX | 1 per base | 7400+ |
| Rocket site (kill zone, animation zone, radar, silos) | 3 per team | 8100–8300, 8500–8700 |
| Bot navigation waypoint (tiny prop or WorldIcon) | where bot pathing is poor | 9000–9199 |

**Total reserved: 8 blocks: seven gameplay blocks of 20 slots per sub-block (~199 usable), plus the 200-slot waypoint block.**
