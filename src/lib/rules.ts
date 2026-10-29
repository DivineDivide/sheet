// Rules: when a button is pressed or a clock ticks, change fields and table cells. The
// room runs them (`worker/room.ts`), so a press counts once and nobody can roll the dice
// again. A rule is a formula and lines like `HP -= 1d6`, and it cannot set off another
// event, so every event ends.

import {
	cellOf,
	newId,
	tagsIn,
	valueOf,
	type Character,
	type Column,
	type Doc,
	type Field,
	type LogLine,
	type Resource,
	type Row,
	type Rule,
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
	pattern,
	render,
	rolls,
	rowNames,
	show,
	str,
	unwritable,
	type InRow,
	type Line,
	type Name,
	type Roll,
	type Rolled,
	type Sheet,
	type Val
} from './formula';
import { mapSource, nameIn } from './map';
import { follow } from './source';
import { apply, equal, get, revert, type Op, type Path } from './sync';

/**
 * What a client asks the room to do. A button in a table names its column and row, a map
 * the row of the node pressed. A tick or a step back names the reading it saw.
 */
export type Act =
	| { press: { character: string; field: string; column?: string; row?: string } }
	| { tick: { clock: string; at: number } }
	| { back: { clock: string; at: number } };

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks an act a client sent. */
export function isAct(v: unknown): v is { id: string; act: Act } {
	if (!isObj(v) || typeof v.id !== 'string' || !isObj(v.act)) return false;
	const { press, tick, back } = v.act;
	if (Object.keys(v.act).length !== 1) return false;
	if (isObj(press)) {
		const opt = (v: unknown) => v === undefined || typeof v === 'string';
		return (
			typeof press.character === 'string' &&
			typeof press.field === 'string' &&
			opt(press.column) &&
			opt(press.row) &&
			(press.column === undefined || press.row !== undefined)
		);
	}
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

/** What a character's rules and formulas read. */
export const sheetOf = (doc: Doc, c: Character): Sheet => ({
	...c,
	clocks: doc.clocks,
	others: doc.characters
});

const listensTo = (r: Rule, w: When) =>
	'press' in w
		? 'press' in r.when && r.when.press === w.press
		: 'tick' in r.when && r.when.tick === w.tick;

type Listener = { rule: Rule; owner: string; row?: InRow };

/** The kinds a rule can change, and so the only fields and columns whose rules run. */
export const ruled: Field['kind'][] = ['number', 'resource', 'track', 'text', 'choice', 'tags'];
export const ruledColumns: Column['kind'][] = [
	'number',
	'resource',
	'track',
	'text',
	'choice',
	'tags'
];

/** A row as the log names it: by its first text, or its place. */
function rowName(table: Field, row: Row, rows: Row[]) {
	for (const col of table.columns ?? []) {
		const v = (col.kind === 'text' || col.kind === 'choice') && cellOf(row, col);
		if (v !== undefined && v !== false && String(v).trim()) return String(v).trim();
	}
	return `row ${rows.indexOf(row) + 1}`;
}

/**
 * The rules on a character that `when` sets off: its fields', and its columns', once for
 * each row. A button in a row sets off only that row's.
 */
function listeners(c: Character, when: When, only?: InRow): Listener[] {
	const cols = c.fields
		.filter((f) => f.kind === 'table')
		.flatMap((table) =>
			(table.columns ?? [])
				.filter((col) => ruledColumns.includes(col.kind))
				.flatMap((col) => (col.rules ?? []).map((rule) => ({ table, col, rule })))
		)
		.filter(({ rule }) => listensTo(rule, when))
		.flatMap(({ table, col, rule }) => {
			const rows = valueOf(c, table) as Row[];
			const owner = (row: Row) => `${table.label} ${rowName(table, row, rows)}: ${col.name}`;
			const inRow = only && 'press' in when && only.table.columns?.some((x) => x.id === when.press);
			if (inRow)
				return only.table.id === table.id ? [{ rule, owner: owner(only.row), row: only }] : [];
			return rows.map((row) => ({ rule, owner: owner(row), row: { table, row } }));
		});
	return [
		...c.fields
			.filter((f) => ruled.includes(f.kind))
			.flatMap((f) => (f.rules ?? []).map((rule) => ({ rule, owner: f.label }))),
		...cols
	].filter(({ rule }) => listensTo(rule, when));
}

const why = (v: Val) => (isErr(v) ? `${v.err}${v.why ? ` (${v.why})` : ''}` : String(v));

function test(rule: Rule, sheet: Sheet, roll?: Roll, rolled?: Rolled[], row?: InRow): boolean {
	if (!rule.if?.trim()) return true;
	const b = bool(evaluate(parse(rule.if), sheet, roll, rolled, row));
	if (isErr(b)) throw new Stop(`its condition is ${why(b)}`);
	return b;
}

/** Whether pressing a button, or a button column in `row`, would do anything now, or why not. */
export function ready(doc: Doc, c: Character, button: string, row?: InRow): true | string {
	const all = listeners(c, { press: button }, row);
	if (!all.length)
		return 'No rule listens to it yet: give a field or column a rule for when it is pressed.';
	const sheet = sheetOf(doc, c);
	const passes = ({ rule, row }: Listener) => {
		try {
			// Dice cannot be known before the room rolls them.
			return (
				!rule.if?.trim() || rolls(parse(rule.if)) || test(rule, sheet, undefined, undefined, row)
			);
		} catch {
			return false;
		}
	};
	return all.some(passes) || "None of its rules' conditions hold now.";
}

/** A button's hover hint: a line for each rule its press sets off, then `why` it can't be. */
export function hint(
	doc: Doc,
	c: Character,
	button: string,
	why: true | string,
	row?: InRow
): string {
	const known = names(sheetOf(doc, c));
	const seen = new Set<string>();
	const lines = listeners(c, { press: button }, row).flatMap(({ rule, row }) => {
		if (seen.has(rule.id)) return [];
		seen.add(rule.id);
		const own = row ? [...rowNames(row.table), ...known] : known;
		const then = rule.then.map((l) => render(l, own)).join('; ');
		return [rule.if?.trim() ? `${then} (if ${render(rule.if, own)})` : then];
	});
	return [...lines, ...(why === true ? [] : [why])].join('\n');
}

const calc = (op: string, base: number, x: number) =>
	op === '=' ? x : op === '+=' ? base + x : base - x;

function number(v: Val): number {
	const n = num(v);
	if (isErr(n)) throw new Stop(why(n));
	return n;
}

/** What a value of this kind becomes, as a line sets it. */
function changed(kind: Name['kind'], now: unknown, op: Line['op'], v: Val, prop?: string) {
	switch (kind) {
		case 'number':
			return calc(op, (now as number | undefined) ?? 0, number(v));
		case 'resource': {
			const r = now as Resource;
			const key = prop === 'max' ? 'max' : 'cur';
			return { ...r, [key]: calc(op, r[key], number(v)) };
		}
		case 'track': {
			const boxes = now as boolean[];
			if (prop === 'boxes') {
				const s = text(v);
				if (!/^[x.]*$/i.test(s)) throw new Stop(`boxes are x (ticked) and . (empty), not "${s}"`);
				if (s.length > 100) throw new Stop('a track holds at most 100 boxes');
				return [...s].map((ch) => ch !== '.');
			}
			if (prop === 'max') {
				const n = Math.min(100, Math.max(0, Math.round(calc(op, boxes.length, number(v)))));
				return Array.from({ length: n }, (_, i) => boxes[i] ?? false);
			}
			const n = Math.round(calc(op, boxes.filter(Boolean).length, number(v)));
			return boxes.map((_, i) => i < n);
		}
		case 'tags': {
			const tags = (now as string[] | undefined) ?? [];
			const given = tagsIn(text(v));
			const next =
				op === '='
					? given
					: op === '+='
						? [...tags, ...given.filter((g) => !tags.some((x) => same(x, g)))]
						: tags.filter((x) => !given.some((g) => same(x, g)));
			// An empty cell stays empty rather than storing no tags.
			return next.length || now !== undefined ? next : now;
		}
		default:
			return text(v);
	}
}

function text(v: Val): string {
	const s = str(v);
	if (isErr(s)) throw new Stop(why(s));
	return s;
}

/**
 * Runs one line on a character. In a row, the table's columns name that row's cells,
 * before any field.
 */
function line(
	text: string,
	doc: Doc,
	c: Character,
	w: Writes,
	roll: Roll,
	rolled: Rolled[],
	row?: InRow
) {
	const { target, op, expr } = parseLine(text);
	const sheet = sheetOf(doc, c);
	const v = evaluate(expr, sheet, roll, rolled, row);
	if (isErr(v)) throw new Stop(why(v));

	const byRef = (id: string) => target.t === 'ref' && target.id === id;
	const named = (s: string) => target.t === 'name' && same(s, target.s);
	const at = target.t === 'name' && target.s.startsWith('@');
	const col = row?.table.columns?.find(
		(x) => byRef(x.id) || (target.t === 'name' && same(x.name, target.s.replace(/^@/, '')))
	);
	if (at && !col) throw new Stop(`this row has no column "${target.s.slice(1)}"`);
	const field = col ? undefined : c.fields.find((f) => byRef(f.id) || named(f.label));
	const clock = col || field ? undefined : doc.clocks.find((k) => byRef(k.id) || named(k.name));
	const kind: Name['kind'] = col?.kind ?? field?.kind ?? (clock ? 'clock' : undefined);
	if (!kind) {
		throw new Stop(
			target.t === 'ref' ? 'it changes a field that was deleted' : `nothing is called "${target.s}"`
		);
	}
	const refused =
		target.col !== undefined ? "can't be changed by a rule" : unwritable(kind, target.prop, op);
	if (refused) throw new Stop(`${col?.name ?? field?.label ?? clock!.name} ${refused}`);

	const prop = target.prop?.toLowerCase();
	const [p, now] = col
		? [
				['characters', c.id, 'values', row!.table.id, row!.row.id, 'cells', col.id],
				cellOf(row!.row, col)
			]
		: [['characters', c.id, 'values', field!.id], valueOf(c, field!)];
	const next = changed(kind, now, op, v, prop);
	// A blank value reads as its kind's blank, so writing that would only store it.
	if (!equal(now, next)) w.set(p, next);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Report = { fired: number; notes: string[]; rolled: Rolled[] };

/**
 * Runs the rules an event set off, on one character or, without one, on the clocks. All
 * their conditions are tested first, so one rule's lines never stop another from running.
 * A rule that fails part-way is taken back whole.
 */
function run(doc: Doc, rules: Listener[], c: Character, w: Writes, roll: Roll) {
	const out: Report = { fired: 0, notes: [], rolled: [] };
	const sheet = sheetOf(doc, c);
	const passing = rules.filter(({ rule, owner, row }) => {
		try {
			return test(rule, sheet, roll, out.rolled, row);
		} catch (e) {
			if (!(e instanceof Stop || e instanceof FormulaError)) throw e;
			out.notes.push(`${owner}'s rule: ${e.message}`);
			return false;
		}
	});
	for (const { rule, owner, row } of passing) {
		const mine = new Writes(doc);
		try {
			for (const text of rule.then) {
				if (text.trim()) line(text, doc, c, mine, roll, out.rolled, row);
			}
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
function shown(kind: Name['kind'], v: unknown): string {
	if (v === undefined) return '—';
	if (kind === 'resource') return `${(v as Resource).cur}/${(v as Resource).max}`;
	if (kind === 'track' && Array.isArray(v)) return `${v.filter(Boolean).length}/${v.length}`;
	if (kind === 'tags' && Array.isArray(v)) return v.length ? v.join(', ') : '—';
	if (typeof v === 'number') return show(v);
	if (typeof v === 'string') return `"${v.length > 24 ? `${v.slice(0, 23)}…` : v}"`;
	return String(v);
}

/** A change as the log shows it; a track whose count stays shows its boxes instead. */
function change(kind: Name['kind'], was: unknown, now: unknown): string {
	const [a, b] = [shown(kind, was), shown(kind, now)];
	return kind === 'track' && a === b && Array.isArray(was) && Array.isArray(now)
		? `${pattern(was)} → ${pattern(now)}`
		: `${a} → ${b}`;
}

/** What changed, one part per character. The clock that moved is the title's. */
function describe(doc: Doc, w: Writes, reports: Map<string, Report>): string[] {
	const parts = new Map<string, string[]>();
	const add = (who: string, s: string) => parts.set(who, [...(parts.get(who) ?? []), s]);
	for (const { p, was, now } of w.changed()) {
		if (p[0] === 'clocks') continue;
		const c = doc.characters.find((x) => x.id === p[1])!;
		const f = c.fields.find((x) => x.id === p[3]);
		// A map's move is the title's, and a table following the map moves with it.
		if (f?.kind === 'map' || f?.follows) continue;
		if (f && p[5] === 'cells') {
			const rows = valueOf(c, f) as Row[];
			const row = rows.find((r) => r.id === p[4])!;
			const col = f.columns?.find((x) => x.id === p[6]);
			const label = `${f.label} ${rowName(f, row, rows)}: ${col?.name}`;
			add(c.id, `${label} ${change(col?.kind, was, now)}`);
			continue;
		}
		add(c.id, `${f?.label} ${change(f?.kind, was, now)}`);
	}
	for (const [who, r] of reports) for (const n of r.notes) add(who, n);
	return [...parts].map(([who, changes]) => {
		const c = doc.characters.find((x) => x.id === who)!;
		const dice = reports.get(who)?.rolled.map((r) => `${r.dice}: ${r.got.join('+')}`) ?? [];
		const after = dice.length ? ` (${dice.join('; ')})` : '';
		return `${c.name}: ${changes.join(', ')}${after}`;
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
	let title = '';
	let tick: { clock: string; to: number } | undefined;

	if ('press' in act) {
		const { character, field, column, row } = act.press;
		const c = doc.characters.find((x) => x.id === character);
		const f = c?.fields.find((x) => x.id === field);
		let b: { id: string; label: string } | undefined;
		let r: Report | undefined;
		let moved = false;
		if (c && f?.kind === 'map') {
			// The move comes first, so its rules read the node pressed.
			const src = mapSource(doc, f);
			const to = src?.rows.find((x) => x.id === row);
			if (!src || !to) return none('that place is gone');
			if (valueOf(c, f) === to.id) return none();
			const from = src.rows.find((x) => x.id === valueOf(c, f));
			w.set(['characters', c.id, 'values', f.id], to.id);
			b = f;
			r = run(doc, listeners(c, { press: f.id }), c, w, roll);
			title = `${f.label} ${from ? nameIn(src, from) : '—'} → ${nameIn(src, to)}`;
			moved = true;
		} else if (c && f?.kind === 'button') {
			b = f;
			r = run(doc, listeners(c, { press: f.id }), c, w, roll);
			title = f.label;
		} else if (c && f?.kind === 'table') {
			const rows = valueOf(c, f) as Row[];
			const col = f.columns?.find((x) => x.id === column && x.kind === 'button');
			const at = rows.find((x) => x.id === row);
			if (col && at) {
				b = { id: col.id, label: col.name };
				r = run(doc, listeners(c, { press: col.id }, { table: f, row: at }), c, w, roll);
				title = `${col.name} · ${f.label} ${rowName(f, at, rows)}`;
			}
		}
		if (!c || !b || !r) return none('that button is gone');
		if (!moved && !r.fired && !r.notes.length) {
			return none(`${b.label}: none of its rules' conditions hold now`);
		}
		reports.set(c.id, r);
	} else {
		const { clock, at: from } = 'tick' in act ? act.tick : act.back;
		const k = doc.clocks.find((x) => x.id === clock);
		if (!k || k.now !== from) return none();
		if ('tick' in act) {
			w.set(['clocks', k.id, 'now'], from + 1);
			for (const c of doc.characters) {
				reports.set(c.id, run(doc, listeners(c, { tick: k.id }), c, w, roll));
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

	// Rows drawn from a table these rules changed follow in the same event, so Back and ⌘Z
	// take both back.
	follow(doc, (op) => w.op(op));
	const changed = w.changed();
	// A row a table lost is deleted: a set of nothing cannot take it out of its list.
	const ops: Op[] = changed.map(({ p, now }) =>
		now === undefined ? { k: 'del', p } : { k: 'set', p, v: now }
	);
	const undo: Op[] = changed.map(({ p, was }) =>
		was === undefined ? { k: 'del', p } : { k: 'set', p, v: structuredClone(was) }
	);
	const text = [title, ...describe(doc, w, reports)].join(' · ');
	const entry: LogLine = { id: newId(), at, text, ...(tick && { tick: { ...tick, ops, undo } }) };
	return { ops: [...ops, ...logged(doc, entry)], undo };
}

/** A rule as typed, with labels swapped for ids; a line that cannot be read stays as typed. */
export function compileRule(rule: Rule, known: Name[]): Rule {
	const keep = (f: () => string, text: string) => {
		try {
			return f();
		} catch (e) {
			if (!(e instanceof FormulaError)) throw e;
			return text;
		}
	};
	const cond = rule.if?.trim() ? { if: keep(() => compile(rule.if!, known), rule.if!) } : {};
	return { ...rule, ...cond, then: rule.then.map((l) => keep(() => compileLine(l, known), l)) };
}
