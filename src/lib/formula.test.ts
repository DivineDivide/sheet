import { describe, expect, it } from 'vitest';
import { blank, type Field, type Kind, type Row, type Value } from './doc';
import {
	FormulaError,
	compile,
	highlight,
	parse,
	render,
	result,
	show,
	suggest,
	type Val
} from './formula';

const box = { x: 0, y: 0, w: 96, h: 56 };

function sheet(...defs: [label: string, kind: Kind, value?: Value][]) {
	const fields: Field[] = defs.map(([label, kind], i) => ({
		id: `f${i}`,
		label,
		kind,
		tab: 't',
		box
	}));
	const values = Object.fromEntries(defs.map(([, kind, v], i) => [`f${i}`, v ?? blank(kind)]));
	return { fields, values };
}

/** The result of a formula typed onto a sheet, as its field would show it. */
function calc(text: string, s = sheet()): Val {
	const out: Field = {
		id: 'out',
		label: 'Out',
		kind: 'formula',
		tab: 't',
		box,
		formula: compile(text, s.fields)
	};
	return result({ fields: [...s.fields, out], values: s.values }, 'out');
}
const shown = (text: string, s = sheet()) => show(calc(text, s));
const code = (text: string, s = sheet()) => (calc(text, s) as { err: string }).err;

describe('operators', () => {
	it("follows Excel's precedence", () => {
		expect(calc('=1+2*3')).toBe(7);
		expect(calc('(1+2)*3')).toBe(9);
		expect(calc('2^3^2')).toBe(64);
		expect(calc('-2^2')).toBe(4);
		expect(calc('2*-3^2')).toBe(18);
		expect(calc('50%')).toBe(0.5);
		expect(calc('1+2&3')).toBe('33');
		expect(calc('1<2=TRUE')).toBe(true);
	});

	it('joins text with &, quoting "" as one quote', () => {
		expect(calc('"a"&"b"')).toBe('ab');
		expect(calc('1&2')).toBe('12');
		expect(calc('TRUE&""')).toBe('TRUE');
		expect(calc('"say ""hi"""')).toBe('say "hi"');
		expect(calc('1/3&""')).toBe('0.333333333333333');
	});
});

describe("Excel's quirks", () => {
	it('compares text without case', () => {
		expect(calc('"abc"="ABC"')).toBe(true);
		expect(calc('"a"<"B"')).toBe(true);
	});

	it('rounds halves away from zero', () => {
		expect(calc('ROUND(2.5, 0)')).toBe(3);
		expect(calc('ROUND(-2.5, 0)')).toBe(-3);
		expect(calc('ROUND(1.005, 2)')).toBe(1.01);
		expect(calc('ROUND(1234, -2)')).toBe(1200);
	});

	it('reads a blank as 0 in arithmetic and "" in text', () => {
		const s = sheet(['Note', 'text']);
		expect(calc('Note+1', s)).toBe(1);
		expect(calc('Note&"x"', s)).toBe('x');
		expect(calc('Note', s)).toBe(0);
		expect(calc('Note=0', s)).toBe(true);
		expect(calc('Note=""', s)).toBe(true);
	});

	it('counts TRUE as 1', () => {
		expect(calc('TRUE+1')).toBe(2);
	});

	it('reads text that is a number as one', () => {
		expect(calc('"3"+1')).toBe(4);
		expect(code('"x"+1')).toBe('#VALUE!');
	});

	it('matches numbers to 15 digits', () => {
		expect(calc('0.1+0.2=0.3')).toBe(true);
		expect(shown('0.1+0.2')).toBe('0.3');
	});

	it('gives MOD the sign of the divisor', () => {
		expect(calc('MOD(-3, 2)')).toBe(1);
		expect(calc('MOD(3, -2)')).toBe(-1);
	});

	it('skips text in a field passed to SUM, but not text typed in', () => {
		const s = sheet(['Word', 'text', 'abc'], ['Two', 'text', '2']);
		expect(calc('SUM(Word, 1)', s)).toBe(1);
		expect(calc('SUM(Two, 1)', s)).toBe(1);
		expect(code('SUM("abc", 1)', s)).toBe('#VALUE!');
		expect(calc('SUM("2", 1)', s)).toBe(3);
		expect(calc('COUNT(Two, "2")', s)).toBe(1);
	});
});

