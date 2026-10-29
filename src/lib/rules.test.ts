import { describe, expect, it } from 'vitest';
import {
	newCharacter,
	newDoc,
	globalId,
	newId,
	type Character,
	type Doc,
	type Field,
	type Kind,
	type Row,
	type Value,
	type When
} from './doc';
import { names, rowNames } from './formula';
import { LOG, compileRule, fire, hint, isAct, ready, sheetOf, type Act } from './rules';
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
	(on.rules ??= []).push(compileRule(typed, names(sheetOf(doc, c))));
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

	it('hints what a press does, a line a rule, then why it cannot be pressed', () => {
		expect(hint(doc, c, step.id, true)).toBe('Charge += 1\nSteps += 1');
		expect(hint(doc, c, use.id, 'Waiting for the room to come back.')).toBe(
			'Charge = 0 (if Charge = Charge.max)\nWaiting for the room to come back.'
		);
	});
});

describe('poison: every turn HP falls by the stacks, then the stacks by 1d10 + Stamina', () => {
	const doc = newDoc();
	const turn = doc.clocks[0];
	// The Basic template's Statuses table: a status is a row, and Left counts down.
	const c = newCharacter('Ash', doc.templates[0]);
	doc.characters.push(c);
	const [hp, , statuses] = c.fields;
	c.values[hp.id] = { cur: 30, max: 30 };
	add(c, 'Stamina', 'number', 2);
	const [name, stacks, left] = statuses.columns!;
	const known = [...rowNames(statuses), ...names(sheetOf(doc, c))];
	const poison = {
		id: newId(),
		when: { tick: turn.id },
		if: 'AND(Name = "Poison", Stacks > 0)',
		then: ['HP -= Stacks', 'Stacks = MAX(0, Stacks - 1d10 - Stamina)']
	};
	stacks.rules = [compileRule(poison, known)];
	c.values[statuses.id] = [
		{ id: 'p', cells: { [name.id]: 'Poison', [stacks.id]: 12 } },
		{ id: 's', cells: { [name.id]: 'Stunned', [left.id]: 2 } }
	];
	const cell = (row: number, col: string) => (get(c, statuses) as Row[])[row].cells[col];
	const roll = dice(1, 6, 9);
	const next = () => fire(doc, { tick: { clock: turn.id, at: turn.now } }, roll);
	const back = () => fire(doc, { back: { clock: turn.id, at: turn.now } }, roll);

	it('runs each turn until the stacks run out, as Left counts down', () => {
		next();
		expect(get(c, hp)).toEqual({ cur: 18, max: 30 });
		expect(cell(0, stacks.id)).toBe(9);
		expect(doc.log!.at(-1)!.text).toBe(
			'Turn 1 → 2 · Ash: HP 30/30 → 18/30, Statuses Poison: Stacks 12 → 9, ' +
				'Statuses Stunned: Left 2 → 1 (1d10: 1)'
		);
		next();
		expect(get(c, hp)).toEqual({ cur: 9, max: 30 });
		expect([cell(0, stacks.id), cell(1, left.id)]).toEqual([1, 0]);
		next();
		expect(get(c, hp)).toEqual({ cur: 8, max: 30 });
		expect(cell(0, stacks.id)).toBe(0);
		next();
		expect(get(c, hp)).toEqual({ cur: 8, max: 30 });
		expect(turn.now).toBe(5);
	});

	it('steps back through every turn, poison and all', () => {
		for (let i = 0; i < 4; i++) back();
		expect(turn.now).toBe(1);
		expect(get(c, hp)).toEqual({ cur: 30, max: 30 });
		expect([cell(0, stacks.id), cell(1, left.id)]).toEqual([12, 2]);
		expect(doc.log!.at(-1)!.text).toBe(
			'Back: Turn 2 → 1 · Ash: HP 18/30 → 30/30, Statuses Poison: Stacks 9 → 12, ' +
				'Statuses Stunned: Left 1 → 2'
		);
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
		const row = { character: 'c', field: 't', column: 'b', row: 'r' };
		expect(isAct({ id: 'a', act: { press: row } })).toBe(true);
		expect(isAct({ id: 'a', act: { press: { ...row, row: undefined } } })).toBe(false);
		expect(isAct({ id: 'a', act: { press: { ...row, column: undefined } } })).toBe(true);
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

describe('a map: a press moves it, and its rules count steps', () => {
	function setup() {
		const doc = newDoc();
		const gm = newCharacter('GM');
		doc.characters.push(gm);
		const name = { id: newId(), name: 'Name', kind: 'text' as const };
		const rows: Row[] = ['Town', 'Forest', 'Hut'].map((n) => ({
			id: n.toLowerCase(),
			cells: { [name.id]: n }
		}));
		const places = add(gm, 'Places', 'table', rows);
		places.columns = [name];
		const map = add(gm, 'Map', 'map', 'town');
		map.from = globalId(gm, places);
		map.parents = { town: '', forest: 'town', hut: 'forest' };
		const steps = add(gm, 'Steps', 'number', 0);
		const visits = add(gm, 'Visits', 'number', 0);
		rule(doc, gm, steps, { press: map.id }, '', 'Steps += 1');
		rule(doc, gm, visits, { press: map.id }, 'Map = "Hut"', 'Visits += 1');
		const press = (row: string) =>
			fire(doc, { press: { character: gm.id, field: map.id, row } }, dice(1));
		return { doc, gm, map, steps, visits, places, press };
	}

	it('moves to the node pressed, any node, and logs the move with its rules', () => {
		const { doc, gm, map, steps, visits, press } = setup();
		press('hut');
		expect(get(gm, map)).toBe('hut');
		expect(get(gm, steps)).toBe(1);
		expect(get(gm, visits)).toBe(1);
		expect(doc.log!.at(-1)!.text).toBe('Map Town → Hut · GM: Steps 0 → 1, Visits 0 → 1');
	});

	it('moves even when no rule listens, and takes the move back with its rules', () => {
		const { doc, gm, map, steps, press } = setup();
		const before = structuredClone(doc.characters);
		const done = press('forest');
		expect(get(gm, steps)).toBe(1);
		for (const op of done.undo) apply(doc, op);
		expect(equal(doc.characters, before)).toBe(true);
		steps.rules = [];
		press('forest');
		expect(get(gm, map)).toBe('forest');
		expect(doc.log!.at(-1)!.text).toBe('Map Town → Forest');
	});

	it('does nothing for the node already current, or a row that is gone', () => {
		const { gm, steps, press } = setup();
		expect(press('town').ops).toEqual([]);
		expect(press('cave').why).toBe('that place is gone');
		expect(get(gm, steps)).toBe(0);
	});
});

describe('a table: a sacrifice button and a cooldown in every row', () => {
	const doc = newDoc();
	const turn = doc.clocks[0];
	const c = newCharacter('Ash');
	doc.characters.push(c);
	const ids = { name: newId(), state: newId(), wait: newId(), give: newId() };
	const lib = add(c, '碎片库', 'table');
	lib.columns = [
		{ id: ids.name, name: '名称', kind: 'text' },
		{ id: ids.state, name: '状态', kind: 'choice', choices: ['持有', '已献祭'] },
		{ id: ids.wait, name: '冷却', kind: 'track' },
		{ id: ids.give, name: '献祭', kind: 'button' }
	];
	const rows = [
		{ id: 'r1', cells: { [ids.name]: '怀表', [ids.state]: '持有', [ids.wait]: [true, true] } },
		{ id: 'r2', cells: { [ids.name]: '旧伤', [ids.state]: '持有', [ids.wait]: [true, false] } },
		{ id: 'r3', cells: { [ids.name]: '空' } }
	];
	c.values[lib.id] = rows;
	const given = add(c, '献祭数', 'number', 0);
	const known = [...rowNames(lib), ...names(sheetOf(doc, c))];
	const typed = (when: When, cond: string, ...then: string[]) =>
		compileRule({ id: newId(), when, ...(cond && { if: cond }), then }, known);
	lib.columns[1].rules = [typed({ press: ids.give }, '状态 = "持有"', '状态 = "已献祭"')];
	lib.columns[2].rules = [typed({ tick: turn.id }, '', '冷却 -= 1')];
	rule(doc, c, given, { press: ids.give }, '', '献祭数 += 1');
	const press = (row: string) =>
		fire(doc, { press: { character: c.id, field: lib.id, column: ids.give, row } }, dice(1));
	const cell = (row: number, id: string) => (c.values[lib.id] as typeof rows)[row].cells[id];

	it("changes only the pressed row's cells, and fields too", () => {
		expect(lib.columns![1].rules![0].then[0]).toBe(`@${ids.state} = "已献祭"`);
		press('r1');
		expect(cell(0, ids.state)).toBe('已献祭');
		expect(cell(1, ids.state)).toBe('持有');
		expect(get(c, given)).toBe(1);
		expect(doc.log!.at(-1)!.text).toBe(
			'献祭 · 碎片库 怀表 · Ash: 献祭数 0 → 1, 碎片库 怀表: 状态 "持有" → "已献祭"'
		);
	});

	it("knows a row's button is spent where its condition fails", () => {
		const row = (i: number) => ({ table: lib, row: (c.values[lib.id] as typeof rows)[i] });
		expect(ready(doc, c, ids.give, row(0))).toBe(true);
		press('r2');
		expect(cell(1, ids.state)).toBe('已献祭');
	});

	it('runs a column rule for every row when the clock ticks, leaving a blank cell be', () => {
		fire(doc, { tick: { clock: turn.id, at: 1 } }, dice(1));
		expect(cell(0, ids.wait)).toEqual([true, false]);
		expect(cell(1, ids.wait)).toEqual([false, false]);
		expect(cell(2, ids.wait)).toBeUndefined();
		expect(doc.log!.at(-1)!.text).toBe(
			'Turn 1 → 2 · Ash: 碎片库 怀表: 冷却 2/2 → 1/2, 碎片库 旧伤: 冷却 1/2 → 0/2'
		);
	});

	it('shows a blank cell a rule fills as —', () => {
		lib.columns![2].rules = [typed({ tick: turn.id }, '', '冷却 += 1')];
		fire(doc, { tick: { clock: turn.id, at: 2 } }, dice(1));
		expect(cell(2, ids.wait)).toEqual([true, false, false, false]);
		expect(doc.log!.at(-1)!.text).toContain('碎片库 空: 冷却 — → 1/4');
	});
});

describe('a track flipped between odd and even boxes, and tags added and taken', () => {
	const doc = newDoc();
	const c = newCharacter('Ash');
	doc.characters.push(c);
	const ids = { name: newId(), wait: newId(), flip: newId(), marks: newId() };
	const lib = add(c, '碎片库', 'table');
	lib.columns = [
		{ id: ids.name, name: '名称', kind: 'text' },
		{ id: ids.wait, name: '冷却', kind: 'track' },
		{ id: ids.flip, name: '翻转', kind: 'button' },
		{ id: ids.marks, name: '标记', kind: 'tags' }
	];
	const blank6 = Array<boolean>(6).fill(false);
	c.values[lib.id] = [
		{ id: 'r1', cells: { [ids.name]: '怀表', [ids.wait]: blank6 } },
		{ id: 'r2', cells: { [ids.name]: '旧伤', [ids.wait]: [true, false, false] } }
	];
	const known = [...rowNames(lib), ...names(sheetOf(doc, c))];
	lib.columns[1].rules = [
		compileRule(
			{
				id: newId(),
				when: { press: ids.flip },
				then: [
					'冷却.boxes = IF(LEFT(冷却.boxes, 1) = "x", LEFT(REPT(".x", 50), 冷却.max), LEFT(REPT("x.", 50), 冷却.max))'
				]
			},
			known
		)
	];
	const press = (row: string) =>
		fire(doc, { press: { character: c.id, field: lib.id, column: ids.flip, row } }, dice(1));
	const cell = (row: number, id: string) => (c.values[lib.id] as Row[])[row].cells[id];

	it("flips only the pressed row's boxes, and logs a flip that keeps the count by its boxes", () => {
		press('r1');
		expect(cell(0, ids.wait)).toEqual([true, false, true, false, true, false]);
		press('r1');
		expect(cell(0, ids.wait)).toEqual([false, true, false, true, false, true]);
		expect(cell(1, ids.wait)).toEqual([true, false, false]);
		expect(doc.log!.at(-1)!.text).toBe(
			'翻转 · 碎片库 怀表 · Ash: 碎片库 怀表: 冷却 x.x.x. → .x.x.x'
		);
	});

	it('sets boxes from x and . only', () => {
		lib.columns![1].rules = [
			compileRule({ id: newId(), when: { press: ids.flip }, then: ['冷却.boxes = "xo"'] }, known)
		];
		press('r2');
		expect(cell(1, ids.wait)).toEqual([true, false, false]);
		expect(doc.log!.at(-1)!.text).toContain('boxes are x (ticked) and . (empty), not "xo"');
	});

	it('adds a tag once and takes one away, however it is capitalised', () => {
		const marks = add(c, 'Marks', 'tags', ['Poisoned']);
		const cleanse = add(c, 'Cleanse', 'button');
		rule(
			doc,
			c,
			marks,
			{ press: cleanse.id },
			'',
			'Marks += "Blessed、Calm"',
			'Marks -= "poisoned"',
			'Marks += "calm"'
		);
		fire(doc, { press: { character: c.id, field: cleanse.id } }, dice(1));
		expect(get(c, marks)).toEqual(['Blessed', 'Calm']);
		expect(doc.log!.at(-1)!.text).toBe('Cleanse · Ash: Marks Poisoned → Blessed, Calm');
		rule(doc, c, marks, { press: cleanse.id }, '', 'Marks = ""');
		fire(doc, { press: { character: c.id, field: cleanse.id } }, dice(1));
		expect(get(c, marks)).toEqual([]);
	});

	it('leaves an empty tags cell empty when there is nothing to take', () => {
		lib.columns![3].rules = [
			compileRule({ id: newId(), when: { press: ids.flip }, then: ['标记 -= "x"'] }, known)
		];
		lib.columns![1].rules = [];
		press('r1');
		expect(cell(0, ids.marks)).toBeUndefined();
	});
});

describe("a press heard on other characters' sheets", () => {
	function setup() {
		const doc = newDoc();
		const gm = newCharacter('GM');
		gm.hidden = true;
		const [ash, bea] = ['Ash', 'Bea'].map((n) => newCharacter(n));
		doc.characters.push(gm, ash, bea);
		const gas = add(gm, 'Gas', 'button');
		// One rule, as a template gives every player the same: it hears the GM's Gas.
		const heard = { id: newId(), when: { press: globalId(gm, gas) }, then: ['Coughs += 1'] };
		const coughs = [ash, bea].map((c) => {
			const f = add(c, 'Coughs', 'number', 0);
			f.rules = [compileRule(heard, names(sheetOf(doc, c)))];
			return f;
		});
		const press = (c: Character, f: Field, row?: string) =>
			fire(doc, { press: { character: c.id, field: f.id, row } }, dice(1));
		return { doc, gm, ash, bea, gas, coughs, press };
	}

	it('runs every rule that hears it, on its own character, and ⌘Z takes them all back', () => {
		const { doc, gm, ash, bea, gas, coughs, press } = setup();
		const gassed = add(gm, 'Gassed', 'number', 0);
		rule(doc, gm, gassed, { press: gas.id }, '', 'Gassed += 1');
		const done = press(gm, gas);
		expect([get(gm, gassed), get(ash, coughs[0]), get(bea, coughs[1])]).toEqual([1, 1, 1]);
		expect(doc.log!.at(-1)!.text).toBe(
			'Gas · GM: Gassed 0 → 1 · Ash: Coughs 0 → 1 · Bea: Coughs 0 → 1'
		);
		for (const op of done.undo) apply(doc, op);
		expect([get(gm, gassed), get(ash, coughs[0]), get(bea, coughs[1])]).toEqual([0, 0, 0]);
	});

	it('is ready when only another character hears it, and its hint names who', () => {
		const { doc, gm, bea, gas, coughs } = setup();
		expect(ready(doc, gm, gas.id)).toBe(true);
		expect(hint(doc, gm, gas.id, true)).toBe('Ash, Bea: Coughs += 1');
		for (const f of coughs) f.rules![0].if = 'Coughs < 1';
		bea.values[coughs[1].id] = 1;
		expect(ready(doc, gm, gas.id)).toBe(true);
		doc.characters[1].values[coughs[0].id] = 1;
		expect(ready(doc, gm, gas.id)).toMatch(/None of its rules/);
	});

	it("hears the GM's map move, reading the node pressed", () => {
		const { doc, gm, ash, press } = setup();
		const name = { id: newId(), name: 'Name', kind: 'text' as const };
		const places = add(gm, 'Places', 'table', [
			{ id: 'town', cells: { [name.id]: 'Town' } },
			{ id: 'hut', cells: { [name.id]: 'Hut' } }
		]);
		places.columns = [name];
		const map = add(gm, 'Map', 'map', 'town');
		map.from = globalId(gm, places);
		map.parents = { town: '', hut: 'town' };
		const visits = add(ash, 'Visits', 'number', 0);
		rule(doc, ash, visits, { press: globalId(gm, map) }, 'GM!Map = "Hut"', 'Visits += 1');
		press(gm, map, 'hut');
		expect(get(ash, visits)).toBe(1);
		expect(doc.log!.at(-1)!.text).toBe('Map Town → Hut · Ash: Visits 0 → 1');
	});

	it('runs a rule that hears its own button by its global name, once', () => {
		const { doc, gm, gas, press } = setup();
		const gassed = add(gm, 'Gassed', 'number', 0);
		rule(doc, gm, gassed, { press: globalId(gm, gas) }, '', 'Gassed += 1');
		press(gm, gas);
		expect(get(gm, gassed)).toBe(1);
	});
});
