<script lang="ts">
	import { curAt, fullness } from '../lib/bar';
	import type { Resource } from '../lib/doc';

	// A resource as a bar: a press or a drag along it sets the current, written once, on
	// release. Both numbers stay boxes before it, as a resource shows without the bar.
	let {
		value,
		label,
		set,
		compact = false
	}: { value: Resource; label: string; set: (r: Resource) => void; compact?: boolean } = $props();

	/** The current while a drag is under way, before it is written. */
	let dragged = $state<number | null>(null);
	const cur = $derived(dragged ?? value.cur);

	function at(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return curAt(e.clientX - r.left, r.width, value.max);
	}

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragged = at(e);
	}

	function up() {
		if (dragged !== null && dragged !== value.cur) set({ ...value, cur: dragged });
		dragged = null;
	}

	const keys: Record<string, (r: Resource) => number> = {
		ArrowRight: (r) => r.cur + 1,
		ArrowUp: (r) => r.cur + 1,
		ArrowLeft: (r) => r.cur - 1,
		ArrowDown: (r) => r.cur - 1,
		Home: () => 0,
		End: (r) => r.max
	};

	// Kept from the window, where the sheet's own keys listen.
	function key(e: KeyboardEvent) {
		const to = keys[e.key];
		if (!to) return;
		e.preventDefault();
		e.stopPropagation();
		set({ ...value, cur: to(value) });
	}

	function typed(e: Event & { currentTarget: HTMLInputElement }, part: 'cur' | 'max') {
		const text = e.currentTarget.value;
		const n = Number(text);
		if (text.trim() !== '' && Number.isFinite(n)) set({ ...value, [part]: n });
		else e.currentTarget.value = String(value[part]);
	}
</script>

<span class="bar" class:compact>
	<input type="number" value={cur} aria-label="{label} current" onchange={(e) => typed(e, 'cur')} />
	<span class="of">/</span>
	<input
		type="number"
		value={value.max}
		aria-label="{label} max"
		onchange={(e) => typed(e, 'max')}
	/>
	<span
		class="track"
		role="slider"
		tabindex="0"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={value.max}
		aria-valuenow={cur}
		onpointerdown={down}
		onpointermove={(e) => dragged !== null && (dragged = at(e))}
		onpointerup={up}
		onpointercancel={() => (dragged = null)}
		onkeydown={key}
	>
		<span class="rail"
			><span class="fill" style:width="{fullness({ cur, max: value.max })}%"></span></span
		>
	</span>
</span>

<style>
	.bar {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}
	/* The rail is thin, but the whole row's height takes a press. */
	.track {
		display: flex;
		flex: 1;
		align-items: center;
		min-width: 3rem;
		height: 1.6rem;
		margin-left: 0.3rem;
		cursor: pointer;
		touch-action: none;
	}
	.track:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: var(--radius);
	}
	.rail {
		flex: 1;
		height: 0.5rem;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in oklab, var(--line) 70%, transparent);
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.of {
		color: var(--muted);
	}
	/* Room for three digits, in a serif theme too. */
	input {
		width: 7.5ch;
		font-variant-numeric: tabular-nums;
	}
	.compact .track {
		height: 1.3rem;
	}
	.compact .rail {
		height: 0.4rem;
	}
</style>
