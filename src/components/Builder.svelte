<script lang="ts">
	import { kinds, newId, type Doc, type Field, type Kind, type Template } from '../lib/doc';
	import { COLS, clamp, defaultWidth, place, resolve, type Box } from '../lib/layout';
	import { session } from '../lib/session.svelte';

	let { template }: { template: Template } = $props();

	// One row slot and the gap between slots, in pixels: the CSS and the pointer maths
	// both read these, so a drop lands where the outline showed it would.
	const ROW = 52;
	const GAP = 8;
	const NEW = '__new';

	const hint: Record<Kind, string> = {
		number: 'a single value',
		resource: 'current / max, with − and +',
		track: 'a row of boxes to tick',
		text: 'free text that grows with its content',
		tags: 'a list of short labels',
		entries: 'titled items, each with a description'
	};

	let selected = $state<string | null>(null);
	/** A gesture in flight: `id` null is a new field still being dragged from the palette. */
	let drag = $state<{ id: string | null; kind: Kind; box: Box } | null>(null);
	let canvas: HTMLElement;

	const field = $derived(template.fields.find((f) => f.id === selected));
	const boxes = $derived(resolve(template.fields));
	// While dragging, the rest reflow live around the outline, so the drop holds no surprise.
	const shown = $derived.by(() => {
		if (!drag) return boxes;
		if (drag.id) return place(template.fields, drag.id, drag.box);
		return place([...template.fields, { id: NEW, label: '', kind: drag.kind }], NEW, drag.box);
	});
	// Two spare rows below the last field, so there is always somewhere to drop.
	const rows = $derived(Math.max(0, ...[...shown.values()].map((b) => b.y + b.h)) + 2);

	const live = (d: Doc) => d.templates.find((t) => t.id === template.id)!;
	const write = (d: Doc, laid: Map<string, Box>) => {
		for (const f of live(d).fields) f.box = laid.get(f.id);
	};

	const moveTo = (id: string, to: Box) =>
		session.change((d) => write(d, place(live(d).fields, id, to)));

	function add(kind: Kind, at?: Box) {
		const id = newId();
		session.change((d) => {
			const fields = live(d).fields;
			fields.push({ id, label: `New ${kind}`, kind });
			// Without a target it goes below everything, then floats up to the first gap.
			write(d, place(fields, id, at ?? { x: 0, y: rows, w: defaultWidth(kind), h: 1 }));
		});
		selected = id;
	}

	function remove(id: string) {
		session.change((d) => {
			live(d).fields = live(d).fields.filter((f) => f.id !== id);
			write(d, resolve(live(d).fields));
		});
		selected = null;
	}

	const editField = (id: string, fn: (f: Field) => void) =>
		session.change((d) => fn(live(d).fields.find((f) => f.id === id)!));

	function grab(e: PointerEvent, mode: 'move' | 'size' | 'new', id: string | null, kind: Kind) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		if (id) selected = id;
		const el = e.currentTarget as HTMLElement;
		// Capture keeps the gesture alive when the pointer outruns the box, but throws for
		// a pointer the element never owned, which must not abort the drag.
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			/* proceed uncaptured */
		}
		const sx = e.clientX;
		const sy = e.clientY;
		const from = id ? boxes.get(id)! : null;
		let moved = false;

		const onmove = (ev: PointerEvent) => {
			const r = canvas.getBoundingClientRect();
			const pitchX = (r.width + GAP) / COLS;
			const pitchY = ROW + GAP;
			moved ||= Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4;
			if (!moved) return;
			if (mode === 'new') {
				const inside =
					ev.clientX >= r.left &&
					ev.clientX <= r.right &&
					ev.clientY >= r.top &&
					ev.clientY <= r.bottom;
				const box = {
					x: Math.floor((ev.clientX - r.left) / pitchX),
					y: Math.floor((ev.clientY - r.top) / pitchY),
					w: defaultWidth(kind),
					h: 1
				};
				drag = inside ? { id: null, kind, box: clamp(box) } : null;
				return;
			}
			const dx = Math.round((ev.clientX - sx) / pitchX);
			const dy = Math.round((ev.clientY - sy) / pitchY);
			const box =
				mode === 'move'
					? { ...from!, x: from!.x + dx, y: from!.y + dy }
					: { ...from!, w: Math.min(from!.w + dx, COLS - from!.x), h: from!.h + dy };
			drag = { id, kind, box: clamp(box) };
		};

		const onup = () => {
			try {
				el.releasePointerCapture(e.pointerId);
			} catch {
				/* never captured */
			}
			el.removeEventListener('pointermove', onmove);
			el.removeEventListener('pointerup', onup);
			el.removeEventListener('pointercancel', onup);
			const done = drag;
			drag = null;
			// Only the release is written, so a whole gesture is one undo step.
			if (mode === 'new') {
				if (done) add(kind, done.box);
				else if (!moved) add(kind);
			} else if (done && id) {
				moveTo(id, done.box);
			}
		};
		el.addEventListener('pointermove', onmove);
		el.addEventListener('pointerup', onup);
		el.addEventListener('pointercancel', onup);
	}

	const arrows: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};

	function onkey(e: KeyboardEvent, id: string) {
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			remove(id);
			return;
		}
		const step = arrows[e.key];
		if (!step) return;
		e.preventDefault();
		const [dx, dy] = step;
		const b = boxes.get(id)!;
		moveTo(
			id,
			e.shiftKey
				? { ...b, w: Math.min(b.w + dx, COLS - b.x), h: b.h + dy }
				: { ...b, x: b.x + dx, y: b.y + dy }
		);
	}
