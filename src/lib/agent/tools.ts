// What the chat's model can do to a draft of a room. Each tool runs the checks the editor
// runs, so it can make only what a person could, and names things as people do.

import {
	blank,
	columnKinds,
	kinds,
	newCharacter,
	newId,
	uniqueLabel,
	valueOf,
	type Cell,
	type Character,
	type Column,
	type ColumnKind,
	type Doc,
	type Field,
	type Kind,
	type Resource,
	type Row,
	type Rule,
	type Value
} from '../doc';
import { FormulaError, compile, compileLine, isErr, refText, result, show } from '../formula';
import { ImportError, validate } from '../io';
import { GAP, clamp, defaultSize, type Box } from '../layout';
import { ruled, ruledColumns, sheetOf } from '../rules';
import { equal } from '../sync';
import { DOT, characterView, fieldView, knownOn, overview, ruleText } from './view';

type Input = Record<string, unknown>;
type Schema = Record<string, unknown>;
export type Tool = {
	name: string;
	description: string;
	input_schema: Schema;
	run: (doc: Doc, input: Input) => string;
};

/** A mistake the model can read and correct; anything else is a bug. */
export class ToolError extends Error {}
const fail = (why: string): never => {
	throw new ToolError(why);
};

const isObj = (v: unknown): v is Input => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function need(i: Input, k: string): string {
	const v = i[k];
	return typeof v === 'string' && v.trim() ? v.trim() : fail(`${k} is needed, as text`);
}
function opt(i: Input, k: string): string | undefined {
	const v = i[k];
	if (v === undefined || v === null) return undefined;
	return typeof v === 'string' ? v.trim() : fail(`${k} must be text`);
}
function texts(i: Input, k: string): string[] {
	const v = i[k] ?? [];
	return Array.isArray(v) && v.every((x) => typeof x === 'string')
		? v.map((s) => s.trim())
		: fail(`${k} must be a list of texts`);
}
function objs(i: Input, k: string): Input[] {
	const v = i[k] ?? [];
	return Array.isArray(v) && v.every(isObj) ? v : fail(`${k} must be a list of objects`);
}
function pair(i: Input, k: string, a: string, b: string): [number, number] | undefined {
	const v = i[k];
	if (v === undefined || v === null) return undefined;
	return isObj(v) && isNum(v[a]) && isNum(v[b])
		? [v[a], v[b]]
		: fail(`${k} needs numbers ${a} and ${b}`);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
function named<T>(list: T[], name: string, nameOf: (t: T) => string, what: string): T {
	const hits = list.filter((t) => same(nameOf(t), name));
	if (hits.length === 1) return hits[0];
	return fail(
		hits.length
			? `${hits.length} ${what}s are called "${name}"; rename one first`
			: `no ${what} is called "${name}" (there are: ${list.map(nameOf).join(', ') || 'none'})`
	);
}
const characterIn = (doc: Doc, i: Input) =>
	named(doc.characters, need(i, 'character'), (c) => c.name, 'character');
const fieldOf = (c: Character, label: string) => named(c.fields, label, (f) => f.label, 'field');
const tabOf = (c: Character, name: string) => named(c.tabs, name, (t) => t.name, 'tab');
const clockOf = (doc: Doc, name: string) => named(doc.clocks, name, (k) => k.name, 'clock');

/** A label `uniqueLabel` had to number, said so the model knows what to call it. */
const renamed = (asked: string, got: string) =>
	asked === got ? '' : ` It is called "${got}", since "${asked}" was taken.`;

/** `Table[Column]`, as formulas and rules name a column. */
function columnRef(c: Character, ref: string): [Field, Column] | undefined {
	const m = /^(.+)\[([^\]]+)\]$/.exec(ref.trim());
	if (!m) return undefined;
	const table = fieldOf(c, m[1]);
	if (table.kind !== 'table') fail(`${table.label} is a ${table.kind}, not a table`);
	return [table, named(table.columns ?? [], m[2], (x) => x.name, `column of ${table.label}`)];
}

function compiled(text: string, fn: () => string): string {
	try {
		return fn();
	} catch (e) {
		if (e instanceof FormulaError) fail(`"${text}": ${e.message}`);
		throw e;
	}
}

