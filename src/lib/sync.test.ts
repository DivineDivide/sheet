import { describe, expect, it } from 'vitest';
import { newCharacter, newDoc, newId, valueOf, type Character, type Doc, type Row } from './doc';
import {
	Replica,
	apply,
	diff,
	equal,
	isChange,
	isPropose,
	isSettle,
	revert,
	type Change,
	type Down,
	type Op
} from './sync';

const clone = <T>(v: T): T => structuredClone(v);

/** A row added to a character's first table, as a status is. */
function addRow(c: Character, id: string = newId()) {
	const t = c.fields.find((f) => f.kind === 'table');
	if (t) c.values[t.id] = [...(valueOf(c, t) as Row[]), { id, cells: { name: 'Hex' } }];
}

function party(names = ['Ann', 'Bo']): Doc {
	const doc = newDoc();
	doc.characters = names.map((n) => newCharacter(n, doc.templates[0]));
	return doc;
}

/** One browser: what it shows, and what it has sent but the room has not confirmed. */
class Client {
	replica: Replica<Doc>;
	shown: Doc;
	outbox: Change[] = [];
	inbox: Down[] = [];

	constructor(doc: Doc) {
		this.replica = new Replica(clone(doc));
		this.shown = this.replica.rebuild();
	}

	steps: { f: Op[]; i: Op[] }[] = [];

	/** As `session.change` does: diff snapshots taken around the edit. */
	edit(fn: (d: Doc) => void) {
		const before = clone(this.shown);
		fn(this.shown);
		const after = clone(this.shown);
		const ops = diff(before, after);
		if (!ops.length) return;
		this.steps.push({ f: ops, i: diff(after, before) });
		this.send(ops);
	}

	/** As `session.undo` does: takes back its last edit wherever nobody has changed it since. */
	undo() {
		const s = this.steps.pop();
		if (!s) return;
		const ops = revert(this.shown, s.f, s.i);
		for (const op of ops) apply(this.shown, op);
		if (ops.length) this.send(ops);
	}

	send(ops: Op[]) {
		const c = { id: newId(), ops };
		this.replica.pending.push(c);
		this.outbox.push(c);
	}

	take() {
		const m = this.inbox.shift()!;
		if (m.t === 'ack') this.replica.ack(m.id);
		else if (m.t === 'change') this.replica.remote(m.ops, this.shown);
		else if (m.t === 'reject') {
			this.replica.reject(m.id);
			this.shown = this.replica.rebuild();
		}
	}
}

/** The room: applies each change in arrival order and tells everyone. */
class Room {
	constructor(
		public doc: Doc,
		public refuse: (d: Doc) => boolean = () => false
	) {}

	receive(from: Client, c: Change, all: Client[]) {
		const before = clone(this.doc);
		for (const op of c.ops) apply(this.doc, op);
		if (this.refuse(this.doc)) {
			this.doc = before;
			from.inbox.push({ t: 'reject', id: c.id, reason: 'no' });
			return;
		}
		from.inbox.push({ t: 'ack', id: c.id });
		for (const o of all) if (o !== from) o.inbox.push({ t: 'change', ...clone(c) });
	}
}

