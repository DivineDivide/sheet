<script lang="ts">
	import { blank, newId } from './lib/doc';
	import { ImportError, parse, serialize } from './lib/io';
	import { session } from './lib/session.svelte';
	import CharacterCard from './components/CharacterCard.svelte';
	import Clocks from './components/Clocks.svelte';
	import Templates from './components/Templates.svelte';

	const doc = $derived(session.doc);

	let view = $state<'play' | 'templates'>('play');
	let newName = $state('');
	let newTemplate = $state('');
	let picker: HTMLInputElement;

	function addCharacter() {
		const template = doc.templates.find((t) => t.id === newTemplate) ?? doc.templates[0];
		const name = newName.trim() || `Character ${doc.characters.length + 1}`;
		session.change((d) =>
			d.characters.push({
				id: newId(),
				name,
				template: template.id,
				values: Object.fromEntries(template.fields.map((f) => [f.id, blank(f.kind)])),
				statuses: []
			})
		);
		newName = '';
	}

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
		// Inside a text box, leave undo to the browser's own text editing.
		const inField = e.target instanceof Element && e.target.closest('input, textarea, select');
		if (inField || !(e.metaKey || e.ctrlKey)) return;
		const key = e.key.toLowerCase();
		if (key === 'z' && !e.shiftKey) session.undo();
		else if ((key === 'z' && e.shiftKey) || key === 'y') session.redo();
		else return;
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

<header class="bar">
	<strong>sheet</strong>
	<nav>
		<button class:active={view === 'play'} onclick={() => (view = 'play')}>Play</button>
		<button class:active={view === 'templates'} onclick={() => (view = 'templates')}
			>Templates</button
		>
	</nav>
	<div class="tools">
		<button disabled={!session.canUndo} onclick={() => session.undo()} title="⌘Z">Undo</button>
		<button disabled={!session.canRedo} onclick={() => session.redo()} title="⇧⌘Z">Redo</button>
		<button onclick={exportFile}>Export</button>
		<button onclick={() => picker.click()} title="Or drop a file anywhere on the page"
			>Import</button
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

{#if session.notice}
	<p class="notice">
		{session.notice}
		<button class="x" aria-label="Dismiss" onclick={() => (session.notice = null)}>×</button>
	</p>
{/if}

<main>
	<Clocks />

	{#if view === 'play'}
		<form
			class="add"
			onsubmit={(e) => {
				e.preventDefault();
				addCharacter();
			}}
		>
			<input bind:value={newName} placeholder="New character" aria-label="New character name" />
			{#if doc.templates.length > 1}
				<select bind:value={newTemplate} aria-label="Template">
					{#each doc.templates as t (t.id)}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
			{/if}
			<button type="submit">Add</button>
		</form>

		{#if doc.characters.length}
			<div class="party">
				{#each doc.characters as character (character.id)}
					<CharacterCard {character} />
				{/each}
			</div>
		{:else}
			<p class="empty">
				No characters yet. Add one above, or shape the sheet first under Templates.
			</p>
		{/if}
	{:else}
		<Templates />
	{/if}
</main>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--chrome);
	}
	strong {
		font-family: var(--mono);
	}
	nav,
	.tools {
		display: flex;
		gap: 0.35rem;
	}
	.tools {
		margin-left: auto;
	}
	nav .active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.notice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.5rem 1rem;
		background: color-mix(in oklab, var(--accent) 12%, var(--page));
	}
	main {
		display: grid;
		gap: 1rem;
		padding: 1rem;
	}
	.add {
		display: flex;
		gap: 0.35rem;
		max-width: 30rem;
	}
	.add input {
		flex: 1;
		min-width: 0;
	}
	.party {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
		gap: 0.75rem;
		align-items: start;
	}
	.empty {
		color: var(--muted);
	}
</style>
