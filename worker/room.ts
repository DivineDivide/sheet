import { DurableObject } from 'cloudflare:workers';
import { forAgent } from '../src/lib/agent/chat';
import {
	PERIOD,
	ROOM_MAX,
	listenBytes,
	rtcIn,
	seatBytes,
	type RtcDown,
	type RtcUp
} from '../src/lib/cursor';
import { VERSION, newId, type Doc } from '../src/lib/doc';
import { ImportError, validate } from '../src/lib/io';
import { isId, presenceIn, slotFor, type Peer, type Presence } from '../src/lib/presence';
import { fire, isAct, type Act, type Done } from '../src/lib/rules';
import {
	apply,
	isChange,
	isPropose,
	isSettle,
	type Down,
	type Op,
	type Proposal
} from '../src/lib/sync';
import { upgrade } from '../src/lib/v2';
import { realtime } from './realtime';

const send = (ws: WebSocket, m: Down) => ws.send(JSON.stringify(m));

/**
 * A socket's attachment: the person, and what never leaves here: their Realtime session,
 * and the browser and page that opened it, so nobody else can end their socket.
 */
type Seat = Peer & { rtc?: Rtc; browser?: string; page?: string };
/** A cursor session: its own channel once connected, and the one hearing each person, by `who`. */
type Rtc = { session: string; own?: number; hears: Record<string, number> };
const peerOf = ({ rtc: _, browser: _b, page: _p, ...peer }: Seat): Peer => peer;
const off = (why: Extract<RtcDown, { k: 'off' }>['why']): RtcDown => ({ k: 'off', why });

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
	/** Presence messages each socket sent this second, so no one client keeps the room awake. */
	private rates = new WeakMap<WebSocket, { at: number; n: number }>();
	/** Realtime calls go one at a time, so two people connecting at once still hear each other. */
	private line: Promise<void> = Promise.resolve();

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
		const stored = {
			clocks: parts.get('clocks'),
			templates: parts.get('templates'),
			characters: (parts.get('characters') as string[]).map((id) => parts.get(`c:${id}`)),
			...(parts.has('log') && { log: parts.get('log') })
		};
		const old =
			parts.has('presets') ||
			stored.characters.some((c) => 'statuses' in c) ||
			stored.clocks.some((k: object) => 'rules' in k);
		if (!old) return { version: VERSION, ...stored };
		// Written back at once, so the tables it makes keep their ids. `presets`, which
		// version 3 has not, is deleted.
		const doc = upgrade({ version: 2, ...stored });
		const keys = ['clocks', 'presets', 'log', ...doc.characters.map((c) => `c:${c.id}`)];
		this.ctx.storage.transactionSync(() => this.save(doc, keys));
		return doc;
	}

	private save(doc: Doc, keys: Iterable<string>) {
		const sql = this.ctx.storage.sql;
		for (const key of keys) {
			const value =
				key === 'characters'
					? doc.characters.map((c) => c.id)
					: key.startsWith('c:')
						? doc.characters.find((c) => c.id === key.slice(2))
						: doc[key as 'clocks' | 'templates' | 'log'];
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
			const keys = ['clocks', 'templates', 'characters', 'log'];
			keys.push(...doc.characters.map((c) => `c:${c.id}`));
			this.save(doc, keys);
		});
		this.doc = doc;
	}

	/** The room as the chat's agent gets it, or null for a link no GM made. */
	async snapshot(): Promise<Doc | null> {
		if (this.name() === null) return null;
		return forAgent((this.doc ??= this.load()));
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

		const param = (k: string) => {
			const v = new URL(request.url).searchParams.get(k);
			return isId(v) ? v : undefined;
		};
		const browser = param('browser');
		const page = param('page');
		// A page connecting again: the room may not have heard its old socket drop.
		for (const [ws, seat] of this.seats()) {
			if (!page || seat.page !== page) continue;
			ws.serializeAttachment(null);
			await this.leave(ws, seat);
			try {
				ws.close(1000, 'connected again');
			} catch {}
		}

		const { 0: client, 1: server } = new WebSocketPair();
		const seats = this.seats().map(([, s]) => s);
		const here = seats.map(peerOf);
		const me: Peer = { who: newId(), color: slotFor(seats, browser) };
		this.ctx.acceptWebSocket(server);
		// Kept with the socket, through hibernation, so presence is never stored.
		server.serializeAttachment({ ...me, browser, page } satisfies Seat);
		send(server, { t: 'hello', name, doc: (this.doc ??= this.load()) });
		send(server, { t: 'proposals', list: this.proposals() });
		send(server, { t: 'peers', me: me.who, list: [...here, me] });
		this.others(server, { t: 'peer', peer: me });
		return new Response(null, { status: 101, webSocket: client });
	}

	private seatOf = (ws: WebSocket) => ws.deserializeAttachment() as Seat | null;

	/** Sockets accepted before presence have no attachment. */
	private seats(): [WebSocket, Seat][] {
		return this.ctx.getWebSockets().flatMap((ws) => {
			const seat = this.seatOf(ws);
			return seat ? [[ws, seat] as [WebSocket, Seat]] : [];
		});
	}

	/** Rewrites a seat from what it holds now, since a presence message may have come meanwhile. */
	private reseat(ws: WebSocket, fn: (s: Seat) => Seat) {
		const seat = this.seatOf(ws);
		try {
			if (seat) ws.serializeAttachment(fn(seat));
		} catch {}
	}

	/** Passes on what someone is doing, without reading or writing the doc. */
	private present(ws: WebSocket, p: Presence) {
		const now = Date.now();
		const rate = this.rates.get(ws);
		if (rate && now - rate.at < 1000) {
			if (++rate.n > 20) return;
		} else this.rates.set(ws, { at: now, n: 1 });
		const was = this.seatOf(ws);
		if (!was) return;
		const peer: Peer = { ...p, who: was.who, color: was.color };
		ws.serializeAttachment({ ...peer, rtc: was.rtc, browser: was.browser, page: was.page });
		this.others(ws, { t: 'peer', peer });
	}

	private async leave(ws: WebSocket, seat = this.seatOf(ws)) {
		if (!seat) return;
		this.others(ws, { t: 'left', who: seat.who });
		if (seat.rtc) await this.queue(() => this.hangUp(ws, seat.who, seat.rtc!));
	}

	private queue(fn: () => Promise<void>) {
		return (this.line = this.line.then(fn).catch((e) => console.error('realtime', e)));
	}

	private tell(ws: WebSocket, rtc: RtcDown) {
		try {
			send(ws, { t: 'rtc', rtc });
		} catch {}
	}

	/** Books Realtime use with the Worker's one meter; a meter that cannot answer is a no. */
	private book(bytes: number): Promise<boolean> {
		return this.env.METER.get(this.env.METER.idFromName('realtime'))
			.book(bytes)
			.catch(() => false);
	}

	/** A browser's cursor connection, made and wired through the room, which books each step. */
	private async cursor(ws: WebSocket, m: RtcUp) {
		const seat = this.seatOf(ws);
		if (!seat) return;
		const rt = realtime(this.env);
		try {
			if (m.k === 'start') {
				if (seat.rtc) await this.hangUp(ws, seat.who, seat.rtc);
				if (!this.env.CF_REALTIME_ID || !this.env.CF_REALTIME_KEY) {
					return this.tell(ws, off('unavailable'));
				}
				if (this.seats().filter(([, s]) => s.rtc).length >= ROOM_MAX) {
					return this.tell(ws, off('full'));
				}
				if (!(await this.book(seatBytes(0)))) return this.tell(ws, off('allowance'));
				const { session, offer } = await rt.open();
				this.reseat(ws, (s) => ({ ...s, rtc: { session, hears: {} } }));
				if ((await this.ctx.storage.getAlarm()) === null) {
					await this.ctx.storage.setAlarm(Date.now() + PERIOD);
				}
				this.tell(ws, { k: 'offer', sdp: offer.sdp });
			} else if (m.k === 'answer') {
				if (seat.rtc) await rt.answer(seat.rtc.session, m.sdp);
			} else if (m.k === 'ready') {
				const rtc = seat.rtc;
				if (!rtc || rtc.own !== undefined) return;
				const others = this.seats().filter(([w, s]) => w !== ws && s.rtc?.own !== undefined);
				if (!(await this.book(2 * others.length * listenBytes))) {
					return this.cut([[ws, seat]], 'allowance');
				}
				const own = await rt.publish(rtc.session);
				const ids = await rt.hear(
					rtc.session,
					others.map(([, s]) => s.rtc!.session)
				);
				const hears = Object.fromEntries(others.map(([, s], i) => [s.who, ids[i]]));
				this.reseat(ws, (s) => ({ ...s, rtc: { ...rtc, own, hears } }));
				this.tell(ws, { k: 'channels', own, hears });
				for (const [w, s] of others) {
					const [id] = await rt.hear(s.rtc!.session, [rtc.session]);
					this.reseat(w, (t) =>
						t.rtc ? { ...t, rtc: { ...t.rtc, hears: { ...t.rtc.hears, [seat.who]: id } } } : t
					);
					this.tell(w, { k: 'channels', hears: { [seat.who]: id } });
				}
			} else if (m.k === 'stop') {
				if (seat.rtc) await this.hangUp(ws, seat.who, seat.rtc);
			} else {
				const fast = this.seats().find(([, s]) => s.who === m.who && s.rtc);
				if (fast) await this.cut([fast], 'too fast');
			}
		} catch (e) {
			console.error('realtime', e);
			const now = this.seatOf(ws);
			if (now?.rtc) await this.hangUp(ws, now.who, now.rtc);
			this.tell(ws, off('failed'));
		}
	}

	/** Ends someone's cursor connection: their channels, and every channel that heard them. */
	private async hangUp(ws: WebSocket, who: string, rtc: Rtc) {
		const rt = realtime(this.env);
		this.reseat(ws, (s) => ({ ...s, rtc: undefined }));
		const mine = Object.values(rtc.hears);
		await rt.close(rtc.session, rtc.own === undefined ? mine : [rtc.own, ...mine]);
		for (const [w, s] of this.seats()) {
			const id = s.rtc?.hears[who];
			if (id === undefined) continue;
			await rt.close(s.rtc!.session, [id]);
			this.reseat(w, (t) => {
				if (!t.rtc) return t;
				const { [who]: _, ...hears } = t.rtc.hears;
				return { ...t, rtc: { ...t.rtc, hears } };
			});
			this.tell(w, { k: 'gone', who });
		}
	}

	private async cut(seats: [WebSocket, Seat][], why: 'allowance' | 'too fast') {
		for (const [ws, s] of seats) {
			if (s.rtc) await this.hangUp(ws, s.who, s.rtc);
			this.tell(ws, off(why));
		}
	}

	/** Books the next period for every cursor connection here, or ends them all. */
	async alarm() {
		await this.queue(async () => {
			const live = this.seats().filter(([, s]) => s.rtc);
			if (!live.length) return;
			const bytes = live.reduce((n, [, s]) => n + seatBytes(Object.keys(s.rtc!.hears).length), 0);
			if (await this.book(bytes)) await this.ctx.storage.setAlarm(Date.now() + PERIOD);
			else await this.cut(live, 'allowance');
		});
	}

	/** Rooms made before proposals have no table for them until the first is sent. */
	private proposals(): Proposal[] {
		try {
			return this.ctx.storage.sql
				.exec('SELECT json FROM proposal ORDER BY at')
				.toArray()
				.map((r) => JSON.parse(String(r.json)));
		} catch {
			return [];
		}
	}

	private propose(p: Proposal) {
		const sql = this.ctx.storage.sql;
		sql.exec('CREATE TABLE IF NOT EXISTS proposal (id TEXT PRIMARY KEY, at INTEGER, json TEXT)');
		sql.exec('INSERT OR REPLACE INTO proposal VALUES (?, ?, ?)', p.id, p.at, JSON.stringify(p));
		this.all({ t: 'proposals', list: this.proposals() });
	}

	/** Only forgets it: a GM's client applies the change itself, as one of its own edits. */
	private settle(id: string, ok: boolean) {
		if (!this.proposals().some((p) => p.id === id)) return;
		this.ctx.storage.sql.exec('DELETE FROM proposal WHERE id = ?', id);
		this.all({ t: 'settled', id, ok });
		this.all({ t: 'proposals', list: this.proposals() });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		let change: unknown;
		try {
			change = JSON.parse(String(raw));
		} catch {
			return;
		}
		const presence = presenceIn(change);
		if (presence) return this.present(ws, presence);
		const rtc = rtcIn(change);
		if (rtc) return this.queue(() => this.cursor(ws, rtc));
		if (isAct(change)) return this.act(ws, change.id, change.act);
		if (isPropose(change)) {
			return this.propose({ id: change.id, ...change.propose, at: Date.now() });
		}
		if (isSettle(change)) return this.settle(change.settle.proposal, change.settle.ok);
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

	private others(ws: WebSocket | null, m: Down) {
		const out = JSON.stringify(m);
		for (const other of this.ctx.getWebSockets()) {
			if (other === ws) continue;
			try {
				other.send(out);
			} catch {}
		}
	}

	private all(m: Down) {
		this.others(null, m);
	}

	async webSocketClose(ws: WebSocket, code: number) {
		try {
			ws.close(code);
		} catch {}
		await this.leave(ws);
	}

	async webSocketError(ws: WebSocket) {
		await this.leave(ws);
	}
}
