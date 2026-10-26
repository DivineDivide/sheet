// Turns a workbook, as `xlsx.ts` reads it, into one new character: a tab per sheet, each
// field where its cells sat. The rules judge from shape and style alone which cells make
// a field, and anything they leave is listed, so a card they misread loses nothing silently.

import {
	newCharacter,
	newId,
	type Character,
	type Column,
	type Entry,
	type Field,
	type Kind,
	type Row,
	type Tab,
	type Value
} from './doc';
import { render, result, show } from './formula';
import { MIN, clamp, settle } from './layout';

/** Rows and columns count from 1 and include both ends, as in Excel. */
export type Range = { r0: number; c0: number; r1: number; c1: number };
export type Cell = string | number | boolean | null;
/** A merged range, or a single cell outside every merge. */
export type Block = { at: Range; value: Cell; bold: boolean; formula?: string };
export type XSheet = {
	name: string;
	/** Every merge, empty or not, and every other cell holding a value or a formula. */
	blocks: Block[];
	/** Pixels, indexed by column and row number; a gap means Excel's default. */
	widths: number[];
	heights: number[];
	/** Excel tables; `at` includes the header row. */
	tables: { name: string; at: Range; columns: string[] }[];
	/** Dropdown lists. */
	lists: { at: Range; choices: string[] }[];
	/** Pictures by their top-left cell and size in pixels; `picture` indexes the book's. */
	images: { r: number; c: number; w: number; h: number; picture: number }[];
};
export type Book = { name: string; sheets: XSheet[] };

export type Imported = {
	character: Character;
	/** Cells with something in them that no field took. */
	left: { sheet: string; at: string; text: string }[];
	/** Each formula's result next to the one Excel last computed; `ok` null when Excel kept none. */
	checks: {
		sheet: string;
		at: string;
		formula: string;
		excel: string;
		ours: string;
		ok: boolean | null;
	}[];
};

const DEFAULT_W = 64;
const DEFAULT_H = 20;
/** Longer than this, or holding a line break, and a bold cell is content, not a label. */
const LABEL_MAX = 16;
/** The least height each kind needs for its label and value, where Excel gave it less. */
const NEED: Partial<Record<Kind, number>> = { number: 64, text: 80, tags: 96, formula: 88 };

const letters = (c: number): string =>
	(c > 26 ? letters(Math.floor((c - 1) / 26)) : '') + String.fromCharCode(65 + ((c - 1) % 26));
export const a1 = ({ r0, c0, r1, c1 }: Range) =>
	`${letters(c0)}${r0}${r0 === r1 && c0 === c1 ? '' : `:${letters(c1)}${r1}`}`;
const inside = (r: Range, row: number, col: number) =>
	row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
const covers = (r: Range, s: Range) => inside(r, s.r0, s.c0) && inside(r, s.r1, s.c1);
const union = (...rs: Range[]): Range => ({
	r0: Math.min(...rs.map((r) => r.r0)),
	c0: Math.min(...rs.map((r) => r.c0)),
	r1: Math.max(...rs.map((r) => r.r1)),
	c1: Math.max(...rs.map((r) => r.c1))
});
const text = (b: Block) => (b.value === null ? '' : String(b.value).trim());
/** Text for Markdown: a line break made in the cell stays one, where Markdown would join the lines. */
const prose = (b: Block) => text(b).replace(/(?<!\n)\n(?!\n)/g, '  \n');
const reading = (a: Block, b: Block) => a.at.r0 - b.at.r0 || a.at.c0 - b.at.c0;

type Draft = { field: Field; value: Value; at: Range; grow: number };
/** A cell or range a formula may name, and the field it became. */
type Target = { sheet: string; at: Range; id: string; column?: string };
type Pending = { field: Field; sheet: string; order: number; block: Block };