/** What a formula field shows now, so a #NAME? is seen at once. */
function shows(doc: Doc, c: Character, f: Field) {
	if (!f.formula?.trim()) return '';
	const v = result(sheetOf(doc, c), f.id);
	return ` It shows ${show(v)}${isErr(v) && v.why ? ` (${v.why})` : ''}.`;
}

const hits = (a: Box, b: Box) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function overlaps(c: Character, f: Field) {
	const over = c.fields.filter((g) => g !== f && g.tab === f.tab && hits(g.box, f.box));
	return over.length
		? ` It overlaps ${over.map((g) => g.label).join(', ')}; move one unless that is wanted.`
		: '';
}

/**
 * Where a field goes: `below` or `right_of` another, `at` a spot in dots, where it was, or
 * under everything on its tab. Sizes are in dots too, defaulting by kind.
 */
function placed(c: Character, i: Input, kind: Kind, self?: Field): { tab: string; box: Box } {
	const size = pair(i, 'size', 'w', 'h');
	const { w, h } = size ? { w: size[0] * DOT, h: size[1] * DOT } : (self?.box ?? defaultSize(kind));
	const near = opt(i, 'below') ?? opt(i, 'right_of');
	const by = near ? fieldOf(c, near) : undefined;
	const asked = opt(i, 'tab');
	const tab = asked ? tabOf(c, asked).id : (by?.tab ?? self?.tab ?? c.tabs[0].id);
	if (by && by.tab !== tab) fail(`${by.label} is on another tab`);
	const at = pair(i, 'at', 'x', 'y');
	let x: number, y: number;
	if (by && opt(i, 'below')) [x, y] = [by.box.x, by.box.y + by.box.h + GAP];
	else if (by) [x, y] = [by.box.x + by.box.w + GAP, by.box.y];
	else if (at) [x, y] = [at[0] * DOT, at[1] * DOT];
	else if (self && self.tab === tab) [x, y] = [self.box.x, self.box.y];
	else {
		const here = c.fields.filter((f) => f.tab === tab && f !== self).map((f) => f.box);
		x = here.length ? Math.min(...here.map((b) => b.x)) : 0;
		y = here.length ? Math.max(...here.map((b) => b.y + b.h)) + GAP : 0;
	}
	return { tab, box: clamp({ x, y, w, h }) };
}

const shapes: Record<Kind | ColumnKind, string> = {
	number: 'a number',
	resource: '{"cur": number, "max": number}',
	track: 'a list of true/false, one per box',
	text: 'Markdown text',
	choice: 'one of its choices',
	tags: 'a list of texts',
	entries: 'a list of {"name": text, "text": Markdown text}',
	formula: 'no value: its formula works it out',
	button: 'no value',
	table: 'rows, which edit_table changes',
	image: 'a picture, which only a person can add'
};

function cellFor(col: Column, v: unknown): Cell | undefined {
	if (v === null || v === '') return undefined;
	const ok = (() => {
		switch (col.kind) {
			case 'text':
				return typeof v === 'string' || isNum(v);
			case 'choice':
				if (typeof v === 'string' && col.choices?.length && !col.choices.includes(v))
					fail(`${col.name} offers ${col.choices.join(', ')}, not "${v}"`);
				return typeof v === 'string';
			case 'number':
				return isNum(v);
			case 'resource':
				return isObj(v) && isNum(v.cur) && isNum(v.max);
			case 'track':
				return Array.isArray(v) && v.every((b) => typeof b === 'boolean');
			case 'tags':
				return Array.isArray(v) && v.every((t) => typeof t === 'string');
			default:
				return false;
		}
	})();
	if (!ok) fail(`${col.name} takes ${shapes[col.kind]}`);
	return col.kind === 'resource'
		? { cur: (v as Resource).cur, max: (v as Resource).max }
		: (v as Cell);
}

function cellsFor(cols: Column[], row: Row, cells: unknown) {
	if (!isObj(cells)) fail('cells must be an object of column name to value');
	for (const [name, v] of Object.entries(cells as Input)) {
		const col = named(cols, name, (x) => x.name, 'column');
		const cell = cellFor(col, v);
		if (cell === undefined) delete row.cells[col.id];
		else row.cells[col.id] = cell;
	}
}

