<script lang="ts">
	import type { RoomInfo } from './lib/rooms';

	let rooms = $state<RoomInfo[] | null>(null);
	let error = $state('');
	let name = $state('');
	let from = $state<'blank' | 'browser' | 'file'>('blank');
	let file = $state<File | undefined>();
	let busy = $state(false);
	let copied = $state('');

	// This browser's session from before rooms, on the same origin, so it can move into one.
	const saved = (() => {
		try {
			return localStorage.getItem('sheet.doc');
		} catch {
			return null;
		}
	})();

	const link = (r: RoomInfo) => `${location.origin}/r/${r.token}`;

	async function call(method: string, path: string, body?: unknown) {
		const res = await fetch(path, {
			method,
			headers: body ? { 'content-type': 'application/json' } : {},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (res.status === 204) return null;
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error ?? `the server answered ${res.status}`);
		return data;
	}

	const fail = (e: unknown) => (error = e instanceof Error ? e.message : String(e));

	call('GET', '/gm/api/rooms').then((r) => (rooms = r), fail);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			const text = from === 'browser' ? saved : from === 'file' ? await file?.text() : undefined;
			if (from !== 'blank' && !text) throw new Error('choose a file first');
			const r: RoomInfo = await call('POST', '/gm/api/rooms', { name, text });
			rooms = [r, ...(rooms ?? [])];
			name = '';
		} catch (e) {
			fail(e);
		}
		busy = false;
	}

	async function remove(r: RoomInfo) {
		if (!confirm(`Delete "${r.name}" for everyone at the table? This cannot be undone.`)) return;
		try {
			await call('DELETE', `/gm/api/rooms/${r.token}`);
			rooms = rooms!.filter((x) => x.token !== r.token);
		} catch (e) {
			fail(e);
		}
	}

	async function copy(r: RoomInfo) {
		await navigator.clipboard.writeText(link(r));
		copied = r.token;
	}
</script>

<main class="page">
	<h1>Rooms</h1>
	<p class="muted">
		Players need only a room's link, and anyone with it can edit. Send it to your table, not
		further.
	</p>

	<form class="panel" onsubmit={create}>
		<input bind:value={name} placeholder="Room name" aria-label="Room name" />
		<fieldset>
			<label><input type="radio" bind:group={from} value="blank" /> Blank</label>
			{#if saved}
				<label>
					<input type="radio" bind:group={from} value="browser" /> This browser's saved session
				</label>
			{/if}
			<label><input type="radio" bind:group={from} value="file" /> From an exported file</label>
			{#if from === 'file'}
				<input
					type="file"
					accept="application/json,.json"
					onchange={(e) => (file = e.currentTarget.files?.[0])}
				/>
			{/if}
		</fieldset>
		<button disabled={busy}>Make room</button>
	</form>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if rooms === null}
		{#if !error}<p class="muted">Loading…</p>{/if}
	{:else if !rooms.length}
		<p class="muted">No rooms yet.</p>
	{:else}
		<ul>
			{#each rooms as r (r.token)}
				<li>
					<!-- `?gm` makes the page ask Access who it is, so its Apply needs no approval. -->
					<a href="/r/{r.token}?gm">{r.name}</a>
					<span class="muted">{r.creator} · {new Date(r.created).toLocaleDateString()}</span>
					<span class="actions">
						<button onclick={() => copy(r)}>{copied === r.token ? 'Copied' : 'Copy link'}</button>
						<button onclick={() => remove(r)}>Delete</button>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.page {
		max-width: 40rem;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	h1 {
		font-family: var(--font-head);
		letter-spacing: var(--label-tracking);
	}
	form {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;
	}
	fieldset {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		border: none;
	}
	form > button {
		justify-self: start;
	}
	ul {
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--line);
	}
	a {
		color: var(--accent);
	}
	.actions {
		display: flex;
		gap: 0.35rem;
		margin-left: auto;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--accent);
	}
</style>
