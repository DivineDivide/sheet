import { describe, expect, it } from 'vitest';
import { newId, type Row } from './doc';
import { canHang, pathTo, treeOf } from './map';
import type { Source } from './source';

/** A table of places named in order, with ids a1, a2… so parents read plainly. */
function places(...names: string[]): Source {
	const name = { id: newId(), name: 'Name', kind: 'text' as const };
	const rows: Row[] = names.map((n, i) => ({ id: `a${i + 1}`, cells: { [name.id]: n } }));
	return { id: 'gm!places', name: 'GM: Places', columns: [name], rows };
}

const line = (src: Source, parents: Record<string, string>) =>
	treeOf(src, parents).spots.map((s) => `${s.name}@${s.depth},${s.line}`);

describe('treeOf', () => {
	it('leaves a row with no parent entry unplaced', () => {
		const t = treeOf(places('Town', 'Well'), { a1: '' });
		expect(t.spots.map((s) => s.name)).toEqual(['Town']);
		expect(t.unplaced.map((u) => u.name)).toEqual(['Well']);
	});

	it('draws children a column right, a parent level with its middle child', () => {
		const src = places('Town', 'Market', 'Forest', 'Port', 'Hut');
		expect(line(src, { a1: '', a2: 'a1', a3: 'a1', a4: 'a1', a5: 'a3' })).toEqual([
			'Town@0,1',
			'Market@1,0',
			'Forest@1,1',
			'Hut@2,1',
			'Port@1,2'
		]);
	});

	it('takes a row whose parent is gone or unplaced for a root', () => {
		const src = places('Town', 'Well');
		expect(line(src, { a2: 'gone' })).toEqual(['Well@0,0']);
		expect(line(src, { a2: 'a1' })).toEqual(['Well@0,0']);
	});

	it('breaks a loop rather than hiding the rows in it', () => {
		const t = treeOf(places('A', 'B'), { a1: 'a2', a2: 'a1' });
		expect(t.spots).toHaveLength(2);
		expect(t.spots.some((s) => s.parent === null)).toBe(true);
		// Hut hangs from the loop, so Hut keeps its parent whichever row is cut.
		const hung = treeOf(places('Hut', 'A', 'B'), { a1: 'a2', a2: 'a3', a3: 'a2' });
		expect(hung.spots.find((s) => s.name === 'Hut')?.parent).toBe('a2');
		expect(hung.spots).toHaveLength(3);
	});

	it('orders children as the table orders its rows', () => {
		const src = places('Town', 'Port', 'Market');
		expect(line(src, { a1: '', a3: 'a1', a2: 'a1' })).toEqual([
			'Town@0,0.5',
			'Port@1,0',
			'Market@1,1'
		]);
	});
});

describe('canHang', () => {
	const parents = { a1: '', a2: 'a1', a3: 'a2' };
	it('refuses a row under itself or under one of its own', () => {
		expect(canHang(parents, 'a1', 'a1')).toBe(false);
		expect(canHang(parents, 'a1', 'a3')).toBe(false);
	});
	it('lets a row move anywhere else, or become a root', () => {
		expect(canHang(parents, 'a3', 'a1')).toBe(true);
		expect(canHang(parents, 'a2', null)).toBe(true);
	});
});

describe('pathTo', () => {
	it('runs from the root down to the row', () => {
		const t = treeOf(places('Town', 'Forest', 'Well'), { a1: '', a2: 'a1', a3: 'a2' });
		expect([...pathTo(t, 'a3')].sort()).toEqual(['a1', 'a2', 'a3']);
	});
});
