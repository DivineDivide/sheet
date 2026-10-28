// Rooms on a local dev server, made and deleted as `/gm` does; `vite dev` stubs Access.
// SHEET_URL picks the server: a worktree's own runs on another port than the user's :7476.
export const base = process.env.SHEET_URL ?? 'http://localhost:7476';

const headers = { origin: base, 'content-type': 'application/json' };

/** A new room holding `doc`, a `Doc` object; resolves to its token. */
export async function makeRoom(name, doc) {
	const res = await fetch(`${base}/gm/api/rooms`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ name, text: JSON.stringify(doc) })
	});
	const body = await res.json();
	if (!body.token) throw new Error(`room refused: ${JSON.stringify(body)}`);
	return body.token;
}

export const dropRoom = async (token) =>
	(await fetch(`${base}/gm/api/rooms/${token}`, { method: 'DELETE', headers })).status;
