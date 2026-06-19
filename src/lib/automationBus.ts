// Module-level registry letting the benchmark automation drive UI that lives in component
// local state (which can't be reached through a store). Components register their setters
// on mount; the orchestrator calls the `drive*`/`get*` helpers. All are no-ops until the
// owning component has mounted, so the orchestrator must navigate + wait before using them.

let _setGenreMapOpen: ((open: boolean) => void) | null = null;
let _getTracksScroller: () => HTMLElement | null = () => null;

export function registerGenreMapSetter(fn: ((open: boolean) => void) | null) { _setGenreMapOpen = fn; }
export function setGenreMapOpen(open: boolean) { _setGenreMapOpen?.(open); }

export function registerTracksScroller(fn: () => HTMLElement | null) { _getTracksScroller = fn; }
export function getTracksScroller(): HTMLElement | null { return _getTracksScroller(); }
