import { describe, expect, it } from 'vitest';
import { frame, labelled, lay, placed, room, spot } from './cards';
import type { Column } from './doc';

const col = (id: string, kind: Column['kind'], box?: Column['box']): Column => ({
	id,
	name: id,
	kind,
	...(box && { box })
});

describe('lay', () => {
	it('stacks the columns down one card, each its kind’s height, with no width', () => {
		const out = lay([col('a', 'text'), col('b', 'button'), col('c', 'image')]);
		expect(out.map((c) => c.box)).toEqual([
			{ x: 0, y: 0, w: 240, h: 56 },
			{ x: 0, y: 64, w: 240, h: 48 },
			{ x: 0, y: 128, w: 240, h: 136 }
		]);
	});

	it('leaves a layout alone once any column has a box', () => {
		const cols = [col('a', 'text', { x: 64, y: 0, w: 96, h: 48 }), col('b', 'number')];
		expect(lay(cols, 1000)).toBe(cols);
	});

	it('fills rows as wide as it is given before starting another', () => {
		const out = lay([col('a', 'text'), col('b', 'text'), col('c', 'text')], 496);
		expect(out.map((c) => [c.box!.x, c.box!.y])).toEqual([
			[0, 0],
			[256, 0],
			[0, 64]
		]);
	});
});

describe('spot', () => {
	it('goes under everything on the card, at its left edge, when nothing fits beside', () => {
		const cols = [
			col('a', 'text', { x: 16, y: 0, w: 96, h: 48 }),
			col('b', 'number', { x: 120, y: 24, w: 96, h: 64 }),
			col('c', 'tags')
		];
		expect(spot(cols, 'number', 400)).toEqual({ x: 16, y: 96, w: 240, h: 56 });
	});

	it('starts at 0,0 on an empty card', () => {
		expect(spot([col('a', 'text')], 'text', 400)).toEqual({ x: 0, y: 0, w: 240, h: 56 });
	});

	it('takes the first free spot beside a box, top row first, within the width', () => {
		const cols = [
			col('a', 'text', { x: 0, y: 0, w: 240, h: 56 }),
			col('b', 'text', { x: 0, y: 64, w: 96, h: 56 }),
			col('c', 'text', { x: 104, y: 64, w: 96, h: 56 })
		];
		expect(spot(cols, 'number', 496)).toEqual({ x: 256, y: 0, w: 240, h: 56 });
		expect(spot(cols, 'number', 400)).toEqual({ x: 0, y: 128, w: 240, h: 56 });
	});
});

describe('room', () => {
	it('leaves the field’s padding and the card’s, and the label unless hidden', () => {
		const box = { x: 0, y: 0, w: 480, h: 160 };
		expect(room({ box })).toEqual({ w: 440, h: 96 });
		expect(room({ box, hideLabel: true })).toEqual({ w: 440, h: 120 });
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
