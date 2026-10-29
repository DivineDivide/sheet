import markdownit from 'markdown-it';

// Text from an imported file is rendered too, so raw HTML stays escaped (`html: false`)
// and markdown-it refuses javascript: links. `breaks`: a newline typed in a sheet is a
// line break, as it was before text was rendered.
const md = markdownit({ html: false, breaks: true, linkify: true });

// A link opens beside the sheet rather than replacing it.
md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
	tokens[i].attrSet('target', '_blank');
	tokens[i].attrSet('rel', 'noopener noreferrer');
	return self.renderToken(tokens, i, options);
};

// With `breaks` nobody wraps a line by hand, so text shows the lines as typed: a line at
// the start ends the list item above rather than continuing it, and a numbered line after
// text starts a list at its own number, where CommonMark wants a 1.
md.block.ruler.before(
	'paragraph',
	'line_start',
	(state, line, _end, silent) => {
		if (!silent || state.parentType !== 'paragraph') return false;
		if (state.sCount[line] < state.blkIndent) return true;
		const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
		return /^\d{1,9}[.)][ \t]+\S/.test(text);
	},
	{ alt: ['paragraph'] }
);

// A pick: `{Character!Table}` offers that table's rows by name, `{a|b|c}` its own choices,
// and the choice is kept in the text, as `{a|b|c=b}`. Braces without `!` or `|` are text.
const PICK = /^\{([^{}=\n]*[!|][^{}=\n]*)(?:=([^{}\n]*))?\}/;

type Env = { tables?: (ref: string) => string[] | undefined };
type Pick = { ref: string; value: string; pos: number; at: number };

const choicesOf = (ref: string, tables?: Env['tables']): string[] | undefined =>
	ref.includes('|')
		? ref
				.split('|')
				.map((s) => s.trim())
				.filter(Boolean)
		: tables?.(ref);

md.inline.ruler.after('text', 'pick', (state, silent) => {
	if (state.src.charCodeAt(state.pos) !== 0x7b) return false;
	const m = PICK.exec(state.src.slice(state.pos));
	if (!m) return false;
	if (!silent) {
		const t = state.push('pick', '', 0);
		t.content = m[0];
		t.meta = { ref: m[1].trim(), value: (m[2] ?? '').trim(), pos: state.pos, at: -1 } as Pick;
	}
	state.pos += m[0].length;
	return true;
});

// Where each pick starts in the source, for `setPick`. A block's inline text has lost only
// its markers (`> `, `- `, indents), never a brace, so the nth copy of a pick there is the
// nth copy from the block's first line. A table's cells share their row's line and have
// none of their own, so the cells before count too.
md.core.ruler.after('inline', 'pick_at', (state) => {
	let line = 0;
	let earlier = '';
	for (const block of state.tokens) {
		if (block.map) [line, earlier] = [block.map[0], ''];
		for (const t of block.children ?? []) {
			if (t.type !== 'pick') continue;
			const pick = t.meta as Pick;
			let at = -1;
			for (let i = 0; i < line; i++) at = state.src.indexOf('\n', at + 1);
			const nth = (earlier + block.content.slice(0, pick.pos)).split(t.content).length - 1;
			for (let i = 0; i <= nth && (i === 0 || at >= 0); i++)
				at = state.src.indexOf(t.content, at + 1);
			pick.at = at;
		}
		// A pick never holds a line break, so none is counted across two cells.
		if (block.type === 'inline') earlier += `${block.content}\n`;
	}
});

md.renderer.rules.pick = (tokens, i, _options, env) => {
	const { ref, value, at } = tokens[i].meta as Pick;
	const tables = (env as Env | undefined)?.tables;
	const esc = md.utils.escapeHtml;
	const typed = ref.includes('|');
	const options = choicesOf(ref, tables);
	if (!tables || !options || at < 0) return esc(value || tokens[i].content);
	// Blank shows what to choose: the table's name, or for typed choices only that there are some.
	const blank = typed ? '…' : ref.slice(ref.indexOf('!') + 1).trim();
	const all = value && !options.includes(value) ? [...options, value] : options;
	return (
		`<span class="pick"><select data-at="${at}" tabindex="-1" aria-label="${esc(typed ? options.join(' / ') : blank)}"${value ? '' : ' class="none"'}>` +
		`<option value="">${esc(blank)}</option>` +
		all.map((o) => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('') +
		'</select></span>'
	);
};

/** `text` as HTML. Given `tables`, which names a table's rows, its picks are dropdowns. */
export const markdown = (text: string, tables?: Env['tables']) => md.render(text, { tables });

/**
 * Each pick in `text` that `markdown` draws, with its table's name (`from`) unless its choices
 * are typed, and what it offers: none at all when `tables` names no such table.
 */
export function picksIn(text: string, tables: Env['tables']) {
	return md
		.parse(text, {})
		.flatMap((block) => block.children ?? [])
		.filter((t) => t.type === 'pick')
		.map((t) => {
			const { ref, value } = t.meta as Pick;
			return {
				text: t.content,
				from: ref.includes('|') ? undefined : ref,
				value,
				choices: choicesOf(ref, tables)
			};
		});
}

/**
 * `text` with the pick starting at `at` holding `value`, or unchanged if none starts there.
 * `at` counts in the text as markdown-it reads it, every line ending in `\n`, so it is written so.
 */
export function setPick(text: string, at: number, value: string): string {
	const src = text.replace(/\r\n?/g, '\n');
	const m = PICK.exec(src.slice(at));
	if (!m || /[{}\n]/.test(value)) return text;
	return `${src.slice(0, at)}{${m[1]}${value ? `=${value}` : ''}}${src.slice(at + m[0].length)}`;
}
