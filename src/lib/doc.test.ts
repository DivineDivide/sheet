import { describe, expect, it } from 'vitest';
import { blank, newCharacter, newDoc, uniqueLabel, valueOf, type Character } from './doc';

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
