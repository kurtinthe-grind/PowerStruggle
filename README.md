# Power Struggle

A Battlefield 6 Portal game mode (TypeScript) inspired by Crysis Wars' Power
Struggle. Two teams, **NATO (team 1)** and **PAX (team 2)**, fight over bunkers,
energy sites and factories. Holding them earns prestige and powers up the
Prototype Factory. The match is won by blowing up the enemy HQ with the Rorsch
railgun.

> Status: work in progress on a test map (`PS_Isolated`). Numbers below are
> testing values from `src/config.ts` and will be tuned.

## How a match plays

### 1. Capture the map

| Objective | How it's captured | What it gives |
|---|---|---|
| **Bunkers** (3) | Native Conquest capture point (20 s) | A forward spawn in the normal deploy menu; 150 prestige |
| **Energy sites** (3) | Stand in the area; custom capture (20 s) | Charges your Prototype Factory; 200 prestige |
| **Prototype Factory** (1) | Custom capture | Required for your team's power to charge at all |
| **War / Aviation / Naval factories** | Custom capture | Lets your team buy vehicles there; 250 prestige |

Custom captures work like Crysis: only one team in the area advances the bar,
the other team's progress decays, and a contested area freezes. Only the players
standing in the area when it flips get paid.

### 2. Earn prestige and spend it

Prestige is the spendable currency: kills (50), assists (25) and captures
(above). The scoreboard score is tracked separately and can't be spent.

The **buy menu** opens from the Portal gadget and has these tabs:

- **Weapons**: prototype tier (MOAC, ...) and standard tier (Gauss rifle = the
  Rorsch Mk 2, ...).
- **Equipment** and **Add-ons**: tools, ammo, scopes.
- **Factory**: buy a vehicle at a factory your team owns. It spawns on a free
  vehicle spawner slot, or you're told to try again later.
- **Tactical**: a list of every strategic location showing Friendly / Enemy /
  Neutral. Picking one highlights its world icon for you only.

### 3. Charge power

A team that owns the **Prototype Factory** charges its **Power Level** from 0 to
100%. Each energy site it holds speeds this up (1.5× per site; 0 sites = no
charge). Both teams are told when either side passes 50%, 75% and 100%.

### 4. Break the base

Each HQ is guarded by a line of **AA turrets**. Walking into a turret's zone
gives you a 3-second warning, then kills you.

The **Rorsch** charges for about 2 seconds and fires a hitscan shot. Fired from
the attack zone, the shot:

- **destroys any enemy turret** it passes through. Destroying 3 turrets next to
  each other opens a line of sight to the HQ;
- **damages the enemy HQ** when it lands near it. 3 hits (100 → 67 → 33 → 0%)
  destroy it, and that team **loses the match**.

## Bots

Each team is filled with 24 script-controlled bots (`src/bots*.ts`). Every few
seconds each bot scores every objective and picks one:

- **attack** anything its team doesn't own;
- **defend** an owned objective with enemies nearby;
- **hold** a safe one for a while, then **roam** to another.

Bots heading to the same place count against it, so the team spreads out. A bot
that can't reach an objective skips it for 90 s. When shot, a bot fights for
10 s, then goes back to its objective. Bots with a long trip will get into an
empty vehicle nearby and get out near their objective.

## Project layout

| Path | What it is |
|---|---|
| `src/index.ts` | Entry point: HUD, buy menu, events |
| `src/capture.ts`, `energy.ts`, `factory.ts` | Custom capture, energy sites, power charge |
| `src/spawns.ts` | Bunker capture points and spawning |
| `src/turrets.ts`, `nuke.ts`, `rorschshot.ts`, `raygeom.ts` | Turret zones, Rorsch shot detection and hit tests |
| `src/winner.ts` | End-of-match rules |
| `src/bots.ts`, `botbrain.ts`, `botscore.ts`, `botobjectives.ts` | Bot AI |
| `src/objids.ts` | The map's object IDs (see `PS_ObjIds.md`) |
| `src/config.ts` | Every tunable number |
| `src/strings.json` | All on-screen text |
| `PS_Isolated.tscn` / `.spatial.json` | The Godot test map and its Portal export |
| `scripts/` | Node unit tests for the pure modules, and the build guard |
| `dist/` | Built output to upload to Portal |

## Building

The build expects this folder to sit next to `main_resources/` (the Portal SDK
type definitions and `bf6-portal-utils`), as in the original workspace.

```bash
npm install
npm run build
```

`npm run build` runs the source guard and unit tests, type-checks, bundles, and
type-checks the bundle. Upload `dist/bundle.ts` and `dist/bundle.strings.json`
to the Portal web editor together with the map export.

## Credits

- [**bf6-portal-utils**](https://github.com/deluca-mike/bf6-portal-utils) by
  deluca-mike: the utility library this mode is built on (events, timers,
  logging, performance stats, callback handler, player locations, vectors and the
  player undeploy fixer).
- [**bf6-portal-bots-brain**](https://github.com/nikgodda/bf6-portal-bots-brain/tree/main)
  by nikgodda: ideas behind the bot AI, in particular handing a shot bot to the
  combat AI for a short time and steering bot-driven vehicles toward an objective.
