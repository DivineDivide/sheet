// A resource drawn as a bar (`bar` on a field or column): pressed or dragged along to set
// its current value.
import type { Resource } from './doc';

/** The current that a press `x` px along a bar `w` px wide sets: a whole step, 0 to `max`. */
export const curAt = (x: number, w: number, max: number) =>
	max > 0 && w > 0 ? Math.min(max, Math.max(0, Math.round((x / w) * max))) : 0;

/** How full the bar shows, 0 to 100, even for a current past either end. */
export const fullness = (r: Resource) =>
	r.max > 0 ? Math.min(100, Math.max(0, (r.cur / r.max) * 100)) : 0;

const keys: Record<string, (cur: number, max: number) => number> = {
	ArrowRight: (cur) => cur + 1,
	ArrowUp: (cur) => cur + 1,
	ArrowLeft: (cur) => cur - 1,
	ArrowDown: (cur) => cur - 1,
	Home: () => 0,
	End: (_, max) => max
};

/** The current a key moves a focused bar to, 0 to `max` as a press sets; undefined for another key. */
export function curFor(key: string, cur: number, max: number): number | undefined {
	const to = keys[key];
	return to && (max > 0 ? Math.min(max, Math.max(0, to(cur, max))) : 0);
}
