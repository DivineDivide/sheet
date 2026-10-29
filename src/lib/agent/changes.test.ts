import { describe, expect, it } from 'vitest';
import { newDoc } from '../doc';
import { diff } from '../sync';
import { changes } from './changes';
import { runTool } from './tools';

function room() {
	const doc = newDoc();
	runTool(doc, 'add_character', { name: 'Ash', template: 'Basic' }, true);
	return doc;
}

describe('changes', () => {
	it("names what a draft adds, changes and removes, and outlines what's still there", () => {
		const base = room();
		const draft = structuredClone(base);
		const hp = draft.characters[0].fields.find((f) => f.label === 'HP')!;
		const gone = draft.characters[0].fields.find((f) => f.label !== 'HP')!;
		for (const [name, input] of [
			['add_field', { character: 'Ash', label: 'Luck', kind: 'number' }],
			['set_value', { character: 'Ash', field: 'HP', value: { cur: 3, max: 10 } }],
			['remove_field', { character: 'Ash', field: gone.label }],
			['add_character', { name: 'Bea' }],
			['edit_clocks', { add: ['Round'] }]
		] as const) {
			expect(runTool(draft, name, input, true)).toMatchObject({ ok: true });
		}
		const luck = draft.characters[0].fields.find((f) => f.label === 'Luck')!;
		const { lines, fields } = changes(base, diff(base, draft));
		expect(lines).toEqual([
			'New clock Round',
			'New character Bea',
			`Ash: added Luck; changed HP; removed ${gone.label}`
		]);
		expect([...fields].sort()).toEqual([luck.id, hp.id].sort());
	});

	it('says which fields lie on top changed', () => {
		const base = room();
		const draft = structuredClone(base);
		draft.characters[0].fields.reverse();
		expect(changes(base, diff(base, draft)).lines).toEqual([
			"Changed which of Ash's fields lie on top"
		]);
	});

	it('says a character was renamed, and a template saved', () => {
		const base = room();
		const draft = structuredClone(base);
		runTool(draft, 'edit_character', { character: 'Ash', rename: 'Ashe' }, true);
		runTool(draft, 'save_template', { character: 'Ashe', name: 'Hero' }, true);
		expect(changes(base, diff(base, draft)).lines).toEqual([
			'New template Hero',
			'Renamed Ash to Ashe'
		]);
	});
});
