import { VERSION, kinds, type Doc } from './doc';

export class ImportError extends Error {}

export const serialize = (doc: Doc) => JSON.stringify(doc, null, 2);

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Parses an exported document, refusing anything whose structure or references are
 * wrong instead of loading half of it. Field values are only checked to be present:
 * `valueOf` already reads a mismatched value as blank.
 */
export function parse(text: string): Doc {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new ImportError('not a JSON file');
	}
	if (!isObj(data)) throw new ImportError('not a sheet document');
	if (data.version !== VERSION) {
		throw new ImportError(
			isNum(data.version) && data.version > VERSION
				? `made by a newer version (${data.version})`
				: 'not a sheet document'
		);
	}

	const { clocks, templates, characters } = data;
	if (!Array.isArray(clocks) || !Array.isArray(templates) || !Array.isArray(characters)) {
		throw new ImportError('missing clocks, templates or characters');
	}

	const clockIds = new Set<string>();
	for (const c of clocks) {
		if (!isObj(c) || !isStr(c.id) || !isStr(c.name) || !isNum(c.now)) {
			throw new ImportError('a clock is malformed');
		}
		clockIds.add(c.id);
	}

	const templateIds = new Set<string>();
	for (const t of templates) {
		if (!isObj(t) || !isStr(t.id) || !isStr(t.name) || !Array.isArray(t.fields)) {
			throw new ImportError('a template is malformed');
		}
		for (const f of t.fields) {
			if (!isObj(f) || !isStr(f.id) || !isStr(f.label) || !kinds.includes(f.kind as never)) {
				throw new ImportError(`a field in "${t.name}" is malformed`);
			}
			// Out-of-range numbers are fine: `clamp` pulls them onto the grid on read.
			const b = f.box;
			if (b !== undefined && !(isObj(b) && [b.x, b.y, b.w, b.h].every(isNum))) {
				throw new ImportError(`"${f.label}" in "${t.name}" has a bad position`);
			}
		}
		templateIds.add(t.id);
	}

	for (const ch of characters) {
		if (!isObj(ch) || !isStr(ch.id) || !isStr(ch.name) || !isObj(ch.values)) {
			throw new ImportError('a character is malformed');
		}
		if (!isStr(ch.template) || !templateIds.has(ch.template)) {
			throw new ImportError(`"${ch.name}" uses a template that is not in the file`);
		}
		if (!Array.isArray(ch.statuses)) throw new ImportError(`"${ch.name}" has no status list`);
		for (const s of ch.statuses) {
			if (!isObj(s) || !isStr(s.id) || !isStr(s.name) || !isNum(s.since)) {
				throw new ImportError(`a status on "${ch.name}" is malformed`);
			}
			if (s.lasts !== undefined && !isNum(s.lasts)) {
				throw new ImportError(`a status on "${ch.name}" has a bad duration`);
			}
			if (!isStr(s.clock) || !clockIds.has(s.clock)) {
				throw new ImportError(`a status on "${ch.name}" runs on a clock not in the file`);
			}
		}
	}

	return data as Doc;
}
