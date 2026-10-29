// A table's rows drawn from another table, usually a GM-only character's: picked by its +,
// chosen in a choice column, or kept on a map's current node. Such a row follows its source
// row: after every change, its cells in the columns the source has too are the source's again.

import {
	globalId,
	newId,
	valueOf,
	type Cell,
	type Character,
	type Column,
	type Doc,
	type Field,
	type Row
} from './doc';
import { same } from './formula';
import { apply, equal, type Op } from './sync';

type Write = Exclude<Op, { k: 'order' }>;

/** A table anywhere in the room, by `globalId`, named with its character. */
export type Source = { id: string; name: string; columns: Column[]; rows: Row[] };

// JSON, not structuredClone: these run inside `session.change`, on the live state's proxies.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const rowsOf = (c: Character, f: Field): Row[] =>
	f.kind === 'table' && Array.isArray(c.values[f.id]) ? (c.values[f.id] as Row[]) : [];

/** Every table in the room, as the sources a table may draw on. */
export const sources = (doc: Doc): Source[] =>
	doc.characters.flatMap((c) =>
		c.fields
			.filter((f) => f.kind === 'table')
			.map((f) => ({
				id: globalId(c, f),
				name: `${c.name}: ${f.label}`,
				columns: f.columns ?? [],
				rows: rowsOf(c, f)
			}))
	);

export const sourceOf = (doc: Doc, id: string | undefined): Source | undefined =>
	id === undefined ? undefined : sources(doc).find((s) => s.id === id);

/** The column a source's rows are known by: Name, else the first. */
export const nameColumn = (src: Source): Column | undefined =>
	src.columns.find((c) => same(c.name, 'Name')) ?? src.columns[0];

/** The source column a choice column names rows by: its own name, else the source's names. */
export const keyOf = (src: Source, col: Column): Column | undefined =>
	src.columns.find((c) => same(c.name, col.name)) ?? nameColumn(src);

/** What a choice field offers: its source's rows by name, else its typed choices. */
export function choicesOf(doc: Doc, f: Pick<Field, 'from' | 'choices'>): string[] {
	const src = sourceOf(doc, f.from);
	if (!src) return f.choices ?? [];
	const key = nameColumn(src);
	const names = key ? src.rows.map((r) => r.cells[key.id]).filter((v) => v !== undefined) : [];
	return [...new Set(names.map(String))];
}

/** What a pick in text naming `Character!Table` offers, or undefined if no table has that name. */
export function namesFor(doc: Doc, ref: string): string[] | undefined {
	const m = /^(.+?)!(.+)$/.exec(ref);
	const c = m ? doc.characters.find((x) => same(x.name, m[1])) : undefined;
	const f = c?.fields.find((x) => x.kind === 'table' && same(x.label, m![2]));
	return c && f ? choicesOf(doc, { from: globalId(c, f) }) : undefined;
}

/** Whether `col` of a row following `src` is filled from it. */
export const fromSource = (src: Source, col: Column) =>
	col.from === src.id || src.columns.some((c) => same(c.name, col.name));

/**
 * `cells` with an item's cells over them, in the columns whose name the source has too, and
 * in a choice column drawing on this source, the item's name.
 */
function cellsFrom(src: Source, item: Row, columns: Column[], cells: Record<string, Cell> = {}) {
	const out = { ...cells };
	const put = (id: string, v: Cell | undefined) => {
		if (v === undefined) delete out[id];
		else out[id] = clone(v);
	};
	for (const sc of src.columns) {
		const c = columns.find((x) => same(x.name, sc.name));
		if (c) put(c.id, item.cells[sc.id]);
	}
	for (const c of columns) {
		const key = c.from === src.id && keyOf(src, c);
		if (key) put(c.id, item.cells[key.id] === undefined ? undefined : String(item.cells[key.id]));
	}
	return out;
}

