import { describe, expect, it } from 'vitest';
import type { Field, Kind } from './doc';
import { COLS, place, readingOrder, resolve, type Box } from './layout';

const f = (id: string, kind: Kind, box?: Box): Field => ({ id, label: id, kind, box });
const at = (boxes: Map<string, Box>) => Object.fromEntries(boxes);

describe('resolve', () => {
	it('flows a phase-1 template: prose full width, numbers three to a row', () => {
		const boxes = resolve([
			f('look', 'text'),
			f('str', 'number'),
			f('dex', 'number'),
			f('con', 'number'),
			f('hp', 'resource'),
			f('story', 'entries')
		]);
		expect(at(boxes)).toEqual({
			look: { x: 0, y: 0, w: COLS, h: 1 },
			str: { x: 0, y: 1, w: 4, h: 1 },
			dex: { x: 4, y: 1, w: 4, h: 1 },
			con: { x: 8, y: 1, w: 4, h: 1 },
			hp: { x: 0, y: 2, w: 4, h: 1 },
			story: { x: 0, y: 3, w: COLS, h: 1 }
		});
	});

	it('closes holes and pulls overlapping boxes apart', () => {
		const boxes = resolve([
			f('a', 'text', { x: 0, y: 3, w: 6, h: 1 }),
			f('b', 'text', { x: 2, y: 3, w: 6, h: 2 })
		]);
		expect(boxes.get('a')).toEqual({ x: 0, y: 0, w: 6, h: 1 });
		expect(boxes.get('b')).toEqual({ x: 2, y: 1, w: 6, h: 2 });
	});

	it('pulls a box that hangs off the edge back onto the grid', () => {
		expect(resolve([f('a', 'text', { x: 10, y: 0, w: 6, h: 0 })]).get('a')).toEqual({
			x: 6,
			y: 0,
			w: 6,
			h: 1
		});
	});
});

describe('place', () => {
	const sheet = () => [f('look', 'text'), f('aspects', 'tags'), f('story', 'text')];

	it('sets two fields side by side', () => {
		const once = place(sheet(), 'look', { x: 0, y: 0, w: 6, h: 1 });
		const fields = sheet().map((x) => ({ ...x, box: once.get(x.id) }));
		const twice = place(fields, 'aspects', { x: 6, y: 0, w: 6, h: 1 });
		expect(at(twice)).toEqual({
			look: { x: 0, y: 0, w: 6, h: 1 },
			aspects: { x: 6, y: 0, w: 6, h: 1 },
			story: { x: 0, y: 1, w: COLS, h: 1 }
		});
	});

	it('moves a field one row down, past the one below it', () => {
		const boxes = place(sheet(), 'look', { x: 0, y: 1, w: COLS, h: 1 });
		expect(readingOrder(boxes)).toEqual(['aspects', 'look', 'story']);
	});

	it('moves a field to the top, pushing the rest down', () => {
		const boxes = place(sheet(), 'story', { x: 0, y: 0, w: COLS, h: 1 });
		expect(readingOrder(boxes)).toEqual(['story', 'look', 'aspects']);
	});

	it('floats a field dropped far below back up under the rest', () => {
		expect(place(sheet(), 'look', { x: 0, y: 9, w: COLS, h: 1 }).get('look')!.y).toBe(2);
	});

	it('pushes neighbours down when a field grows taller', () => {
		const boxes = place(sheet(), 'look', { x: 0, y: 0, w: COLS, h: 3 });
		expect(boxes.get('aspects')!.y).toBe(3);
		expect(boxes.get('story')!.y).toBe(4);
	});
});
