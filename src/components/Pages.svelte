<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { pageStarts } from '../lib/pages';
	import { ui } from '../lib/ui.svelte';
	import Icon from './Icon.svelte';

	// A table's rows or a list's entries, flipped by page when `on`, else as they are. Every
	// row stays drawn, so each can be measured; those off the page carry `data-off`.
	let {
		on,
		at,
		rows,
		label,
		children
	}: {
		on: boolean;
		/** The list's `globalId`, which keeps its page in `ui.pages`. */
		at: string;
		/** Selects the rows inside `children`. */
		rows: string;
		label: string;
		children: Snippet;
	} = $props();

	let list = $state<HTMLDivElement>();
	let inner = $state<HTMLDivElement>();
	let starts = $state<number[]>([]);
	const page = $derived(Math.min(ui.pages[at] ?? 0, Math.max(0, starts.length - 1)));

	// The pager's height, 1.5rem, which rows have to give up only once there are pages.
	const pagerPx = () => 1.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);

	function measure() {
		if (!list || !inner) return;
		const els = [...inner.querySelectorAll<HTMLElement>(rows)];
		for (const el of els) el.removeAttribute('data-off');
		// Rects are zoomed with the sheet; heights are not.
		const scale = list.offsetHeight ? list.getBoundingClientRect().height / list.offsetHeight : 1;
		const spans = els.map((el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top / scale, bottom: r.bottom / scale };
		});
		const block = spans.length ? spans[spans.length - 1].bottom - spans[0].top : 0;
		const whole = list.clientHeight + (starts.length > 1 ? pagerPx() : 0);
		starts =
			inner.offsetHeight <= whole
				? [0]
				: pageStarts(spans, whole - pagerPx() - (inner.offsetHeight - block));
		show(page, els);
	}

	function show(p: number, els = [...(inner?.querySelectorAll<HTMLElement>(rows) ?? [])]) {
		const from = starts[p] ?? 0;
		const to = starts[p + 1] ?? els.length;
		els.forEach((el, i) => el.toggleAttribute('data-off', i < from || i >= to));
	}

	/** Turns to the last page, where a row just added lands. */
	export async function last() {
		if (!on) return;
		await tick();
		measure();
		ui.pages[at] = starts.length - 1;
	}

	$effect(() => {
		if (!on || !list || !inner) return;
		untrack(measure);
		// A resize is measured a frame later, since hiding rows inside its callback would
		// resize what it watches.
		let frame = 0;
		const resized = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		});
		resized.observe(list);
		const changed = new MutationObserver(measure);
		changed.observe(inner, { childList: true, subtree: true, characterData: true });
		return () => {
			cancelAnimationFrame(frame);
			resized.disconnect();
			changed.disconnect();
		};
	});

	// A flip, or a page gone with its rows, shows the new page from its top.
	$effect(() => {
		const p = page;
		if (!on) return;
		untrack(() => show(p));
		if (list) list.scrollTop = 0;
	});
</script>

{#if on}
	<div class="pages">
		<div class="list" bind:this={list} data-scroll>
			<div bind:this={inner}>{@render children()}</div>
		</div>
		{#if starts.length > 1}
			<!-- Its presses stay its own, so in Edit layout they flip pages, not grab the field. -->
			<nav class="pager" aria-label="Pages of {label}" onpointerdown={(e) => e.stopPropagation()}>
				<button
					class="icon"
					aria-label="Previous page"
					disabled={page === 0}
					onclick={() => (ui.pages[at] = page - 1)}><Icon name="prev" /></button
				>
				<span>{page + 1} / {starts.length}</span>
				<button
					class="icon"
					aria-label="Next page"
					disabled={page === starts.length - 1}
					onclick={() => (ui.pages[at] = page + 1)}><Icon name="next" /></button
				>
			</nav>
		{/if}
	</div>
{:else}
	{@render children()}
{/if}

<style>
	/* Fills what its field leaves below the label; a box no taller than its rows has none. */
	.pages {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	/* Scrolls only a row taller than the whole box, which has a page to itself. */
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.list :global([data-off]) {
		display: none !important;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		height: 1.5rem;
		font-size: 0.78rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
		border-color: transparent;
		background: none;
	}
	.icon:disabled {
		opacity: 0.35;
	}
	.icon :global(svg) {
		width: 0.95rem;
		height: 0.95rem;
	}
</style>
