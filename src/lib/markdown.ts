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

export const markdown = (text: string) => md.render(text);
