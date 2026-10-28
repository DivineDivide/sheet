import type { Peer, Presence } from './presence';
import { session } from './session.svelte';

// Apart from `session`, so presence never enters the doc or undo.
const NAME = 'sheet.name';

function storedName(): string {
	try {
		return localStorage.getItem(NAME) ?? '';
	} catch {
		return '';
	}
}

let me = $state('');
let list = $state.raw<Peer[]>([]);
let name = $state(storedName());
let mine: Presence = { name: name || undefined };
let sent = '';
let timer: ReturnType<typeof setTimeout> | undefined;

// Batched, so focus moving from one box to the next is one message, not two.
function flush() {
	timer = undefined;
	const text = JSON.stringify(mine);
	if (text === sent) return;
	sent = text;
	session.present(mine);
}

session.onPeers = (m) => {
	if (m.t === 'peers') {
		me = m.me;
		list = m.list;
		// A new connection: the room knows nothing of this person yet.
		sent = '';
		flush();
	} else if (m.t === 'peer') {
		const known = list.some((p) => p.who === m.peer.who);
		list = known ? list.map((p) => (p.who === m.peer.who ? m.peer : p)) : [...list, m.peer];
	} else {
		list = list.filter((p) => p.who !== m.who);
	}
};

export const presence = {
	/** Everyone else here, in the order they came; nobody while offline. */
	get others(): Peer[] {
		return session.status === 'open' ? list.filter((p) => p.who !== me) : [];
	},
	/** This person, as the others see them. */
	get self(): Peer | null {
		const color = list.find((p) => p.who === me)?.color;
		if (color === undefined || session.status !== 'open') return null;
		return { who: me, color, name: name || undefined, gm: session.gm || undefined };
	},
	get name() {
		return name;
	},
	set name(text: string) {
		name = text.trim().slice(0, 40);
		try {
			localStorage.setItem(NAME, name);
		} catch {}
		this.set({ name: name || undefined });
	},
	set(patch: Presence) {
		mine = { ...mine, ...patch };
		timer ??= setTimeout(flush, 50);
	}
};
