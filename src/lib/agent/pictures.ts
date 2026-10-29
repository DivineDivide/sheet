// The chat gets the room with each picture as a placeholder naming where it is kept, since
// pictures are most of a room's size. A draft that copies a character copies its
// placeholders, and the room's own pictures take their place wherever the draft lands.

import type { Doc, Row } from '../doc';

const PICTURE = '[picture] ';

/** The picture of a field, or of a table's cell. Joined by `/`, since `duplicate` rewrites `<id>!`. */
export const pictureAt = (...ids: string[]) => PICTURE + ids.join('/');

const named = (v: unknown) =>
	typeof v === 'string' && v.startsWith(PICTURE) ? v.slice(PICTURE.length).split('/') : null;

/** Swaps each placeholder in `doc` for the picture `room` keeps there, or blanks it if that is gone. */
export function withPictures(doc: Doc, room: Doc) {
	const real = ([character, field, row, col]: string[]) => {
		const v = room.characters.find((c) => c.id === character)?.values[field];
		const pic =
			row === undefined
				? v
				: Array.isArray(v)
					? (v as Row[]).find((r) => r.id === row)?.cells[col]
					: undefined;
		return typeof pic === 'string' && !named(pic) ? pic : undefined;
	};
	const put = (to: Record<string, unknown>, key: string) => {
		const ids = named(to[key]);
		if (!ids) return;
		const pic = real(ids);
		if (pic === undefined) delete to[key];
		else to[key] = pic;
	};
	for (const c of doc.characters)
		for (const f of c.fields) {
			if (f.kind === 'image') put(c.values, f.id);
			const rows = c.values[f.id];
			if (f.kind !== 'table' || !Array.isArray(rows)) continue;
			for (const row of rows as Row[])
				for (const key of Object.keys(row.cells)) put(row.cells, key);
		}
}
