export const RORSCH: mod.Weapons = mod.Weapons.BattlePickup_Rorsch_Mk_2_SMRW;
export const MOAC: mod.Weapons = mod.Weapons.BattlePickup_MP_RMG;

export const PRIMARIES: mod.Weapons[] = [
    mod.Weapons.BattlePickup_Rorsch_Mk_2_SMRW,
    mod.Weapons.BattlePickup_MP_RMG,
    mod.Weapons.AssaultRifle_AK4D,
    mod.Weapons.AssaultRifle_B36A4,
    mod.Weapons.AssaultRifle_KORD_6P67,
    mod.Weapons.AssaultRifle_L85A3,
    mod.Weapons.AssaultRifle_M16A4,
    mod.Weapons.AssaultRifle_M433,
    mod.Weapons.AssaultRifle_NVO_228E,
    mod.Weapons.AssaultRifle_SOR_556_Mk2,
    mod.Weapons.AssaultRifle_TR_7,
    mod.Weapons.AssaultRifle_VCR_2,
    mod.Weapons.Carbine_M4A1,
    mod.Weapons.Carbine_AK_205,
    mod.Weapons.Carbine_GRT_BC,
    mod.Weapons.Carbine_M277,
    mod.Weapons.Carbine_M417_A2,
    mod.Weapons.Carbine_QBZ_192,
    mod.Weapons.Carbine_SG_553R,
    mod.Weapons.Carbine_SOR_300SC,
    mod.Weapons.DMR_GRT_CPS,
    mod.Weapons.DMR_LMR27,
    mod.Weapons.DMR_M39_EMR,
    mod.Weapons.DMR_SVDM,
    mod.Weapons.DMR_SVK_86,
    mod.Weapons.LMG_DRS_IAR,
    mod.Weapons.LMG_KTS100_MK8,
    mod.Weapons.LMG_L110,
    mod.Weapons.LMG_M_60,
    mod.Weapons.LMG_M121_A2,
    mod.Weapons.LMG_M123K,
    mod.Weapons.LMG_M240L,
    mod.Weapons.LMG_M250,
    mod.Weapons.LMG_RPK_74M,
    mod.Weapons.LMG_RPKM,
    mod.Weapons.Shotgun__185KS_K,
    mod.Weapons.Shotgun_DB_12,
    mod.Weapons.Shotgun_M1014,
    mod.Weapons.Shotgun_M87A1,
    mod.Weapons.SMG_CZ3A1,
    mod.Weapons.SMG_KV9,
    mod.Weapons.SMG_PP_19,
    mod.Weapons.SMG_PW5A3,
    mod.Weapons.SMG_PW7A2,
    mod.Weapons.SMG_SCW_10,
    mod.Weapons.SMG_SGX,
    mod.Weapons.SMG_SL9,
    mod.Weapons.SMG_UMG_40,
    mod.Weapons.SMG_USG_90,
    mod.Weapons.Sniper_L115,
    mod.Weapons.Sniper_M2010_ESR,
    mod.Weapons.Sniper_Mini_Scout,
    mod.Weapons.Sniper_PSR,
    mod.Weapons.Sniper_SV_98
];

export const SECONDARIES: mod.Weapons[] = [
    mod.Weapons.Sidearm_M45A1,
    mod.Weapons.Sidearm_ES_57,
    mod.Weapons.Sidearm_GGH_22,
    mod.Weapons.Sidearm_M357_Trait,
    mod.Weapons.Sidearm_M44,
    mod.Weapons.Sidearm_P18,
    mod.Weapons.Sidearm_VZ_61
];

export function weaponName(w: mod.Weapons | undefined): string {
    if (w === undefined) {
        return "none";
    }
    for (const e of PRIMARIES) {
        if (mod.Equals(e, w)) {
            return "P:" + primNames[PRIMARIES.indexOf(e)];
        }
    }
    for (const e of SECONDARIES) {
        if (mod.Equals(e, w)) {
            return "S:" + secNames[SECONDARIES.indexOf(e)];
        }
    }
    return "[Weapons]";
}

