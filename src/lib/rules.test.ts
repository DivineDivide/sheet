import { describe, expect, it } from 'vitest';
import {
	newCharacter,
	newDoc,
	newId,
	type Character,
	type Doc,
	type Field,
	type Kind,
	type Value,
	type When
} from './doc';
import { names } from './formula';
import {
	LOG,
	applyPreset,
	compileRule,
	fire,
	isAct,
	ready,
	rebind,
	sheetOf,
	type Act
} from './rules';
import { apply, equal } from './sync';

const box = { x: 0, y: 0, w: 96, h: 56 };

/** Dice that land on these faces, in turn. */
const dice = (...faces: number[]) => {
	let i = 0;
	return () => faces[i++ % faces.length];
};

function add(c: Character, label: string, kind: Kind, value?: Value): Field {
	const f: Field = { id: newId(), label, kind, tab: c.tabs[0].id, box };
	c.fields.push(f);
	if (value !== undefined) c.values[f.id] = value;
	return f;
}

/** A rule as someone types it in the inspector, labels and all. */
function rule(doc: Doc, c: Character, on: Field, when: When, cond: string, ...then: string[]) {
	const typed = { id: newId(), when, ...(cond && { if: cond }), then };
	(on.rules ??= []).push(compileRule(typed, names(sheetOf(doc, c)), 'character'));
}

const get = (c: Character, f: Field) => c.values[f.id];
const ticks = (c: Character, f: Field) => (get(c, f) as boolean[]).filter(Boolean).length;

describe('map steps: a skill usable once every 4 steps', () => {
	const doc = newDoc();
	const c = newCharacter('Ash');
	doc.characters.push(c);
	const step = add(c, 'Map step', 'button');
	const use = add(c, 'Use 技能', 'button');
	const charge = add(c, 'Charge', 'track', [false, false, false, false]);
	const steps = add(c, 'Steps', 'number', 0);
	rule(doc, c, charge, { press: step.id }, '', 'Charge += 1');
	rule(doc, c, charge, { press: use.id }, 'Charge = Charge.max', 'Charge = 0');
	rule(doc, c, steps, { press: step.id }, '', 'Steps += 1');
	const press = (b: Field) => fire(doc, { press: { character: c.id, field: b.id } }, dice(1));

	it('charges one box a step, stopping when full', () => {
		expect(ready(doc, c, use.id)).not.toBe(true);
		for (let i = 0; i < 3; i++) press(step);
		expect(ticks(c, charge)).toBe(3);
		expect(ready(doc, c, use.id)).not.toBe(true);
		press(step);
		press(step);
		expect(ticks(c, charge)).toBe(4);
		expect(get(c, steps)).toBe(5);
		expect(doc.log!.at(-1)!.text).toBe('Map step · Ash: Steps 4 → 5');
	});

	it('lets the skill be used once charged, then cools it down', () => {
		expect(ready(doc, c, use.id)).toBe(true);
		const done = press(use);
		expect(ticks(c, charge)).toBe(0);
		expect(doc.log!.at(-1)!.text).toBe('Use 技能 · Ash: Charge 4/4 → 0/4');
		expect(ready(doc, c, use.id)).not.toBe(true);
		expect(press(use).why).toMatch(/none of its rules/);
		// What the presser's ⌘Z sends takes the use back exactly.
		for (const op of done.undo) apply(doc, op);
		expect(ticks(c, charge)).toBe(4);
	});

	it('says a button nothing listens to does nothing', () => {
		const idle = add(c, 'Idle', 'button');
		expect(ready(doc, c, idle.id)).toMatch(/No rule listens/);
	});
});

