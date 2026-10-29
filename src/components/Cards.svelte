<script lang="ts" module>
	/** A pointer's place on a table's card in Edit layout, in px on the card. */
	export function cardPoint(card: HTMLElement, x: number, y: number) {
		const r = card.getBoundingClientRect();
		// Rects are zoomed with the sheet; offsets are not.
		const z = card.offsetWidth ? r.width / card.offsetWidth : 1;
		return {
			x: Number(card.dataset.x) + (x - r.left) / z,
			y: Number(card.dataset.y) + (y - r.top) / z
		};
	}
</script>

<script lang="ts">
	import { cardBox, frame, labelled, placed, type Placed } from '../lib/cards';
	import type { Character, Column, Field, Row } from '../lib/doc';
	import { t } from '../lib/i18n.svelte';
	import { clamp, type Box } from '../lib/layout';
	import { sheetOf } from '../lib/rules';
	import { session } from '../lib/session.svelte';
	import { sources } from '../lib/source';
	import { tip } from '../lib/tip';
	import Cell from './Cell.svelte';
	import Icon from './Icon.svelte';
	import { editColumns, renameColumn } from './Table.svelte';

	// A table shown as cards: each row a card, each column on it in a box of its own. In Edit
	// layout one card stands for them all, its boxes moved and sized as fields are on a tab,
	// and the columns off it wait in a tray below.
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
		/** Where a kind dragged in from the palette would land on the card. */
		drop?: Box | null;
		onpick?: (column: string) => void;
	} = $props();

	const cols = $derived(field.columns ?? []);
	const on = $derived(placed(cols));
	const off = $derived(cols.filter((c) => !c.box));
	const f = $derived(frame(cols));
	const sheet = $derived(sheetOf(session.doc, character));
	const tables = $derived(new Map(sources(session.doc).map((s) => [s.id, s])));

	/** A column being dragged, and where it would land; `box` is null while it would not. */
	let held = $state<{ id: string; box: Box | null; leaving: boolean } | null>(null);
	let card = $state<HTMLElement>();
	let tray = $state<HTMLElement>();

	const put = (id: string, fn: (c: Column) => Column) =>
		editColumns(character, field, (cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
	const unplaced = ({ box: _, ...c }: Column): Column => c;

	/** Moves or sizes a box, places a column from the tray, or takes one off onto it. */
	function hold(e: PointerEvent, c: Column, mode: 'move' | 'size') {
		if (e.button !== 0 || !card) return;
		e.preventDefault();
		e.stopPropagation();
		const from = c.box;
		const sx = e.clientX;
		const sy = e.clientY;
		const z = card.offsetWidth ? card.getBoundingClientRect().width / card.offsetWidth : 1;
		let moved = false;
		const onmove = (ev: PointerEvent) => {
			moved ||= Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4;
			if (!moved || !card) return;
			const at = document.elementFromPoint(ev.clientX, ev.clientY);
			const leaving = !!at && !!tray?.contains(at);
			const dx = (ev.clientX - sx) / z;
			const dy = (ev.clientY - sy) / z;
			if (!from) {
				// Held by its top-left corner, a little up and left of the pointer, as the palette's.
				const p = cardPoint(card, ev.clientX, ev.clientY);
				const over = !leaving && !!at && !!(card.closest('.slot') ?? card).contains(at);
				held = {
					id: c.id,
					box: over ? cardBox(c.kind, { x: p.x - 16, y: p.y - 12 }) : null,
					leaving
				};
			} else if (mode === 'size') {
				held = {
					id: c.id,
					box: clamp({ ...from, w: from.w + dx, h: from.h + dy }),
					leaving: false
				};
			} else {
				held = { id: c.id, box: clamp({ ...from, x: from.x + dx, y: from.y + dy }), leaving };
			}
		};
		const onup = () => {
			window.removeEventListener('pointermove', onmove);
			window.removeEventListener('pointerup', onup);
			window.removeEventListener('pointercancel', onup);
			const done = held;
			held = null;
			// Only the release is written, so a whole gesture is one undo step.
			if (!moved) return onpick?.(c.id);
			if (from && done?.leaving) return put(c.id, unplaced);
			if (done?.box) put(c.id, (x) => ({ ...x, box: done.box! }));
		};
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
		window.addEventListener('pointercancel', onup);
	}

	/** A column from the tray, or a kind from the palette, where it would land. */
	const ghost = $derived(
		held && !cols.find((c) => c.id === held!.id)?.box ? held.box : laying ? drop : null
	);
</script>

{#snippet content(c: Placed, row: Row, still = false)}
	<div class="content" inert={still || undefined}>
		{#if labelled(c)}<div class="label">{c.name}</div>{/if}
		<div class="value">
			<Cell {character} {field} {rows} {set} {row} column={c} {sheet} {tables} />
		</div>
	</div>
{/snippet}

{#if laying}
	{@const sample = rows[0] ?? { id: '', cells: {} }}
	<div class="laid">
		<div class="card">
			<div
				class="inner"
				class:empty={!on.length}
				bind:this={card}
				data-card
				data-x={f.x}
				data-y={f.y}
				style:--w="{f.w}px"
				style:--h="{f.h}px"
			>
				{#if !on.length && !ghost}<span class="none">{t('Drop a kind here')}</span>{/if}
				{#each on as c (c.id)}
					{@const mine = held?.id === c.id ? held : null}
					{@const b = mine?.box ?? c.box}
					<!-- svelte-ignore a11y_no_static_element_interactions: the pointer moves it; its icon is the button -->
					<div
						class="box"
						class:picked={picked === c.id}
						class:held={mine}
						class:leaving={mine?.leaving}
						style:--x="{b.x - f.x}px"
						style:--y="{b.y - f.y}px"
						style:--w="{b.w}px"
						style:--h="{b.h}px"
						onpointerdown={(e) => hold(e, c, 'move')}
					>
						{@render content(c, sample, true)}
						<span class="head">
							<button
								class="kind"
								aria-label={t('{name}, {kind}. Press to set it up, drag to move it.', {
									name: c.name,
									kind: t(c.kind)
								})}
								title={t('{kind}: press to set it up, drag to move it', { kind: t(c.kind) })}
								onclick={(e) => e.detail === 0 && onpick?.(c.id)}><Icon name={c.kind} /></button
							>
							<input
								class:gone={c.hideLabel}
								value={c.name}
								aria-label={t('Column name')}
								onpointerdown={(e) => e.stopPropagation()}
								onchange={(e) => {
									const text = e.currentTarget.value.trim();
									if (text) renameColumn(character, field, c, text);
									else e.currentTarget.value = c.name;
								}}
							/>
							{#if c.kind !== 'button'}
								<button
									class="icon toggle"
									class:off={c.hideLabel}
									aria-label={t(c.hideLabel ? "Show {label}'s label" : "Hide {label}'s label", {
										label: c.name
									})}
									{@attach tip(
										c.hideLabel ? t('Show the label') : t('Hide the label, for everyone')
									)}
									onpointerdown={(e) => e.stopPropagation()}
									onclick={() =>
										put(c.id, ({ hideLabel: _, ...x }) =>
											c.hideLabel ? x : { ...x, hideLabel: true }
										)}><Icon name={c.hideLabel ? 'label-off' : 'label'} /></button
								>
							{/if}
						</span>
						<span class="grip" aria-hidden="true" onpointerdown={(e) => hold(e, c, 'size')}></span>
					</div>
				{/each}
				{#if ghost}
					<div
						class="ghost"
						style:--x="{ghost.x - f.x}px"
						style:--y="{ghost.y - f.y}px"
						style:--w="{ghost.w}px"
						style:--h="{ghost.h}px"
					></div>
				{/if}
			</div>
		</div>
		<div
			class="tray"
			class:over={held?.leaving && cols.find((c) => c.id === held!.id)?.box}
			bind:this={tray}
		>
			<span class="muted">{t('Unplaced')}</span>
			{#each off as c (c.id)}
				<button
					class="chip"
					class:lifted={held?.id === c.id}
					aria-label={t('{name}, {kind}. Press to set it up, drag it onto the card.', {
						name: c.name,
						kind: t(c.kind)
					})}
					onpointerdown={(e) => hold(e, c, 'move')}
					onclick={(e) => e.detail === 0 && onpick?.(c.id)}><Icon name={c.kind} />{c.name}</button
				>
			{:else}
				<span class="muted">{t('Drag a box here to take it off the card')}</span>
			{/each}
		</div>
	</div>
{:else if on.length}
	<ol class="cards">
		{#each rows as row (row.id)}
			{@const follows = row.link && tables.get(row.link.table)}
			<li class="card">
				<div class="inner" style:--w="{f.w}px" style:--h="{f.h}px">
					{#each on as c (c.id)}
						<div
							class="box"
							style:--x="{c.box.x - f.x}px"
							style:--y="{c.box.y - f.y}px"
							style:--w="{c.box.w}px"
							style:--h="{c.box.h}px"
						>
							{@render content(c, row)}
						</div>
					{/each}
				</div>
				<!-- A table following a map keeps its one row there. -->
				{#if !field.follows}
					<span class="ends">
						{#if follows}
							<button
								class="x"
								aria-label={t('Stop following {name}', { name: follows.name })}
								{@attach tip(
									t('Follows {name}. Press to keep it as it is now.', { name: follows.name })
								)}
								onclick={() =>
									set(rows.map((r) => (r.id === row.id ? { id: r.id, cells: r.cells } : r)))}
								><Icon name="link" /></button
							>
						{/if}
						<button
							class="x"
							aria-label={t('Remove this card')}
							onclick={() => set(rows.filter((r) => r.id !== row.id))}>×</button
						>
					</span>
				{/if}
			</li>
		{/each}
	</ol>
{:else}
	<span class="none"
		>{cols.length
			? t('Nothing is on the card yet. In Edit layout, drag columns onto it.')
			: t('No columns yet. In Edit layout, drag a kind from the left onto this table.')}</span
	>
{/if}

<style>
	.cards {
		display: flex;
		flex-wrap: wrap;
		align-items: start;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		position: relative;
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	/* The card's own sheet, its 0,0 at the frame's top-left corner. */
	.inner {
		position: relative;
		width: var(--w);
		height: var(--h);
	}
	.box {
		position: absolute;
		left: var(--x);
		top: var(--y);
		width: var(--w);
		height: var(--h);
		font-size: 0.9rem;
	}
	/* Content beyond a box scrolls inside it, as a field's does. */
	.content {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		height: 100%;
		overflow: auto;
	}
	.label {
		font-family: var(--font-head);
		font-size: 0.75rem;
		letter-spacing: var(--label-tracking);
		color: var(--muted);
	}
	.value {
		flex: 1;
		min-height: 0;
	}
	/* A picture fills its box, not the grid's thumbnail size. */
	.box :global(.cellpic),
	.box :global(.cellpic label) {
		height: 100%;
	}
	.box :global(.cellpic img) {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	/* Over the card's top-right corner while it is hovered, and always where nothing hovers. */
	.ends {
		position: absolute;
		top: 0.15rem;
		right: 0.15rem;
		display: flex;
		border-radius: var(--radius);
		background: var(--surface);
		opacity: 0;
		transition: opacity 0.12s;
	}
	.card:hover .ends,
	.ends:focus-within {
		opacity: 1;
	}
	@media (hover: none) {
		.ends {
			opacity: 1;
		}
	}
	.ends :global(svg) {
		width: 0.8rem;
		height: 0.8rem;
		vertical-align: middle;
	}
	/* Narrow, a card ignores its boxes and stacks its columns in reading order, as the sheet
	   does its fields. */
	:global(.stacked) .card {
		flex: 1 1 100%;
	}
	:global(.stacked) .inner {
		width: auto;
		height: auto;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	:global(.stacked) .box {
		position: static;
		width: auto;
		height: auto;
	}
	:global(.stacked) .content {
		height: auto;
	}

	.laid {
		display: flex;
		flex-direction: column;
		align-items: start;
		gap: 0.5rem;
	}
	.inner.empty {
		display: grid;
		place-items: center;
		min-width: 240px;
		min-height: 48px;
	}
	.laid .box {
		outline: 1px dashed var(--line);
		cursor: grab;
		touch-action: none;
	}
	.laid .content {
		overflow: hidden;
	}
	.laid .box:hover {
		z-index: 1;
	}
	.laid .box.picked {
		outline: 2px solid var(--accent);
	}
	/* Never under the pointer, so a release can find the tray beneath it. */
	.laid .box.held {
		z-index: 1;
		pointer-events: none;
		background: var(--surface);
	}
	.laid .box.leaving {
		opacity: 0.4;
	}
	/* On the box's top edge, as a hidden label's controls float on a field's, so the box
	   reads as in play: shown while it is hovered or picked, and always where nothing hovers. */
	.head {
		position: absolute;
		top: 0;
		left: 0.4rem;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0 0.15rem;
		translate: 0 -50%;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s;
	}
	.box:hover .head,
	.box.picked .head,
	.head:focus-within {
		opacity: 1;
		pointer-events: auto;
	}
	@media (hover: none) {
		.head {
			opacity: 1;
			pointer-events: auto;
		}
	}
	/* Typed in though the slot around it takes no selection, which Safari would carry down. */
	.head input {
		-webkit-user-select: text;
		user-select: text;
		width: 9em;
		padding: 0.05rem 0.25rem;
		font: inherit;
		font-size: 0.75rem;
	}
	.head input.gone {
		opacity: 0.55;
		text-decoration: line-through;
	}
	.kind {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border: none;
		background: none;
		padding: 0;
		flex: none;
		cursor: grab;
	}
	.kind :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		flex: none;
		border: none;
		border-radius: 50%;
		background: none;
		color: var(--muted);
	}
	.icon:hover {
		color: var(--accent);
	}
	.icon :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}
	.grip {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 12px;
		height: 12px;
		cursor: nwse-resize;
	}
	/* A corner mark, as a field's box has. */
	.grip::after {
		content: '';
		position: absolute;
		right: 2px;
		bottom: 2px;
		width: 5px;
		height: 5px;
		border-right: 2px solid var(--muted);
		border-bottom: 2px solid var(--muted);
		opacity: 0.6;
	}
	.box:hover .grip::after,
	.box.picked .grip::after {
		border-color: var(--accent);
		opacity: 1;
	}
	.ghost {
		position: absolute;
		left: var(--x);
		top: var(--y);
		width: var(--w);
		height: var(--h);
		pointer-events: none;
		border: 1px dashed var(--accent);
		background: color-mix(in oklab, var(--accent) 10%, var(--surface));
	}
	.tray {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		min-width: 240px;
		padding: 0.3rem 0.5rem;
		border: 1px dashed var(--line);
		border-radius: var(--radius);
		font-size: 0.8rem;
	}
	.tray.over {
		border-color: var(--accent);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.05rem 0.45rem;
		cursor: grab;
		touch-action: none;
	}
	.chip.lifted {
		opacity: 0.5;
	}
	.chip :global(svg) {
		width: 0.8rem;
		height: 0.8rem;
	}
	.muted,
	.none {
		font-size: 0.85rem;
		color: var(--muted);
	}
</style>
