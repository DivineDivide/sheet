<script lang="ts">
	import { toBlob } from 'html-to-image';
	import { tick } from 'svelte';
	import {
		blank,
		columnKinds,
		newId,
		uniqueLabel,
		type Character,
		type ColumnKind,
		type Doc,
		type Field,
		type Kind
	} from '../lib/doc';
	import type { Attachment } from 'svelte/attachments';
	import { chat } from '../lib/agent/client.svelte';
	import { keep, kept, type Clip } from '../lib/clip';
	import { lift, place } from '../lib/group';
	import { free, mod } from '../lib/keys';
	import { SNAP, bounds, clamp, defaultSize, readingOrder, type Box } from '../lib/layout';
	import { session } from '../lib/session.svelte';
	import { ui } from '../lib/ui.svelte';
	import { HOME, fit, toSheet, zoomAt, type View } from '../lib/view';
	import FieldValue from './FieldValue.svelte';
	import Icon from './Icon.svelte';
	import Palette from './Palette.svelte';
	import ShareCard from './ShareCard.svelte';
	import { gapAt } from './Table.svelte';
	import Toolbar from './Toolbar.svelte';

	let { character }: { character: Character } = $props();

	// Narrower than this the fields stack in reading order, and there is no room to lay out.
	const NARROW = 640;

	// View state, not document state: none of it is an undo step.
	let editing = $state(false);
	let tabId = $state('');
	/** The selected fields, shift-click adding to them; the last is the one inspected. */
	let chosen = $state<string[]>([]);
	/** A gesture in flight: `id` null is a new field still being dragged from the palette. */
	let drag = $state<{ id: string | null; kind: Kind; box: Box } | null>(null);
	/** A kind from the palette held over a table, to land as a column at `index`. */
	let drop = $state<{ field: string; index: number } | null>(null);
	/** The table column the inspector shows. */
	let picked = $state<{ field: string; column: string } | null>(null);
	let panning = $state(false);
	let vw = $state(0);
	let vh = $state(0);
	let stage = $state<HTMLElement>();
	let sharing = $state(false);
	let card = $state<HTMLElement>();

	const tab = $derived(character.tabs.find((t) => t.id === tabId) ?? character.tabs[0]);
	const onTab = $derived(character.fields.filter((f) => f.tab === tab.id));
	const stacked = $derived(vw > 0 && vw < NARROW);
	// A draft is only looked at: it is edited through the chat, until applied or discarded.
	const drafting = $derived(session.draft !== null);
	const laying = $derived(editing && !stacked && !drafting);
	const selected = $derived(chosen.at(-1) ?? null);
	const field = $derived(character.fields.find((f) => f.id === selected));
	const group = $derived(character.fields.filter((f) => chosen.includes(f.id)));
	const column = $derived(
		picked && picked.field === field?.id
			? field.columns?.find((c) => c.id === picked!.column)
			: undefined
	);
	const boxOf = (f: Field) => (drag?.id === f.id ? drag.box : f.box);

	// Each tab keeps where it was looking; a tab not looked at yet opens on 0,0.
	const viewKey = $derived(`${character.id}:${tab.id}`);
	const view = $derived(ui.views[viewKey] ?? HOME);
	const look = (v: View) => (ui.views[viewKey] = v);
	const zoomBy = (k: number) => look(zoomAt(view, view.z * k));
	const fitTab = () =>
		look(
			fit(
				onTab.map((f) => f.box),
				vw,
				vh
			)
		);
	// Where 0,0 sits on screen, from the stage's top left.
	const ox = $derived(vw / 2 - view.x * view.z);
	const oy = $derived(vh / 2 - view.y * view.z);

	/** A pointer's place measured from the middle of the stage, as a view measures it. */
	function fromMiddle(ev: { clientX: number; clientY: number }) {
		const r = stage!.getBoundingClientRect();
		return [ev.clientX - r.left - r.width / 2, ev.clientY - r.top - r.height / 2] as const;
	}

	const live = (d: Doc) => d.characters.find((c) => c.id === character.id)!;
	const edit = (fn: (c: Character) => void) => session.change((d) => fn(live(d)));
	const fieldOf = (c: Character, id: string) => c.fields.find((f) => f.id === id)!;

	const moveTo = (id: string, to: Box) => edit((c) => (fieldOf(c, id).box = clamp(to)));
	const editField = (id: string, fn: (f: Field) => void) => edit((c) => fn(fieldOf(c, id)));

	function add(kind: Kind, at?: Box) {
		const id = newId();
		const size = defaultSize(kind);
		// Without a drop point, in the middle of what is on screen.
		const box = clamp(at ?? { x: view.x - size.w / 2, y: view.y - size.h / 2, ...size });
		edit((c) => {
			c.fields.push({ id, label: uniqueLabel(`New ${kind}`, c.fields), kind, tab: tab.id, box });
			// A table starts with a column, so it has rows to add.
			if (kind === 'table')
				c.fields.at(-1)!.columns = [{ id: newId(), name: 'Name', kind: 'text' }];
			c.values[id] = blank(kind);
		});
		chosen = [id];
	}

	function addColumn(id: string, kind: ColumnKind, at: number) {
		const col = newId();
		editField(id, (f) => {
			const cols = f.columns ?? [];
			const named = cols.map((c) => ({ id: c.id, label: c.name }));
			const name = uniqueLabel(kind[0].toUpperCase() + kind.slice(1), named);
			cols.splice(at, 0, { id: col, name, kind });
			f.columns = cols;
		});
		chosen = [id];
		picked = { field: id, column: col };
	}

	function remove(id: string) {
		edit((c) => {
			c.fields = c.fields.filter((f) => f.id !== id);
			delete c.values[id];
		});
		chosen = [];
	}

	function copy(ids: string[]) {
		const g = lift(character, session.doc.clocks, ids, true);
		const { x, y } = bounds(group.map((f) => f.box));
		keep({ ...g, at: { x, y } });
		const what = ids.length === 1 ? g.fields[0].label : `${ids.length} fields`;
		session.notice = `Copied ${what}. ${mod}V pastes in Edit layout, on any character.`;
	}

	/** Where the fields were copied from, off any field already there, so pastes fan out. */
	function paste(g: Clip) {
		let ids: string[] = [];
		session.change((d) => (ids = place(g, live(d), d.clocks, tab.id, g.at)));
		chosen = ids;
	}

	function saveTemplate(name: string) {
		session.change((d) => {
			const { tabs, fields } = $state.snapshot(live(d));
			d.templates.push({ id: newId(), name, tabs, fields });
		});
		session.notice = `Saved "${name}" as a template.`;
	}

	function addTab() {
		const id = newId();
		edit((c) => c.tabs.push({ id, name: `Tab ${c.tabs.length + 1}` }));
		tabId = id;
	}

	function grab(e: PointerEvent, mode: 'move' | 'size' | 'new', id: string | null, kind: Kind) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		if (id && e.shiftKey && mode === 'move') {
			chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
			return;
		}
		if (id) chosen = [id];
		const sx = e.clientX;
		const sy = e.clientY;
		const from = id ? fieldOf(character, id).box : null;
		let moved = false;

		const onmove = (ev: PointerEvent) => {
			moved ||= Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4;
			if (!moved) return;
			if (mode === 'new') {
				// A kind a cell can hold, held over a table, becomes a column of it.
				const over = (columnKinds as readonly string[]).includes(kind)
					? document
							.elementFromPoint(ev.clientX, ev.clientY)
							?.closest<HTMLElement>('.slot[data-table]')
					: null;
				drop = over ? { field: over.dataset.table!, index: gapAt(over, ev.clientX) } : null;
				if (over) {
					drag = null;
					return;
				}
				const r = stage!.getBoundingClientRect();
				// Not over a rail either: a field dropped there would land hidden under it.
				const inside =
					ev.clientX >= r.left &&
					ev.clientX <= r.right &&
					ev.clientY >= r.top &&
					ev.clientY <= r.bottom &&
					!(ev.target as Element).closest('.rail');
				// Held by its top-left corner, a little up and left of the pointer.
				const p = toSheet(view, ...fromMiddle(ev));
				const at = { x: p.x - 16 / view.z, y: p.y - 12 / view.z };
				drag = inside ? { id: null, kind, box: clamp({ ...at, ...defaultSize(kind) }) } : null;
				return;
			}
			const dx = (ev.clientX - sx) / view.z;
			const dy = (ev.clientY - sy) / view.z;
			const box =
				mode === 'move'
					? { ...from!, x: from!.x + dx, y: from!.y + dy }
					: { ...from!, w: from!.w + dx, h: from!.h + dy };
			drag = { id, kind, box: clamp(box) };
		};

		const onup = () => {
			window.removeEventListener('pointermove', onmove);
			window.removeEventListener('pointerup', onup);
			window.removeEventListener('pointercancel', onup);
			const done = drag;
			const into = drop;
			drag = null;
			drop = null;
			// Only the release is written, so a whole gesture is one undo step.
			if (mode === 'new') {
				if (into) addColumn(into.field, kind as ColumnKind, into.index);
				else if (done) add(kind, done.box);
				else if (!moved) add(kind);
			} else if (done && id) {
				moveTo(id, done.box);
			}
		};
		// On the window, not the grabbed element: the release usually lands over the sheet,
		// not over the palette icon it started on, and capture is not granted to every pointer.
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
		window.addEventListener('pointercancel', onup);
	}

	/** Dragging empty canvas pans, in play too; the middle button pans from anywhere. */
	function pan(e: PointerEvent) {
		const own = (e.target as Element).closest('.slot, .rail, .zoom');
		if (stacked || (e.button !== 1 && (e.button !== 0 || own))) return;
		e.preventDefault();
		// The press is cancelled, so it would not take focus from an open text box itself.
		(document.activeElement as HTMLElement | null)?.blur();
		const sx = e.clientX;
		const sy = e.clientY;
		const from = view;
		let moved = false;
		panning = true;

		const onmove = (ev: PointerEvent) => {
			moved ||= Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4;
			look({
				...from,
				x: from.x - (ev.clientX - sx) / from.z,
				y: from.y - (ev.clientY - sy) / from.z
			});
		};
		const onup = () => {
			window.removeEventListener('pointermove', onmove);
			window.removeEventListener('pointerup', onup);
			window.removeEventListener('pointercancel', onup);
			panning = false;
			if (!moved) chosen = [];
		};
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
		window.addEventListener('pointercancel', onup);
	}

	const scrolls = (el: Element, dx: number, dy: number) =>
		(dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) ||
		(dy < 0 && el.scrollTop > 0) ||
		(dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) ||
		(dx < 0 && el.scrollLeft > 0);

	// Wheel and trackpad pan; with ⌘ or Ctrl, which a pinch sends, they zoom at the pointer.
	// Not through Svelte's onwheel, which may be passive and so could not stop the page zoom.
	const wheel: Attachment<HTMLElement> = (el) => {
		const on = (e: WheelEvent) => {
			if (stacked || (e.target as Element).closest('.rail')) return;
			const k = e.deltaMode === 1 ? 16 : 1;
			const dx = e.deltaX * k;
			const dy = e.deltaY * k;
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				// Capped, so a mouse notch (100) steps like a pinch, not 2.7× at once.
				const step = Math.max(-25, Math.min(25, dy));
				look(zoomAt(view, view.z * Math.exp(-step * 0.01), ...fromMiddle(e)));
				return;
			}
			// A long field scrolls its own content first, as a page inside the sheet would.
			const slot = (e.target as Element).closest('.slot');
			if (!laying && slot && scrolls(slot, dx, dy)) return;
			e.preventDefault();
			look({ ...view, x: view.x + dx / view.z, y: view.y + dy / view.z });
		};
		el.addEventListener('wheel', on, { passive: false });
		return () => el.removeEventListener('wheel', on);
	};

	/** The share card exists only while it is being drawn, off screen. */
	async function render(): Promise<Blob> {
		sharing = true;
		await tick();
		try {
			// The card inside, not the off-screen wrapper, whose offset the copy would keep.
			// The fonts are the system's own, so there is nothing to embed.
			const node = card!.firstElementChild as HTMLElement;
			const blob = await toBlob(node, { pixelRatio: 2, skipFonts: true });
			if (!blob) throw new Error('empty image');
			return blob;
		} finally {
			sharing = false;
		}
	}

	function copyImage() {
		const name = character.name;
		const png = render();
		// The item is made inside the click, holding the unfinished image: Safari refuses a
		// clipboard write that starts after the click has returned.
		if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
			navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
				() => (session.notice = `Copied ${name} as an image. Paste it into the chat.`),
				() => download(png, name)
			);
		} else {
			download(png, name);
		}
	}

	async function download(png: Promise<Blob>, name: string) {
		try {
			const url = URL.createObjectURL(await png);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${name}.png`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			session.notice = `This browser would not copy the image, so ${name}.png was downloaded instead.`;
		} catch {
			session.notice = `The image of ${name} could not be made.`;
		}
	}

	const arrows: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};

	function toggleEditing() {
		editing = !editing;
		chosen = [];
	}

	// On the window, not the field: a field selected by a click is not focused, since the
	// drag's pointerdown is cancelled.
	function onkeydown(e: KeyboardEvent) {
		if (!free(e) || e.altKey) return;
		const key = e.key.toLowerCase();
		const step = arrows[e.key];
		const f = laying && field?.tab === tab.id ? field : undefined;
		if (e.metaKey || e.ctrlKey) {
			if (key === 'c' && f) copy(group.map((g) => g.id));
			else if (key === 'v' && laying && kept()) paste(kept()!);
			else return;
		} else if (key === 'e') {
			if (!stacked && !drafting) toggleEditing();
		} else if (key === 'escape' && editing) {
			// `field`, not `selected`: an undone paste leaves `selected` naming no field.
			if (!field) editing = false;
			// A field reached by Tab would otherwise still show its focus ring.
			else (e.target as HTMLElement).blur();
			chosen = [];
		} else if (!stacked && (key === '=' || key === '+' || key === '-')) {
			zoomBy(key === '-' ? 0.8 : 1.25);
		} else if (!stacked && e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit0')) {
			if (e.code === 'Digit1') fitTab();
			else look(HOME);
		} else if (/^[1-9]$/.test(e.key) && character.tabs[+e.key - 1]) {
			tabId = character.tabs[+e.key - 1].id;
			chosen = [];
		} else if (f && (e.key === 'Delete' || e.key === 'Backspace')) {
			remove(f.id);
		} else if (f && step) {
			const [dx, dy] = step.map((n) => n * SNAP);
			const b = f.box;
			moveTo(
				f.id,
				e.shiftKey ? { ...b, w: b.w + dx, h: b.h + dy } : { ...b, x: b.x + dx, y: b.y + dy }
			);
		} else {
			return;
		}
		e.preventDefault();
	}
</script>

<svelte:window {onkeydown} />

<div class="sheet">
	<header inert={drafting || undefined}>
		<input
			class="name"
			value={character.name}
			aria-label="Character name"
			onchange={(e) => {
				const text = e.currentTarget.value.trim();
				if (text) edit((c) => (c.name = text));
			}}
		/>
		<button
			disabled={sharing}
			title="Copy every tab, with each value in full, as an image to paste into a chat"
			onclick={copyImage}>{sharing ? 'Copying…' : 'Copy image'}</button
		>
		<button
			class:on={editing}
			aria-pressed={editing}
			disabled={stacked}
			title={stacked ? 'Widen the window to lay out fields' : 'Add, move and resize fields (E)'}
			onclick={toggleEditing}>{editing ? 'Done' : 'Edit layout'}</button
		>
		<button
			class="x"
			aria-label="Delete {character.name}"
			title="Delete character"
			onclick={() =>
				session.change((d) => (d.characters = d.characters.filter((c) => c.id !== character.id)))}
			>×</button
		>
	</header>

	<nav class="tabs" aria-label="Tabs">
		{#each character.tabs as t (t.id)}
			{#if laying && t.id === tab.id}
				<input
					class="tab active"
					value={t.name}
					aria-label="Tab name"
					onchange={(e) => {
						const text = e.currentTarget.value.trim();
						if (text) edit((c) => (c.tabs.find((x) => x.id === t.id)!.name = text));
					}}
				/>
				{#if character.tabs.length > 1}
					<button
						class="x"
						aria-label="Delete tab {t.name}"
						disabled={onTab.length > 0}
						title={onTab.length ? 'Move or delete its fields first' : 'Delete tab'}
						onclick={() => edit((c) => (c.tabs = c.tabs.filter((x) => x.id !== t.id)))}>×</button
					>
				{/if}
			{:else}
				<button
					class="tab"
					class:active={t.id === tab.id}
					aria-current={t.id === tab.id}
					onclick={() => {
						tabId = t.id;
						chosen = [];
					}}>{t.name}</button
				>
			{/if}
		{/each}
		{#if laying}
			<button class="tab more" onclick={addTab}>+ Tab</button>
		{/if}
	</nav>

	<!-- svelte-ignore a11y_no_static_element_interactions: pan by pointer; +, − and ⇧1 do it by key -->
	<div
		class="stage"
		class:stacked
		class:laying
		class:panning
		bind:this={stage}
		bind:clientWidth={vw}
		bind:clientHeight={vh}
		onpointerdown={pan}
		{@attach wheel}
	>
		<div class="viewport" style:--ox="{ox}px" style:--oy="{oy}px" style:--dots="{16 * view.z}px">
			{#if !onTab.length && !drag}
				<p class="empty">
					Nothing on this tab yet.{stacked
						? ''
						: laying
							? ' Drag a field in from the left.'
							: ' Edit layout to add fields.'}
				</p>
			{/if}
			<div
				class="world"
				inert={drafting || undefined}
				style:transform={stacked ? undefined : `translate(${ox}px, ${oy}px) scale(${view.z})`}
			>
				{#if laying}<span class="origin" aria-hidden="true"></span>{/if}
				{#each stacked ? readingOrder(onTab) : onTab as f (f.id)}
					{@const b = boxOf(f)}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex: tabindex comes only with role="button" -->
					<div
						class="slot"
						class:selected={laying && chosen.includes(f.id)}
						class:target={drop?.field === f.id}
						class:dragging={drag?.id === f.id}
						class:changed={chat.changes?.fields.has(f.id)}
						data-table={f.kind === 'table' ? f.id : undefined}
						style:--x="{b.x}px"
						style:--y="{b.y}px"
						style:--w="{b.w}px"
						style:--h="{b.h}px"
						role={laying ? 'button' : undefined}
						tabindex={laying ? 0 : undefined}
						aria-label={laying
							? `${f.label}, ${f.kind}. Arrow keys move it, Shift with arrows resizes it.`
							: undefined}
						onpointerdown={laying ? (e) => grab(e, 'move', f.id, f.kind) : undefined}
						onfocus={laying ? () => (chosen = [f.id]) : undefined}
					>
						<!-- A table's headers are edited in place; it keeps the rest inert itself. -->
						<div class="content" inert={(laying && f.kind !== 'table') || undefined}>
							<FieldValue
								{character}
								field={f}
								{laying}
								picked={picked?.field === f.id ? picked.column : null}
								drop={drop?.field === f.id ? drop.index : null}
								onpick={(col) => {
									chosen = [f.id];
									picked = { field: f.id, column: col };
								}}
							/>
						</div>
						{#if laying}
							<span
								class="grip"
								aria-hidden="true"
								onpointerdown={(e) => grab(e, 'size', f.id, f.kind)}
							></span>
						{/if}
					</div>
				{/each}
				{#if drag && !drag.id}
					<div
						class="slot ghost"
						style:--x="{drag.box.x}px"
						style:--y="{drag.box.y}px"
						style:--w="{drag.box.w}px"
						style:--h="{drag.box.h}px"
					>
						New {drag.kind}
					</div>
				{/if}
			</div>
		</div>

		{#if laying}
			<Palette grab={(e, kind) => grab(e, 'new', null, kind)} {add} />
		{/if}
		{#if laying}
			<Toolbar {character} {field} {group} {column} {editField} {remove} {saveTemplate} />
		{/if}
		<div class="zoom" role="group" aria-label="Zoom and chat">
			{#if !stacked}
				<button class="dot" aria-label="Zoom out" title="Zoom out (−)" onclick={() => zoomBy(0.8)}
					><Icon name="minus" /></button
				>
				<button class="pct" title="Back to 100%" onclick={() => look(zoomAt(view, 1))}
					>{Math.round(view.z * 100)}%</button
				>
				<button class="dot" aria-label="Zoom in" title="Zoom in (+)" onclick={() => zoomBy(1.25)}
					><Icon name="plus" /></button
				>
				<button class="dot" aria-label="Fit the tab" title="Fit the tab (⇧1)" onclick={fitTab}
					><Icon name="fit" /></button
				>
				<button
					class="dot"
					aria-label="Go to 0,0"
					title="0,0 at 100% (⇧0)"
					onclick={() => look(HOME)}><Icon name="home" /></button
				>
			{/if}
			<button
				class="dot"
				aria-label="Chat"
				title="Ask Claude to change the room"
				aria-expanded={ui.panel === 'chat'}
				onclick={() => (ui.panel = ui.panel === 'chat' ? null : 'chat')}
				><Icon name="chat" /></button
			>
		</div>
	</div>
</div>

{#if sharing}
	<div class="offstage" aria-hidden="true" bind:this={card}>
		<ShareCard {character} clocks={session.doc.clocks} />
	</div>
{/if}

<style>
	.sheet {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.name {
		flex: 1;
		min-width: 0;
		border-color: transparent;
		background: transparent;
		font-family: var(--font-head);
		font-size: 1.35rem;
		font-weight: 600;
	}
	.on {
		border-color: var(--accent);
		color: var(--accent);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.25rem;
		border-bottom: 1px solid var(--line);
	}
	.tab {
		margin-bottom: -1px;
		padding: 0.3rem 0.75rem;
		border: 1px solid transparent;
		border-radius: var(--radius) var(--radius) 0 0;
		background: transparent;
		font-family: var(--font-head);
		letter-spacing: var(--label-tracking);
		color: var(--muted);
	}
	.tab.active {
		border-color: var(--line);
		border-bottom-color: var(--page);
		background: var(--page);
		color: var(--accent);
	}
	.tab.active::before {
		content: var(--tab-mark);
	}
	input.tab {
		field-sizing: content;
		min-width: 4ch;
	}
	.more {
		border-style: dashed;
		border-color: var(--line);
	}
	/* The sheet's window: the rails and zoom float over it, the viewport moves beneath. */
	.stage {
		position: relative;
		flex: 1;
		min-height: 20rem;
		overflow: hidden;
		border: 1px solid var(--line);
		border-top: none;
		border-radius: 0 0 var(--radius) var(--radius);
		background: var(--page);
		cursor: grab;
		touch-action: none;
	}
	.stage.panning {
		cursor: grabbing;
		user-select: none;
	}
	.viewport {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	/* Dots on the 16px lattice while laying out, every second snap, moving with the sheet. */
	.laying .viewport {
		background-image: radial-gradient(
			circle,
			color-mix(in oklab, var(--muted) 45%, transparent) 1px,
			transparent 1.2px
		);
		background-size: var(--dots) var(--dots);
		background-position: calc(var(--ox) - var(--dots) / 2) calc(var(--oy) - var(--dots) / 2);
	}
	.world {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
	}
	.origin {
		position: absolute;
		left: -10px;
		top: -10px;
		width: 20px;
		height: 20px;
		background:
			linear-gradient(var(--accent), var(--accent)) center / 1px 100% no-repeat,
			linear-gradient(var(--accent), var(--accent)) center / 100% 1px no-repeat;
		opacity: 0.6;
		pointer-events: none;
	}
	.empty {
		position: absolute;
		top: 50%;
		left: 50%;
		margin: 0;
		translate: -50% -50%;
		color: var(--muted);
		pointer-events: none;
	}
	.slot {
		position: absolute;
		left: var(--x);
		top: var(--y);
		width: var(--w);
		height: var(--h);
		padding: 0.45rem 0.6rem;
		overflow: auto;
		border: var(--field-border);
		border-radius: var(--radius);
		background: var(--field-bg);
		box-shadow: var(--field-shadow);
		cursor: auto;
	}
	.laying .slot {
		overflow: hidden;
		cursor: grab;
		user-select: none;
	}
	.slot.selected,
	.slot.target,
	.laying .slot:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.slot.changed {
		outline: 2px dashed var(--accent);
		outline-offset: 2px;
	}
	.slot.dragging {
		z-index: 2;
		cursor: grabbing;
		opacity: 0.9;
	}
	.content {
		height: 100%;
	}
	/* Never under the pointer, so a drop can find the table beneath it. */
	.ghost {
		z-index: 2;
		pointer-events: none;
		display: grid;
		place-items: center;
		border: 1px dashed var(--accent);
		background: color-mix(in oklab, var(--accent) 10%, var(--surface));
		color: var(--accent);
	}
	.grip {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 16px;
		height: 16px;
		cursor: nwse-resize;
	}
	/* A corner mark, echoing the box's own corner. */
	.grip::after {
		content: '';
		position: absolute;
		right: 4px;
		bottom: 4px;
		width: 6px;
		height: 6px;
		border-right: 2px solid var(--muted);
		border-bottom: 2px solid var(--muted);
		border-bottom-right-radius: 2px;
		opacity: 0.6;
	}
	.slot:hover .grip::after,
	.slot.selected .grip::after {
		border-color: var(--accent);
		opacity: 1;
	}
	.zoom {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		cursor: auto;
	}
	.pct {
		min-width: 4.2em;
		border-radius: 999px;
		font-family: var(--mono);
		font-size: 0.8rem;
	}
	/* Stacked: reading order, full width, each field as tall as its content, scrolling. */
	.stacked {
		cursor: auto;
		touch-action: auto;
	}
	.stacked .viewport {
		overflow: auto;
		padding: 12px;
	}
	.stacked .world {
		position: static;
		display: grid;
		gap: 0.75rem;
	}
	.stacked .slot {
		position: static;
		width: auto;
		height: auto;
		overflow: visible;
	}
	.stacked .empty {
		position: static;
		translate: none;
	}
	/* Laid out at full size, so the image is drawn from it, but out of sight. */
	.offstage {
		position: fixed;
		top: 0;
		left: -10000px;
		width: max-content;
	}
</style>
