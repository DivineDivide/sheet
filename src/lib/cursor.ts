// Cursors go over Cloudflare Realtime, never the room. This is what both ends agree on, and
// the most a cursor can cost, which the room books ahead so a month stays inside the free
// allowance.

/** Updates a browser sends at most each second. */
export const SEND_RATE = 15;
/** More than this a second from one person, over two seconds, and a browser stops listening. */
export const LIMIT_RATE = 20;
/** A message: a sequence number, then the point, NaN once the pointer leaves the sheet. */
const SIZE = 12;
/** Bytes billed per message with every header down to IP; the real count is lower. */
const BILLED = 200;
/** ICE consent checks and SCTP heartbeats, a second. */
const UPKEEP = 200;
/** Each connection hears every other, so the cost grows with the square of the people. */
export const ROOM_MAX = 8;
/** How far ahead the room books, and how often it books again. */
export const PERIOD = 5 * 60_000;
/** The allowance is 1,000 GB a month; any 31 days stay under this, whatever day a bill starts. */
export const CAP = 900e9;
export const WINDOW_DAYS = 31;

/** The most one connection can be sent in a period: upkeep, acks for what it sends, and each it hears. */
export const seatBytes = (hears: number) =>
	((UPKEEP + (1 + hears) * LIMIT_RATE * BILLED) * PERIOD) / 1000;
/** What one more listener adds in a period. */
export const listenBytes = (LIMIT_RATE * BILLED * PERIOD) / 1000;

/** The first day of the window that ends on `now`'s day, as `YYYY-MM-DD` in UTC. */
export const windowStart = (now: number) =>
	new Date(now - (WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

export function encode(seq: number, p: { x: number; y: number } | null): ArrayBuffer {
	const v = new DataView(new ArrayBuffer(SIZE));
	v.setUint32(0, seq);
	v.setFloat32(4, p?.x ?? NaN);
	v.setFloat32(8, p?.y ?? NaN);
	return v.buffer;
}

export function decode(data: unknown): { seq: number; at: { x: number; y: number } | null } | null {
	if (!(data instanceof ArrayBuffer) || data.byteLength !== SIZE) return null;
	const v = new DataView(data);
	const x = v.getFloat32(4);
	const y = v.getFloat32(8);
	return { seq: v.getUint32(0), at: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null };
}

/** Counts one sender's messages: false once they pass LIMIT_RATE over a two-second window. */
export class Gauge {
	private from = -Infinity;
	private n = 0;
	ok(now: number): boolean {
		if (now - this.from >= 2000) {
			this.from = now;
			this.n = 0;
		}
		return ++this.n <= 2 * LIMIT_RATE;
	}
}

/** What a browser asks the room for its cursor connection. */
export type RtcUp =
	| { k: 'start' }
	| { k: 'answer'; sdp: string }
	| { k: 'ready' }
	| { k: 'stop' }
	/** Someone sending past the limit, whom the room cuts off. */
	| { k: 'drop'; who: string };

/** What the room answers: the SFU's offer, channel ids to open, one gone, or no cursors. */
export type RtcDown =
	| { k: 'offer'; sdp: string }
	| { k: 'channels'; own?: number; hears: Record<string, number> }
	| { k: 'gone'; who: string }
	| { k: 'off'; why: 'unavailable' | 'full' | 'allowance' | 'failed' | 'too fast' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The cursor request a message carries, or null when it carries none. */
export function rtcIn(m: unknown): RtcUp | null {
	if (!isObj(m) || !isObj(m.rtc)) return null;
	const r = m.rtc;
	if (r.k === 'start' || r.k === 'ready' || r.k === 'stop') return { k: r.k };
	if (r.k === 'answer' && typeof r.sdp === 'string' && r.sdp.length <= 20_000) {
		return { k: 'answer', sdp: r.sdp };
	}
	if (r.k === 'drop' && typeof r.who === 'string' && r.who.length <= 64) {
		return { k: 'drop', who: r.who };
	}
	return null;
}