/** A new column from `{name, kind, choices?}`; its formula is set once all columns exist. */
function newColumn(i: Input, cols: Column[]): Column {
	const kind = need(i, 'kind');
	if (!columnKinds.includes(kind as ColumnKind))
		fail(`a column holds one of ${columnKinds.join(', ')}, not ${kind}`);
	const name = uniqueLabel(
		need(i, 'name'),
		cols.map((c) => ({ id: c.id, label: c.name }))
	);
	return {
		id: newId(),
		name,
		kind: kind as ColumnKind,
		...(kind === 'choice' && { choices: texts(i, 'choices') })
	};
}

function columnFormula(doc: Doc, c: Character, table: Field, col: Column, text: string) {
	if (col.kind !== 'formula')
		fail(`${col.name} is a ${col.kind} column; only a formula column has a formula`);
	col.formula = text ? compiled(text, () => compile(text, knownOn(doc, c, table))) : undefined;
}

/** Labels of what still names `id` on `c`, so a removal's loose ends are seen. */
function users(c: Character, id: string): string[] {
	const ref = refText(id);
	const says = (t?: string) => !!t?.includes(ref);
	const inRules = (rs?: Rule[]) =>
		!!rs?.some(
			(r) => says(r.if) || r.then.some(says) || ('press' in r.when && r.when.press === id)
		);
	return c.fields.flatMap((f) => [
		...(says(f.formula) || inRules(f.rules) ? [f.label] : []),
		...(f.columns ?? [])
			.filter((col) => says(col.formula) || inRules(col.rules))
			.map((col) => `${f.label}[${col.name}]`)
	]);
}

// Shared pieces of the tools' schemas.
const text = (description: string): Schema => ({ type: 'string', description });
const list = (items: Schema, description: string): Schema => ({
	type: 'array',
	items,
	description
});
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
	type: 'object',
	properties,
	required,
	additionalProperties: false
});
const num = { type: 'number' };
const who = { character: text('The character, by name') };
const placing = {
	tab: text('The tab to put it on, by name'),
	below: text('Put it under this field, lined up on its left'),
	right_of: text('Put it right of this field, lined up on its top'),
	at: { ...obj({ x: num, y: num }, ['x', 'y']), description: 'Its top-left corner, in dots' },
	size: {
		...obj({ w: num, h: num }, ['w', 'h']),
		description: 'Its size in dots; 3×3 is the smallest'
	}
};
const columnSpec = obj(
	{
		name: text('The column name'),
		kind: { type: 'string', enum: [...columnKinds] },
		choices: list({ type: 'string' }, 'What a choice column offers'),
		formula: text("A formula column's formula; a column's name reads that row's cell")
	},
	['name', 'kind']
);
const ruleSpec = obj(
	{
		press: text(
			'Runs when this button is pressed: a button field, or Table[Column] for a button column'
		),
		tick: text('Runs when this clock ticks'),
		if: text('Runs only when this formula holds'),
		then: list({ type: 'string' }, 'Lines like "HP -= 1d6" or "Stacks = 0"')
	},
	['then']
);

