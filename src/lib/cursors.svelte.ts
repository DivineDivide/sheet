import { Gauge, SEND_RATE, decode, encode } from './cursor';
import { t } from './i18n.svelte';
import { session } from './session.svelte';

// Pointers over Cloudflare Realtime: the room wires the channels, then moves never touch it.
// Must match the room's `CURSOR` in worker/realtime.ts.
const POLICY = { ordered: false, maxRetransmits: 0 };
/** A hidden tab keeps its connection this long, in case it is back soon. */
const LINGER = 60_000;
/** A connection not made by then never will be, and its booking is better spent. */
const CONNECT = 15_000;

type Point = { x: number; y: number };

let pc: RTCPeerConnection | null = null;
let own: RTCDataChannel | null = null;
const ears = new Map<string, RTCDataChannel>();
let points = $state.raw<Record<string, Point>>({});
let wanted = false;
// The room said no, or WebRTC failed: no asking again until the room's socket is new.
let refused = false;
let linger: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
let next: Point | null = null;
let sent: Point | null | undefined;
let sentAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function unpoint(who: string) {
	const { [who]: _, ...rest } = points;
	points = rest;
}

function hangUp() {
	for (const c of ears.values()) c.close();
	ears.clear();
	own?.close();
	own = null;
	pc?.close();
	pc = null;
	points = {};
	sent = undefined;
}

function fail() {
	session.rtc({ k: 'stop' });
	hangUp();
	refused = true;
}

function hear(who: string, id: number) {
	if (!pc) return;
	ears.get(who)?.close();
	const c = pc.createDataChannel('cursor', { negotiated: true, id, ...POLICY });
	c.binaryType = 'arraybuffer';
	const gauge = new Gauge();
	let last = -1;
	c.onmessage = (e) => {
		// Past the rate the room books for, so the room cuts them off for everyone.
		if (!gauge.ok(performance.now())) {
			session.rtc({ k: 'drop', who });
			c.close();
			ears.delete(who);
			return unpoint(who);
		}
		const m = decode(e.data);
		if (!m || m.seq <= last) return;
		last = m.seq;
		if (m.at) points = { ...points, [who]: m.at };
		else unpoint(who);
	};
	ears.set(who, c);
}

function start() {
	if (pc || refused || typeof RTCPeerConnection === 'undefined') return;
	try {
		pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
			bundlePolicy: 'max-bundle'
		});
	} catch {
		refused = true;
		return;
	}
	const mine = pc;
	mine.onconnectionstatechange = () => {
		if (mine !== pc) return;
		if (mine.connectionState === 'connected') session.rtc({ k: 'ready' });
		// UDP blocked, as on some school and office networks: the sheet goes on without cursors.
		else if (mine.connectionState === 'failed') fail();
	};
	setTimeout(() => mine === pc && mine.connectionState !== 'connected' && fail(), CONNECT);
	session.rtc({ k: 'start' });
}

function settle() {
	clearTimeout(linger);
	if (wanted && document.visibilityState === 'visible') start();
	else if (pc) {
		linger = setTimeout(() => {
			session.rtc({ k: 'stop' });
			hangUp();
		}, LINGER);
	}
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', settle);

session.onRtc = async (m) => {
	if (m.k === 'offer') {
		if (!pc) return;
		try {
			await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			session.rtc({ k: 'answer', sdp: answer.sdp! });
		} catch {
			fail();
		}
	} else if (m.k === 'channels') {
		if (!pc) return;
		if (m.own !== undefined) {
			own = pc.createDataChannel('cursor', { negotiated: true, id: m.own, ...POLICY });
		}
		for (const [who, id] of Object.entries(m.hears)) hear(who, id);
	} else if (m.k === 'gone') {
		ears.get(m.who)?.close();
		ears.delete(m.who);
		unpoint(m.who);
	} else {
		hangUp();
		refused = true;
		if (m.why === 'allowance') {
			session.notice = t("Cursors are off: this month's free Realtime allowance is booked up.");
		}
	}
};

export const cursors = {
	/** Others' pointers, by who, in sheet points. */
	get points() {
		return points;
	},
	/** Whether this page wants cursors: a wide sheet in a connected room. */
	want(on: boolean) {
		if (session.status !== 'open') {
			// The room ended this socket's connection when the socket went.
			clearTimeout(linger);
			hangUp();
			refused = false;
		}
		wanted = on;
		settle();
	},
	/** The pointer at a sheet point, or off the sheet; sent at most SEND_RATE times a second. */
	move(p: Point | null) {
		next = p;
		if (timer || own?.readyState !== 'open') return;
		timer = setTimeout(
			() => {
				timer = undefined;
				if (own?.readyState !== 'open' || (next?.x === sent?.x && next?.y === sent?.y)) return;
				sent = next;
				sentAt = performance.now();
				own.send(encode(++seq, next));
			},
			Math.max(0, sentAt + 1000 / SEND_RATE - performance.now())
		);
	}
};