export function fromBook(book: Book, pictures: string[]): Imported {
	const tabs: Tab[] = [];
	const fields: Field[] = [];
	const values: Record<string, Value> = {};
	const left: Imported['left'] = [];
	const targets: Target[] = [];
	const tables = new Map<string, { id: string; columns: Map<string, string> }>();
	const formulas: Pending[] = [];
	let name = '';

	for (const sheet of book.sheets) {
		const tab: Tab = { id: newId(), name: sheet.name };
		const drafts: Draft[] = [];
		const used = new Set<Block>();
		const free = () => sheet.blocks.filter((b) => !used.has(b));
		const bolds = sheet.blocks.some((b) => b.bold && text(b));
		const label = (b: Block) => {
			const t = text(b);
			return (
				typeof b.value === 'string' &&
				t !== '' &&
				t.length <= LABEL_MAX &&
				!t.includes('\n') &&
				!b.formula &&
				(b.bold || !bolds)
			);
		};
		const at = new Map<string, Block>();
		for (const b of sheet.blocks)
			for (let r = b.at.r0; r <= b.at.r1; r++)
				for (let c = b.at.c0; c <= b.at.c1; c++) at.set(`${r},${c}`, b);
		const cellAt = (r: number, c: number) => at.get(`${r},${c}`);

		const add = (kind: Kind, label: string, range: Range, value: Value, grow = MIN.h) => {
			const field: Field = {
				id: newId(),
				label,
				kind,
				tab: tab.id,
				box: { x: 0, y: 0, w: 0, h: 0 }
			};
			drafts.push({ field, value, at: range, grow });
			return field;
		};
		/** A field named `name` whose value is `v`; `range` is all it covers on the sheet. */
		const valued = (name: string, v: Block, range: Range) => {
			used.add(v);
			const t = text(v);
			const parts = t
				.split(/[、,，;；]/)
				.map((s) => s.trim())
				.filter(Boolean);
			let f: Field;
			if (v.formula) {
				f = add('formula', name, range, '', NEED.formula);
				formulas.push({ field: f, sheet: sheet.name, order: book.sheets.indexOf(sheet), block: v });
			} else if (typeof v.value === 'number') {
				f = add('number', name, range, v.value, NEED.number);
			} else if (parts.length > 1 && t.length <= 60 && parts.every((p) => p.length <= 12)) {
				f = add('tags', name, range, parts, NEED.tags);
			} else {
				f = add(
					'text',
					name,
					range,
					typeof v.value === 'boolean' ? t.toUpperCase() : prose(v),
					NEED.text
				);
			}
			targets.push({ sheet: sheet.name, at: v.at, id: f.id });
		};
		const choicesAt = (r: number, c: number) =>
			sheet.lists.find((l) => inside(l.at, r, c))?.choices;
		/** A table field from header names and rows of blocks, column by column. */
		const table = (
			label: string,
			range: Range,
			heads: { name: string; c0: number; c1: number }[],
			rows: (Block | undefined)[][],
			top: number,
			bottom: number
		) => {
			const columns: Column[] = heads.map((h, i) => {
				const list = choicesAt(top, h.c0);
				const seen = rows.map((r) => r[i]?.value ?? null).filter((v) => v !== null && v !== '');
				const kind = list
					? 'choice'
					: seen.length && seen.every((v) => typeof v === 'number')
						? 'number'
						: 'text';
				return { id: newId(), name: h.name, kind, ...(list && { choices: list }) };
			});
			const data: Row[] = rows
				.map((r) => ({
					id: newId(),
					cells: Object.fromEntries(
						columns.flatMap((col, i) => {
							const b = r[i];
							if (!b || text(b) === '') return [];
							return [
								[col.id, col.kind === 'number' && typeof b.value === 'number' ? b.value : prose(b)]
							];
						})
					)
				}))
				.filter((r) => Object.keys(r.cells).length);
			const field = add('table', label, range, data);
			field.columns = columns;
			columns.forEach((col, i) =>
				targets.push({
					sheet: sheet.name,
					at: { r0: top, r1: bottom, c0: heads[i].c0, c1: heads[i].c1 },
					id: field.id,
					column: col.id
				})
			);
			return field;
		};
		const above = (r: Range) =>
			free().find((b) => label(b) && b.at.r1 === r.r0 - 1 && b.at.c0 <= r.c1 && b.at.c1 >= r.c0);

		// Excel tables first: their cells are spoken for, header to last row.
		for (const t of sheet.tables) {
			for (const b of free()) if (covers(t.at, b.at)) used.add(b);
			const title = above(t.at);
			if (title) used.add(title);
			const heads = t.columns.map((n, i) => ({ name: n, c0: t.at.c0 + i, c1: t.at.c0 + i }));
			// Excel tables keep empty rows ready below their last; the box ends at the last in use.
			const rows: (Block | undefined)[][] = [];
			let last = t.at.r0 + 1;
			for (let r = t.at.r0 + 1; r <= t.at.r1; r++) {
				const row = heads.map((h) => cellAt(r, h.c0));
				rows.push(row);
				if (row.some((b) => b && text(b))) last = r;
			}
			const label = title ? text(title) : sheet.tables.length === 1 ? sheet.name : t.name;
			// The title names the field but stays out of its box, so a cell beside it keeps its place.
			const f = table(label, { ...t.at, r1: last }, heads, rows, t.at.r0 + 1, last);
			tables.set(t.name.toLowerCase(), {
				id: f.id,
				columns: new Map(f.columns!.map((c) => [c.name.toLowerCase(), c.id]))
			});
		}

		// A picture fills the empty merge it sits in, or its own size.
		for (const img of sheet.images) {
			const holder = cellAt(img.r, img.c);
			let range: Range;
			if (holder && text(holder) === '' && !used.has(holder)) {
				used.add(holder);
				range = holder.at;
			} else {
				let c1 = img.c;
				for (let w = 0; (w += sheet.widths[c1] ?? DEFAULT_W) < img.w;) c1++;
				let r1 = img.r;
				for (let h = 0; (h += sheet.heights[r1] ?? DEFAULT_H) < img.h;) r1++;
				range = { r0: img.r, c0: img.c, r1, c1 };
			}
			const title = above(range);
			if (title) used.add(title);
			add(
				'image',
				title ? text(title) : 'Picture',
				title ? union(title.at, range) : range,
				pictures[img.picture] ?? ''
			);
		}

		// A wide bold block alone at the top is the sheet's title: the character's name on the
		// first sheet that has one, and nothing to keep when it only repeats the sheet's name.
		const filled = free().filter((b) => text(b) || b.formula);
		const [first] = filled.sort(reading);
		if (first) {
			const c0 = Math.min(...filled.map((b) => b.at.c0));
			const c1 = Math.max(...filled.map((b) => b.at.c1));
			const alone = !filled.some(
				(b) => b !== first && b.at.r0 <= first.at.r1 && b.at.r1 >= first.at.r0
			);
			const wide = first.at.c1 - first.at.c0 + 1 >= 0.4 * (c1 - c0 + 1);
			if (alone && wide && first.bold && typeof first.value === 'string') {
				if (text(first) === sheet.name) {
					used.add(first);
				} else if (!name) {
					name = text(first);
					used.add(first);
				}
			}
		}

		// Header rows: bold labels side by side, with plain cells under each, row after row.
		// One row under them is more often two abilities side by side, so a grid needs two.
		const byRow = new Map<string, Block[]>();
		for (const b of free().filter(label)) {
			const k = `${b.at.r0}:${b.at.r1}`;
			byRow.set(k, [...(byRow.get(k) ?? []), b]);
		}
		for (const group of byRow.values()) {
			group.sort(reading);
			const runs: Block[][] = [];
			for (const b of group) {
				const run = runs.at(-1);
				if (run && b.at.c0 <= run.at(-1)!.at.c1 + 2) run.push(b);
				else runs.push([b]);
			}
			for (const heads of runs.filter((r) => r.length >= 2)) {
				if (heads.some((h) => used.has(h))) continue;
				const lo = heads[0].at.c0;
				const hi = heads.at(-1)!.at.c1;
				const rows: (Block | undefined)[][] = [];
				let r = heads[0].at.r1 + 1;
				for (;;) {
					const band = free().filter((b) => b.at.r0 === r && b.at.c0 >= lo && b.at.c1 <= hi);
					const fits = (b: Block) => heads.some((h) => h.at.c0 === b.at.c0 && h.at.c1 === b.at.c1);
					if (!band.length || band.some(label) || !band.every(fits)) break;
					rows.push(heads.map((h) => band.find((b) => b.at.c0 === h.at.c0)));
					r = Math.max(...band.map((b) => b.at.r1)) + 1;
				}
				if (rows.length < 2) continue;
				const range = { r0: heads[0].at.r0, c0: lo, r1: r - 1, c1: hi };
				for (const b of free()) if (covers(range, b.at)) used.add(b);
				const title = above(range);
				if (title) used.add(title);
				const cols = heads.map((h) => ({ name: text(h), c0: h.at.c0, c1: h.at.c1 }));
				table(title ? text(title) : sheet.name, range, cols, rows, heads[0].at.r1 + 1, r - 1);
			}
		}

		// A label with its value to the right, a column or two away at most. Before stacks, so
		// a column of values is not read as labels over each other; without bold to tell them
		// apart, short text to the right is a value too.
		for (const l of free().filter(label).sort(reading)) {
			if (used.has(l)) continue;
			const [v] = free()
				.filter((b) => b.at.r0 === l.at.r0 && b.at.c0 > l.at.c1)
				.sort((a, b) => a.at.c0 - b.at.c0);
			if (!v || (label(v) && bolds) || v.at.c0 - l.at.c1 - 1 > 2) continue;
			used.add(l);
			valued(text(l), v, union(l.at, v.at));
		}

		// Stacks of the same width: a label over its value, or a heading over two or more of
		// those, which become entries.
		const stacks = new Map<string, Block[]>();
		for (const b of free()) {
			const k = `${b.at.c0}:${b.at.c1}`;
			stacks.set(k, [...(stacks.get(k) ?? []), b]);
		}
		for (const stack of stacks.values()) {
			stack.sort(reading);
			const runs: Block[][] = [];
			for (const b of stack) {
				const run = runs.at(-1);
				if (run && b.at.r0 === run.at(-1)!.at.r1 + 1) run.push(b);
				else runs.push([b]);
			}
			for (const run of runs) {
				const pairs = (from: number) => {
					const out: [Block, Block][] = [];
					for (let j = from; j + 1 < run.length && label(run[j]) && !label(run[j + 1]); j += 2)
						out.push([run[j], run[j + 1]]);
					return out;
				};
				for (let i = 0; i < run.length;) {
					const head = run[i];
					const items = label(head) ? pairs(i + 1) : [];
					if (items.length >= 2) {
						const entries: Entry[] = items.map(([t, b]) => ({ name: text(t), text: prose(b) }));
						const last = items.at(-1)![1];
						add('entries', text(head), union(head.at, last.at), entries);
						for (const b of [head, ...items.flat()]) used.add(b);
						i += 1 + 2 * items.length;
					} else if (label(head) && run[i + 1] && !label(run[i + 1])) {
						used.add(head);
						valued(text(head), run[i + 1], union(head.at, run[i + 1].at));
						i += 2;
					} else i++;
				}
			}
		}

		// Any formula left is a field of its own, labelled from beside or above it if it can be.
		for (const b of free()
			.filter((b) => b.formula)
			.sort(reading)) {
			const l = free().find(
				(x) =>
					label(x) &&
					((x.at.r0 === b.at.r0 && x.at.c1 < b.at.c0 && b.at.c0 - x.at.c1 <= 3) ||
						(x.at.r1 === b.at.r0 - 1 && x.at.c0 === b.at.c0))
			);
			if (l) used.add(l);
			valued(l ? text(l) : '', b, l ? union(l.at, b.at) : b.at);
		}

		for (const b of free().sort(reading)) {
			if (text(b)) left.push({ sheet: sheet.name, at: a1(b.at), text: text(b).slice(0, 80) });
		}

		if (!drafts.length) continue;
		tabs.push(tab);
		place(sheet, drafts);
		for (const d of drafts) {
			fields.push(d.field);
			values[d.field.id] = d.value;
		}
	}

	if (!tabs.length) throw new Error('found nothing to make fields from');
	const character: Character = {
		...newCharacter(name || book.name || 'Imported'),
		tabs,
		fields,
		values
	};

	const checks: Imported['checks'] = [];
	formulas.sort((a, b) => a.order - b.order || reading(a.block, b.block));
	for (const p of formulas) {
		p.field.formula = translate(p.block.formula!, p.sheet, targets, tables);
		const shown = render(p.field.formula, fields);
		if (!p.field.label) p.field.label = shown.slice(0, 40);
		const ours = show(result(character, p.field.id));
		const cached = p.block.value;
		checks.push({
			sheet: p.sheet,
			at: a1(p.block.at),
			formula: `=${shown}`,
			excel: cached === null ? '' : show(cached),
			ours,
			ok: cached === null ? null : show(cached) === ours
		});
	}
	return { character, left, checks };
}

