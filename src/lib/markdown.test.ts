import { describe, expect, it } from 'vitest';
import { markdown, setPick } from './markdown';

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

	it('shows a pick as what it holds where nobody can choose', () => {
		expect(markdown('使武器附帶{GM!元素=火}屬性')).toBe('<p>使武器附帶火屬性</p>\n');
		expect(markdown('{near|far}')).toBe('<p>{near|far}</p>\n');
		expect(markdown('{note} and {a=b}')).toBe('<p>{note} and {a=b}</p>\n');
	});

	it("offers a table's rows by name, blank showing the table", () => {
		const tables = (ref: string) => (ref === 'GM!Elements' ? ['Fire', 'Ice'] : undefined);
		const html = markdown('Deals {GM!Elements} damage', tables);
		expect(html).toContain('<select data-at="6" tabindex="-1" aria-label="Elements" class="none">');
		expect(html).toContain(
			'<option value="">Elements</option><option>Fire</option><option>Ice</option>'
		);
		expect(markdown('{Nobody!Elements}', tables)).toBe('<p>{Nobody!Elements}</p>\n');
	});

	it('offers typed choices, and keeps a choice they no longer have', () => {
		const html = markdown('{near|far=far} {a|b=c}', () => undefined);
		expect(html).toContain('<option>near</option><option selected>far</option>');
		expect(html).toContain('<option>a</option><option>b</option><option selected>c</option>');
	});

	it('finds each pick in the source, past code and markers', () => {
		const text = '`{a|b}` and {a|b}\n\n> {a|b}\n- x\n- {a|b=a} {a|b}';
		const at = [...markdown(text, () => undefined).matchAll(/data-at="(\d+)"/g)].map((m) => +m[1]);
		expect(at).toEqual([12, 21, 33, 41]);
		expect(setPick(text, 41, 'b').slice(41)).toBe('{a|b=b}');
	});

	it('writes a choice into the text, and clears it', () => {
		expect(setPick('x {a|b} y', 2, 'b')).toBe('x {a|b=b} y');
		expect(setPick('x {a|b=b} y', 2, '')).toBe('x {a|b} y');
		expect(setPick('x {a|b} y', 0, 'b')).toBe('x {a|b} y');
		expect(setPick('x {a|b} y', 2, 'c}')).toBe('x {a|b} y');
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
