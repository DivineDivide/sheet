import { describe, expect, it } from 'vitest';
import { supported } from './regions';

describe('supported', () => {
	it('lets in where Anthropic offers Claude', () => {
		expect(['MY', 'SG', 'TW', 'JP', 'US', 'GB'].every((c) => supported(c))).toBe(true);
	});

	it('keeps out where it does not, and where Cloudflare cannot tell', () => {
		for (const c of ['HK', 'MO', 'CN', 'RU', 'IR', 'KP', 'XX', 'T1', '', null, undefined])
			expect(supported(c), String(c)).toBe(false);
	});

	it('keeps out the regions of Ukraine that Anthropic leaves out', () => {
		expect(supported('UA', '30')).toBe(true);
		expect(supported('UA', '43')).toBe(false);
		expect(supported('UA', '14')).toBe(false);
	});
});
