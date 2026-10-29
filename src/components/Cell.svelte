<script lang="ts">
	import {
		cellOf,
		globalId,
		tagsIn,
		type Cell,
		type Character,
		type Column,
		type Field,
		type Resource,
		type Row
	} from '../lib/doc';
	import { cellResult, isErr, show, type Sheet } from '../lib/formula';
	import { t } from '../lib/i18n.svelte';
	import { hint, ready } from '../lib/rules';
	import { CELL, shrink } from '../lib/picture';
	import { session } from '../lib/session.svelte';
	import { choose, fromSource, keyOf, type Source } from '../lib/source';
	import { tip } from '../lib/tip';
	import Bar from './Bar.svelte';
	import Prose from './Prose.svelte';

	// One cell of a table, edited alike in the grid and on a card.
	let {
		character,
		field,
		rows,
		set,
		row,
		column: c,
		sheet,
		tables
	}: {
		character: Character;
		field: Field;
		rows: Row[];
		set: (rows: Row[]) => void;
		row: Row;
		column: Column;
		sheet: Sheet;
		tables: Map<string, Source>;
	} = $props();

	const cols = $derived(field.columns ?? []);
	const v = $derived(cellOf(row, c));
	const follows = $derived(row.link && tables.get(row.link.table));
	/** A cell its source row fills changes there, not here. */
	const held = $derived(!!follows && !!fromSource(follows, c) && c.from !== follows.id);

	/** A choice column's source rows, by the names they are chosen by. */
	function namesIn(src: Source): string[] {
		const key = keyOf(src, c);
		const names = key ? src.rows.map((r) => r.cells[key.id]).filter((v) => v !== undefined) : [];
		return [...new Set(names.map(String))];
	}

	/** One change, so ⌘Z takes back the whole row's filling. */
	function pick(src: Source, name: string) {
		const key = keyOf(src, c);
		const item = key && src.rows.find((r) => String(r.cells[key.id] ?? '') === name);
		if (item) return set(rows.map((r) => (r.id === row.id ? choose(src, item, r, cols) : r)));
		const { [c.id]: _, ...cells } = row.cells;
		set(rows.map((r) => (r.id === row.id ? { id: r.id, cells } : r)));
	}

	function put(cell: Cell | undefined, now = row) {
		const cells = { ...now.cells };
		if (cell === undefined || cell === '') delete cells[c.id];
		else cells[c.id] = cell;
		set(rows.map((r) => (r.id === now.id ? { ...r, cells } : r)));
	}

	async function take(file: File | undefined) {
		if (!file?.type.startsWith('image/')) return;
		try {
			const pic = await shrink(file, CELL);
			// The row as it is now: another edit may have reached it while the picture shrank.
			const now = rows.find((r) => r.id === row.id);
			if (now) put(pic, now);
		} catch {
			session.notice = t('{name} could not be read as a picture.', { name: file.name });
		}
	}

	const num = (text: string) => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
	};
</script>

