// The whole session is one plain JSON document: what autosave writes, what export
// downloads, and what an undo step snapshots.

import type { Box } from './layout';
import type { Op } from './sync';

// 2: layout moved from templates onto each character, in tabs, placed freely.
export const VERSION = 2;

/** What sets a rule off: a button on the same character pressed, or a clock ticking. */
export type When = { press: string } | { tick: string };
/**
 * When something happens, if `if` holds, each line of `then` runs in order, as
 * `HP -= 1d6`. Stored with `@<id>` references, as a formula is; `rules.ts` runs them.
 */
export type Rule = { id: string; when: When; if?: string; then: string[] };

/** A clock's rules change only clocks. */
export type Clock = { id: string; name: string; now: number; rules?: Rule[] };

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
	/** What its name reads as in a formula; at 0 it has run out. */
	stacks?: number;
	rules?: Rule[];
	/** The preset it was applied from. */
	preset?: string;
};

/** A status to apply again and again. Its rules name fields by label, to suit any character. */
export type Preset = {
	id: string;
	name: string;
	clock: string;
	lasts?: number;
	stacks?: number;
	rules: Rule[];
};

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
	rules?: Rule[];
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
	presets?: Preset[];
	log?: LogLine[];
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
		characters: [],
		presets: []
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
	return left(s, clock) <= 0 || (s.stacks ?? 1) <= 0 ? 'expired' : 'active';
}

/** What a status's name reads as: its stacks, or 1 without any, while it is on; else 0. */
export function strength(s: Status, clock: Clock | undefined): number {
	return !clock || phase(s, clock) === 'active' ? (s.stacks ?? 1) : 0;
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
