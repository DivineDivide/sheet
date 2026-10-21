import { describe, expect, it } from 'vitest';
import { HOME, ZOOM, fit, toSheet, zoomAt } from './view';

describe('toSheet', () => {
	it('puts 0,0 in the middle of the screen at home', () => {
		expect(toSheet(HOME, 0, 0)).toEqual({ x: 0, y: 0 });
		expect(toSheet({ x: 100, y: -40, z: 2 }, 50, 50)).toEqual({ x: 125, y: -15 });
	});
});

describe('zoomAt', () => {
	it('keeps the point under the pointer still', () => {
		const before = { x: 30, y: 10, z: 1 };
		const after = zoomAt(before, 2, 200, -80);
		expect(toSheet(after, 200, -80)).toEqual(toSheet(before, 200, -80));
		expect(after.z).toBe(2);
	});

	it('stops at the zoom limits', () => {
		expect(zoomAt(HOME, 100).z).toBe(ZOOM.max);
		expect(zoomAt(HOME, 0.01).z).toBe(ZOOM.min);
	});
});

describe('fit', () => {
	it('centres on the boxes and never magnifies', () => {
		const v = fit([{ x: -100, y: 0, w: 200, h: 100 }], 1000, 800);
		expect(v).toEqual({ x: 0, y: 50, z: 1 });
	});

	it('zooms out to show a sheet larger than the screen', () => {
		// 1096 less two 48px margins leaves 1000 for 2000.
		const v = fit([{ x: 0, y: 0, w: 2000, h: 400 }], 1096, 800);
		expect(v.z).toBe(0.5);
	});

	it('goes home on an empty tab', () => {
		expect(fit([], 1000, 800)).toEqual(HOME);
	});
});
