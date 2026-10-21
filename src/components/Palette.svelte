<script lang="ts" module>
	import type { Kind } from '../lib/doc';

	export const hints: Record<Kind, string> = {
		number: 'a single value',
		resource: 'current / max, with − and +',
		track: 'a row of boxes to tick',
		text: 'free text, in Markdown',
		tags: 'a list of short labels',
		entries: 'titled items, described in Markdown',
		image: 'a picture: pick, drop or paste one'
	};
</script>

<script lang="ts">
	import { kinds } from '../lib/doc';
	import Icon from './Icon.svelte';

	let { grab, add }: { grab: (e: PointerEvent, kind: Kind) => void; add: (kind: Kind) => void } =
		$props();
</script>

<!-- Two columns, as in SAO's menu: round icons, and beside each a bar naming it, which
     slides out as its icon is hovered. -->
<aside class="rail" aria-label="Add a field">
	{#each kinds as kind (kind)}
		<button
			class="kind"
			aria-label="Add {kind}: {hints[kind]}. Drag onto the sheet, or click."
			onpointerdown={(e) => grab(e, kind)}
			onclick={(e) => e.detail === 0 && add(kind)}
		>
			<span class="dot"><Icon name={kind} /></span>
			<span class="bar" aria-hidden="true">
				<b>{kind}</b>
				<small>{hints[kind]}</small>
			</span>
		</button>
	{/each}
</aside>

<style>
	.rail {
		position: absolute;
		top: 12px;
		left: 12px;
		display: grid;
		justify-items: start;
		gap: 0.45rem;
		padding: 0.4rem;
		cursor: auto;
	}
	.kind {
		position: relative;
		padding: 0;
		border: none;
		background: none;
		touch-action: none;
		cursor: grab;
	}
	.bar {
		position: absolute;
		top: 50%;
		left: calc(100% + 0.7rem);
		display: grid;
		width: 15.5rem;
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--line);
		border-left: 2px solid var(--accent);
		border-radius: 3px;
		background: var(--panel-bg);
		text-align: left;
		line-height: 1.2;
		opacity: 0;
		translate: -0.6rem -50%;
		pointer-events: none;
		transition:
			opacity 0.15s,
			translate 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	/* The notch pointing back at its icon. */
	.bar::before {
		content: '';
		position: absolute;
		top: 50%;
		left: -0.45rem;
		border: 0.35rem solid transparent;
		border-left: 0;
		border-right-color: var(--accent);
		translate: 0 -50%;
	}
	.kind:hover .bar,
	.kind:focus-visible .bar {
		opacity: 1;
		translate: 0 -50%;
		pointer-events: auto;
	}
	small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
	}
</style>
