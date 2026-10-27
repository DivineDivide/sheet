// How the chat's model reads a room: as text, by names and labels, never by ids.

import {
	cellOf,
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

/** The sheet's dots are 16px apart; boxes are shown and placed in them. */
export const DOT = 16;
const CUT = 200;
const ROWS = 20;

const dots = (px: number) => String(px / DOT);
const cut = (s: string, full: boolean) =>
	full || s.length <= CUT ? s : `${s.slice(0, CUT)}… (${s.length - CUT} more characters)`;
const ticked = (b: boolean[]) => `${b.filter(Boolean).length} of ${b.length} boxes ticked`;

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

function columnText(col: Column, known: Name[]) {
	if (col.kind === 'choice')
		return `${col.name} (choice of ${col.choices?.join(', ') || 'nothing yet'})`;
	if (col.kind === 'formula')
		return `${col.name} (formula ${col.formula?.trim() ? `=${render(col.formula, known)}` : 'not set'})`;
	return `${col.name} (${col.kind})`;
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
				`  columns: ${cols.map((col) => columnText(col, known)).join(', ') || 'none'}`,
				...cols.flatMap((col) =>
					(col.rules ?? []).map((r) => `  rule on ${col.name}: ${ruleText(doc, c, r, known)}`)
				),
				...shown.map((row, i) => {
					const cells = cols.flatMap((col) => {
						const t = cellText(doc, c, f, row, col);
						return t === undefined ? [] : [`${col.name}=${cut(t, full)}`];
					});
					return `  ${i + 1}. ${cells.join('; ') || '(empty)'}`;
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
		`- ${f.label}: ${f.kind}, at ${dots(b.x)},${dots(b.y)}, ${dots(b.w)}×${dots(b.h)}${first === undefined ? '' : `: ${first}`}`,
		...rest,
		...(f.rules ?? []).map((r) => `  rule: ${ruleText(doc, c, r, known)}`)
	].join('\n');
}

export function characterView(doc: Doc, c: Character): string {
	return [
		`Character ${c.name}`,
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

/** The whole room at a glance: what the chat's first message carries. */
export function overview(doc: Doc): string {
	const list = (items: string[]) => (items.length ? items : ['- none']);
	return [
		`Clocks: ${doc.clocks.map((k) => `${k.name} (now ${k.now})`).join(', ') || 'none'}`,
		'Templates:',
		...list(doc.templates.map((t) => `- ${t.name}: ${layoutText(t)}`)),
		'Characters:',
		...list(doc.characters.map((c) => `- ${c.name}: ${layoutText(c)}`))
	].join('\n');
}
