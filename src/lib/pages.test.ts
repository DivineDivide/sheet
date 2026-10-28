import { describe, expect, it } from 'vitest';
import { pageStarts, type Span } from './pages';

/** Rows of these heights, one after another with `gap` between. */
function rows(heights: number[], gap = 0): Span[] {
	let y = 0;
	return heights.map((h) => {
		const s = { top: y, bottom: y + h };
		y += h + gap;
		return s;
	});
}

describe('pageStarts', () => {
	it('has no pages for no rows', () => {
		expect(pageStarts([], 100)).toEqual([]);
	});

	it('keeps every row on one page when all fit', () => {
		expect(pageStarts(rows([30, 30, 30]), 90)).toEqual([0]);
	});

	it('starts a page at the first row that does not fit whole', () => {
		expect(pageStarts(rows([30, 30, 30, 30, 30]), 70)).toEqual([0, 2, 4]);
	});

	it('counts the gaps between rows', () => {
		expect(pageStarts(rows([30, 30, 30], 10), 70)).toEqual([0, 2]);
	});

	it('fits fewer tall rows on a page', () => {
		expect(pageStarts(rows([20, 20, 60, 20, 20, 20]), 60)).toEqual([0, 2, 3]);
	});

	it('gives a row taller than the box a page to itself', () => {
		expect(pageStarts(rows([20, 200, 20]), 60)).toEqual([0, 1, 2]);
	});
});
