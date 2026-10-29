// Excel's formula language over one character's fields. A formula is stored with `@<id>`
// references and shown with labels, so renaming a field breaks nothing. Its result is
// computed wherever it shows and never stored: a room keeps only the formula. Rules add
// dice and lines that change a field, as `HP -= 1d6`.

import {
	cellOf,
	globalId,
	valueOf,
	type Character,
	type Clock,
	type Column,
	type ColumnKind,
	type Entry,
	type Field,
	type Kind,
	type Resource,
	type Row
} from './doc';

export type Code =
	'#DIV/0!' | '#N/A' | '#NAME?' | '#NULL!' | '#NUM!' | '#REF!' | '#VALUE!' | '#CYCLE!' | '#ERROR!';
export type Err = { err: Code; why?: string };
/** `null` is a blank: 0 in arithmetic, "" in text, as an empty cell is. */
export type Scalar = number | string | boolean | null | Err;
export type Val = Scalar | Scalar[];

export class FormulaError extends Error {}

/**
 * What a formula reads: a character's fields and, when given, the clocks and the room's
 * characters, whose fields it reads as `Name!Label`.
 */
export type Sheet = Pick<Character, 'fields' | 'values'> & {
	id?: string;
	clocks?: Clock[];
	others?: Pick<Character, 'id' | 'name' | 'fields' | 'values'>[];
};

/** Rolls one die, from 1 to `sides`. */
export type Roll = (sides: number) => number;
export type Rolled = { dice: string; got: number[] };

const E = (err: Code, why?: string): Err => ({ err, why });
export const isErr = (v: unknown): v is Err =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- reading the text ------------------------------------------------------------------

type Lexeme =
	| { k: 'num'; v: number }
	| { k: 'str'; v: string }
	| { k: 'err'; v: Code }
	| { k: 'bool'; v: boolean }
	| { k: 'dice'; n: number; sides: number }
	| { k: 'fn'; s: string }
	| { k: 'ref'; id: string; prop?: string; col?: string }
	| { k: 'name'; s: string; of?: string; prop?: string; col?: string }
	| { k: 'op'; s: string }
	| { k: 'bad' };
type Tok = Lexeme & { at: number; end: number };

// A label is written bare when it is one run of none of these; otherwise in [brackets].
const WORD = /^[^\s+\-*/^&=<>%(),"[\]{}.:;!@#']+/;
const NUM = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i;
const DICE = /^(\d+)d(\d+)(?![\w.])/i;
// Dots allowed, for Excel's `_xlfn.CONCAT(` and `FLOOR.MATH(`.
const FN = /^[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/;
const ERR = /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|CYCLE!|ERROR!)/i;
const OPS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', '(', ')', ','];
// Ids are UUIDs, whose dashes must not swallow the minus in `@id-1`; any other id that
// is not one word goes in braces.
const REF =
	/^@(?:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|(\w+)|\{([^}]*)\})/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const refText = (id: string) =>
	REF.exec(`@${id}`)?.[0] === `@${id}` ? `@${id}` : `@{${id}}`;
const NUMERIC = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** `loose` never throws: what cannot be read becomes `bad`, for colouring a half-typed formula. */
function lex(src: string, loose = false): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	const push = (t: Lexeme, len: number) => {
		out.push({ ...t, at: i, end: i + len });
		i += len;
	};
	const bad = (why: string) => {
		if (!loose) throw new FormulaError(why);
		push({ k: 'bad' }, 1);
	};
	while (i < src.length) {
		const rest = src.slice(i);
		let m: RegExpExecArray | null;
		if (/^\s/.test(rest)) {
			i++;
		} else if (rest[0] === '"') {
			let j = 1;
			let v = '';
			for (;;) {
				if (j >= rest.length) {
					if (!loose) throw new FormulaError('a text in quotes is never closed');
					j = rest.length - 1;
					break;
				}
				if (rest[j] === '"' && rest[j + 1] === '"') ((v += '"'), (j += 2));
				else if (rest[j] === '"') break;
				else v += rest[j++];
			}
			push({ k: 'str', v }, j + 1);
		} else if ((m = DICE.exec(rest))) {
			push({ k: 'dice', n: Number(m[1]), sides: Number(m[2]) }, m[0].length);
		} else if ((m = NUM.exec(rest))) {
			push({ k: 'num', v: Number(m[0]) }, m[0].length);
		} else if ((m = ERR.exec(rest))) {
			push({ k: 'err', v: `#${m[1].toUpperCase()}` as Code }, m[0].length);
		} else if ((m = FN.exec(rest))) {
			push({ k: 'fn', s: m[0] }, m[0].length);
		} else if (rest[0] === '@' || rest[0] === '[' || WORD.test(rest)) {
			let base: { k: 'ref'; id: string } | { k: 'name'; s: string; of?: string };
			let len: number;
			if (rest[0] === '@') {
				m = REF.exec(rest);
				if (!m) {
					bad('expected a field after @');
					continue;
				}
				base = { k: 'ref', id: m[1] ?? m[2] ?? m[3] };
				len = m[0].length;
			} else if (rest[0] === '[') {
				let close = rest.indexOf(']');
				if (close < 0 && !loose) throw new FormulaError('a [ is never closed');
				if (close < 0) close = rest.length;
				base = { k: 'name', s: rest.slice(1, close).trim() };
				len = close + 1;
			} else {
				const s = WORD.exec(rest)![0];
				if (/^(true|false)$/i.test(s)) {
					push({ k: 'bool', v: s.toUpperCase() === 'TRUE' }, s.length);
					continue;
				}
				base = { k: 'name', s };
				len = s.length;
			}
			// `GM!Weapons`, as Excel names another sheet: a label on another character.
			const other = base.k === 'name' && rest[len] === '!' ? rest.slice(len + 1) : null;
			const part = other && (other[0] === '[' ? /^\[([^\]]*)\]/.exec(other) : WORD.exec(other));
			if (base.k === 'name' && part) {
				base = { k: 'name', s: (part[1] ?? part[0]).trim(), of: base.s };
				len += 1 + part[0].length;
			}
			const prop = /^\.([A-Za-z]+)/.exec(rest.slice(len));
			if (prop) len += prop[0].length;
			const col = /^\[([^\]]*)\]/.exec(rest.slice(len));
			if (col) len += col[0].length;
			push({ ...base, prop: prop?.[1], col: col?.[1].trim() }, len);
		} else {
			const op = OPS.find((o) => rest.startsWith(o));
			if (op) push({ k: 'op', s: op }, op.length);
			else bad(`"${rest[0]}" has no meaning in a formula`);
		}
	}
	return out;
}

