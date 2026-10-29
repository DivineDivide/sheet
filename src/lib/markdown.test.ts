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

	it('ends a list item at a line typed at the start', () => {
		expect(markdown('1. one\n--')).toBe('<ol>\n<li>one</li>\n</ol>\n<p>--</p>\n');
		expect(markdown('- one\n  more')).toContain('<li>one<br>\nmore</li>');
	});

	it('starts a list at the number typed after a line of text', () => {
		expect(markdown('--\n6. six\n7. seven')).toBe(
			'<p>--</p>\n<ol start="6">\n<li>six</li>\n<li>seven</li>\n</ol>\n'
		);
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
