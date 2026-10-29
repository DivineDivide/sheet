import { describe, expect, it } from 'vitest';
import { newDoc, valueOf, type Doc, type Row } from '../doc';
import { validate } from '../io';
import { fire } from '../rules';
import { diff } from '../sync';
import { runTool } from './tools';
import { overview } from './view';

/** Runs a tool and expects it to work, as the model's next turn would read it. */
function ok(doc: Doc, name: string, input: object, gm = true) {
	const out = runTool(doc, name, input, gm);
	expect(out, out.text).toMatchObject({ ok: true });
	return out.text;
}
function refused(doc: Doc, name: string, input: object, gm = true) {
	const before = structuredClone(doc);
	const out = runTool(doc, name, input, gm);
	expect(out.ok).toBe(false);
	expect(doc).toEqual(before);
	return out.text;
}

describe('a scripted chat builds a room', () => {
	const doc = newDoc();
	const ash = () => doc.characters.find((c) => c.name === 'Ash')!;
	const field = (label: string) => ash().fields.find((f) => f.label === label)!;

	it('makes a character from a template, with a second tab of skills', () => {
		ok(doc, 'add_character', { name: 'Ash', template: 'Basic' });
		ok(doc, 'edit_tabs', { character: 'Ash', add: ['Skills'] });
		const text = ok(doc, 'add_field', {
			character: 'Ash',
			tab: 'Skills',
			label: 'Skill list',
			kind: 'table',
			size: { w: 30, h: 15 },
			columns: [
				{ name: 'Skill', kind: 'text' },
				{ name: 'Base', kind: 'number' },
				{ name: 'Bonus', kind: 'number' },
				{ name: 'Total', kind: 'formula', formula: 'Base + Bonus' }
			]
		});
		expect(text).toContain(
			'columns: Skill (text), Base (number), Bonus (number), Total (formula =Base + Bonus)'
		);
		ok(doc, 'edit_table', {
			character: 'Ash',
			table: 'Skill list',
			add_rows: [
				{ Skill: 'Spot Hidden', Base: 25, Bonus: 10 },
				{ Skill: 'Dodge', Base: 20 }
			]
		});
		expect(ok(doc, 'read', { character: 'Ash', field: 'Skill list' })).toContain(
			'1. Skill=Spot Hidden; Base=25; Bonus=10; Total=35'
		);
		const sum = ok(doc, 'add_field', {
			character: 'Ash',
			label: 'Skill points',
			kind: 'formula',
			formula: 'SUM([Skill list][Total])',
			below: 'Skill list'
		});
		expect(sum).toContain('It shows 55.');
		expect(field('Skill points').box).toEqual({ x: 0, y: 256, w: 160, h: 88 });
	});

	it('adds poison as a rule on the Statuses table, which a tick then runs', () => {
		ok(doc, 'set_value', { character: 'Ash', field: 'HP', value: { cur: 30, max: 30 } });
		ok(doc, 'edit_table', {
			character: 'Ash',
			table: 'Statuses',
			add_rows: [{ Name: 'Poison', Stacks: 3 }]
		});
		const rules = ok(doc, 'set_rules', {
			character: 'Ash',
			target: 'Statuses[Stacks]',
			rules: [
				{
					tick: 'Turn',
					if: 'AND(Name = "Poison", Stacks > 0)',
					then: ['HP -= Stacks', 'Stacks -= 1']
				}
			]
		});
		expect(rules).toContain(
			'tick Turn, if AND(Name = "Poison", Stacks > 0): HP -= Stacks; Stacks -= 1'
		);

		const turn = doc.clocks[0];
		fire(doc, { tick: { clock: turn.id, at: turn.now } }, () => 1);
		expect(valueOf(ash(), field('HP'))).toEqual({ cur: 27, max: 30 });
		const [poison] = valueOf(ash(), field('Statuses')) as Row[];
		expect(Object.values(poison.cells)).toContain(2);
	});

	it('saves a template from it, and adds a second clock', () => {
		ok(doc, 'save_template', { character: 'Ash', name: 'Investigator' });
		ok(doc, 'edit_clocks', { add: ['Round'] });
		ok(doc, 'add_character', { name: 'Bea', template: 'Investigator' });
		expect(doc.characters.find((c) => c.name === 'Bea')!.tabs.map((t) => t.name)).toEqual([
			'Main',
			'Skills'
		]);
		expect(() => validate(doc)).not.toThrow();
		expect(overview(doc, true)).toBe(
			[
				'Clocks: Turn (now 2), Round (now 1)',
				'Templates:',
				'- Basic: Main: HP (resource), Notes (text), Statuses (table)',
				'- Investigator: Main: HP (resource), Notes (text), Statuses (table); Skills: Skill list (table), Skill points (formula)',
				'Characters:',
				'- Ash: Main: HP (resource), Notes (text), Statuses (table); Skills: Skill list (table), Skill points (formula)',
				'- Bea: Main: HP (resource), Notes (text), Statuses (table); Skills: Skill list (table), Skill points (formula)'
			].join('\n')
		);
	});
});

