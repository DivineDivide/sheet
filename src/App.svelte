<script lang="ts">
	import { changes } from './lib/agent/changes';
	import { chat } from './lib/agent/client.svelte';
	import type { Doc } from './lib/doc';
	import { ImportError, parse, serialize } from './lib/io';
	import { mod, plain, typing } from './lib/keys';
	import { session } from './lib/session.svelte';
	import { theme, themes, type ThemeId } from './lib/theme.svelte';
	import { ui } from './lib/ui.svelte';
	import Chat from './components/Chat.svelte';
	import Clocks from './components/Clocks.svelte';
	import Keys from './components/Keys.svelte';
	import Roster from './components/Roster.svelte';
	import Sheet from './components/Sheet.svelte';
	import Toast from './components/Toast.svelte';

	const doc = $derived(session.doc);
	// A player's drafts, for a GM to apply or turn down, each with its changes in words.
	const asks = $derived(
		session.gm
			? session.proposals.map((p) => ({
					...p,
					lines: changes($state.snapshot(session.room) as Doc, p.ops).lines
				}))
			: []
	);

	let current = $state('');
	// Falls back to the first character when the open one is deleted.
	const character = $derived(doc.characters.find((c) => c.id === current) ?? doc.characters[0]);
	let picker: HTMLInputElement;
	let keys: Keys;

	function exportFile() {
		const url = URL.createObjectURL(new Blob([serialize(doc)], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `sheet-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		// Revoked a moment later: some browsers cancel a download whose URL dies in the same tick.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function importFile(file: File | undefined) {
		if (!file) return;
		try {
			session.replace(parse(await file.text()));
			session.notice = `Imported ${file.name}. Undo puts the previous session back.`;
		} catch (e) {
			session.notice = `${file.name} was not imported: ${e instanceof ImportError ? e.message : 'unreadable'}.`;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		const key = e.key.toLowerCase();
		if (e.metaKey || e.ctrlKey) {
			if (key === 's') exportFile();
			else if (key === 'o') picker.click();
			// Inside a text box, leave undo to the browser's own text editing.
			else if (typing(e)) return;
			else if (key === 'z' && !e.shiftKey) session.undo();
			else if ((key === 'z' && e.shiftKey) || key === 'y') session.redo();
			else return;
		} else if (key === 'escape' && typing(e)) {
			// Blurring commits the box, like Enter or a click elsewhere, and frees the single keys.
			(e.target as HTMLElement).blur();
		} else if (!plain(e)) {
			return;
		} else if (key === '?') {
			keys.toggle();
		} else if ((key === 'n' || key === 'b') && doc.clocks.length) {
			const k = doc.clocks[0];
			session.act(
				key === 'n' ? { tick: { clock: k.id, at: k.now } } : { back: { clock: k.id, at: k.now } }
			);
		} else if ((key === '[' || key === ']') && character) {
			const all = doc.characters;
			const i = all.findIndex((c) => c.id === character.id) + (key === ']' ? 1 : -1);
			current = all[(i + all.length) % all.length].id;
		} else {
			return;
		}
		e.preventDefault();
	}
</script>

<svelte:window
	{onkeydown}
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => {
		e.preventDefault();
		importFile(e.dataTransfer?.files[0]);
	}}
/>

<div class="app">
	<header class="bar">
		<strong>{session.name}</strong>
		<Roster bind:current {character} />
		<div class="tools">
			{#if session.status !== 'open'}
				<span class="status" role="status">
					{session.status === 'missing'
						? 'This room was deleted'
						: `Offline${session.unsent ? ` · ${session.unsent} unsent` : ''}`}
				</span>
			{/if}
			<select
				value={theme.id}
				aria-label="Theme"
				title="Theme"
				onchange={(e) => (theme.id = e.currentTarget.value as ThemeId)}
			>
				{#each themes as t (t.id)}
					<option value={t.id}>{t.name}</option>
				{/each}
			</select>
			<button disabled={!session.canUndo} onclick={() => session.undo()} title="{mod}Z">Undo</button
			>
			<button disabled={!session.canRedo} onclick={() => session.redo()} title="⇧{mod}Z"
				>Redo</button
			>
			<button onclick={exportFile} title="{mod}S">Export</button>
			<button onclick={() => picker.click()} title="{mod}O, or drop a file anywhere on the page"
				>Import</button
			>
			<button
				onclick={() => keys.toggle()}
				aria-label="Keyboard shortcuts"
				title="Keyboard shortcuts">?</button
			>
			<input
				bind:this={picker}
				type="file"
				accept="application/json,.json"
				hidden
				onchange={(e) => {
					importFile(e.currentTarget.files?.[0]);
					e.currentTarget.value = '';
				}}
			/>
		</div>
	</header>

	<Keys bind:this={keys} />

	<Toast />

	{#if chat.changes}
		<div class="draft" role="region" aria-label="Claude's draft">
			<details>
				<summary>
					Claude's draft: {chat.changes.lines.length}
					{chat.changes.lines.length === 1 ? 'change' : 'changes'}
				</summary>
				<ul>
					{#each chat.changes.lines as line, i (i)}<li>{line}</li>{/each}
				</ul>
			</details>
			{#if chat.waiting}
				<span class="muted">Waiting for the GM…</span>
				<button onclick={() => chat.withdraw()}>Take back</button>
			{:else}
				<button class="primary" disabled={chat.busy} onclick={() => chat.apply()}
					>{session.gm ? 'Apply' : 'Send to the GM'}</button
				>
			{/if}
			<button disabled={chat.busy} onclick={() => chat.discard()}>Discard</button>
		</div>
	{/if}
	{#each asks as p (p.id)}
		<div class="draft" role="region" aria-label="A player's draft">
			<details>
				<summary>A player's draft: {p.asked.split('\n')[0]}</summary>
				{#if p.asked.includes('\n')}<p class="asked">{p.asked}</p>{/if}
				<ul>
					{#each p.lines as line, i (i)}<li>{line}</li>{/each}
				</ul>
			</details>
			<button
				class="primary"
				onclick={() => {
					session.land(p.ops);
					session.settle(p.id, true);
				}}>Apply</button
			>
			<button onclick={() => session.settle(p.id, false)}>Turn down</button>
		</div>
	{/each}

	<main>
		<Clocks />

		{#if character}
			{#key character.id}
				<Sheet {character} />
			{/key}
		{:else}
			<p class="empty">
				No characters yet. Press + at the top left to start one from a template, or blank, or
				<button class="link" onclick={() => (ui.panel = 'chat')}>ask the chat</button>.
			</p>
		{/if}

		{#if ui.panel === 'chat'}<Chat />{/if}
	</main>
</div>

<style>
	/* The window, never scrolled: the sheet's canvas takes whatever the bars leave. */
	.app {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
	.bar {
		z-index: 3;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--chrome);
	}
	strong {
		font-family: var(--font-head);
		letter-spacing: var(--label-tracking);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-left: auto;
	}
	.status {
		align-self: center;
		margin-right: 0.5rem;
		color: var(--accent);
	}
	main {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 1;
		min-height: 0;
		padding: 0.75rem 1rem 1rem;
	}
	.empty {
		color: var(--muted);
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		text-decoration: underline;
	}
	.draft {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.75rem;
		padding: 0.4rem 1rem;
		border-bottom: 1px solid var(--accent);
		background: color-mix(in oklab, var(--accent) 10%, var(--chrome));
	}
	.draft details {
		flex: 1;
		min-width: 12rem;
	}
	.draft summary {
		cursor: pointer;
	}
	.draft ul {
		margin: 0.3rem 0 0;
		padding-left: 1.2rem;
	}
	.asked {
		margin: 0.3rem 0 0;
		color: var(--muted);
		white-space: pre-wrap;
	}
	.primary {
		border-color: var(--accent);
		color: var(--accent);
	}
	.muted {
		color: var(--muted);
	}
</style>
