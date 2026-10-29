import type { Column, ColumnKind } from './doc';
import { SNAP, bounds, clamp, readingOrder, type Box } from './layout';

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

/** Under everything on the card, at its left edge: where a column placed by no point goes. */
export function below(cols: Column[], kind: ColumnKind): Box {
	const f = frame(cols);
	return cardBox(kind, f.h ? { x: f.x, y: f.y + f.h + SNAP } : { x: 0, y: 0 });
}

/** The first layout, once the table shows as cards: its columns stacked, if none has a box. */
export function stack(cols: Column[]): Column[] {
	if (cols.some((c) => c.box)) return cols;
	const out: Column[] = [];
	for (const c of cols) out.push({ ...c, box: below(out, c.kind) });
	return out;
}

/** A button carries its name already. */
export const labelled = (c: Column) => !c.hideLabel && c.kind !== 'button';
