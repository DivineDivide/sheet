import { describe, expect, it } from 'vitest';
import { globalId, newCharacter, newDoc, newId, type Character, type Field, type Row } from './doc';
import { names, rowNames } from './formula';
import { compileRule, fire, sheetOf } from './rules';
import { choose, follow, namesFor, rowFrom, sourceOf } from './source';
import { apply } from './sync';

function table(c: Character, label: string, names: string[], rows: string[][] = []): Field {
	const columns = names.map((name) => ({ id: newId(), name, kind: 'text' as const }));
	const f: Field = {
		id: newId(),
		label,
		kind: 'table',
		tab: c.tabs[0].id,
		box: { x: 0, y: 0, w: 320, h: 160 },
		columns
	};
	c.fields.push(f);
	c.values[f.id] = rows.map((r) => ({
		id: newId(),
		cells: Object.fromEntries(r.map((v, i) => [columns[i].id, v]))
	}));
	return f;
}

/** A GM's Weapons table, and Bea's Gear, whose Weapon column chooses from it. */
function setup() {
	const doc = newDoc();
	const gm = newCharacter('GM');
	const bea = newCharacter('Bea');
	gm.hidden = true;
	doc.characters.push(gm, bea);
	const weapons = table(
		gm,
		'Weapons',
		['Name', 'Damage'],
		[
			['Longsword', '1d8'],
			['Dagger', '1d4']
		]
	);
	const gear = table(bea, 'Gear', ['Weapon', 'Damage', 'Notes']);
	const [weapon, damage, notes] = gear.columns!;
	weapon.kind = 'choice';
	weapon.from = globalId(gm, weapons);
	const src = () => sourceOf(doc, globalId(gm, weapons))!;
	const rows = () => bea.values[gear.id] as Row[];
	const sword = () => src().rows[0];
	return { doc, gm, bea, weapons, gear, src, rows, sword, damage, notes, weapon };
}

describe('rows drawn from another table', () => {
	it("chooses a weapon by name, filling the row's cells of the same name", () => {
		const { src, gear, sword, weapon, damage } = setup();
		const row = choose(src(), sword(), { id: 'r', cells: {} }, gear.columns!);
		expect(row.cells).toEqual({ [weapon.id]: 'Longsword', [damage.id]: '1d8' });
		expect(row.link).toEqual({ table: src().id, row: sword().id });
	});

	it("follows the GM's change, keeping cells the source lacks", () => {
		const { doc, src, gear, bea, rows, sword, damage, notes } = setup();
		bea.values[gear.id] = [rowFrom(src(), sword(), gear.columns!)];
		rows()[0].cells[notes.id] = 'from the armory';
		const [, dmg] = src().columns;
		sword().cells[dmg.id] = '1d10';
		follow(doc);
		expect(rows()[0].cells[damage.id]).toBe('1d10');
		expect(rows()[0].cells[notes.id]).toBe('from the armory');
	});

	it("follows a rule's change in the same event, which its undo takes back too", () => {
		const { doc, gm, weapons, src, gear, bea, rows, sword, damage } = setup();
		bea.values[gear.id] = [rowFrom(src(), sword(), gear.columns!)];
		const up: Field = {
			id: newId(),
			label: 'Upgrade',
			kind: 'button',
			tab: gm.tabs[0].id,
			box: { x: 0, y: 200, w: 96, h: 56 }
		};
		gm.fields.push(up);
		const known = [...rowNames(weapons), ...names(sheetOf(doc, gm))];
		weapons.columns![1].rules = [
			compileRule(
				{
					id: newId(),
					when: { press: up.id },
					if: 'Name = "Longsword"',
					then: ['Damage = "1d10"']
				},
				known
			)
		];
		const done = fire(doc, { press: { character: gm.id, field: up.id } }, () => 1);
		expect(rows()[0].cells[damage.id]).toBe('1d10');
		expect(done.ops.some((op) => op.p[1] === bea.id)).toBe(true);
		for (const op of done.undo) apply(doc, op);
		expect(rows()[0].cells[damage.id]).toBe('1d8');
	});

	it('tells apart tables that share an id, as characters made from one template do', () => {
		const { doc, gm, bea } = setup();
		const ash = newCharacter('Ash');
		doc.characters.push(ash);
		const mine = table(bea, 'Loot', ['Name'], [['Rope']]);
		const theirs = { ...structuredClone(mine), tab: ash.tabs[0].id };
		ash.fields.push(theirs);
		ash.values[theirs.id] = [{ id: newId(), cells: { [theirs.columns![0].id]: 'Lamp' } }];
		const names = (c: Character) => sourceOf(doc, globalId(c, mine))!.rows.map((r) => r.cells);
		expect(names(bea)).toEqual([{ [mine.columns![0].id]: 'Rope' }]);
		expect(names(ash)).toEqual([{ [mine.columns![0].id]: 'Lamp' }]);
		expect(sourceOf(doc, globalId(gm, mine))).toBeUndefined();
	});

	it('names a table as Character!Table for a pick in text', () => {
		const { doc } = setup();
		expect(namesFor(doc, 'gm!weapons')).toEqual(['Longsword', 'Dagger']);
		expect(namesFor(doc, 'GM!Armour')).toBeUndefined();
		expect(namesFor(doc, 'Weapons')).toBeUndefined();
	});

	it('keeps a row as it is once its source row is gone', () => {
		const { doc, gm, weapons, src, gear, bea, rows, sword, damage } = setup();
		bea.values[gear.id] = [rowFrom(src(), sword(), gear.columns!)];
		gm.values[weapons.id] = src().rows.slice(1);
		follow(doc);
		expect(rows()[0].link).toBeUndefined();
		expect(rows()[0].cells[damage.id]).toBe('1d8');
	});
});
