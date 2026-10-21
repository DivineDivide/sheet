<script lang="ts">
	import type { Layout } from '../lib/doc';
	import { bounds } from '../lib/layout';
	import { markdown } from '../lib/markdown';

	// A miniature of a layout's first tab: where each field sits, and its label.
	let { layout }: { layout: Layout | null } = $props();

	const W = 240;
	const H = 150;
	const PAD = 10;

	const fields = $derived(layout ? layout.fields.filter((f) => f.tab === layout.tabs[0]?.id) : []);
	const b = $derived(bounds(fields.map((f) => f.box)));
	// Never past half size, so a two-field layout does not fill the card like a big one.
	const s = $derived(Math.min((W - 2 * PAD) / (b.w || 1), (H - 2 * PAD) / (b.h || 1), 0.5));
	const ox = $derived((W - b.w * s) / 2);
	const oy = $derived((H - b.h * s) / 2);
</script>

<div class="preview" style:width="{W}px" style:height="{H}px" aria-hidden="true">
	{#each fields as f (f.id)}
		<div
			class="box"
			style:left="{ox + (f.box.x - b.x) * s}px"
			style:top="{oy + (f.box.y - b.y) * s}px"
			style:width="{f.box.w * s}px"
			style:height="{f.box.h * s}px"
		>
			{@html markdown(f.label)}
		</div>
	{:else}
		<span class="blank"></span>
	{/each}
</div>

<style>
	.preview {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius);
		background: var(--page);
	}
	.box {
		position: absolute;
		padding: 2px 4px;
		overflow: hidden;
		border: var(--field-border);
		border-radius: 3px;
		background: var(--field-bg);
		font-size: 9px;
		line-height: 1.2;
		color: var(--muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A label's heading or paragraph, run flat into the one tiny line a box has room for. */
	.box :global(*) {
		display: inline;
		margin: 0;
		padding: 0;
		font-size: inherit;
	}
	.blank {
		position: absolute;
		inset: 12px;
		border: 1px dashed var(--line);
		border-radius: var(--radius);
	}
</style>
