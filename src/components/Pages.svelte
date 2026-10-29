<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { pageStarts } from '../lib/pages';
	import { pageOf, ui } from '../lib/ui.svelte';

	// A table's rows or a list's entries, flipped by page when `on`, else as they are. Every
	// row stays drawn, so each can be measured; those off the page carry `data-off`. The
	// field draws the pager on its label's line, from `count`.
	let {
		on,
		at,
		rows,
		flow = false,
		count = $bindable(0),
		children
	}: {
		on: boolean;
		/** The list's `globalId`, which keeps its page in `ui.pages`. */
		at: string;
		/** Selects the rows inside `children`. */
		rows: string;
		/** Pages are columns, so a row taller than the box runs on to the next page by line. */
		flow?: boolean;
		/** How many pages it has. */
		count?: number;
		children: Snippet;
	} = $props();

	const GAP = 32;
	let step = 0;

	let list = $state<HTMLDivElement>();
	let inner = $state<HTMLDivElement>();
	let starts = $state<number[]>([]);
	const page = $derived(pageOf(at, starts.length));

	function measure() {
		if (!list || !inner) return;
		if (flow) return measureFlow(list, inner);
		const els = [...inner.querySelectorAll<HTMLElement>(rows)];
		for (const el of els) el.removeAttribute('data-off');
		// Rects are zoomed with the sheet; heights are not.
		const scale = list.offsetHeight ? list.getBoundingClientRect().height / list.offsetHeight : 1;
		const spans = els.map((el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top / scale, bottom: r.bottom / scale };
		});
		const block = spans.length ? spans[spans.length - 1].bottom - spans[0].top : 0;
		starts =
			inner.offsetHeight <= list.clientHeight
				? [0]
				: pageStarts(spans, list.clientHeight - (inner.offsetHeight - block));
		count = starts.length;
		show(page, els);
	}

	// Page n is the nth column, shifted into view.
	function measureFlow(list: HTMLDivElement, inner: HTMLDivElement) {
		const scale = list.offsetHeight ? list.getBoundingClientRect().height / list.offsetHeight : 1;
		// A row that fits a page stays whole; a longer one starts where it falls and runs on.
		for (const el of inner.querySelectorAll<HTMLElement>(rows)) {
			const tall = [...el.getClientRects()].reduce((h, r) => h + r.height, 0) / scale;
			el.style.breakInside = tall > list.clientHeight ? '' : 'avoid';
		}
		const left = inner.getBoundingClientRect().left;
		const right = inner.firstElementChild?.getBoundingClientRect().right ?? left;
		step = list.clientWidth + GAP;
		const n = Math.max(1, Math.ceil(((right - left) / scale - 1) / step));
		starts = Array.from({ length: n }, (_, i) => i);
		count = n;
		// Writing in a row shows the page it is on.
		const focus = document.activeElement;
		if (focus && inner.contains(focus)) {
			const p = Math.floor((focus.getBoundingClientRect().left - left) / scale / step);
			if (p !== page) ui.pages[at] = p;
		}
		show(page);
	}

	function show(p: number, els = [...(inner?.querySelectorAll<HTMLElement>(rows) ?? [])]) {
		if (flow) {
			if (inner) inner.style.translate = p ? `${-p * step}px 0` : '';
			return;
		}
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
	<div class="list" class:flow bind:this={list} data-scroll>
		<div bind:this={inner}>{@render children()}</div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	/* Fills what its field leaves below the label, and scrolls only a row taller than the
	   whole box, which has a page to itself. */
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.list :global([data-off]) {
		display: none !important;
	}
	.flow {
		overflow: hidden;
	}
	/* A row being written may outgrow its page, which then scrolls. */
	.flow:focus-within {
		overflow-y: auto;
	}
	.flow > div {
		height: 100%;
		column-count: 1;
		column-gap: 32px;
		column-fill: auto;
	}
</style>
