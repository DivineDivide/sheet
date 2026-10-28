import { describe, expect, it } from 'vitest';
import { bindAction, clicked, loosen, mates, toggleBind, toggled } from './bind';
import type { Field } from './doc';

const field = (id: string, bind?: string, tab = 'a'): Field => ({
	id,
	label: id,
	kind: 'number',
	tab,
	box: { x: 0, y: 0, w: 96, h: 56 },
	...(bind && { bind })
});

/** HP and AC bound, Load on its own, and Gold bound with them but moved to another tab. */
const sheet = () => [field('HP', 'b'), field('AC', 'b'), field('Load'), field('Gold', 'b', 'z')];

describe('mates', () => {
	it('names the fields bound on the same tab, the asked one last', () => {
		expect(mates(sheet(), 'HP')).toEqual(['AC', 'HP']);
		expect(mates(sheet(), 'Load')).toEqual(['Load']);
		expect(mates(sheet(), 'Gold')).toEqual(['Gold']);
	});
});

describe('selecting', () => {
	it('selects a binding whole, then picks one field out on a second click', () => {
		const fs = sheet();
		const first = clicked(fs, [], 'HP');
		expect(first).toEqual(['AC', 'HP']);
		expect(clicked(fs, first, 'AC')).toEqual(['AC']);
		expect(clicked(fs, ['AC'], 'AC')).toEqual(['AC']);
	});

	it('narrows a wider selection to the clicked field and its binding', () => {
		expect(clicked(sheet(), ['Load', 'AC', 'HP'], 'HP')).toEqual(['AC', 'HP']);
		expect(clicked(sheet(), ['Load', 'AC', 'HP'], 'Load')).toEqual(['Load']);
	});

	it('adds or takes away a whole binding on a shift-click', () => {
		expect(toggled(sheet(), ['Load'], 'AC')).toEqual(['Load', 'HP', 'AC']);
		expect(toggled(sheet(), ['Load', 'HP', 'AC'], 'HP')).toEqual(['Load']);
	});
});

describe('binding', () => {
	it('binds two fields or more, and unbinds a binding', () => {
		const fs = sheet();
		expect(bindAction(fs, ['Load'])).toBeNull();
		expect(bindAction(fs, ['AC', 'HP'])).toBe('unbind');
		expect(bindAction(fs, ['AC', 'HP', 'Load'])).toBe('bind');

		toggleBind(fs, ['AC', 'HP', 'Load']);
		expect(mates(fs, 'Load')).toEqual(['HP', 'AC', 'Load']);
		expect(fs[0].bind).not.toBe('b');

		toggleBind(fs, ['AC', 'HP', 'Load']);
		expect(fs.filter((f) => f.bind).map((f) => f.id)).toEqual([]);
	});

	it('frees the one field a binding is left with', () => {
		const fs = sheet();
		toggleBind(fs, ['HP']);
		expect(fs.filter((f) => f.bind)).toEqual([]);
	});

	it('lets a field picked out of a binding of three leave it', () => {
		const fs = [...sheet(), field('MP', 'b')];
		expect(bindAction(fs, ['MP'])).toBe('unbind');
		toggleBind(fs, ['MP']);
		expect(mates(fs, 'HP')).toEqual(['AC', 'HP']);
		expect(mates(fs, 'MP')).toEqual(['MP']);
	});

	it('loosens a binding with one field left on its tab', () => {
		const fs = sheet().filter((f) => f.id !== 'AC');
		loosen(fs);
		expect(fs.filter((f) => f.bind)).toEqual([]);
	});
});
