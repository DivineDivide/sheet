import { describe, expect, it } from 'vitest';
import { cut, firstFree, nameOf, people, presenceIn, slotFor } from './presence';

describe('presenceIn', () => {
	it('keeps what it knows and drops the rest', () => {
		const p = presenceIn({
			presence: { name: ' Ash ', gm: true, character: 'c1', tab: 't1', picked: ['f1'], x: 1 }
		});
		expect(p).toEqual({ name: 'Ash', gm: true, character: 'c1', tab: 't1', picked: ['f1'] });
	});

	it('drops values of the wrong type', () => {
		const p = presenceIn({
			presence: { name: '  ', gm: 'yes', character: 3, picked: ['f1', 2, ''], editing: {} }
		});
		expect(p).toEqual({ picked: ['f1'] });
	});

	it('cuts names, ids and selections to size', () => {
		const p = presenceIn({
			presence: {
				name: 'a'.repeat(100),
				tab: 'x'.repeat(65),
				picked: Array.from({ length: 80 }, (_, i) => `f${i}`)
			}
		});
		expect(p?.name).toHaveLength(40);
		expect(p?.tab).toBeUndefined();
		expect(p?.picked).toHaveLength(50);
	});

	it('keeps a draft, cut to size, and the cut its sender made', () => {
		const p = presenceIn({ presence: { draft: { at: 'c!f', text: 'x'.repeat(9000) } } });
		expect(p?.draft).toEqual({ at: 'c!f', text: 'x'.repeat(4096), cut: true });
		const sent = presenceIn({ presence: { draft: { at: 'c!f', text: 'short', cut: true } } });
		expect(sent?.draft).toEqual({ at: 'c!f', text: 'short', cut: true });
		expect(presenceIn({ presence: { draft: { at: 'a'.repeat(201), text: '' } } })).toEqual({});
	});

	it('is null for any other message', () => {
		expect(presenceIn({ id: 'x', ops: [] })).toBeNull();
		expect(presenceIn({ presence: [] })).toBeNull();
		expect(presenceIn(null)).toBeNull();
		expect(presenceIn('ping')).toBeNull();
	});
});

it('firstFree gives the lowest colour nobody holds', () => {
	expect(firstFree([])).toBe(0);
	expect(firstFree([1])).toBe(0);
	expect(firstFree([0, 1, 3])).toBe(2);
});

it('slotFor gives a browser the colour its other tabs hold', () => {
	const seats = [{ color: 0, browser: 'a' }, { color: 1, browser: 'b' }, { color: 3 }];
	expect(slotFor(seats, 'b')).toBe(1);
	expect(slotFor(seats, 'c')).toBe(2);
	expect(slotFor(seats)).toBe(2);
});

it('people shows each slot once, as its newest connection, where it first came', () => {
	const list = [
		{ who: 'a1', color: 0, character: 'old' },
		{ who: 'b1', color: 1 },
		{ who: 'a2', color: 0, character: 'new' }
	];
	expect(people(list)).toEqual([
		{ who: 'a2', color: 0, character: 'new' },
		{ who: 'b1', color: 1 }
	]);
});

it('nameOf falls back to GM, then to the guest by colour', () => {
	expect(nameOf({ who: 'w', color: 2, name: 'Ash' })).toBe('Ash');
	expect(nameOf({ who: 'w', color: 2, gm: true })).toBe('GM');
	expect(nameOf({ who: 'w', color: 2 })).toBe('Guest 3');
});

it('cut never splits a character', () => {
	expect(cut('short')).toEqual({ text: 'short' });
	// 4097 UTF-16 units: the cut falls inside the last emoji, which goes whole.
	expect(cut('x' + '😀'.repeat(2048))).toEqual({ text: 'x' + '😀'.repeat(2047), cut: true });
});