describe('poison: every turn HP falls by the stacks, then the stacks by 1d10 + Stamina', () => {
	const doc = newDoc();
	const turn = doc.clocks[0];
	const c = newCharacter('Ash');
	doc.characters.push(c);
	const hp = add(c, 'HP', 'resource', { cur: 30, max: 30 });
	add(c, 'Stamina', 'number', 2);
	doc.presets = [
		{
			id: 'poison',
			name: 'Poison',
			clock: turn.id,
			rules: [
				{
					id: 'r',
					when: { tick: turn.id },
					if: 'Poison > 0',
					then: ['HP -= Poison', 'Poison -= 1d10 + Stamina']
				}
			]
		}
	];
	applyPreset(doc, c, doc.presets[0], 12);
	const poison = c.statuses[0];
	const roll = dice(1, 6, 9);
	const next = () => fire(doc, { tick: { clock: turn.id, at: turn.now } }, roll);
	const back = () => fire(doc, { back: { clock: turn.id, at: turn.now } }, roll);

	it("binds the preset's rules to this character's fields", () => {
		expect(poison).toMatchObject({ name: 'Poison', stacks: 12, since: 1, preset: 'poison' });
		expect(poison.rules![0].then[0]).toBe(`@${hp.id} -= Poison`);
	});

	it('runs each turn until the stacks run out', () => {
		next();
		expect(get(c, hp)).toEqual({ cur: 18, max: 30 });
		expect(poison.stacks).toBe(9);
		expect(doc.log!.at(-1)!.text).toBe(
			'Turn 1 → 2 · Ash: HP 30/30 → 18/30, Poison 12 → 9 (1d10: 1)'
		);
		next();
		expect(get(c, hp)).toEqual({ cur: 9, max: 30 });
		expect(poison.stacks).toBe(1);
		next();
		expect(get(c, hp)).toEqual({ cur: 8, max: 30 });
		expect(poison.stacks).toBe(0);
		next();
		expect(get(c, hp)).toEqual({ cur: 8, max: 30 });
		expect(turn.now).toBe(5);
	});

	it('steps back through every turn, poison and all', () => {
		for (let i = 0; i < 4; i++) back();
		expect(turn.now).toBe(1);
		expect(get(c, hp)).toEqual({ cur: 30, max: 30 });
		expect(poison.stacks).toBe(12);
		expect(doc.log!.at(-1)!.text).toBe('Back: Turn 2 → 1 · Ash: HP 18/30 → 30/30, Poison 9 → 12');
	});

	it('adds to the stacks when applied again', () => {
		applyPreset(doc, c, doc.presets![0], 3);
		expect(c.statuses).toHaveLength(1);
		expect(poison.stacks).toBe(15);
	});
});

