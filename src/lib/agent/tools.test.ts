import { describe, expect, it } from 'vitest';
import { newDoc, valueOf, type Doc, type Row } from '../doc';
import { validate } from '../io';
import { fire } from '../rules';
import { runTool } from './tools';
import { overview } from './view';

/** Runs a tool and expects it to work, as the model's next turn would read it. */
function ok(doc: Doc, name: string, input: object) {
	const out = runTool(doc, name, input);
	expect(out, out.text).toMatchObject({ ok: true });
	return out.text;
}
function refused(doc: Doc, name: string, input: object) {
	const before = structuredClone(doc);
	const out = runTool(doc, name, input);
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
		expect(overview(doc)).toBe(
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
	runTool(doc, 'add_character', { name: 'Ash', template: 'Basic' });

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
		runTool(doc, 'add_character', { name: 'Bea' });
		expect(refused(doc, 'edit_tabs', { character: 'Bea', remove: ['Main'] })).toBe(
			"Main is Bea's only tab"
		);
	});
});

describe('what a change leaves for the model to see', () => {
	const doc = newDoc();
	runTool(doc, 'add_character', { name: 'Ash', template: 'Basic' });

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
