<script lang="ts">
	import { columnKinds, newId, type Column, type Field } from '../lib/doc';

	// A table's columns, edited in Edit layout. Rows keep a deleted column's cells, unseen,
	// so Undo brings the column back with them.
	let {
		field,
		editField
	}: { field: Field; editField: (id: string, fn: (f: Field) => void) => void } = $props();

	const cols = $derived(field.columns ?? []);
	const change = (fn: (cols: Column[]) => Column[]) =>
		editField(field.id, (f) => {
			f.columns = fn(f.columns ?? []);
		});
	const put = (id: string, patch: Partial<Column>) =>
		change((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
	/** Commas or 、 between choices, as Excel's lists and Chinese both write them. */
	const split = (text: string) =>
		text
			.split(/[,，、]/)
			.map((s) => s.trim())
			.filter(Boolean);
</script>

<div class="cols">
	<span class="muted">Columns</span>
	{#each cols as c, i (c.id)}
		<div class="col">
			<div class="row">
				<input
					value={c.name}
					aria-label="Column name"
					onchange={(e) => {
						const name = e.currentTarget.value.trim();
						if (name) put(c.id, { name });
					}}
				/>
				<select
					value={c.kind}
					aria-label="{c.name} holds"
					onchange={(e) => put(c.id, { kind: e.currentTarget.value as Column['kind'] })}
				>
					{#each columnKinds as k (k)}<option value={k}>{k}</option>{/each}
				</select>
				<button
					class="x"
					aria-label="Move {c.name} left"
					title="Move left"
					disabled={i === 0}
					onclick={() =>
						change((cs) => [...cs.slice(0, i - 1), cs[i], cs[i - 1], ...cs.slice(i + 1)])}>↑</button
				>
				<button
					class="x"
					aria-label="Delete column {c.name}"
					onclick={() => change((cs) => cs.filter((x) => x.id !== c.id))}>×</button
				>
			</div>
			{#if c.kind === 'choice'}
				<input
					value={(c.choices ?? []).join(', ')}
					placeholder="持有, 已献祭, 已消耗"
					aria-label="{c.name} choices"
					onchange={(e) => put(c.id, { choices: split(e.currentTarget.value) })}
				/>
			{/if}
		</div>
	{/each}
	<button
		onclick={() =>
			change((cs) => [...cs, { id: newId(), name: `Column ${cs.length + 1}`, kind: 'text' }])}
		>+ Column</button
	>
</div>

<style>
	.cols,
	.col {
		display: grid;
		gap: 0.3rem;
	}
	.col {
		padding-left: 0.5rem;
		border-left: 2px solid var(--line);
	}
	.row {
		display: flex;
		gap: 0.25rem;
	}
	.row input {
		flex: 1;
		width: 0;
	}
	.muted {
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
