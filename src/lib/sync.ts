// A room's edits travel as ops on paths of ids, never array positions, so two people
// changing different fields of one character touch different data. The room applies
// changes in the order they arrive, and that order alone settles who wins the rest.

import type { Doc } from './doc';

export type Path = string[];
export type Op =
	| { k: 'set'; p: Path; v: unknown }
	| { k: 'del'; p: Path }
	| { k: 'order'; p: Path; ids: string[] };
export type Change = { id: string; ops: Op[] };
/** A player's draft, kept by the room until a GM applies it or turns it down. */
export type Proposal = Change & { asked: string; at: number };

/** What the room sends: the doc on connect, then confirmations, others' changes, or its end. */
export type Down =
	| { t: 'hello'; name: string; doc: Doc }
	| { t: 'ack'; id: string }
	| { t: 'reject'; id: string; reason: string }
	| ({ t: 'change' } & Change)
	/** To whoever asked for a press or tick: what it did, and how to take it back. */
	| { t: 'done'; id: string; ops: Op[]; undo: Op[]; why?: string }
	/** Every proposal waiting, to everyone, on connect and whenever the list changes. */
	| { t: 'proposals'; list: Proposal[] }
	| { t: 'settled'; id: string; ok: boolean }
	| { t: 'gone' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A list of things with ids, addressed by id. An empty list counts. */
const isKeyed = (v: unknown): v is { id: string }[] =>
	Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string');

/** Deep equality over JSON, where a property set to undefined counts as absent. */
export function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((x, i) => equal(x, b[i]))
		);
	}
	if (!isObj(a) || !isObj(b)) return false;
	const ka = Object.keys(a).filter((k) => a[k] !== undefined);
	const kb = Object.keys(b).filter((k) => b[k] !== undefined);
	return ka.length === kb.length && ka.every((k) => equal(a[k], b[k]));
}

/** The ops that turn `a` into `b`. Lists of things with ids are diffed item by item. */
export function diff(a: unknown, b: unknown, p: Path = [], out: Op[] = []): Op[] {
	if (isObj(a) && isObj(b)) {
		for (const k of Object.keys(a)) {
			if (a[k] !== undefined && b[k] === undefined) out.push({ k: 'del', p: [...p, k] });
		}
		for (const k of Object.keys(b)) {
			if (b[k] === undefined) continue;
			if (a[k] === undefined) out.push({ k: 'set', p: [...p, k], v: b[k] });
			else diff(a[k], b[k], [...p, k], out);
		}
	} else if (isKeyed(a) && isKeyed(b)) {
		const before = new Map(a.map((x) => [x.id, x]));
		const after = new Set(b.map((x) => x.id));
		for (const x of a) if (!after.has(x.id)) out.push({ k: 'del', p: [...p, x.id] });
		for (const x of b) {
			const was = before.get(x.id);
			if (was) diff(was, x, [...p, x.id], out);
			else out.push({ k: 'set', p: [...p, x.id], v: x });
		}
		// Applying those keeps the survivors in place and appends the newcomers, so the
		// order is named only when that is not where they belong.
		const kept = [...a.filter((x) => after.has(x.id)), ...b.filter((x) => !before.has(x.id))];
		const ids = b.map((x) => x.id);
		if (
			!equal(
				kept.map((x) => x.id),
				ids
			)
		)
			out.push({ k: 'order', p, ids });
	} else if (!equal(a, b)) {
		out.push({ k: 'set', p, v: b });
	}
	return out;
}

export function get(root: unknown, p: Path): unknown {
	let at = root;
	for (const k of p) {
		if (Array.isArray(at)) at = at.find((x) => isObj(x) && x.id === k);
		else if (isObj(at)) at = at[k];
		else return undefined;
	}
	return at;
}

/** Applies `op` in place. Returns false, changing nothing, when what it addresses is gone. */
export function apply(root: unknown, op: Op): boolean {
	if (op.k === 'order') {
		const list = get(root, op.p);
		if (!isKeyed(list)) return false;
		const rank = new Map(op.ids.map((id, i) => [id, i]));
		// Items the order does not name were added meanwhile, and go after the rest.
		const rest = op.ids.length;
		const sorted = [...list].sort((x, y) => (rank.get(x.id) ?? rest) - (rank.get(y.id) ?? rest));
		list.splice(0, list.length, ...sorted);
		return true;
	}
	if (!op.p.length) return false;
	const parent = get(root, op.p.slice(0, -1));
	const key = op.p[op.p.length - 1];
	if (Array.isArray(parent)) {
		if (!isKeyed(parent)) return false;
		const i = parent.findIndex((x) => x.id === key);
		if (op.k === 'del') {
			if (i < 0) return false;
			parent.splice(i, 1);
		} else if (!isObj(op.v) || op.v.id !== key) {
			return false;
		} else if (i < 0) {
			parent.push(structuredClone(op.v) as { id: string });
		} else {
			parent[i] = structuredClone(op.v) as { id: string };
		}
		return true;
	}
	if (!isObj(parent)) return false;
	if (op.k === 'del') delete parent[key];
	else parent[key] = structuredClone(op.v);
	return true;
}

/** Whether `root` still shows what `op` did. */
export function holds(root: unknown, op: Op): boolean {
	const at = get(root, op.p);
	if (op.k === 'del') return at === undefined;
	if (op.k === 'set') return equal(at, op.v);
	if (!isKeyed(at)) return false;
	const now = at.map((x) => x.id).filter((id) => op.ids.includes(id));
	return equal(
		now,
		op.ids.filter((id) => now.includes(id))
	);
}