describe('a mistake comes back in words, and changes nothing', () => {
	const doc = newDoc();
	runTool(doc, 'add_character', { name: 'Ash', template: 'Basic' }, true);

	it('names what is there when asked for what is not', () => {
		expect(refused(doc, 'read', { character: 'Cid' })).toBe(
			'no character is called "Cid" (there are: Ash)'
		);
		expect(refused(doc, 'add_field', { character: 'Ash', label: 'X', kind: 'dial' })).toMatch(
			/not dial/
		);
	});

	it('says why a formula or a rule line does not read', () => {
		expect(
			refused(doc, 'add_field', {
				character: 'Ash',
				label: 'Bad',
				kind: 'formula',
				formula: 'HP +'
			})
		).toMatch(/^"HP \+": /);
		expect(
			refused(doc, 'set_rules', {
				character: 'Ash',
				target: 'HP',
				rules: [{ tick: 'Turn', then: ['Nobody -= 1'] }]
			})
		).toBe('"Nobody -= 1": nothing is called "Nobody"');
		expect(
			refused(doc, 'set_rules', {
				character: 'Ash',
				target: 'Notes',
				rules: [{ press: 'HP', then: ['Notes = "x"'] }]
			})
		).toBe('HP is not a button or a map');
	});

	it('refuses a value of the wrong shape', () => {
		expect(refused(doc, 'set_value', { character: 'Ash', field: 'HP', value: 12 })).toBe(
			'HP is a resource, which takes {"cur": number, "max": number}'
		);
	});

	it('takes back the whole call, columns added before the bad row too', () => {
		expect(
			refused(doc, 'edit_table', {
				character: 'Ash',
				table: 'Statuses',
				add_columns: [{ name: 'Kind', kind: 'choice', choices: ['Curse', 'Boon'] }],
				add_rows: [{ Name: 'Hex', Kind: 'Hex' }]
			})
		).toBe('Kind offers Curse, Boon, not "Hex"');
	});

	it('keeps a tab with fields on it, and a character its last tab', () => {
		expect(refused(doc, 'edit_tabs', { character: 'Ash', remove: ['Main'] })).toBe(
			'Main has fields; move or remove them first'
		);
		runTool(doc, 'add_character', { name: 'Bea' }, true);
		expect(refused(doc, 'edit_tabs', { character: 'Bea', remove: ['Main'] })).toBe(
			"Main is Bea's only tab"
		);
	});
});

describe('what a change leaves for the model to see', () => {
	const doc = newDoc();
	runTool(doc, 'add_character', { name: 'Ash', template: 'Basic' }, true);

	it('numbers a taken label and says so', () => {
		expect(ok(doc, 'add_field', { character: 'Ash', label: 'hp', kind: 'number' })).toMatch(
			/^Added\. It is called "hp 2", since "hp" was taken\./
		);
	});

	it('warns of an overlap, and of what still names a removed field', () => {
		expect(
			ok(doc, 'add_field', { character: 'Ash', label: 'Badge', kind: 'image', at: { x: 2, y: 2 } })
		).toContain('It overlaps HP, Notes;');
		ok(doc, 'add_field', { character: 'Ash', label: 'Half', kind: 'formula', formula: 'HP / 2' });
		expect(ok(doc, 'remove_field', { character: 'Ash', field: 'HP' })).toBe(
			'Removed HP. Still naming it: Half.'
		);
	});
});

