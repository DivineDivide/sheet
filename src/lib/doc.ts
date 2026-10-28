// The whole session is one plain JSON document: what autosave writes, what export
// downloads, and what an undo step snapshots.

import type { Box } from './layout';
import type { Op } from './sync';

// 2: layout moved from templates onto each character, in tabs, placed freely.
// 3: statuses became a table's rows, and clocks lost their rules; see `v2.ts`.
export const VERSION = 3;

/** What sets a rule off: a button on the same character pressed, or a clock ticking. */
export type When = { press: string } | { tick: string };
/**
 * When something happens, if `if` holds, each line of `then` runs in order, as
 * `HP -= 1d6`. Stored with `@<id>` references, as a formula is; `rules.ts` runs them.
 */
export type Rule = { id: string; when: When; if?: string; then: string[] };

export type Clock = { id: string; name: string; now: number };

/** What the room did for a press or a tick, as everyone reads it. Only the room writes it. */
export type LogLine = {
	id: string;
	at: number;
	text: string;
	/** A tick's effects, so Back can take them back. */
	tick?: { clock: string; to: number; ops: Op[]; undo: Op[] };
};

export const kinds = [
	'number',
	'resource',
	'track',
	'formula',
	'button',
	'text',
	'tags',
	'entries',
	'table',
	'image'
] as const;
export type Kind = (typeof kinds)[number];

/** What a cell can hold: most field kinds, and a choice from a list. */
export const columnKinds = [
	'text',
	'number',
	'choice',
	'resource',
	'track',
	'formula',
	'button',
	'tags'
] as const;
export type ColumnKind = (typeof columnKinds)[number];
export type Column = {
	id: string;
	name: string;
	kind: ColumnKind;
	/** What a choice column offers, as Excel's dropdown lists do. */
	choices?: string[];
	/**
	 * A choice column's source table, by `globalId`, in place of `choices`: its rows'
	 * names are offered, and choosing one fills the row, which then follows it.
	 */
	from?: string;
	/** A formula column's expression, worked out for each row; it reads its row's cells. */
	formula?: string;
	/** Rules that change this column, run row by row. */
	rules?: Rule[];
};

export type Tab = { id: string; name: string };
export type Field = {
	id: string;
	label: string;
	kind: Kind;
	tab: string;
	box: Box;
	/** A formula field's expression, stored with `@<id>` references; see `formula.ts`. */
	formula?: string;
	/** A table field's columns. Its rows are the character's value. */
	columns?: Column[];
	/** A table's source table, by `globalId`, whose rows its + offers, each following its own. */
	from?: string;
	/** A table's or entries list's rows flip by page, as many as fit its box, not scroll. */
	pages?: true;
	/** Its label is hidden from everyone, and its label's controls float on hover. */
	hideLabel?: true;
	rules?: Rule[];
};
/** Tabs and the fields on them: what a character is shaped like, apart from its values. */
export type Layout = { tabs: Tab[]; fields: Field[] };

/** A layout saved from a character, to start new characters from. Never edited itself. */
export type Template = Layout & { id: string; name: string };

export type Resource = { cur: number; max: number };
/** A titled item: a role-book ability, a talent and its usages, a fragment. */
export type Entry = { name: string; text: string };
export type Cell = string | number | Resource | boolean[] | string[];
/** A table row, with ids so rows and cells sync one by one. A blank cell is absent. */
export type Row = {
	id: string;
	cells: Record<string, Cell>;
	/** The row of another table this one follows; see `source.ts`. */
	link?: { table: string; row: string };
};
export type Value = number | Resource | boolean[] | string | string[] | Entry[] | Row[];

export type Character = Layout & {
	id: string;
	name: string;
	values: Record<string, Value>;
	/**
	 * Left off players' screens, for a GM's tables and cards. Its data still reaches every
	 * browser, so other characters can draw on it.
	 */
	hidden?: true;
};

/** The characters a page shows: all of them to a GM, the rest to a player. */
export const shown = (characters: Character[], gm: boolean) =>
	gm ? characters : characters.filter((c) => !c.hidden);

export type Doc = {
	version: typeof VERSION;
	clocks: Clock[];
	templates: Template[];
	characters: Character[];
	log?: LogLine[];
};

export const newId = () => crypto.randomUUID();

/**
 * A field as named from another character, `<character id>!<field id>`: field ids are
 * unique only on their character, since every character made from a template shares them.
 */
export const globalId = (c: { id: string }, f: { id: string }) => `${c.id}!${f.id}`;

/**
 * A table to keep statuses in, one a row, whose Left counts down as `clock` ticks. Rules
 * on its columns, such as Poison's on Stacks, make the rest of a status.
 */
