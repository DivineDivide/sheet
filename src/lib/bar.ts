// A resource drawn as a bar (`bar` on a field or column): pressed or dragged along to set
// its current value.
import type { Resource } from './doc';

/** The current that a press `x` px along a bar `w` px wide sets: a whole step, 0 to `max`. */
export const curAt = (x: number, w: number, max: number) =>
	max > 0 && w > 0 ? Math.min(max, Math.max(0, Math.round((x / w) * max))) : 0;

/** How full the bar shows, 0 to 100, even for a current past either end. */
export const fullness = (r: Resource) =>
	r.max > 0 ? Math.min(100, Math.max(0, (r.cur / r.max) * 100)) : 0;
