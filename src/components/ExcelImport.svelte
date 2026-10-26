<script lang="ts">
	import type { Character } from '../lib/doc';
	import { fromBook, type Imported } from '../lib/excel';
	import { shrink } from '../lib/picture';
	import { session } from '../lib/session.svelte';
	import { readBook } from '../lib/xlsx';
	import Preview from './Preview.svelte';

	// A character from an .xlsx, shown before it is added: what each tab holds, what was
	// left out, and each formula against Excel's own result.
	let { onadd }: { onadd: (c: Character) => void } = $props();

	let picker = $state<HTMLInputElement>();
	let dialog = $state<HTMLDialogElement>();
	let busy = $state(false);
	let found = $state<Imported | null>(null);
	let name = $state('');

	async function take(file: File | undefined) {
		if (!file) return;
		busy = true;
		try {
			const { book, pictures } = await readBook(file);
			const shrunk = await Promise.all(pictures.map((p) => shrink(p).catch(() => '')));
			found = fromBook(book, shrunk);
			name = found.character.name;
			dialog!.showModal();
		} catch (e) {
			session.notice = `${file.name} could not be imported: ${e instanceof Error ? e.message : e}.`;
		}
		busy = false;
	}

	function add() {
		onadd({ ...found!.character, name: name.trim() || found!.character.name });
		dialog!.close();
		found = null;
	}
</script>

<button class="from" disabled={busy} onclick={() => picker?.click()}>
	{busy ? 'Reading…' : 'From an Excel file…'}
</button>
<input
	bind:this={picker}
	type="file"
	accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	hidden
	onchange={(e) => {
		take(e.currentTarget.files?.[0]);
		e.currentTarget.value = '';
	}}
/>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	aria-labelledby="import-title"
	onclick={(e) => e.target === dialog && dialog.close()}
	onclose={() => (found = null)}
>
	{#if found}
		{@const c = found.character}
		<div class="inner">
			<h2 id="import-title">Import from Excel</h2>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					add();
				}}
			>
				<input bind:value={name} aria-label="Name" />
				<button type="submit">Add character</button>
			</form>

			<div class="tabs">
				{#each c.tabs as tab (tab.id)}
					{@const fields = c.fields.filter((f) => f.tab === tab.id)}
					<section>
						<Preview layout={{ tabs: [tab], fields }} />
						<h3>{tab.name}</h3>
						<p class="muted">{fields.map((f) => `${f.label} · ${f.kind}`).join(', ')}</p>
					</section>
				{/each}
			</div>

			{#if found.checks.length}
				<h3>Formulas</h3>
				<ul>
					{#each found.checks as k (k.sheet + k.at)}
						<li class:bad={k.ok === false}>
							<code>{k.formula}</code>
							<span class="muted">
								{k.sheet}!{k.at} · Excel {k.excel || '—'}, here {k.ours}
								{k.ok === null ? '' : k.ok ? '✓' : '✗ differs'}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			<h3>Left out</h3>
			{#if found.left.length}
				<p class="muted">No field took these cells. Copy what you need by hand.</p>
				<ul>
					{#each found.left as l (l.sheet + l.at)}
						<li><span class="muted">{l.sheet}!{l.at}</span> {l.text}</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">Nothing: every cell with something in it became part of a field.</p>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	.from {
		justify-self: start;
	}
	dialog {
		width: min(52rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface);
		color: var(--ink);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	.inner {
		display: grid;
		gap: 0.6rem;
		padding: 1rem 1.25rem 1.25rem;
	}
	h2,
	h3 {
		margin: 0;
		font: inherit;
		font-family: var(--font-head);
		font-weight: 600;
	}
	h2 {
		font-size: 1.1rem;
	}
	h3 {
		font-size: 0.95rem;
	}
	form {
		display: flex;
		gap: 0.4rem;
	}
	form input {
		flex: 1;
	}
	.tabs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.75rem;
	}
	section {
		display: grid;
		gap: 0.25rem;
		align-content: start;
	}
	ul {
		display: grid;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	code {
		font-family: var(--mono);
		font-size: 0.85rem;
	}
	.bad code,
	.bad .muted {
		color: var(--accent);
	}
	.muted {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
</style>