const primNames: string[] = [
    "Rorsch", "RMG", "AR_AK4D", "AR_B36A4", "AR_KORD", "AR_L85A3", "AR_M16A4", "AR_M433",
    "AR_NVO", "AR_SOR556", "AR_TR7", "AR_VCR2",
    "C_AK205", "C_GRTBC", "C_M277", "C_M417A2", "C_M4A1", "C_QBZ192", "C_SG553R", "C_SOR300",
    "D_GRTCPS", "D_LMR27", "D_M39EMR", "D_SVDM", "D_SVK86",
    "L_DRSIAR", "L_KTS100", "L_L110", "L_M60", "L_M121A2", "L_M123K", "L_M240L", "L_M250",
    "L_RPK74M", "L_RPKM",
    "Sh_185KS", "Sh_DB12", "Sh_M1014", "Sh_M87A1",
    "SM_CZ3A1", "SM_KV9", "SM_PP19", "SM_PW5A3", "SM_PW7A2", "SM_SCW10", "SM_SGX", "SM_SL9",
    "SM_UMG40", "SM_USG90",
    "Sn_L115", "Sn_M2010", "Sn_MiniScout", "Sn_PSR", "Sn_SV98"
];

const secNames: string[] = [
    "M45A1", "ES_57", "GGH_22", "M357", "M44", "P18", "VZ_61"
];

export function GetCurrentWeaponInSlot(
    player: mod.Player | undefined,
    slot: mod.InventorySlots,
    weaponFilter?: mod.Weapons
): mod.Weapons | undefined {
    if (!player) {
        return undefined;
    }

    const mapToSearch: mod.Weapons[] = slot === mod.InventorySlots.PrimaryWeapon ? PRIMARIES : SECONDARIES;
    for (const weaponEnum of mapToSearch) {
        if (weaponFilter !== undefined && mod.Equals(weaponEnum, weaponFilter)) {
            continue;
        }
        if (mod.HasEquipment(player, weaponEnum)) {
            return weaponEnum;
        }
    }

    const otherMap: mod.Weapons[] = slot === mod.InventorySlots.PrimaryWeapon ? SECONDARIES : PRIMARIES;
    for (const weaponEnum of otherMap) {
        if (weaponFilter !== undefined && mod.Equals(weaponEnum, weaponFilter)) {
            continue;
        }
        if (mod.HasEquipment(player, weaponEnum)) {
            return weaponEnum;
        }
    }
    return undefined;
}

export function heldWeapon(player: mod.Player): mod.Weapons | undefined {
    const sec = GetCurrentWeaponInSlot(player, mod.InventorySlots.SecondaryWeapon);
    return GetCurrentWeaponInSlot(player, mod.InventorySlots.PrimaryWeapon, sec);
}

export function isRorschInHand(player: mod.Player): boolean {
    return mod.HasEquipment(player, RORSCH);
}

// The Rorsch is carried and no ordinary weapon is in hand. The Rorsch is a
// battle pickup, not a slot item: while it is held IsInventorySlotActive is
// false for every slot (test 2026-10-03: pri/sec/misc all false), so ownership
// can only be HasEquipment. A sidearm in hand is still rejected, should the
// secondary slot report active while it is out.
export function isRorschActive(player: mod.Player): boolean {
    return mod.HasEquipment(player, RORSCH)
        && !mod.IsInventorySlotActive(player, mod.InventorySlots.SecondaryWeapon);
}

export function debugWeaponReport(player: mod.Player): string {
    const sec = GetCurrentWeaponInSlot(player, mod.InventorySlots.SecondaryWeapon);
    const full = GetCurrentWeaponInSlot(player, mod.InventorySlots.PrimaryWeapon, sec);
    const cheap = isRorschInHand(player);
    const rorschEq = mod.HasEquipment(player, RORSCH);
    return "held=" + weaponName(full)
        + " secondary=" + weaponName(sec)
        + " hasRorsch=" + String(rorschEq)
        + " inHand=" + String(cheap)
        + " agree=" + String((full === RORSCH) === cheap);
}
