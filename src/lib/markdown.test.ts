import { describe, expect, it } from 'vitest';
import { markdown } from './markdown';

describe('markdown', () => {
	it('renders emphasis, lists and headings', () => {
		const html = markdown('# 背景\n\n**慈悲** and *mercy*\n\n- one\n- two');
		expect(html).toContain('<h1>背景</h1>');
		expect(html).toContain('<strong>慈悲</strong>');
		expect(html).toContain('<em>mercy</em>');
		expect(html).toContain('<li>one</li>');
	});

	it('keeps a single newline as a line break', () => {
		expect(markdown('first\nsecond')).toContain('first<br>\nsecond');
	});

	it('escapes raw HTML', () => {
		const html = markdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img');
	});

	it('refuses javascript: links', () => {
		expect(markdown('[x](javascript:alert(1))')).not.toContain('href');
	});

	it('makes a one-line title a heading when it starts with #', () => {
		expect(markdown('# 調整者')).toBe('<h1>調整者</h1>\n');
	});

	it('opens links in a new tab', () => {
		expect(markdown('[rules](https://example.com)')).toContain(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer">rules</a>'
		);
	});
});