export function statusTable(tab: string, box: Box, clock: string): Field {
	const left = newId();
	const countdown: Rule = {
		id: newId(),
		when: { tick: clock },
		if: `@${left} > 0`,
		then: [`@${left} -= 1`]
	};
	return {
		id: newId(),
		label: 'Statuses',
		kind: 'table',
		tab,
		box,
		columns: [
			{ id: newId(), name: 'Name', kind: 'text' },
			{ id: newId(), name: 'Stacks', kind: 'number' },
			{ id: left, name: 'Left', kind: 'number', rules: [countdown] }
		]
	};
}

export function newDoc(): Doc {
	const tab = { id: newId(), name: 'Main' };
	const turn = { id: newId(), name: 'Turn', now: 1 };
	return {
		version: VERSION,
		clocks: [turn],
		templates: [
			{
				id: newId(),
				name: 'Basic',
				tabs: [tab],
				fields: [
					{
						id: newId(),
						label: 'HP',
						kind: 'resource',
						tab: tab.id,
						box: { x: 0, y: 0, w: 240, h: 88 }
					},
					{
						id: newId(),
						label: 'Notes',
						kind: 'text',
						tab: tab.id,
						box: { x: 0, y: 104, w: 480, h: 160 }
					},
					statusTable(tab.id, { x: 0, y: 280, w: 480, h: 160 }, turn.id)
				]
			}
		],
		characters: []
	};
}

/** Copied, not shared: editing one character's layout never reshapes another. */
export function newCharacter(name: string, from?: Layout): Character {
	const layout: Layout = from
		? structuredClone({ tabs: from.tabs, fields: from.fields })
		: { tabs: [{ id: newId(), name: 'Main' }], fields: [] };
	return {
		id: newId(),
		name,
		...layout,
		values: Object.fromEntries(layout.fields.map((f) => [f.id, blank(f.kind)]))
	};
}

/** `label`, numbered when another field has it, so a formula's label names one field. */
export function uniqueLabel(label: string, fields: Pick<Field, 'id' | 'label'>[], self?: string) {
	const taken = new Set(
		fields.filter((f) => f.id !== self).map((f) => f.label.trim().toLowerCase())
	);
	if (!taken.has(label.trim().toLowerCase())) return label;
	const base = label.trim().replace(/\s+\d+$/, '');
	let n = 2;
	while (taken.has(`${base} ${n}`.toLowerCase())) n++;
	return `${base} ${n}`;
}

export function blank(kind: Kind): Value {
	switch (kind) {
		case 'number':
			return 0;
		case 'resource':
			return { cur: 10, max: 10 };
		case 'track':
			return [false, false, false, false];
		case 'text':
		case 'image':
		case 'formula':
		case 'button':
			return '';
		case 'tags':
		case 'entries':
		case 'table':
			return [];
	}
}

function fits(kind: Kind, v: unknown): boolean {
	switch (kind) {
		case 'number':
			return typeof v === 'number' && Number.isFinite(v);
		case 'resource':
			return (
				typeof v === 'object' &&
				v !== null &&
				Number.isFinite((v as Resource).cur) &&
				Number.isFinite((v as Resource).max)
			);
		case 'track':
			return Array.isArray(v) && v.every((b) => typeof b === 'boolean');
		case 'text':
		case 'image':
		case 'formula':
		case 'button':
			return typeof v === 'string';
		case 'tags':
			return Array.isArray(v) && v.every((t) => typeof t === 'string');
		case 'entries':
			return (
				Array.isArray(v) &&
				v.every((e) => typeof e?.name === 'string' && typeof e?.text === 'string')
			);
		case 'table':
			return (
				Array.isArray(v) &&
				v.every((r) => typeof r?.id === 'string' && typeof r.cells === 'object' && r.cells !== null)
			);
	}
}

/**
 * A cell, read leniently as a field's value is. A blank resource or track reads as a new
 * field's would; any other blank cell is undefined, as an empty cell is in Excel.
 */
export function cellOf(row: Row, col: Column): Cell | undefined {
	const v = row.cells[col.id];
	if (col.kind === 'resource' || col.kind === 'track') {
		return (fits(col.kind, v) ? v : blank(col.kind)) as Cell;
	}
	if (v === undefined || v === '') return undefined;
	// Text takes a number as written, as a cell typed 42 in a text column of Excel.
	if (col.kind === 'text' || col.kind === 'choice')
		return typeof v === 'number' ? v : fits('text', v) ? v : undefined;
	return fits(col.kind, v) ? v : undefined;
}

/**
 * A field's value for a character, read leniently: a value missing or left over from
 * the field's previous kind reads as blank, so changing a kind needs no migration.
 */
export function valueOf(c: Pick<Character, 'values'>, f: Pick<Field, 'id' | 'kind'>): Value {
	const v = c.values[f.id];
	return fits(f.kind, v) ? v : blank(f.kind);
}
