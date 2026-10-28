import type { View } from './view';

export type Panel = 'field' | 'template' | 'chat';

// View state, not document state: no undo step, not saved. Kept outside the sheet, which
// is rebuilt per character, so switching characters leaves panels and each tab's view be.
export const ui = $state({
	/** The panel open on the right: the chat's, or in Edit layout an inspector's. */
	panel: 'field' as Panel | null,
	views: {} as Record<string, View>,
	/** The page each paged list shows, by `globalId`; each browser flips its own. */
	pages: {} as Record<string, number>
});