/** `row` with `item` chosen: its cells over the row's, and following it. */
export const choose = (src: Source, item: Row, row: Row, columns: Column[]): Row => ({
	id: row.id,
	cells: cellsFrom(src, item, columns, row.cells),
	link: { table: src.id, row: item.id }
});

/** `item` as a new row of a table with `columns`, following it. */
export const rowFrom = (src: Source, item: Row, columns: Column[]): Row => ({
	id: newId(),
	cells: cellsFrom(src, item, columns),
	link: { table: src.id, row: item.id }
});

/** Every map in the room, as the maps a table may follow. */
export const maps = (doc: Doc): { id: string; name: string }[] =>
	doc.characters.flatMap((c) =>
		c.fields
			.filter((f) => f.kind === 'map')
			.map((f) => ({ id: globalId(c, f), name: `${c.name}: ${f.label}` }))
	);

/**
 * Keeps each table that follows a map at one row, linked to the map's current node; none
 * while the map has none. The row is kept from node to node, so cells the node has no column
 * for stay as they were.
 */
function track(doc: Doc, all: Map<string, Source>, write: (op: Write) => void) {
	for (const c of doc.characters) {
		for (const f of c.fields) {
			if (f.kind !== 'table' || !f.follows) continue;
			const at = ['characters', c.id, 'values', f.id];
			const [owner, id] = f.follows.split('!');
			const mc = doc.characters.find((x) => x.id === owner);
			const map = mc?.fields.find((x) => x.id === id && x.kind === 'map');
			const src = map && all.get(map.from ?? '');
			const item = src?.rows.find((r) => r.id === valueOf(mc!, map!));
			const rows = [...rowsOf(c, f)];
			const keep = item && rows[0];
			for (const r of rows) if (r !== keep) write({ k: 'del', p: [...at, r.id] });
			if (!item) continue;
			const link = { table: src!.id, row: item.id };
			if (!keep) {
				const row = rowFrom(src!, item, f.columns ?? []);
				write(
					Array.isArray(c.values[f.id])
						? { k: 'set', p: [...at, row.id], v: row }
						: { k: 'set', p: at, v: [row] }
				);
			} else if (!equal(keep.link, link)) write({ k: 'set', p: [...at, keep.id, 'link'], v: link });
		}
	}
}

/** An item's words, to show and search it by. */
export function itemText(src: Source, item: Row): { title: string; rest: string } {
	const [first, ...others] = src.columns.filter((c) => item.cells[c.id] !== undefined);
	const show = (c: Column) => {
		const v = item.cells[c.id];
		return Array.isArray(v)
			? v.join(', ')
			: typeof v === 'object'
				? `${v.cur}/${v.max}`
				: String(v);
	};
	return { title: first ? show(first) : '', rest: others.map(show).join(' · ') };
}

/**
 * Takes every row that follows a source row its cells again; one whose row is gone is kept.
 * Each change goes through `write`, so `fire` can record it with its rules' own.
 */
export function follow(doc: Doc, write: (op: Write) => void = (op) => apply(doc, op)) {
	const all = new Map(sources(doc).map((s) => [s.id, s]));
	track(doc, all, write);
	for (const c of doc.characters) {
		for (const f of c.fields) {
			for (const r of rowsOf(c, f)) {
				if (!r.link) continue;
				const at = ['characters', c.id, 'values', f.id, r.id];
				const src = all.get(r.link.table);
				const item = src?.rows.find((x) => x.id === r.link!.row);
				if (!item) {
					write({ k: 'del', p: [...at, 'link'] });
					continue;
				}
				const cells = cellsFrom(src!, item, f.columns ?? [], r.cells);
				for (const k of new Set([...Object.keys(cells), ...Object.keys(r.cells)])) {
					if (equal(cells[k], r.cells[k])) continue;
					const p = [...at, 'cells', k];
					write(cells[k] === undefined ? { k: 'del', p } : { k: 'set', p, v: cells[k] });
				}
			}
		}
	}
}