export type Node =
	| { t: 'lit'; v: Scalar }
	| { t: 'ref'; id: string; prop?: string; col?: string }
	| { t: 'name'; s: string; of?: string; prop?: string; col?: string }
	| { t: 'dice'; n: number; sides: number }
	| { t: 'un'; op: '-' | '+' | '%'; a: Node }
	| { t: 'bin'; op: string; a: Node; b: Node }
	| { t: 'call'; fn: string; args: Node[] };

// Excel's order, loosest first. Negation is tighter than ^, so -2^2 is 4, and ^ groups
// to the left, so 2^3^2 is 64.
const PREC: Record<string, number> = {
	'=': 1,
	'<>': 1,
	'<': 1,
	'<=': 1,
	'>': 1,
	'>=': 1,
	'&': 2,
	'+': 3,
	'-': 3,
	'*': 4,
	'/': 4,
	'^': 5,
	'%': 6
};

const strip = (text: string) => text.trim().replace(/^=\s*/, '');

/** Reads a stored formula. Throws `FormulaError` saying what is wrong. */
export function parse(text: string): Node {
	const src = strip(text);
	const toks = lex(src);
	let p = 0;
	const isOp = (s: string) => toks[p]?.k === 'op' && (toks[p] as { s: string }).s === s;
	const near = () => (toks[p] ? `"${src.slice(toks[p].at, toks[p].end)}"` : 'the end');
	const expect = (s: string) => {
		if (!isOp(s)) throw new FormulaError(`expected "${s}" before ${near()}`);
		p++;
	};

	function primary(): Node {
		const t = toks[p];
		if (!t) throw new FormulaError('the formula ends too early');
		p++;
		switch (t.k) {
			case 'num':
			case 'str':
			case 'bool':
				return { t: 'lit', v: t.v };
			case 'err':
				return { t: 'lit', v: E(t.v) };
			case 'ref':
				return { t: 'ref', id: t.id, prop: t.prop, col: t.col };
			case 'name':
				return { t: 'name', s: t.s, of: t.of, prop: t.prop, col: t.col };
			case 'dice':
				return { t: 'dice', n: t.n, sides: t.sides };
			case 'fn':
				return call(t.s);
			case 'op':
				if (t.s === '(') {
					const n = expr(0);
					expect(')');
					return n;
				}
				if (t.s === '-' || t.s === '+') return { t: 'un', op: t.s, a: primary() };
		}
		p--;
		throw new FormulaError(`unexpected ${near()}`);
	}

	function call(fn: string): Node {
		expect('(');
		const args: Node[] = [];
		if (isOp(')')) p++;
		else
			for (;;) {
				// An argument left out, as in IF(x,,1), is a blank.
				args.push(isOp(',') || isOp(')') ? { t: 'lit', v: null } : expr(0));
				if (!isOp(',')) break;
				p++;
			}
		if (args.length) expect(')');
		const def = FNS[key(fn)];
		if (def && (args.length < def.min || args.length > def.max || (def.pairs && args.length % 2))) {
			const n =
				def.min === def.max
					? def.min
					: def.max === Infinity
						? `${def.min}+`
						: `${def.min}–${def.max}`;
			throw new FormulaError(`${key(fn)} takes ${n} arguments, not ${args.length}`);
		}
		return { t: 'call', fn, args };
	}

	function expr(min: number): Node {
		let left = primary();
		for (;;) {
			const t = toks[p];
			if (t?.k !== 'op' || !(t.s in PREC) || PREC[t.s] < min) return left;
			p++;
			left =
				t.s === '%'
					? { t: 'un', op: '%', a: left }
					: { t: 'bin', op: t.s, a: left, b: expr(PREC[t.s] + 1) };
		}
	}

	const n = expr(0);
	if (p < toks.length) throw new FormulaError(`unexpected ${near()}`);
	return n;
}

// ---- values ----------------------------------------------------------------------------

/** A one-item list is its item, as a one-cell range is in Excel. */
function one(v: Val): Scalar {
	if (!Array.isArray(v)) return v;
	return v.length === 1 ? v[0] : E('#VALUE!', 'a list where one value was expected');
}

const list = (v: Val): Scalar[] => (Array.isArray(v) ? v : [v]);

export function num(v: Val): number | Err {
	const s = one(v);
	if (s === null) return 0;
	if (typeof s === 'number') return s;
	if (typeof s === 'boolean') return +s;
	if (typeof s === 'string') {
		return NUMERIC.test(s) ? Number(s) : E('#VALUE!', `"${s}" is not a number`);
	}
	return s;
}

/** Excel turns a number into text with at most 15 significant digits. */
const fmt = (n: number) => String(Number(n.toPrecision(15))).toUpperCase();

export function str(v: Val): string | Err {
	const s = one(v);
	if (s === null) return '';
	if (typeof s === 'number') return fmt(s);
	if (typeof s === 'boolean') return s ? 'TRUE' : 'FALSE';
	return s;
}

export function bool(v: Val): boolean | Err {
	const s = one(v);
	if (s === null) return false;
	if (typeof s === 'number') return s !== 0;
	if (typeof s === 'string') {
		const u = s.toUpperCase();
		return u === 'TRUE' || u === 'FALSE'
			? u === 'TRUE'
			: E('#VALUE!', `"${s}" is not TRUE or FALSE`);
	}
	return s;
}

type Plain = Exclude<Scalar, Err>;
const rank = (v: Exclude<Plain, null>) =>
	typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2;
const like = (other: Plain) =>
	typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0;

/**
 * Excel's order: numbers, then text, then FALSE and TRUE. Text compares without case,
 * a blank takes the other side's type, and numbers match to 15 digits, so 0.1+0.2=0.3.
 */
function compare(a: Plain, b: Plain): number {
	const x = a ?? like(b);
	const y = b ?? like(a);
	if (rank(x) !== rank(y)) return rank(x) - rank(y);
	if (typeof x === 'string') {
		const [p, q] = [x.toLowerCase(), (y as string).toLowerCase()];
		return p < q ? -1 : p > q ? 1 : 0;
	}
	const d = Number((+x).toPrecision(15)) - Number((+y as number).toPrecision(15));
	return Math.sign(d);
}

