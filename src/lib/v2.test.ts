import { describe, expect, it } from 'vitest';
import { valueOf, type Row } from './doc';
import { fire } from './rules';
import { upgrade, type Status, type V2Doc } from './v2';

const box = { x: 40, y: 0, w: 240, h: 88 };
const at = (since: number, lasts?: number, stacks?: number): Omit<Status, 'id' | 'name'> => ({
	clock: 'turn',
	since,
	...(lasts !== undefined && { lasts }),
	...(stacks !== undefined && { stacks })
});

function old(statuses: Status[]): V2Doc {
	return {
		version: 2,
		clocks: [
			{ id: 'turn', name: 'Turn', now: 7 },
			{ id: 'round', name: 'Round', now: 1, rules: [{ id: 'r', when: { tick: 'turn' }, then: [] }] }
		],
		templates: [],
		characters: [
			{
				id: 'ash',
				name: 'Ash',
				tabs: [{ id: 'main', name: 'Main' }],
				fields: [{ id: 'hp', label: 'HP', kind: 'number', tab: 'main', box }],
				values: { hp: 10 },
				statuses
			},
			{
				id: 'bo',
				name: 'Bo',
				tabs: [{ id: 'b', name: 'Main' }],
				fields: [],
				values: {},
				statuses: []
			}
		],
		presets: [{ id: 'p', name: 'Poison', clock: 'turn', rules: [] }]
	};
}

describe('version 2 to 3', () => {
	const doc = upgrade(
		old([
			{ id: '1', name: 'Poisoned', ...at(5, 3) },
			{ id: '2', name: 'Cursed', ...at(1) },
			{ id: '3', name: 'Bleed', ...at(6, 4, 4) },
			{ id: '4', name: 'Old', ...at(1, 2) },
			{ id: '5', name: 'Spent', ...at(6, undefined, 0) },
			{ id: '6', name: 'Later', ...at(9, 2) }
		])
	);
	const ash = doc.characters[0];
	const table = ash.fields[1];
	const [name, stacks, left] = table.columns!;
	const rows = () =>
		(valueOf(ash, table) as Row[]).map((r) => [
			r.cells[name.id],
			r.cells[stacks.id],
			r.cells[left.id]
		]);

	it('puts the statuses still on in a table, with their turns left', () => {
		expect(table).toMatchObject({ label: 'Statuses', kind: 'table', tab: 'main' });
		expect(table.box).toMatchObject({ x: 40, y: 104 });
		expect(rows()).toEqual([
			['Poisoned', undefined, 1],
			['Cursed', undefined, undefined],
			['Bleed', 4, 3],
			['Later', undefined, 2]
		]);
	});

	it('counts them down as the clock ticks, and Back counts them up', () => {
		const copy = structuredClone(doc);
		const tick = (n: number) => fire(copy, { tick: { clock: 'turn', at: n } }, () => 1);
		const lefts = () => (copy.characters[0].values[table.id] as Row[]).map((r) => r.cells[left.id]);
		tick(7);
		expect(lefts()).toEqual([0, undefined, 2, 1]);
		fire(copy, { back: { clock: 'turn', at: 8 } }, () => 1);
		expect(lefts()).toEqual([1, undefined, 3, 2]);
	});

	it('leaves a character without statuses be, and drops presets and clock rules', () => {
		expect(doc.characters[1].fields).toEqual([]);
		expect('statuses' in ash).toBe(false);
		expect(doc).not.toHaveProperty('presets');
		expect(doc.clocks[1]).toEqual({ id: 'round', name: 'Round', now: 1 });
	});

	it('numbers the table when a field is called Statuses already', () => {
		const v2 = old([{ id: '1', name: 'Poisoned', ...at(5, 3) }]);
		v2.characters[0].fields[0].label = 'Statuses';
		expect(upgrade(v2).characters[0].fields[1].label).toBe('Statuses 2');
	});
});
