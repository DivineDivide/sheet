import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Character, Column, Entry, Field, Row } from './doc';
import { fromBook, type Imported } from './excel';
import { readBook } from './xlsx';

// A made-up card with the shapes of a real one: a free-form profile, an Excel table with
// dropdowns and a formula, and a numbered log.
const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function card(): Promise<File> {
	const wb = new ExcelJS.Workbook();
	const bold = { bold: true };
	const put = (ws: ExcelJS.Worksheet, at: string, value: ExcelJS.CellValue, b = false) => {
		if (at.includes(':')) ws.mergeCells(at);
		const cell = ws.getCell(at.split(':')[0]);
		cell.value = value;
		if (b) cell.font = bold;
	};

	const p = wb.addWorksheet('角色');
	[
		2,
		...Array(6).fill(4.83),
		1.83,
		...Array(6).fill(4.83),
		2.16,
		...Array(8).fill(4.16),
		2.16,
		...Array(8).fill(3.83)
	].forEach((w, i) => (p.getColumn(i + 1).width = w));
	put(p, 'B2:AF3', 'Test Hero', true);
	put(p, 'B5', '职业', true);
	put(p, 'D5:G5', '剑士');
	put(p, 'B6', '起源', true);
	put(p, 'D6:G6', '人类');
	put(p, 'B7', '性相', true);
	put(p, 'D7:G7', '勇气、好奇');
	put(p, 'B8:G8', '外貌', true);
	put(p, 'B9:G16', 'Tall, with green eyes.\nA scar.');
	p.mergeCells('I5:N16');
	p.addImage(wb.addImage({ base64: PNG, extension: 'png' }), {
		tl: { col: 8, row: 4 },
		ext: { width: 200, height: 240 },
		editAs: 'oneCell'
	});
	put(p, 'P5:W6', 'Abilities', true);
	put(p, 'P7:W7', 'Leap', true);
	put(p, 'P8:W11', 'Jumps far.');
	put(p, 'P12:W12', 'Dash', true);
	put(p, 'P13:W16', 'Runs.');
	put(p, 'P17:W17', 'Hide', true);
	p.mergeCells('P18:W22');
	put(p, 'Y5:AF6', '祭', true);
	put(p, 'Y7:AF7', 'A', true);
	put(p, 'Y8:AF11', 'aaa');
	put(p, 'Y12:AF12', 'B', true);
	put(p, 'Y13:AF16', 'bbb');
	put(p, 'B17:N17', '背景', true);
	put(p, 'B18:N27', 'A long story.');
	put(p, 'AH30', 'stray note');

	const lib = wb.addWorksheet('碎片库');
	put(lib, 'A1:D1', '碎片库', true);
	lib.getCell('E1').value = { formula: 'COUNTA(B3:B202)', result: 2 };
	lib.addTable({
		name: 'Lib',
		ref: 'A2',
		columns: [{ name: '类型' }, { name: '名称' }, { name: '状态' }],
		rows: [
			['物品', '怀表', '持有'],
			['记忆', '旧伤', '已献祭']
		]
	});
	for (let r = 3; r <= 10; r++) {
		lib.getCell(`A${r}`).dataValidation = { type: 'list', formulae: ['"物品,记忆"'] };
		lib.getCell(`C${r}`).dataValidation = { type: 'list', formulae: ['"持有,已献祭"'] };
	}
	put(lib, 'G1', '持有', true);
	lib.getCell('H1').value = { formula: 'COUNTIF(Lib[状态],"持有")', result: 1 };

	const log = wb.addWorksheet('经历');
	put(log, 'B2:H3', '经历', true);
	put(log, 'B5:C5', '序号', true);
	put(log, 'D5:H5', '记录', true);
	put(log, 'B6:C8', 0);
	put(log, 'D6:H8', 'first');
	put(log, 'B9:C11', 1);
	log.mergeCells('D9:H11');

	const buffer = await wb.xlsx.writeBuffer();
	return new File([buffer], 'Test Hero.xlsx');
}

const on = (c: Character, tab: string) =>
	c.fields.filter((f) => f.tab === c.tabs.find((t) => t.name === tab)!.id);
const summary = (c: Character, tab: string) => on(c, tab).map((f) => `${f.label}:${f.kind}`);
const byLabel = (c: Character, label: string) => c.fields.find((f) => f.label === label)!;

