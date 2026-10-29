import type { Column, ColumnKind, Field } from './doc';
import { GAP, SNAP, bounds, clamp, hits, readingOrder, type Box } from './layout';

// A table shown as cards (`Field.cards`). Each column on them has a box, in px on the card,
// and every card of the table is the smallest frame around those boxes.

const WIDTH = 240;
/** A name over one line of value fits 56; a button carries no name. */
const heights: Partial<Record<ColumnKind, number>> = { button: 48, image: 136 };

export type Placed = Column & { box: Box };

/** A new column's box: its kind's size, at `at`. */
export const cardBox = (kind: ColumnKind, at: { x: number; y: number }): Box =>
	clamp({ ...at, w: WIDTH, h: heights[kind] ?? 56 });

/** The columns on the card, in reading order, so Tab goes through them as they read. */
export const placed = (cols: Column[]) =>
	readingOrder(cols.filter((c): c is Placed => c.box !== undefined));

export const frame = (cols: Column[]) => bounds(placed(cols).map((c) => c.box));

/**
 * The largest frame a card may have inside its field's padding: the card's own padding and
 * the field's, label included, measured on the page and rounded up to SNAP.
 */
export const room = (f: Pick<Field, 'box' | 'hideLabel'>) => ({
	w: f.box.w - 40,
	h: f.box.h - (f.hideLabel ? 40 : 64)
});

/** Past `n` by a gap, on a whole dot, so the chat reads every spot in whole dots. */
const past = (n: number) => Math.ceil((n + SNAP) / GAP) * GAP;

/**
 * Where a column placed by no point goes: the first free spot right of a box, while the
 * card stays within `width`, else under everything at its left edge.
 */
export function spot(cols: Column[], kind: ColumnKind, width = 0): Box {
	const on = placed(cols).map((c) => c.box);
	const f = bounds(on);
	const right = on
		.map((b) => cardBox(kind, { x: past(b.x + b.w), y: b.y }))
		.filter((b) => b.x + b.w <= f.x + width && !on.some((o) => hits(o, b)))
		.sort((a, b) => a.y - b.y || a.x - b.x);
	return right[0] ?? cardBox(kind, on.length ? { x: f.x, y: past(f.y + f.h) } : { x: 0, y: 0 });
}

/** The first layout, once the table shows as cards, if no column has a box: in rows `width` wide. */
export function lay(cols: Column[], width = 0): Column[] {
	if (cols.some((c) => c.box)) return cols;
	const out: Column[] = [];
	for (const c of cols) out.push({ ...c, box: spot(out, c.kind, width) });
	return out;
}

/** A button carries its name already. */
export const labelled = (c: Column) => !c.hideLabel && c.kind !== 'button';