export const tools: Tool[] = [
	{
		name: 'read',
		description:
			'With nothing, the whole room at a glance. With a character, every field on it. With a field too, that field whole: long text and every row.',
		input_schema: obj({ ...who, field: text('A field of that character, by label') }),
		run(doc, i) {
			if (!opt(i, 'character')) return overview(doc);
			const c = characterIn(doc, i);
			const label = opt(i, 'field');
			return label ? fieldView(doc, c, fieldOf(c, label), true) : characterView(doc, c);
		}
	},
	{
		name: 'add_character',
		description: 'Adds a character, blank or from a template.',
		input_schema: obj({ name: text('Its name'), template: text('A template to start from') }, [
			'name'
		]),
		run(doc, i) {
			const asked = need(i, 'name');
			const name = uniqueLabel(
				asked,
				doc.characters.map((c) => ({ id: c.id, label: c.name }))
			);
			const from = opt(i, 'template');
			const t = from ? named(doc.templates, from, (x) => x.name, 'template') : undefined;
			const c = newCharacter(name, t && structuredClone(t));
			doc.characters.push(c);
			return `Added.${renamed(asked, name)}\n${characterView(doc, c)}`;
		}
	},
	{
		name: 'edit_character',
		description: 'Renames a character, or removes it with everything on it.',
		input_schema: obj({ ...who, rename: text('Its new name'), remove: { type: 'boolean' } }, [
			'character'
		]),
		run(doc, i) {
			const c = characterIn(doc, i);
			if (i.remove === true) {
				doc.characters = doc.characters.filter((x) => x !== c);
				return `Removed ${c.name}.`;
			}
			const asked = need(i, 'rename');
			c.name = uniqueLabel(
				asked,
				doc.characters.map((x) => ({ id: x.id, label: x.name })),
				c.id
			);
			return `Renamed.${renamed(asked, c.name)}`;
		}
	},
	{
		name: 'save_template',
		description:
			"Saves a character's tabs and fields, without values, as a template to start characters from.",
		input_schema: obj({ ...who, name: text("The template's name") }, ['character', 'name']),
		run(doc, i) {
			const c = characterIn(doc, i);
			const asked = need(i, 'name');
			const name = uniqueLabel(
				asked,
				doc.templates.map((t) => ({ id: t.id, label: t.name }))
			);
			const { tabs, fields } = structuredClone(c);
			doc.templates.push({ id: newId(), name, tabs, fields });
			return `Saved.${renamed(asked, name)}`;
		}
	},
	{
		name: 'remove_template',
		description: 'Removes a template. Characters made from it keep their layout.',
		input_schema: obj({ template: text('The template, by name') }, ['template']),
		run(doc, i) {
			const t = named(doc.templates, need(i, 'template'), (x) => x.name, 'template');
			doc.templates = doc.templates.filter((x) => x !== t);
			return `Removed ${t.name}.`;
		}
	},
	{
		name: 'edit_clocks',
		description:
			"Adds, renames or removes the room's clocks. A new clock starts at 1. Clocks are ticked in play, never here.",
		input_schema: obj({
			add: list({ type: 'string' }, 'Names of clocks to add'),
			rename: list(
				obj({ clock: text('The clock'), to: text('Its new name') }, ['clock', 'to']),
				'Clocks to rename'
			),
			remove: list({ type: 'string' }, 'Clocks to remove')
		}),
		run(doc, i) {
			const label = () => doc.clocks.map((k) => ({ id: k.id, label: k.name }));
			const out: string[] = [];
			for (const r of objs(i, 'rename')) {
				const k = clockOf(doc, need(r, 'clock'));
				k.name = uniqueLabel(need(r, 'to'), label(), k.id);
				out.push(`Renamed to ${k.name}.`);
			}
			for (const name of texts(i, 'remove')) {
				const k = clockOf(doc, name);
				doc.clocks = doc.clocks.filter((x) => x !== k);
				const left = doc.characters.flatMap((c) => users(c, k.id).map((u) => `${c.name} · ${u}`));
				const ticking = doc.characters.flatMap((c) =>
					c.fields.flatMap((f) =>
						[f.rules ?? [], ...(f.columns ?? []).map((col) => col.rules ?? [])]
							.flat()
							.filter((r) => 'tick' in r.when && r.when.tick === k.id)
							.map(() => `${c.name} · ${f.label}`)
					)
				);
				const loose = [...new Set([...left, ...ticking])];
				out.push(
					`Removed ${k.name}.${loose.length ? ` Still naming it: ${loose.join(', ')}.` : ''}`
				);
			}
			for (const asked of texts(i, 'add')) {
				const name = uniqueLabel(asked, label());
				doc.clocks.push({ id: newId(), name, now: 1 });
				out.push(`Added ${name}.${renamed(asked, name)}`);
			}
			return out.join('\n') || 'Nothing to do.';
		}
	},
	{
		name: 'edit_tabs',
		description:
			"Adds, renames, removes or reorders a character's tabs. A tab must be empty to remove.",
		input_schema: obj(
			{
				...who,
				add: list({ type: 'string' }, 'Names of tabs to add'),
				rename: list(
					obj({ tab: text('The tab'), to: text('Its new name') }, ['tab', 'to']),
					'Tabs to rename'
				),
				remove: list({ type: 'string' }, 'Empty tabs to remove'),
				order: list({ type: 'string' }, 'Every tab, in the order wanted')
			},
			['character']
		),
		run(doc, i) {
			const c = characterIn(doc, i);
			const free = (name: string) =>
				c.tabs.some((t) => same(t.name, name)) ? fail(`${c.name} already has a tab ${name}`) : name;
			for (const r of objs(i, 'rename')) {
				const t = tabOf(c, need(r, 'tab'));
				t.name = same(t.name, need(r, 'to')) ? need(r, 'to') : free(need(r, 'to'));
			}
			for (const name of texts(i, 'remove')) {
				const t = tabOf(c, name);
				if (c.fields.some((f) => f.tab === t.id))
					fail(`${t.name} has fields; move or remove them first`);
				if (c.tabs.length === 1) fail(`${t.name} is ${c.name}'s only tab`);
				c.tabs = c.tabs.filter((x) => x !== t);
			}
			for (const name of texts(i, 'add')) c.tabs.push({ id: newId(), name: free(name) });
			const order = texts(i, 'order');
			if (order.length) {
				const next = order.map((n) => tabOf(c, n));
				if (new Set(next).size !== c.tabs.length) fail('order must name every tab once');
				c.tabs = next;
			}
			return `Tabs of ${c.name}: ${c.tabs.map((t) => t.name).join(', ')}.`;
		}
	},
	{
		name: 'add_field',
		description:
			"Adds a field to a character. Without a place it goes under everything on its tab; without a size it takes its kind's usual size. A table starts with the columns given, or one Name column.",
		input_schema: obj(
			{
				...who,
				label: text('Its label, unique on the character'),
				kind: { type: 'string', enum: [...kinds] },
				...placing,
				formula: text("A formula field's formula, naming fields by label"),
				columns: list(columnSpec, "A table's columns")
			},
			['character', 'label', 'kind']
		),
		run(doc, i) {
			const c = characterIn(doc, i);
			const kind = need(i, 'kind') as Kind;
			if (!kinds.includes(kind)) fail(`a field is one of ${kinds.join(', ')}, not ${kind}`);
			const asked = need(i, 'label');
			const f: Field = {
				id: newId(),
				label: uniqueLabel(asked, c.fields),
				kind,
				...placed(c, i, kind)
			};
			c.fields.push(f);
			c.values[f.id] = blank(kind);
			if (kind === 'table') {
				const specs = objs(i, 'columns');
				f.columns = [];
				for (const s of specs.length ? specs : [{ name: 'Name', kind: 'text' }])
					f.columns.push(newColumn(s, f.columns));
				specs.forEach((s, n) => {
					const formula = opt(s, 'formula');
					if (formula) columnFormula(doc, c, f, f.columns![n], formula);
				});
			} else if (objs(i, 'columns').length) fail('only a table has columns');
			const formula = opt(i, 'formula');
			if (formula) {
				if (kind !== 'formula') fail('only a formula field has a formula');
				f.formula = compiled(formula, () => compile(formula, knownOn(doc, c)));
			}
			return `Added.${renamed(asked, f.label)}${shows(doc, c, f)}${overlaps(c, f)}\n${fieldView(doc, c, f)}`;
		}
	},
	{
		name: 'edit_field',
		description:
			"Changes a field's label, kind, tab, place, size or formula. A value left from its old kind reads as blank.",
		input_schema: obj(
			{
				...who,
				field: text('The field, by label'),
				label: text('Its new label'),
				kind: { type: 'string', enum: [...kinds] },
				...placing,
				formula: text('Its new formula; empty removes it')
			},
			['character', 'field']
		),
		run(doc, i) {
			const c = characterIn(doc, i);
			const f = fieldOf(c, need(i, 'field'));
			const asked = opt(i, 'label');
			if (asked) f.label = uniqueLabel(asked, c.fields, f.id);
			const kind = opt(i, 'kind') as Kind | undefined;
			if (kind) {
				if (!kinds.includes(kind)) fail(`a field is one of ${kinds.join(', ')}, not ${kind}`);
				f.kind = kind;
				if (kind === 'table' && !f.columns?.length)
					f.columns = [{ id: newId(), name: 'Name', kind: 'text' }];
			}
			Object.assign(f, placed(c, i, f.kind, f));
			const formula = opt(i, 'formula');
			if (formula !== undefined) {
				if (f.kind !== 'formula') fail('only a formula field has a formula');
				f.formula = formula
					? compiled(formula, () => compile(formula, knownOn(doc, c)))
					: undefined;
			}
			return `Changed.${asked ? renamed(asked, f.label) : ''}${shows(doc, c, f)}${overlaps(c, f)}\n${fieldView(doc, c, f)}`;
		}
	},
	{
		name: 'remove_field',
		description: 'Removes a field and its value. Formulas and rules naming it then show #REF!.',
		input_schema: obj({ ...who, field: text('The field, by label') }, ['character', 'field']),
		run(doc, i) {
			const c = characterIn(doc, i);
			const f = fieldOf(c, need(i, 'field'));
			c.fields = c.fields.filter((x) => x !== f);
			delete c.values[f.id];
			const left = [f.id, ...(f.columns ?? []).map((col) => col.id)].flatMap((id) => users(c, id));
			return `Removed ${f.label}.${left.length ? ` Still naming it: ${[...new Set(left)].join(', ')}.` : ''}`;
		}
	},
	{
		name: 'set_value',
		description:
			"Sets a field's value, in its kind's shape: number a number; resource {cur, max}; track a list of true/false, one per box; text Markdown; tags a list of texts; entries a list of {name, text}. Tables change through edit_table.",
		input_schema: obj(
			{
				...who,
				field: text('The field, by label'),
				value: { description: 'The value, in the shape its kind takes' }
			},
			['character', 'field', 'value']
		),
		run(doc, i) {
			const c = characterIn(doc, i);
			const f = fieldOf(c, need(i, 'field'));
			if (['formula', 'button', 'table', 'image'].includes(f.kind))
				fail(`${f.label} is a ${f.kind}, which takes ${shapes[f.kind]}`);
			let v = i.value as Value;
			if (f.kind === 'resource' && isObj(v)) v = { cur: v.cur as number, max: v.max as number };
			if (!equal(valueOf({ values: { [f.id]: v } }, f), v))
				fail(`${f.label} is a ${f.kind}, which takes ${shapes[f.kind]}`);
			c.values[f.id] = structuredClone(v);
			return `Set.\n${fieldView(doc, c, f)}`;
		}
	},
	{
		name: 'edit_table',
		description:
			"Changes a table's columns, then its rows. Rows are numbered as read shows them, before this call; cells are {column name: value}, and null empties a cell.",
		input_schema: obj(
			{
				...who,
				table: text('The table, by label'),
				add_columns: list(columnSpec, 'Columns to add at the end'),
				change_columns: list(
					obj(
						{
							column: text('The column, by name'),
							name: text('Its new name'),
							kind: { type: 'string', enum: [...columnKinds] },
							choices: list({ type: 'string' }, 'What a choice column offers'),
							formula: text("A formula column's formula; empty removes it")
						},
						['column']
					),
					'Columns to change'
				),
				remove_columns: list({ type: 'string' }, 'Columns to remove'),
				column_order: list({ type: 'string' }, 'Every column, in the order wanted'),
				change_rows: list(
					obj({ row: { type: 'integer' }, cells: { type: 'object' } }, ['row', 'cells']),
					'Rows to change'
				),
				remove_rows: list({ type: 'integer' }, 'Rows to remove'),
				add_rows: list({ type: 'object' }, 'Rows to add at the end, as their cells')
			},
			['character', 'table']
		),
		run(doc, i) {
			const c = characterIn(doc, i);
			const f = fieldOf(c, need(i, 'table'));
			if (f.kind !== 'table') fail(`${f.label} is a ${f.kind}, not a table`);
			let cols = (f.columns ??= []);
			const column = (name: string) => named(cols, name, (x) => x.name, `column of ${f.label}`);
			for (const name of texts(i, 'remove_columns')) {
				const col = column(name);
				cols = f.columns = cols.filter((x) => x !== col);
			}
			const formulas: [Column, string][] = [];
			for (const ch of objs(i, 'change_columns')) {
				const col = column(need(ch, 'column'));
				const to = opt(ch, 'name');
				if (to)
					col.name = uniqueLabel(
						to,
						cols.map((x) => ({ id: x.id, label: x.name })),
						col.id
					);
				const kind = opt(ch, 'kind');
				if (kind) {
					if (!columnKinds.includes(kind as ColumnKind))
						fail(`a column holds one of ${columnKinds.join(', ')}, not ${kind}`);
					col.kind = kind as ColumnKind;
				}
				if (ch.choices !== undefined) col.choices = texts(ch, 'choices');
				const formula = opt(ch, 'formula');
				if (formula !== undefined) formulas.push([col, formula]);
			}
			for (const spec of objs(i, 'add_columns')) {
				const col = newColumn(spec, cols);
				cols.push(col);
				const formula = opt(spec, 'formula');
				if (formula) formulas.push([col, formula]);
			}
			const order = texts(i, 'column_order');
			if (order.length) {
				const next = order.map(column);
				if (new Set(next).size !== cols.length) fail('column_order must name every column once');
				cols = f.columns = next;
			}
			for (const [col, formula] of formulas) columnFormula(doc, c, f, col, formula);

			const rows = valueOf(c, f) as Row[];
			const at = (n: unknown) =>
				Number.isInteger(n) && (n as number) >= 1 && (n as number) <= rows.length
					? rows[(n as number) - 1]
					: fail(`${f.label} has rows 1 to ${rows.length}, not ${n}`);
			for (const ch of objs(i, 'change_rows')) cellsFor(cols, at(ch.row), ch.cells);
			const gone = new Set(
				(Array.isArray(i.remove_rows) ? i.remove_rows : []).map((n: unknown) => at(n))
			);
			const added = (Array.isArray(i.add_rows) ? i.add_rows : []).map((cells: unknown) => {
				const row: Row = { id: newId(), cells: {} };
				cellsFor(cols, row, cells);
				return row;
			});
			c.values[f.id] = [...rows.filter((r) => !gone.has(r)), ...added];
			return `Changed.\n${fieldView(doc, c, f)}`;
		}
	},
	{
		name: 'set_rules',
		description:
			'Replaces the rules on a field, or on a table column as Table[Column], whose rules run in every row and read its cells by column name. A rule runs when a button is pressed or a clock ticks, and its lines may change other fields too. An empty list removes them.',
		input_schema: obj(
			{
				...who,
				target: text('The field by label, or Table[Column]'),
				rules: list(ruleSpec, 'Each needs press or tick, not both')
			},
			['character', 'target', 'rules']
		),
		run(doc, i) {
			const c = characterIn(doc, i);
			const target = need(i, 'target');
			const [table, col] = columnRef(c, target) ?? [];
			const f = table ? undefined : fieldOf(c, target);
			if (f && !ruled.includes(f.kind))
				fail(`rules change ${ruled.join(', ')} fields, and ${f.label} is a ${f.kind}`);
			if (col && !ruledColumns.includes(col.kind))
				fail(`rules change ${ruledColumns.join(', ')} columns, and ${col.name} is ${col.kind}`);
			const known = knownOn(doc, c, table);
			const button = (name: string) => {
				const ref = columnRef(c, name);
				const b = ref ? ref[1] : fieldOf(c, name);
				return b.kind === 'button' ? b.id : fail(`${name} is not a button`);
			};
			const rules: Rule[] = objs(i, 'rules').map((r) => {
				const press = opt(r, 'press');
				const tick = opt(r, 'tick');
				if (!press === !tick) fail('each rule runs on press or on tick, one of the two');
				const cond = opt(r, 'if');
				const then = texts(r, 'then');
				if (!then.length) fail('each rule needs a line in then');
				return {
					id: newId(),
					when: press ? { press: button(press) } : { tick: clockOf(doc, tick!).id },
					...(cond && { if: compiled(cond, () => compile(cond, known)) }),
					then: then.map((l) => compiled(l, () => compileLine(l, known)))
				};
			});
			const owner = (col ?? f)!;
			owner.rules = rules.length ? rules : undefined;
			return rules.length
				? `${target} now has:\n${rules.map((r) => `- ${ruleText(doc, c, r, known)}`).join('\n')}`
				: `${target} has no rules now.`;
		}
	}
];

/**
 * Runs a tool on the draft, whole or not at all: on any mistake, or a draft the room's
 * `validate` would refuse, the draft goes back to how it was and the reason comes back.
 */
export function runTool(doc: Doc, name: string, input: unknown): { ok: boolean; text: string } {
	const tool = tools.find((t) => t.name === name);
	if (!tool) return { ok: false, text: `there is no tool called ${name}` };
	const before = structuredClone(doc);
	try {
		const text = tool.run(doc, isObj(input) ? input : {});
		validate(doc);
		return { ok: true, text };
	} catch (e) {
		if (!(e instanceof ToolError || e instanceof ImportError)) throw e;
		Object.assign(doc, before);
		return { ok: false, text: e.message };
	}
}