<div class="cell {c.kind}" inert={held || undefined}>
	{#if c.kind === 'choice'}
		{@const src = c.from ? tables.get(c.from) : undefined}
		{@const choices = src ? namesIn(src) : (c.choices ?? [])}
		<select
			value={v === undefined ? '' : String(v)}
			aria-label={c.name}
			onchange={(e) => (src ? pick(src, e.currentTarget.value) : put(e.currentTarget.value))}
		>
			<!-- A row drawing on a table is emptied by removing it, so only a blank row shows none. -->
			{#if !src}<option value=""></option>
			{:else if v === undefined}<option value="" disabled hidden></option>{/if}
			{#each choices as o (o)}<option>{o}</option>{/each}
			<!-- A value from before the choices changed still shows. -->
			{#if v !== undefined && !choices.includes(String(v))}<option>{v}</option>{/if}
		</select>
	{:else if c.kind === 'number'}
		<input
			class="short"
			type="number"
			value={v ?? ''}
			aria-label={c.name}
			onchange={(e) => put(num(e.currentTarget.value))}
		/>
	{:else if c.kind === 'resource' && c.bar}
		<Bar compact value={v as Resource} label={c.name} set={(r) => put(r)} />
	{:else if c.kind === 'resource'}
		{@const r = v as Resource}
		<span class="pair">
			<input
				class="short"
				type="number"
				value={r.cur}
				aria-label={t('{label} current', { label: c.name })}
				onchange={(e) => put({ ...r, cur: num(e.currentTarget.value) ?? r.cur })}
			/><span class="of">/</span><input
				class="short"
				type="number"
				value={r.max}
				aria-label={t('{label} max', { label: c.name })}
				onchange={(e) => put({ ...r, max: num(e.currentTarget.value) ?? r.max })}
			/>
		</span>
	{:else if c.kind === 'track'}
		{@const boxes = v as boolean[]}
		<span class="pair">
			{#each boxes as on, i (i)}
				<button
					class="box"
					class:on
					aria-label={t('{label} box {n}', { label: c.name, n: i + 1 })}
					aria-pressed={on}
					onclick={() => put(boxes.map((b, j) => (j === i ? !b : b)))}
				></button>
			{/each}
			<button
				class="x"
				aria-label={t('Remove a box')}
				disabled={!boxes.length}
				onclick={() => put(boxes.slice(0, -1))}>−</button
			>
			<button class="x" aria-label={t('Add a box')} onclick={() => put([...boxes, false])}>+</button
			>
		</span>
	{:else if c.kind === 'formula'}
		{@const out = cellResult(sheet, field.id, c.id, row.id)}
		<output class:err={isErr(out)} title={isErr(out) ? out.why : undefined}
			>{c.formula?.trim() ? show(out) : ''}</output
		>
	{:else if c.kind === 'button'}
		{@const why =
			session.status === 'open'
				? ready(session.doc, character, c.id, { table: field, row })
				: t('Waiting for the room to come back.')}
		<button
			class="press"
			disabled={why !== true}
			{@attach tip(hint(session.doc, character, c.id, why, { table: field, row }))}
			onclick={() =>
				session.act({
					press: { character: character.id, field: field.id, column: c.id, row: row.id }
				})}>{c.name}</button
		>
	{:else if c.kind === 'image'}
		<!-- A drop stops here: on the window it would be taken for a file to import. -->
		<div
			class="cellpic"
			role="group"
			aria-label={c.name}
			ondragover={(e) => {
				e.preventDefault();
				e.stopPropagation();
			}}
			ondrop={(e) => {
				e.preventDefault();
				e.stopPropagation();
				take(e.dataTransfer?.files[0]);
			}}
		>
			<label class:pick={!v} {@attach tip(t(v ? 'Replace the picture' : 'Pick or drop a picture'))}>
				{#if v}<img src={v as string} alt={c.name} />{:else}+{/if}
				<input
					type="file"
					accept="image/*"
					hidden
					onchange={(e) => {
						take(e.currentTarget.files?.[0]);
						e.currentTarget.value = '';
					}}
				/>
			</label>
			{#if v && !held}<button
					class="x"
					aria-label={t('Remove the picture')}
					onclick={() => put(undefined)}>×</button
				>{/if}
		</div>
	{:else if c.kind === 'tags'}
		<input
			value={((v as string[] | undefined) ?? []).join(', ')}
			aria-label={c.name}
			placeholder={t('a, b')}
			onchange={(e) => {
				const tags = tagsIn(e.currentTarget.value);
				put(tags.length ? tags : undefined);
			}}
		/>
	{:else}
		<Prose
			value={v === undefined ? '' : String(v)}
			at="{globalId(character, field)}/{row.id}/{c.id}"
			label={c.name}
			empty=""
			onchange={(t) => put(t)}
		/>
	{/if}
</div>

<style>
	/* A cell of text is one line until it holds more. */
	.cell :global(.grow) {
		min-height: 1.6em;
	}
	/* Wide enough for the chosen word, however the table shares out its width. */
	select {
		width: 100%;
		min-width: 5.5em;
		field-sizing: content;
	}
	.short {
		width: 6.5ch;
		font-variant-numeric: tabular-nums;
	}
	.tags input {
		width: 100%;
		min-width: 6em;
	}
	.pair {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.of {
		color: var(--muted);
	}
	.box {
		width: 1.1rem;
		height: 1.1rem;
		margin: 0 0.05rem;
		padding: 0;
		border-radius: var(--track-radius);
		rotate: var(--track-turn);
	}
	.box.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.track .x {
		opacity: 0;
	}
	.track:hover .x,
	.track:focus-within .x {
		opacity: 1;
	}
	output {
		font-variant-numeric: tabular-nums;
	}
	.cellpic {
		display: flex;
		align-items: start;
		gap: 0.15rem;
	}
	.cellpic label {
		cursor: pointer;
	}
	.cellpic img {
		display: block;
		max-width: 8rem;
		max-height: 6rem;
		border-radius: var(--radius);
	}
	.cellpic .pick {
		padding: 0.1rem 0.6rem;
		border: 1px dashed var(--line);
		border-radius: var(--radius);
		color: var(--muted);
	}
	.cellpic .x {
		opacity: 0;
	}
	.cellpic:hover .x,
	.cellpic:focus-within .x {
		opacity: 1;
	}
	.press {
		padding: 0.05rem 0.5rem;
		border-color: var(--accent);
		color: var(--accent);
		white-space: nowrap;
	}
	.press:disabled {
		opacity: 0.45;
	}
	.err {
		color: var(--accent);
	}
</style>
