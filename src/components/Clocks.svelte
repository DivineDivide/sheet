<script lang="ts">
	import { newId, type Clock, type Doc, type Rule } from '../lib/doc';
	import { refText } from '../lib/formula';
	import { session } from '../lib/session.svelte';
	import Icon from './Icon.svelte';
	import Log from './Log.svelte';

	const doc = $derived(session.doc);
	const clockOf = (d: Doc, id: string) => d.clocks.find((k) => k.id === id)!;
	const offline = $derived(session.status === 'open' ? null : 'Waiting for the room to come back');

	/** Fields and columns with a rule on the clock's tick, or a formula or rule reading it. */
	function tied(k: Clock): string[] {
		const ref = refText(k.id);
		const ties = (x: { formula?: string; rules?: Rule[] }) =>
			!!x.formula?.includes(ref) ||
			(x.rules ?? []).some(
				(r) =>
					('tick' in r.when && r.when.tick === k.id) ||
					[r.if ?? '', ...r.then].some((t) => t.includes(ref))
			);
		return doc.characters.flatMap((c) =>
			c.fields.flatMap((f) => [
				...(ties(f) ? [`${c.name} · ${f.label}`] : []),
				...(f.columns ?? []).filter(ties).map((col) => `${c.name} · ${f.label} ${col.name}`)
			])
		);
	}
</script>

<section class="clocks">
	{#each doc.clocks as clock, i (clock.id)}
		{@const uses = tied(clock)}
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
			<!-- The room moves clocks, so their rules run once; Back takes their effects back too. -->
			<button
				title={offline ?? (i === 0 ? 'B' : undefined)}
				disabled={!!offline}
				onclick={() => session.act({ back: { clock: clock.id, at: clock.now } })}>Back</button
			>
			<span class="now">{clock.now}</span>
			<button
				class="next"
				title={offline ?? (i === 0 ? 'N' : undefined)}
				disabled={!!offline}
				onclick={() => session.act({ tick: { clock: clock.id, at: clock.now } })}
			>
				Next
			</button>
			<button
				class="tie"
				class:idle={!uses.length}
				popovertarget="clock-uses-{clock.id}"
				aria-label="What uses {clock.name}"
				title="What uses {clock.name}"
				><Icon name="link" />{#if uses.length}<span>{uses.length}</span>{/if}</button
			>
			<div id="clock-uses-{clock.id}" class="pop" popover>
				{#if uses.length}
					<ul>
						{#each uses as use, j (j)}<li>{use}</li>{/each}
					</ul>
				{:else}
					<p class="muted">Nothing uses {clock.name} yet.</p>
				{/if}
			</div>
			{#if doc.clocks.length > 1}
				<button
					class="x"
					aria-label="Delete clock {clock.name}"
					title="Delete clock"
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
	<Log />
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
	.tie {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.1rem 0.35rem;
		font-family: var(--mono);
		font-size: 0.8rem;
	}
	.tie :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}
	.tie.idle {
		opacity: 0.45;
	}
	.pop {
		position: fixed;
		inset: 7.5rem auto auto 1rem;
		width: max-content;
		max-width: min(22rem, calc(100vw - 2rem));
		max-height: 70vh;
		margin: 0;
		padding: 0.75rem;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
	}
	.pop ul {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
