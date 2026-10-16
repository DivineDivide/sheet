import type { Field, Kind } from './doc';

// Columns and row slots, not pixels. Rows take the height of their content in play, so
// a long backstory pushes the next row down instead of being clipped.
export const COLS = 12;
export const MAX_H = 8;

export type Box = { x: number; y: number; w: number; h: number };

const narrow: readonly Kind[] = ['number', 'resource', 'track'];
export const defaultWidth = (kind: Kind) => (narrow.includes(kind) ? 4 : COLS);

const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function clamp(b: Box): Box {
	const w = Math.min(Math.max(1, Math.round(b.w)), COLS);
	return {
		x: Math.min(Math.max(0, Math.round(b.x)), COLS - w),
		y: Math.max(0, Math.round(b.y)),
		w,
		h: Math.min(Math.max(1, Math.round(b.h)), MAX_H)
	};
}

/** Lifts each box as high as it goes without overlapping one already settled. */
function settle(order: string[], boxes: Map<string, Box>, fixed: Box[] = []) {
	const placed = [...fixed];
	for (const id of order) {
		const b = { ...boxes.get(id)!, y: 0 };
		let hit: Box | undefined;
		while ((hit = placed.find((p) => overlaps(p, b)))) b.y = hit.y + hit.h;
		boxes.set(id, b);
		placed.push(b);
	}
}

const byPosition = (boxes: Map<string, Box>) => (a: string, b: string) => {
	const p = boxes.get(a)!;
	const q = boxes.get(b)!;
	return p.y - q.y || p.x - q.x;
};

/**
 * Every field's box. A field saved before the builder existed has none; those flow in
 * field order below the rest, full width unless they hold a single number. Then
 * everything floats up, so the layout never has holes or overlaps.
 */
export function resolve(fields: Field[]): Map<string, Box> {
	const boxes = new Map<string, Box>();
	let bottom = 0;
	for (const f of fields) {
		if (!f.box) continue;
		const b = clamp(f.box);
		boxes.set(f.id, b);
		bottom = Math.max(bottom, b.y + b.h);
	}
	let x = 0;
	let rowH = 0;
	for (const f of fields) {
		if (f.box) continue;
		const w = defaultWidth(f.kind);
		if (x + w > COLS) {
			bottom += rowH;
			x = 0;
			rowH = 0;
		}
		boxes.set(f.id, { x, y: bottom, w, h: 1 });
		x += w;
		rowH = 1;
	}
	settle([...boxes.keys()].sort(byPosition(boxes)), boxes);
	return boxes;
}

/**
 * The layout after one field moves or resizes to `to`. That field holds its target
 * while the others settle around it, then everything floats up. Holding it is what
 * lets a field move one row down past a neighbour instead of floating straight back.
 */
export function place(fields: Field[], id: string, to: Box): Map<string, Box> {
	const boxes = resolve(fields);
	const target = clamp(to);
	boxes.set(id, target);
	const others = [...boxes.keys()].filter((k) => k !== id).sort(byPosition(boxes));
	settle(others, boxes, [target]);
	settle([...boxes.keys()].sort(byPosition(boxes)), boxes);
	return boxes;
}

/** Top to bottom, then left to right: the order fields stack in on a narrow screen. */
export const readingOrder = (boxes: Map<string, Box>) => [...boxes.keys()].sort(byPosition(boxes));
