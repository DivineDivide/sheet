// The whole session is one plain JSON document: what autosave writes, what export
// downloads, and what an undo step snapshots.

import type { Box } from './layout';

// 2: layout moved from templates onto each character, in tabs, placed freely.
export const VERSION = 2;

export type Clock = { id: string; name: string; now: number };

/**
 * A stamp, not a countdown: `since` is the clock's reading when the status went on, and
 * time left is derived from it. Advancing a clock rewrites no status, so stepping back
 * is exact and nothing can drift.
 */
export type Status = {
	id: string;
	name: string;
	clock: string;
	since: number;
	/** Absent means it lasts until removed. */
	lasts?: number;
};

export const kinds = [
	'number',
	'resource',
	'track',
	'formula',
	'text',
	'tags',
	'entries',
	'table',
	'image'
] as const;
export type Kind = (typeof kinds)[number];

export const columnKinds = ['text', 'number', 'choice'] as const;
export type Column = {
	id: string;
	name: string;
	kind: (typeof columnKinds)[number];
	/** What a choice column offers, as Excel's dropdown lists do. */
	choices?: string[];
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
};
/** Tabs and the fields on them: what a character is shaped like, apart from its values. */
export type Layout = { tabs: Tab[]; fields: Field[] };

/** A layout saved from a character, to start new characters from. Never edited itself. */
export type Template = Layout & { id: string; name: string };

export type Resource = { cur: number; max: number };
/** A titled item: a role-book ability, a talent and its usages, a fragment. */
export type Entry = { name: string; text: string };
/** A table row, with ids so rows and cells sync one by one. A blank cell is absent. */
export type Row = { id: string; cells: Record<string, string | number> };
export type Value = number | Resource | boolean[] | string | string[] | Entry[] | Row[];

export type Character = Layout & {
	id: string;
	name: string;
	values: Record<string, Value>;
	statuses: Status[];
};

export type Doc = {
	version: typeof VERSION;
	clocks: Clock[];
	templates: Template[];
	characters: Character[];
};

export const newId = () => crypto.randomUUID();

export function newDoc(): Doc {
	const tab = { id: newId(), name: 'Main' };
	return {
		version: VERSION,
		clocks: [{ id: newId(), name: 'Turn', now: 1 }],
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
					}
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
		values: Object.fromEntries(layout.fields.map((f) => [f.id, blank(f.kind)])),
		statuses: []
	};
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
 * A field's value for a character, read leniently: a value missing or left over from
 * the field's previous kind reads as blank, so changing a kind needs no migration.
 */
export function valueOf(c: Pick<Character, 'values'>, f: Pick<Field, 'id' | 'kind'>): Value {
	const v = c.values[f.id];
	return fits(f.kind, v) ? v : blank(f.kind);
}

export type Phase = 'pending' | 'active' | 'expired';

/** Turns left on the status's clock; Infinity when it lasts until removed. */
export function left(s: Status, clock: Clock): number {
	return s.lasts === undefined ? Infinity : s.lasts - (clock.now - s.since);
}

/** Pending when the clock has been stepped back to before the status went on. */
export function phase(s: Status, clock: Clock): Phase {
	if (clock.now < s.since) return 'pending';
	return left(s, clock) <= 0 ? 'expired' : 'active';
}

/** How long a status has left, naming its clock only when there is more than one. */
export function describe(s: Status, clocks: Clock[]): string {
	const k = clocks.find((k) => k.id === s.clock)!;
	const on = clocks.length > 1 ? ` · ${k.name}` : '';
	switch (phase(s, k)) {
		case 'pending':
			return `from ${k.name} ${s.since}`;
		case 'expired':
			return `expired${on}`;
		case 'active':
			return s.lasts === undefined ? `until removed${on}` : `${left(s, k)} left${on}`;
	}
}