describe("a GM's page, as each asker's chat sees it", () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'GM', gm_only: true });
	ok(doc, 'add_field', {
		character: 'GM',
		label: 'Weapons',
		kind: 'table',
		columns: [
			{ name: 'Name', kind: 'text' },
			{ name: 'Damage', kind: 'text' }
		]
	});
	ok(doc, 'edit_table', {
		character: 'GM',
		table: 'Weapons',
		add_rows: [
			{ Name: 'Longsword', Damage: '1d8' },
			{ Name: 'Dagger', Damage: '1d4' }
		]
	});
	ok(doc, 'add_field', { character: 'GM', label: 'Party bonus', kind: 'number' });
	ok(doc, 'set_value', { character: 'GM', field: 'Party bonus', value: 2 });
	ok(doc, 'add_character', { name: 'Bea', template: 'Basic' }, false);
	const gm = doc.characters[0];
	const gear = () => ok(doc, 'read', { character: 'Bea', field: 'Gear' }, false);

	it("shows a player's chat no GM-only character, and lets only a GM mark one", () => {
		expect(overview(doc, true)).toContain('- GM (GM only): Main: Weapons (table), Party bonus');
		expect(overview(doc, false)).not.toContain('GM');
		expect(refused(doc, 'read', { character: 'GM' }, false)).toBe(
			'no character is called "GM" (there are: Bea)'
		);
		expect(refused(doc, 'edit_character', { character: 'Bea', gm_only: true }, false)).toBe(
			'only a GM can mark a character GM only'
		);
	});

	it("names nothing of a GM-only character to a player's chat but its tables", () => {
		const room = structuredClone(doc);
		ok(room, 'add_character', { name: 'Spy', gm_only: true });
		const from = (ref: string) =>
			refused(room, 'edit_table', { character: 'Bea', table: 'Statuses', rows_from: ref }, false);
		expect(from('Nobody!Weapons')).toBe('no character is called "Nobody" (there are: GM, Bea)');
		expect(from('GM!Party bonus')).toBe('no table is called "Party bonus" (there are: Weapons)');
	});

	it("draws a player's rows from the GM's table, which they then follow", () => {
		const base = structuredClone(doc);
		ok(
			doc,
			'add_field',
			{
				character: 'Bea',
				label: 'Gear',
				kind: 'table',
				columns: [
					{ name: 'Weapon', kind: 'choice', from: 'GM!Weapons' },
					{ name: 'Damage', kind: 'text' },
					{ name: 'Note', kind: 'text' }
				]
			},
			false
		);
		ok(
			doc,
			'edit_table',
			{
				character: 'Bea',
				table: 'Gear',
				rows_from: 'GM!Weapons',
				add_rows: [{ Weapon: 'Longsword', Note: 'heirloom' }],
				add_rows_from: ['Dagger']
			},
			false
		);
		expect(gear()).toContain("Weapon (choice of GM!Weapons's rows: Longsword, Dagger)");
		expect(gear()).toContain('rows from: GM!Weapons');
		expect(gear()).toContain(
			'1. Weapon=Longsword; Damage=1d8; Note=heirloom (follows GM!Weapons: Longsword)'
		);
		expect(gear()).toContain('2. Weapon=Dagger; Damage=1d4 (follows GM!Weapons: Dagger)');
		expect(diff(base, doc).some((op) => op.p[1] === gm.id)).toBe(false);
		expect(
			refused(
				doc,
				'edit_table',
				{ character: 'Bea', table: 'Gear', add_rows: [{ Weapon: 'Axe' }] },
				false
			)
		).toBe('GM!Weapons has Longsword, Dagger, not "Axe"');
		expect(
			refused(
				doc,
				'edit_table',
				{ character: 'Bea', table: 'Gear', change_rows: [{ row: 1, cells: { Weapon: null } }] },
				false
			)
		).toBe('Weapon chooses a row of GM!Weapons; remove the row instead');
	});

	it('changes a followed cell only at its source, or once the row stops following', () => {
		const damage = (cells: object) => ({
			character: 'Bea',
			table: 'Gear',
			change_rows: [{ row: 1, ...cells }]
		});
		expect(refused(doc, 'edit_table', damage({ cells: { Damage: '9' } }), false)).toBe(
			'Damage comes from GM!Weapons in this row; change it there, or stop the row following'
		);
		ok(doc, 'edit_table', {
			character: 'GM',
			table: 'Weapons',
			change_rows: [{ row: 1, cells: { Damage: '1d10' } }]
		});
		expect(gear()).toContain('1. Weapon=Longsword; Damage=1d10; Note=heirloom (follows');
		ok(doc, 'edit_table', damage({ follow: false, cells: { Damage: '2d6' } }), false);
		expect(gear()).toContain('1. Weapon=Longsword; Damage=2d6; Note=heirloom\n');
	});

	it("reads another character's field in a formula, as Name!Label", () => {
		const text = ok(
			doc,
			'add_field',
			{ character: 'Bea', label: 'To hit', kind: 'formula', formula: 'GM![Party bonus] + 3' },
			false
		);
		expect(text).toContain('It shows 5.');
		expect(text).toContain('=GM![Party bonus] + 3 → 5');
	});

	it('copies a character the asker sees, values and all, after it', () => {
		const room = structuredClone(doc);
		expect(ok(room, 'add_character', { name: 'Bea', copy_of: 'Bea' }, false)).toContain(
			'It is called "Bea 2"'
		);
		const [, bea, copy] = room.characters;
		expect(copy.name).toBe('Bea 2');
		expect(copy.values).toEqual(bea.values);
		expect(refused(room, 'add_character', { name: 'X', copy_of: 'GM' }, false)).toBe(
			'no character is called "GM" (there are: Bea, Bea 2)'
		);
		ok(room, 'add_character', { name: 'GM copy', copy_of: 'GM' });
		expect(room.characters[1]).toMatchObject({ name: 'GM copy', hidden: true });
		expect(() => validate(room)).not.toThrow();
	});
});

