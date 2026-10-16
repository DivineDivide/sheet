<script lang="ts">
	import { newId, type Doc } from '../lib/doc';
	import { session } from '../lib/session.svelte';
	import Builder from './Builder.svelte';

	const doc = $derived(session.doc);

	let chosen = $state('');
	const template = $derived(doc.templates.find((t) => t.id === chosen) ?? doc.templates[0]);
	const users = $derived(doc.characters.filter((c) => c.template === template?.id).length);

	const live = (d: Doc) => d.templates.find((t) => t.id === template.id)!;
</script>

<section class="templates">
	<nav>
		{#each doc.templates as t (t.id)}
			<button class:active={t.id === template?.id} onclick={() => (chosen = t.id)}>{t.name}</button>
		{/each}
		<button
			onclick={() => {
				const id = newId();
				session.change((d) => d.templates.push({ id, name: 'New template', fields: [] }));
				chosen = id;
			}}>+ Template</button
		>
	</nav>

	{#if template}
		<header>
			<input
				class="name"
				value={template.name}
				aria-label="Template name"
				onchange={(e) => {
					const text = e.currentTarget.value.trim();
					if (text) session.change((d) => (live(d).name = text));
				}}
			/>
			<span class="muted">used by {users} character{users === 1 ? '' : 's'}</span>
			<button
				class="x"
				disabled={users > 0 || doc.templates.length === 1}
				title={users > 0 ? 'Characters still use this template' : 'Delete template'}
				aria-label="Delete template {template.name}"
				onclick={() =>
					session.change((d) => (d.templates = d.templates.filter((t) => t.id !== template.id)))}
				>×</button
			>
		</header>

		{#key template.id}
			<Builder {template} />
		{/key}
	{/if}
</section>

<style>
	.templates {
		display: grid;
		gap: 0.75rem;
		max-width: 72rem;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	nav .active {
		border-color: var(--accent);
		color: var(--accent);
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.name {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.muted {
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
