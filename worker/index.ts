import { newDoc } from '../src/lib/doc';
import { ImportError, parse } from '../src/lib/io';
import { TOKEN, type RoomInfo } from '../src/lib/rooms';
import { identify } from './identity';
export { Registry } from './registry';
export { Room } from './room';

const json = (body: unknown, status = 200) =>
	Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const newToken = () =>
	[...crypto.getRandomValues(new Uint8Array(16))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

// Pages are static assets. Only these paths reach the Worker, and only `/gm` is behind Access.
export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const room = (token: string) => env.ROOM.get(env.ROOM.idFromName(token));

		// Joining needs only the link: /api/rooms/<token>, and /ws on it for the socket.
		const [, token] = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/ws)?$/) ?? [];
		if (token !== undefined) {
			if (!TOKEN.test(token)) return json({ error: 'no such room' }, 404);
			// The request itself, not one rebuilt from its URL: a rebuilt one loses the
			// runtime's upgrade flag, and the object would see a plain GET.
			return room(token).fetch(request);
		}

		if (!url.pathname.startsWith('/gm/api/')) return json({ error: 'not found' }, 404);
		const gm = await identify(request, env, ctx);
		if (!gm) {
			console.log(`refused ${url.pathname}: no verifiable Access identity`);
			return json({ error: 'not signed in as a GM' }, 403);
		}
		// Access cookies ride along on a request from any site, so changes must come from here.
		if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
			return json({ error: 'wrong origin' }, 403);
		}
		const registry = env.REGISTRY.get(env.REGISTRY.idFromName('rooms'));

		if (url.pathname === '/gm/api/rooms') {
			if (request.method === 'GET') return json(await registry.list());
			if (request.method === 'POST') {
				type Body = { name?: unknown; text?: unknown };
				const body = await request.json<Body>().catch((): Body => ({}));
				const name =
					typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled';
				let doc;
				try {
					doc = typeof body.text === 'string' ? parse(body.text) : newDoc();
				} catch (e) {
					return json({ error: e instanceof ImportError ? e.message : 'unreadable' }, 400);
				}
				const info: RoomInfo = { token: newToken(), name, creator: gm, created: Date.now() };
				await room(info.token).init(name, gm, doc);
				await registry.add(info);
				return json(info, 201);
			}
		}

		const [, gone] = url.pathname.match(/^\/gm\/api\/rooms\/([0-9a-f]{32})$/) ?? [];
		if (gone && request.method === 'DELETE') {
			await room(gone).destroy();
			await registry.remove(gone);
			return new Response(null, { status: 204 });
		}
		return json({ error: 'not found' }, 404);
	}
} satisfies ExportedHandler<Env>;
