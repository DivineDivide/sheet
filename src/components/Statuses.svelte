<script lang="ts">
	import { describe, newId, phase, type Character } from '../lib/doc';
	import { session } from '../lib/session.svelte';

	let { character }: { character: Character } = $props();

	const doc = $derived(session.doc);

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
</script>

<section class="statuses">
	<h2>Statuses</h2>
	{#if character.statuses.length}
		<ul>
			{#each character.statuses as s (s.id)}
				{@const k = doc.clocks.find((k) => k.id === s.clock)!}
				<li class={phase(s, k)}>
					<span class="sname">{s.name}</span>
					<span class="left">{describe(s, doc.clocks)}</span>
					<button
						class="x"
						aria-label="Remove {s.name}"
						onclick={() => edit((c) => (c.statuses = c.statuses.filter((t) => t.id !== s.id)))}
						>×</button
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">None on {character.name}.</p>
	{/if}
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

<style>
	.statuses {
		display: grid;
		gap: 0.5rem;
	}
	h2 {
		margin: 0;
		font: inherit;
		font-family: var(--font-head);
		font-size: 0.8rem;
		letter-spacing: var(--label-tracking);
		color: var(--muted);
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
	.muted {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	/* Zero basis, so the name box gives up width to the rest of the row. */
	form input:first-child {
		flex: 1;
		width: 0;
		min-width: 6rem;
	}
	.short {
		width: 5ch;
	}
</style>
