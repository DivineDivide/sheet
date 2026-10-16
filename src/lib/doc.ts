// The whole session is one plain JSON document: what autosave writes, what export
// downloads, and what an undo step snapshots.

import type { Box } from './layout';

// Still 1: `box` is optional, so every phase-1 file is a valid document as it stands.
export const VERSION = 1;

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

export const kinds = ['number', 'resource', 'track', 'text', 'tags', 'entries'] as const;
export type Kind = (typeof kinds)[number];

/** `box` is where the builder put it; phase-1 files have none, and `resolve` flows those. */
export type Field = { id: string; label: string; kind: Kind; box?: Box };
export type Template = { id: string; name: string; fields: Field[] };

export type Resource = { cur: number; max: number };
/** A titled item: a role-book ability, a talent and its usages, a fragment. */
export type Entry = { name: string; text: string };
export type Value = number | Resource | boolean[] | string | string[] | Entry[];

export type Character = {
	id: string;
	name: string;
	template: string;
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
	const hp: Field = { id: newId(), label: 'HP', kind: 'resource' };
	const notes: Field = { id: newId(), label: 'Notes', kind: 'text' };
	return {
		version: VERSION,
		clocks: [{ id: newId(), name: 'Turn', now: 1 }],
		templates: [{ id: newId(), name: 'Basic', fields: [hp, notes] }],
		characters: []
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
			return '';
		case 'tags':
		case 'entries':
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
			return typeof v === 'string';
		case 'tags':
			return Array.isArray(v) && v.every((t) => typeof t === 'string');
		case 'entries':
			return (
				Array.isArray(v) &&
				v.every((e) => typeof e?.name === 'string' && typeof e?.text === 'string')
			);
	}
}

/**
 * A field's value for a character, read leniently: a value missing or left over from
 * the field's previous kind reads as blank. Changing a kind in the template therefore
 * needs no migration of every character.
 */
export function valueOf(c: Character, f: Field): Value {
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
