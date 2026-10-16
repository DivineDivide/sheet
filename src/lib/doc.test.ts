import { describe, expect, it } from 'vitest';
import { blank, left, phase, valueOf, type Character, type Clock, type Status } from './doc';

const clock = (now: number): Clock => ({ id: 'c', name: 'Turn', now });
const poisoned: Status = { id: 's', name: 'Poisoned', clock: 'c', since: 5, lasts: 3 };

describe('status time', () => {
	it('counts 3, 2, 1, then expires over three advances', () => {
		expect([5, 6, 7, 8].map((now) => left(poisoned, clock(now)))).toEqual([3, 2, 1, 0]);
		expect([5, 6, 7, 8].map((now) => phase(poisoned, clock(now)))).toEqual([
			'active',
			'active',
			'active',
			'expired'
		]);
	});

	it('comes back when the clock steps back', () => {
		expect(phase(poisoned, clock(9))).toBe('expired');
		expect(phase(poisoned, clock(7))).toBe('active');
	});

	it('is pending before it was applied', () => {
		expect(phase(poisoned, clock(4))).toBe('pending');
	});

	it('lasts forever without a duration', () => {
		const cursed = { ...poisoned, lasts: undefined };
		expect(left(cursed, clock(1000))).toBe(Infinity);
		expect(phase(cursed, clock(1000))).toBe('active');
	});
});

describe('valueOf', () => {
	const ch = (values: Character['values']): Character => ({
		id: 'x',
		name: 'X',
		template: 't',
		values,
		statuses: []
	});

	it('returns a stored value of the right kind', () => {
		expect(
			valueOf(ch({ f: { cur: 3, max: 8 } }), { id: 'f', label: 'HP', kind: 'resource' })
		).toEqual({ cur: 3, max: 8 });
	});

	it('reads a value left over from another kind as blank', () => {
		expect(valueOf(ch({ f: 'old text' }), { id: 'f', label: 'HP', kind: 'number' })).toBe(0);
		expect(valueOf(ch({}), { id: 'f', label: 'Dice', kind: 'track' })).toEqual(blank('track'));
	});

	it('tells entries from tags', () => {
		const book = { id: 'f', label: '角色書', kind: 'entries' } as const;
		const entries = [{ name: '天才', text: '你覺醒出才能。' }];
		expect(valueOf(ch({ f: entries }), book)).toEqual(entries);
		expect(valueOf(ch({ f: ['祈禱', '即興'] }), book)).toEqual([]);
	});
});