function binary(op: string, a: Scalar, b: Scalar): Scalar {
	if (isErr(a)) return a;
	if (isErr(b)) return b;
	if (op === '&') return (str(a) as string) + (str(b) as string);
	if (PREC[op] === 1) {
		const d = compare(a, b);
		return op === '='
			? d === 0
			: op === '<>'
				? d !== 0
				: op === '<'
					? d < 0
					: op === '<='
						? d <= 0
						: op === '>'
							? d > 0
							: d >= 0;
	}
	const x = num(a);
	const y = num(b);
	if (isErr(x)) return x;
	if (isErr(y)) return y;
	if (op === '/' && y === 0) return E('#DIV/0!', 'divides by zero');
	if (op === '^' && x === 0 && y === 0) return E('#NUM!', '0^0 has no value');
	const r =
		op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : x ** y;
	return Number.isFinite(r) ? r : E('#NUM!', 'the result is not a number');
}

// ---- functions -------------------------------------------------------------------------

/**
 * `ranges`: a field passed straight in is read as a range, as a cell reference is in
 * Excel, so SUM skips a text field's words but refuses SUM("abc"). `lazy` gets its
 * arguments unevaluated, so IF(x, 1, 1/0) never divides.
 */
type Def = {
	min: number;
	max: number;
	pairs?: boolean;
	ranges?: boolean;
	fn?: (args: Val[]) => Val;
	lazy?: (args: Node[], ev: (n: Node) => Val) => Val;
};

/** SUM's reading: inside a list only numbers count; a value given directly must be one. */
function numbers(args: Val[]): number[] | Err {
	const out: number[] = [];
	for (const a of args) {
		if (Array.isArray(a)) {
			for (const x of a) {
				if (isErr(x)) return x;
				if (typeof x === 'number') out.push(x);
			}
		} else {
			const n = num(a);
			if (isErr(n)) return n;
			out.push(n);
		}
	}
	return out;
}

const over =
	(f: (ns: number[]) => Val) =>
	(args: Val[]): Val => {
		const ns = numbers(args);
		return isErr(ns) ? ns : f(ns);
	};

/** AND's reading: TRUE, FALSE and numbers count; text inside a list is skipped. */
function truths(args: Val[]): boolean[] | Err {
	const out: boolean[] = [];
	for (const a of args) {
		if (Array.isArray(a)) {
			for (const x of a) {
				if (isErr(x)) return x;
				if (typeof x === 'boolean' || typeof x === 'number') out.push(!!x);
			}
		} else {
			const b = bool(a);
			if (isErr(b)) return b;
			out.push(b);
		}
	}
	return out.length ? out : E('#VALUE!', 'nothing TRUE or FALSE to test');
}

function texts(args: Val[]): string[] | Err {
	const out: string[] = [];
	for (const x of args.flatMap(list)) {
		const s = str(x);
		if (isErr(s)) return s;
		out.push(s);
	}
	return out;
}

/** ROUND and its kin, with halves away from zero, after Excel's 15 digits. */
const rounding =
	(to: (n: number) => number) =>
	([v, d]: Val[]): Val => {
		const n = num(v);
		const k = num(d);
		if (isErr(n)) return n;
		if (isErr(k)) return k;
		const digits = Math.trunc(k);
		const m = 10 ** Math.abs(digits);
		const x = Number((digits >= 0 ? Math.abs(n) * m : Math.abs(n) / m).toPrecision(15));
		return Math.sign(n) * (digits >= 0 ? to(x) / m : to(x) * m);
	};

const multiple =
	(to: (n: number) => number, zero: Val) =>
	([v, s]: Val[]): Val => {
		const n = num(v);
		const sig = s === undefined ? 1 : num(s);
		if (isErr(n)) return n;
		if (isErr(sig)) return sig;
		if (sig === 0) return zero;
		if (n > 0 && sig < 0) return E('#NUM!', 'a positive number with a negative multiple');
		return to(Number((n / sig).toPrecision(15))) * sig;
	};

/** COUNTIF's criteria: "持有", ">3", "<>", "a*", or a plain value. */
function criterion(c: Plain): (x: Scalar) => boolean {
	const asNum = (x: Scalar) =>
		typeof x === 'number' ? x : typeof x === 'string' && NUMERIC.test(x) ? Number(x) : null;
	if (typeof c === 'number') return (x) => asNum(x) === c;
	if (typeof c === 'boolean') return (x) => x === c;
	const [, op = '=', rest] = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c ?? '')!;
	const n = NUMERIC.test(rest) ? Number(rest) : null;
	const b = /^(true|false)$/i.test(rest) ? rest.toUpperCase() === 'TRUE' : null;
	let eq: (x: Scalar) => boolean;
	if (n !== null) eq = (x) => asNum(x) === n;
	else if (b !== null) eq = (x) => x === b;
	else if (rest === '') eq = (x) => x === null || x === '';
	else {
		const re = new RegExp(
			`^${rest.replace(/~([*?~])|([*?])|[.+^${}()|[\]\\]/g, (m, lit, w) =>
				lit ? `\\${lit}` : w ? (w === '*' ? '[\\s\\S]*' : '[\\s\\S]') : `\\${m}`
			)}$`,
			'i'
		);
		eq = (x) => typeof x === 'string' && re.test(x);
	}
	if (op === '=') return eq;
	if (op === '<>') return (x) => !eq(x);
	const d = (x: Scalar) =>
		n !== null
			? typeof x === 'number'
				? x - n
				: NaN
			: typeof x === 'string'
				? compare(x, rest)
				: NaN;
	return (x) =>
		op === '<' ? d(x) < 0 : op === '>' ? d(x) > 0 : op === '<=' ? d(x) <= 0 : d(x) >= 0;
}

function matches(range: Val, crit: Val): boolean[] | Err {
	const c = one(crit);
	if (isErr(c)) return c;
	const test = criterion(c);
	return list(range).map(test);
}

