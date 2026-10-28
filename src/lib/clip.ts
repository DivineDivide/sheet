// Fields copied with ⌘C, kept off the system clipboard so they paste onto any character, and
// in Safari, which sends no copy event without a selection. Kept in this browser too, so a
// copy survives a reload and pastes in another tab or room.

import type { Group } from './group';

/** `at` is where the fields sat, to paste them back there. */
export type Clip = Group & { at: { x: number; y: number } };

const KEY = 'sheet.clip';
let clip: Clip | null = null;

export function keep(c: Clip) {
	clip = c;
	try {
		localStorage.setItem(KEY, JSON.stringify(c));
	} catch {}
}

/** The last copy in this browser, from any tab or room. */
export function kept(): Clip | null {
	try {
		const c = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		return Array.isArray(c?.fields) ? c : clip;
	} catch {
		return clip;
	}
}
