// Bound fields are selected as one in Edit layout, so they move, copy and delete together.
// A binding counts only on one tab: a field moved to another leaves it behind.

import { newId, type Field } from './doc';

/** The ids of the fields bound with `id`, itself last, or only `id`. */
export function mates(fields: Field[], id: string): string[] {
	const f = fields.find((x) => x.id === id);
	if (!f?.bind) return [id];
	const others = fields.filter((x) => x !== f && x.bind === f.bind && x.tab === f.tab);
	return [...others.map((x) => x.id), id];
}

/**
 * The selection after a click on `id`, the last selected being the one inspected: its
 * binding, or, clicked again inside a selected binding, that one field, to inspect or move
 * alone.
 */
export function clicked(fields: Field[], chosen: string[], id: string): string[] {
	const m = mates(fields, id);
	if (!chosen.includes(id)) return m;
	if (chosen.length === 1) return chosen;
	const whole = m.length > 1 && m.length === chosen.length && m.every((x) => chosen.includes(x));
	return whole ? [id] : m;
}

/** The selection after a shift-click on `id`, which adds or takes away its whole binding. */
export function toggled(fields: Field[], chosen: string[], id: string): string[] {
	const m = mates(fields, id);
	const rest = chosen.filter((x) => !m.includes(x));
	return chosen.includes(id) ? rest : [...rest, ...m];
}

/** What the bind tool does to the fields `ids`: unbind them if they are one binding already. */
export function bindAction(fields: Field[], ids: string[]): 'bind' | 'unbind' | null {
	const picked = fields.filter((f) => ids.includes(f.id));
	const one = picked[0]?.bind;
	if (one && mates(fields, picked[0].id).length > 1 && picked.every((f) => f.bind === one))
		return 'unbind';
	return picked.length > 1 ? 'bind' : null;
}

/** Binds the fields `ids` as one, apart from any they were bound with, or unbinds them. */
export function toggleBind(fields: Field[], ids: string[]) {
	const act = bindAction(fields, ids);
	if (!act) return;
	const bind = newId();
	for (const f of fields) {
		if (!ids.includes(f.id)) continue;
		if (act === 'bind') f.bind = bind;
		else delete f.bind;
	}
	loosen(fields);
}

/** Frees each field left bound to nothing else on its tab. */
export function loosen(fields: Field[]) {
	for (const f of fields) if (f.bind && mates(fields, f.id).length < 2) delete f.bind;
}
