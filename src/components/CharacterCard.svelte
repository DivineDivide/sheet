<script lang="ts">
	import { left, newId, phase, type Character } from '../lib/doc';
	import { readingOrder, resolve } from '../lib/layout';
	import { session } from '../lib/session.svelte';
	import FieldValue from './FieldValue.svelte';

	let { character }: { character: Character } = $props();

	const doc = $derived(session.doc);
	const template = $derived(doc.templates.find((t) => t.id === character.template)!);
	const boxes = $derived(resolve(template.fields));
	const order = $derived(readingOrder(boxes));

	// View state, not document state: widening a card is not an undo step.
	let wide = $state(false);
	let name = $state('');
	let lasts = $state('');
	let clockId = $state('');
	// Falls back to the first clock if the chosen one is deleted.
	const clock = $derived(doc.clocks.find((k) => k.id === clockId) ?? doc.clocks[0]);

	function edit(fn: (c: Character) => void) {
		session.change((d) => fn(d.characters.find((c) => c.id === character.id)!));
	}

	function apply() {
		const n = Number(lasts);
		const duration = lasts.trim() !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
		if (!name.trim()) return;
		edit((c) =>
			c.statuses.push({
				id: newId(),
				name: name.trim(),
				clock: clock.id,
				since: clock.now,
				...(duration !== undefined && { lasts: duration })
			})
		);
		name = '';
		lasts = '';
	}

	function describe(s: Character['statuses'][number]) {
		const k = doc.clocks.find((k) => k.id === s.clock)!;
		const on = doc.clocks.length > 1 ? ` · ${k.name}` : '';
		switch (phase(s, k)) {
			case 'pending':
				return `from ${k.name} ${s.since}`;
			case 'expired':
				return `expired${on}`;
			case 'active':
				return s.lasts === undefined ? `until removed${on}` : `${left(s, k)} left${on}`;
		}
	}
</script>

<article class="card" class:wide>
	<header>
		<input
			class="name"
			value={character.name}
			aria-label="Character name"
			onchange={(e) => {
				const text = e.currentTarget.value.trim();
				if (text) edit((c) => (c.name = text));
			}}
		/>
		<span class="template">{template.name}</span>
		<button
			class="x"
			aria-pressed={wide}
			aria-label={wide ? 'Narrow card' : 'Widen card'}
			title={wide ? 'Narrow card' : 'Widen card'}
			onclick={() => (wide = !wide)}>{wide ? '⇥⇤' : '⇤⇥'}</button
		>
		<button
			class="x"
			aria-label="Delete {character.name}"
			onclick={() =>
				session.change((d) => (d.characters = d.characters.filter((c) => c.id !== character.id)))}
			>×</button
		>
	</header>

	<div class="layout">
		{#each template.fields as field (field.id)}
			{@const b = boxes.get(field.id)!}
			<div
				class="slot"
				style:--x={b.x + 1}
				style:--w={b.w}
				style:--y={b.y + 1}
				style:--h={b.h}
				style:--order={order.indexOf(field.id)}
			>
				<FieldValue {character} {field} />
			</div>
		{/each}
	</div>

	<section class="statuses">
		<span class="label">Statuses</span>
		<ul>
			{#each character.statuses as s (s.id)}
				{@const k = doc.clocks.find((k) => k.id === s.clock)!}
				<li class={phase(s, k)}>
					<span class="sname">{s.name}</span>
					<span class="left">{describe(s)}</span>
					<button
						class="x"
						aria-label="Remove {s.name}"
						onclick={() => edit((c) => (c.statuses = c.statuses.filter((t) => t.id !== s.id)))}
						>×</button
					>
				</li>
			{/each}
		</ul>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				apply();
			}}
		>
			<input bind:value={name} placeholder="Status" aria-label="Status name" />
			<input
				class="short"
				bind:value={lasts}
				inputmode="numeric"
				placeholder="∞"
				aria-label="Lasts how many"
				title="How many ticks it lasts. Leave empty to last until removed."
			/>
			{#if doc.clocks.length > 1}
				<select
					value={clock.id}
					aria-label="Runs on clock"
					onchange={(e) => (clockId = e.currentTarget.value)}
				>
					{#each doc.clocks as k (k.id)}
						<option value={k.id}>{k.name}</option>
					{/each}
				</select>
			{/if}
			<button type="submit">Apply</button>
		</form>
	</section>
</article>

<style>
	.card {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		align-content: start;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--surface);
		container-type: inline-size;
	}
	.card.wide {
		grid-column: 1 / -1;
		grid-template-columns: minmax(0, 64rem);
	}
	/* Narrow cards stack fields in reading order; the builder's layout needs room. */
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem 1rem;
	}
	.slot {
		order: var(--order);
		min-width: 0;
	}
	@container (min-width: 36rem) {
		.layout {
			grid-template-columns: repeat(12, minmax(0, 1fr));
		}
		.slot {
			grid-column: var(--x) / span var(--w);
			grid-row: var(--y) / span var(--h);
		}
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.name {
		flex: 1;
		min-width: 0;
		border-color: transparent;
		background: transparent;
		font-size: 1.1rem;
		font-weight: 600;
	}
	.template,
	.label {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.statuses {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--line);
	}
	ul {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.sname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.left {
		margin-left: auto;
		white-space: nowrap;
		font-family: var(--mono);
		font-size: 0.8rem;
		color: var(--accent);
	}
	li.expired .sname {
		text-decoration: line-through;
	}
	li.expired,
	li.pending {
		opacity: 0.45;
	}
	li.expired .left,
	li.pending .left {
		color: var(--muted);
	}
	form {
		display: flex;
		gap: 0.3rem;
	}
	/* Zero basis, so the name box gives up width to the rest of the row. */
	form input:first-child {
		flex: 1;
		width: 0;
	}
	.short {
		width: 5ch;
	}
</style>
