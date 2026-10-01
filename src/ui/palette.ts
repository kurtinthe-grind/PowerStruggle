export const C_BLUE: mod.Vector = mod.CreateVector(0.3, 0.8, 1.0);
export const C_RED: mod.Vector = mod.CreateVector(1.0, 0.28, 0.28);
export const C_GOLD: mod.Vector = mod.CreateVector(1.0, 0.78, 0.28);
export const C_PLAT: mod.Vector = mod.CreateVector(0.79, 0.81, 0.84);
export const C_DARK: mod.Vector = mod.CreateVector(0.22, 0.26, 0.29);
export const C_BLACK: mod.Vector = mod.CreateVector(0.0, 0.0, 0.0);

export const FEED_WHITE: mod.Vector = mod.CreateVector(0.9, 0.93, 0.95);
export const FEED_RED: mod.Vector = mod.CreateVector(0.95, 0.26, 0.2);
export const FEED_YEL: mod.Vector = mod.CreateVector(0.95, 0.85, 0.3);
export const FEED_GRN: mod.Vector = mod.CreateVector(0.45, 0.9, 0.5);
export const FEED_BLU: mod.Vector = mod.CreateVector(0.45, 0.72, 1.0);

export const MENU_BG: mod.Vector = mod.CreateVector(0.028, 0.055, 0.032);
export const MENU_EDGE: mod.Vector = mod.CreateVector(0.35, 0.45, 0.28);
export const MENU_TITLE: mod.Vector = mod.CreateVector(0.86, 0.9, 0.82);
export const MENU_COST: mod.Vector = mod.CreateVector(0.85, 0.8, 0.25);
export const MENU_LOCKTXT: mod.Vector = mod.CreateVector(0.45, 0.5, 0.45);
export const MENU_HEAD: mod.Vector = mod.CreateVector(0.1, 0.16, 0.09);

export const MENU_TXT: mod.Vector = mod.CreateVector(0.85, 0.96, 0.78);

export const MENU_ORANGE_SEL: mod.Vector = mod.CreateVector(0.96, 0.71, 0.26);

export const MENU_ORANGE_HOVER: mod.Vector = mod.CreateVector(1.0, 0.56, 0.14);

export const MENU_HOVER: mod.Vector = mod.CreateVector(0.35, 0.48, 0.24);
export const MENU_PRESS: mod.Vector = mod.CreateVector(0.22, 0.32, 0.15);

export const MENU_TAB_PRESS: mod.Vector = MENU_ORANGE_SEL;
export const MENU_TAB_HOVER: mod.Vector = MENU_ORANGE_HOVER;

export const P_RING: mod.Vector = mod.CreateVector(0.45, 0.63, 0.34);

export function colorFor(me: number, team: number): mod.Vector {
    if (team === me) {
        return C_BLUE;
    }
    if (team === 0) {
        return C_DARK;
    }
    return C_RED;
}

// lighten used to cost 3 X/Y/ZComponentOf FFI plus a CreateVector on every call,
// and it runs inside the tint commit path. The palette is a fixed set of known
// constants, so each lightened variant is built once here and the FFI is paid at
// module load instead of per repaint. Compared by identity, so no Map or keyed
// lookup is needed.
const LIFT: number = 0.32;

function liftOf(x: number, y: number, z: number): mod.Vector {
    return mod.CreateVector(
        Math.min(1, x + LIFT),
        Math.min(1, y + LIFT),
        Math.min(1, z + LIFT)
    );
}

const C_BLUE_L: mod.Vector = liftOf(0.3, 0.8, 1.0);
const C_RED_L: mod.Vector = liftOf(1.0, 0.28, 0.28);
const C_DARK_L: mod.Vector = liftOf(0.22, 0.26, 0.29);
const C_GOLD_L: mod.Vector = liftOf(1.0, 0.78, 0.28);
const C_PLAT_L: mod.Vector = liftOf(0.79, 0.81, 0.84);
const C_BLACK_L: mod.Vector = liftOf(0.0, 0.0, 0.0);

export function lighten(c: mod.Vector): mod.Vector {
    if (c === C_BLUE) {
        return C_BLUE_L;
    }
    if (c === C_RED) {
        return C_RED_L;
    }
    if (c === C_DARK) {
        return C_DARK_L;
    }
    if (c === C_GOLD) {
        return C_GOLD_L;
    }
    if (c === C_PLAT) {
        return C_PLAT_L;
    }
    if (c === C_BLACK) {
        return C_BLACK_L;
    }
    // Not a palette constant: rare and off the repaint path, so pay the FFI read
    // rather than risk returning the wrong colour.
    return mod.CreateVector(
        Math.min(1, mod.XComponentOf(c) + LIFT),
        Math.min(1, mod.YComponentOf(c) + LIFT),
        Math.min(1, mod.ZComponentOf(c) + LIFT)
    );
}
