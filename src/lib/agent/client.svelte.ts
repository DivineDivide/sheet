// The chat beside the sheet, in the browser: what was said, and the draft it made, which
// the session shows in place of the room until it is applied or discarded.

import type { Doc } from '../doc';
import { t } from '../i18n.svelte';
import { mod } from '../keys';
import { session } from '../session.svelte';
import { changes } from './changes';
import type { Line } from './chat';

export const models = [
	{ id: 'opus', name: 'Claude Opus 5.5' },
	{ id: 'sonnet', name: 'Claude Sonnet 5.5' }
] as const;
export type ModelId = (typeof models)[number]['id'];

export type Said =
	| { who: 'you'; text: string }
	| {
			who: 'claude';
			text: string;
			tools: { name: string; about: string; ok: boolean; text: string }[];
			error?: string;
	  }
	| { who: 'note'; text: string };

let said = $state<Said[]>([]);
let model = $state<ModelId>('opus');
let busy = $state(false);
/** Sent to the GM and not yet answered. */
let waiting = $state<string | null>(null);
let chatId = $state<string | null>(null);
/** This chat's prompts, for the GM to read beside its changes. */
let asked: string[] = [];
const changed = $derived(
	session.draft && changes($state.snapshot(session.room) as Doc, session.draft)
);

const note = (text: string) => said.push({ who: 'note', text });

/** A GM's page asks as a GM, through `/gm`; a player's chat sees no GM-only character. */
const agentUrl = () => `${session.gm ? '/gm' : ''}/api/rooms/${session.token}/agent`;

/** The server keeps a chat for a day; once settled it is dropped at once. */
function forget() {
	if (chatId) fetch(`${agentUrl()}/${chatId}`, { method: 'DELETE' }).catch(() => {});
	chatId = null;
	asked = [];
	session.draft = null;
}

session.onSettled = (id, ok) => {
	if (id !== waiting) return;
	waiting = null;
	if (ok) {
		forget();
		note(t('The GM applied the draft.'));
	} else {
		note(t('The GM turned the draft down. Change it and send it again, or discard it.'));
	}
};

async function ask(prompt: string) {
	said.push({ who: 'you', text: prompt });
	said.push({ who: 'claude', text: '', tools: [] });
	const reply = said.at(-1) as Extract<Said, { who: 'claude' }>;
	asked.push(prompt);
	busy = true;
	const take = (l: Line) => {
		if (l.t === 'start') chatId = l.chat;
		else if (l.t === 'text') reply.text += l.text;
		else if (l.t === 'tool') {
			reply.tools.push(l);
			// What it says after a call is a new paragraph, not the end of the last sentence.
			if (reply.text && !reply.text.endsWith('\n\n')) reply.text += '\n\n';
		} else if (l.t === 'error') reply.error = l.text;
		else if (l.t === 'done') session.draft = l.ops.length ? l.ops : null;
	};
	try {
		const res = await fetch(agentUrl(), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ chat: chatId, prompt, model })
		});
		if (!res.ok || !res.body) {
			const body = await res.json().catch(() => ({}));
			reply.error = body.error ?? t('The server answered {status}.', { status: res.status });
			return;
		}
		const lines = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let buf = '';
		for (;;) {
			const { value, done } = await lines.read();
			if (done) break;
			buf += value;
			for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
				take(JSON.parse(buf.slice(0, nl)));
				buf = buf.slice(nl + 1);
			}
		}
	} catch {
		reply.error = t('The chat could not be reached.');
	} finally {
		busy = false;
	}
}

export const chat = {
	get said() {
		return said;
	},
	get busy() {
		return busy;
	},
	get waiting() {
		return waiting !== null;
	},
	get model() {
		return model;
	},
	set model(m: ModelId) {
		model = m;
	},
	/** A chat keeps its model: thinking from one model is not carried to another. */
	get started() {
		return chatId !== null;
	},
	/** The draft's changes in words, and the fields to outline. */
	get changes() {
		return changed;
	},
	ask,
	/** A GM's draft lands at once; a player's goes to the GM. */
	apply() {
		const ops = session.draft;
		if (!ops) return;
		if (session.gm) {
			session.draft = null;
			session.land(ops);
			forget();
			note(t('Applied. {mod}Z takes it back.', { mod }));
		} else {
			waiting = session.propose(ops, asked.join('\n').slice(0, 2000));
			if (waiting) note(t('Sent to the GM, who will apply it or turn it down.'));
		}
	},
	discard() {
		if (waiting) {
			const id = waiting;
			waiting = null;
			session.settle(id, false);
		}
		forget();
		note(t('Discarded.'));
	},
	/** Takes a draft back from the GM, to change it. */
	withdraw() {
		if (!waiting) return;
		const id = waiting;
		waiting = null;
		session.settle(id, false);
		note(t('Taken back from the GM.'));
	},
	clear() {
		if (session.draft) this.discard();
		else forget();
		said = [];
	}
};
