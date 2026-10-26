import { DurableObject } from 'cloudflare:workers';
import { VERSION, type Doc } from '../src/lib/doc';
import { ImportError, validate } from '../src/lib/io';
import { fire, isAct, type Act, type Done } from '../src/lib/rules';
import { apply, isChange, type Down, type Op } from '../src/lib/sync';

const send = (ws: WebSocket, m: Down) => ws.send(JSON.stringify(m));

/** Dice are rolled here, never in a browser that could roll again. */
const roll = (sides: number) => 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % sides);

function reasonOf(e: unknown): string {
	if (e instanceof ImportError) return e.message;
	console.error('change refused', e);
	return /TOOBIG|too big/i.test(String(e))
		? 'a character grew too large to store; pictures take the most room'
		: 'the room could not store it';
}

/**
 * The rows a change rewrites. Each character is a row of its own, so an edit writes one
 * small row; adding or removing a character also writes the row that orders them.
 */
function touched(ops: Op[]): Set<string> {
	const keys = new Set<string>();
	for (const { p } of ops) {
		if (p[0] !== 'characters') keys.add(p[0]);
		else if (p.length === 1) keys.add('characters');
		else {
			keys.add(`c:${p[1]}`);
			if (p.length === 2) keys.add('characters');
		}
	}
	return keys;
}

/** One room, one object: the single place that orders every change to its doc. */
export class Room extends DurableObject<Env> {
	private doc: Doc | null = null;
	/** Changes applied lately, so a resend after a lost ack is acked, not applied twice. */
	private seen = new Set<string>();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Answered in the runtime without waking the object, so keep-alives are free.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	/** Null for a link no GM made. Such a room has no tables, and reading creates none. */
	private name(): string | null {
		try {
			return String(
				this.ctx.storage.sql.exec("SELECT value FROM meta WHERE key = 'name'").one().value
			);
		} catch {
			return null;
		}
	}

	private load(): Doc {
		const rows = this.ctx.storage.sql.exec('SELECT key, json FROM part').toArray();
		const parts = new Map(rows.map((r) => [String(r.key), JSON.parse(String(r.json))]));
		return {
			version: VERSION,
			clocks: parts.get('clocks'),
			templates: parts.get('templates'),
			characters: (parts.get('characters') as string[]).map((id) => parts.get(`c:${id}`)),
			// Rooms made before presets have neither row.
			presets: parts.get('presets') ?? [],
			...(parts.has('log') && { log: parts.get('log') })
		};
	}

	private save(doc: Doc, keys: Iterable<string>) {
		const sql = this.ctx.storage.sql;
		for (const key of keys) {
			const value =
				key === 'characters'
					? doc.characters.map((c) => c.id)
					: key.startsWith('c:')
						? doc.characters.find((c) => c.id === key.slice(2))
						: doc[key as 'clocks' | 'templates' | 'presets' | 'log'];
			if (value === undefined) sql.exec('DELETE FROM part WHERE key = ?', key);
			else {
				sql.exec(
					'INSERT INTO part VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json',
					key,
					JSON.stringify(value)
				);
			}
		}
	}

	async init(name: string, creator: string, doc: Doc) {
		const sql = this.ctx.storage.sql;
		this.ctx.storage.transactionSync(() => {
			sql.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
			sql.exec('CREATE TABLE part (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
			for (const [k, v] of [
				['name', name],
				['creator', creator],
				['created', String(Date.now())]
			]) {
				sql.exec('INSERT INTO meta VALUES (?, ?)', k, v);
			}
			const keys = ['clocks', 'templates', 'characters', 'presets', 'log'];
			keys.push(...doc.characters.map((c) => `c:${c.id}`));
			this.save(doc, keys);
		});
		this.doc = doc;
	}

	async destroy() {
		// Said in a message as well: a close code alone is lost by `vite dev`'s socket proxy.
		for (const ws of this.ctx.getWebSockets()) {
			send(ws, { t: 'gone' });
			ws.close(1000, 'room deleted');
		}
		await this.ctx.storage.deleteAll();
		this.doc = null;
	}

	async fetch(request: Request): Promise<Response> {
		const name = this.name();
		if (name === null) return new Response('no such room', { status: 404 });
		if (request.headers.get('Upgrade') !== 'websocket') return Response.json({ name });

		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);
		send(server, { t: 'hello', name, doc: (this.doc ??= this.load()) });
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		let change: unknown;
		try {
			change = JSON.parse(String(raw));
		} catch {
			return;
		}
		if (isAct(change)) return this.act(ws, change.id, change.act);
		if (!isChange(change)) {
			const id = (change as { id?: unknown })?.id;
			if (typeof id === 'string') send(ws, { t: 'reject', id, reason: 'it was malformed' });
			return;
		}
		if (this.seen.has(change.id)) return send(ws, { t: 'ack', id: change.id });

		const doc = (this.doc ??= this.load());
		try {
			for (const op of change.ops) apply(doc, op);
			validate(doc);
			this.ctx.storage.transactionSync(() => this.save(doc, touched(change.ops)));
		} catch (e) {
			// The doc in memory took a change its rows refused, so it is read back.
			this.doc = null;
			return send(ws, { t: 'reject', id: change.id, reason: reasonOf(e) });
		}

		this.seen.add(change.id);
		if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
		send(ws, { t: 'ack', id: change.id });
		this.others(ws, { t: 'change', ...change });
	}

	/**
	 * A press, tick or step back, run here so it counts once. Not deduplicated: a client
	 * never sends one twice, and forgets it when the socket drops.
	 */
	private act(ws: WebSocket, id: string, act: Act) {
		const doc = (this.doc ??= this.load());
		let done: Done;
		try {
			done = fire(doc, act, roll);
			validate(doc);
			this.ctx.storage.transactionSync(() => this.save(doc, touched(done.ops)));
		} catch (e) {
			this.doc = null;
			return send(ws, { t: 'done', id, ops: [], undo: [], why: reasonOf(e) });
		}
		send(ws, { t: 'done', id, ...done });
		if (done.ops.length) this.others(ws, { t: 'change', id, ops: done.ops });
	}

	private others(ws: WebSocket, m: Down) {
		const out = JSON.stringify(m);
		for (const other of this.ctx.getWebSockets()) {
			if (other === ws) continue;
			try {
				other.send(out);
			} catch {}
		}
	}

	async webSocketClose(ws: WebSocket, code: number) {
		try {
			ws.close(code);
		} catch {}
	}
}
