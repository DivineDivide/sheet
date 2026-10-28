// A table's rows drawn from another table, usually a GM-only character's: picked by its +,
// or chosen in a choice column. Such a row follows its source row: after every change, its
// cells in the columns the source has too are the source's again.

import {
	globalId,
	newId,
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
