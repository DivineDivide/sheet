import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
	it('undoes and redoes in order', () => {
		const h = new History<number>();
		h.record(1);
		h.record(2);
		expect(h.undo()).toBe(2);
		expect(h.undo()).toBe(1);
		expect(h.undo()).toBeUndefined();
		expect(h.redo()).toBe(1);
		expect(h.redo()).toBe(2);
		expect(h.redo()).toBeUndefined();
	});

	it('drops the redo branch on a new change', () => {
		const h = new History<number>();
		h.record(1);
		h.undo();
		h.record(2);
		expect(h.redo()).toBeUndefined();
	});

	it('forgets the oldest step past its limit', () => {
		const h = new History<number>(2);
		h.record(1);
		h.record(2);
		h.record(3);
		expect(h.undo()).toBe(3);
		expect(h.undo()).toBe(2);
		expect(h.undo()).toBeUndefined();
	});
});
