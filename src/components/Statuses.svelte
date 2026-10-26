<script lang="ts">
	import { describe, newId, phase, type Character } from '../lib/doc';
	import { applyPreset } from '../lib/rules';
	import { session } from '../lib/session.svelte';
	import Presets from './Presets.svelte';

	let { character }: { character: Character } = $props();

	const doc = $derived(session.doc);
	let presets = $state<Presets>();

	let name = $state('');
	let lasts = $state('');
	let stacks = $state('');
	let clockId = $state('');
	// Falls back to the first clock if the chosen one is deleted.
	const clock = $derived(doc.clocks.find((k) => k.id === clockId) ?? doc.clocks[0]);
	const preset = $derived(
		doc.presets?.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())
	);

	function edit(fn: (c: Character) => void) {
		session.change((d) => fn(d.characters.find((c) => c.id === character.id)!));
	}

	const count = (text: string) => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
	};

	function apply() {
		const n = count(lasts);
		const duration = n !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
		const pile = count(stacks);
		if (!name.trim()) return;
		session.change((d) => {
			const c = d.characters.find((x) => x.id === character.id)!;
			// A preset brings its rules; what the form says overrides its numbers.
			if (preset) {
				const p = { ...$state.snapshot(preset), clock: clock.id, lasts: duration ?? preset.lasts };
				applyPreset(d, c, p, pile ?? preset.stacks);
			} else {
				c.statuses.push({
					id: newId(),
					name: name.trim(),
					clock: clock.id,
					since: clock.now,
					...(duration !== undefined && { lasts: duration }),
					...(pile !== undefined && { stacks: pile })
				});
			}
		});
		name = '';
		lasts = '';
		stacks = '';
	}
</script>

<section class="statuses">
	<h2>Statuses</h2>
	{#if character.statuses.length}
		<ul>
			{#each character.statuses as s (s.id)}
				{@const k = doc.clocks.find((k) => k.id === s.clock)!}
				<li class={phase(s, k)}>
					<span class="sname" title={s.rules?.length ? 'Has rules, from its preset' : undefined}
						>{s.name}</span
					>
					{#if s.stacks !== undefined}
						<input
							class="stacks"
							type="number"
							min="0"
							value={s.stacks}
							aria-label="{s.name} stacks"
							onchange={(e) => {
								const n = Math.max(0, count(e.currentTarget.value) ?? 0);
								edit((c) => {
									c.statuses.find((t) => t.id === s.id)!.stacks = n;
								});
							}}
						/>
					{/if}
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
		<input
			bind:value={name}
			list="status-presets"
			placeholder="Status"
			aria-label="Status name"
			title="A preset's name brings its rules"
		/>
		<datalist id="status-presets">
			{#each doc.presets ?? [] as p (p.id)}<option value={p.name}></option>{/each}
		</datalist>
		<input
			class="short"
			bind:value={stacks}
			inputmode="numeric"
			placeholder={preset?.stacks !== undefined ? String(preset.stacks) : '#'}
			aria-label="Stacks"
			title="Stacks: what its name reads as in formulas and rules. Leave empty for none."
		/>
		<input
			class="short"
			bind:value={lasts}
			inputmode="numeric"
			placeholder={preset?.lasts !== undefined ? String(preset.lasts) : '∞'}
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
	{#if preset}
		<p class="muted">From the {preset.name} preset, with {preset.rules.length} rules.</p>
	{/if}
	<button class="link" onclick={() => presets?.open()}>Presets…</button>
	<Presets bind:this={presets} />
</section>

<style>
	.statuses {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
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
		grid-template-columns: minmax(0, 1fr);
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
	.stacks {
		flex: none;
		width: 5ch;
		padding: 0.05rem 0.25rem;
		font-family: var(--mono);
	}
	.left {
		min-width: 0;
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
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
	.link {
		justify-self: start;
		padding: 0.05rem 0.45rem;
		font-size: 0.8rem;
	}
</style>
