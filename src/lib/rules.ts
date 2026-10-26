// Rules: when a button is pressed or a clock ticks, change fields, statuses or clocks. The
// room runs them (`worker/room.ts`), so a press counts once and nobody can roll the dice
// again. A rule is a formula and lines like `HP -= 1d6`, and it cannot set off another
// event, so every event ends.

import {
	newId,
	phase,
	valueOf,
	type Character,
	type Doc,
	type Field,
	type LogLine,
	type Preset,
	type Resource,
	type Rule,
	type Status,
	type When
} from './doc';
import {
	FormulaError,
	bool,
	compile,
	compileLine,
	evaluate,
	isErr,
	names,
	num,
	parse,
	parseLine,
	refText,
	render,
	rolls,
	show,
	statusNamed,
	str,
	unwritable,
	type Name,
	type Roll,
	type Rolled,
	type Sheet,
	type Val
} from './formula';
import { apply, equal, get, revert, type Op, type Path } from './sync';

/** What a client asks the room to do. A tick or a step back names the reading it saw. */
export type Act =
	| { press: { character: string; field: string } }
	| { tick: { clock: string; at: number } }
	| { back: { clock: string; at: number } };

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks an act a client sent. */
export function isAct(v: unknown): v is { id: string; act: Act } {
	if (!isObj(v) || typeof v.id !== 'string' || !isObj(v.act)) return false;
	const { press, tick, back } = v.act;
	if (Object.keys(v.act).length !== 1) return false;
	if (isObj(press)) return typeof press.character === 'string' && typeof press.field === 'string';
	const t = tick ?? back;
	return isObj(t) && typeof t.clock === 'string' && Number.isFinite(t.at);
}

/** What an act did: ops for everyone, and the ops that take its effects back. */
export type Done = { ops: Op[]; undo: Op[]; why?: string };

/** Log lines a room keeps. */
export const LOG = 50;

class Stop extends Error {}

/** Each path written once, with what it held before, so taking an act back is exact. */
class Writes {
	readonly first = new Map<string, { p: Path; was: unknown }>();

	constructor(private doc: Doc) {}

	op(op: Exclude<Op, { k: 'order' }>) {
		const key = JSON.stringify(op.p);
		if (!this.first.has(key)) {
			this.first.set(key, { p: op.p, was: structuredClone(get(this.doc, op.p)) });
		}
		apply(this.doc, op);
	}

	set(p: Path, v: unknown) {
		this.op({ k: 'set', p, v });
	}

	/** Puts back what each path held before. */
	undo() {
		for (const { p, was } of this.first.values()) {
			apply(this.doc, was === undefined ? { k: 'del', p } : { k: 'set', p, v: was });
		}
	}

	/** Takes in writes made after this one's. */
	add(w: Writes) {
		for (const [key, e] of w.first) if (!this.first.has(key)) this.first.set(key, e);
	}

	changed() {
		return [...this.first.values()]
			.map(({ p, was }) => ({ p, was, now: structuredClone(get(this.doc, p)) }))
			.filter(({ was, now }) => !equal(was, now));
	}
}

/** What a character's rules and formulas read; without one, a clock's rules read the clocks. */
export const sheetOf = (doc: Doc, c?: Character): Sheet =>
	c
		? { ...c, clocks: doc.clocks, presets: doc.presets }
		: { fields: [], values: {}, clocks: doc.clocks };

const listensTo = (r: Rule, w: When) =>
	'press' in w
		? 'press' in r.when && r.when.press === w.press
		: 'tick' in r.when && r.when.tick === w.tick;

const isOn = (doc: Doc, s: Status) => {
	const k = doc.clocks.find((x) => x.id === s.clock);
	return !k || phase(s, k) === 'active';
};

type Listener = { rule: Rule; owner: string };

/** The kinds a rule can change, and so the only fields whose rules run. */
export const ruled: Field['kind'][] = ['number', 'resource', 'track', 'text'];

/** The rules on a character that `when` sets off: its fields', and its active statuses'. */
function listeners(doc: Doc, c: Character, when: When): Listener[] {
	return [
		...c.fields
			.filter((f) => ruled.includes(f.kind))
			.flatMap((f) => (f.rules ?? []).map((rule) => ({ rule, owner: f.label }))),
		...c.statuses
			.filter((s) => isOn(doc, s))
			.flatMap((s) => (s.rules ?? []).map((rule) => ({ rule, owner: s.name })))
	].filter(({ rule }) => listensTo(rule, when));
}

const why = (v: Val) => (isErr(v) ? `${v.err}${v.why ? ` (${v.why})` : ''}` : String(v));

