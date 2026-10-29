import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { newCharacter, newDoc, type Doc, type Row } from '../doc';
import { apply, diff } from '../sync';
import { MAX_CALLS, addPrompt, forAgent, respond, type Event, type Step, type Turn } from './chat';
import { pictureAt, withPictures } from './pictures';
import { runTool } from './tools';

type Block = Anthropic.Beta.BetaContentBlock;
/** A reply as the API would send it, cut down to what `respond` reads. */
const reply = (stop: string, ...content: object[]) =>
	({ content: content as Block[], stop_reason: stop }) as Anthropic.Beta.BetaMessage;
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const say = (text: string) => ({ type: 'text', text });

/** A model that sends these replies in turn, telling each reply's text as it goes. */
function scripted(...replies: Anthropic.Beta.BetaMessage[]): Step {
	let i = 0;
	return async (_, onText) => {
		const r = replies[Math.min(i++, replies.length - 1)];
		for (const b of r.content) if (b.type === 'text') onText(b.text);
		return r;
	};
}

function room(): Doc {
	const doc = newDoc();
	doc.characters.push(newCharacter('Ash', doc.templates[0]));
	return doc;
}

async function run(doc: Doc, step: Step) {
	const history: Turn[] = [];
	addPrompt(history, [{ type: 'text', text: 'Add Luck.' }]);
	const events: Event[] = [];
	await respond(doc, history, step, (e) => events.push(e), true);
	return { history, events };
}

describe('respond', () => {
	it('runs the tools the model calls on the draft, then ends on its reply', async () => {
		const doc = room();
		const { history, events } = await run(
			doc,
			scripted(
				reply(
					'tool_use',
					use('a', 'add_field', { character: 'Ash', label: 'Luck', kind: 'number' })
				),
				reply('end_turn', say('Added Luck.'))
			)
		);
		expect(doc.characters[0].fields.map((f) => f.label)).toContain('Luck');
		expect(history.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
		expect(events).toEqual([
			{ t: 'tool', name: 'add_field', about: 'Luck', ok: true, text: 'Added.' },
			{ t: 'text', text: 'Added Luck.' }
		]);
	});

	it('hands a failed call back as an error for the model to fix', async () => {
		const { history } = await run(
			room(),
			scripted(
				reply(
					'tool_use',
					use('a', 'add_field', { character: 'Cid', label: 'Luck', kind: 'number' })
				),
				reply('end_turn', say('There is no Cid.'))
			)
		);
		expect(history[2].content).toEqual([
			{
				type: 'tool_result',
				tool_use_id: 'a',
				content: 'no character is called "Cid" (there are: Ash)',
				is_error: true
			}
		]);
	});

	it('never runs a call the reply was cut off in, yet answers it', async () => {
		const doc = room();
		const before = structuredClone(doc);
		const { history, events } = await run(
			doc,
			scripted(reply('max_tokens', use('a', 'add_field', { character: 'Ash', label: 'Lu' })))
		);
		expect(doc).toEqual(before);
		expect(history.at(-1)).toMatchObject({
			role: 'user',
			content: [{ tool_use_id: 'a', is_error: true }]
		});
		expect(events).toEqual([{ t: 'error', text: 'The reply ran too long and was cut off.' }]);
		// The next prompt joins that answer rather than following it.
		addPrompt(history, [{ type: 'text', text: 'Try again.' }]);
		expect(history.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
	});

	it('says so when Claude declines', async () => {
		const { events } = await run(room(), scripted(reply('refusal')));
		expect(events).toEqual([{ t: 'error', text: 'Claude declined to go on.' }]);
	});

	it('stops a model that keeps calling tools', async () => {
		const doc = room();
		const { events } = await run(doc, scripted(reply('tool_use', use('a', 'read', {}))));
		expect(events.filter((e) => e.t === 'tool' && e.ok)).toHaveLength(MAX_CALLS);
		expect(events.at(-1)).toEqual({ t: 'error', text: `Stopped after ${MAX_CALLS} tool calls.` });
	});
});

/** Ash with a face, and a table of places with a picture of one. */
function pictured(): Doc {
	const doc = room();
	const ash = doc.characters[0];
	ash.fields.push({
		id: 'p',
		label: 'Face',
		kind: 'image',
		tab: ash.tabs[0].id,
		box: { x: 0, y: 0, w: 48, h: 48 }
	});
	ash.fields.push({
		id: 't',
		label: 'Places',
		kind: 'table',
		tab: ash.tabs[0].id,
		box: { x: 0, y: 0, w: 48, h: 48 },
		columns: [
			{ id: 'n', name: 'Name', kind: 'text' },
			{ id: 'pic', name: 'Picture', kind: 'image' }
		]
	});
	ash.values.p = 'data:image/webp;base64,AAAA';
	ash.values.t = [
		{ id: 'r1', cells: { n: 'Town', pic: 'data:image/webp;base64,BBBB' } },
		{ id: 'r2', cells: { n: 'Hut' } }
	];
	return doc;
}

describe('forAgent', () => {
	it('leaves out the log and the pictures', () => {
		const doc = pictured();
		const ash = doc.characters[0];
		doc.log = [{ id: 'l', at: 0, text: 'Turn 1 → 2' }];
		const seen = forAgent(doc);
		expect(seen.log).toBeUndefined();
		expect(seen.characters[0].values.p).toBe(pictureAt(ash.id, 'p'));
		expect(seen.characters[0].values.t).toEqual([
			{ id: 'r1', cells: { n: 'Town', pic: pictureAt(ash.id, 't', 'r1', 'pic') } },
			{ id: 'r2', cells: { n: 'Hut' } }
		]);
		expect(ash.values.p).toBe('data:image/webp;base64,AAAA');
	});

	it("gives a character the chat copied the room's own pictures", () => {
		const doc = pictured();
		const base = forAgent(doc);
		const draft = structuredClone(base);
		expect(runTool(draft, 'add_character', { name: 'Ash 2', copy_of: 'Ash' }, true).ok).toBe(true);
		const landed = structuredClone(doc);
		for (const op of diff(base, draft)) apply(landed, op);
		withPictures(landed, doc);
		const copy = landed.characters.find((c) => c.name === 'Ash 2')!;
		expect(copy.values.p).toBe('data:image/webp;base64,AAAA');
		expect((copy.values.t as Row[])[0].cells.pic).toBe('data:image/webp;base64,BBBB');
	});

	it('blanks a copied picture that is gone from the room', () => {
		const doc = pictured();
		const draft = forAgent(doc);
		delete doc.characters[0].values.p;
		withPictures(draft, doc);
		expect(draft.characters[0].values.p).toBeUndefined();
		expect((draft.characters[0].values.t as Row[])[0].cells.pic).toBe(
			'data:image/webp;base64,BBBB'
		);
	});
});
