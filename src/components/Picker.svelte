<script lang="ts">
	import { tick } from 'svelte';
	import type { Row } from '../lib/doc';
	import { itemText, type Source } from '../lib/source';
	import Icon from './Icon.svelte';

	// The menu a table's + opens when it draws on another table: a blank row, or one of its.
	let {
		src,
		onblank,
		onpick
	}: {
		src: Source;
		onblank: () => void;
		onpick: (item: Row) => void;
	} = $props();

	let menu = $state<HTMLDivElement>();
	let shown = $state(false);
	let q = $state('');
	let anchor: HTMLElement | undefined;
	let frame = 0;

	/** Opens under `from`, and stays under it as the sheet pans or scrolls. */
	export async function open(from: HTMLElement) {
		q = '';
		anchor = from;
		shown = true;
		await tick();
		cancelAnimationFrame(frame);
		stick();
		menu?.querySelector('input')?.focus();
	}

	const close = () => (shown = false);

	// On the sheet's own layer, not the page's top layer: the stage clips it and its panels
	// float over it, as over the fields. It sits after the viewport, outside its transform.
	function onStage(node: HTMLElement) {
		node.closest('.stage')?.querySelector(':scope > .viewport')?.after(node);
		return () => node.remove();
	}

	// Every frame while open, since a wheel pans the sheet under it; once its + leaves the
	// stage, it closes.
	function stick() {
		const stage = menu?.parentElement;
		if (!shown || !menu || !anchor || !stage) return;
		const r = anchor.getBoundingClientRect();
		const s = stage.getBoundingClientRect();
		if (
			!anchor.isConnected ||
			r.bottom < s.top ||
			r.top > s.bottom ||
			r.right < s.left ||
			r.left > s.right
		)
			return close();
		menu.style.left = `${Math.max(8, Math.min(r.left - s.left, s.width - menu.offsetWidth - 8))}px`;
		menu.style.top = `${Math.max(8, Math.min(r.bottom + 4 - s.top, s.height - menu.offsetHeight - 8))}px`;
		frame = requestAnimationFrame(stick);
	}

	/** A press anywhere else closes it, as a popover's would. */
	function outside(e: PointerEvent) {
		const at = e.target as Node;
		if (shown && !menu?.contains(at) && !anchor?.contains(at)) close();
	}

	const found = $derived(
		src.rows
			.filter((r) => {
				const t = itemText(src, r);
				return `${t.title} ${t.rest}`.toLowerCase().includes(q.trim().toLowerCase());
			})
			.slice(0, 50)
	);

	function take(fn: () => void) {
		close();
		fn();
	}
</script>

<svelte:window onpointerdowncapture={outside} />

<!-- Its presses and wheel stay its own, so the stage under it neither pans nor deselects. -->
<div
	class="menu panel"
	class:shown
	role="dialog"
	aria-label="Rows of {src.name}"
	tabindex="-1"
	bind:this={menu}
	{@attach onStage}
	onpointerdown={(e) => e.stopPropagation()}
	onwheel={(e) => e.stopPropagation()}
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		close();
		anchor?.focus();
	}}
>
	<button class="item blank" onclick={() => take(onblank)}><Icon name="plus" /> Blank row</button>
	<input type="search" bind:value={q} placeholder="Search {src.name}" aria-label="Search" />
	<div class="items">
		{#each found as r (r.id)}
			{@const t = itemText(src, r)}
			<button class="item" onclick={() => take(() => onpick(r))}>
				<span>{t.title}</span>
				{#if t.rest}<small>{t.rest}</small>{/if}
			</button>
		{:else}
			<p>Nothing matches.</p>
		{/each}
	</div>
</div>

<style>
	.menu {
		position: absolute;
		display: none;
		cursor: default;
		flex-direction: column;
		gap: 0.3rem;
		width: 17rem;
		max-height: 22rem;
		padding: 0.4rem;
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 6px 20px rgb(0 0 0 / 0.3);
	}
	.menu.shown {
		display: flex;
	}
	.items {
		display: grid;
		overflow: auto;
	}
	.item {
		display: grid;
		gap: 0.05rem;
		padding: 0.25rem 0.45rem;
		border-color: transparent;
		background: none;
		text-align: left;
	}
	.item:hover,
	.item:focus-visible {
		background: color-mix(in oklab, var(--accent) 12%, transparent);
	}
	.blank {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.item :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}
	small,
	p {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.78rem;
		color: var(--muted);
	}
	p {
		margin: 0.3rem 0.45rem;
	}
</style>
