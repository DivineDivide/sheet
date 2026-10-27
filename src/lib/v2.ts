// Reading version-2 documents, which kept statuses apart from the fields and rules on
// clocks. Kept only to migrate files, and rooms as `Room.load` reads them, forward.

import {
	VERSION,
	newId,
	statusTable,
	uniqueLabel,
	type Character,
	type Clock,
	type Doc,
	type Row,
	type Rule
} from './doc';
import { GAP, clamp } from './layout';
import type { Op } from './sync';

/** A stamp: `since` is the clock's reading when it went on, and what is left derives from it. */
export type Status = {
	id: string;
	name: string;
	clock: string;
	since: number;
	lasts?: number;
	stacks?: number;
	rules?: Rule[];
	preset?: string;
};

export type V2Doc = Omit<Doc, 'version' | 'clocks' | 'characters'> & {
	version: 2;
	clocks: (Clock & { rules?: Rule[] })[];
	characters: (Character & { statuses: Status[] })[];
	presets?: unknown[];
};

/** Its turns left; one the clock was stepped back past has all of them. */
const left = (s: Status, k: Clock) =>
	s.lasts === undefined ? Infinity : s.lasts - Math.max(0, k.now - s.since);

/**
 * Statuses still on become rows of a Statuses table under the first tab's fields. Presets
 * and the rules on statuses and clocks are dropped: they were never deployed.
 */
export function upgrade(old: V2Doc): Doc {
	// A step back must not reach for statuses that are gone.
	const kept = (ops: Op[]) => ops.filter((op) => op.p[2] !== 'statuses');
	return {
		version: VERSION,
		clocks: old.clocks.map(({ id, name, now }) => ({ id, name, now })),
		templates: old.templates,
		characters: old.characters.map(({ statuses, ...c }) => tabled(c, statuses, old.clocks)),
		...(old.log && {
			log: old.log.map((l) =>
				l.tick ? { ...l, tick: { ...l.tick, ops: kept(l.tick.ops), undo: kept(l.tick.undo) } } : l
			)
		})
	};
}

function tabled(c: Character, statuses: Status[], clocks: Clock[]): Character {
	const clockOf = (s: Status) => clocks.find((k) => k.id === s.clock)!;
	const on = statuses.filter((s) => left(s, clockOf(s)) > 0 && (s.stacks ?? 1) > 0);
	if (!on.length) return c;
	const tab = c.tabs[0].id;
	const here = c.fields.filter((f) => f.tab === tab).map((f) => f.box);
	const x = here.length ? Math.min(...here.map((b) => b.x)) : 0;
	const y = here.length ? Math.max(...here.map((b) => b.y + b.h)) + GAP : 0;
	const clock = (on.find((s) => s.lasts !== undefined) ?? on[0]).clock;
	const table = statusTable(tab, clamp({ x, y, w: 480, h: 160 }), clock);
	table.label = uniqueLabel(table.label, c.fields);
	const [name, stacks, rest] = table.columns!;
	const rows: Row[] = on.map((s) => {
		const n = left(s, clockOf(s));
		const cells: Row['cells'] = { [name.id]: s.name };
		if (s.stacks !== undefined) cells[stacks.id] = s.stacks;
		if (n !== Infinity) cells[rest.id] = n;
		return { id: newId(), cells };
	});
	return { ...c, fields: [...c.fields, table], values: { ...c.values, [table.id]: rows } };
}