const FNS: Record<string, Def> = {
	SUM: { min: 1, max: Infinity, ranges: true, fn: over((ns) => ns.reduce((a, b) => a + b, 0)) },
	AVERAGE: {
		min: 1,
		max: Infinity,
		ranges: true,
		fn: over((ns) =>
			ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : E('#DIV/0!', 'no numbers to average')
		)
	},
	MIN: { min: 1, max: Infinity, ranges: true, fn: over((ns) => (ns.length ? Math.min(...ns) : 0)) },
	MAX: { min: 1, max: Infinity, ranges: true, fn: over((ns) => (ns.length ? Math.max(...ns) : 0)) },
	COUNT: {
		min: 1,
		max: Infinity,
		ranges: true,
		fn: (args) =>
			args.reduce<number>(
				(n, a) =>
					n + (Array.isArray(a) ? a.filter((x) => typeof x === 'number').length : +!isErr(num(a))),
				0
			)
	},
	COUNTA: {
		min: 1,
		max: Infinity,
		ranges: true,
		fn: (args) =>
			args.reduce<number>(
				(n, a) => n + (Array.isArray(a) ? a.filter((x) => x !== null).length : 1),
				0
			)
	},
	COUNTIF: {
		min: 2,
		max: 2,
		ranges: true,
		fn: ([r, c]) => {
			const hit = matches(r, c);
			return isErr(hit) ? hit : hit.filter(Boolean).length;
		}
	},
	SUMIF: {
		min: 2,
		max: 3,
		ranges: true,
		fn: ([r, c, s]) => {
			const hit = matches(r, c);
			if (isErr(hit)) return hit;
			const sum = list(s ?? r);
			return hit.reduce(
				(t, h, i) => t + (h && typeof sum[i] === 'number' ? (sum[i] as number) : 0),
				0
			);
		}
	},
	IF: {
		min: 1,
		max: 3,
		lazy: ([c, a, b], ev) => {
			const t = bool(ev(c));
			if (isErr(t)) return t;
			return t ? (a ? ev(a) : true) : b ? ev(b) : false;
		}
	},
	IFS: {
		min: 2,
		max: Infinity,
		pairs: true,
		lazy: (args, ev) => {
			for (let i = 0; i < args.length; i += 2) {
				const t = bool(ev(args[i]));
				if (isErr(t)) return t;
				if (t) return ev(args[i + 1]);
			}
			return E('#N/A', 'no condition was TRUE');
		}
	},
	IFERROR: {
		min: 2,
		max: 2,
		lazy: ([v, alt], ev) => {
			const x = ev(v);
			return isErr(x) ? ev(alt) : x;
		}
	},
	AND: {
		min: 1,
		max: Infinity,
		ranges: true,
		fn: (args) => {
			const t = truths(args);
			return isErr(t) ? t : t.every(Boolean);
		}
	},
	OR: {
		min: 1,
		max: Infinity,
		ranges: true,
		fn: (args) => {
			const t = truths(args);
			return isErr(t) ? t : t.some(Boolean);
		}
	},
	NOT: {
		min: 1,
		max: 1,
		fn: ([v]) => {
			const b = bool(v);
			return isErr(b) ? b : !b;
		}
	},
	ROUND: { min: 2, max: 2, fn: rounding(Math.round) },
	ROUNDUP: { min: 2, max: 2, fn: rounding(Math.ceil) },
	ROUNDDOWN: { min: 2, max: 2, fn: rounding(Math.floor) },
	INT: {
		min: 1,
		max: 1,
		fn: ([v]) => {
			const n = num(v);
			return isErr(n) ? n : Math.floor(n);
		}
	},
	ABS: {
		min: 1,
		max: 1,
		fn: ([v]) => {
			const n = num(v);
			return isErr(n) ? n : Math.abs(n);
		}
	},
	MOD: {
		min: 2,
		max: 2,
		fn: ([a, b]) => {
			const n = num(a);
			const d = num(b);
			if (isErr(n)) return n;
			if (isErr(d)) return d;
			// The sign of the divisor, as in Excel: MOD(-3, 2) is 1.
			return d === 0 ? E('#DIV/0!', 'divides by zero') : n - d * Math.floor(n / d);
		}
	},
	FLOOR: { min: 1, max: 2, fn: multiple(Math.floor, E('#DIV/0!', 'a multiple of 0')) },
	CEILING: { min: 1, max: 2, fn: multiple(Math.ceil, 0) },
	LEN: {
		min: 1,
		max: 1,
		fn: ([v]) => {
			const s = str(v);
			return isErr(s) ? s : s.length;
		}
	},
	LEFT: { min: 1, max: 2, fn: ([v, k]) => cut(v, k, (s, n) => s.slice(0, n)) },
	RIGHT: { min: 1, max: 2, fn: ([v, k]) => cut(v, k, (s, n) => (n ? s.slice(-n) : '')) },
	MID: {
		min: 3,
		max: 3,
		fn: ([v, a, k]) => {
			const at = num(a);
			if (isErr(at)) return at;
			if (at < 1) return E('#VALUE!', 'MID starts at 1');
			return cut(v, k, (s, n) => s.slice(Math.trunc(at) - 1, Math.trunc(at) - 1 + n));
		}
	},
	UPPER: {
		min: 1,
		max: 1,
		fn: ([v]) => {
			const s = str(v);
			return isErr(s) ? s : s.toUpperCase();
		}
	},
	LOWER: {
		min: 1,
		max: 1,
		fn: ([v]) => {
			const s = str(v);
			return isErr(s) ? s : s.toLowerCase();
		}
	},
	REPT: {
		min: 2,
		max: 2,
		fn: ([v, k]) => {
			const s = str(v);
			const n = num(k);
			if (isErr(s)) return s;
			if (isErr(n)) return n;
			if (n < 0) return E('#VALUE!', 'a negative count');
			// Excel's cap, checked before the text is made.
			if (s.length * Math.trunc(n) > 32767) return E('#VALUE!', 'longer than 32,767 characters');
			return s.repeat(Math.trunc(n));
		}
	},
	CONCAT: {
		min: 1,
		max: Infinity,
		ranges: true,
		fn: (args) => {
			const t = texts(args);
			return isErr(t) ? t : t.join('');
		}
	},
	TEXTJOIN: {
		min: 3,
		max: Infinity,
		ranges: true,
		fn: ([d, skip, ...rest]) => {
			const sep = str(d);
			const drop = bool(skip);
			const t = texts(rest);
			if (isErr(sep)) return sep;
			if (isErr(drop)) return drop;
			if (isErr(t)) return t;
			return t.filter((s) => !drop || s !== '').join(sep);
		}
	},
	XLOOKUP: {
		min: 3,
		max: 4,
		ranges: true,
		fn: ([k, look, back, missing]) => {
			const key = one(k);
			if (isErr(key)) return key;
			const from = list(look);
			const to = list(back);
			if (from.length !== to.length) return E('#VALUE!', 'the two lists differ in length');
			const i = from.findIndex((x) => !isErr(x) && compare(x, key) === 0);
			return i >= 0 ? to[i] : missing !== undefined ? missing : E('#N/A', 'not found');
		}
	}
};
FNS.CONCATENATE = FNS.CONCAT;

