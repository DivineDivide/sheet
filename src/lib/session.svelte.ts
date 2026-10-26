import { newId, type Doc } from './doc';
import { History } from './history';
import type { Act } from './rules';
import { Replica, apply, diff, revert, type Down, type Op } from './sync';

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
	} else if (m.t === 'gone') {
		status = 'missing';
		const ws = socket;
		socket = null;
		ws?.close();
	} else {
		replica!.reject(m.id);
		doc = replica!.rebuild();
		notice = { text: `Not saved: ${m.reason}. Your change was taken back.`, n: ++told };
	}
	settle();
}

async function connect() {
	const res = await fetch(`/api/rooms/${token}`).catch(() => null);
	if (res?.status === 404) {
		status = 'missing';
		return;
	}
	const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/rooms/${token}/ws`);
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
	/** Read only once `ready`: the room's doc, with this client's unconfirmed edits on top. */
	get doc(): Doc {
		return doc!;
	},
	get name() {
		return name;
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
		// Answered by the room's runtime without waking it.
		setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 30_000);
		addEventListener('beforeunload', (e) => {
			if (replica?.pending.length) e.preventDefault();
		});
	},
	/** Every edit goes through here, so each is one undo step and reaches the room at once. */
	change(fn: (d: Doc) => void) {
		if (!doc) return;
		const before = $state.snapshot(doc) as Doc;
		fn(doc);
		const after = $state.snapshot(doc) as Doc;
		const f = diff(before, after);
		if (!f.length) return;
		history.record({ f, i: diff(after, before) });
		send(f);
	},
	/** A press, tick or step back, which the room runs; ⌘Z then takes it back like an edit. */
	act(a: Act) {
		if (socket?.readyState !== WebSocket.OPEN) {
			this.notice = 'Presses and clocks wait for the room, which is not connected.';
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
			// Older files have none; a list must stay for a preset to be added to it.
			d.presets = next.presets ?? [];
		});
	},
	/** Takes back this client's own last edit, wherever nobody has changed it since. */
	undo() {
		const step = history.undo();
		if (step) play(revert(doc, step.f, step.i));
		settle();
	},
	redo() {
		const step = history.redo();
		if (step) play(revert(doc, step.i, step.f));
		settle();
	}
};
