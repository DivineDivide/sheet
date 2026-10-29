import { describe, expect, it } from 'vitest';
import { curAt, curFor, fullness } from './bar';

describe('curAt', () => {
	it('sets the whole step nearest the press', () => {
		expect(curAt(0, 200, 10)).toBe(0);
		expect(curAt(100, 200, 10)).toBe(5);
		expect(curAt(109, 200, 10)).toBe(5);
		expect(curAt(111, 200, 10)).toBe(6);
		expect(curAt(200, 200, 10)).toBe(10);
	});

	it('stays between 0 and max when dragged past either end', () => {
		expect(curAt(-40, 200, 10)).toBe(0);
		expect(curAt(260, 200, 10)).toBe(10);
	});

	it('sets 0 on a bar with no max, or no width', () => {
		expect(curAt(100, 200, 0)).toBe(0);
		expect(curAt(100, 0, 10)).toBe(0);
	});
});

describe('fullness', () => {
	it('is the share of max', () => {
		expect(fullness({ cur: 7, max: 10 })).toBe(70);
	});

	it('shows full or empty for a current past either end', () => {
		expect(fullness({ cur: 14, max: 10 })).toBe(100);
		expect(fullness({ cur: -2, max: 10 })).toBe(0);
		expect(fullness({ cur: 3, max: 0 })).toBe(0);
	});
});

describe('curFor', () => {
	it('steps by one, or goes to either end', () => {
		expect(curFor('ArrowRight', 4, 10)).toBe(5);
		expect(curFor('ArrowDown', 4, 10)).toBe(3);
		expect(curFor('Home', 4, 10)).toBe(0);
		expect(curFor('End', 4, 10)).toBe(10);
		expect(curFor('a', 4, 10)).toBeUndefined();
	});

	it('stays between 0 and max, as a press does', () => {
		expect(curFor('ArrowLeft', 0, 10)).toBe(0);
		expect(curFor('ArrowUp', 10, 10)).toBe(10);
		expect(curFor('ArrowLeft', 14, 10)).toBe(10);
		expect(curFor('ArrowRight', 3, 0)).toBe(0);
	});
});
