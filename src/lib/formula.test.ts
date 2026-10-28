import { describe, expect, it } from 'vitest';
import { blank, type Field, type Kind, type Row, type Value } from './doc';
import {
	FormulaError,
	cellResult,
	compile,
	compileLine,
	evaluate,
	highlight,
	names,
	parse,
	parseLine,
	render,
	result,
	rowNames,
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

describe('columns of every kind, worked out row by row', () => {
	const gear: Field = {
		id: 'gear',
		label: 'Gear',
		kind: 'table',
		tab: 't',
		box,
		columns: [
			{ id: 'cost', name: 'Cost', kind: 'number' },
			{ id: 'uses', name: 'Uses', kind: 'resource' },
			{ id: 'marks', name: 'Marks', kind: 'track' },
			{ id: 'tags', name: 'Tags', kind: 'tags' },
			{ id: 'go', name: 'Go', kind: 'button' },
			{ id: 'twice', name: 'Twice', kind: 'formula' }
		]
	};
	const bonus: Field = { id: 'bonus', label: 'Bonus', kind: 'number', tab: 't', box };
	const cost: Field = { id: 'costf', label: 'Cost', kind: 'number', tab: 't', box };
	const rows: Row[] = [
		{
			id: 'a',
			cells: { cost: 3, uses: { cur: 1, max: 2 }, marks: [true, false], tags: ['x', 'y'] }
		},
		{ id: 'b', cells: { cost: 5 } }
	];
	const s = { fields: [gear, bonus, cost], values: { gear: rows, bonus: 10, costf: 100 } };
	const known = [...rowNames(gear), ...s.fields];
	const twice = (formula: string) => {
		gear.columns![5].formula = compile(formula, known);
		return [cellResult(s, 'gear', 'twice', 'a'), cellResult(s, 'gear', 'twice', 'b')];
	};

	it("reads its own row's cells first, by name or as [@Column]", () => {
		expect(compile('Cost * 2 + Bonus', known)).toBe('@cost * 2 + @bonus');
		expect(twice('Cost * 2 + Bonus')).toEqual([16, 20]);
		expect(twice('[@Cost] + Uses + Uses.max + Marks + Marks.max')).toEqual([9, 29]);
		expect(render(gear.columns![5].formula!, known)).toBe(
			'Cost + Uses + Uses.max + Marks + Marks.max'
		);
	});

	it('reads a whole column, formulas worked out', () => {
		twice('Cost * 2');
		const out: Field = { id: 'o', label: 'O', kind: 'formula', tab: 't', box };
		out.formula = compile(
			'SUM(Gear[Twice]) & "/" & COUNTA(Gear[Tags]) & "/" & SUM(Gear[Uses])',
			s.fields
		);
		expect(result({ ...s, fields: [...s.fields, out] }, 'o')).toBe('16/1/11');
	});

	it('says when a column reaches itself', () => {
		expect(show(twice('Twice + 1')[0])).toBe('#CYCLE!');
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
		expect(calc('REPT("x.", 2.9)')).toBe('x.x.');
		expect(calc('LEFT(REPT(".x", 50), 5)')).toBe('.x.x.');
		expect(code('REPT("a", -1)')).toBe('#VALUE!');
		expect(code('REPT("ab", 20000)')).toBe('#VALUE!');
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
		expect(parse('[a b][c]')).toEqual({ t: 'name', s: 'a b', col: 'c' });
	});
});

describe('what rules add', () => {
	const s = sheet(
		['HP', 'resource', { cur: 5, max: 8 }],
		['Odds', 'formula'],
		['Notes', 'text'],
		['Wait', 'track', [true, false, true]],
		['Marks', 'tags', ['Poisoned']]
	);
	const turn = { id: 'k', name: 'Turn', now: 3 };
	const statuses: Field = {
		id: 'st',
		label: 'Statuses',
		kind: 'table',
		tab: 't',
		box,
		columns: [
			{ id: 'n', name: 'Name', kind: 'text' },
			{ id: 'x', name: 'Stacks', kind: 'number' }
		]
	};
	const rows = [
		{ id: 'a', cells: { n: 'Poison', x: 4 } },
		{ id: 'b', cells: { n: 'Stun', x: 9 } }
	];
	const all = {
		fields: [...s.fields, statuses],
		values: { ...s.values, st: rows },
		clocks: [turn]
	};
	const known = names(all);

	it('reads clocks by name, and a status from its table', () => {
		const stored = compile('Turn * 10 + SUMIF(Statuses[Name], "Poison", Statuses[Stacks])', known);
		expect(stored).toBe('@k * 10 + SUMIF(@st[n], "Poison", @st[x])');
		const out = { ...s.fields[1], formula: stored };
		const fields = [s.fields[0], out, s.fields[2], statuses];
		expect(result({ ...all, fields }, out.id)).toBe(34);
		expect(result({ ...all, fields: [{ ...out, formula: 'Poison' }] }, out.id)).toMatchObject({
			err: '#NAME?'
		});
	});

	it("reads a track's boxes as x and .", () => {
		expect(calc('Wait.boxes & "/" & Wait & "/" & Wait.max', s)).toBe('x.x/2/3');
	});

	it('rolls dice only in rules', () => {
		expect(code('1d6+1')).toBe('#VALUE!');
		const faces = [2, 5];
		expect(evaluate(parse('2d6+1'), s, () => faces.shift()!)).toBe(8);
		expect(highlight('2d6', []).map((p) => p.paint)).toEqual(['num']);
	});

	it('reads a line: what it changes, then =, += or -=', () => {
		expect(parseLine('HP -= 1d6')).toMatchObject({ target: { t: 'name', s: 'HP' }, op: '-=' });
		expect(compileLine('HP.max += 2', known)).toBe('@f0.max += 2');
		expect(() => parseLine('HP - = 1')).toThrow(/expected =, \+= or -=/);
		expect(() => compileLine('Odds = 1', known)).toThrow(/can't be changed/);
		expect(() => compileLine('Notes += "x"', known)).toThrow(/takes only =/);
		expect(compileLine('Wait.boxes = "x.x."', known)).toBe('@f3.boxes = "x.x."');
		expect(() => compileLine('Wait.boxes += "x"', known)).toThrow(/only = for its .boxes/);
		expect(compileLine('Marks -= "Poisoned"', known)).toBe('@f4 -= "Poisoned"');
		expect(() => compileLine('Marks.max = 1', known)).toThrow(/has no .max/);
		expect(() => compileLine('Turn += 1', known)).toThrow(/presses Next/);
		expect(() => compileLine('Nobody = 1', known)).toThrow(/nothing is called/);
	});
});

describe('another character, as Name!Label', () => {
	const col = (id: string, name: string) => ({ id, name, kind: 'text' as const });
	/** Bea's own sheet, and a GM-only character whose Weapons table and Bonus she reads. */
	function room() {
		const gm = {
			id: 'gm',
			name: 'GM',
			fields: [
				{
					id: 'weapons',
					label: 'Weapons',
					kind: 'table' as const,
					tab: 't',
					box,
					columns: [col('wn', 'Name'), col('wd', 'Damage')]
				},
				{ id: 'base', label: 'Base', kind: 'number' as const, tab: 't', box },
				{
					id: 'bonus',
					label: 'Bonus',
					kind: 'formula' as const,
					tab: 't',
					box,
					formula: '@base * 2'
				}
			],
			values: {
				weapons: [
					{ id: 'r1', cells: { wn: 'Longsword', wd: '1d8' } },
					{ id: 'r2', cells: { wn: 'Dagger', wd: '1d4' } }
				],
				base: 3
			}
		};
		const bea = { id: 'bea', name: 'Bea Lee', ...sheet(['Weapons', 'number', 1]) };
		const s = { ...bea, others: [gm, bea] };
		return { s, gm, bea, known: names(s) };
	}
	/** A formula's result on Bea's sheet, the room's other characters with it. */
	function calcIn(text: string) {
		const { s, known } = room();
		const out: Field = { id: 'out', label: 'Out', kind: 'formula', tab: 't', box };
		out.formula = compile(text, known);
		return result({ ...s, fields: [...s.fields, out] }, 'out');
	}

	it('stores another character by id, and shows it by its name and label again', () => {
		const { known } = room();
		const stored = compile('XLOOKUP("Dagger", GM!Weapons[Name], gm!weapons[Damage])', known);
		expect(stored).toBe('XLOOKUP("Dagger", @{gm!weapons}[wn], @{gm!weapons}[wd])');
		expect(render(stored, known)).toBe('XLOOKUP("Dagger", GM!Weapons[Name], GM!Weapons[Damage])');
		expect(compile('Weapons + 1', known)).toBe('@f0 + 1');
	});

	it("reads another character's table and formulas, each worked out on its own sheet", () => {
		expect(calcIn('XLOOKUP("Dagger", GM!Weapons[Name], GM!Weapons[Damage])')).toBe('1d4');
		expect(calcIn('GM!Bonus + Weapons')).toBe(7);
		expect(calcIn('[Nobody]!HP')).toMatchObject({ err: '#NAME?' });
	});

	it('lets a character name its own field as Name!Label too, as Excel names its own sheet', () => {
		const { gm, bea } = room();
		const s = { ...gm, others: [gm, bea] };
		const known = names(s);
		const twice: Field = { id: 'twice', label: 'Twice', kind: 'formula', tab: 't', box };
		twice.formula = compile('GM!Base * 2', known);
		expect(twice.formula).toBe('@{gm!base} * 2');
		expect(render(twice.formula, known)).toBe('GM!Base * 2');
		expect(result({ ...s, fields: [...s.fields, twice] }, 'twice')).toBe(6);
	});

	it('names a character of more than one word in brackets', () => {
		const { gm, bea } = room();
		const known = names({ ...gm, others: [gm, bea] });
		expect(render(compile('[Bea Lee]!Weapons * 2', known), known)).toBe('[Bea Lee]!Weapons * 2');
	});

	it('lets a rule read another character but never change it', () => {
		const { known } = room();
		expect(() => compileLine('GM!Base -= 1', known)).toThrow('another character');
		expect(compileLine('Weapons = GM!Base', known)).toBe('@f0 = @{gm!base}');
	});

	it('tells apart characters made from one template, whose fields share ids', () => {
		const made = (id: string, name: string, hp: number) => ({
			id,
			name,
			...sheet(['HP', 'number', hp], ['Half', 'formula'])
		});
		const ash = made('ash', 'Ash', 10);
		const bea = made('bea', 'Bea', 20);
		const room = [ash, bea];
		bea.fields[1].formula = '@f0 / 2';
		const known = names({ ...ash, others: room });
		ash.fields[1].formula = compile('Bea!Half + HP', known);
		expect(ash.fields[1].formula).toBe('@{bea!f1} + @f0');
		expect(render(ash.fields[1].formula, known)).toBe('Bea!Half + HP');
		expect(result({ ...ash, others: room }, 'f1')).toBe(20);
	});

	it('colours and completes the labels after Name!', () => {
		const { known } = room();
		expect(highlight('GM!Bonus + GM!Nope', known).map((p) => p.paint)).toEqual([
			'field',
			'plain',
			'op',
			'plain',
			'unknown'
		]);
		expect(suggest('GM!Bo', 5, known).options).toEqual(['Bonus']);
		expect(suggest('GM!Weapons[Da', 13, known).options).toEqual(['[Damage]']);
		expect(suggest('G', 1, known).options).toContain('GM!Weapons');
	});
});
