// A map field: the rows of its `from` table as a tree, drawn left to right by depth. Each
// placed row has an entry in the field's `parents`, '' for a root; a row with none waits
// unplaced. The field's value is the current row's id.

import type { Doc, Field, Row } from './doc';
import { nameColumn, sourceOf, type Source } from './source';

/** A placed row: its column (depth) and its line in the drawing, in row heights. */
export type Spot = { row: Row; name: string; parent: string | null; depth: number; line: number };

export type Tree = { spots: Spot[]; unplaced: { row: Row; name: string }[]; lines: number };

export const mapSource = (doc: Doc, f: Pick<Field, 'from'>): Source | undefined =>
	sourceOf(doc, f.from);

export function nameIn(src: Source, row: Row): string {
	const key = nameColumn(src);
	const v = key && row.cells[key.id];
	return v === undefined || v === '' ? '' : String(v);
}

/**
 * The parent each placed row hangs from. One whose parent is gone, unplaced, or would
 * make a loop is a root, so a deleted row never hides its children.
 */
function parentsIn(rows: Row[], parents: Record<string, string>): Map<string, string | null> {
	const placed = new Set(rows.filter((r) => r.id in parents).map((r) => r.id));
	const up = new Map<string, string | null>();
	for (const id of placed) {
		const p = parents[id];
		up.set(id, p && placed.has(p) ? p : null);
	}
	for (const id of placed) {
		// Only a loop's own member is cut: a row hanging from one keeps its parent.
		const seen = new Set<string>();
		for (let p = up.get(id); p && !seen.has(p); p = up.get(p) ?? null) {
			if (p === id) {
				up.set(id, null);
				break;
			}
			seen.add(p);
		}
	}
	return up;
}

/** Leaves take a line each, in the table's row order; a parent sits level with its middle child. */
export function treeOf(src: Source, parents: Record<string, string> = {}): Tree {
	const up = parentsIn(src.rows, parents);
	const kids = new Map<string | null, Row[]>();
	for (const r of src.rows) {
		if (!up.has(r.id)) continue;
		const p = up.get(r.id)!;
		kids.set(p, [...(kids.get(p) ?? []), r]);
	}
	const spots: Spot[] = [];
	let next = 0;
	const place = (row: Row, depth: number): number => {
		const at = spots.length;
		spots.push({ row, name: nameIn(src, row), parent: up.get(row.id)!, depth, line: 0 });
		const below = (kids.get(row.id) ?? []).map((k) => place(k, depth + 1));
		spots[at].line = below.length ? (below[0] + below[below.length - 1]) / 2 : next++;
		return spots[at].line;
	};
	for (const r of kids.get(null) ?? []) place(r, 0);
	const unplaced = src.rows
		.filter((r) => !up.has(r.id))
		.map((row) => ({ row, name: nameIn(src, row) }));
	return { spots, unplaced, lines: next };
}

/** Whether `child` may hang from `parent` (null for a root): never from itself or below itself. */
export function canHang(
	parents: Record<string, string>,
	child: string,
	parent: string | null
): boolean {
	const seen = new Set<string>();
	for (let p = parent; p && !seen.has(p); p = parents[p] || null) {
		if (p === child) return false;
		seen.add(p);
	}
	return true;
}

/** The rows from a root down to `id`, which a press's mark follows. */
export function pathTo(tree: Tree, id: string): Set<string> {
	const by = new Map(tree.spots.map((s) => [s.row.id, s]));
	const path = new Set<string>();
	for (let s = by.get(id); s; s = s.parent ? by.get(s.parent) : undefined) path.add(s.row.id);
	return path;
}
