// Fields copied together, from one character onto another or into another room, with their
// formulas and rules re-bound where they land.

import {
	newId,
	uniqueLabel,
	valueOf,
	type Character,
	type Clock,
	type Field,
	type Rule,
	type Value,
	type When
} from './doc';
import {
	FormulaError,
	compile,
	names,
	refText,
	render,
	rowNames,
	same,
	type Name,
	type Sheet
} from './formula';
import { loosen } from './bind';
import { SNAP, bounds, clamp } from './layout';
import { compileRule } from './rules';

/**
 * Fields with boxes measured from their top-left, their values if kept, and the names they
 * read outside themselves, by which those are looked up again where they land.
 */
export type Group = { fields: Field[]; values?: Record<string, Value>; names: Name[] };

// JSON, not structuredClone: these run inside `session.change`, on the live state's proxies.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const rulesOf = (f: Field) => [
	...(f.rules ?? []),
	...(f.columns ?? []).flatMap((c) => c.rules ?? [])
];
const texts = (f: Field) => [
	f.formula ?? '',
	...(f.columns ?? []).map((c) => c.formula ?? ''),
	...rulesOf(f).flatMap((r) => [r.if ?? '', ...r.then])
];
const whenId = (w: When) => ('press' in w ? w.press : w.tick);

/** `f` with the references in its formulas and rules swapped by `ids`. */
function renamed(f: Field, ids: Map<string, string>): Field {
	const swap = (t: string) =>
		[...ids].reduce((s, [a, b]) => s.split(refText(a)).join(refText(b)), t);
	const rules = (rs: Rule[] | undefined) =>
		rs?.map((r) => ({
			...r,
			when: 'press' in r.when && ids.has(r.when.press) ? { press: ids.get(r.when.press)! } : r.when,
			...(r.if !== undefined && { if: swap(r.if) }),
			then: r.then.map(swap)
		}));
	return {
		...f,
		...(f.formula !== undefined && { formula: swap(f.formula) }),
		...(f.rules && { rules: rules(f.rules) }),
		...(f.columns && {
			columns: f.columns.map((c) => ({
				...c,
				...(c.formula !== undefined && { formula: swap(c.formula) }),
				...(c.rules && { rules: rules(c.rules) })
			}))
		})
	};
}

/**
 * Fields of `c` as a group to place elsewhere, boxes measured from the group's top-left.
 * `room` is every character, whose fields the group may read as `Name!Label`.
 */
export function lift(
	c: Character,
	clocks: Clock[],
	ids: string[],
	contents: boolean,
	room: Sheet['others'] = []
): Group {
	const picked = c.fields.filter((f) => ids.includes(f.id));
	const { x, y } = bounds(picked.map((f) => f.box));
	const said = picked.flatMap(texts);
	const heard = new Set(picked.flatMap(rulesOf).map((r) => whenId(r.when)));
	const outside = names({ ...c, clocks, others: room }).filter(
		(n) => !ids.includes(n.id) && (heard.has(n.id) || said.some((t) => t.includes(refText(n.id))))
	);
	return {
		fields: picked.map((f) => ({ ...clone(f), box: { ...f.box, x: f.box.x - x, y: f.box.y - y } })),
		...(contents && {
			values: Object.fromEntries(picked.map((f) => [f.id, clone(valueOf(c, f))]))
		}),
		names: outside.map(({ id, label, kind, columns, of }) => ({
			id,
			label,
			kind,
			...(of !== undefined && { of }),
			...(columns && { columns: columns.map(({ id, name, kind }) => ({ id, name, kind })) })
		}))
	};
}

/**
 * A group's fields for a character whose other fields are `others`, with the ids `ids`
 * gives and a label of their own there. References inside the group follow it; one outside
 * is looked up by label and shows an error until a field of that label is there.
 */
function make(
	g: Group,
	others: Field[],
	clocks: Clock[],
	ids: Map<string, string>,
	where: (f: Field) => Partial<Field>,
	room: Sheet['others'],
	self: string
): Field[] {
	const made: Field[] = [];
	for (const f of g.fields) {
		const label = uniqueLabel(f.label, [...others, ...made]);
		made.push({ ...renamed(clone(f), ids), id: ids.get(f.id)!, label, ...where(f) });
	}
	const from = [...g.names, ...made];
	const to = names({ fields: [...others, ...made], values: {}, clocks, others: room, id: self });
	const again = (t: string, row: Name[]) => {
		const text = render(t, [...row, ...from]);
		try {
			return compile(text, [...row, ...to]);
		} catch (e) {
			if (!(e instanceof FormulaError)) throw e;
			return text;
		}
	};
	const whenFor = (w: When): When => {
		const n = g.names.find((x) => x.id === whenId(w));
		if (!n) return w;
		if ('press' in w) {
			// Another character's button stays that character's, wherever the rule lands.
			const b = to.find(
				(x) =>
					x.kind === 'button' &&
					same(x.label, n.label) &&
					(n.of === undefined ? x.of === undefined : x.of !== undefined && same(x.of, n.of))
			);
			return b ? { press: b.id } : w;
		}
		const k = clocks.find((x) => x.id === w.tick) ?? clocks.find((x) => same(x.name, n.label));
		return k ? { tick: k.id } : w;
	};
	const rule = (r: Rule, row: Name[]): Rule => {
		const typed = {
			...r,
			...(r.if !== undefined && { if: render(r.if, [...row, ...from]) }),
			then: r.then.map((l) => render(l, [...row, ...from]))
		};
		return { ...compileRule(typed, [...row, ...to]), id: newId(), when: whenFor(r.when) };
	};
	for (const f of made) {
		if (f.formula) f.formula = again(f.formula, []);
		if (f.rules) f.rules = f.rules.map((r) => rule(r, []));
		const row = rowNames(f);
		for (const col of f.columns ?? []) {
			if (col.formula) col.formula = again(col.formula, row);
			if (col.rules) col.rules = col.rules.map((r) => rule(r, row));
		}
	}
	return made;
}

/**
 * Puts a group onto `c`, its top-left at `at` on `tab`, off any field already at a spot it
 * takes, so repeated pastes fan out. Returns the new fields' ids.
 */
export function place(
	g: Group,
	c: Character,
	clocks: Clock[],
	tab: string,
	at: { x: number; y: number },
	room: Sheet['others'] = []
): string[] {
	const boxAt = (f: Field, d: { x: number; y: number }) =>
		clamp({ ...f.box, x: f.box.x + d.x, y: f.box.y + d.y });
	const taken = (f: Field, d: { x: number; y: number }) => {
		const b = boxAt(f, d);
		return c.fields.some((o) => o.tab === tab && o.box.x === b.x && o.box.y === b.y);
	};
	let d = at;
	while (g.fields.some((f) => taken(f, d))) d = { x: d.x + 2 * SNAP, y: d.y + 2 * SNAP };

	const ids = new Map(g.fields.map((f) => [f.id, newId()]));
	const made = make(g, c.fields, clocks, ids, (f) => ({ tab, box: boxAt(f, d) }), room, c.id);
	// A copied binding is a new one, apart from the fields it was copied from.
	const binds = new Map<string, string>();
	for (const f of made) {
		if (!f.bind) continue;
		if (!binds.has(f.bind)) binds.set(f.bind, newId());
		f.bind = binds.get(f.bind);
	}
	loosen(made);
	for (const f of g.fields) {
		const v = g.values?.[f.id];
		if (v !== undefined) c.values[ids.get(f.id)!] = clone(v);
	}
	c.fields.push(...made);
	return made.map((f) => f.id);
}
