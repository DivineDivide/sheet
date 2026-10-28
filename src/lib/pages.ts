// A table or entries list that flips pages instead of scrolling (`Field.pages`): each page
// holds the rows that fit its box whole, so how many depends on how tall they are.

/** A row's top and bottom, in px on one axis. */
export type Span = { top: number; bottom: number };

/** The first row of each page. A row taller than `room` has a page to itself. */
export function pageStarts(rows: Span[], room: number): number[] {
	const starts: number[] = [];
	for (let i = 0; i < rows.length;) {
		starts.push(i);
		let j = i + 1;
		while (j < rows.length && rows[j].bottom - rows[i].top <= room) j++;
		i = j;
	}
	return starts;
}
