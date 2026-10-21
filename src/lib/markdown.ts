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

export const markdown = (text: string) => md.render(text);