describe('a long list in pages', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'Ash', template: 'Basic' });
	const statuses = () => doc.characters[0].fields.find((f) => f.label === 'Statuses')!;

	it('turns pages on for a table and says so, then off again', () => {
		expect(ok(doc, 'edit_field', { character: 'Ash', field: 'Statuses', pages: true })).toContain(
			'in pages'
		);
		expect(statuses().pages).toBe(true);
		ok(doc, 'edit_field', { character: 'Ash', field: 'Statuses', pages: false });
		expect(statuses().pages).toBeUndefined();
	});

	it('refuses pages on a field that holds no list', () => {
		expect(refused(doc, 'edit_field', { character: 'Ash', field: 'HP', pages: true })).toMatch(
			/only a table or an entries list has pages/
		);
	});
});

describe('a table as cards', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'Ash', template: 'Basic' });
	const statuses = () => doc.characters[0].fields.find((f) => f.label === 'Statuses')!;
	const col = (name: string) => statuses().columns!.find((c) => c.name === name)!;

	it('stacks the columns down the card the first time, and says where each sits', () => {
		const text = ok(doc, 'edit_field', { character: 'Ash', field: 'Statuses', cards: true });
		expect(text).toContain('as cards');
		expect(text).toContain('card: Name at 0,0, 15×3.5; Stacks at 0,4, 15×3.5; Left at 0,8, 15×3.5');
		expect(statuses().cards).toBe(true);
	});

	it('places, sizes and hides a column on the card, and takes one off', () => {
		const text = ok(doc, 'edit_table', {
			character: 'Ash',
			table: 'Statuses',
			change_columns: [
				{ column: 'Stacks', card_at: { x: 16, y: 0 }, card_size: { w: 5, h: 3 } },
				{ column: 'Name', hide_label: true },
				{ column: 'Left', on_card: false }
			]
		});
		expect(col('Stacks').box).toEqual({ x: 256, y: 0, w: 80, h: 48 });
		expect(col('Name').hideLabel).toBe(true);
		expect(col('Left').box).toBeUndefined();
		expect(text).toContain(
			'card: Name at 0,0, 15×3.5, name hidden; Stacks at 16,0, 5×3; off it: Left'
		);
	});

	it('puts a new column under the rest, and a column back on the card there too', () => {
		ok(doc, 'edit_table', {
			character: 'Ash',
			table: 'Statuses',
			add_columns: [{ name: 'Note', kind: 'text' }],
			change_columns: [{ column: 'Left', on_card: true }]
		});
		expect(col('Left').box).toEqual({ x: 0, y: 64, w: 240, h: 56 });
		expect(col('Note').box).toEqual({ x: 0, y: 128, w: 240, h: 56 });
	});

	it('keeps the layout while shown as a grid, and refuses cards on what is not a table', () => {
		ok(doc, 'edit_field', { character: 'Ash', field: 'Statuses', cards: false });
		expect(statuses().cards).toBeUndefined();
		expect(col('Stacks').box).toEqual({ x: 256, y: 0, w: 80, h: 48 });
		expect(refused(doc, 'edit_field', { character: 'Ash', field: 'HP', cards: true })).toMatch(
			/only a table shows as cards/
		);
	});
});

describe('a hidden label', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'Ash', template: 'Basic' });
	const hp = () => doc.characters[0].fields.find((f) => f.label === 'HP')!;

	it('hides a label and says so, then shows it again', () => {
		expect(ok(doc, 'edit_field', { character: 'Ash', field: 'HP', hide_label: true })).toContain(
			'label hidden'
		);
		expect(hp().hideLabel).toBe(true);
		ok(doc, 'edit_field', { character: 'Ash', field: 'HP', hide_label: false });
		expect(hp().hideLabel).toBeUndefined();
	});

	it("refuses to hide a button's label, which is its text", () => {
		ok(doc, 'add_field', { character: 'Ash', label: 'Rest', kind: 'button' });
		expect(
			refused(doc, 'edit_field', { character: 'Ash', field: 'Rest', hide_label: true })
		).toMatch(/button/);
	});
});