describe('firing', () => {
	function setup() {
		const doc = newDoc();
		const c = newCharacter('Ash');
		doc.characters.push(c);
		return { doc, c, turn: doc.clocks[0] };
	}

	it('moves a clock once when two people press Next at the same reading', () => {
		const { doc, turn } = setup();
		const act: Act = { tick: { clock: turn.id, at: 1 } };
		expect(fire(doc, act, dice(1)).ops.length).toBeGreaterThan(0);
		expect(fire(doc, act, dice(1))).toEqual({ ops: [], undo: [], why: undefined });
		expect(turn.now).toBe(2);
	});

	it('tests every condition before any rule runs', () => {
		const { doc, c } = setup();
		const use = add(c, 'Use', 'button');
		const charge = add(c, 'Charge', 'track', [true, true]);
		const uses = add(c, 'Uses', 'number', 0);
		rule(doc, c, charge, { press: use.id }, 'Charge = Charge.max', 'Charge = 0');
		rule(doc, c, uses, { press: use.id }, 'Charge = Charge.max', 'Uses += 1');
		fire(doc, { press: { character: c.id, field: use.id } }, dice(1));
		expect(ticks(c, charge)).toBe(0);
		expect(get(c, uses)).toBe(1);
	});

	it('takes back the whole of a rule that fails part-way, and logs why', () => {
		const { doc, c } = setup();
		const b = add(c, 'Go', 'button');
		const n = add(c, 'N', 'number', 1);
		add(c, 'Notes', 'text', 'abc');
		rule(doc, c, n, { press: b.id }, '', 'N += 1', 'N = Notes * 2');
		const done = fire(doc, { press: { character: c.id, field: b.id } }, dice(1));
		expect(get(c, n)).toBe(1);
		expect(done.undo).toEqual([]);
		expect(doc.log!.at(-1)!.text).toMatch(/^Go · Ash: N's rule stopped: #VALUE!/);
	});

	it('runs a clock rule on the clocks, without setting off their own rules', () => {
		const { doc, turn } = setup();
		const round = { id: newId(), name: 'Round', now: 1 };
		doc.clocks.push(round);
		const known = names(sheetOf(doc));
		turn.rules = [
			compileRule(
				{ id: 'r', when: { tick: turn.id }, if: 'MOD(Turn, 4) = 1', then: ['Round += 1'] },
				known,
				'clocks'
			)
		];
		for (let at = 1; at <= 8; at++) fire(doc, { tick: { clock: turn.id, at } }, dice(1));
		expect(turn.now).toBe(9);
		expect(round.now).toBe(3);
		expect(doc.log!.at(-1)!.text).toBe('Turn 8 → 9 · Round 2 → 3');
	});

	it('undoes an act exactly with the ops it returns', () => {
		const { doc, c, turn } = setup();
		const hp = add(c, 'HP', 'resource', { cur: 10, max: 10 });
		rule(doc, c, hp, { tick: turn.id }, '', 'HP -= 2d6', 'HP.max = 12');
		const before = structuredClone(doc.characters);
		const done = fire(doc, { tick: { clock: turn.id, at: 1 } }, dice(3, 4));
		expect(get(c, hp)).toEqual({ cur: 3, max: 12 });
		for (const op of done.undo) apply(doc, op);
		expect(equal(doc.characters, before)).toBe(true);
		expect(turn.now).toBe(1);
	});

	it(`keeps the last ${LOG} lines`, () => {
		const { doc, turn } = setup();
		for (let at = 1; at <= LOG + 5; at++) fire(doc, { tick: { clock: turn.id, at } }, dice(1));
		expect(doc.log).toHaveLength(LOG);
		expect(doc.log![0].text).toBe('Turn 6 → 7');
	});

	it('takes only well-formed acts from a client', () => {
		expect(isAct({ id: 'a', act: { tick: { clock: 'k', at: 3 } } })).toBe(true);
		expect(isAct({ id: 'a', act: { press: { character: 'c', field: 'f' } } })).toBe(true);
		expect(isAct({ id: 'a', act: { tick: { clock: 'k', at: 'now' } } })).toBe(false);
		expect(isAct({ id: 'a', act: { tick: { clock: 'k', at: 1 }, back: {} } })).toBe(false);
		expect(isAct({ id: 'a', ops: [] })).toBe(false);
	});

	it("moves a pasted field's rules with it, onto its own character or another", () => {
		const { doc, c } = setup();
		const go = add(c, 'Go', 'button');
		const n = add(c, 'N', 'number', 0);
		const m = add(c, 'M', 'number', 0);
		rule(doc, c, n, { press: go.id }, 'M > 0', 'N += M');
		const from = { id: n.id, names: names(sheetOf(doc, c)) };

		const copy: Field = { ...n, id: newId(), label: 'N 2' };
		const [same] = rebind(n.rules!, from, copy, null);
		expect(same.then).toEqual([`@${copy.id} += @${m.id}`]);
		expect(same.when).toEqual({ press: go.id });

		const other = newCharacter('Bo');
		doc.characters.push(other);
		const go2 = add(other, 'Go', 'button');
		const m2 = add(other, 'M', 'number', 0);
		const there: Field = { ...n, id: newId(), tab: other.tabs[0].id };
		const known = names(sheetOf(doc, { ...other, fields: [...other.fields, there] }));
		const [moved] = rebind(n.rules!, from, there, known);
		expect(moved).toMatchObject({
			when: { press: go2.id },
			if: `@${m2.id} > 0`,
			then: [`@${there.id} += @${m2.id}`]
		});
	});

	it('runs no rules on a field whose kind cannot hold them', () => {
		const { doc, c } = setup();
		const go = add(c, 'Go', 'button');
		const n = add(c, 'N', 'number', 0);
		rule(doc, c, n, { press: go.id }, '', 'N += 1');
		n.kind = 'formula';
		expect(ready(doc, c, go.id)).toMatch(/No rule listens/);
	});
});
