import type { RtcDown, RtcUp } from './cursor';
import { withPictures } from './agent/pictures';
import { newId, type Doc } from './doc';
import { History } from './history';
import { t } from './i18n.svelte';
import type { Presence } from './presence';
import type { Act } from './rules';
import { follow } from './source';
import { Replica, apply, diff, revert, type Down, type Op, type Proposal } from './sync';

const VISITS = 'sheet.rooms';
export type Visit = { token: string; name: string; at: number };

/** Rooms this browser has opened, newest first: all `/` can offer without accounts. */
export function visits(): Visit[] {
	try {
		const v = JSON.parse(localStorage.getItem(VISITS) ?? '[]');
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

function visited(token: string, name: string) {
	const rest = visits().filter((v) => v.token !== token);
	try {
		localStorage.setItem(VISITS, JSON.stringify([{ token, name, at: Date.now() }, ...rest]));
	} catch {}
}

// The room shows a browser's tabs as one person, and ends the socket a page leaves behind
// when that page connects again.
const page = newId();
const browser = (() => {
	try {
		const id = localStorage.getItem('sheet.browser') ?? newId();
		localStorage.setItem('sheet.browser', id);
		return id;
	} catch {
		return page;
	}
})();

/** A change this client made: the ops it sent, and the ops that take it back. */
type Step = { f: Op[]; i: Op[] };
type Status = 'connecting' | 'open' | 'offline' | 'missing';

let doc = $state<Doc | null>(null);
let name = $state('');
let status = $state<Status>('connecting');
// Numbered, so the same text told twice still counts as a new notice.
let told = 0;
let notice = $state<{ text: string; n: number } | null>(null);
let counts = $state({ undo: 0, redo: 0, unsent: 0 });
let gm = $state(false);
// Raw: ops are applied with `structuredClone`, which a state proxy would make throw.
let proposals = $state.raw<Proposal[]>([]);
let onSettled: (id: string, ok: boolean) => void = () => {};
type PeerNews = Extract<Down, { t: 'peers' | 'peer' | 'left' }>;
let onPeers: (m: PeerNews) => void = () => {};
let onRtc: (m: RtcDown) => void = () => {};
/** A chat's draft, as changes to the room: shown instead of the room until it is settled. */
let draft = $state.raw<Op[] | null>(null);
const shown = $derived.by(() => {
	if (!draft || !doc) return null;
	const d = $state.snapshot(doc) as Doc;
	for (const op of draft) apply(d, op);
	withPictures(d, doc);
	return d;
});
const history = new History<Step>();
let replica: Replica<Doc> | null = null;
let socket: WebSocket | null = null;
let token = '';
let tries = 0;

function settle() {
	counts = {
		undo: history.past.length,
		redo: history.future.length,
		unsent: replica?.pending.length ?? 0
	};
}

function send(ops: Op[]) {
	const c = { id: newId(), ops };
	replica!.pending.push(c);
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(c));
	settle();
}

/** An undo or redo: applied here at once, then sent like any edit. */
function play(ops: Op[]) {
	for (const op of ops) apply(doc, op);
	if (ops.length) send(ops);
}

function receive(m: Down) {
	if (m.t === 'hello') {
		name = m.name;
		document.title = m.name;
		visited(token, m.name);
		status = 'open';
		tries = 0;
		// Edits the room never confirmed go back on top, and go again.
		if (replica) replica.base = m.doc;
		else replica = new Replica(m.doc);
		doc = replica.rebuild();
		for (const c of replica.pending) socket!.send(JSON.stringify(c));
	} else if (m.t === 'ack') {
		replica!.ack(m.id);
	} else if (m.t === 'change') {
		replica!.remote(m.ops, doc!);
	} else if (m.t === 'done') {
		replica!.remote(m.ops, doc!);
		// Its effects are this client's to undo; the log line stays.
		const f = m.ops.filter((op) => op.p[0] !== 'log');
		if (f.length) history.record({ f, i: m.undo });
		if (m.why) notice = { text: m.why[0].toUpperCase() + m.why.slice(1) + '.', n: ++told };
	} else if (m.t === 'proposals') {
		proposals = m.list;
	} else if (m.t === 'settled') {
		onSettled(m.id, m.ok);
	} else if (m.t === 'peers' || m.t === 'peer' || m.t === 'left') {
		onPeers(m);
	} else if (m.t === 'rtc') {
		onRtc(m.rtc);
	} else if (m.t === 'gone') {
		status = 'missing';
		const ws = socket;
		socket = null;
		ws?.close();
	} else {
		replica!.reject(m.id);
		doc = replica!.rebuild();
		notice = {
			text: t('Not saved: {reason}. Your change was taken back.', { reason: m.reason }),
			n: ++told
		};
	}
	settle();
}

/** Sends a message that is not an edit: one the room only passes on, so it waits for nothing. */
function tell(m: object): boolean {
	if (socket?.readyState !== WebSocket.OPEN) {
		notice = { text: t('The room is not connected. Try again in a moment.'), n: ++told };
		return false;
	}
	socket.send(JSON.stringify(m));
	return true;
}

/** Edits wait while a draft is shown, so nobody edits what isn't the room. */
function held(): boolean {
	if (draft) notice = { text: t("This is Claude's draft. Apply or discard it first."), n: ++told };
	return draft !== null;
}

function commit(fn: (d: Doc) => void) {
	if (!doc) return;
	const before = $state.snapshot(doc) as Doc;
	fn(doc);
	// Rows drawn from a table take its change in the same step, so ⌘Z takes both back.
	follow(doc);
	const after = $state.snapshot(doc) as Doc;
	const f = diff(before, after);
	if (!f.length) return;
	history.record({ f, i: diff(after, before) });
	send(f);
}

async function connect() {
	const res = await fetch(`/api/rooms/${token}`).catch(() => null);
	if (res?.status === 404) {
		status = 'missing';
		return;
	}
	const ws = new WebSocket(
		`${location.origin.replace(/^http/, 'ws')}/api/rooms/${token}/ws?browser=${browser}&page=${page}`
	);
	socket = ws;
	ws.onmessage = (e) => e.data !== 'pong' && receive(JSON.parse(e.data));
	ws.onclose = () => {
		if (socket !== ws) return;
		socket = null;
		status = doc ? 'offline' : 'connecting';
		setTimeout(connect, Math.min(10_000, 500 * 2 ** tries++));
	};
}

export const session = {
	get ready() {
		return doc !== null;
	},
	/**
	 * Read only once `ready`: the room's doc, with this client's unconfirmed edits on top,
	 * or the draft made from it while one is shown.
	 */
	get doc(): Doc {
		return shown ?? doc!;
	},
	/** The room itself, even while a draft is shown. */
	get room(): Doc {
		return doc!;
	},
	get token() {
		return token;
	},
	get name() {
		return name;
	},
	/** Whether this page was opened from `/gm` by a GM signed in there. */
	get gm() {
		return gm;
	},
	get proposals() {
		return proposals;
	},
	get draft() {
		return draft;
	},
	set draft(ops: Op[] | null) {
		draft = ops;
	},
	/** Applies a draft's changes to the room as one edit of this client's, which ⌘Z takes back. */
	land(ops: Op[]) {
		commit((d) => {
			const room = $state.snapshot(d) as Doc;
			for (const op of ops) apply(d, op);
			withPictures(d, room);
		});
	},
	/** Sends a draft to the GM; returns its id, or null when the room isn't connected. */
	propose(ops: Op[], asked: string): string | null {
		const id = newId();
		return tell({ id, propose: { ops, asked } }) ? id : null;
	},
	/** False while the room isn't connected, when the proposal stays where it is. */
	settle(proposal: string, ok: boolean): boolean {
		return tell({ id: newId(), settle: { proposal, ok } });
	},
	set onSettled(fn: (id: string, ok: boolean) => void) {
		onSettled = fn;
	},
	set onPeers(fn: (m: PeerNews) => void) {
		onPeers = fn;
	},
	/** Tells the others what this person is doing; dropped while offline, as connecting asks again. */
	present(p: Presence) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ presence: p }));
	},
	set onRtc(fn: (m: RtcDown) => void) {
		onRtc = fn;
	},
	/** Asks the room about this page's cursor connection, which a lost socket ends anyway. */
	rtc(m: RtcUp) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ rtc: m }));
	},
	get status() {
		return status;
	},
	/** Edits sent but not yet confirmed, as a disconnect leaves them. */
	get unsent() {
		return counts.unsent;
	},
	get notice() {
		return notice?.text ?? null;
	},
	set notice(text: string | null) {
		notice = text === null ? null : { text, n: ++told };
	},
	/** Changes with every notice told, so a toast showing one can start over. */
	get noticeKey() {
		return notice?.n;
	},
	get canUndo() {
		return counts.undo > 0;
	},
	get canRedo() {
		return counts.redo > 0;
	},
	open(room: string) {
		token = room;
		connect();
		// Without a sign-in, Access answers with a redirect, which `manual` leaves unfollowed.
		if (new URLSearchParams(location.search).has('gm')) {
			fetch('/gm/api/me', { redirect: 'manual' })
				.then((r) => (gm = r.ok))
				.catch(() => {});
		}
		// Answered by the room's runtime without waking it.
		setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 30_000);
		addEventListener('beforeunload', (e) => {
			if (replica?.pending.length) e.preventDefault();
		});
	},
	/** Every edit goes through here, so each is one undo step and reaches the room at once. */
	change(fn: (d: Doc) => void) {
		if (!held()) commit(fn);
	},
	/** A press, tick or step back, which the room runs; ⌘Z then takes it back like an edit. */
	act(a: Act) {
		if (held()) return;
		if (socket?.readyState !== WebSocket.OPEN) {
			this.notice = t('Presses and clocks wait for the room, which is not connected.');
			return;
		}
		socket.send(JSON.stringify({ id: newId(), act: a }));
	},
	/** An imported file, as one change: everyone gets it, and Undo puts the room back. */
	replace(next: Doc) {
		this.change((d) => {
			d.clocks = next.clocks;
			d.templates = next.templates;
			d.characters = next.characters;
		});
	},
	/** Takes back this client's own last edit, wherever nobody has changed it since. */
	undo() {
		if (held()) return;
		const step = history.undo();
		if (step) play(revert(doc, step.f, step.i));
		settle();
	},
	redo() {
		if (held()) return;
		const step = history.redo();
		if (step) play(revert(doc, step.i, step.f));
		settle();
	}
};