describe('a resource as a bar', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'Ash', template: 'Basic' });
	const ash = () => doc.characters[0];
	const field = (label: string) => ash().fields.find((f) => f.label === label)!;

	it('shows a resource field as a bar and says so, then as numbers again', () => {
		expect(ok(doc, 'edit_field', { character: 'Ash', field: 'HP', bar: true })).toContain(
			'as a bar'
		);
		expect(field('HP').bar).toBe(true);
		ok(doc, 'edit_field', { character: 'Ash', field: 'HP', bar: false });
		expect(field('HP').bar).toBeUndefined();
	});

	it('adds a resource column as a bar, and turns it back to numbers', () => {
		const text = ok(doc, 'edit_table', {
			character: 'Ash',
			table: 'Statuses',
			add_columns: [{ name: 'Charge', kind: 'resource', bar: true }]
		});
		expect(text).toContain('Charge (resource, as a bar)');
		ok(doc, 'edit_table', {
			character: 'Ash',
			table: 'Statuses',
			change_columns: [{ column: 'Charge', bar: false }]
		});
		expect(field('Statuses').columns!.find((c) => c.name === 'Charge')!.bar).toBeUndefined();
	});

	it('refuses a bar on what is not a resource', () => {
		expect(refused(doc, 'edit_field', { character: 'Ash', field: 'Notes', bar: true })).toMatch(
			/only a resource shows as a bar/
		);
		expect(
			refused(doc, 'edit_table', {
				character: 'Ash',
				table: 'Statuses',
				change_columns: [{ column: 'Stacks', bar: true }]
			})
		).toMatch(/only a resource shows as a bar, and Stacks is number/);
	});
});

describe('bound fields', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'Ash', template: 'Basic' });
	const ash = () => doc.characters[0];
	const field = (label: string) => ash().fields.find((f) => f.label === label)!;

	it('binds fields, which the view then names together, and unbinds them', () => {
		expect(ok(doc, 'bind_fields', { character: 'Ash', fields: ['HP', 'Notes'], bind: true })).toBe(
			'Bound HP, Notes.'
		);
		expect(field('HP').bind).toBe(field('Notes').bind);
		expect(ok(doc, 'read', { character: 'Ash' })).toMatch(/HP: .*bound with Notes/);

		ok(doc, 'bind_fields', { character: 'Ash', fields: ['Notes'], bind: false });
		expect(field('HP').bind).toBeUndefined();
	});

	it('refuses to bind one field, or fields on different tabs', () => {
		expect(refused(doc, 'bind_fields', { character: 'Ash', fields: ['HP'], bind: true })).toMatch(
			/two fields/
		);
		ok(doc, 'edit_tabs', { character: 'Ash', add: ['Gear'] });
		ok(doc, 'edit_field', { character: 'Ash', field: 'Notes', tab: 'Gear' });
		expect(
			refused(doc, 'bind_fields', { character: 'Ash', fields: ['HP', 'Notes'], bind: true })
		).toMatch(/share a tab/);
	});

	it('frees the field left when the other of two bound fields is removed', () => {
		ok(doc, 'bind_fields', { character: 'Ash', fields: ['HP', 'Statuses'], bind: true });
		ok(doc, 'remove_field', { character: 'Ash', field: 'Statuses' });
		expect(field('HP').bind).toBeUndefined();
	});
});

describe('a choice field', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'GM' });
	ok(doc, 'add_field', {
		character: 'GM',
		label: '元素',
		kind: 'table',
		columns: [{ name: 'Name', kind: 'text' }]
	});
	ok(doc, 'edit_table', {
		character: 'GM',
		table: '元素',
		add_rows: [{ Name: '火' }, { Name: '冰' }]
	});
	ok(doc, 'add_character', { name: 'Ash', template: 'Basic' });
	const ash = () => doc.characters.find((c) => c.name === 'Ash')!;
	const value = (label: string) =>
		valueOf(
			ash(),
			ash().fields.find((f) => f.label === label)!
		);

	it('offers typed choices, and refuses one it does not offer', () => {
		const text = ok(doc, 'add_field', {
			character: 'Ash',
			label: 'Range',
			kind: 'choice',
			choices: ['近', '遠']
		});
		expect(text).toContain('none chosen, of 近, 遠');
		ok(doc, 'set_value', { character: 'Ash', field: 'Range', value: '遠' });
		expect(value('Range')).toBe('遠');
		expect(refused(doc, 'set_value', { character: 'Ash', field: 'Range', value: '中' })).toMatch(
			/Range offers 近, 遠, not "中"/
		);
	});

	it("offers a table's rows by name, and keeps only the name", () => {
		const text = ok(doc, 'add_field', {
			character: 'Ash',
			label: 'Element',
			kind: 'choice',
			from: 'GM!元素'
		});
		expect(text).toContain("none chosen, of GM!元素's rows: 火, 冰");
		ok(doc, 'set_value', { character: 'Ash', field: 'Element', value: '冰' });
		expect(value('Element')).toBe('冰');
		expect(refused(doc, 'set_value', { character: 'Ash', field: 'Element', value: '雷' })).toMatch(
			/Element offers 火, 冰, not "雷"/
		);
	});

	it('reads as its text in a formula, and a rule sets it', () => {
		expect(
			ok(doc, 'add_field', {
				character: 'Ash',
				label: 'Cold',
				kind: 'formula',
				formula: '=IF(Element = "冰", 1, 0)'
			})
		).toContain('→ 1');
		ok(doc, 'add_field', { character: 'Ash', label: 'Ignite', kind: 'button' });
		ok(doc, 'set_rules', {
			character: 'Ash',
			target: 'Element',
			rules: [{ press: 'Ignite', then: ['Element = "火"'] }]
		});
		const ignite = ash().fields.find((f) => f.label === 'Ignite')!;
		fire(doc, { press: { character: ash().id, field: ignite.id } }, () => 1);
		expect(value('Element')).toBe('火');
	});

	it('switches from a table to typed choices, and refuses choices elsewhere', () => {
		ok(doc, 'edit_field', { character: 'Ash', field: 'Element', from: '', choices: ['風'] });
		const element = ash().fields.find((f) => f.label === 'Element')!;
		expect(element.from).toBeUndefined();
		expect(element.choices).toEqual(['風']);
		expect(refused(doc, 'edit_field', { character: 'Ash', field: 'HP', choices: ['a'] })).toMatch(
			/only a choice field has choices/
		);
	});
});