/**
 * Boxes from Excel's geometry, 8px apart. A box grown to fit its field pushes down only
 * what sits under it, as on the share card.
 */
function place(sheet: XSheet, drafts: Draft[]) {
	const x = (c: number) => {
		let s = 0;
		for (let i = 1; i < c; i++) s += sheet.widths[i] ?? DEFAULT_W;
		return s;
	};
	const y = (r: number) => {
		let s = 0;
		for (let i = 1; i < r; i++) s += sheet.heights[i] ?? DEFAULT_H;
		return s;
	};
	const ox = Math.min(...drafts.map((d) => x(d.at.c0)));
	const oy = Math.min(...drafts.map((d) => y(d.at.r0)));
	for (const d of drafts) {
		d.field.box = {
			x: x(d.at.c0) - ox,
			y: y(d.at.r0) - oy,
			w: Math.max(MIN.w, x(d.at.c1 + 1) - x(d.at.c0) - 8),
			h: y(d.at.r1 + 1) - y(d.at.r0) - 8
		};
	}
	const fields = drafts.map((d) => d.field);
	const heights = Object.fromEntries(
		drafts.map((d) => [d.field.id, Math.max(d.grow, d.field.box.h)])
	);
	const tops = settle(fields, heights);
	for (const f of fields) f.box = clamp({ ...f.box, y: tops[f.id], h: heights[f.id] });
}