// A set and the del that undoes it share a path, so they pair up; orders pair separately.
const pairKey = (op: Op) => `${op.k === 'order' ? 'o' : 's'}${JSON.stringify(op.p)}`;

/**
 * The ops of `to` that take back `from`, leaving out every path someone else has changed
 * since, so an undo never clobbers another person's edit.
 */
export function revert(root: unknown, from: Op[], to: Op[]): Op[] {
	const stale = new Set(from.filter((op) => !holds(root, op)).map(pairKey));
	return to.filter((op) => !stale.has(pairKey(op)));
}

const within = (outer: Path, inner: Path) =>
	outer.length <= inner.length && outer.every((k, i) => k === inner[i]);

/** Whether `later`, applied after `op`, leaves nothing of what `op` did. */
const covers = (later: Op, op: Op) =>
	later.k === 'order' ? op.k === 'order' && equal(later.p, op.p) : within(later.p, op.p);

/** Whether `op` adds to, removes from or reorders `list` itself. */
const shapes = (op: Op, list: Path) =>
	op.k === 'order' ? equal(op.p, list) : op.p.length === list.length + 1 && within(list, op.p);

/**
 * The room's doc as last confirmed, and this client's changes not confirmed yet. What
 * the client shows is always `base` with the pending changes applied on top: the room
 * will apply them after anything it has already sent, so that is where it is heading.
 */
export class Replica<D> {
	pending: Change[] = [];

	constructor(public base: D) {}

	/** Another client's ops, applied to `base` and, in place, to `shown`. */
	remote(ops: Op[], shown: D) {
		const mine = this.pending.flatMap((c) => c.ops);
		for (const op of ops) {
			const list = op.k === 'order' ? op.p : op.p.slice(0, -1);
			const moves =
				op.k === 'order' ||
				(op.k === 'set' && isKeyed(get(this.base, list)) && !get(this.base, op.p));
			apply(this.base, op);
			if (!mine.some((q) => covers(q, op))) {
				apply(shown, op);
				// It replaced something a pending op edits inside of, so that edit goes back on.
				if (op.k !== 'order') {
					for (const q of mine) if (q.p.length > op.p.length && within(op.p, q.p)) apply(shown, q);
				}
			}
			// Where an item sits depends on every addition and reorder before it, in turn, so
			// a list this client is also adding to or reordering is worked out again, unless
			// this client replaces the list whole, as Undo puts back a deleted character.
			const replaced = mine.some((q) => q.k !== 'order' && within(q.p, list));
			if (moves && !replaced && mine.some((q) => shapes(q, list))) this.reorder(list, mine, shown);
		}
	}

	/** Puts `list` in `shown` in the order `base` with the pending ops gives it. */
	private reorder(list: Path, mine: Op[], shown: D) {
		const from = get(this.base, list);
		if (!isKeyed(from)) return;
		const ids = { l: from.map((x) => ({ id: x.id })) };
		for (const q of mine) {
			if (!shapes(q, list)) continue;
			const id = q.p[list.length];
			if (q.k === 'order') apply(ids, { ...q, p: ['l'] });
			else
				apply(
					ids,
					q.k === 'del' ? { k: 'del', p: ['l', id] } : { k: 'set', p: ['l', id], v: { id } }
				);
		}
		apply(shown, { k: 'order', p: list, ids: ids.l.map((x) => x.id) });
	}

	ack(id: string) {
		const i = this.pending.findIndex((c) => c.id === id);
		if (i < 0) return;
		for (const op of this.pending[i].ops) apply(this.base, op);
		this.pending.splice(i, 1);
	}

	reject(id: string) {
		this.pending = this.pending.filter((c) => c.id !== id);
	}

	/** What to show, from scratch: after a rejection or a fresh doc from the room. */
	rebuild(): D {
		const shown = structuredClone(this.base);
		for (const c of this.pending) for (const op of c.ops) apply(shown, op);
		return shown;
	}
}

// The log is not here: only the room writes it.
const ROOTS = ['clocks', 'templates', 'characters'];
const UNSAFE = ['__proto__', 'prototype', 'constructor'];

/**
 * Checks a change sent by a client. A set or del addresses something inside a top-level
 * list, never the list itself, so each lands in exactly one stored row.
 */
export function isChange(v: unknown): v is Change {
	if (!isObj(v) || typeof v.id !== 'string' || !Array.isArray(v.ops)) return false;
	return v.ops.every(
		(op) =>
			isObj(op) &&
			Array.isArray(op.p) &&
			op.p.every((k) => typeof k === 'string' && !UNSAFE.includes(k)) &&
			ROOTS.includes(op.p[0]) &&
			(op.k === 'order'
				? Array.isArray(op.ids) && op.ids.every((id) => typeof id === 'string')
				: (op.k === 'set' || op.k === 'del') && op.p.length >= 2)
	);
}

/** Checks a draft a client sends for a GM: changes as a client may send them, and the asking. */
export function isPropose(v: unknown): v is { id: string; propose: { ops: Op[]; asked: string } } {
	if (!isObj(v) || !isObj(v.propose)) return false;
	const { ops, asked } = v.propose;
	return typeof asked === 'string' && asked.length <= 2000 && isChange({ id: v.id, ops });
}

/** Checks a proposal applied (`ok`) or turned down, by a GM or withdrawn by its sender. */
export function isSettle(
	v: unknown
): v is { id: string; settle: { proposal: string; ok: boolean } } {
	return (
		isObj(v) &&
		typeof v.id === 'string' &&
		isObj(v.settle) &&
		typeof v.settle.proposal === 'string' &&
		typeof v.settle.ok === 'boolean'
	);
}
