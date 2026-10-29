import { describe, expect, it } from 'vitest';
import type { Field, Kind } from './doc';
import { MIN, bounds, clamp, readingOrder, restack, settle, type Box } from './layout';

const f = (id: string, kind: Kind, box: Box): Field => ({ id, label: id, kind, tab: 't', box });

describe('clamp', () => {
	it('snaps to the 8px step, either side of 0,0', () => {
		expect(clamp({ x: -30, y: 13, w: 301, h: 99 })).toEqual({ x: -32, y: 16, w: 304, h: 96 });
	});

	it('will not shrink a box past the minimum', () => {
		expect(clamp({ x: 0, y: 0, w: 10, h: 10 })).toEqual({ x: 0, y: 0, ...MIN });
	});
});

describe('bounds', () => {
	it('spans every box, wherever 0,0 falls', () => {
		const boxes = [
			{ x: -100, y: 40, w: 160, h: 88 },
			{ x: 400, y: -20, w: 480, h: 160 }
		];
		expect(bounds(boxes)).toEqual({ x: -100, y: -20, w: 980, h: 160 });
	});

	it('is empty at 0,0 with nothing placed', () => {
		expect(bounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
	});
});

describe('settle', () => {
	const fields = [
		f('look', 'text', { x: 0, y: 0, w: 160, h: 200 }),
		f('powers', 'entries', { x: 176, y: 0, w: 240, h: 200 }),
		f('shards', 'entries', { x: 0, y: 216, w: 160, h: 240 }),
		f('story', 'text', { x: 176, y: 216, w: 240, h: 160 }),
		f('notes', 'text', { x: 0, y: 472, w: 416, h: 104 })
	];
	const unchanged = Object.fromEntries(fields.map((x) => [x.id, x.box.h]));

	it('leaves a sheet whose boxes did not grow where it was', () => {
		expect(settle(fields, unchanged)).toEqual({
			look: 0,
			powers: 0,
			shards: 216,
			story: 216,
			notes: 472
		});
	});

	it('pushes down only what sits under a grown box, keeping its gap', () => {
		const tops = settle(fields, { ...unchanged, powers: 500 });
		expect(tops.shards).toBe(216);
		expect(tops.story).toBe(516);
		// Under both columns, so it clears the lower bottom of the two, by its old gap.
		expect(tops.notes).toBe(516 + 160 + 472 - 376);
	});
});

describe('readingOrder', () => {
	it('reads top to bottom, then left to right', () => {
		const fields = [
			f('story', 'text', { x: 0, y: 200, w: 480, h: 160 }),
			f('luck', 'number', { x: 320, y: 0, w: 160, h: 88 }),
			f('hp', 'resource', { x: 0, y: 0, w: 240, h: 88 })
		];
		expect(readingOrder(fields).map((x) => x.id)).toEqual(['hp', 'luck', 'story']);
	});
});

describe('restack', () => {
	const ids = (fields: Field[]) => fields.map((x) => x.id);
	const a = f('a', 'number', { x: 0, y: 0, w: 160, h: 88 });
	const c = f('c', 'number', { x: 80, y: 40, w: 160, h: 88 });
	const d = f('d', 'number', { x: 40, y: 24, w: 160, h: 88 });
	const apart = f('apart', 'number', { x: 400, y: 0, w: 160, h: 88 });

	it('steps past the nearest field it overlaps, and front and back past them all', () => {
		expect(ids(restack([a, c, d], ['a'], 'forward'))).toEqual(['c', 'a', 'd']);
		expect(ids(restack([a, c, d], ['a'], 'front'))).toEqual(['c', 'd', 'a']);
		expect(ids(restack([a, c, d], ['d'], 'backward'))).toEqual(['a', 'd', 'c']);
		expect(ids(restack([a, c, d], ['d'], 'back'))).toEqual(['d', 'a', 'c']);
	});

	it('passes a field it does not overlap only on the way to one it does', () => {
		expect(ids(restack([a, apart, c], ['a'], 'forward'))).toEqual(['apart', 'c', 'a']);
	});

	it('gives back the list itself when nothing it overlaps is in the way', () => {
		const fields = [a, apart, { ...c, tab: 'other' }];
		expect(restack(fields, ['a'], 'front')).toBe(fields);
		expect(restack(fields, ['a'], 'forward')).toBe(fields);
		expect(restack([a, c], ['c'], 'front')).toEqual([a, c]);
	});

	it('moves a selection whole, keeping a caption over its picture', () => {
		const picture = f('picture', 'image', { x: 0, y: 0, w: 320, h: 240 });
		const caption = f('caption', 'text', { x: 16, y: 16, w: 160, h: 48 });
		const badge = f('badge', 'image', { x: 200, y: 104, w: 160, h: 88 });
		const sel = ['picture', 'caption'];
		const up = restack([picture, caption, badge], sel, 'forward');
		expect(ids(up)).toEqual(['badge', 'picture', 'caption']);
		expect(ids(restack(up, sel, 'backward'))).toEqual(['picture', 'caption', 'badge']);
	});
});