function cut(v: Val, k: Val | undefined, take: (s: string, n: number) => string): Val {
	const s = str(v);
	const n = k === undefined ? 1 : num(k);
	if (isErr(s)) return s;
	if (isErr(n)) return n;
	return n < 0 ? E('#VALUE!', 'a negative length') : take(s, Math.trunc(n));
}

/** Excel writes newer functions as `_xlfn.CONCAT`; they are the same function here. */
const key = (fn: string) => fn.toUpperCase().replace(/^(_XLFN\.)?(_XLWS\.)?/, '');

export const functions = Object.keys(FNS).sort();

// ---- evaluating ------------------------------------------------------------------------

/** A table row a column's formula or rule is worked out for: its columns read its cells. */
export type InRow = { table: Field; row: Row };

type Ctx = {
	sheet: Sheet;
	stack: string[];
	memo: Map<string, Val>;
	roll?: Roll;
	rolled?: Rolled[];
	row?: InRow;
};

function ev(n: Node, ctx: Ctx): Val {
	switch (n.t) {
		case 'lit':
			return n.v;
		case 'name':
			return byName(n, ctx);
		case 'ref':
			return read(n, ctx);
		case 'dice': {
			if (!ctx.roll) return E('#VALUE!', 'dice roll only in rules');
			if (n.n < 1 || n.n > 100 || n.sides < 1 || n.sides > 1000) {
				return E('#NUM!', `${n.n}d${n.sides} is too many dice or faces`);
			}
			const got = Array.from({ length: n.n }, () => ctx.roll!(n.sides));
			ctx.rolled?.push({ dice: `${n.n}d${n.sides}`, got });
			return got.reduce((a, b) => a + b, 0);
		}
		case 'un': {
			if (n.op === '+') return ev(n.a, ctx);
			const x = num(ev(n.a, ctx));
			if (isErr(x)) return x;
			return n.op === '-' ? -x : x / 100;
		}
		case 'bin':
			return binary(n.op, one(ev(n.a, ctx)), one(ev(n.b, ctx)));
		case 'call': {
			const def = FNS[key(n.fn)];
			if (!def) return E('#NAME?', `${n.fn} is not a function here`);
			if (def.lazy) return def.lazy(n.args, (a) => ev(a, ctx));
			return def.fn!(
				n.args.map((a) => (def.ranges && a.t === 'ref' ? list(ev(a, ctx)) : ev(a, ctx)))
			);
		}
	}
}

function read(n: Omit<Extract<Node, { t: 'ref' }>, 't'>, ctx: Ctx): Val {
	// Another character's field, by `globalId`, is read on that character's sheet.
	const bang = n.id.indexOf('!');
	if (bang >= 0) {
		const o = ctx.sheet.others?.find((x) => x.id === n.id.slice(0, bang));
		if (!o) return E('#REF!', 'reads a character that was deleted');
		const sheet = { ...ctx.sheet, ...o };
		return read({ ...n, id: n.id.slice(bang + 1) }, { ...ctx, sheet, row: undefined });
	}
	const f = ctx.sheet.fields.find((x) => x.id === n.id);
	if (!f) {
		const here = ctx.row?.table.columns?.find((c) => c.id === n.id);
		if (here && n.col === undefined) return cell(ctx.row!.table, here, ctx.row!.row, ctx, n.prop);
		const k = ctx.sheet.clocks?.find((x) => x.id === n.id);
		if (!k) return E('#REF!', 'reads a field that was deleted');
		return n.prop || n.col !== undefined
			? E('#VALUE!', `${k.name} is a clock: only its reading`)
			: k.now;
	}
	const prop = n.prop?.toLowerCase();
	const none = E('#VALUE!', `${f.label} has no .${n.prop}`);
	const v = valueOf(ctx.sheet, f);
	if (f.kind === 'table') {
		// A table alone is all its cells, row by row, as Excel reads a table's body.
		const rows = v as Row[];
		const cols = f.columns ?? [];
		if (prop) return none;
		if (n.col === undefined) return rows.flatMap((r) => cols.map((c) => one(cell(f, c, r, ctx))));
		const c = cols.find((x) => x.id === n.col);
		return c
			? rows.map((r) => one(cell(f, c, r, ctx)))
			: E('#REF!', `${f.label} has no such column`);
	}
	if (n.col !== undefined) return E('#REF!', `${f.label} has no columns`);
	switch (f.kind) {
		case 'resource': {
			const r = v as Resource;
			return prop === 'max' ? r.max : !prop || prop === 'cur' ? r.cur : none;
		}
		case 'track': {
			const t = v as boolean[];
			if (prop === 'boxes') return pattern(t);
			return prop === 'max' ? t.length : !prop ? t.filter(Boolean).length : none;
		}
	}
	if (prop) return none;
	switch (f.kind) {
		case 'number':
			return v as number;
		case 'text':
		case 'choice':
			return (v as string) || null;
		case 'tags':
			return v as string[];
		case 'entries':
			return (v as Entry[]).map((e) => e.name || null);
		case 'formula':
			return run(f, ctx);
		case 'image':
			return E('#VALUE!', 'a picture has no value');
		case 'button':
			return E('#VALUE!', 'a button has no value');
		case 'map':
			return mapName(f, v as string, ctx.sheet) || null;
	}
}

/**
 * A map's current node, named by its source row's Name, else its first column, as
 * `nameColumn` in `source.ts` picks: that module imports this one, so it cannot be used here.
 */
