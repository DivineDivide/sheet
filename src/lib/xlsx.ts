// Reads an .xlsx with ExcelJS into the plain shape `excel.ts` maps. ExcelJS is loaded only
// when a file is picked, so play pages never download it, and the file never leaves the
// browser.

import type { CellValue, Workbook, Worksheet } from 'exceljs';
import type { Block, Book, Cell, Range, XSheet } from './excel';

// Excel measures a column in characters of its default font and a row in points.
const colPx = (w: number) => Math.round(w * 7 + 5);
const rowPx = (pt: number) => Math.round((pt * 4) / 3);

// What ExcelJS reads but its type declarations leave out or get wrong.
type Loose = {
	dataValidations: { model: Record<string, { type: string; formulae?: string[] }> };
	getTables(): { table: { name: string; tableRef: string; columns: { name: string }[] } }[];
	getImages(): {
		imageId: string;
		range: {
			tl: { nativeCol: number; nativeRow: number };
			br?: { nativeCol: number; nativeRow: number };
			ext?: { width: number; height: number };
		};
	}[];
};

const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function range(a1: string): Range {
	const [a, b = a] = a1.replace(/\$/g, '').split(':');
	const p = (s: string) => {
		const m = /^([A-Z]+)(\d+)$/.exec(s)!;
		return [+m[2], colNum(m[1])];
	};
	const [r0, c0] = p(a);
	const [r1, c1] = p(b);
	return { r0, c0, r1, c1 };
}

function plain(v: CellValue): Cell {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	if ('richText' in v) return v.richText.map((t) => t.text).join('');
	if ('error' in v) return v.error;
	// A formula's value is the result Excel saved with it.
	if ('formula' in v || 'sharedFormula' in v) return plain((v.result ?? null) as CellValue);
	if ('text' in v) return plain(v.text as CellValue);
	return null;
}

export async function readBook(file: File): Promise<{ book: Book; pictures: Blob[] }> {
	const { Workbook } = (await import('exceljs')).default;
	const wb = new Workbook();
	await wb.xlsx.load(await file.arrayBuffer());
	const pictures: Blob[] = [];
	const sheets = wb.worksheets
		.filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden')
		.map((ws) => sheetOf(wb, ws, pictures));
	return { book: { name: file.name.replace(/\.xlsx$/i, ''), sheets }, pictures };
}

function sheetOf(wb: Workbook, ws: Worksheet, pictures: Blob[]): XSheet {
	const loose = ws as unknown as Loose;
	const merges = (ws.model.merges ?? []).map((m) => range(String(m)));
	const covered = new Set<string>();
	for (const m of merges)
		for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) covered.add(`${r},${c}`);

	const block = (at: Range): Block => {
		const cell = ws.getCell(at.r0, at.c0);
		return {
			at,
			value: plain(cell.value),
			bold: !!cell.font?.bold,
			...(cell.formula && { formula: cell.formula })
		};
	};
	const blocks = merges.map(block);
	ws.eachRow((row, r) =>
		row.eachCell((_, c) => {
			if (covered.has(`${r},${c}`)) return;
			const b = block({ r0: r, c0: c, r1: r, c1: c });
			if ((b.value !== null && b.value !== '') || b.formula) blocks.push(b);
		})
	);

	const raw = loose.getImages().map((img) => {
		const media = wb.getImage(Number(img.imageId));
		const type = media.extension === 'jpeg' ? 'image/jpeg' : `image/${media.extension}`;
		pictures.push(new Blob([media.buffer as unknown as BlobPart], { type }));
		const { tl, br, ext } = img.range;
		const at = { r: Math.floor(tl.nativeRow) + 1, c: Math.floor(tl.nativeCol) + 1 };
		return { ...at, br, ext, picture: pictures.length - 1 };
	});

	const lastR = Math.max(1, ...blocks.map((b) => b.at.r1), ...raw.map((i) => i.r));
	const lastC = Math.max(1, ...blocks.map((b) => b.at.c1), ...raw.map((i) => i.c));
	const widths: number[] = [];
	const heights: number[] = [];
	const dw = ws.properties.defaultColWidth ?? 8.43;
	const dh = ws.properties.defaultRowHeight ?? 15;
	for (let c = 1; c <= lastC + 8; c++) {
		const col = ws.getColumn(c);
		widths[c] = col.hidden ? 0 : colPx(col.width ?? dw);
	}
	for (let r = 1; r <= lastR + 20; r++) {
		const row = ws.getRow(r);
		heights[r] = row.hidden ? 0 : rowPx(row.height ?? dh);
	}

	// A picture saved without its size spans to the cell its bottom-right corner is in.
	const span = (from: number, to: number, sizes: number[]) =>
		sizes.slice(from, to).reduce((a, b) => a + (b ?? 0), 0);
	const images = raw.map(({ r, c, br, ext, picture }) => ({
		r,
		c,
		picture,
		w: ext?.width ?? (br ? span(c, Math.floor(br.nativeCol) + 1, widths) : 0),
		h: ext?.height ?? (br ? span(r, Math.floor(br.nativeRow) + 1, heights) : 0)
	}));

	const tables = loose.getTables().map(({ table: t }) => ({
		name: t.name,
		at: range(t.tableRef),
		columns: t.columns.map((c) => c.name)
	}));

	return { name: ws.name, blocks, widths, heights, tables, lists: lists(wb, loose), images };
}

/** Dropdown lists, typed out or taken from cells, with runs down a column joined up. */
function lists(wb: Workbook, ws: Loose): XSheet['lists'] {
	const out: XSheet['lists'] = [];
	for (const [where, dv] of Object.entries(ws.dataValidations.model)) {
		if (dv.type !== 'list' || !dv.formulae?.[0]) continue;
		const f = String(dv.formulae[0]);
		let choices: string[] | undefined;
		const typed = /^"([\s\S]*)"$/.exec(f);
		if (typed) choices = typed[1].split(',').map((s) => s.trim());
		const ref = !typed && /^(?:'?([^'!]+)'?!)?(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/.exec(f);
		if (ref) {
			const from = ref[1] ? wb.getWorksheet(ref[1]) : (ws as unknown as Worksheet);
			const at = range(ref[2]);
			choices = [];
			for (let r = at.r0; r <= at.r1; r++)
				for (let c = at.c0; c <= at.c1; c++) {
					const t = from?.getCell(r, c).text.trim();
					if (t) choices.push(t);
				}
		}
		if (!choices?.length) continue;
		for (const part of where.split(/\s+/)) {
			const at = range(part);
			const prev = out.at(-1);
			if (
				prev &&
				prev.at.c0 === at.c0 &&
				prev.at.c1 === at.c1 &&
				prev.at.r1 + 1 === at.r0 &&
				prev.choices.join('\n') === choices.join('\n')
			)
				prev.at = { ...prev.at, r1: at.r1 };
			else out.push({ at, choices });
		}
	}
	return out;
}