function test(rule: Rule, sheet: Sheet, roll?: Roll, rolled?: Rolled[]): boolean {
	if (!rule.if?.trim()) return true;
	const b = bool(evaluate(parse(rule.if), sheet, roll, rolled));
	if (isErr(b)) throw new Stop(`its condition is ${why(b)}`);
	return b;
}

/** Whether pressing a button would do anything now, or why not. */
export function ready(doc: Doc, c: Character, button: string): true | string {
	const all = listeners(doc, c, { press: button });
	if (!all.length) return 'No rule listens to it yet: give a field a rule for when it is pressed.';
	const sheet = sheetOf(doc, c);
	const passes = ({ rule }: Listener) => {
		try {
			// Dice cannot be known before the room rolls them.
			return !rule.if?.trim() || rolls(parse(rule.if)) || test(rule, sheet);
		} catch {
			return false;
		}
	};
	return all.some(passes) || "None of its rules' conditions hold now.";
}

const calc = (op: string, base: number, x: number) =>
	op === '=' ? x : op === '+=' ? base + x : base - x;

function number(v: Val): number {
	const n = num(v);
	if (isErr(n)) throw new Stop(why(n));
	return n;
}

/** Runs one line, on a character or, for a clock's rule, on the clocks. */
function line(
	text: string,
	doc: Doc,
	c: Character | undefined,
	w: Writes,
	roll: Roll,
	rolled: Rolled[]
) {
	const { target, op, expr } = parseLine(text);
	const sheet = sheetOf(doc, c);
	const v = evaluate(expr, sheet, roll, rolled);
	if (isErr(v)) throw new Stop(why(v));

	const byRef = (id: string) => target.t === 'ref' && target.id === id;
	const named = (s: string) => target.t === 'name' && same(s, target.s);
	const field = c?.fields.find((f) => byRef(f.id) || named(f.label));
	const clock = field ? undefined : doc.clocks.find((k) => byRef(k.id) || named(k.name));
	const status =
		field || clock || !c || target.t !== 'name' ? undefined : statusNamed(sheet, target.s);
	const kind: Name['kind'] = field?.kind ?? (clock ? 'clock' : status ? 'status' : undefined);
	if (!kind) {
		// A status this character does not have has nothing to change.
		if (target.t === 'name' && doc.presets?.some((p) => named(p.name))) return;
		throw new Stop(
			target.t === 'ref' ? 'it changes a field that was deleted' : `nothing is called "${target.s}"`
		);
	}
	const refused =
		target.col !== undefined
			? "can't be changed by a rule"
			: unwritable(kind, target.prop, op, c ? 'character' : 'clocks');
	if (refused) throw new Stop(`${field?.label ?? clock?.name ?? status!.name} ${refused}`);

	if (clock) return w.set(['clocks', clock.id, 'now'], Math.round(calc(op, clock.now, number(v))));
	const ch = c!;
	if (status) {
		const n = Math.max(0, calc(op, status.stacks ?? 1, number(v)));
		return w.set(['characters', ch.id, 'statuses', status.id, 'stacks'], n);
	}
	const f = field!;
	const now = valueOf(ch, f);
	const to = (next: unknown) => w.set(['characters', ch.id, 'values', f.id], next);
	const prop = target.prop?.toLowerCase();
	switch (f.kind) {
		case 'number':
			return to(calc(op, now as number, number(v)));
		case 'resource': {
			const r = now as Resource;
			const key = prop === 'max' ? 'max' : 'cur';
			return to({ ...r, [key]: calc(op, r[key], number(v)) });
		}
		case 'track': {
			const boxes = now as boolean[];
			if (prop === 'max') {
				const n = Math.min(100, Math.max(0, Math.round(calc(op, boxes.length, number(v)))));
				return to(Array.from({ length: n }, (_, i) => boxes[i] ?? false));
			}
			const n = Math.round(calc(op, boxes.filter(Boolean).length, number(v)));
			return to(boxes.map((_, i) => i < n));
		}
		case 'text': {
			const s = str(v);
			if (isErr(s)) throw new Stop(why(s));
			return to(s);
		}
	}
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Report = { fired: number; notes: string[]; rolled: Rolled[] };

/**
 * Runs the rules an event set off, on one character or, without one, on the clocks. All
 * their conditions are tested first, so one rule's lines never stop another from running.
 * A rule that fails part-way is taken back whole.
 */
function run(doc: Doc, rules: Listener[], c: Character | undefined, w: Writes, roll: Roll) {
	const out: Report = { fired: 0, notes: [], rolled: [] };
	const sheet = sheetOf(doc, c);
	const passing = rules.filter(({ rule, owner }) => {
		try {
			return test(rule, sheet, roll, out.rolled);
		} catch (e) {
			if (!(e instanceof Stop || e instanceof FormulaError)) throw e;
			out.notes.push(`${owner}'s rule: ${e.message}`);
			return false;
		}
	});
	for (const { rule, owner } of passing) {
		const mine = new Writes(doc);
		try {
			for (const text of rule.then) if (text.trim()) line(text, doc, c, mine, roll, out.rolled);
			w.add(mine);
			out.fired++;
		} catch (e) {
			if (!(e instanceof Stop || e instanceof FormulaError)) throw e;
			mine.undo();
			out.notes.push(`${owner}'s rule stopped: ${e.message}`);
		}
	}
	return out;
}

/** A value as the log shows it. */
function shown(f: Field | undefined, v: unknown): string {
	if (f?.kind === 'resource') return `${(v as Resource).cur}/${(v as Resource).max}`;
	if (f?.kind === 'track') {
		return `${(v as boolean[]).filter(Boolean).length}/${(v as boolean[]).length}`;
	}
	if (typeof v === 'number') return show(v);
	if (typeof v === 'string') return `"${v.length > 24 ? `${v.slice(0, 23)}…` : v}"`;
	// A status without stacks reads as 1.
	return v === undefined ? '1' : String(v);
}

/** What changed, one part for the clocks and one per character, leaving out `title`'s clock. */
function describe(doc: Doc, w: Writes, reports: Map<string, Report>, titled?: string): string[] {
	const parts = new Map<string, string[]>();
	const add = (who: string, s: string) => parts.set(who, [...(parts.get(who) ?? []), s]);
	for (const { p, was, now } of w.changed()) {
		if (p[0] === 'clocks') {
			if (p[1] !== titled)
				add('', `${doc.clocks.find((k) => k.id === p[1])?.name} ${was} → ${now}`);
			continue;
		}
		const c = doc.characters.find((x) => x.id === p[1])!;
		const f = p[2] === 'values' ? c.fields.find((x) => x.id === p[3]) : undefined;
		const label = f ? f.label : c.statuses.find((s) => s.id === p[3])?.name;
		add(c.id, `${label} ${shown(f, was)} → ${shown(f, now)}`);
	}
	for (const [who, r] of reports) for (const n of r.notes) add(who, n);
	return [...parts].map(([who, changes]) => {
		const c = doc.characters.find((x) => x.id === who);
		const dice = reports.get(who)?.rolled.map((r) => `${r.dice}: ${r.got.join('+')}`) ?? [];
		const after = dice.length ? ` (${dice.join('; ')})` : '';
		return c ? `${c.name}: ${changes.join(', ')}${after}` : changes.join(', ');
	});
}

/** The ops that add `line` to the log, dropping the oldest past `LOG`. */
function logged(doc: Doc, line: LogLine): Op[] {
	const old = doc.log?.slice(0, Math.max(0, doc.log.length + 1 - LOG)) ?? [];
	const ops: Op[] = doc.log
		? [
				{ k: 'set', p: ['log', line.id], v: line },
				...old.map((l): Op => ({ k: 'del', p: ['log', l.id] }))
			]
		: [{ k: 'set', p: ['log'], v: [line] }];
	for (const op of ops) apply(doc, op);
	return ops;
}

const none = (why?: string): Done => ({ ops: [], undo: [], why });

/**
 * Does `act` to `doc` in place, as the room does: runs the rules it sets off and logs what
 * changed. A tick or step back from a reading the clock has left does nothing, so two
 * people pressing Next at once move it once.
 */
export function fire(doc: Doc, act: Act, roll: Roll, at = Date.now()): Done {
	const w = new Writes(doc);
	const reports = new Map<string, Report>();
	let title: string;
	let titled: string | undefined;
	let tick: { clock: string; to: number } | undefined;

	if ('press' in act) {
		const c = doc.characters.find((x) => x.id === act.press.character);
		const b = c?.fields.find((f) => f.id === act.press.field && f.kind === 'button');
		if (!c || !b) return none('that button is gone');
		const r = run(doc, listeners(doc, c, { press: b.id }), c, w, roll);
		if (!r.fired && !r.notes.length) {
			return none(`${b.label}: none of its rules' conditions hold now`);
		}
		reports.set(c.id, r);
		title = b.label;
	} else {
		const { clock, at: from } = 'tick' in act ? act.tick : act.back;
		const k = doc.clocks.find((x) => x.id === clock);
		if (!k || k.now !== from) return none();
		titled = k.id;
		if ('tick' in act) {
			w.set(['clocks', k.id, 'now'], from + 1);
			const own = doc.clocks.flatMap((o) =>
				(o.rules ?? []).map((rule) => ({ rule, owner: o.name }))
			);
			const mine = own.filter(({ rule }) => listensTo(rule, { tick: k.id }));
			reports.set('', run(doc, mine, undefined, w, roll));
			for (const c of doc.characters) {
				reports.set(c.id, run(doc, listeners(doc, c, { tick: k.id }), c, w, roll));
			}
			title = `${k.name} ${from} → ${from + 1}`;
			tick = { clock: k.id, to: from + 1 };
		} else {
			// Back takes the last tick to this reading back, its rules' effects with it.
			const last = [...(doc.log ?? [])]
				.reverse()
				.find((l) => l.tick?.clock === k.id && l.tick.to === from)?.tick;
			for (const op of last ? revert(doc, last.ops, last.undo) : []) {
				if (op.k !== 'order') w.op(op);
			}
			if (k.now === from) w.set(['clocks', k.id, 'now'], from - 1);
			title = `Back: ${k.name} ${from} → ${from - 1}`;
		}
	}

	const changed = w.changed();
	const ops: Op[] = changed.map(({ p, now }) => ({ k: 'set', p, v: now }));
	const undo: Op[] = changed.map(({ p, was }) =>
		was === undefined ? { k: 'del', p } : { k: 'set', p, v: structuredClone(was) }
	);
	const text = [title, ...describe(doc, w, reports, titled)].join(' · ');
	const entry: LogLine = { id: newId(), at, text, ...(tick && { tick: { ...tick, ops, undo } }) };
	return { ops: [...ops, ...logged(doc, entry)], undo };
}

/** A rule as typed, with labels swapped for ids; a line that cannot be read stays as typed. */
export function compileRule(rule: Rule, known: Name[], on: 'character' | 'clocks'): Rule {
	const keep = (f: () => string, text: string) => {
		try {
			return f();
		} catch (e) {
			if (!(e instanceof FormulaError)) throw e;
			return text;
		}
	};
	const cond = rule.if?.trim() ? { if: keep(() => compile(rule.if!, known), rule.if!) } : {};
	return { ...rule, ...cond, then: rule.then.map((l) => keep(() => compileLine(l, known, on), l)) };
}

/**
 * A copied field's rules for its pasted copy `to`, which they follow to its new id. Pasted
 * onto another character, each label is looked up again there, a button's too; `target`
 * is that character's names, or null on the same one.
 */
export function rebind(
	rules: Rule[],
	from: { id: string; names: Name[] },
	to: Field,
	target: Name[] | null
): Rule[] {
	const self = (t: string) => t.split(refText(from.id)).join(refText(to.id));
	const known = [...from.names.filter((n) => n.id !== from.id), to];
	return rules.map((r) => {
		const moved: Rule = { ...r, id: newId(), if: r.if && self(r.if), then: r.then.map(self) };
		if (!target) return moved;
		const typed = {
			...moved,
			if: moved.if && render(moved.if, known),
			then: moved.then.map((l) => render(l, known))
		};
		const pressed = 'press' in r.when ? r.when.press : undefined;
		const button = pressed && known.find((n) => n.id === pressed);
		const there = button && target.find((n) => n.kind === 'button' && same(n.label, button.label));
		return {
			...compileRule(typed, target, 'character'),
			...(there && { when: { press: there.id } })
		};
	});
}

/**
 * Puts a preset's status on a character, its rules bound to the character's fields. A
 * preset with stacks that is already on adds to those stacks instead.
 */
export function applyPreset(doc: Doc, c: Character, p: Preset, stacks = p.stacks) {
	const already = statusNamed(sheetOf(doc, c), p.name);
	if (stacks !== undefined && already && isOn(doc, already) && already.stacks !== undefined) {
		already.stacks += stacks;
		return;
	}
	const clock = doc.clocks.find((k) => k.id === p.clock) ?? doc.clocks[0];
	const known = names(sheetOf(doc, c));
	c.statuses.push({
		id: newId(),
		name: p.name,
		clock: clock.id,
		since: clock.now,
		...(p.lasts !== undefined && { lasts: p.lasts }),
		...(stacks !== undefined && { stacks }),
		preset: p.id,
		rules: p.rules.map((r) => ({ ...compileRule(r, known, 'character'), id: newId() }))
	});
}