function mapName(f: Field, row: string, sheet: Sheet): string {
	const [owner, table] = (f.from ?? '').split('!');
	const c = [sheet, ...(sheet.others ?? [])].find((x) => x.id === owner);
	const t = c?.fields.find((x) => x.id === table && x.kind === 'table');
	if (!c || !t || !row) return '';
	const key = t.columns?.find((x) => same(x.name, 'Name')) ?? t.columns?.[0];
	const v = key && (valueOf(c, t) as Row[]).find((r) => r.id === row)?.cells[key.id];
	return v === undefined ? '' : String(v);
}

/** A track's boxes as text, x for a ticked one and . for an empty one, as `x.x.`. */
export const pattern = (boxes: boolean[]) => boxes.map((b) => (b ? 'x' : '.')).join('');

export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One cell as a formula reads it: a resource its current, a track its ticks, tags joined. */
function cell(table: Field, col: Column, r: Row, ctx: Ctx, prop?: string): Val {
	const p = prop?.toLowerCase();
	const has =
		!p ||
		(col.kind === 'resource' && (p === 'max' || p === 'cur')) ||
		(col.kind === 'track' && (p === 'max' || p === 'boxes'));
	if (!has) return E('#VALUE!', `${col.name} has no .${prop}`);
	if (col.kind === 'formula') return runCell(table, col, r, ctx);
	if (col.kind === 'button') return null;
	if (col.kind === 'image') return E('#VALUE!', 'a picture has no value');
	const v = cellOf(r, col);
	if (v === undefined) return null;
	if (col.kind === 'resource') return p === 'max' ? (v as Resource).max : (v as Resource).cur;
	if (col.kind === 'track') {
		const boxes = v as boolean[];
		if (p === 'boxes') return pattern(boxes);
		return p === 'max' ? boxes.length : boxes.filter(Boolean).length;
	}
	if (col.kind === 'tags') return (v as string[]).join(', ') || null;
	return v as number | string;
}

function runCell(table: Field, col: Column, r: Row, ctx: Ctx): Val {
	const key = `${ctx.sheet.id}!${col.id}:${r.id}`;
	if (ctx.stack.includes(key)) return E('#CYCLE!', `${col.name} reaches itself`);
	const known = ctx.memo.get(key);
	if (known !== undefined) return known;
	if (!col.formula?.trim()) return null;
	ctx.stack.push(key);
	let v: Val;
	try {
		v = ev(compiled(col.formula), { ...ctx, roll: undefined, row: { table, row: r } }) ?? 0;
	} catch (e) {
		if (!(e instanceof FormulaError)) throw e;
		v = E('#ERROR!', e.message);
	}
	ctx.stack.pop();
	ctx.memo.set(key, v);
	return v;
}

/** A formula column's result in one row. */
export function cellResult(sheet: Sheet, table: string, col: string, row: string): Val {
	const f = sheet.fields.find((x) => x.id === table);
	const c = f?.columns?.find((x) => x.id === col);
	const r = f && (valueOf(sheet, f) as Row[]).find((x) => x.id === row);
	if (!c || !r) return E('#REF!');
	return runCell(f, c, r, { sheet, stack: [], memo: new Map() });
}

/** A name stored as typed: a column of this row, or a field or clock named since. */
function byName(n: Extract<Node, { t: 'name' }>, ctx: Ctx): Val {
	const { fields, clocks = [] } = ctx.sheet;
	if (n.of !== undefined) {
		const o = ctx.sheet.others?.find((x) => same(x.name, n.of!));
		const f = o?.fields.find((x) => same(x.label, n.s));
		if (!f) return E('#NAME?', `nothing on ${n.of} is called "${n.s}"`);
		const col = n.col && (f.columns?.find((c) => same(c.name, n.col!))?.id ?? n.col);
		return read({ id: globalId(o!, f), prop: n.prop, col: col ?? undefined }, ctx);
	}
	// In a row, its own columns come first; [@Column] names only them, as in Excel.
	const at = n.s.startsWith('@');
	const here = ctx.row?.table.columns?.find((c) => same(c.name, at ? n.s.slice(1) : n.s));
	if (here) return cell(ctx.row!.table, here, ctx.row!.row, ctx, n.prop);
	if (at) return E('#NAME?', `this row has no column "${n.s.slice(1)}"`);
	const f = fields.find((x) => same(x.label, n.s));
	if (f) {
		const col = n.col && (f.columns?.find((c) => same(c.name, n.col!))?.id ?? n.col);
		return read({ id: f.id, prop: n.prop, col: col ?? undefined }, ctx);
	}
	const k = clocks.find((x) => same(x.name, n.s));
	if (k) return read({ id: k.id, prop: n.prop, col: n.col }, ctx);
	return E('#NAME?', `no field is labelled "${n.s}"`);
}

const parsed = new Map<string, Node | FormulaError>();

function compiled(text: string): Node {
	let n = parsed.get(text);
	if (!n) {
		try {
			n = parse(text);
		} catch (e) {
			if (!(e instanceof FormulaError)) throw e;
			n = e;
		}
		if (parsed.size > 1000) parsed.clear();
		parsed.set(text, n);
	}
	if (n instanceof FormulaError) throw n;
	return n;
}

function run(f: Field, ctx: Ctx): Val {
	// By character too: characters made from one template share field ids.
	const key = `${ctx.sheet.id}!${f.id}`;
	if (ctx.stack.includes(key)) return E('#CYCLE!', `${f.label} reaches itself`);
	const known = ctx.memo.get(key);
	if (known !== undefined) return known;
	if (!f.formula?.trim()) return null;
	ctx.stack.push(key);
	let v: Val;
	try {
		// A formula that reads a blank shows 0, as Excel's does. Its dice never roll, even
		// read from a rule, or it would change every time it shows.
		v = ev(compiled(f.formula), { ...ctx, roll: undefined, row: undefined }) ?? 0;
	} catch (e) {
		if (!(e instanceof FormulaError)) throw e;
		v = E('#ERROR!', e.message);
	}
	ctx.stack.pop();
	ctx.memo.set(key, v);
	return v;
}

/** A parsed formula's value. Dice roll only when `roll` is given, as in a rule. */
export function evaluate(n: Node, sheet: Sheet, roll?: Roll, rolled?: Rolled[], row?: InRow): Val {
	return ev(n, { sheet, stack: [], memo: new Map(), roll, rolled, row });
}

