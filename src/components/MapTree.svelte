<script lang="ts">
	import { valueOf, type Character, type Field } from '../lib/doc';
	import { t } from '../lib/i18n.svelte';
	import { canHang, mapSource, pathTo, treeOf } from '../lib/map';
	import { session } from '../lib/session.svelte';

	// A map field: its source's rows as a tree. In play a node is pressed to make it
	// current; in Edit layout a node or an unplaced row is dragged onto its parent.
	let { character, field, laying }: { character: Character; field: Field; laying: boolean } =
		$props();

	const W = 104;
	const H = 30;
	const COL = W + 40;
	const LINE = H + 10;

	const src = $derived(mapSource(session.doc, field));
	const tree = $derived(src ? treeOf(src, field.parents) : null);
	const current = $derived(valueOf(character, field) as string);
	const path = $derived(tree ? pathTo(tree, current) : new Set<string>());
	const at = $derived(new Map(tree?.spots.map((s) => [s.row.id, s]) ?? []));
	const width = $derived(Math.max(0, ...(tree?.spots.map((s) => s.depth + 1) ?? [])) * COL - 40);

	function press(row: string) {
		session.change((d) => {
			d.characters.find((c) => c.id === character.id)!.values[field.id] = row;
		});
	}

	/** One write per drop: `parent` null makes a root, undefined takes the row off the map. */
	function hang(row: string, parent: string | null | undefined) {
		const parents = field.parents ?? {};
		const to = parent === undefined ? undefined : (parent ?? '');
		if (parents[row] === to || (parent && !canHang(parents, row, parent))) return;
		session.change((d) => {
			const f = d.characters
				.find((c) => c.id === character.id)!
				.fields.find((x) => x.id === field.id)!;
			const next = { ...(f.parents ?? {}) };
			if (to === undefined) delete next[row];
			else next[row] = to;
			if (Object.keys(next).length) f.parents = next;
			else delete f.parents;
		});
	}

	// A drag in Edit layout, and what it would land on. No ghost follows the pointer: the
	// viewport is transformed, so a fixed one would sit off it.
	let drag = $state<{ row: string } | null>(null);
	let target = $state<string | null | undefined>(undefined);

	let mapEl = $state<HTMLElement>();

	// Anywhere else in the field's box makes a root, not just over the tree.
	function landing(x: number, y: number): string | null | undefined {
		const el = document.elementFromPoint(x, y);
		const node = el?.closest<HTMLElement>('[data-node]');
		if (node) return node.dataset.node!;
		if (!el || el.closest('.tray')) return undefined;
		return (mapEl?.closest('.slot') ?? mapEl)?.contains(el) ? null : undefined;
	}

	function grab(e: PointerEvent, row: string) {
		if (!laying || e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const sx = e.clientX;
		const sy = e.clientY;
		const move = (m: PointerEvent) => {
			if (!drag && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
			drag = { row };
			const to = landing(m.clientX, m.clientY);
			target = to === row ? undefined : to;
		};
		const up = (u: PointerEvent) => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
			if (drag && u.type === 'pointerup') {
				const to = landing(u.clientX, u.clientY);
				if (to !== row) hang(row, to);
			}
			drag = null;
			target = undefined;
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	}
</script>

{#if !src || !tree}
	<p class="none">{t('Set From in Edit layout to a table: its rows become the nodes.')}</p>
{:else}
	<div
		bind:this={mapEl}
		class="map"
		class:laying
		class:dragging={!!drag}
		class:over={!!drag && target === null}
	>
		{#if tree.spots.length}
			<div class="tree" style:width="{width}px" style:height="{tree.lines * LINE - 10}px">
				<svg class="edges" {width} height={tree.lines * LINE} aria-hidden="true">
					{#each tree.spots as s (s.row.id)}
						{#if s.parent && at.get(s.parent)}
							{@const p = at.get(s.parent)!}
							<path
								class:on={path.has(s.row.id)}
								d="M{p.depth * COL + W} {p.line * LINE + H / 2}h20V{s.line * LINE +
									H / 2}H{s.depth * COL}"
							/>
						{/if}
					{/each}
				</svg>
				{#each tree.spots as s (s.row.id)}
					<button
						class="node"
						class:here={s.row.id === current}
						class:path={path.has(s.row.id)}
						class:target={!!drag && target === s.row.id}
						class:lifted={drag?.row === s.row.id}
						data-node={s.row.id}
						style:left="{s.depth * COL}px"
						style:top="{s.line * LINE}px"
						title={s.name}
						aria-pressed={laying ? undefined : s.row.id === current}
						onpointerdown={(e) => grab(e, s.row.id)}
						onclick={() => !laying && press(s.row.id)}>{s.name || '?'}</button
					>
				{/each}
			</div>
		{:else}
			<p class="none">
				{laying
					? t('Drag a row onto the map to make it the root, then others onto it.')
					: t('Arrange the map in Edit layout.')}
			</p>
		{/if}
		{#if laying && tree.unplaced.length}
			<div class="tray" class:over={!!drag && target === undefined && at.has(drag.row)}>
				<span class="muted">{t('Unplaced')}</span>
				{#each tree.unplaced as u (u.row.id)}
					<button
						class="node loose"
						class:lifted={drag?.row === u.row.id}
						title={u.name}
						onpointerdown={(e) => grab(e, u.row.id)}>{u.name || '?'}</button
					>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.map {
		display: grid;
		align-content: start;
		gap: 0.75rem;
		padding: 0.25rem;
		border-radius: var(--radius);
	}
	.map.over {
		outline: 1px dashed var(--accent);
	}
	.tree {
		position: relative;
	}
	.edges {
		position: absolute;
		inset: 0;
		overflow: visible;
		pointer-events: none;
	}
	.edges path {
		fill: none;
		stroke: var(--line);
		stroke-width: 1.25;
	}
	.edges path.on {
		stroke: var(--accent);
		stroke-width: 2;
	}
	.node {
		position: absolute;
		width: 104px;
		height: 30px;
		padding: 0 0.6rem;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 0.9rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.node:hover {
		border-color: var(--ink);
	}
	.node.path {
		border-color: var(--accent);
	}
	.node.here {
		border: 2px solid var(--accent);
		background: color-mix(in oklab, var(--accent) 16%, var(--surface));
		font-weight: 600;
	}
	.laying .node {
		cursor: grab;
		touch-action: none;
	}
	.node.target {
		outline: 2px dashed var(--accent);
		outline-offset: 2px;
	}
	.node.lifted {
		opacity: 0.4;
	}
	.tray {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: color-mix(in oklab, var(--ink) 4%, transparent);
	}
	.tray.over {
		outline: 1px dashed var(--accent);
	}
	.node.loose {
		position: static;
		border-style: dashed;
	}
	.dragging,
	.dragging .node {
		cursor: grabbing;
	}
	.none,
	.muted {
		color: var(--muted);
	}
	.none {
		margin: 0;
	}
</style>
