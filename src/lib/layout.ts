import type { Field, Kind } from './doc';

// Pixels on the sheet, which runs on in every direction from 0,0 at its middle. Positions
// snap to SNAP so edges line up without a column grid.
export const SNAP = 8;
export const GAP = 16;
/** 3×3 of the sheet's 16px dots. */
export const MIN = { w: 48, h: 48 };

export type Box = { x: number; y: number; w: number; h: number };

const sizes: Record<Kind, Pick<Box, 'w' | 'h'>> = {
	number: { w: 160, h: 88 },
	resource: { w: 240, h: 88 },
	track: { w: 240, h: 88 },
	formula: { w: 160, h: 88 },
	button: { w: 160, h: 88 },
	text: { w: 480, h: 160 },
	choice: { w: 240, h: 88 },
	tags: { w: 480, h: 104 },
	entries: { w: 480, h: 240 },
	table: { w: 560, h: 240 },
	image: { w: 240, h: 240 },
	map: { w: 560, h: 320 }
};
export const defaultSize = (kind: Kind) => sizes[kind];

const snap = (n: number) => Math.round(n / SNAP) * SNAP;

export const clamp = (b: Box): Box => ({
	x: snap(b.x),
	y: snap(b.y),
	w: Math.max(MIN.w, snap(b.w)),
	h: Math.max(MIN.h, snap(b.h))
});

/** The smallest box around all of them; empty at 0,0 when there are none. */
export function bounds(boxes: Box[]): Box {
	if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	return {
		x,
		y,
		w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
		h: Math.max(...boxes.map((b) => b.y + b.h)) - y
	};
}

export const hits = (a: Box, b: Box) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Top to bottom, then left to right: the order fields and card columns stack in when narrow. */
export const readingOrder = <T extends { box: Box }>(items: T[]) =>
	[...items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

/**
 * Each field's top once every box has grown to `heights`. A field keeps its x and its gap
 * to each field above it that it overlaps sideways, so a box that grows pushes down only
 * what sits under it, not the whole sheet. A card's columns settle the same way.
 */
export function settle<T extends { id: string; box: Box }>(
	fields: T[],
	heights: Record<string, number>
) {
	const tops: Record<string, number> = {};
	// Reading order places everything above a field before the field itself.
	for (const f of readingOrder(fields)) {
		const above = fields.filter(
			(g) =>
				g.box.y + g.box.h <= f.box.y && g.box.x < f.box.x + f.box.w && f.box.x < g.box.x + g.box.w
		);
		tops[f.id] = Math.max(
			f.box.y,
			...above.map((g) => tops[g.id] + heights[g.id] + f.box.y - (g.box.y + g.box.h))
		);
	}
	return tops;
}
