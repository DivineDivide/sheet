import { newDoc, type Doc } from './doc';
import { History } from './history';
import { parse } from './io';

const KEY = 'sheet.doc';

function load(): { doc: Doc; notice?: string } {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(KEY);
	} catch {
		return { doc: newDoc(), notice: 'This browser blocks storage, so nothing will be saved.' };
	}
	if (raw === null) return { doc: newDoc() };
	try {
		return { doc: parse(raw) };
	} catch {
		// Set aside rather than overwritten by the next autosave.
		try {
			localStorage.setItem(`${KEY}.unreadable`, raw);
		} catch {}
		return {
			doc: newDoc(),
			notice: `The saved session could not be read. It was kept as "${KEY}.unreadable".`
		};
	}
}

const loaded = load();
let doc = $state<Doc>(loaded.doc);
let notice = $state<string | null>(loaded.notice ?? null);
let steps = $state({ undo: 0, redo: 0 });
const history = new History<Doc>();

function settle() {
	steps = { undo: history.past.length, redo: history.future.length };
	try {
		localStorage.setItem(KEY, JSON.stringify(doc));
	} catch {}
}

export const session = {
	get doc() {
		return doc;
	},
	get notice() {
		return notice;
	},
	set notice(text: string | null) {
		notice = text;
	},
	get canUndo() {
		return steps.undo > 0;
	},
	get canRedo() {
		return steps.redo > 0;
	},
	/** Every edit goes through here, so each is one undo step and is saved at once. */
	change(fn: (d: Doc) => void) {
		history.record($state.snapshot(doc) as Doc);
		fn(doc);
		settle();
	},
	replace(next: Doc) {
		history.record($state.snapshot(doc) as Doc);
		doc = next;
		settle();
	},
	undo() {
		const prev = history.undo($state.snapshot(doc) as Doc);
		if (!prev) return;
		doc = prev;
		settle();
	},
	redo() {
		const next = history.redo($state.snapshot(doc) as Doc);
		if (!next) return;
		doc = next;
		settle();
	}
};