describe('a map, built by a scripted chat', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'GM', gm_only: true });
	ok(doc, 'add_field', {
		character: 'GM',
		label: '地點',
		kind: 'table',
		columns: [
			{ name: 'Name', kind: 'text' },
			{ name: '描述', kind: 'text' },
			{ name: '圖', kind: 'image' }
		]
	});
	ok(doc, 'edit_table', {
		character: 'GM',
		table: '地點',
		add_rows: [
			{ Name: '城鎮', 描述: '鐘聲。' },
			{ Name: '黑森林', 描述: '樹影。' },
			{ Name: '小屋', 描述: '炊煙。' },
			{ Name: '港口', 描述: '海風。' }
		]
	});
	ok(doc, 'add_character', { name: '冒險' });
	const map = () => ok(doc, 'read', { character: 'GM', field: '地圖' });

	it('builds a map from 地點 with 城鎮 at the root, leaving the rest unplaced', () => {
		ok(doc, 'add_field', { character: 'GM', label: '地圖', kind: 'map', from: 'GM!地點' });
		ok(doc, 'arrange_map', {
			character: 'GM',
			map: '地圖',
			place: [
				{ node: '城鎮' },
				{ node: '黑森林', under: '城鎮' },
				{ node: '小屋', under: '黑森林' }
			]
		});
		expect(map()).toContain(
			"35×20: at no node, of GM!地點's rows\n  · 城鎮\n    · 黑森林\n      · 小屋\n  unplaced: 港口"
		);
	});

	it('refuses a loop, and takes a node off the map', () => {
		expect(
			refused(doc, 'arrange_map', {
				character: 'GM',
				map: '地圖',
				place: [{ node: '城鎮', under: '小屋' }]
			})
		).toBe('城鎮 cannot go under 小屋, which is 城鎮 or below it');
		ok(doc, 'arrange_map', { character: 'GM', map: '地圖', unplace: ['小屋'] });
		expect(map()).toContain('unplaced: 小屋, 港口');
		expect(
			refused(doc, 'arrange_map', { character: 'GM', map: '地圖', place: [{ node: '洞窟' }] })
		).toBe('GM!地點 has 城鎮, 黑森林, 小屋, 港口, not "洞窟"');
	});

	it('sets the current node by name, which a following table and a formula show', () => {
		ok(doc, 'add_field', {
			character: '冒險',
			label: '此處',
			kind: 'table',
			columns: [
				{ name: 'Name', kind: 'text' },
				{ name: '描述', kind: 'text' },
				{ name: '筆記', kind: 'text' }
			]
		});
		const text = ok(doc, 'edit_table', { character: '冒險', table: '此處', follows: 'GM!地圖' });
		expect(text).toContain('follows map: GM!地圖, keeping one row');
		expect(text).toContain('0 rows');
		ok(doc, 'set_value', { character: 'GM', field: '地圖', value: '黑森林' });
		expect(map()).toContain('at "黑森林"');
		const here = ok(doc, 'read', { character: '冒險', field: '此處' });
		expect(here).toContain('1. Name=黑森林; 描述=樹影。 (follows GM!地點: 黑森林)');
		expect(
			refused(doc, 'edit_table', { character: '冒險', table: '此處', add_rows: [{ Name: 'x' }] })
		).toBe('此處 follows GM!地圖, which keeps its one row');
		const where = ok(doc, 'add_field', {
			character: '冒險',
			label: '位置',
			kind: 'formula',
			formula: 'XLOOKUP(GM!地圖, GM!地點[Name], GM!地點[描述])'
		});
		expect(where).toContain('It shows 樹影。');
	});

	it('lets a rule hear the map, and refuses a picture typed into a cell', () => {
		ok(doc, 'add_field', { character: 'GM', label: '步數', kind: 'number' });
		ok(doc, 'set_rules', {
			character: 'GM',
			target: '步數',
			rules: [{ press: '地圖', then: ['步數 += 1'] }]
		});
		const gm = doc.characters[0];
		const f = (label: string) => gm.fields.find((x) => x.label === label)!;
		const harbour = (valueOf(gm, f('地點')) as Row[])[3];
		fire(doc, { press: { character: gm.id, field: f('地圖').id, row: harbour.id } }, () => 1);
		expect(valueOf(gm, f('步數'))).toBe(1);
		expect(
			refused(doc, 'edit_table', {
				character: 'GM',
				table: '地點',
				change_rows: [{ row: 1, cells: { 圖: 'data:image/png;base64,AAAA' } }]
			})
		).toBe('圖 takes a picture, which only a person can add');
		expect(() => validate(JSON.parse(JSON.stringify(doc)))).not.toThrow();
	});
});

