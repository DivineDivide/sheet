<script lang="ts" module>
	/** Which gap between a header row's columns is nearest `x`, counted from the left. */
	export const gapAt = (head: Element, x: number) =>
		[...head.querySelectorAll('th[data-col]')].filter((th) => {
			const r = th.getBoundingClientRect();
			return r.left + r.width / 2 < x;
		}).length;
</script>

<script lang="ts">
	import {
		cellOf,
		newId,
		uniqueLabel,
		type Cell,
		type Character,
		type Column,
		type Field,
		type Resource,
		type Row
	} from '../lib/doc';
	import { cellResult, isErr, show } from '../lib/formula';
	import { hint, ready, sheetOf } from '../lib/rules';
	import { session } from '../lib/session.svelte';
	import { tip } from '../lib/tip';
	import Icon from './Icon.svelte';
	import Prose from './Prose.svelte';

	// A table field: each column holds one kind, and its rows are the character's value. In
	// Edit layout the headers are what is edited: rename in place, press a column's icon to
	// set it up in the inspector, drag the icon to move it. The body waits meanwhile.
	let {
		character,
		field,
		rows,
		set,
		laying = false,
		picked = null,
		drop = null,
		onpick
	}: {
		character: Character;
		field: Field;
		rows: Row[];
		set: (rows: Row[]) => void;
		laying?: boolean;
		/** The column whose settings the inspector shows. */
		picked?: string | null;
		/** Where a kind dragged in from the palette would land, as a column index. */
		drop?: number | null;
		onpick?: (column: string) => void;
	} = $props();

	const cols = $derived(field.columns ?? []);
	const sheet = $derived(sheetOf(session.doc, character));

	function put(row: Row, col: string, cell: Cell | undefined) {
		const cells = { ...row.cells };
		if (cell === undefined || cell === '') delete cells[col];
		else cells[col] = cell;
		set(rows.map((r) => (r.id === row.id ? { ...r, cells } : r)));
	}

	const columns = (fn: (cols: Column[]) => Column[]) =>
		session.change((d) => {
			const f = d.characters
				.find((c) => c.id === character.id)!
				.fields.find((x) => x.id === field.id)!;
			f.columns = fn(f.columns ?? []);
		});

	function rename(col: Column, text: string) {
		const name = uniqueLabel(
			text,
			cols.map((c) => ({ id: c.id, label: c.name })),
			col.id
		);
		if (name !== text) session.notice = `${field.label} already has ${text}, so this is ${name}.`;
		columns((cs) => cs.map((c) => (c.id === col.id ? { ...c, name } : c)));
	}

	const num = (text: string) => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
	};

	/** Where a header dragged by its icon would go, as a column index. */
	let moving = $state<number | null>(null);
	let head = $state<HTMLTableRowElement>();

	function hold(e: PointerEvent, i: number) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const sx = e.clientX;
		let moved = false;
		const onmove = (ev: PointerEvent) => {
			moved ||= Math.abs(ev.clientX - sx) > 4;
			if (moved && head) moving = gapAt(head, ev.clientX);
		};
		const onup = () => {
			window.removeEventListener('pointermove', onmove);
			window.removeEventListener('pointerup', onup);
			window.removeEventListener('pointercancel', onup);
			const to = moving;
			moving = null;
			if (!moved) return onpick?.(cols[i].id);
			if (to === null || to === i || to === i + 1) return;
			columns((cs) => {
				const out = cs.filter((_, j) => j !== i);
				out.splice(to > i ? to - 1 : to, 0, cs[i]);
				return out;
			});
		};
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
		window.addEventListener('pointercancel', onup);
	}

	const mark = $derived(moving ?? drop);
</script>