describe('errors', () => {
	it('shows each as Excel does', () => {
		expect(code('1/0')).toBe('#DIV/0!');
		expect(code('NOPE(1)')).toBe('#NAME?');
		expect(code('Nobody+1')).toBe('#NAME?');
		expect(code('1+#N/A')).toBe('#N/A');
		expect(code('AVERAGE("1")-AVERAGE(Note)', sheet(['Note', 'text']))).toBe('#DIV/0!');
	});

	it('shows #REF! for a field deleted since', () => {
		const s = sheet(['Str', 'number', 3]);
		const f: Field = { id: 'out', label: 'Out', kind: 'formula', tab: 't', box };
		f.formula = compile('Str*2', s.fields);
		expect(result({ fields: [f], values: s.values }, 'out')).toMatchObject({ err: '#REF!' });
		expect(render(f.formula, [f])).toBe('#REF!*2');
	});

	it('reports a cycle instead of overflowing', () => {
		const a: Field = { id: 'a', label: 'A', kind: 'formula', tab: 't', box, formula: '@b+1' };
		const b: Field = { id: 'b', label: 'B', kind: 'formula', tab: 't', box, formula: '@a+1' };
		const self: Field = { id: 's', label: 'S', kind: 'formula', tab: 't', box, formula: '@s' };
		const s = { fields: [a, b, self], values: {} };
		expect(result(s, 'a')).toMatchObject({ err: '#CYCLE!' });
		expect(result(s, 's')).toMatchObject({ err: '#CYCLE!' });
	});

	it('catches an error with IFERROR, and IF never runs the branch not taken', () => {
		expect(calc('IFERROR(1/0, "none")')).toBe('none');
		expect(calc('IF(TRUE, 1, 1/0)')).toBe(1);
		expect(calc('IF(FALSE, 1)')).toBe(false);
	});

	it('refuses what cannot be read, saying why', () => {
		expect(() => compile('1+', [])).toThrow(FormulaError);
		expect(() => compile('SUM(1', [])).toThrow(/expected "\)"/);
		expect(() => compile('ROUND(1)', [])).toThrow(/ROUND takes 2 arguments/);
		expect(() => compile('IFS(TRUE)', [])).toThrow(/IFS/);
		expect(() => compile('"open', [])).toThrow(/never closed/);
	});

	it('shows #ERROR! for a stored formula that cannot be read', () => {
		const f: Field = { id: 'x', label: 'X', kind: 'formula', tab: 't', box, formula: 'SUM(1' };
		expect(result({ fields: [f], values: {} }, 'x')).toMatchObject({ err: '#ERROR!' });
	});
});

describe('fields', () => {
	const s = sheet(
		['力量', 'number', 3],
		['HP', 'resource', { cur: 4, max: 10 }],
		['Scars', 'track', [true, false, true]],
		['性相', 'tags', ['拳', '欲望', '自我']],
		[
			'Talents',
			'entries',
			[
				{ name: 'Leap', text: '' },
				{ name: '', text: 'x' }
			]
		],
		['外貌 描述', 'text', 'tall'],
		['Face', 'image']
	);

	it('reads each kind', () => {
		expect(calc('力量*2', s)).toBe(6);
		expect(calc('HP', s)).toBe(4);
		expect(calc('HP.max-HP.cur', s)).toBe(6);
		expect(calc('Scars', s)).toBe(2);
		expect(calc('scars.MAX', s)).toBe(3);
		expect(calc('COUNTA(性相)', s)).toBe(3);
		expect(calc('COUNTA(Talents)', s)).toBe(1);
		expect(calc('[外貌 描述]&"!"', s)).toBe('tall!');
		expect(code('Face', s)).toBe('#VALUE!');
		expect(code('力量.max', s)).toBe('#VALUE!');
	});

	it('finds labels without case', () => {
		expect(calc('hp+1', s)).toBe(5);
	});

	it('keeps working when an input is renamed', () => {
		const stored = compile('力量+1', s.fields);
		expect(stored).toBe('@f0+1');
		const renamed = s.fields.map((f) => (f.id === 'f0' ? { ...f, label: 'Str' } : f));
		expect(render(stored, renamed)).toBe('Str+1');
		const out: Field = { id: 'o', label: 'O', kind: 'formula', tab: 't', box, formula: stored };
		expect(result({ fields: [...renamed, out], values: s.values }, 'o')).toBe(4);
	});

	it('stores ids so that a minus after one stays a minus', () => {
		const id = crypto.randomUUID();
		const t = {
			fields: [
				{ ...s.fields[0], id },
				{ ...s.fields[1], id: 'a-b' }
			],
			values: { [id]: 3 }
		};
		const stored = compile('力量-1+HP', t.fields);
		expect(stored).toBe(`@${id}-1+@{a-b}`);
		expect(calc('力量-1', t)).toBe(2);
		expect(render(stored, t.fields)).toBe('力量-1+HP');
	});

	it('brackets a label that is not one word', () => {
		expect(render(compile('[外貌 描述]', s.fields), s.fields)).toBe('[外貌 描述]');
		expect(render(compile('HP.max', s.fields), s.fields)).toBe('HP.max');
	});

	it('refuses a label two fields share', () => {
		const twins = sheet(['HP', 'number'], ['hp', 'number']);
		expect(() => compile('HP+1', twins.fields)).toThrow(/2 fields are labelled/);
	});

	it('reads a formula field from another', () => {
		const d: Field = { id: 'd', label: 'Double', kind: 'formula', tab: 't', box };
		d.formula = compile('力量*2', s.fields);
		const t = { fields: [...s.fields, d], values: s.values };
		expect(calc('Double+1', t)).toBe(7);
	});
});

