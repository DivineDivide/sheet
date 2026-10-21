<script lang="ts">
	import { fly } from 'svelte/transition';
	import { kinds, type Character, type Field, type Kind } from '../lib/doc';
	import { mod } from '../lib/keys';
	import { ui, type Panel } from '../lib/ui.svelte';
	import Icon from './Icon.svelte';
	import { hints } from './Palette.svelte';
	import Statuses from './Statuses.svelte';

	let {
		character,
		field,
		laying,
		editField,
		remove,
		saveTemplate
	}: {
		character: Character;
		field: Field | undefined;
		laying: boolean;
		editField: (id: string, fn: (f: Field) => void) => void;
		remove: (id: string) => void;
		saveTemplate: (name: string) => void;
	} = $props();

	const names: Record<Panel, string> = {
		field: 'Selected field',
		statuses: 'Statuses',
		template: 'Save as template'
	};
	const mode = $derived(laying ? 'edit' : 'play');
	const panels = $derived<Panel[]>(laying ? ['field', 'statuses', 'template'] : ['statuses']);
	const open = $derived(ui.panel[mode]);
	const toggle = (p: Panel) => (ui.panel[mode] = open === p ? null : p);

	// Selecting a field brings its inspector up, even after it was closed.
	const selectedId = $derived(field?.id);
	$effect(() => {
		if (selectedId) ui.panel.edit = 'field';
	});

	let templateName = $state('');
</script>

<aside class="rail">
	<div class="icons">
		{#each panels as p (p)}
			<button
				class="dot"
				aria-label={names[p]}
				title={names[p]}
				aria-expanded={open === p}
				onclick={() => toggle(p)}><Icon name={p} /></button
			>
		{/each}
	</div>

	{#if open && panels.includes(open)}
		<section class="panel" transition:fly={{ x: 16, duration: 160 }}>
			{#if open === 'field'}
				<h2>Selected</h2>
				{#if field}
					<label>
						<span class="muted">Label</span>
						<input
							value={field.label}
							onchange={(e) => {
								const text = e.currentTarget.value.trim();
								if (text) editField(field.id, (f) => (f.label = text));
							}}
						/>
					</label>
					<label>
						<span class="muted">Kind</span>
						<select
							value={field.kind}
							onchange={(e) => editField(field.id, (f) => (f.kind = e.currentTarget.value as Kind))}
						>
							{#each kinds as kind (kind)}
								<option value={kind}>{kind}</option>
							{/each}
						</select>
					</label>
					{#if character.tabs.length > 1}
						<label>
							<span class="muted">Tab</span>
							<select
								value={field.tab}
								onchange={(e) => editField(field.id, (f) => (f.tab = e.currentTarget.value))}
							>
								{#each character.tabs as t (t.id)}
									<option value={t.id}>{t.name}</option>
								{/each}
							</select>
						</label>
					{/if}
					<p class="muted">
						{hints[field.kind]} · {field.box.w}×{field.box.h} at {field.box.x}, {field.box.y}
					</p>
					<button onclick={() => remove(field.id)}>Delete field</button>
					<p class="muted">
						Changing a kind shows this field blank until it is changed back or undone.
					</p>
				{:else}
					<p class="muted">
						Drag a kind in from the left. Drag a field to move it and its corner to resize it. With
						a field selected, arrow keys nudge it, Shift with the arrows resizes it, Delete removes
						it, and {mod}C copies it to paste with {mod}V, here or on another character.
					</p>
				{/if}
			{:else if open === 'statuses'}
				<Statuses {character} />
			{:else}
				<h2>Template</h2>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						saveTemplate(templateName.trim() || character.name);
						templateName = '';
					}}
				>
					<input
						bind:value={templateName}
						placeholder={character.name}
						aria-label="Template name"
					/>
					<button type="submit">Save</button>
				</form>
				<p class="muted">
					Copies these tabs and fields, without values, to start new characters from.
				</p>
			{/if}
		</section>
	{/if}
</aside>

<style>
	/* Empty space in the rail is canvas: only its icons and panel take the pointer. */
	.rail {
		position: absolute;
		top: 12px;
		right: 12px;
		bottom: 12px;
		display: flex;
		flex-direction: row-reverse;
		align-items: flex-start;
		gap: 0.5rem;
		pointer-events: none;
	}
	.icons,
	.panel {
		pointer-events: auto;
		cursor: auto;
	}
	.icons {
		display: grid;
		gap: 0.45rem;
		padding: 0.4rem 0;
	}
	.panel {
		display: grid;
		gap: 0.5rem;
		width: 17rem;
		max-height: 100%;
		padding: 0.75rem;
		overflow: auto;
	}
	h2 {
		margin: 0;
		font: inherit;
		font-family: var(--font-head);
		font-size: 0.8rem;
		letter-spacing: var(--label-tracking);
		color: var(--muted);
	}
	label {
		display: grid;
		gap: 0.2rem;
	}
	form {
		display: flex;
		gap: 0.3rem;
	}
	form input {
		flex: 1;
		width: 0;
	}
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