describe('picks in text, written by a scripted chat', () => {
	const doc = newDoc();
	ok(doc, 'add_character', { name: 'GM', gm_only: true });
	ok(doc, 'add_field', {
		character: 'GM',
		label: '元素',
		kind: 'table',
		columns: [{ name: 'Name', kind: 'text' }]
	});
	ok(doc, 'edit_table', {
		character: 'GM',
		table: '元素',
		add_rows: [{ Name: '火' }, { Name: '冰' }]
	});
	ok(doc, 'add_character', { name: 'Ash' });
	ok(doc, 'add_field', { character: 'Ash', label: 'Note', kind: 'text' });
	ok(doc, 'add_field', { character: 'Ash', label: '技能', kind: 'entries' });
	ok(doc, 'add_field', {
		character: 'Ash',
		label: 'Gear',
		kind: 'table',
		columns: [{ name: 'Item', kind: 'text' }]
	});
	const long = `${'守護對象受到攻擊時，你可以代替承受。'.repeat(12)}屬性{GM!元素=冰}`;

	it('reads each pick with what it offers, even past where the text is cut', () => {
		const text = ok(doc, 'set_value', {
			character: 'Ash',
			field: 'Note',
			value: '附帶{GM!元素=火}，射程{近|遠}，{GM!Nope}'
		});
		expect(text).toContain(`pick {GM!元素=火}: "火", of GM!元素's rows: 火, 冰`);
		expect(text).toContain('pick {近|遠}: none chosen, of 近, 遠');
		expect(text).toContain('pick {GM!Nope}: none chosen, but no table is named GM!Nope');
		ok(doc, 'set_value', {
			character: 'Ash',
			field: '技能',
			value: [{ name: '守護誓約', text: long }]
		});
		ok(doc, 'edit_table', { character: 'Ash', table: 'Gear', add_rows: [{ Item: '{劍|弓=弓}' }] });
		const read = ok(doc, 'read', { character: 'Ash' });
		expect(read).toContain('more characters)');
		expect(read).toContain(`    pick {GM!元素=冰}: "冰", of GM!元素's rows: 火, 冰`);
		expect(read).toContain(`     Item's pick {劍|弓=弓}: "弓", of 劍, 弓`);
	});

	it('refuses a choice a pick does not offer, in text, entries and cells', () => {
		const set = (field: string, value: unknown) =>
			refused(doc, 'set_value', { character: 'Ash', field, value });
		expect(set('Note', '{GM!元素=雷}')).toMatch(/\{GM!元素=雷\} offers 火, 冰, not "雷"/);
		expect(set('Note', '{近|遠=中}')).toMatch(/\{近\|遠=中\} offers 近, 遠, not "中"/);
		expect(set('Note', '{GM!Nope=火}')).toMatch(/there is no table GM!Nope/);
		expect(set('技能', [{ name: '{GM!元素=風}', text: '' }])).toMatch(/not "風"/);
		expect(
			refused(doc, 'edit_table', {
				character: 'Ash',
				table: 'Gear',
				change_rows: [{ row: 1, cells: { Item: '{劍|弓=槍}' } }]
			})
		).toMatch(/offers 劍, 弓, not "槍"/);
	});

	it("lets a player's chat choose from the GM's table", () => {
		ok(doc, 'set_value', { character: 'Ash', field: 'Note', value: '附帶{GM!元素=冰}' }, false);
		expect(ok(doc, 'read', { character: 'Ash' }, false)).toContain(
			`pick {GM!元素=冰}: "冰", of GM!元素's rows: 火, 冰`
		);
	});

	it('keeps a pick its table has stopped offering, while the rest is rewritten', () => {
		ok(doc, 'edit_table', {
			character: 'GM',
			table: '元素',
			change_rows: [{ row: 2, cells: { Name: '霜' } }]
		});
		const text = ok(doc, 'set_value', {
			character: 'Ash',
			field: 'Note',
			value: '武器附帶{GM!元素=冰}，持續 3 回合'
		});
		expect(text).toContain(`pick {GM!元素=冰}: "冰", of GM!元素's rows: 火, 霜`);
		expect(
			refused(doc, 'set_value', {
				character: 'Ash',
				field: 'Note',
				value: '{GM!元素=冰} {近|遠=中}'
			})
		).toMatch(/not "中"/);
		expect(() => validate(JSON.parse(JSON.stringify(doc)))).not.toThrow();
	});
});