describe('tables', () => {
	const lib: Field = {
		id: 'lib',
		label: '碎片库',
		kind: 'table',
		tab: 't',
		box,
		columns: [
			{ id: 'c1', name: '碎片名称', kind: 'text' },
			{ id: 'c2', name: '状态', kind: 'choice', choices: ['持有', '已献祭'] },
			{ id: 'c3', name: 'Cost', kind: 'number' }
		]
	};
	const rows: Row[] = [
		{ id: 'r1', cells: { c1: '母亲的怀表', c2: '持有', c3: 2 } },
		{ id: 'r2', cells: { c1: '旧伤', c2: '已献祭' } },
		{ id: 'r3', cells: { c2: '持有', c3: '' } }
	];
	const s = { fields: [lib], values: { lib: rows } };

	it('reads a column by name, and stores it by id', () => {
		expect(compile('COUNTA(碎片库[碎片名称])', s.fields)).toBe('COUNTA(@lib[c1])');
		expect(calc('COUNTA(碎片库[碎片名称])', s)).toBe(2);
		expect(calc('COUNTIF(碎片库[状态], "持有")', s)).toBe(2);
		expect(calc('SUM(碎片库[cost])', s)).toBe(2);
		expect(calc('XLOOKUP("旧伤", 碎片库[碎片名称], 碎片库[状态])', s)).toBe('已献祭');
	});

	it('reads the whole table as its cells, row by row', () => {
		expect(calc('COUNTA(碎片库)', s)).toBe(6);
	});

	it('keeps working when a column is renamed, and shows #REF! once it is deleted', () => {
		const stored = compile('碎片库[状态]', s.fields);
		const renamed = [
			{ ...lib, columns: lib.columns!.map((c) => (c.id === 'c2' ? { ...c, name: 'State' } : c)) }
		];
		expect(render(stored, renamed)).toBe('碎片库[State]');
		const id = crypto.randomUUID();
		const gone = compile('碎片库[x]', [{ ...lib, columns: [{ id, name: 'x', kind: 'text' }] }]);
		expect(render(gone, s.fields)).toBe('碎片库[#REF!]');
		expect(code('碎片库[nope]', s)).toBe('#REF!');
	});

	it('offers columns after a table name and a bracket', () => {
		expect(suggest('COUNTA(碎片库[状', 12, s.fields)).toEqual({ from: 10, options: ['[状态]'] });
	});
});

describe('functions', () => {
	const s = sheet(['Rolls', 'tags', ['持有', '已献祭', '持有', 'apple', 'Apricot']]);

	it('sums, averages and counts', () => {
		expect(calc('SUM(1, 2, TRUE)')).toBe(4);
		expect(calc('AVERAGE(1, 2, 6)')).toBe(3);
		expect(calc('MIN(4, 2, 8)')).toBe(2);
		expect(calc('MAX(Rolls)', s)).toBe(0);
		expect(calc('COUNT(1, "x", 2)')).toBe(2);
		expect(calc('COUNTA(1, "x", 2)')).toBe(3);
	});

	it('counts and sums by criteria', () => {
		expect(calc('COUNTIF(Rolls, "持有")', s)).toBe(2);
		expect(calc('COUNTIF(Rolls, "a*")', s)).toBe(2);
		expect(calc('COUNTIF(Rolls, "<>持有")', s)).toBe(3);
		expect(calc('COUNTIF(Rolls, "?pple")', s)).toBe(1);
		const n = sheet(['Dice', 'tags', ['1', '5', '6']]);
		expect(calc('COUNTIF(Dice, 5)', n)).toBe(1);
		expect(calc('SUMIF(Dice, "<>5", Dice)', n)).toBe(0);
	});

	it('tests with IFS, AND, OR and NOT', () => {
		expect(calc('IFS(1>2, "a", 2>1, "b")')).toBe('b');
		expect(code('IFS(FALSE, 1)')).toBe('#N/A');
		expect(calc('AND(TRUE, 1, 2>1)')).toBe(true);
		expect(calc('OR(FALSE, 0)')).toBe(false);
		expect(calc('NOT(0)')).toBe(true);
	});

	it('rounds up, down, to integers and to multiples', () => {
		expect(calc('ROUNDUP(1.21, 1)')).toBe(1.3);
		expect(calc('ROUNDDOWN(-1.29, 1)')).toBe(-1.2);
		expect(calc('INT(-1.5)')).toBe(-2);
		expect(calc('ABS(-3)')).toBe(3);
		expect(calc('FLOOR(7, 3)')).toBe(6);
		expect(calc('CEILING(7, 3)')).toBe(9);
		expect(calc('FLOOR(-2.5, 2)')).toBe(-4);
		expect(code('FLOOR(2, -1)')).toBe('#NUM!');
		expect(shown('CEILING(0.25, 0.1)')).toBe('0.3');
	});

	it('handles text', () => {
		expect(calc('LEN("吸血鬼")')).toBe(3);
		expect(calc('LEFT("abc")')).toBe('a');
		expect(calc('RIGHT("abc", 2)')).toBe('bc');
		expect(calc('MID("abcdef", 2, 3)')).toBe('bcd');
		expect(calc('UPPER("a")&LOWER("B")')).toBe('Ab');
		expect(calc('CONCAT("a", 1, TRUE)')).toBe('a1TRUE');
		expect(calc('TEXTJOIN("、", TRUE, 性相)', sheet(['性相', 'tags', ['拳', '', '自我']]))).toBe(
			'拳、自我'
		);
		expect(calc('_xlfn.CONCAT("a", "b")')).toBe('ab');
	});

	it('looks a value up', () => {
		const t = sheet(['Keys', 'tags', ['a', 'b']], ['Vals', 'tags', ['1', '2']]);
		expect(calc('XLOOKUP("B", Keys, Vals)', t)).toBe('2');
		expect(calc('XLOOKUP("z", Keys, Vals, "none")', t)).toBe('none');
		expect(code('XLOOKUP("z", Keys, Vals)', t)).toBe('#N/A');
	});

	it('takes any case and a left-out argument', () => {
		expect(calc('sum(1, 2)')).toBe(3);
		expect(calc('IF(TRUE,,1)')).toBe(0);
	});
});

