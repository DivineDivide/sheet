import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
	it('undoes and redoes in order', () => {
		const h = new History<number>();
		h.record(1);
		h.record(2);
		expect(h.undo(3)).toBe(2);
		expect(h.undo(2)).toBe(1);
		expect(h.undo(1)).toBeUndefined();
		expect(h.redo(1)).toBe(2);
		expect(h.redo(2)).toBe(3);
		expect(h.redo(3)).toBeUndefined();
	});

	it('drops the redo branch on a new change', () => {
		const h = new History<number>();
		h.record(1);
		h.undo(2);
		h.record(1);
		expect(h.redo(5)).toBeUndefined();
	});

	it('forgets the oldest step past its limit', () => {
		const h = new History<number>(2);
		h.record(1);
		h.record(2);
		h.record(3);
		expect(h.undo(4)).toBe(3);
		expect(h.undo(3)).toBe(2);
		expect(h.undo(2)).toBeUndefined();
	});
});