describe('a rule that adds a row, set by a scripted chat', () => {
	const doc = newDoc();
	runTool(doc, 'add_character', { name: 'Ash', template: 'Basic' }, true);
	const ash = doc.characters[0];

	it('puts a status on with a button, and shows the rule by column names', () => {
		ok(doc, 'add_field', { character: 'Ash', label: 'Bite', kind: 'button' });
		const text = ok(doc, 'set_rules', {
			character: 'Ash',
			target: 'Statuses',
			rules: [{ press: 'Bite', then: ['Statuses += {Name: "Bleed", Stacks: 2}'] }]
		});
		expect(text).toBe('Statuses now has:\n- press Bite: Statuses += {Name: "Bleed", Stacks: 2}');
		expect(ok(doc, 'read', { character: 'Ash', field: 'Statuses' })).toContain(
			'rule: press Bite: Statuses += {Name: "Bleed", Stacks: 2}'
		);
		const bite = ash.fields.find((f) => f.label === 'Bite')!;
		fire(doc, { press: { character: ash.id, field: bite.id } }, () => 1);
		expect(ok(doc, 'read', { character: 'Ash', field: 'Statuses' })).toContain(
			'1. Name=Bleed; Stacks=2'
		);
	});

	it('says which columns a row can fill', () => {
		expect(
			refused(doc, 'set_rules', {
				character: 'Ash',
				target: 'Statuses',
				rules: [{ press: 'Bite', then: ['Statuses += {Hurt: 1}'] }]
			})
		).toBe('"Statuses += {Hurt: 1}": Statuses has Name, Stacks, Left, not Hurt');
	});
});

describe("a rule on a player's sheet that hears the GM's press", () => {
	const doc = newDoc();
	runTool(doc, 'add_character', { name: 'Ash', template: 'Basic' }, true);
	runTool(doc, 'add_character', { name: 'GM', gm_only: true }, true);
	runTool(doc, 'add_field', { character: 'GM', label: 'Gas', kind: 'button' }, true);
	runTool(doc, 'add_field', { character: 'GM', label: 'Map', kind: 'map' }, true);
	runTool(doc, 'add_field', { character: 'Ash', label: 'Coughs', kind: 'number' }, true);

	it("names the GM's button as GM!Gas, and runs on its press", () => {
		const text = ok(doc, 'set_rules', {
			character: 'Ash',
			target: 'Coughs',
			rules: [{ press: 'GM!Gas', then: ['Coughs += 1'] }]
		});
		expect(text).toBe('Coughs now has:\n- press GM!Gas: Coughs += 1');
		const [ash, gm] = doc.characters;
		fire(doc, { press: { character: gm.id, field: gm.fields[0].id } }, () => 1);
		expect(ok(doc, 'read', { character: 'Ash', field: 'Coughs' })).toContain(': 1');
		expect(ash.fields.find((f) => f.label === 'Coughs')!.rules![0].when).toEqual({
			press: `${gm.id}!${gm.fields[0].id}`
		});
	});

	it("lets a player's chat hear a GM-only map, but not its buttons", () => {
		const rules = (press: string) => ({
			character: 'Ash',
			target: 'Coughs',
			rules: [{ press, then: ['Coughs += 1'] }]
		});
		expect(refused(doc, 'set_rules', rules('GM!Gas'), false)).toBe(
			'no button or map on GM is called "Gas" (there are: Map)'
		);
		expect(ok(doc, 'set_rules', rules('GM!Map'), false)).toContain('press GM!Map');
	});
});