describe('importing a card', async () => {
	const { book, pictures } = await readBook(await card());
	const {
		character: c,
		left,
		checks
	}: Imported = fromBook(
		book,
		pictures.map(() => 'data:image/png;base64,x')
	);

	it('makes a tab per sheet, named from the title', () => {
		expect(c.name).toBe('Test Hero');
		expect(c.tabs.map((t) => t.name)).toEqual(['角色', '碎片库', '经历']);
	});

	it('places labels with their values, a picture, and abilities as entries', () => {
		expect(summary(c, '角色').sort()).toEqual(
			[
				'Picture:image',
				'Abilities:entries',
				'祭:entries',
				'职业:text',
				'起源:text',
				'性相:tags',
				'外貌:text',
				'背景:text'
			].sort()
		);
		expect(c.values[byLabel(c, '职业').id]).toBe('剑士');
		expect(c.values[byLabel(c, '性相').id]).toEqual(['勇气', '好奇']);
		expect(c.values[byLabel(c, '外貌').id]).toBe('Tall, with green eyes.  \nA scar.');
		expect(c.values[byLabel(c, 'Picture').id]).toBe('data:image/png;base64,x');
		expect(c.values[byLabel(c, 'Abilities').id] as Entry[]).toEqual([
			{ name: 'Leap', text: 'Jumps far.' },
			{ name: 'Dash', text: 'Runs.' },
			{ name: 'Hide', text: '' }
		]);
		expect((c.values[byLabel(c, '祭').id] as Entry[]).map((e) => e.name)).toEqual(['A', 'B']);
	});

	it('lists what it left out', () => {
		expect(left).toEqual([{ sheet: '角色', at: 'AH30', text: 'stray note' }]);
	});

	it('turns an Excel table into a table field, with dropdowns as choices', () => {
		const t = byLabel(c, '碎片库');
		expect(t.kind).toBe('table');
		expect(t.columns!.map((col: Column) => [col.name, col.kind, col.choices])).toEqual([
			['类型', 'choice', ['物品', '记忆']],
			['名称', 'text', undefined],
			['状态', 'choice', ['持有', '已献祭']]
		]);
		const rows = c.values[t.id] as Row[];
		expect(rows.map((r) => t.columns!.map((col) => r.cells[col.id]))).toEqual([
			['物品', '怀表', '持有'],
			['记忆', '旧伤', '已献祭']
		]);
	});

	it("translates formulas, and their results match Excel's", () => {
		expect(checks).toEqual([
			{
				sheet: '碎片库',
				at: 'E1',
				formula: '=COUNTA(碎片库[名称])',
				excel: '2',
				ours: '2',
				ok: true
			},
			{
				sheet: '碎片库',
				at: 'H1',
				formula: '=COUNTIF(碎片库[状态],"持有")',
				excel: '1',
				ours: '1',
				ok: true
			}
		]);
		expect(byLabel(c, '持有').kind).toBe('formula');
	});

	it('reads a numbered log under a header row as a table', () => {
		const t = byLabel(c, '经历');
		expect(t.columns!.map((col) => `${col.name}:${col.kind}`)).toEqual([
			'序号:number',
			'记录:text'
		]);
		expect((c.values[t.id] as Row[]).map((r) => Object.values(r.cells))).toEqual([
			[0, 'first'],
			[1]
		]);
	});

	it('lays fields out where they sat, without overlapping', () => {
		const overlap = (a: Field, b: Field) =>
			a.box.x < b.box.x + b.box.w &&
			b.box.x < a.box.x + a.box.w &&
			a.box.y < b.box.y + b.box.h &&
			b.box.y < a.box.y + a.box.h;
		for (const tab of c.tabs) {
			const fs = on(c, tab.name);
			for (const a of fs)
				for (const b of fs)
					if (a !== b) expect(overlap(a, b), `${a.label} / ${b.label}`).toBe(false);
		}
		expect(byLabel(c, '起源').box.y).toBeGreaterThan(byLabel(c, '职业').box.y);
		expect(byLabel(c, '祭').box.x).toBeGreaterThan(byLabel(c, 'Abilities').box.x);
	});
});

describe('a sheet with no bold at all', () => {
	it('takes short text beside a value as its label', () => {
		const sheet = {
			name: 'Sheet1',
			blocks: [
				{ at: { r0: 1, c0: 1, r1: 1, c1: 1 }, value: 'Name', bold: false },
				{ at: { r0: 1, c0: 2, r1: 1, c1: 2 }, value: 'Ash', bold: false },
				{ at: { r0: 2, c0: 1, r1: 2, c1: 1 }, value: 'HP', bold: false },
				{ at: { r0: 2, c0: 2, r1: 2, c1: 2 }, value: 10, bold: false },
				{ at: { r0: 3, c0: 1, r1: 3, c1: 1 }, value: 'Double', bold: false },
				{ at: { r0: 3, c0: 2, r1: 3, c1: 2 }, value: 20, bold: false, formula: 'B2*2' }
			],
			widths: [],
			heights: [],
			tables: [],
			lists: [],
			images: []
		};
		const { character: c, checks } = fromBook({ name: 'ash', sheets: [sheet] }, []);
		expect(c.name).toBe('ash');
		expect(c.fields.map((f) => `${f.label}:${f.kind}`)).toEqual([
			'Name:text',
			'HP:number',
			'Double:formula'
		]);
		expect(checks[0]).toMatchObject({ formula: '=HP*2', excel: '20', ours: '20', ok: true });
	});
});