/**
 * Excel's formula with its cells swapped for the fields they became: a cell for its field,
 * a range down one table column for that column. What maps to no field is kept as written,
 * and shows #NAME? or #ERROR!, which the check beside it flags.
 */
function translate(
	src: string,
	sheet: string,
	targets: Target[],
	tables: Map<string, { id: string; columns: Map<string, string> }>
): string {
	const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
	let out = '';
	let i = 0;
	while (i < src.length) {
		if (src[i] === '"') {
			let j = i + 1;
			while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) j += src[j] === '"' ? 2 : 1;
			out += src.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		const rest = src.slice(i);
		const starts = !/[\w.$\u0080-￿]/.test(src[i - 1] ?? '');
		const ref =
			starts &&
			/^(?:(?:'((?:[^']|'')+)'|([^\s'!()=,+\-*/^&<>:;"{}[\]]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![\w(.])/.exec(
				rest
			);
		if (ref) {
			const on = ref[1]?.replace(/''/g, "'") ?? ref[2] ?? sheet;
			const r: Range = {
				r0: +ref[4],
				c0: col(ref[3]),
				r1: +(ref[6] ?? ref[4]),
				c1: col(ref[5] ?? ref[3])
			};
			const column = targets.find(
				(t) =>
					t.column &&
					t.sheet === on &&
					r.c0 === r.c1 &&
					r.c0 === t.at.c0 &&
					r.r0 === t.at.r0 &&
					r.r1 >= t.at.r1
			);
			const field = targets.find((t) => !t.column && t.sheet === on && covers(t.at, r));
			if (column || field) {
				out += column ? `@${column.id}[${column.column}]` : `@${field!.id}`;
				i += ref[0].length;
				continue;
			}
		}
		const named = starts && /^([A-Za-z_\u0080-￿][\w.\u0080-￿]*)\[([^[\]#@]+)\]/.exec(rest);
		const t = named && tables.get(named[1].toLowerCase());
		const c = t && t.columns.get(named[2].trim().toLowerCase());
		if (named && t && c) {
			out += `@${t.id}[${c}]`;
			i += named[0].length;
			continue;
		}
		out += src[i++];
	}
	return out;
}
