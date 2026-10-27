// Reading version-1 files: layout lived on templates, on a 12-column grid whose rows
// took the height of their content. Kept only to migrate those files forward.

import { newId, type Clock, type Field, type Kind, type Value } from './doc';
import { GAP, defaultSize } from './layout';
import type { Status, V2Doc } from './v2';

type GridBox = { x: number; y: number; w: number; h: number };
type V1Field = { id: string; label: string; kind: Kind; box?: GridBox };
export type V1Doc = {
	version: 1;
	clocks: Clock[];
	templates: { id: string; name: string; fields: V1Field[] }[];
	characters: {
		id: string;
		name: string;
		template: string;
		values: Record<string, Value>;
		statuses: Status[];
	}[];
};

const COLS = 12;
// The old 12 columns become a 672px sheet, narrow enough to show whole on a laptop
// beside the roster and the side panel.
const COL = 56;

const overlaps = (a: GridBox, b: GridBox) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function clampGrid(b: GridBox): GridBox {
	const w = Math.min(Math.max(1, Math.round(b.w)), COLS);
	return {
		x: Math.min(Math.max(0, Math.round(b.x)), COLS - w),
		y: Math.max(0, Math.round(b.y)),
		w,
		h: Math.min(Math.max(1, Math.round(b.h)), 8)
	};
}

/** The grid as version 1 showed it: box-less fields flowed in, then everything floated up. */
export function resolveGrid(fields: V1Field[]): Map<string, GridBox> {
	const boxes = new Map<string, GridBox>();
	let bottom = 0;
	for (const f of fields) {
		if (!f.box) continue;
		const b = clampGrid(f.box);
		boxes.set(f.id, b);
		bottom = Math.max(bottom, b.y + b.h);
	}
	let x = 0;
	let rowH = 0;
	for (const f of fields) {
		if (f.box) continue;
		const w = ['number', 'resource', 'track'].includes(f.kind) ? 4 : COLS;
		if (x + w > COLS) {
			bottom += rowH;
			x = 0;
			rowH = 0;
		}
		boxes.set(f.id, { x, y: bottom, w, h: 1 });
		x += w;
		rowH = 1;
	}
	const order = [...boxes.keys()].sort((a, b) => {
		const p = boxes.get(a)!;
		const q = boxes.get(b)!;
		return p.y - q.y || p.x - q.x;
	});
	const placed: GridBox[] = [];
	for (const id of order) {
		const b = { ...boxes.get(id)!, y: 0 };
		let hit: GridBox | undefined;
		while ((hit = placed.find((p) => overlaps(p, b)))) b.y = hit.y + hit.h;
		boxes.set(id, b);
		placed.push(b);
	}
	return boxes;
}

/** Each grid row becomes as tall as the tallest one-row field starting in it. */
export function toFree(fields: V1Field[], tab: string): Field[] {
	const grid = resolveGrid(fields);
	const rows = Math.max(0, ...[...grid.values()].map((b) => b.y + b.h));
	const pitch = Array.from({ length: rows }, () => defaultSize('number').h + GAP);
	for (const f of fields) {
		const b = grid.get(f.id)!;
		if (b.h === 1) pitch[b.y] = Math.max(pitch[b.y], defaultSize(f.kind).h + GAP);
	}
	const top = (row: number) => pitch.slice(0, row).reduce((sum, n) => sum + n, 0);
	return fields.map((f) => {
		const b = grid.get(f.id)!;
		const y = top(b.y);
		return {
			id: f.id,
			label: f.label,
			kind: f.kind,
			tab,
			box: { x: b.x * COL, y, w: b.w * COL - GAP, h: top(b.y + b.h) - y - GAP }
		};
	});
}

/** Every character gets its own copy of its template's layout, on one tab. */
export function migrate(v1: V1Doc): V2Doc {
	const templates = v1.templates.map((t) => {
		const tab = { id: newId(), name: 'Main' };
		return { id: t.id, name: t.name, tabs: [tab], fields: toFree(t.fields, tab.id) };
	});
	return {
		version: 2,
		clocks: v1.clocks,
		templates,
		characters: v1.characters.map(({ template, ...c }) => {
			const t = templates.find((t) => t.id === template)!;
			return { ...c, ...structuredClone({ tabs: t.tabs, fields: t.fields }) };
		})
	};
}
