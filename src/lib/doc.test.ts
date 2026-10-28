import { describe, expect, it } from 'vitest';
import {
	blank,
	duplicate,
	globalId,
	newCharacter,
	newDoc,
	uniqueLabel,
	valueOf,
	type Character,
	type Row
} from './doc';

describe('valueOf', () => {
	const ch = (values: Character['values']) => ({ values });

	it('returns a stored value of the right kind', () => {
		expect(valueOf(ch({ f: { cur: 3, max: 8 } }), { id: 'f', kind: 'resource' })).toEqual({
			cur: 3,
			max: 8
		});
	});

	it('reads a value left over from another kind as blank', () => {
		expect(valueOf(ch({ f: 'old text' }), { id: 'f', kind: 'number' })).toBe(0);
		expect(valueOf(ch({}), { id: 'f', kind: 'track' })).toEqual(blank('track'));
	});

	it('tells entries from tags', () => {
		const book = { id: 'f', kind: 'entries' } as const;
		const entries = [{ name: '天才', text: '你覺醒出才能。' }];
		expect(valueOf(ch({ f: entries }), book)).toEqual(entries);
		expect(valueOf(ch({ f: ['祈禱', '即興'] }), book)).toEqual([]);
	});
});

describe('newCharacter', () => {
	it('copies the template, so reshaping the character leaves the template alone', () => {
		const template = newDoc().templates[0];
		const c = newCharacter('Ash', template);
		c.fields[0].box.x = 400;
		c.tabs[0].name = 'Combat';
		expect(template.fields[0].box.x).toBe(0);
		expect(template.tabs[0].name).toBe('Main');
		expect(Object.keys(c.values)).toEqual(template.fields.map((f) => f.id));
	});

	it('starts blank, with one empty tab', () => {
		const c = newCharacter('Ash');
		expect(c.tabs).toHaveLength(1);
		expect(c.fields).toEqual([]);
	});
});

describe('duplicate', () => {
	const gm = newCharacter('GM', { tabs: [], fields: [] });
	const ash = newCharacter('Ash', newDoc().templates[0]);
	const [hp, , statuses] = ash.fields;
	const gear = { ...statuses, id: 'gear', label: 'Gear', from: globalId(ash, statuses) };
	const weapons = { ...statuses, id: 'weapons', label: 'Weapons', from: 'gm-id!weapons' };
	const sum = {
		...hp,
		id: 'sum',
		label: 'Sum',
		kind: 'formula' as const,
		formula: `@${globalId(ash, hp)} + @${globalId(gm, hp)}`
	};
	ash.fields.push(gear, weapons, sum);
	ash.values[hp.id] = { cur: 3, max: 12 };
	ash.values.gear = [
		{ id: 'r1', cells: {}, link: { table: globalId(ash, statuses), row: 's1' } }
	] satisfies Row[];
	const copy = duplicate(ash, 'Ash 2');

	it('keeps every value under a new id and name, apart from the original', () => {
		expect(copy.id).not.toBe(ash.id);
		expect(copy.name).toBe('Ash 2');
		expect(copy.values[hp.id]).toEqual({ cur: 3, max: 12 });
		(copy.values[hp.id] as { cur: number }).cur = 0;
		expect(ash.values[hp.id]).toEqual({ cur: 3, max: 12 });
	});

	it('names itself where the original named itself, and others as they were', () => {
		const at = (id: string) => copy.fields.find((f) => f.id === id)!;
		expect(at('sum').formula).toBe(`@${globalId(copy, hp)} + @${globalId(gm, hp)}`);
		expect(at('gear').from).toBe(globalId(copy, statuses));
		expect(at('weapons').from).toBe('gm-id!weapons');
		expect((copy.values.gear as Row[])[0].link?.table).toBe(globalId(copy, statuses));
	});
});

describe('uniqueLabel', () => {
	const fields = [
		{ id: 'a', label: 'HP' },
		{ id: 'b', label: 'hp 2' }
	];

	it('numbers a label another field has, ignoring case', () => {
		expect(uniqueLabel('Luck', fields)).toBe('Luck');
		expect(uniqueLabel('hp', fields)).toBe('hp 3');
		expect(uniqueLabel('HP', fields, 'a')).toBe('HP');
	});
});