describe('show', () => {
	it('shows a result as a cell would', () => {
		expect(shown('1/3')).toBe('0.3333333333');
		expect(shown('1=1')).toBe('TRUE');
		expect(shown('性相', sheet(['性相', 'tags', ['拳', '自我']]))).toBe('拳, 自我');
		expect(shown('1/0')).toBe('#DIV/0!');
	});
});

describe('suggest', () => {
	const s = sheet(['力量', 'number'], ['外貌 描述', 'text'], ['Speed', 'number']);

	it('offers labels, then functions, for the word before the caret', () => {
		expect(suggest('1+力', 3, s.fields)).toEqual({ from: 2, options: ['力量'] });
		expect(suggest('s', 1, s.fields).options).toEqual(['Speed', 'SUM(', 'SUMIF(']);
		expect(suggest('[外', 2, s.fields)).toEqual({ from: 0, options: ['[外貌 描述]'] });
	});

	it('stays quiet inside quotes and after a number', () => {
		expect(suggest('"力', 2, s.fields).options).toEqual([]);
		expect(suggest('12', 2, s.fields).options).toEqual([]);
	});
});

describe('highlight', () => {
	const s = sheet(['力量', 'number'], ['HP', 'resource']);
	const paints = (text: string) => highlight(text, s.fields).map((p) => `${p.text}:${p.paint}`);

	it('colours every piece and covers the whole text', () => {
		const text = '=SUM(力量, HP.max) & "a"';
		expect(
			highlight(text, s.fields)
				.map((p) => p.text)
				.join('')
		).toBe(text);
		expect(paints(text)).toEqual([
			'=:op',
			'SUM:fn',
			'(:paren',
			'力量:field',
			',:op',
			' :plain',
			'HP.max:field',
			'):paren',
			' :plain',
			'&:op',
			' :plain',
			'"a":str'
		]);
	});

	it('marks what this sheet does not have, and never throws on a half-typed formula', () => {
		expect(paints('Nope+NOPE(1)')).toEqual([
			'Nope:unknown',
			'+:op',
			'NOPE:unknown',
			'(:paren',
			'1:num',
			'):paren'
		]);
		expect(paints('"open')).toEqual(['"open:str']);
		expect(paints('[外 貌')).toEqual(['[外 貌:unknown']);
		expect(paints('1 ; 2')).toEqual(['1:num', ' :plain', ';:bad', ' :plain', '2:num']);
	});

	it('gives nested parentheses their depth', () => {
		const depths = highlight('((1))', []).map((p) => p.depth);
		expect(depths).toEqual([0, 1, undefined, 1, 0]);
	});
});

describe('parse', () => {
	it('takes ids, labels and an optional =', () => {
		expect(parse('=@abc-1+2')).toMatchObject({ t: 'bin', op: '+' });
		expect(parse('[a b][c]')).toEqual({ t: 'name', s: 'a b' });
	});
});
