/** What a person in a room says they are doing. Self-declared, so it never grants anything. */
export type Presence = {
	name?: string;
	gm?: boolean;
	character?: string;
	tab?: string;
	/** The fields selected in Edit layout. */
	picked?: string[];
	/** The field whose box has focus. */
	editing?: string;
	/** Text typed and not yet saved; `at` names its box (`Prose`'s `at`). */
	draft?: Draft;
};

export type Draft = { at: string; text: string; cut?: true };

/** A person as the room passes them on: `who` names the connection, `color` its slot. */
export type Peer = Presence & { who: string; color: number };

export const COLORS = 8;
// UTF-16 units, as an attachment stores such a string: 8 KB, leaving room in its 16 KB.
const DRAFT = 4096;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isId = (v: unknown): v is string =>
	typeof v === 'string' && v.length > 0 && v.length <= 64;

/** The presence a message carries, cut to size, or null when it carries none. */
export function presenceIn(m: unknown): Presence | null {
	if (!isObj(m) || !isObj(m.presence)) return null;
	const p = m.presence;
	const out: Presence = {};
	if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim().slice(0, 40);
	if (p.gm === true) out.gm = true;
	if (isId(p.character)) out.character = p.character;
	if (isId(p.tab)) out.tab = p.tab;
	if (Array.isArray(p.picked)) out.picked = p.picked.filter(isId).slice(0, 50);
	if (isId(p.editing)) out.editing = p.editing;
	const d = p.draft;
	if (isObj(d) && typeof d.at === 'string' && d.at.length <= 200 && typeof d.text === 'string') {
		const c = cut(d.text);
		out.draft = { at: d.at, text: c.text, ...((c.cut || d.cut === true) && { cut: true }) };
	}
	return out;
}

/** A draft's text, cut to what presence carries. */
export function cut(text: string): { text: string; cut?: true } {
	if (text.length <= DRAFT) return { text };
	// Never half of a surrogate pair.
	return { text: text.slice(0, DRAFT).replace(/[\uD800-\uDBFF]$/, ''), cut: true };
}

/** The lowest colour slot nobody holds, so two people present never share one. */
export function firstFree(taken: number[]): number {
	let n = 0;
	while (taken.includes(n)) n++;
	return n;
}

/** A browser's slot: the one its other tabs hold, else the lowest free. */
export function slotFor(seats: { color: number; browser?: string }[], browser?: string): number {
	const same = browser ? seats.find((s) => s.browser === browser) : undefined;
	return same?.color ?? firstFree(seats.map((s) => s.color));
}

/** One per person, as a slot is: its newest connection, where its first came. */
export const people = (list: Peer[]): Peer[] => [
	...new Map(list.map((p) => [p.color, p])).values()
];

export const nameOf = (p: Peer) => p.name || (p.gm ? 'GM' : `Guest ${p.color + 1}`);
