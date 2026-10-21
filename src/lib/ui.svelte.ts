import type { View } from './view';

export type Panel = 'field' | 'statuses' | 'template';

// View state, not document state: no undo step, not saved. Kept outside the sheet, which
// is rebuilt per character, so switching characters leaves panels and each tab's view be.
export const ui = $state({
	/** The right-hand panel open in each mode, or none. */
	panel: {
		// Not at start on a narrow screen, where the see-through panel would sit on the fields.
		play: matchMedia('(min-width: 900px)').matches ? 'statuses' : null,
		edit: 'field'
	} as Record<'play' | 'edit', Panel | null>,
	views: {} as Record<string, View>
});
