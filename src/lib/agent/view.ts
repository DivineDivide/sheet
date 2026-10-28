// How the chat's model reads a room: as text, by names and labels, never by ids.

import {
	cellOf,
	shown,
	valueOf,
	type Character,
	type Column,
	type Doc,
	type Entry,
	type Field,
	type Layout,
	type Resource,
	type Row,
	type Rule
} from '../doc';
import { cellResult, names, render, result, rowNames, show, type Name } from '../formula';
import { readingOrder } from '../layout';
import { sheetOf } from '../rules';
import { keyOf, nameColumn, sourceOf } from '../source';

/** The sheet's dots are 16px apart; boxes are shown and placed in them. */
export const DOT = 16;
const CUT = 200;
const ROWS = 20;

const dots = (px: number) => String(px / DOT);
const cut = (s: string, full: boolean) =>
	full || s.length <= CUT ? s : `${s.slice(0, CUT)}… (${s.length - CUT} more characters)`;
const ticked = (b: boolean[]) => `${b.filter(Boolean).length} of ${b.length} boxes ticked`;

/** A table as the chat names a source: Character!Table. */
export function tableName(doc: Doc, id: string): string {
	const [who, field] = id.split('!');
	const c = doc.characters.find((x) => x.id === who);
	const f = c?.fields.find((x) => x.id === field);
	return c && f ? `${c.name}!${f.label}` : '(a deleted table)';
}

const gmOnly = (c: Character) => (c.hidden ? ' (GM only)' : '');

/** What a formula or rule on `c` can name; on a table's column, its row's cells too. */
export function knownOn(doc: Doc, c: Character, table?: Field): Name[] {
	const known = names(sheetOf(doc, c));
	return table ? [...rowNames(table), ...known] : known;
}

/** A button as a rule names it: a field's label, or `Table[Column]`. */
export function buttonName(c: Character, id: string): string | undefined {
	for (const f of c.fields) {
		if (f.id === id) return f.label;
		const col = f.columns?.find((x) => x.id === id);
		if (col) return `${f.label}[${col.name}]`;
	}
}

export function ruleText(doc: Doc, c: Character, r: Rule, known: Name[]): string {
	const when =
		'tick' in r.when
			? `tick ${doc.clocks.find((k) => k.id === (r.when as { tick: string }).tick)?.name ?? '(a deleted clock)'}`
			: `press ${buttonName(c, r.when.press) ?? '(a deleted button)'}`;
	const cond = r.if?.trim() ? `, if ${render(r.if, known)}` : '';
	return `${when}${cond}: ${r.then.map((l) => render(l, known)).join('; ')}`;
}

function cellText(doc: Doc, c: Character, table: Field, row: Row, col: Column) {
	if (col.kind === 'formula')
		return col.formula?.trim()
			? show(cellResult(sheetOf(doc, c), table.id, col.id, row.id))
			: undefined;
	if (col.kind === 'button') return undefined;
	const v = cellOf(row, col);
	if (v === undefined) return undefined;
	if (col.kind === 'resource') return `${(v as Resource).cur}/${(v as Resource).max}`;
	if (col.kind === 'track') return ticked(v as boolean[]);
	if (col.kind === 'tags') return (v as string[]).join(', ');
	return String(v);
}

function columnText(doc: Doc, col: Column, known: Name[]) {
	const src = col.kind === 'choice' ? sourceOf(doc, col.from) : undefined;
	if (src) {
		const key = keyOf(src, col);
		const names = key ? src.rows.map((r) => r.cells[key.id]).filter((v) => v !== undefined) : [];
		return `${col.name} (choice of ${tableName(doc, src.id)}'s rows: ${names.join(', ') || 'none yet'})`;
	}
	if (col.kind === 'choice')
		return `${col.name} (choice of ${col.choices?.join(', ') || 'nothing yet'})`;
	if (col.kind === 'formula')
		return `${col.name} (formula ${col.formula?.trim() ? `=${render(col.formula, known)}` : 'not set'})`;
	return `${col.name} (${col.kind})`;
}

/** Which source row a row follows, if any. */
function followsText(doc: Doc, row: Row): string {
	const src = sourceOf(doc, row.link?.table);
	const item = src?.rows.find((r) => r.id === row.link!.row);
	if (!src || !item) return '';
	const key = nameColumn(src);
	return ` (follows ${tableName(doc, src.id)}: ${key ? (item.cells[key.id] ?? '?') : '?'})`;
}

