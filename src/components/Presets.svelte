<script lang="ts">
	import { newId, type Preset } from '../lib/doc';
	import { nameOf, parse, parseLine, type Name } from '../lib/formula';
	import { session } from '../lib/session.svelte';
	import Rules from './Rules.svelte';

	// The room's statuses to apply again and again. Their rules keep labels as typed, since
	// they suit any character, and are bound to one's fields when applied.
	let dialog = $state<HTMLDialogElement>();

	const doc = $derived(session.doc);
	const presets = $derived(doc.presets ?? []);
	const known = $derived.by(() => {
		const out: Name[] = [];
		const seen = new Set<string>();
		const add = (n: Name) => {
			const k = n.label.trim().toLowerCase();
			if (!seen.has(k)) out.push(n);
			seen.add(k);
		};
		for (const c of doc.characters) for (const f of c.fields) add({ ...f, id: '' });
		for (const k of doc.clocks) add({ id: k.id, label: k.name, kind: 'clock' });
		for (const p of presets) add({ id: '', label: p.name, kind: 'status' });
		return out;
	});
	const whens = $derived(
		doc.clocks.map((k) => ({ when: { tick: k.id }, text: `${k.name} ticks` }))
	);

	const edit = (id: string, fn: (p: Preset) => void) =>
		session.change((d) => fn(d.presets!.find((p) => p.id === id)!));
	const count = (text: string) => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
	};
	const asTyped = (check: (t: string) => unknown) => (text: string) => {
		check(text);
		return text.trim().replace(/^=\s*/, '');
	};

	export const open = () => dialog?.showModal();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	aria-labelledby="presets-title"
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<div class="inner">
		<h2 id="presets-title">Status presets</h2>
		<p class="muted">
			A status to apply to anyone, with its rules. Rules name fields by label, so a preset fits
			every character with those labels; its own name reads as its stacks.
		</p>
		{#each presets as p (p.id)}
			<section class="preset">
				<div class="row">
					<input
						class="name"
						value={p.name}
						aria-label="Preset name"
						onchange={(e) => {
							const name = e.currentTarget.value.trim();
							if (name) edit(p.id, (q) => (q.name = name));
						}}
					/>
					<label>
						<span class="muted">Stacks</span>
						<input
							class="short"
							type="number"
							value={p.stacks ?? ''}
							placeholder="—"
							onchange={(e) => {
								const n = count(e.currentTarget.value);
								edit(p.id, (q) => (q.stacks = n));
							}}
						/>
					</label>
					<label>
						<span class="muted">Lasts</span>
						<input
							class="short"
							type="number"
							value={p.lasts ?? ''}
							placeholder="∞"
							onchange={(e) => {
								const n = count(e.currentTarget.value);
								edit(p.id, (q) => (q.lasts = n && n > 0 ? Math.round(n) : undefined));
							}}
						/>
					</label>
					{#if doc.clocks.length > 1}
						<select
							value={p.clock}
							aria-label="Runs on clock"
							onchange={(e) => {
								const clock = e.currentTarget.value;
								edit(p.id, (q) => (q.clock = clock));
							}}
						>
							{#each doc.clocks as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
						</select>
					{/if}
					<button
						class="x"
						aria-label="Delete preset {p.name}"
						onclick={() =>
							session.change((d) => (d.presets = d.presets!.filter((q) => q.id !== p.id)))}
						>×</button
					>
				</div>
				<Rules
					rules={p.rules}
					names={known}
					{whens}
					on="character"
					fresh={`${nameOf({ label: p.name })} -= 1`}
					cond={asTyped(parse)}
					line={asTyped(parseLine)}
					onchange={(rules) => {
						edit(p.id, (q) => {
							q.rules = rules;
						});
					}}
				/>
			</section>
		{/each}
		<div class="row">
			<button
				onclick={() =>
					session.change((d) =>
						d.presets!.push({ id: newId(), name: 'New status', clock: d.clocks[0].id, rules: [] })
					)}>+ Preset</button
			>
			<button class="done" onclick={() => dialog?.close()}>Done</button>
		</div>
	</div>
</dialog>

<style>
	dialog {
		width: min(34rem, calc(100vw - 2rem));
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
	h2 {
		margin: 0;
		font: inherit;
		font-family: var(--font-head);
		font-size: 1.1rem;
		font-weight: 600;
	}
	.preset {
		display: grid;
		gap: 0.4rem;
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.name {
		flex: 1;
		min-width: 8rem;
		font-weight: 600;
	}
	.short {
		width: 6ch;
	}
	.done {
		margin-left: auto;
	}
	.muted {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
</style>
