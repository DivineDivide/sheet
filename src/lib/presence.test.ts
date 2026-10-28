import { describe, expect, it } from 'vitest';
import { firstFree, nameOf, presenceIn } from './presence';

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

it('nameOf falls back to GM, then to the guest by colour', () => {
	expect(nameOf({ who: 'w', color: 2, name: 'Ash' })).toBe('Ash');
	expect(nameOf({ who: 'w', color: 2, gm: true })).toBe('GM');
	expect(nameOf({ who: 'w', color: 2 })).toBe('Guest 3');
});
