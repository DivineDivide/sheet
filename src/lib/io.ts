import { VERSION, columnKinds, kinds, type Doc } from './doc';
import { isChange } from './sync';
import { migrate, type V1Doc } from './v1';
import { upgrade, type V2Doc } from './v2';

export class ImportError extends Error {}

export const serialize = (doc: Doc) => JSON.stringify(doc, null, 2);

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBox = (b: unknown) => isObj(b) && [b.x, b.y, b.w, b.h].every(isNum);
const okRule = (r: unknown) =>
	isObj(r) &&
	isStr(r.id) &&
	isObj(r.when) &&
	(isStr(r.when.press) || isStr(r.when.tick)) &&
	(r.if === undefined || isStr(r.if)) &&
	Array.isArray(r.then) &&
	r.then.every(isStr);
/** Rules are only checked for shape: one naming a deleted button or clock never fires. */
const okRules = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(okRule));

/**
 * Parses an exported document, refusing anything whose structure or references are
 * wrong instead of loading half of it. Older files are checked as they were written,
 * then migrated. Field values are only checked to be present: `valueOf` already reads a
 * mismatched value as blank.
 */
export function parse(text: string): Doc {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new ImportError('not a JSON file');
	}
	return validate(data);
}

/** `parse` after JSON: what a room runs over its doc after every change. */
export function validate(data: unknown): Doc {
	if (!isObj(data)) throw new ImportError('not a sheet document');
	if (data.version === 1) return upgrade(migrate(checkV1(data)));
	if (data.version !== 2 && data.version !== VERSION) {
		throw new ImportError(
			isNum(data.version) && data.version > VERSION
				? `made by a newer version (${data.version})`
				: 'not a sheet document'
		);
	}

	const { templates, characters } = data;
	const clockIds = checkClocks(data);
	if (!Array.isArray(templates) || !Array.isArray(characters)) {
		throw new ImportError('missing templates or characters');
	}
	for (const t of templates) {
		if (!isObj(t) || !isStr(t.id) || !isStr(t.name)) {
			throw new ImportError('a template is malformed');
		}
		checkLayout(t, `template "${t.name}"`);
	}
	for (const ch of characters) {
		if (
			!isObj(ch) ||
			!isStr(ch.id) ||
			!isStr(ch.name) ||
			!isObj(ch.values) ||
			(ch.hidden !== undefined && ch.hidden !== true)
		) {
			throw new ImportError('a character is malformed');
		}
		checkLayout(ch, `"${ch.name}"`);
		if (data.version === 2) checkStatuses(ch, clockIds);
	}
	checkLog(data);
	return data.version === 2 ? upgrade(data as unknown as V2Doc) : (data as Doc);
}

function checkLog(data: Record<string, unknown>) {
	if (data.log === undefined) return;
	const ok =
		Array.isArray(data.log) &&
		data.log.every(
			(l) =>
				isObj(l) &&
				isStr(l.id) &&
				isNum(l.at) &&
				isStr(l.text) &&
				(l.tick === undefined ||
					(isObj(l.tick) &&
						isStr(l.tick.clock) &&
						isNum(l.tick.to) &&
						isChange({ id: l.id, ops: l.tick.ops }) &&
						isChange({ id: l.id, ops: l.tick.undo })))
		);
	if (!ok) throw new ImportError('the log is malformed');
}

function checkClocks(data: Record<string, unknown>): Set<string> {
	if (!Array.isArray(data.clocks)) throw new ImportError('missing clocks');
	const ids = new Set<string>();
	for (const c of data.clocks) {
		if (!isObj(c) || !isStr(c.id) || !isStr(c.name) || !isNum(c.now)) {
			throw new ImportError('a clock is malformed');
		}
		ids.add(c.id);
	}
	return ids;
}