/** Whether a formula rolls dice, and so cannot be known before it runs. */
export const rolls = (n: Node): boolean =>
	n.t === 'dice' ||
	(n.t === 'un' && rolls(n.a)) ||
	(n.t === 'bin' && (rolls(n.a) || rolls(n.b))) ||
	(n.t === 'call' && n.args.some(rolls));

/** A formula field's result; blank while it has no formula. */
export function result(sheet: Sheet, id: string): Val {
	const f = sheet.fields.find((x) => x.id === id);
	if (!f) return E('#REF!');
	return run(f, { sheet, stack: [], memo: new Map() });
}

/** As a cell would show it: ten significant digits, and a list joined with commas. */
export function show(v: Val): string {
	if (Array.isArray(v)) return v.map(show).join(', ');
	if (isErr(v)) return v.err;
	if (typeof v === 'number')
		return Math.abs(v) >= 1e10 ? fmt(v) : String(Number(v.toPrecision(10)));
	return str(v) as string;
}

// ---- labels in, ids out ----------------------------------------------------------------

/** Something a formula can name. */
export type Name = {
	id: string;
	label: string;
	kind?: Kind | ColumnKind | 'clock';
	columns?: Column[];
	/** A column of the row a formula or rule is worked out for. */
	row?: boolean;
	/** The other character a field is on, written before a `!`. */
	of?: string;
};

/** A table's columns, as its column formulas and rules name them: this row's cells. */
export const rowNames = (table: Field): Name[] =>
	(table.columns ?? []).map((c) => ({ id: c.id, label: c.name, kind: c.kind, row: true }));

/**
 * All a character's formulas can name: its fields, the clocks, and every character's fields
 * as `Name!Label`, its own too, as Excel names its own sheet: a card on the GM's page that
 * reads GM!Weapons reads it still once pasted on a player.
 */
export function names(sheet: Sheet): Name[] {
	return [
		...sheet.fields,
		...(sheet.clocks ?? []).map((k) => ({ id: k.id, label: k.name, kind: 'clock' as const })),
		...(sheet.others ?? []).flatMap((o) =>
			o.fields.map((f) => ({
				id: globalId(o, f),
				label: f.label,
				kind: f.kind,
				columns: f.columns,
				of: o.name
			}))
		)
	];
}

/** A label or name, bracketed unless it reads as one word. */
function word(text: string): string {
	const s = text.trim();
	const bare = WORD.exec(s)?.[0] === s && !/^[\d.]/.test(s) && !/^(true|false)$/i.test(s);
	return bare ? s : `[${s}]`;
}

/** How a field is written in a formula: its label, after its character's name if another's. */
export const nameOf = (f: { label: string; of?: string }) =>
	f.of === undefined ? word(f.label) : `${word(f.of)}!${word(f.label)}`;

/**
 * What someone typed, with each label swapped for its field's id. A label no field has is
 * kept, and shows #NAME? until one does. Throws `FormulaError` when it cannot be read.
 */
export function compile(text: string, names: Name[]): string {
	const out = swap(strip(text), names);
	parse(out);
	return out;
}

function swap(src: string, names: Name[]): string {
	let out = '';
	let last = 0;
	for (const t of lex(src)) {
		if (t.k !== 'name') continue;
		// A row's own columns come first; Excel's [@Column] names only them.
		const at = t.s.startsWith('@');
		// A bare label names only this character's own; another's is written `Name!Label`.
		const all = names.filter(
			(f) =>
				(t.of === undefined ? f.of === undefined : f.of !== undefined && same(f.of, t.of)) &&
				same(f.label, at ? t.s.slice(1) : t.s)
		);
		const own = all.filter((f) => f.row);
		const hits = at || own.length ? own : all;
		if (hits.length > 1) {
			throw new FormulaError(
				t.of !== undefined
					? `${hits.length} characters called "${t.of}" have a "${t.s}": rename one`
					: hits.some((h) => h.kind === 'clock')
						? `a field and a clock are both called "${t.s}": rename one`
						: `${hits.length} fields are labelled "${t.s}": rename all but one`
			);
		}
		if (!hits.length) continue;
		const col =
			t.col && hits[0].columns?.find((c) => c.name.trim().toLowerCase() === t.col!.toLowerCase());
		out += `${src.slice(last, t.at)}${refText(hits[0].id)}${t.prop ? `.${t.prop}` : ''}${
			t.col !== undefined ? `[${col ? col.id : t.col}]` : ''
		}`;
		last = t.end;
	}
	return out + src.slice(last);
}

export type Line = {
	target: Extract<Node, { t: 'ref' }> | Extract<Node, { t: 'name' }>;
	op: '=' | '+=' | '-=';
	expr: Node;
};

/** Reads a rule's line: what it changes, then =, += or -=, then a formula. */
export function parseLine(text: string): Line {
	const src = text.trim();
	const [t, a, b] = lex(src);
	if (t?.k !== 'ref' && t?.k !== 'name') {
		throw new FormulaError('a line starts with what it changes, as in HP -= 1');
	}
	let op: Line['op'] = '=';
	let end: number;
	if (a?.k === 'op' && a.s === '=') end = a.end;
	else if (
		a?.k === 'op' &&
		(a.s === '+' || a.s === '-') &&
		b?.k === 'op' &&
		b.s === '=' &&
		b.at === a.end
	) {
		op = a.s === '+' ? '+=' : '-=';
		end = b.end;
	} else throw new FormulaError(`expected =, += or -= after "${src.slice(t.at, t.end)}"`);
	const target: Line['target'] =
		t.k === 'ref'
			? { t: 'ref', id: t.id, prop: t.prop, col: t.col }
			: { t: 'name', s: t.s, of: t.of, prop: t.prop, col: t.col };
	return { target, op, expr: parse(src.slice(end)) };
}

/** Why a rule cannot change something of this kind, or null when it can. */
export function unwritable(
	kind: Name['kind'],
	prop: string | undefined,
	op: Line['op']
): string | null {
	const p = prop?.toLowerCase();
	switch (kind) {
		case 'clock':
			return 'moves only when someone presses Next';
		case 'number':
			return p ? `has no .${prop}` : null;
		case 'resource':
			return !p || p === 'cur' || p === 'max' ? null : `has no .${prop}`;
		case 'track':
			if (p === 'boxes') return op === '=' ? null : 'takes only = for its .boxes';
			return !p || p === 'max' ? null : `has no .${prop}`;
		case 'tags':
			return p ? `has no .${prop}` : null;
		case 'text':
		case 'choice':
			return p ? `has no .${prop}` : op === '=' ? null : 'takes only =';
		default:
			return "can't be changed by a rule";
	}
}