describe('diff and apply', () => {
	const edits: [string, (d: Doc) => void][] = [
		[
			'a value',
			(d) => (d.characters[0].values[d.characters[0].fields[0].id] = { cur: 3, max: 10 })
		],
		['a name', (d) => (d.characters[1].name = 'Bea')],
		['a box', (d) => (d.characters[0].fields[1].box = { x: 8, y: 8, w: 64, h: 64 })],
		['an added character', (d) => d.characters.push(newCharacter('Cy'))],
		['a removed character', (d) => d.characters.shift()],
		['a reorder', (d) => d.characters.reverse()],
		['a removed value', (d) => delete d.characters[0].values[d.characters[0].fields[0].id]],
		['tags', (d) => (d.characters[0].values.x = ['brave', 'tired'])],
		['a row', (d) => addRow(d.characters[0], 's')],
		['a clock', (d) => d.clocks[0].now++]
	];

	it.each(edits)('carries %s', (_, edit) => {
		const a = party();
		const b = clone(a);
		edit(b);
		const ops = diff(a, b);
		expect(ops.length).toBeGreaterThan(0);
		for (const op of ops) apply(a, op);
		expect(equal(a, b)).toBe(true);
	});

	it('addresses one field, not the character it sits on', () => {
		const a = party();
		const b = clone(a);
		b.characters[0].name = 'Anna';
		expect(diff(a, b)).toEqual([
			{ k: 'set', p: ['characters', a.characters[0].id, 'name'], v: 'Anna' }
		]);
	});

	it('names no order when a newcomer lands at the end anyway', () => {
		const a = party();
		const b = clone(a);
		b.characters.push(newCharacter('Cy'));
		expect(diff(a, b).map((op) => op.k)).toEqual(['set']);
	});

	it('drops an op whose target is gone', () => {
		const doc = party();
		const gone = { k: 'set' as const, p: ['characters', 'nobody', 'name'], v: 'x' };
		expect(apply(doc, gone)).toBe(false);
	});
});

describe('Replica', () => {
	it('keeps its own pending edit over an earlier one from someone else', () => {
		const doc = party();
		const [a, b] = [new Client(doc), new Client(doc)];
		const room = new Room(clone(doc));
		const id = doc.characters[0].id;
		a.edit((d) => (d.characters[0].name = 'from A'));
		b.edit((d) => (d.characters[0].name = 'from B'));
		// B's reaches the room first; A sees it before A's own is confirmed.
		room.receive(b, b.outbox.shift()!, [a, b]);
		a.take();
		expect(a.shown.characters[0].name).toBe('from A');
		room.receive(a, a.outbox.shift()!, [a, b]);
		a.take();
		b.take();
		b.take();
		for (const c of [a, b]) expect(c.shown).toEqual(room.doc);
		expect(room.doc.characters.find((c) => c.id === id)!.name).toBe('from A');
	});

	it('loses a pending edit inside a character someone deleted first', () => {
		const doc = party();
		const [a, b] = [new Client(doc), new Client(doc)];
		const room = new Room(clone(doc));
		a.edit((d) => (d.characters[0].name = 'renamed'));
		b.edit((d) => d.characters.shift());
		room.receive(b, b.outbox.shift()!, [a, b]);
		a.take();
		expect(a.shown.characters.map((c) => c.name)).toEqual(['Bo']);
		room.receive(a, a.outbox.shift()!, [a, b]);
		a.take();
		b.take();
		b.take();
		for (const c of [a, b]) expect(c.shown).toEqual(room.doc);
	});

	it('takes a refused change back off the screen', () => {
		const doc = party();
		const a = new Client(doc);
		const room = new Room(clone(doc), (d) => d.characters.some((c) => c.name === ''));
		a.edit((d) => (d.characters[0].name = ''));
		room.receive(a, a.outbox.shift()!, [a]);
		a.take();
		expect(a.shown).toEqual(doc);
		expect(a.replica.pending).toEqual([]);
	});

	it('keeps a character this client put back whole in its own order', () => {
		const doc = party();
		const a = new Client(doc);
		const b = new Client(doc);
		a.edit((d) => d.characters[0].fields.pop());
		a.edit((d) => d.characters.shift());
		a.undo();
		b.edit((d) => d.characters[0].fields.reverse());
		new Room(clone(doc)).receive(b, b.outbox.shift()!, [a, b]);
		a.take();
		expect(a.shown).toEqual(a.replica.rebuild());
	});

	it('brings every client to the room’s doc, whatever arrives when', () => {
		let seed = 7;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
		const moves: ((d: Doc) => void)[] = [
			(d) => d.characters.length && (pick(d.characters).name = `n${Math.floor(rand() * 9)}`),
			(d) => {
				const c = d.characters.length && pick(d.characters);
				if (c && c.fields.length) c.values[pick(c.fields).id] = Math.floor(rand() * 9);
			},
			(d) => d.characters.push(newCharacter(`c${Math.floor(rand() * 99)}`, d.templates[0])),
			(d) =>
				d.characters.length && d.characters.splice(Math.floor(rand() * d.characters.length), 1),
			(d) => d.characters.reverse(),
			(d) => {
				const c = d.characters.length && pick(d.characters);
				if (c && c.fields.length) c.fields.splice(Math.floor(rand() * c.fields.length), 1);
			},
			(d) => {
				if (d.characters.length < 2) return;
				const [c] = d.characters.splice(Math.floor(rand() * d.characters.length), 1);
				d.characters.splice(Math.floor(rand() * d.characters.length), 0, c);
			},
			(d) => d.characters.length && pick(d.characters).fields.reverse(),
			(d) => d.characters.length && addRow(pick(d.characters)),
			(d) => d.clocks[0].now++
		];

		for (let run = 0; run < 300; run++) {
			const doc = party(['A', 'B', 'C']);
			const clients = [new Client(doc), new Client(doc), new Client(doc)];
			const room = new Room(clone(doc));
			// What a client shows is always the confirmed doc with its pending edits on top.
			const take = (c: Client) => {
				c.take();
				expect(c.shown).toEqual(c.replica.rebuild());
			};
			for (let step = 0; step < 60; step++) {
				const c = pick(clients);
				const r = rand();
				if (r < 0.35) c.edit(pick(moves));
				else if (r < 0.45) c.undo();
				else if (r < 0.7 && c.outbox.length) room.receive(c, c.outbox.shift()!, clients);
				else if (c.inbox.length) take(c);
			}
			while (clients.some((c) => c.outbox.length || c.inbox.length)) {
				for (const c of clients) {
					if (c.outbox.length) room.receive(c, c.outbox.shift()!, clients);
					while (c.inbox.length) take(c);
				}
			}
			for (const c of clients) expect(c.shown).toEqual(room.doc);
		}
	}, 20_000);
});

