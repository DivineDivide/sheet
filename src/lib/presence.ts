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
};

/** A person as the room passes them on: `who` names the connection, `color` its slot. */
export type Peer = Presence & { who: string; color: number };

export const COLORS = 8;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

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
	return out;
}

/** The lowest colour slot nobody holds, so two people present never share one. */
export function firstFree(taken: number[]): number {
	let n = 0;
	while (taken.includes(n)) n++;
	return n;
}

export const nameOf = (p: Peer) => p.name || (p.gm ? 'GM' : `Guest ${p.color + 1}`);
