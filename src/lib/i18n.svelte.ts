// A preference of this browser, as the theme is: every room shows in it, and what players
// type stays as typed. A phrase is its English text, and `zh` is keyed by those phrases, so
// a phrase without its translation fails the type-check. Excel's function names stay English.
import zh from './zh';

export const languages = [
	{ id: 'en', name: 'English', tag: 'en' },
	{ id: 'zh', name: '繁體中文', tag: 'zh-Hant-TW' }
] as const;
export type LangId = (typeof languages)[number]['id'];
export type Phrase = keyof typeof zh;

const KEY = 'sheet.lang';

function saved(): LangId {
	try {
		const id = localStorage.getItem(KEY);
		if (languages.some((l) => l.id === id)) return id as LangId;
	} catch {}
	return 'en';
}

let current = $state<LangId>(saved());

// Chinese glyphs differ by region, so the page says which it is.
const tag = () => {
	if (typeof document !== 'undefined')
		document.documentElement.lang = languages.find((l) => l.id === current)!.tag;
};
tag();

export const lang = {
	get id() {
		return current;
	},
	set id(id: LangId) {
		current = id;
		tag();
		try {
			localStorage.setItem(KEY, id);
		} catch {}
	}
};

/** A phrase in this browser's language, its `{name}`s filled from `vars`. */
export function t(phrase: Phrase, vars?: Record<string, string | number>): string {
	const text: string = current === 'zh' ? zh[phrase] : phrase;
	return vars
		? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
		: text;
}

/** Each `{name}` a text fills, for checking a translation keeps them all. */
export const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