function checkLayout(owner: Record<string, unknown>, name: string) {
	const { tabs, fields } = owner;
	if (!Array.isArray(tabs) || !tabs.length || !Array.isArray(fields)) {
		throw new ImportError(`${name} has no tabs or fields`);
	}
	const tabIds = new Set<string>();
	for (const t of tabs) {
		if (!isObj(t) || !isStr(t.id) || !isStr(t.name))
			throw new ImportError(`a tab on ${name} is malformed`);
		tabIds.add(t.id);
	}
	for (const f of fields) {
		if (!isObj(f) || !isStr(f.id) || !isStr(f.label) || !kinds.includes(f.kind as never)) {
			throw new ImportError(`a field on ${name} is malformed`);
		}
		// Out-of-range numbers are fine: `clamp` pulls them back onto the sheet when moved.
		if (!isBox(f.box)) throw new ImportError(`"${f.label}" on ${name} has a bad position`);
		if (!isStr(f.tab) || !tabIds.has(f.tab)) {
			throw new ImportError(`"${f.label}" on ${name} sits on a tab that is not there`);
		}
		if (f.formula !== undefined && !isStr(f.formula)) {
			throw new ImportError(`"${f.label}" on ${name} has a formula that is not text`);
		}
		const okColumn = (c: unknown) =>
			isObj(c) &&
			isStr(c.id) &&
			isStr(c.name) &&
			columnKinds.includes(c.kind as never) &&
			(c.choices === undefined || (Array.isArray(c.choices) && c.choices.every(isStr))) &&
			(c.from === undefined || isStr(c.from)) &&
			(c.formula === undefined || isStr(c.formula)) &&
			(c.bar === undefined || c.bar === true) &&
			(c.box === undefined || isBox(c.box)) &&
			(c.hideLabel === undefined || c.hideLabel === true) &&
			okRules(c.rules);
		if (f.columns !== undefined && !(Array.isArray(f.columns) && f.columns.every(okColumn))) {
			throw new ImportError(`"${f.label}" on ${name} has malformed columns`);
		}
		if (!okRules(f.rules)) throw new ImportError(`"${f.label}" on ${name} has malformed rules`);
		if (f.from !== undefined && !isStr(f.from)) {
			throw new ImportError(`"${f.label}" on ${name} names its source table wrongly`);
		}
		if (f.choices !== undefined && !(Array.isArray(f.choices) && f.choices.every(isStr))) {
			throw new ImportError(`"${f.label}" on ${name} has choices that are not all text`);
		}
		if (f.parents !== undefined && !(isObj(f.parents) && Object.values(f.parents).every(isStr))) {
			throw new ImportError(`"${f.label}" on ${name} has a malformed tree`);
		}
		if (f.follows !== undefined && !isStr(f.follows)) {
			throw new ImportError(`"${f.label}" on ${name} names the map it follows wrongly`);
		}
		if (f.pages !== undefined && f.pages !== true) {
			throw new ImportError(`"${f.label}" on ${name} says wrongly whether it has pages`);
		}
		if (f.cards !== undefined && f.cards !== true) {
			throw new ImportError(`"${f.label}" on ${name} says wrongly whether it shows as cards`);
		}
		if (f.hideLabel !== undefined && f.hideLabel !== true) {
			throw new ImportError(`"${f.label}" on ${name} says wrongly whether its label shows`);
		}
		if (f.bar !== undefined && f.bar !== true) {
			throw new ImportError(`"${f.label}" on ${name} says wrongly whether it shows as a bar`);
		}
		if (f.bind !== undefined && !isStr(f.bind)) {
			throw new ImportError(`"${f.label}" on ${name} names wrongly what it is bound with`);
		}
	}
}

function checkStatuses(ch: Record<string, unknown>, clockIds: Set<string>) {
	if (!Array.isArray(ch.statuses)) throw new ImportError(`"${ch.name}" has no status list`);
	for (const s of ch.statuses) {
		if (!isObj(s) || !isStr(s.id) || !isStr(s.name) || !isNum(s.since)) {
			throw new ImportError(`a status on "${ch.name}" is malformed`);
		}
		if (s.lasts !== undefined && !isNum(s.lasts)) {
			throw new ImportError(`a status on "${ch.name}" has a bad duration`);
		}
		if (
			(s.stacks !== undefined && !isNum(s.stacks)) ||
			(s.preset !== undefined && !isStr(s.preset)) ||
			!okRules(s.rules)
		) {
			throw new ImportError(`a status on "${ch.name}" is malformed`);
		}
		if (!isStr(s.clock) || !clockIds.has(s.clock)) {
			throw new ImportError(`a status on "${ch.name}" runs on a clock not in the file`);
		}
	}
}

function checkV1(data: Record<string, unknown>): V1Doc {
	const { templates, characters } = data;
	const clockIds = checkClocks(data);
	if (!Array.isArray(templates) || !Array.isArray(characters)) {
		throw new ImportError('missing templates or characters');
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
			if (f.box !== undefined && !isBox(f.box)) {
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
		checkStatuses(ch, clockIds);
	}
	return data as unknown as V1Doc;
}
