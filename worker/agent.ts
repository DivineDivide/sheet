import Anthropic from '@anthropic-ai/sdk';
import { DurableObject } from 'cloudflare:workers';
import { addPrompt, respond, type Line, type Step, type Turn } from '../src/lib/agent/chat';
import { SYSTEM } from '../src/lib/agent/prompt';
import { tools } from '../src/lib/agent/tools';
import { overview } from '../src/lib/agent/view';
import { newId, type Doc } from '../src/lib/doc';
import { diff } from '../src/lib/sync';
import { supported } from './regions';

export const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' } as const;
export type Model = keyof typeof MODELS;
/**
 * `doc` is the room as `forAgent` gives it; a new chat starts its draft from it. `gm` is
 * whether a GM asks, through `/gm`; a player's chat sees no GM-only character.
 */
export type Ask = { chat: string | null; prompt: string; model: Model; doc: Doc; gm: boolean };

type Chat = { base: Doc; draft: Doc; model: Model; at: number; gm?: boolean };
const DAY = 86_400_000;
const TOOLS = tools.map(({ name, description, input_schema }) => ({
	name,
	description,
	input_schema: input_schema as Anthropic.Beta.BetaTool['input_schema']
}));

/** Why a call failed, as the asker should read it. */
function said(e: unknown): string {
	if (e instanceof Anthropic.AuthenticationError) return 'The API key was refused.';
	if (e instanceof Anthropic.PermissionDeniedError) return `Claude refused the call: ${e.message}`;
	if (e instanceof Anthropic.RateLimitError) return 'Claude is busy. Try again in a minute.';
	if (e instanceof Anthropic.APIError) return `Claude's API said: ${e.message}`;
	return 'Something went wrong in the chat.';
}

/**
 * One per room, created in the US (`locationHint`), so calls to Claude leave from where it
 * is offered. It keeps each chat's draft and history, and drops them after a day.
 */
export class Agent extends DurableObject<Env & { ANTHROPIC_API_KEY?: string }> {
	private where?: Promise<string | null>;

	/** The country this object's calls leave from, by Cloudflare's own reckoning. */
	private egress() {
		return (this.where ??= fetch('https://www.cloudflare.com/cdn-cgi/trace')
			.then((r) => r.text())
			.then((t) => /^loc=(\w+)$/m.exec(t)?.[1] ?? null)
			.catch(() => {
				this.where = undefined;
				return null;
			}));
	}

	async ask(a: Ask): Promise<ReadableStream<Uint8Array>> {
		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();
		const send = (l: Line) => void writer.write(encoder.encode(JSON.stringify(l) + '\n'));
		this.answer(a, send)
			.catch((e) => {
				console.error('chat failed', e);
				send({ t: 'error', text: said(e) });
			})
			.finally(() => writer.close());
		return readable;
	}

	private async answer(a: Ask, send: (l: Line) => void) {
		// Checked here as well as at the door: a call must never leave from where Claude
		// isn't offered, whoever asked.
		if (!supported(await this.egress()))
			return send({ t: 'error', text: "This server isn't somewhere Claude is offered." });
		const key = this.env.ANTHROPIC_API_KEY;
		if (!key) return send({ t: 'error', text: 'No API key is set up for the chat.' });

		const storage = this.ctx.storage;
		const kept = a.chat ? await storage.get<Chat>(`c:${a.chat}`) : undefined;
		// A chat stays its asker's: a GM's is never continued as a player's, nor the reverse.
		const known = kept && !!kept.gm === a.gm ? kept : undefined;
		const id = known ? a.chat! : newId();
		const chat: Chat = known ?? {
			base: a.doc,
			draft: structuredClone(a.doc),
			model: a.model,
			at: 0,
			gm: a.gm
		};
		chat.model = a.model;
		const history = [...(await storage.list<Turn>({ prefix: `h:${id}:` })).values()];
		// The first turn to write: a last turn of the asker's that no reply followed takes
		// these words too, so it is written again.
		const from = history.at(-1)?.role === 'user' ? history.length - 1 : history.length;
		addPrompt(history, [
			...(known
				? []
				: [
						{
							type: 'text' as const,
							text: `<room>\nAsked by ${a.gm ? 'the GM' : 'a player'}.\n${overview(chat.draft, a.gm)}\n</room>`
						}
					]),
			{ type: 'text', text: `<ask>\n${a.prompt}\n</ask>` }
		]);
		send({ t: 'start', chat: id });

		// More retries than the SDK's 2, which honour `retry-after`: a chat would rather wait
		// out a rate limit or an overload than fail.
		const client = new Anthropic({ apiKey: key, maxRetries: 6 });
		const step: Step = (messages, onText) => {
			const stream = client.beta.messages.stream({
				model: MODELS[chat.model],
				max_tokens: 32000,
				// A chat's thinking is bound to the prompt and tools it was made under, so a
				// deploy that changes them would fail every open chat; drop it instead.
				thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
				output_config: { effort: 'medium' },
				system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
				tools: TOOLS,
				messages,
				cache_control: { type: 'ephemeral' },
				betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
				fallbacks: 'default'
			});
			stream.on('text', onText);
			return stream.finalMessage();
		};
		try {
			await respond(chat.draft, history, step, send, a.gm);
		} catch (e) {
			if (!(e instanceof Anthropic.APIError)) throw e;
			send({ t: 'error', text: said(e) });
		}
		chat.at = Date.now();
		const pad = (n: number) => String(n).padStart(4, '0');
		const turns = history.slice(from).map((t, n) => [`h:${id}:${pad(from + n)}`, t]);
		await storage.put({ ...Object.fromEntries(turns), [`c:${id}`]: chat });
		if ((await storage.getAlarm()) === null) await storage.setAlarm(Date.now() + DAY);
		send({ t: 'done', ops: diff(chat.base, chat.draft) });
	}

	/** Drops a chat, once its draft is applied or discarded. */
	async forget(chat: string) {
		const keys = [...(await this.ctx.storage.list({ prefix: `h:${chat}:` })).keys()];
		await this.ctx.storage.delete([...keys, `c:${chat}`]);
	}

	async alarm() {
		let left = false;
		for (const [key, chat] of await this.ctx.storage.list<Chat>({ prefix: 'c:' })) {
			if (chat.at < Date.now() - DAY) await this.forget(key.slice(2));
			else left = true;
		}
		if (left) await this.ctx.storage.setAlarm(Date.now() + DAY);
	}
}
