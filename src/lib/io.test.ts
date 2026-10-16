import { describe, expect, it } from 'vitest';
import { newDoc, type Doc } from './doc';
import { ImportError, parse, serialize } from './io';

function party(): Doc {
	const doc = newDoc();
	const [hp, notes] = doc.templates[0].fields;
	doc.characters.push({
		id: 'a',
		name: 'Ash',
		template: doc.templates[0].id,
		values: { [hp.id]: { cur: 4, max: 10 }, [notes.id]: 'hates boats' },
		statuses: [{ id: 's', name: 'Poisoned', clock: doc.clocks[0].id, since: 1, lasts: 3 }]
	});
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
		expect(() => parse(mangle((d) => (d.version = 2)))).toThrow(/newer version/);
	});

	it('refuses a character whose template is missing', () => {
		expect(() => parse(mangle((d) => (d.templates = [])))).toThrow(/template/);
	});

	it('refuses a status on a clock that is missing', () => {
		expect(() => parse(mangle((d) => (d.clocks = [])))).toThrow(/clock/);
	});

	it('refuses a field position that is not numbers', () => {
		expect(() =>
			parse(mangle((d) => (d.templates[0].fields[0].box = { x: 'left', y: 0, w: 6, h: 1 })))
		).toThrow(/bad position/);
	});

	it('refuses an unknown field kind', () => {
		expect(() => parse(mangle((d) => (d.templates[0].fields[0].kind = 'dice')))).toThrow(
			/malformed/
		);
	});
});
