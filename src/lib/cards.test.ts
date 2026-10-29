import { describe, expect, it } from 'vitest';
import { below, frame, labelled, placed, stack } from './cards';
import type { Column } from './doc';

const col = (id: string, kind: Column['kind'], box?: Column['box']): Column => ({
	id,
	name: id,
	kind,
	...(box && { box })
});

describe('stack', () => {
	it('stacks the columns down one card, each its kind’s height', () => {
		const out = stack([col('a', 'text'), col('b', 'button'), col('c', 'image')]);
		expect(out.map((c) => c.box)).toEqual([
			{ x: 0, y: 0, w: 240, h: 56 },
			{ x: 0, y: 64, w: 240, h: 48 },
			{ x: 0, y: 120, w: 240, h: 136 }
		]);
	});

	it('leaves a layout alone once any column has a box', () => {
		const cols = [col('a', 'text', { x: 64, y: 0, w: 96, h: 48 }), col('b', 'number')];
		expect(stack(cols)).toBe(cols);
	});
});

describe('below', () => {
	it('goes under everything on the card, at its left edge', () => {
		const cols = [
			col('a', 'text', { x: 16, y: 0, w: 96, h: 48 }),
			col('b', 'number', { x: 120, y: 24, w: 96, h: 64 }),
			col('c', 'tags')
		];
		expect(below(cols, 'number')).toEqual({ x: 16, y: 96, w: 240, h: 56 });
	});

	it('starts at 0,0 on an empty card', () => {
		expect(below([col('a', 'text')], 'text')).toEqual({ x: 0, y: 0, w: 240, h: 56 });
	});
});

describe('placed and frame', () => {
	const cols = [
		col('low', 'number', { x: 0, y: 56, w: 96, h: 48 }),
		col('off', 'text'),
		col('right', 'number', { x: 104, y: -8, w: 96, h: 48 }),
		col('left', 'number', { x: -16, y: -8, w: 96, h: 48 })
	];

	it('skips columns off the card, and reads top to bottom, then left to right', () => {
		expect(placed(cols).map((c) => c.id)).toEqual(['left', 'right', 'low']);
	});

	it('frames every box, wherever the card’s 0,0 falls', () => {
		expect(frame(cols)).toEqual({ x: -16, y: -8, w: 216, h: 112 });
	});
});

describe('labelled', () => {
	it('shows a name unless hidden, and never over a button', () => {
		expect(labelled(col('a', 'text'))).toBe(true);
		expect(labelled({ ...col('a', 'text'), hideLabel: true })).toBe(false);
		expect(labelled(col('go', 'button'))).toBe(false);
	});
});
