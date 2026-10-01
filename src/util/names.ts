// Widget naming + handle cache.
//
// Every widget this mod creates is registered here at creation time, together
// with the handle that the creation helper just resolved. Two consumers:
//
//   tNames/pNames  ordered per-owner lists, used to tear widgets down in reverse
//                  creation order (children before parents).
//   byName         flat name -> handle map, so repaint/hover/layout paths read a
//                  JS property instead of paying mod.FindUIWidgetWithName.
//
// The map is authoritative and must be updated on EVERY delete, not just on
// teardown: a cached handle for a destroyed widget stays truthy, whereas
// FindUIWidgetWithName would have returned falsy and the caller would skip the
// write. Forget the name at the same time the widget is deleted.

export interface PshRef {
    n: string;
    w: mod.UIWidget;
    // Tab index this widget belongs to, or -1 for the menu shell. Set so a tab
    // panel teardown can drop exactly its own descendants from the menu list.
    tab?: number;
}

export const tNames: { [t: number]: PshRef[] } = {};
export const pNames: { [id: number]: PshRef[] } = {};

// Widgets created while a buy menu is being built, split out from the persistent
// HUD so closing the menu can delete the menu without touching the HUD.
export const pMenuNames: { [id: number]: PshRef[] } = {};
// A separate flag, NOT a sentinel id. Player ObjIds start at 0, so a "no build"
// sentinel of 0 matched the real player 0 and silently filed that player's
// entire HUD as menu widgets - dropMenu then deleted the prestige ring the
// first time the menu closed. A boolean cannot collide with any id.
let inMenuBuild: boolean = false;
let menuBuildOwner: number = 0;
let menuBuildTab: number = -1;

// Called around the buy-menu and tab-row build functions. Synchronous, so plain
// markers are enough; trackP files widgets under the menu list while they are
// set, tagged with the tab they belong to.
export function beginMenuBuild(id: number, tab: number = -1): void {
    inMenuBuild = true;
    menuBuildOwner = id;
    menuBuildTab = tab;
}

export function endMenuBuild(): void {
    inMenuBuild = false;
    menuBuildOwner = 0;
    menuBuildTab = -1;
}

const byName: { [n: string]: mod.UIWidget } = {};

export function tn(team: number, s: string): string {
    return "pst" + team + "_" + s;
}

export function pn(id: number, s: string): string {
    return "psh" + id + "_" + s;
}

export function trackT(team: number, name: string, w: mod.UIWidget): void {
    if (!tNames[team]) {
        tNames[team] = [];
    }
    tNames[team].push({ n: name, w: w });
    byName[name] = w;
}

export function trackP(id: number, name: string, w: mod.UIWidget): void {
    if (!pNames[id]) {
        pNames[id] = [];
    }
    pNames[id].push({ n: name, w: w });
    if (inMenuBuild && menuBuildOwner === id) {
        if (!pMenuNames[id]) {
            pMenuNames[id] = [];
        }
        pMenuNames[id].push({ n: name, w: w, tab: menuBuildTab });
    }
    byName[name] = w;
}

// Cached widget lookup. Falls back to a real search when a name is not
// registered, which keeps behaviour identical to the old Find-only code if a
// future creation path forgets to register (that costs one FFI, not a bug).
export function W(name: string): any {
    const hit: mod.UIWidget = byName[name];
    if (hit !== undefined) {
        return hit;
    }
    return mod.FindUIWidgetWithName(name);
}

// Drop a name from the cache. Call whenever the widget is deleted.
export function forget(name: string): void {
    delete byName[name];
}

// Drop every name starting with prefix. Used after deleting a parent container,
// where the engine may or may not have destroyed the children with it.
export function forgetPrefix(prefix: string): void {
    for (const k of Object.keys(byName)) {
        if (k.lastIndexOf(prefix, 0) === 0) {
            delete byName[k];
        }
    }
}

// Delete a player's menu widgets in reverse creation order, unregistering each
// one so no cached handle survives. Returns how many were deleted.
export function dropMenu(id: number): number {
    const refs: PshRef[] = pMenuNames[id] || [];
    let gone: number = 0;
    for (let i: number = refs.length - 1; i >= 0; i--) {
        try {
            if (refs[i].w) {
                mod.DeleteUIWidget(refs[i].w);
                gone++;
            }
        } catch (e) {
            // Already gone; the unregister below still has to happen.
        }
        delete byName[refs[i].n];
    }
    pMenuNames[id] = [];
    return gone;
}

// Forget the tracked refs for one tab without deleting anything. Called after a
// tab panel container is deleted, which takes its children with it, so the refs
// must not be left behind to accumulate on every page or tab switch.
export function forgetMenuTab(id: number, tab: number): void {
    const refs: PshRef[] = pMenuNames[id];
    if (refs === undefined) {
        return;
    }
    const keep: PshRef[] = [];
    for (let i: number = 0; i < refs.length; i++) {
        if (refs[i].tab === tab) {
            delete byName[refs[i].n];
        } else {
            keep.push(refs[i]);
        }
    }
    pMenuNames[id] = keep;
}
