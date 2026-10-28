import { afterEach, describe, expect, it } from 'vitest';
import { lang, slots, t } from './i18n.svelte';
import zh from './zh';

describe('t', () => {
	afterEach(() => (lang.id = 'en'));

	it('shows the English phrase as written, its names filled', () => {
		expect(t('Undo')).toBe('Undo');
		expect(t('Offline · {n} unsent', { n: 3 })).toBe('Offline · 3 unsent');
	});

	it('shows the Chinese once chosen', () => {
		lang.id = 'zh';
		expect(t('Undo')).toBe('復原');
		expect(t('Offline · {n} unsent', { n: 3 })).toMatch(/3/);
	});

	it('keeps every name a phrase fills in its translation', () => {
		const lost = Object.entries(zh).filter(([en, text]) => slots(en).join() !== slots(text).join());
		expect(lost).toEqual([]);
	});
});
