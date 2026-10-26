<script lang="ts">
	import { newId, phase, type Clock, type Doc } from '../lib/doc';
	import { nameOf, names } from '../lib/formula';
	import { sheetOf } from '../lib/rules';
	import { session } from '../lib/session.svelte';
	import Log from './Log.svelte';
	import Rules from './Rules.svelte';

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
	const offline = $derived(session.status === 'open' ? null : 'Waiting for the room to come back');
	const known = $derived(names(sheetOf(doc)));
	// A clock's rule most often follows another clock, as rounds follow turns.
	const whensFor = (k: Clock) =>
		[...doc.clocks.filter((o) => o.id !== k.id), k].map((o) => ({
			when: { tick: o.id },
			text: `${o.name} ticks`
		}));
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
				class="small"
				popovertarget="clock-rules-{clock.id}"
				title="Rules that change clocks when one ticks"
				>Rules{clock.rules?.length ? ` ${clock.rules.length}` : ''}</button
			>
			<div id="clock-rules-{clock.id}" class="pop" popover>
				<p class="muted">
					When a clock ticks, change clocks: as Round += 1 if MOD(Turn, 4) = 0. A clock moved by a
					rule does not run its own rules.
				</p>
				<Rules
					rules={clock.rules ?? []}
					names={known}
					whens={whensFor(clock)}
					on="clocks"
					fresh={`${nameOf({ label: clock.name })} += 1`}
					onchange={(rules) => {
						session.change((d) => {
							clockOf(d, clock.id).rules = rules.length ? rules : undefined;
						});
					}}
				/>
			</div>
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
	.small {
		padding: 0.05rem 0.4rem;
		font-size: 0.8rem;
	}
	.pop {
		position: fixed;
		inset: 7.5rem auto auto 1rem;
		width: min(22rem, calc(100vw - 2rem));
		max-height: 70vh;
		margin: 0;
		padding: 0.75rem;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
	}
	.pop:popover-open {
		display: grid;
		gap: 0.4rem;
	}
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