describe('revert', () => {
	it('undoes only what nobody has changed since', () => {
		const before = party();
		const after = clone(before);
		after.characters[0].name = 'mine';
		after.characters[1].name = 'mine too';
		const f = diff(before, after);
		const i = diff(after, before);
		const now = clone(after);
		now.characters[1].name = 'theirs';
		const back = revert(now, f, i);
		for (const op of back) apply(now, op);
		expect(now.characters.map((c) => c.name)).toEqual(['Ann', 'theirs']);
	});
});

describe('isPropose and isSettle', () => {
	it('take a draft with what was asked, and an answer to one', () => {
		const ops = [{ k: 'set', p: ['clocks', 'k1', 'name'], v: 'Round' }];
		expect(isPropose({ id: 'x', propose: { ops, asked: 'Rename Turn' } })).toBe(true);
		expect(isPropose({ id: 'x', propose: { ops } })).toBe(false);
		expect(
			isPropose({ id: 'x', propose: { ops: [{ k: 'set', p: ['log'], v: [] }], asked: '' } })
		).toBe(false);
		expect(isSettle({ id: 'y', settle: { proposal: 'x', ok: true } })).toBe(true);
		expect(isSettle({ id: 'y', settle: { proposal: 'x' } })).toBe(false);
	});
});

describe('isChange', () => {
	it('refuses ops outside the document or onto a whole list', () => {
		const ok = { id: 'x', ops: [{ k: 'set', p: ['characters', 'c', 'name'], v: 'a' }] };
		expect(isChange(ok)).toBe(true);
		expect(isChange({ id: 'x', ops: [{ k: 'set', p: ['version'], v: 9 }] })).toBe(false);
		expect(isChange({ id: 'x', ops: [{ k: 'set', p: ['characters'], v: [] }] })).toBe(false);
		expect(isChange({ id: 'x', ops: [{ k: 'set', p: ['characters', '__proto__'], v: 1 }] })).toBe(
			false
		);
	});
});