/**
 * A line as typed, with labels swapped for ids. Refused when it cannot be read or changes
 * what a rule cannot, such as a clock.
 */
export function compileLine(text: string, names: Name[]): string {
	const out = swap(text.trim(), names);
	const { target, op } = parseLine(out);
	const who = target.t === 'ref' ? names.find((x) => x.id === target.id) : undefined;
	if (!who) {
		throw new FormulaError(
			target.t === 'ref' ? 'it changes a field that was deleted' : `nothing is called "${target.s}"`
		);
	}
	const why =
		who.of !== undefined
			? 'is on another character, which a rule only reads'
			: target.col !== undefined
				? "can't be changed by a rule"
				: unwritable(who.kind, target.prop, op);
	if (why) throw new FormulaError(`${nameOf(who)} ${why}`);
	return out;
}

/** The stored form, with current labels; a deleted field shows as #REF!, as in Excel. */
export function render(stored: string, fields: Name[]): string {
	let toks: Tok[];
	try {
		toks = lex(stored);
	} catch {
		return stored;
	}
	let out = '';
	let last = 0;
	for (const t of toks) {
		if (t.k !== 'ref') continue;
		const f = fields.find((x) => x.id === t.id);
		out += stored.slice(last, t.at);
		// A column that was deleted leaves its id, which shows as #REF!; a name never found stays.
		const col =
			t.col === undefined
				? ''
				: `[${f?.columns?.find((c) => c.id === t.col)?.name ?? (UUID.test(t.col) ? '#REF!' : t.col)}]`;
		out += f ? `${nameOf(f)}${t.prop ? `.${t.prop}` : ''}${col}` : '#REF!';
		last = t.end;
	}
	return out + stored.slice(last);
}

// A label as written: in brackets, or one word.
const PART = `(?:\\[[^\\]]*\\]|[^\\s+\\-*/^&=<>%(),"[\\]{}.:;!@#']+)`;

/** Labels and functions that could finish the name typed just before `caret`. */
export function suggest(text: string, caret: number, fields: Name[]) {
	const before = text.slice(0, caret);
	const none = { from: caret, options: [] as string[] };
	if ((before.match(/"/g)?.length ?? 0) % 2) return none;
	const m = /\[([^\]]*)$/.exec(before) ?? /[^\s+\-*/^&=<>%(),"[\]{}.:;!@#']+$/.exec(before);
	if (!m) return none;
	const bracket = m[0].startsWith('[');
	const typed = (bracket ? m[1] : m[0]).trim().toLowerCase();
	if (!bracket && (!typed || /^\d/.test(typed))) return none;
	if (bracket) {
		// Right after a table's name, a bracket opens one of its columns.
		const owner = new RegExp(`(?:${PART}!)?${PART}$`).exec(before.slice(0, m.index))?.[0];
		const table = fields.find(
			(f) => f.kind === 'table' && owner && nameOf(f).toLowerCase() === owner.toLowerCase()
		);
		if (table) {
			const cols = (table.columns ?? []).filter((c) => c.name.toLowerCase().includes(typed));
			return { from: m.index, options: cols.map((c) => `[${c.name}]`).slice(0, 8) };
		}
	}
	// Right after `Name!`, the labels on that character.
	const on = new RegExp(`(${PART})!$`).exec(before.slice(0, m.index))?.[1].replace(/^\[|\]$/g, '');
	const pool =
		on === undefined
			? fields
			: fields.filter((f) => f.of !== undefined && same(f.of, on)).map((f) => ({ label: f.label }));
	const names = [...new Set(pool.map(nameOf))];
	const plain = (n: string) => n.replace(/^\[|\]$/g, '').toLowerCase();
	const labels = [
		...names.filter((n) => plain(n).startsWith(typed)),
		...names.filter((n) => !plain(n).startsWith(typed) && plain(n).includes(typed))
	];
	const fns = bracket ? [] : functions.filter((f) => f.toLowerCase().startsWith(typed));
	return { from: m.index, options: [...labels, ...fns.map((f) => `${f}(`)].slice(0, 8) };
}

export type Paint =
	'fn' | 'field' | 'unknown' | 'num' | 'str' | 'bool' | 'err' | 'op' | 'paren' | 'bad' | 'plain';

/**
 * A formula as typed, cut into pieces to colour. A label or function this sheet does not
 * have is `unknown`, so a typo shows before it is saved; parentheses carry their depth.
 */
export function highlight(text: string, fields: Name[]) {
	const out: { text: string; paint: Paint; depth?: number }[] = [];
	const labels = new Set(fields.filter((f) => !f.of).map((f) => f.label.trim().toLowerCase()));
	let last = 0;
	let depth = 0;
	for (const t of lex(text, true)) {
		if (t.at > last) out.push({ text: text.slice(last, t.at), paint: 'plain' });
		const piece = text.slice(t.at, t.end);
		last = t.end;
		if (t.k === 'op' && (t.s === '(' || t.s === ')')) {
			if (t.s === ')') depth = Math.max(0, depth - 1);
			out.push({ text: piece, paint: 'paren', depth: depth % 3 });
			if (t.s === '(') depth++;
			continue;
		}
		const known =
			t.k === 'fn'
				? key(t.s) in FNS
				: t.k === 'name'
					? t.of === undefined
						? labels.has(t.s.toLowerCase())
						: fields.some((f) => f.of !== undefined && same(f.of, t.of!) && same(f.label, t.s))
					: t.k === 'ref'
						? fields.some((f) => f.id === t.id)
						: true;
		const paint =
			t.k === 'fn'
				? 'fn'
				: t.k === 'name' || t.k === 'ref'
					? 'field'
					: t.k === 'dice'
						? 'num'
						: t.k;
		out.push({ text: piece, paint: known ? paint : 'unknown' });
	}
	if (last < text.length) out.push({ text: text.slice(last), paint: 'plain' });
	return out;
}
