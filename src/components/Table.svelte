<script lang="ts" module>
	import { uniqueLabel, type Character, type Column, type Field, type Row } from '../lib/doc';
	import { t } from '../lib/i18n.svelte';
	import { session } from '../lib/session.svelte';

	/** Which gap between a header row's columns is nearest `x`, counted from the left. */
	export const gapAt = (head: Element, x: number) =>
		[...head.querySelectorAll('th[data-col]')].filter((th) => {
			const r = th.getBoundingClientRect();
			return r.left + r.width / 2 < x;
		}).length;

	/** Rewrites a table's columns as one change, for the grid's headers and the card alike. */
	export const editColumns = (
		character: Character,
		field: Field,
		fn: (cols: Column[]) => Column[]
	) =>
		session.change((d) => {
			const f = d.characters
				.find((c) => c.id === character.id)!
				.fields.find((x) => x.id === field.id)!;
			f.columns = fn(f.columns ?? []);
		});

	export function renameColumn(character: Character, field: Field, col: Column, text: string) {
		const name = uniqueLabel(
			text,
			(field.columns ?? []).map((c) => ({ id: c.id, label: c.name })),
			col.id
		);
		if (name !== text)
			session.notice = t('{label} already has {text}, so this is {name}.', {
				label: field.label,
				text,
				name
			});
		editColumns(character, field, (cs) => cs.map((c) => (c.id === col.id ? { ...c, name } : c)));
	}
</script>

<script lang="ts">
	import { sheetOf } from '../lib/rules';
	import { sources } from '../lib/source';
	import { tip } from '../lib/tip';
	import Cell from './Cell.svelte';
	import Icon from './Icon.svelte';

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
	const tables = $derived(new Map(sources(session.doc).map((s) => [s.id, s])));

	const columns = (fn: (cols: Column[]) => Column[]) => editColumns(character, field, fn);

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
									aria-label={t('{name}, {kind}. Press to set it up, drag to move it.', {
										name: c.name,
										kind: t(c.kind)
									})}
									title={t('{kind}: press to set it up, drag to move it', { kind: t(c.kind) })}
									onpointerdown={(e) => hold(e, i)}
									onclick={(e) => e.detail === 0 && onpick?.(c.id)}><Icon name={c.kind} /></button
								>
								<input
									value={c.name}
									aria-label={t('Column name')}
									onpointerdown={(e) => e.stopPropagation()}
									onchange={(e) => {
										const text = e.currentTarget.value.trim();
										if (text) renameColumn(character, field, c, text);
										else e.currentTarget.value = c.name;
									}}
								/>
							</span>
						{:else}
							{c.name}
						{/if}
					</th>
				{/each}
				<th class:before={mark === cols.length} aria-label={t('Remove')}>
					{#if laying && !cols.length}<span class="none">{t('Drop a kind here')}</span>{/if}
				</th>
			</tr>
		</thead>
		<tbody inert={laying || undefined}>
			{#each rows as row (row.id)}
				{@const follows = row.link && tables.get(row.link.table)}
				<tr>
					{#each cols as c (c.id)}
						<td><Cell {character} {field} {rows} {set} {row} column={c} {sheet} {tables} /></td>
					{/each}
					<td class="ends">
						<!-- A table following a map keeps its one row there. -->
						{#if follows && !field.follows}
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
						{#if !field.follows}
							<button
								class="x"
								aria-label={t('Remove this row')}
								onclick={() => set(rows.filter((r) => r.id !== row.id))}>×</button
							>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<span class="none"
		>{t('No columns yet. In Edit layout, drag a kind from the left onto this table.')}</span
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
	.ends {
		white-space: nowrap;
	}
	.ends :global(svg) {
		width: 0.8rem;
		height: 0.8rem;
		vertical-align: middle;
	}
	.none {
		font-size: 0.85rem;
		color: var(--muted);
	}
</style>
