// A preference of this browser, not part of the document: switching it is no undo step
// and does not travel with an export. index.html applies the saved one before paint.

export const themes = [
	{ id: 'system', name: 'System' },
	{ id: 'light', name: 'Light' },
	{ id: 'dark', name: 'Dark' },
	{ id: 'void', name: 'Grimoire' },
	{ id: 'parchment', name: 'Parchment' },
	{ id: 'neon', name: 'Neon' },
	{ id: 'case', name: 'Case file' }
] as const;
export type ThemeId = (typeof themes)[number]['id'];

const KEY = 'sheet.theme';

function saved(): ThemeId {
	try {
		const id = localStorage.getItem(KEY);
		if (themes.some((t) => t.id === id)) return id as ThemeId;
	} catch {}
	return 'system';
}

let current = $state<ThemeId>(saved());

export const theme = {
	get id() {
		return current;
	},
	set id(id: ThemeId) {
		current = id;
		document.documentElement.dataset.theme = id;
		try {
			localStorage.setItem(KEY, id);
		} catch {}
	}
};
