<script lang="ts">
	import {
		valueOf,
		type Character,
		type Entry,
		type Field,
		type Resource,
		type Value
	} from '../lib/doc';
	import { session } from '../lib/session.svelte';

	let { character, field }: { character: Character; field: Field } = $props();

	const v = $derived(valueOf(character, field));

	function set(next: Value) {
		session.change((d) => {
			d.characters.find((c) => c.id === character.id)!.values[field.id] = next;
		});
	}

	const num = (text: string, fallback: number) => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) ? n : fallback;
	};
</script>

<div class="field">
	<span class="label">{field.label}</span>

	{#if field.kind === 'number'}
		{@const n = v as number}
		<input
			class="short"
			type="number"
			value={n}
			aria-label={field.label}
			onchange={(e) => set(num(e.currentTarget.value, n))}
		/>
	{:else if field.kind === 'resource'}
		{@const r = v as Resource}
		<div class="row">
			<button aria-label="{field.label} down" onclick={() => set({ ...r, cur: r.cur - 1 })}
				>−</button
			>
			<input
				class="short"
				type="number"
				value={r.cur}
				aria-label="{field.label} current"
				onchange={(e) => set({ ...r, cur: num(e.currentTarget.value, r.cur) })}
			/>
			<span class="of">/</span>
			<input
				class="short"
				type="number"
				value={r.max}
				aria-label="{field.label} max"
				onchange={(e) => set({ ...r, max: num(e.currentTarget.value, r.max) })}
			/>
			<button aria-label="{field.label} up" onclick={() => set({ ...r, cur: r.cur + 1 })}>+</button>
		</div>
	{:else if field.kind === 'track'}
		{@const boxes = v as boolean[]}
		<div class="row">
			{#each boxes as on, i (i)}
				<button
					class="box"
					class:on
					aria-label="{field.label} box {i + 1}"
					aria-pressed={on}
					onclick={() => set(boxes.map((b, j) => (j === i ? !b : b)))}
				></button>
			{/each}
			<button
				class="x"
				aria-label="Remove a box"
				disabled={boxes.length === 0}
				onclick={() => set(boxes.slice(0, -1))}>−</button
			>
			<button class="x" aria-label="Add a box" onclick={() => set([...boxes, false])}>+</button>
		</div>
	{:else if field.kind === 'text'}
		<textarea
			class="grow"
			value={v as string}
			aria-label={field.label}
			onchange={(e) => set(e.currentTarget.value)}></textarea>
	{:else if field.kind === 'entries'}
		{@const entries = v as Entry[]}
		{@const put = (i: number, patch: Partial<Entry>) =>
			set(entries.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
		<ol class="entries">
			{#each entries as entry, i (i)}
				<li>
					<div class="row top">
						<!-- A textarea so a long name wraps; Enter commits rather than breaking the line. -->
						<textarea
							class="ename"
							rows="1"
							value={entry.name}
							placeholder="Name"
							aria-label="{field.label} name"
							onkeydown={(e) => {
								if (e.key !== 'Enter') return;
								e.preventDefault();
								e.currentTarget.blur();
							}}
							onchange={(e) => put(i, { name: e.currentTarget.value.replace(/\n/g, ' ') })}
						></textarea>
						<button
							class="x"
							aria-label="Remove {entry.name}"
							onclick={() => set(entries.filter((_, j) => j !== i))}>×</button
						>
					</div>
					<textarea
						class="grow"
						value={entry.text}
						placeholder="Description"
						aria-label="{entry.name} description"
						onchange={(e) => put(i, { text: e.currentTarget.value })}></textarea>
				</li>
			{/each}
		</ol>
		<button class="more" onclick={() => set([...entries, { name: '', text: '' }])}>+ Entry</button>
	{:else if field.kind === 'tags'}
		{@const tags = v as string[]}
		<div class="row wrap">
			{#each tags as tag, i (i)}
				<span class="tag">
					{tag}
					<button
						class="x"
						aria-label="Remove {tag}"
						onclick={() => set(tags.filter((_, j) => j !== i))}>×</button
					>
				</span>
			{/each}
			<input
				class="add"
				placeholder="add…"
				aria-label="Add to {field.label}"
				onkeydown={(e) => {
					const text = e.currentTarget.value.trim();
					if (e.key !== 'Enter' || !text) return;
					set([...tags, text]);
					e.currentTarget.value = '';
				}}
			/>
		</div>
	{/if}
</div>

<style>
	.field {
		display: grid;
		gap: 0.25rem;
	}
	.label {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.wrap {
		flex-wrap: wrap;
	}
	.short {
		width: 6ch;
	}
	.of {
		color: var(--muted);
	}
	.box {
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
	}
	.box.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.05rem 0.2rem 0.05rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.85rem;
	}
	.add {
		width: 9ch;
	}
	/* Grows with its text, so a three-paragraph backstory is read, not scrolled. */
	.grow {
		field-sizing: content;
		min-height: 2.8em;
		line-height: 1.55;
	}
	.entries {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.entries li {
		display: grid;
		gap: 0.2rem;
		padding-left: 0.6rem;
		border-left: 2px solid var(--line);
	}
	.row.top {
		align-items: start;
	}
	.ename {
		flex: 1;
		width: 0;
		field-sizing: content;
		resize: none;
		border-color: transparent;
		background: transparent;
		padding-left: 0;
		font-weight: 600;
	}
	.more {
		justify-self: start;
	}
</style>
