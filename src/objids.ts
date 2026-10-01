export interface TurretDef {
    emplId: number;
    zoneId: number;
    vfxId: number;
    base: 1 | 2;
    cluster: number;
    yOffset: number;
}

export interface AreaBuildingDef {
    id: string;
    kind: "energy" | "proto" | "war" | "air" | "naval";
    areaTriggerId: number;
    worldIconId: number;
    vehicleSpawnerId: number;
    vehicleSpawnerIds: number[];
    factoryName: string;
}

export interface BunkerDef {
    id: string;
    capturePointId: number;
    worldIconId: number;
}

export const BUNKERS: BunkerDef[] = [
    { id: "bunker1", capturePointId: 1000, worldIconId: 1100 },
    { id: "bunker2", capturePointId: 1001, worldIconId: 1101 },
    { id: "bunker3", capturePointId: 1002, worldIconId: 1102 }
];

export const ENERGY_SITES: AreaBuildingDef[] = [
    { id: "site1", kind: "energy", areaTriggerId: 2000, worldIconId: 2100, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Energy Site 1" },
    { id: "site2", kind: "energy", areaTriggerId: 2001, worldIconId: 2101, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Energy Site 2" },
    { id: "site3", kind: "energy", areaTriggerId: 2002, worldIconId: 2102, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Energy Site 3" }
];

export const PROTO_FACTORY: AreaBuildingDef[] = [
    { id: "proto1", kind: "proto", areaTriggerId: 3000, worldIconId: 3100, vehicleSpawnerId: 0, vehicleSpawnerIds: [], factoryName: "Prototype Factory" }
];

export const WAR_FACTORY: AreaBuildingDef[] = [
    { id: "war1", kind: "war", areaTriggerId: 4000, worldIconId: 4100, vehicleSpawnerId: 4200, vehicleSpawnerIds: [4200, 4201, 4202], factoryName: "War Factory 1" },
    { id: "war2", kind: "war", areaTriggerId: 4001, worldIconId: 0, vehicleSpawnerId: 4204, vehicleSpawnerIds: [4204], factoryName: "War Factory 2" }
];

export const AIR_FACTORY: AreaBuildingDef[] = [
    { id: "air1", kind: "air", areaTriggerId: 5000, worldIconId: 5100, vehicleSpawnerId: 5200, vehicleSpawnerIds: [5200, 5201], factoryName: "Aviation Factory" }
];

export const NAVAL_FACTORY: AreaBuildingDef[] = [
    { id: "naval1", kind: "naval", areaTriggerId: 6000, worldIconId: 6100, vehicleSpawnerId: 6200, vehicleSpawnerIds: [6200, 6201], factoryName: "Naval Factory 1" },
    { id: "naval2", kind: "naval", areaTriggerId: 6001, worldIconId: 6101, vehicleSpawnerId: 6202, vehicleSpawnerIds: [6202, 6203], factoryName: "Naval Factory 2" }
];

export const TURRETS: TurretDef[] = [
    { emplId: 7000, zoneId: 7100, vfxId: 7200, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7001, zoneId: 7101, vfxId: 7201, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7002, zoneId: 7102, vfxId: 7202, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7003, zoneId: 7103, vfxId: 7203, base: 1, cluster: 0, yOffset: 15.267723 },
    { emplId: 7004, zoneId: 7104, vfxId: 7204, base: 2, cluster: 1, yOffset: 15.267723 },
    { emplId: 7005, zoneId: 7105, vfxId: 7205, base: 2, cluster: 1, yOffset: 15.267723 },
    { emplId: 7006, zoneId: 7106, vfxId: 7206, base: 2, cluster: 1, yOffset: 15.267723 },
    { emplId: 7007, zoneId: 7107, vfxId: 7207, base: 2, cluster: 1, yOffset: 15.267723 }
];

export const HQ_TARGETS: number[] = [7300, 7301];
export const HQ_EXPLOSION: number[] = [7400, 7401];
export const HQ_GATES: number[] = [7500, 7501];
export const HQ_OBJIDS: number[] = [1, 2];

export const DEFERRED_SLOTS: { what: string; note: string }[] = [
    { what: "war2.worldIconId", note: "duplicate ObjId 4100 - two War Factory WorldIcons share it; left 0" },
    { what: "war2.vehicleSpawnerIds[0]", note: "duplicate ObjId 4203 - left unbound, war2 uses 4204 only" },
    { what: "air1.vehicleSpawnerIds[2]", note: "duplicate ObjId 5201 - air1 binds 5200 and 5201 only" }
];

export function isConfigured(objId: number): boolean {
    return objId > 0;
}

export interface AiSpawnerDef {
    spawnerId: number;
    team: 1 | 2;
}

// 8000-8099: AI_SPAWNERS for the custom bot population. The AI_Spawner prefab
// exposes only ObjId and AlternateSpawns in Godot - team, class mix, count
// and respawn are all script-owned in src/bots.ts. Two spawners per team so a
// single spawner position never funnels all 24 bots through one doorway.
// Reserve the whole 8000 block for future spawner slots.
//
// No extra spawners are needed at the bunkers. Following CustomConquest V15's
// AI_ObjectiveSpawn, bots that spawn onto a friendly objective are moved there
// with mod.Teleport against the objective's cached position, rather than
// requiring an AI_Spawner object per bunker.
export const AI_SPAWNERS: AiSpawnerDef[] = [
    { spawnerId: 8000, team: 1 },
    { spawnerId: 8001, team: 1 },
    { spawnerId: 8010, team: 2 },
    { spawnerId: 8011, team: 2 }
];

export function allAreaBuildings(): AreaBuildingDef[] {
    return ENERGY_SITES.concat(PROTO_FACTORY, WAR_FACTORY, AIR_FACTORY, NAVAL_FACTORY);
}

export function factoryBuildings(): AreaBuildingDef[] {
    return PROTO_FACTORY.concat(WAR_FACTORY, AIR_FACTORY, NAVAL_FACTORY);
}

export function buildingDefById(id: string): AreaBuildingDef | undefined {
    for (const a of allAreaBuildings()) {
        if (a.id === id) {
            return a;
        }
    }
    return undefined;
}
