import { describe, expect, it } from 'vitest';
import { globalId, newCharacter, newDoc, newId, type Character, type Field, type Row } from './doc';
import { names, rowNames } from './formula';
import { compileRule, fire, sheetOf } from './rules';
import { choose, follow, rowFrom, sourceOf } from './source';
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

	it('keeps a row as it is once its source row is gone', () => {
		const { doc, gm, weapons, src, gear, bea, rows, sword, damage } = setup();
		bea.values[gear.id] = [rowFrom(src(), sword(), gear.columns!)];
		gm.values[weapons.id] = src().rows.slice(1);
		follow(doc);
		expect(rows()[0].link).toBeUndefined();
		expect(rows()[0].cells[damage.id]).toBe('1d8');
	});
});

describe('a table following a map', () => {
	/** The GM's Places and Map, and a shared Adventure page whose Here follows the map. */
	function setup() {
		const doc = newDoc();
		const gm = newCharacter('GM');
		const page = newCharacter('Adventure');
		doc.characters.push(gm, page);
		const places = table(
			gm,
			'Places',
			['Name', 'Text'],
			[
				['Town', 'Bells.'],
				['Forest', 'Dark.']
			]
		);
		const [town, forest] = gm.values[places.id] as Row[];
		const map: Field = {
			id: newId(),
			label: 'Map',
			kind: 'map',
			tab: gm.tabs[0].id,
			box: { x: 0, y: 0, w: 320, h: 160 },
			from: globalId(gm, places),
			parents: { [town.id]: '', [forest.id]: town.id }
		};
		gm.fields.push(map);
		const here = table(page, 'Here', ['Name', 'Text', 'Notes']);
		here.follows = globalId(gm, map);
		const rows = () => page.values[here.id] as Row[];
		const press = (row: string) =>
			fire(doc, { press: { character: gm.id, field: map.id, row } }, () => 1);
		return { doc, gm, map, here, rows, press, town, forest, cols: here.columns! };
	}

	it('keeps no row while the map has no current node', () => {
		const { doc, rows } = setup();
		follow(doc);
		expect(rows()).toEqual([]);
	});

	it("keeps one row on the current node, the press's undo taking it back", () => {
		const { doc, rows, press, town, forest, cols } = setup();
		press(town.id);
		expect(rows()).toHaveLength(1);
		expect(rows()[0].cells[cols[1].id]).toBe('Bells.');
		const id = rows()[0].id;
		rows()[0].cells[cols[2].id] = 'met the mayor';
		const done = press(forest.id);
		expect(rows()).toHaveLength(1);
		expect(rows()[0]).toMatchObject({ id, link: { row: forest.id } });
		expect(rows()[0].cells).toEqual({
			[cols[0].id]: 'Forest',
			[cols[1].id]: 'Dark.',
			[cols[2].id]: 'met the mayor'
		});
		expect(doc.log!.at(-1)!.text).toBe('Map Town → Forest');
		for (const op of done.undo) apply(doc, op);
		expect(rows()[0].cells[cols[1].id]).toBe('Bells.');
	});

	it('takes out rows added beside it, sending each as a delete', () => {
		const { doc, rows, press, town, forest } = setup();
		press(town.id);
		rows().push({ id: 'extra', cells: {} });
		const done = press(forest.id);
		expect(rows().map((r) => r.id)).not.toContain('extra');
		expect(done.ops).toContainEqual({ k: 'del', p: expect.arrayContaining(['extra']) });
		follow(doc);
		expect(rows()).toHaveLength(1);
	});
});