</script>

<div class="builder">
	<div class="stage">
		<div class="palette" aria-label="Add a field">
			{#each kinds as kind (kind)}
				<button
					class="chip"
					title="Drag onto the grid, or click to add at the bottom: {hint[kind]}"
					onpointerdown={(e) => grab(e, 'new', null, kind)}
					onclick={(e) => e.detail === 0 && add(kind)}>+ {kind}</button
				>
			{/each}
		</div>

		<div
			class="canvas"
			bind:this={canvas}
			style:--row="{ROW}px"
			style:--gap="{GAP}px"
			style:--rows={rows}
		>
			{#each { length: rows * COLS }, i (i)}
				<div class="cell" style:grid-area="{Math.floor(i / COLS) + 1} / {(i % COLS) + 1}"></div>
			{/each}
			{#each template.fields as f (f.id)}
				{@const b = shown.get(f.id)!}
				<div
					class="box"
					class:selected={selected === f.id}
					class:dragging={drag?.id === f.id}
					role="button"
					tabindex="0"
					aria-label="{f.label}, {f.kind}. Arrow keys move it, Shift with arrows resizes it."
					style:grid-area="{b.y + 1} / {b.x + 1} / span {b.h} / span {b.w}"
					onpointerdown={(e) => grab(e, 'move', f.id, f.kind)}
					onfocus={() => (selected = f.id)}
					onkeydown={(e) => onkey(e, f.id)}
				>
					<span class="label">{f.label}</span>
					<span class="kind">{f.kind} · {b.w}/{COLS}</span>
					<span class="grip" aria-hidden="true" onpointerdown={(e) => grab(e, 'size', f.id, f.kind)}
					></span>
				</div>
			{/each}
			{#if drag && !drag.id}
				{@const b = shown.get(NEW)!}
				<div class="box ghost" style:grid-area="{b.y + 1} / {b.x + 1} / span {b.h} / span {b.w}">
					<span class="label">New {drag.kind}</span>
				</div>
			{/if}
		</div>
	</div>

	<aside class="inspector">
		{#if field}
			{@const b = boxes.get(field.id)!}
			<label>
				<span class="muted">Label</span>
				<input
					value={field.label}
					onchange={(e) => {
						const text = e.currentTarget.value.trim();
						if (text) editField(field.id, (f) => (f.label = text));
					}}
				/>
			</label>
			<label>
				<span class="muted">Kind</span>
				<select
					value={field.kind}
					onchange={(e) => editField(field.id, (f) => (f.kind = e.currentTarget.value as Kind))}
				>
					{#each kinds as kind (kind)}
						<option value={kind}>{kind}</option>
					{/each}
				</select>
			</label>
			<p class="muted">{hint[field.kind]}</p>
			<p class="muted">{b.w} of {COLS} columns, {b.h} row{b.h === 1 ? '' : 's'} tall</p>
			<button onclick={() => remove(field.id)}>Delete field</button>
			<p class="muted">
				Changing a kind shows the field blank on every character using this template, until it is
				changed back or undone.
			</p>
		{:else}
			<p class="muted">
				Drag a kind from the palette onto the grid, or click it to add one at the bottom. Drag a
				field to move it and its corner to resize it. Rows grow to fit their text in play.
			</p>
			<p class="muted">
				With a field selected, arrow keys move it, Shift with the arrows resizes it, and Delete
				removes it.
			</p>
		{/if}
	</aside>
</div>

<style>
	.builder {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 15rem;
		gap: 1rem;
		align-items: start;
	}
	.stage {
		display: grid;
		gap: 0.6rem;
	}
	.palette {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chip {
		touch-action: none;
		cursor: grab;
	}
	.canvas {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		grid-template-rows: repeat(var(--rows), var(--row));
		gap: var(--gap);
		user-select: none;
	}
	.cell {
		border: 1px dashed color-mix(in oklab, var(--line) 80%, transparent);
		border-radius: 3px;
	}
	.box {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		cursor: grab;
		touch-action: none;
		transition: box-shadow 120ms;
	}
	.box:focus-visible,
	.box.selected {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.box.dragging {
		z-index: 2;
		cursor: grabbing;
		opacity: 0.9;
	}
	.ghost {
		border-style: dashed;
		border-color: var(--accent);
		background: color-mix(in oklab, var(--accent) 10%, var(--surface));
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.kind {
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--muted);
	}
	.grip {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 16px;
		height: 16px;
		cursor: nwse-resize;
		background: linear-gradient(135deg, transparent 55%, var(--muted) 55%);
	}
	.inspector {
		position: sticky;
		top: 4rem;
		display: grid;
		gap: 0.6rem;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--surface);
	}
	label {
		display: grid;
		gap: 0.2rem;
	}
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	@media (max-width: 760px) {
		.builder {
			grid-template-columns: minmax(0, 1fr);
		}
		.inspector {
			position: static;
		}
	}
</style>
