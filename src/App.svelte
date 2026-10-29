<script lang="ts">
	import { changes } from './lib/agent/changes';
	import { chat } from './lib/agent/client.svelte';
	import { shown, type Doc } from './lib/doc';
	import { ImportError, parse, serialize } from './lib/io';
	import { mod, plain, typing } from './lib/keys';
	import { presence } from './lib/presence.svelte';
	import { session } from './lib/session.svelte';
	import { lang, languages, t, type LangId } from './lib/i18n.svelte';
	import { theme, themes, type ThemeId } from './lib/theme.svelte';
	import { ui } from './lib/ui.svelte';
	import Chat from './components/Chat.svelte';
	import Clocks from './components/Clocks.svelte';
	import Keys from './components/Keys.svelte';
	import Peers from './components/Peers.svelte';
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

	$effect(() => presence.set({ gm: session.gm || undefined }));

	let current = $state('');
	// Falls back to the first character when the open one is deleted.
	const characters = $derived(shown(doc.characters, session.gm));
	const character = $derived(characters.find((c) => c.id === current) ?? characters[0]);
	let picker: HTMLInputElement;
	let keys: Keys;

	function exportFile() {
		// The room, not a chat's draft shown in its place.
		const room = session.room;
		const text = serialize({ ...room, characters: shown(room.characters, session.gm) });
		const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
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
			session.notice = t('Imported {name}. Undo puts the previous session back.', {
				name: file.name
			});
		} catch (e) {
			// The reason is the parser's, which the Worker shares, so it stays English.
			session.notice = t('{name} was not imported: {why}.', {
				name: file.name,
				why: e instanceof ImportError ? e.message : t('unreadable')
			});
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
			const all = characters;
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
			<Peers />
			{#if session.status !== 'open'}
				<span class="status" role="status">
					{session.status === 'missing'
						? t('This room was deleted')
						: session.unsent
							? t('Offline · {n} unsent', { n: session.unsent })
							: t('Offline')}
				</span>
			{/if}
			<!-- The current theme shows as its swatch, laid over the box, whose own text is hidden. -->
			<span class="theme">
				<select
					class="themes"
					value={theme.id}
					aria-label={t('Theme')}
					title={t('Theme')}
					onchange={(e) => (theme.id = e.currentTarget.value as ThemeId)}
				>
					{#each themes as th (th.id)}
						<option value={th.id} data-theme={th.id} title={t(th.name)}>{t(th.name)}</option>
					{/each}
				</select>
				<span class="swatch" data-theme={theme.id} aria-hidden="true">F</span>
			</span>
			<select
				value={lang.id}
				aria-label={t('Language')}
				title={t('Language')}
				onchange={(e) => (lang.id = e.currentTarget.value as LangId)}
			>
				{#each languages as l (l.id)}
					<option value={l.id}>{l.name}</option>
				{/each}
			</select>
			<button disabled={!session.canUndo} onclick={() => session.undo()} title="{mod}Z"
				>{t('Undo')}</button
			>
			<button disabled={!session.canRedo} onclick={() => session.redo()} title="⇧{mod}Z"
				>{t('Redo')}</button
			>
			<button onclick={exportFile} title="{mod}S">{t('Export')}</button>
			<button
				onclick={() => picker.click()}
				title={t('{mod}O, or drop a file anywhere on the page', { mod })}>{t('Import')}</button
			>
			<button
				onclick={() => keys.toggle()}
				aria-label={t('Keyboard shortcuts')}
				title={t('Keyboard shortcuts')}>?</button
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
		<div class="draft" role="region" aria-label={t("Claude's draft")}>
			<details>
				<summary>
					{t(
						chat.changes.lines.length === 1
							? "Claude's draft: {n} change"
							: "Claude's draft: {n} changes",
						{ n: chat.changes.lines.length }
					)}
				</summary>
				<ul>
					{#each chat.changes.lines as line, i (i)}<li>{line}</li>{/each}
				</ul>
			</details>
			{#if chat.waiting}
				<span class="muted">{t('Waiting for the GM…')}</span>
				<button onclick={() => chat.withdraw()}>{t('Take back')}</button>
			{:else}
				<button class="primary" disabled={chat.busy} onclick={() => chat.apply()}
					>{session.gm ? t('Apply') : t('Send to the GM')}</button
				>
			{/if}
			<button disabled={chat.busy} onclick={() => chat.discard()}>{t('Discard')}</button>
		</div>
	{/if}
	{#each asks as p (p.id)}
		<div class="draft" role="region" aria-label={t("A player's draft")}>
			<details>
				<summary>{t("A player's draft: {asked}", { asked: p.asked.split('\n')[0] })}</summary>
				{#if p.asked.includes('\n')}<p class="asked">{p.asked}</p>{/if}
				<ul>
					{#each p.lines as line, i (i)}<li>{line}</li>{/each}
				</ul>
			</details>
			<button
				class="primary"
				onclick={() => {
					// Settled first, so a room that isn't connected keeps it to apply once.
					if (session.settle(p.id, true)) session.land(p.ops);
				}}>{t('Apply')}</button
			>
			<button onclick={() => session.settle(p.id, false)}>{t('Turn down')}</button>
		</div>
	{/each}

	<main>
		<Clocks />

		{#if character}
			{#key character.id}
				<Sheet {character} open={(id) => (current = id)} />
			{/key}
		{:else}
			<p class="empty">
				{t('No characters yet. Press + at the top left to start one from a template, or blank, or')}
				<button class="link" onclick={() => (ui.panel = 'chat')}>{t('ask the chat')}</button>{t(
					'.'
				)}
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
	/* A theme is a circle of its surface with an F in its ink and font. */
	.theme {
		display: grid;
		align-items: center;
	}
	.theme > * {
		grid-area: 1 / 1;
	}
	.themes {
		width: 3rem;
		color: transparent;
	}
	/* Where the list is the system's menu, each name in its theme's colours. */
	.themes option {
		background: var(--surface);
		color: var(--ink);
	}
	.swatch {
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		margin-left: 0.3rem;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: var(--surface);
		color: var(--ink);
		font: 600 0.8rem/1 var(--font-body);
		pointer-events: none;
	}
	/* System is whichever the OS asks for, so it shows Light's and Dark's surfaces at once. */
	.swatch[data-theme='system'] {
		background: linear-gradient(135deg, #fbfaf5 50%, #1b1e19 50%);
		color: var(--muted);
	}
	/* Where the list is drawn by the page, it is a column of circles too, named on hover. */
	@supports (appearance: base-select) {
		.themes option {
			display: grid;
			place-items: center;
			width: 1.4rem;
			height: 1.4rem;
			margin: 0.3rem auto;
			padding: 0;
			border: 1px solid var(--line);
			border-radius: 50%;
			font-size: 0;
		}
		.themes option::before {
			content: 'F';
			font: 600 0.8rem/1 var(--font-body);
		}
		.themes option[data-theme='system'] {
			background: linear-gradient(135deg, #fbfaf5 50%, #1b1e19 50%);
			color: var(--muted);
		}
		.themes option:is(:hover, :focus-visible) {
			border-color: var(--accent);
		}
		.themes option:checked {
			outline: 2px solid var(--accent);
			outline-offset: 1px;
		}
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
