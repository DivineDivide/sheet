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
		).toBe('HP is not a button');
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
