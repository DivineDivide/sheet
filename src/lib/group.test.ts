import { describe, expect, it } from 'vitest';
import {
	globalId,
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
import { compile, names, refText, result } from './formula';
import { lift, place } from './group';
import { compileRule, fire, sheetOf } from './rules';

function add(c: Character, label: string, kind: Kind, value?: Value, x = 0, y = 0): Field {
	const f: Field = { id: newId(), label, kind, tab: c.tabs[0].id, box: { x, y, w: 96, h: 56 } };
	c.fields.push(f);
	if (value !== undefined) c.values[f.id] = value;
	return f;
}

function rule(doc: Doc, c: Character, on: Field, when: When, ...then: string[]) {
	(on.rules ??= []).push(compileRule({ id: newId(), when, then }, names(sheetOf(doc, c))));
}

const by = (c: Character, label: string) => c.fields.find((f) => f.label === label)!;

/** Ash with a combat block (HP, Armor, Attack) and a Dodge that reads DEX from outside it. */
function setup() {
	const doc = newDoc();
	const ash = newCharacter('Ash');
	const bea = newCharacter('Bea');
	doc.characters.push(ash, bea);
	add(ash, 'DEX', 'number', 3);
	const hp = add(ash, 'HP', 'resource', { cur: 10, max: 10 }, 400, 200);
	add(ash, 'Armor', 'number', 2, 520, 200);
	const attack = add(ash, 'Attack', 'button', undefined, 400, 280);
	const dodge = add(ash, 'Dodge', 'formula', undefined, 520, 280);
	dodge.formula = `@${by(ash, 'DEX').id} * 2`;
	rule(doc, ash, hp, { press: attack.id }, 'HP -= 3 - Armor');
	add(bea, 'DEX', 'number', 5);
	add(bea, 'HP', 'resource', { cur: 20, max: 20 });
	const block = ['HP', 'Armor', 'Attack', 'Dodge'].map((l) => by(ash, l).id);
	return { doc, ash, bea, block };
}

describe('copying fields together', () => {
	it('lifts a group from its top-left, naming only what it reads outside', () => {
		const { doc, ash, block } = setup();
		const g = lift(ash, doc.clocks, block, false);
		expect(g.fields.map((f) => [f.label, f.box.x, f.box.y])).toEqual([
			['HP', 0, 0],
			['Armor', 120, 0],
			['Attack', 0, 80],
			['Dodge', 120, 80]
		]);
		expect(g.names.map((n) => n.label)).toEqual(['DEX']);
		expect(g.values).toBeUndefined();
	});

	it("pastes a combat block onto Bea whose Attack changes Bea's HP, not Ash's", () => {
		const { doc, ash, bea, block } = setup();
		place(lift(ash, doc.clocks, block, true), bea, doc.clocks, bea.tabs[0].id, { x: 0, y: 160 });
		const hp2 = by(bea, 'HP 2');
		expect(hp2.box).toMatchObject({ x: 0, y: 160 });
		expect(bea.values[hp2.id]).toEqual({ cur: 10, max: 10 });
		expect(by(bea, 'Dodge').formula).toBe(`@${by(bea, 'DEX').id} * 2`);

		const done = fire(doc, { press: { character: bea.id, field: by(bea, 'Attack').id } }, () => 1);
		expect(done.ops.some((op) => op.p[1] === ash.id)).toBe(false);
		expect(bea.values[hp2.id]).toEqual({ cur: 9, max: 10 });
		expect(bea.values[by(bea, 'HP').id]).toEqual({ cur: 20, max: 20 });
		expect(ash.values[by(ash, 'HP').id]).toEqual({ cur: 10, max: 10 });
	});

	it('pastes beside the copied fields on the same character, reading its own copies', () => {
		const { doc, ash, block } = setup();
		place(lift(ash, doc.clocks, block, false), ash, doc.clocks, ash.tabs[0].id, {
			x: 400,
			y: 200
		});
		expect(by(ash, 'HP 2').box).toMatchObject({ x: 416, y: 216 });
		const [rule] = by(ash, 'HP 2').rules!;
		expect(rule.when).toEqual({ press: by(ash, 'Attack 2').id });
		expect(rule.then[0]).toContain(`@${by(ash, 'Armor 2').id}`);
	});

	it('pastes a bound block as a binding of its own, and frees a field copied out of one', () => {
		const { doc, ash, block } = setup();
		for (const f of ash.fields) if (block.includes(f.id)) f.bind = 'b';
		const tab = ash.tabs[0].id;
		place(lift(ash, doc.clocks, block, false), ash, doc.clocks, tab, { x: 0, y: 400 });
		const copied = ['HP 2', 'Armor 2', 'Attack 2', 'Dodge 2'].map((l) => by(ash, l).bind);
		expect(new Set(copied).size).toBe(1);
		expect(copied[0]).not.toBe('b');

		place(lift(ash, doc.clocks, [by(ash, 'Armor').id], false), ash, doc.clocks, tab, {
			x: 0,
			y: 600
		});
		expect(by(ash, 'Armor 3').bind).toBeUndefined();
	});

	it('reads a name it lacks once there is a field of that label', () => {
		const { doc, ash, block } = setup();
		const cid = newCharacter('Cid');
		doc.characters.push(cid);
		place(lift(ash, doc.clocks, block, false), cid, doc.clocks, cid.tabs[0].id, { x: 0, y: 0 });
		expect(by(cid, 'Dodge').formula).toBe('DEX * 2');
	});

	it("keeps a card's reading of another character, as GM!Bonus", () => {
		const { doc, ash, bea } = setup();
		const gm = newCharacter('GM');
		doc.characters.push(gm);
		const bonus = add(gm, 'Bonus', 'number', 4);
		const hit = add(ash, 'Hit', 'formula', undefined, 0, 400);
		const reads = `${refText(globalId(gm, bonus))} + 1`;
		hit.formula = reads;
		const g = lift(ash, doc.clocks, [hit.id], false, doc.characters);
		expect(g.names).toEqual([
			{ id: globalId(gm, bonus), label: 'Bonus', kind: 'number', of: 'GM' }
		]);
		place(g, bea, doc.clocks, bea.tabs[0].id, { x: 0, y: 0 }, doc.characters);
		expect(by(bea, 'Hit').formula).toBe(reads);
	});

	it("pastes a card from the GM's page that still reads the GM's table, as GM!Weapons", () => {
		const { doc, bea } = setup();
		const gm = newCharacter('GM');
		doc.characters.push(gm);
		add(gm, 'Bonus', 'number', 4);
		const hit = add(gm, 'Hit', 'formula', undefined, 0, 400);
		hit.formula = compile('GM!Bonus + 1', names(sheetOf(doc, gm)));
		place(
			lift(gm, doc.clocks, [hit.id], false, doc.characters),
			bea,
			doc.clocks,
			bea.tabs[0].id,
			{ x: 0, y: 0 },
			doc.characters
		);
		expect(by(bea, 'Hit').formula).toBe(hit.formula);
		expect(result(sheetOf(doc, bea), by(bea, 'Hit').id)).toBe(5);
	});

	it('hears a clock of the same name in another room', () => {
		const { doc, ash } = setup();
		const charge = add(ash, 'Charge', 'number', 0, 0, 600);
		rule(doc, ash, charge, { tick: doc.clocks[0].id }, 'Charge += 1');
		const g = lift(ash, doc.clocks, [charge.id], false);
		const there = newDoc();
		const cid = newCharacter('Cid');
		place(g, cid, there.clocks, cid.tabs[0].id, { x: 0, y: 0 });
		expect(cid.fields[0].rules![0].when).toEqual({ tick: there.clocks[0].id });
	});
});
