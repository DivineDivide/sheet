<script lang="ts">
	import { newId, phase, type Doc } from '../lib/doc';
	import { session } from '../lib/session.svelte';

	const doc = $derived(session.doc);
	const inUse = (id: string) => doc.characters.some((c) => c.statuses.some((s) => s.clock === id));
	const expired = $derived(
		doc.characters.flatMap((c) =>
			c.statuses.filter((s) => {
				const clock = doc.clocks.find((k) => k.id === s.clock);
				return clock && phase(s, clock) === 'expired';
			})
		).length
	);

	const clockOf = (d: Doc, id: string) => d.clocks.find((k) => k.id === id)!;
</script>

<section class="clocks">
	{#each doc.clocks as clock, i (clock.id)}
		<div class="clock">
			<input
				class="name"
				value={clock.name}
				aria-label="Clock name"
				onchange={(e) => {
					const name = e.currentTarget.value.trim();
					if (name) session.change((d) => (clockOf(d, clock.id).name = name));
				}}
			/>
			<button
				title={i === 0 ? 'B' : undefined}
				onclick={() => session.change((d) => clockOf(d, clock.id).now--)}>Back</button
			>
			<span class="now">{clock.now}</span>
			<button
				class="next"
				title={i === 0 ? 'N' : undefined}
				onclick={() => session.change((d) => clockOf(d, clock.id).now++)}
			>
				Next
			</button>
			{#if doc.clocks.length > 1}
				<button
					class="x"
					aria-label="Delete clock {clock.name}"
					title={inUse(clock.id) ? 'Statuses still run on this clock' : 'Delete clock'}
					disabled={inUse(clock.id)}
					onclick={() =>
						session.change((d) => (d.clocks = d.clocks.filter((k) => k.id !== clock.id)))}>×</button
				>
			{/if}
		</div>
	{/each}
	<button
		onclick={() =>
			session.change((d) =>
				d.clocks.push({ id: newId(), name: `Clock ${d.clocks.length + 1}`, now: 1 })
			)}
	>
		+ Clock
	</button>
	<button
		disabled={expired === 0}
		onclick={() =>
			session.change((d) => {
				for (const c of d.characters) {
					c.statuses = c.statuses.filter((s) => phase(s, clockOf(d, s.clock)) !== 'expired');
				}
			})}
	>
		Clear expired{expired ? ` (${expired})` : ''}
	</button>
</section>

<style>
	.clocks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.clock {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
	}
	.name {
		width: 7ch;
		border-color: transparent;
		background: transparent;
		font-weight: 600;
	}
	.now {
		min-width: 3ch;
		text-align: center;
		font-family: var(--mono);
		font-size: 1.25rem;
	}
	.next {
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
