import type { View } from './view';

export type Panel = 'field' | 'template';

// View state, not document state: no undo step, not saved. Kept outside the sheet, which
// is rebuilt per character, so switching characters leaves panels and each tab's view be.
export const ui = $state({
	/** The right-hand panel open in Edit layout, or none. */
	panel: 'field' as Panel | null,
	views: {} as Record<string, View>
});
