import type { Phrase } from './i18n.svelte';

// Shortcuts are read on the window: App's apply to the whole session, Sheet's to the sheet
// on screen. `shortcuts` is what `?` lists, so a key added to either belongs here too.

export const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

export const typing = (e: KeyboardEvent) =>
	e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]');

/** Pressed outside text boxes while no dialog is open. */
export const free = (e: KeyboardEvent) => !typing(e) && !document.querySelector('dialog[open]');

/** A key with no ⌘, Ctrl or Alt, pressed where shortcuts are free to act. */
export const plain = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey && free(e);

// A `word` is a gesture rather than a key's cap, so it shows in the page's language.
export const shortcuts: [
	title: Phrase,
	rows: [keys: (string | { word: Phrase })[], does: Phrase][]
][] = [
	[
		'Anywhere',
		[
			[['?'], 'Show these shortcuts'],
			[[`${mod}Z`], 'Undo'],
			[[`⇧${mod}Z`], 'Redo'],
			[[`${mod}S`], 'Export'],
			[[`${mod}O`], 'Import'],
			[['N', 'B'], 'Next / Back on the first clock'],
			[['[', ']'], 'Previous / next character'],
			[['1–9'], 'Go to that tab'],
			[['E'], 'Edit layout, or Done'],
			[['Esc'], 'Leave a text box']
		]
	],
	[
		'Canvas',
		[
			[[{ word: 'drag' }], 'Pan, from empty space or with the middle button'],
			[[{ word: 'wheel' }], 'Pan, or scroll a long field'],
			[[mod.replace('+', ''), { word: 'wheel' }], 'Zoom at the pointer; a pinch does too'],
			[['+', '−'], 'Zoom in / out'],
			[['⇧1'], 'Fit the tab'],
			[['⇧0'], '0,0 at 100%']
		]
	],
	[
		'Edit layout',
		[
			[['Esc'], 'Deselect the field, then Done'],
			[['←', '→', '↑', '↓'], 'Move the selected fields'],
			[['⇧', { word: 'arrows' }], 'Resize them'],
			[['Delete'], 'Delete them'],
			[['⇧', { word: 'click' }], 'Select another field too'],
			[[`${mod}C`], 'Copy the selected fields, with their values'],
			[[`${mod}V`], 'Paste them on this tab, of any character'],
			[[`${mod}G`], 'Bind the selected fields, to move, copy and delete as one'],
			[[`⇧${mod}G`], 'Unbind them'],
			[
				[`${mod}]`, `${mod}[`],
				'Bring them forward / send them backward, past a field they overlap'
			],
			[[`⇧${mod}]`, `⇧${mod}[`], 'Bring them to the front / send them to the back'],
			[[{ word: 'click' }, { word: 'again' }], 'Pick one field out of a selected binding']
		]
	]
];