function valueText(doc: Doc, c: Character, f: Field, full: boolean): string[] {
	const v = valueOf(c, f);
	switch (f.kind) {
		case 'number':
			return [String(v)];
		case 'resource':
			return [`${(v as Resource).cur}/${(v as Resource).max}`];
		case 'track':
			return [ticked(v as boolean[])];
		case 'formula':
			return f.formula?.trim()
				? [`=${render(f.formula, knownOn(doc, c))} → ${show(result(sheetOf(doc, c), f.id))}`]
				: ['no formula yet'];
		case 'button':
			return [];
		case 'text':
			return [v ? JSON.stringify(cut(v as string, full)) : 'empty'];
		case 'image':
			return [v ? '[picture]' : 'no picture'];
		case 'tags':
			return [(v as string[]).join(', ') || 'no tags'];
		case 'entries': {
			const list = v as Entry[];
			return [
				`${list.length} entries`,
				...list.map((e) => `  · ${e.name}: ${JSON.stringify(cut(e.text, full))}`)
			];
		}
		case 'table': {
			const rows = v as Row[];
			const known = knownOn(doc, c, f);
			const cols = f.columns ?? [];
			const shown = full ? rows : rows.slice(0, ROWS);
			return [
				`${rows.length} rows`,
				`  columns: ${cols.map((col) => columnText(doc, col, known)).join(', ') || 'none'}`,
				...(f.from ? [`  rows from: ${tableName(doc, f.from)}`] : []),
				...cols.flatMap((col) =>
					(col.rules ?? []).map((r) => `  rule on ${col.name}: ${ruleText(doc, c, r, known)}`)
				),
				...shown.map((row, i) => {
					const cells = cols.flatMap((col) => {
						const t = cellText(doc, c, f, row, col);
						return t === undefined ? [] : [`${col.name}=${cut(t, full)}`];
					});
					return `  ${i + 1}. ${cells.join('; ') || '(empty)'}${followsText(doc, row)}`;
				}),
				...(shown.length < rows.length ? [`  … ${rows.length - shown.length} more rows`] : [])
			];
		}
	}
}

/** One field: kind, box in dots, value, rules. `full` leaves long text and rows uncut. */
export function fieldView(doc: Doc, c: Character, f: Field, full = false): string {
	const b = f.box;
	const [first, ...rest] = valueText(doc, c, f, full);
	const known = knownOn(doc, c);
	return [
		`- ${f.label}: ${f.kind}, at ${dots(b.x)},${dots(b.y)}, ${dots(b.w)}×${dots(b.h)}${f.pages ? ', in pages' : ''}${f.hideLabel ? ', label hidden' : ''}${first === undefined ? '' : `: ${first}`}`,
		...rest,
		...(f.rules ?? []).map((r) => `  rule: ${ruleText(doc, c, r, known)}`)
	].join('\n');
}

export function characterView(doc: Doc, c: Character): string {
	return [
		`Character ${c.name}${gmOnly(c)}`,
		...c.tabs.flatMap((t) => [
			`Tab ${t.name}`,
			...readingOrder(c.fields.filter((f) => f.tab === t.id)).map((f) => fieldView(doc, c, f))
		])
	].join('\n');
}

const layoutText = (l: Layout) =>
	l.tabs
		.map((t) => {
			const here = readingOrder(l.fields.filter((f) => f.tab === t.id));
			return `${t.name}: ${here.map((f) => `${f.label} (${f.kind})`).join(', ') || 'empty'}`;
		})
		.join('; ');

/** The whole room at a glance, as the asker's page shows it: what the chat's first message carries. */
export function overview(doc: Doc, gm: boolean): string {
	const list = (items: string[]) => (items.length ? items : ['- none']);
	return [
		`Clocks: ${doc.clocks.map((k) => `${k.name} (now ${k.now})`).join(', ') || 'none'}`,
		'Templates:',
		...list(doc.templates.map((t) => `- ${t.name}: ${layoutText(t)}`)),
		'Characters:',
		...list(shown(doc.characters, gm).map((c) => `- ${c.name}${gmOnly(c)}: ${layoutText(c)}`))
	].join('\n');
}