{#if cols.length || laying}
	<table class="grid" class:laying>
		<thead>
			<tr bind:this={head}>
				{#each cols as c, i (c.id)}
					<th data-col={c.id} class:picked={laying && picked === c.id} class:before={mark === i}>
						{#if laying}
							<span class="head">
								<button
									class="kind"
									aria-label="{c.name}, {c.kind}. Press to set it up, drag to move it."
									title="{c.kind}: press to set it up, drag to move it"
									onpointerdown={(e) => hold(e, i)}
									onclick={(e) => e.detail === 0 && onpick?.(c.id)}><Icon name={c.kind} /></button
								>
								<input
									value={c.name}
									aria-label="Column name"
									onpointerdown={(e) => e.stopPropagation()}
									onchange={(e) => {
										const text = e.currentTarget.value.trim();
										if (text) rename(c, text);
										else e.currentTarget.value = c.name;
									}}
								/>
							</span>
						{:else}
							{c.name}
						{/if}
					</th>
				{/each}
				<th class:before={mark === cols.length} aria-label="Remove">
					{#if laying && !cols.length}<span class="none">Drop a kind here</span>{/if}
				</th>
			</tr>
		</thead>
		<tbody inert={laying || undefined}>
			{#each rows as row (row.id)}
				<tr>
					{#each cols as c (c.id)}
						{@const v = cellOf(row, c)}
						<td class={c.kind}>
							{#if c.kind === 'choice'}
								<select
									value={v === undefined ? '' : String(v)}
									aria-label={c.name}
									onchange={(e) => put(row, c.id, e.currentTarget.value)}
								>
									<option value=""></option>
									{#each c.choices ?? [] as o (o)}<option>{o}</option>{/each}
									<!-- A value from before the choices changed still shows. -->
									{#if v !== undefined && !c.choices?.includes(String(v))}<option>{v}</option>{/if}
								</select>
							{:else if c.kind === 'number'}
								<input
									class="short"
									type="number"
									value={v ?? ''}
									aria-label={c.name}
									onchange={(e) => put(row, c.id, num(e.currentTarget.value))}
								/>
							{:else if c.kind === 'resource'}
								{@const r = v as Resource}
								<span class="pair">
									<input
										class="short"
										type="number"
										value={r.cur}
										aria-label="{c.name} current"
										onchange={(e) =>
											put(row, c.id, { ...r, cur: num(e.currentTarget.value) ?? r.cur })}
									/><span class="of">/</span><input
										class="short"
										type="number"
										value={r.max}
										aria-label="{c.name} max"
										onchange={(e) =>
											put(row, c.id, { ...r, max: num(e.currentTarget.value) ?? r.max })}
									/>
								</span>
							{:else if c.kind === 'track'}
								{@const boxes = v as boolean[]}
								<span class="pair">
									{#each boxes as on, i (i)}
										<button
											class="box"
											class:on
											aria-label="{c.name} box {i + 1}"
											aria-pressed={on}
											onclick={() =>
												put(
													row,
													c.id,
													boxes.map((b, j) => (j === i ? !b : b))
												)}
										></button>
									{/each}
									<button
										class="x"
										aria-label="Remove a box"
										disabled={!boxes.length}
										onclick={() => put(row, c.id, boxes.slice(0, -1))}>−</button
									>
									<button
										class="x"
										aria-label="Add a box"
										onclick={() => put(row, c.id, [...boxes, false])}>+</button
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
										: 'Waiting for the room to come back.'}
								<button
									class="press"
									disabled={why !== true}
									{@attach tip(hint(session.doc, character, c.id, why, { table: field, row }))}
									onclick={() =>
										session.act({
											press: { character: character.id, field: field.id, column: c.id, row: row.id }
										})}>{c.name}</button
								>
							{:else if c.kind === 'tags'}
								<input
									value={((v as string[] | undefined) ?? []).join(', ')}
									aria-label={c.name}
									placeholder="a, b"
									onchange={(e) => {
										const tags = e.currentTarget.value
											.split(/[,，、]/)
											.map((s) => s.trim())
											.filter(Boolean);
										put(row, c.id, tags.length ? tags : undefined);
									}}
								/>
							{:else}
								<Prose
									value={v === undefined ? '' : String(v)}
									label={c.name}
									empty=""
									onchange={(t) => put(row, c.id, t)}
								/>
							{/if}
						</td>
					{/each}
					<td>
						<button
							class="x"
							aria-label="Remove this row"
							onclick={() => set(rows.filter((r) => r.id !== row.id))}>×</button
						>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if !laying}
		<button class="more" onclick={() => set([...rows, { id: newId(), cells: {} }])}>+ Row</button>
	{/if}
{:else}
	<span class="none"
		>No columns yet. In Edit layout, drag a kind from the left onto this table.</span
	>
{/if}

<style>
	.grid {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	.grid th {
		position: relative;
		padding: 0.15rem 0.3rem;
		border-bottom: 1px solid var(--line);
		font-family: var(--font-head);
		font-size: 0.75rem;
		font-weight: normal;
		letter-spacing: var(--label-tracking);
		text-align: left;
		white-space: nowrap;
		color: var(--muted);
	}
	/* Where a dragged kind or column would land. */
	.grid th.before::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: -2px;
		left: -2px;
		width: 3px;
		border-radius: 2px;
		background: var(--accent);
	}
	.grid th.picked {
		box-shadow: inset 0 -2px var(--accent);
	}
	.laying th {
		padding: 0.2rem 0.25rem;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	/* Typed in though the slot around it takes no selection, which Safari would carry down. */
	.head input {
		-webkit-user-select: text;
		user-select: text;
		width: 0;
		min-width: 4em;
		flex: 1;
		padding: 0.05rem 0.25rem;
		font: inherit;
	}
	.kind {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		flex: none;
		cursor: grab;
		touch-action: none;
	}
	.kind :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}
	.grid td {
		padding: 0.1rem 0.15rem;
		border-bottom: 1px solid color-mix(in oklab, var(--line) 60%, transparent);
		vertical-align: top;
	}
	.grid td:last-child,
	.grid th:last-child {
		width: 1.5rem;
	}
	/* A cell of text is one line until it holds more. */
	.grid :global(.grow) {
		min-height: 1.6em;
	}
	/* Wide enough for the chosen word, however the table shares out its width. */
	.grid select {
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
	.none {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.more {
		justify-self: start;
		align-self: start;
	}
</style>
