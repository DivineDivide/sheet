import { describe, expect, it } from 'vitest';
import { newCharacter, newDoc, type Doc } from './doc';
import { ImportError, parse, serialize } from './io';

function party(): Doc {
	const doc = newDoc();
	const ash = newCharacter('Ash', doc.templates[0]);
	const [hp, notes] = ash.fields;
	ash.values = { ...ash.values, [hp.id]: { cur: 4, max: 10 }, [notes.id]: 'hates boats' };
	doc.characters.push(ash);
	return doc;
}

const mangle = (fn: (d: Record<string, any>) => void) => {
	const d = JSON.parse(serialize(party()));
	fn(d);
	return JSON.stringify(d);
};

describe('parse', () => {
	it('round-trips an export exactly', () => {
		const doc = party();
		expect(parse(serialize(doc))).toEqual(doc);
	});

	it('refuses what is not JSON', () => {
		expect(() => parse('{oops')).toThrow(ImportError);
	});

	it('names a newer version rather than guessing at it', () => {
		expect(() => parse(mangle((d) => (d.version = 4)))).toThrow(/newer version/);
	});

	it('refuses a field on a tab that is missing', () => {
		expect(() => parse(mangle((d) => (d.characters[0].fields[0].tab = 'gone')))).toThrow(/tab/);
	});

	it('refuses a character without tabs', () => {
		expect(() => parse(mangle((d) => (d.characters[0].tabs = [])))).toThrow(/no tabs/);
	});

	it('refuses a field position that is not numbers', () => {
		expect(() =>
			parse(mangle((d) => (d.characters[0].fields[0].box = { x: 'left', y: 0, w: 6, h: 1 })))
		).toThrow(/bad position/);
	});

	it('refuses a formula that is not text', () => {
		expect(() => parse(mangle((d) => (d.characters[0].fields[0].formula = 3)))).toThrow(/formula/);
	});

	it('refuses a table column of an unknown kind', () => {
		expect(() =>
			parse(
				mangle(
					(d) => (d.characters[0].fields[0].columns = [{ id: 'c', name: 'Dice', kind: 'dice' }])
				)
			)
		).toThrow(/columns/);
	});

	it('takes rules, and refuses a malformed rule', () => {
		const ok = mangle((d) => {
			const tick = { tick: d.clocks[0].id };
			d.characters[0].fields[0].rules = [{ id: 'r', when: tick, if: 'TRUE', then: ['HP -= 1'] }];
		});
		expect(parse(ok).characters[0].fields[0].rules).toHaveLength(1);
		const bad = mangle((d) => (d.characters[0].fields[0].rules = [{ id: 'r', then: 'HP -= 1' }]));
		expect(() => parse(bad)).toThrow(/malformed rules/);
		const log = mangle((d) => (d.log = [{ id: 'l', at: 1, text: 'x', tick: { ops: 'no' } }]));
		expect(() => parse(log)).toThrow(/log/);
	});

	it('keeps a character GM only, and refuses any other mark', () => {
		expect(parse(mangle((d) => (d.characters[0].hidden = true))).characters[0].hidden).toBe(true);
		expect(() => parse(mangle((d) => (d.characters[0].hidden = 'yes')))).toThrow(/malformed/);
	});

	it('keeps a list in pages, and refuses any other setting', () => {
		expect(
			parse(mangle((d) => (d.characters[0].fields[0].pages = true))).characters[0].fields[0].pages
		).toBe(true);
		expect(() => parse(mangle((d) => (d.characters[0].fields[0].pages = 'yes')))).toThrow(/pages/);
	});

	it('keeps a hidden label, and refuses any other setting', () => {
		const kept = parse(mangle((d) => (d.characters[0].fields[0].hideLabel = true)));
		expect(kept.characters[0].fields[0].hideLabel).toBe(true);
		expect(() => parse(mangle((d) => (d.characters[0].fields[0].hideLabel = 1)))).toThrow(
			/label shows/
		);
	});

	it('refuses an unknown field kind', () => {
		expect(() => parse(mangle((d) => (d.templates[0].fields[0].kind = 'dice')))).toThrow(
			/malformed/
		);
	});
});

describe('a version-2 file', () => {
	const v2 = (fn: (d: Record<string, any>) => void = () => {}) =>
		mangle((d) => {
			d.version = 2;
			for (const c of d.characters) c.statuses = [];
			d.characters[0].statuses = [{ id: 's', name: 'Poisoned', clock: d.clocks[0].id, since: 1 }];
			fn(d);
		});

	it('takes its statuses into a table', () => {
		const [ash] = parse(v2()).characters;
		const table = ash.fields.at(-1)!;
		expect(table.label).toBe('Statuses 2');
		expect(ash.values[table.id]).toMatchObject([{ cells: { [table.columns![0].id]: 'Poisoned' } }]);
	});

	it('still refuses a status on a clock that is missing', () => {
		expect(() => parse(v2((d) => (d.characters[0].statuses[0].clock = 'gone')))).toThrow(/clock/);
	});
});

describe('a version-1 file', () => {
	const v1 = {
		version: 1,
		clocks: [{ id: 'k', name: '回合', now: 3 }],
		templates: [
			{
				id: 't',
				name: '唯心空洞',
				fields: [
					{ id: 'look', label: '外貌描述', kind: 'text' },
					{ id: 'hp', label: 'HP', kind: 'resource', box: { x: 0, y: 1, w: 4, h: 1 } },
					{ id: 'luck', label: 'Luck', kind: 'number', box: { x: 4, y: 1, w: 4, h: 1 } }
				]
			}
		],
		characters: [
			{
				id: 'c',
				name: '以諾',
				template: 't',
				values: { look: '黑發藍瞳', hp: { cur: 3, max: 5 } },
				statuses: [{ id: 's', name: '慈悲', clock: 'k', since: 2, lasts: 2 }]
			}
		]
	};

	it('migrates each character onto its own copy of the template, on one tab', () => {
		const doc = parse(JSON.stringify(v1));
		expect(doc.version).toBe(3);
		const [c] = doc.characters;
		expect(c).not.toHaveProperty('template');
		expect(c.values.look).toBe('黑發藍瞳');
		expect(c.tabs).toHaveLength(1);
		expect(c.fields.map((f) => f.label)).toEqual(['外貌描述', 'HP', 'Luck', 'Statuses']);
		expect(c.fields.every((f) => f.tab === c.tabs[0].id)).toBe(true);
		expect(c.fields).not.toBe(doc.templates[0].fields);
	});

	it('turns grid cells into pixels, each row as tall as its tallest field', () => {
		const boxes = Object.fromEntries(
			parse(JSON.stringify(v1)).characters[0].fields.map((f) => [f.id, f.box])
		);
		// The box-less text flows below the boxed row, then everything floats up.
		expect(boxes.hp).toEqual({ x: 0, y: 0, w: 208, h: 88 });
		expect(boxes.luck).toEqual({ x: 224, y: 0, w: 208, h: 88 });
		expect(boxes.look).toEqual({ x: 0, y: 104, w: 656, h: 160 });
	});

	it('still refuses a character whose template is missing', () => {
		expect(() => parse(JSON.stringify({ ...v1, templates: [] }))).toThrow(/template/);
	});
});
