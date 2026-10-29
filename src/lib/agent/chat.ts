// One prompt of the chat: the model and the draft tools taking turns until it replies.

import type Anthropic from '@anthropic-ai/sdk';
import type { Doc, Row } from '../doc';
import type { Op } from '../sync';
import { pictureAt } from './pictures';
import { runTool } from './tools';

type Reply = Anthropic.Beta.BetaMessage;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;
export type Turn = Anthropic.Beta.BetaMessageParam;

/** What the asker sees while the model works: its reply as written, and each tool call. */
export type Event =
	| { t: 'text'; text: string }
	| { t: 'tool'; name: string; about: string; ok: boolean; text: string }
	| { t: 'error'; text: string };

/** A line of the chat's answer, as the browser reads it: `done` carries the draft's changes. */
export type Line = Event | { t: 'start'; chat: string } | { t: 'done'; ops: Op[] };

/** One request with the conversation so far; the reply's text is told as it comes. */
export type Step = (history: Turn[], onText: (text: string) => void) => Promise<Reply>;

/**
 * The room as the chat gets it: without its log, and with each picture a placeholder that
 * names where it is, so a copy in the draft gets the picture back (`withPictures`).
 */
export function forAgent(doc: Doc): Doc {
	const { log: _, ...rest } = structuredClone(doc);
	for (const c of rest.characters)
		for (const f of c.fields) {
			if (f.kind === 'image' && c.values[f.id]) c.values[f.id] = pictureAt(c.id, f.id);
			const pics = f.kind === 'table' ? (f.columns ?? []).filter((x) => x.kind === 'image') : [];
			if (!pics.length || !Array.isArray(c.values[f.id])) continue;
			for (const row of c.values[f.id] as Row[])
				for (const col of pics)
					if (row.cells[col.id]) row.cells[col.id] = pictureAt(c.id, f.id, row.id, col.id);
		}
	return rest;
}

/** A runaway guard, not a budget: a model that keeps calling tools is stopped. */
export const MAX_CALLS = 50;

/**
 * Adds the asker's words to the conversation. A turn that failed before the model answered
 * leaves the history ending with the asker's side, which the new words join.
 */
export function addPrompt(history: Turn[], blocks: Anthropic.Beta.BetaTextBlockParam[]) {
	const last = history.at(-1);
	if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(...blocks);
	else history.push({ role: 'user', content: blocks });
}

/** What a tool call is about, for its progress line: the label or name it was given. */
const about = (input: unknown) => {
	const i = (input ?? {}) as Record<string, unknown>;
	const v = [i.label, i.field, i.table, i.target, i.character, i.name, i.template].find(
		(x) => typeof x === 'string'
	);
	return typeof v === 'string' ? v : '';
};

/**
 * Runs the model on `history` until it replies without a tool call, changing `draft` as it
 * asks. History is only ever appended to: each reply goes in whole, thinking included.
 */
export async function respond(
	draft: Doc,
	history: Turn[],
	step: Step,
	emit: (e: Event) => void,
	gm: boolean
): Promise<void> {
	let calls = 0;
	// A few more rounds than calls, so a model told to stop can still reply.
	for (let round = 0; round < MAX_CALLS + 3; round++) {
		const reply = await step(history, (text) => emit({ t: 'text', text }));
		history.push({ role: 'assistant', content: reply.content });
		const uses = reply.content.filter((b): b is ToolUse => b.type === 'tool_use');
		// A refused or cut-off reply can end in a half-written call: never run those.
		const whole = reply.stop_reason === 'tool_use';
		if (uses.length)
			history.push({
				role: 'user',
				content: uses.map((u) => {
					const out = !whole
						? { ok: false, text: 'Not run: the reply stopped before this call was whole.' }
						: ++calls > MAX_CALLS
							? { ok: false, text: `This prompt has used its ${MAX_CALLS} tool calls; reply now.` }
							: runTool(draft, u.name, u.input, gm);
					if (whole) {
						const text = out.text.split('\n')[0];
						emit({ t: 'tool', name: u.name, about: about(u.input), ok: out.ok, text });
					}
					return {
						type: 'tool_result' as const,
						tool_use_id: u.id,
						content: out.text,
						...(!out.ok && { is_error: true })
					};
				})
			});
		if (whole && uses.length) continue;
		if (reply.stop_reason === 'refusal') emit({ t: 'error', text: 'Claude declined to go on.' });
		if (reply.stop_reason === 'max_tokens')
			emit({ t: 'error', text: 'The reply ran too long and was cut off.' });
		return;
	}
	emit({ t: 'error', text: `Stopped after ${MAX_CALLS} tool calls.` });
}
