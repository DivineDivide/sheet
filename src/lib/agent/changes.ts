// What a draft changes, in words for the GM, and which fields to outline on the sheet.

import type { Doc } from '../doc';
import { apply, type Op } from '../sync';

type Named = { id: string; name: string };
const nameIn = (list: Named[], id: string) => list.find((x) => x.id === id)?.name;

export function changes(room: Doc, ops: Op[]): { lines: string[]; fields: Set<string> } {
	const after = structuredClone(room);
	for (const op of ops) apply(after, op);
	const lines = new Set<string>();
	const fields = new Set<string>();
	// Per character, the labels added, changed and removed, in the order first met.
	const per = new Map<string, { added: Set<string>; changed: Set<string>; removed: Set<string> }>();

	for (const op of ops) {
		const [root, id, part, sub] = op.p;
		if (root === 'clocks' || root === 'templates') {
			const what = root === 'clocks' ? 'clock' : 'template';
			const was = id && nameIn(room[root], id);
			const now = id && nameIn(after[root], id);
			if (!id) lines.add(`Reordered the ${what}s`);
			else if (!was) lines.add(`New ${what} ${now}`);
			else if (!now) lines.add(`Removed ${what} ${was}`);
			else lines.add(`Changed ${what} ${now}`);
			continue;
		}
		if (root !== 'characters') continue;
		const was = room.characters.find((c) => c.id === id);
		const now = after.characters.find((c) => c.id === id);
		if (!id) lines.add('Reordered the characters');
		else if (!was && now) {
			lines.add(`New character ${now.name}`);
			for (const f of now.fields) fields.add(f.id);
		} else if (was && !now) lines.add(`Removed character ${was.name}`);
		else if (was && now) {
			if (part === 'name') lines.add(`Renamed ${was.name} to ${now.name}`);
			else if (part === 'tabs') lines.add(`Changed ${now.name}'s tabs`);
			else if ((part === 'fields' || part === 'values') && sub) {
				const before = was.fields.find((f) => f.id === sub);
				const field = now.fields.find((f) => f.id === sub);
				const p = per.get(id) ?? { added: new Set(), changed: new Set(), removed: new Set() };
				per.set(id, p);
				if (!field) p.removed.add(before?.label ?? '');
				else {
					(before ? p.changed : p.added).add(field.label);
					fields.add(sub);
				}
			}
		}
	}
	for (const [id, p] of per) {
		const name = after.characters.find((c) => c.id === id)!.name;
		const parts = [
			p.added.size && `added ${[...p.added].join(', ')}`,
			p.changed.size && `changed ${[...p.changed].join(', ')}`,
			p.removed.size && `removed ${[...p.removed].join(', ')}`
		].filter(Boolean);
		lines.add(`${name}: ${parts.join('; ')}`);
	}
	return { lines: [...lines], fields };
}
