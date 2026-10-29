<script lang="ts">
	import { toBlob } from 'html-to-image';
	import { tick } from 'svelte';
	import {
		blank,
		columnKinds,
		duplicate,
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
	import { bindAction, clicked, loosen, mates, toggleBind, toggled } from '../lib/bind';
	import { cardBox } from '../lib/cards';
	import { keep, kept, type Clip } from '../lib/clip';
	import { cursors } from '../lib/cursors.svelte';
	import { lift, place } from '../lib/group';
	import { t } from '../lib/i18n.svelte';
	import { free, mod } from '../lib/keys';
	import {
		SNAP,
		bounds,
		clamp,
		defaultSize,
		readingOrder,
		restack,
		type Box,
		type Layer
	} from '../lib/layout';
	import { COLORS, nameOf, type Peer } from '../lib/presence';
	import { presence } from '../lib/presence.svelte';
	import { session } from '../lib/session.svelte';
	import { ui } from '../lib/ui.svelte';
	import { HOME, fit, toSheet, zoomAt, type View } from '../lib/view';
	import { cardPoint } from './Cards.svelte';
	import FieldValue from './FieldValue.svelte';
	import Icon from './Icon.svelte';
	import Palette from './Palette.svelte';
	import ShareCard from './ShareCard.svelte';
	import { gapAt } from './Table.svelte';
	import Toolbar from './Toolbar.svelte';

	let { character, open }: { character: Character; open: (id: string) => void } = $props();

	// Narrower than this the fields stack in reading order, and there is no room to lay out.
	const NARROW = 640;

	// View state, not document state: none of it is an undo step.
	let editing = $state(false);
	let tabId = $state('');
	/** The selected fields, shift-click adding to them; the last is the one inspected. */
	let chosen = $state<string[]>([]);
	/**
	 * A gesture in flight: `id` null is a new field still being dragged from the palette. A
	 * move carries `by`, how far every selected field has gone.
	 */
	let drag = $state<{
		id: string | null;
		kind: Kind;
		box: Box;
		by?: { x: number; y: number };
	} | null>(null);
	/** A kind from the palette held over a table, to land as a column at `index`. */
	let drop = $state<{ field: string; index: number; at?: Box } | null>(null);
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
	/** The fields a gesture in flight moves or sizes. */
	const moving = $derived(drag?.by ? chosen : drag?.id ? [drag.id] : []);
	const boxOf = (f: Field) => {
		if (!drag || !moving.includes(f.id)) return f.box;
		return drag.by ? { ...f.box, x: f.box.x + drag.by.x, y: f.box.y + drag.by.y } : drag.box;
	};
	const binding = $derived(bindAction(character.fields, chosen));
	/** Round each selected binding, so it reads as one, following a drag. */
	const frames = $derived.by(() => {
		const done = new Set<string>();
		return group.flatMap((f) => {
			const m = mates(character.fields, f.id);
			if (m.length < 2 || done.has(f.bind!)) return [];
			done.add(f.bind!);
			return [bounds(character.fields.filter((x) => m.includes(x.id)).map(boxOf))];
		});
	});

	// Others on this character: the fields each has selected or is writing in, writing first.
	const seen = $derived.by(() => {
		const by = new Map<string, { peer: Peer; writing: boolean }[]>();
		for (const peer of presence.others) {
			if (peer.character !== character.id) continue;
			for (const id of new Set([...(peer.picked ?? []), ...(peer.editing ? [peer.editing] : [])])) {
				const at = by.get(id) ?? [];
				at.push({ peer, writing: id === peer.editing });
				by.set(
					id,
					at.sort((a, b) => +b.writing - +a.writing)
				);
			}
		}
		return by;
	});
	const TYPED = 'input:not([type=checkbox], [type=radio], [type=file]), textarea, [role=textbox]';

	$effect(() => {
		presence.set({ character: character.id, tab: tab.id, picked: laying ? [...chosen] : [] });
	});

	// Others on this tab, whose pointers show and who see this one; with nobody, nothing is sent.
	const company = $derived(
		presence.others.filter((p) => p.character === character.id && p.tab === tab.id)
	);
	$effect(() => cursors.want(!stacked && session.status === 'open'));

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

	/** Puts a copy of this character, values and all, after it, and opens the copy. */
	function duplicateCharacter() {
		const name = uniqueLabel(
			t('{name} copy', { name: character.name }),
			session.doc.characters.map((c) => ({ id: c.id, label: c.name }))
		);
		const copy = duplicate(character, name);
		session.change((d) => d.characters.splice(d.characters.indexOf(live(d)) + 1, 0, copy));
		open(copy.id);
	}

	const reshape = (ids: string[], fn: (b: Box) => Box) =>
		edit((c) => {
			for (const f of c.fields) if (ids.includes(f.id)) f.box = clamp(fn(f.box));
		});
	const editField = (id: string, fn: (f: Field) => void) => edit((c) => fn(fieldOf(c, id)));

	function add(kind: Kind, at?: Box) {
		const id = newId();
		const size = defaultSize(kind);
		// Without a drop point, in the middle of what is on screen.
		const box = clamp(at ?? { x: view.x - size.w / 2, y: view.y - size.h / 2, ...size });
		edit((c) => {
			c.fields.push({
				id,
				label: uniqueLabel(t('New {kind}', { kind: t(kind) }), c.fields),
				kind,
				tab: tab.id,
				box
			});
			// A table starts with a column, so it has rows to add.
			if (kind === 'table')
				c.fields.at(-1)!.columns = [{ id: newId(), name: t('Name'), kind: 'text' }];
			c.values[id] = blank(kind);
		});
		chosen = [id];
	}

	function addColumn(id: string, kind: ColumnKind, at: number, box?: Box) {
		const col = newId();
		editField(id, (f) => {
			const cols = f.columns ?? [];
			const named = cols.map((c) => ({ id: c.id, label: c.name }));
			const shown = t(kind);
			const name = uniqueLabel(shown[0].toUpperCase() + shown.slice(1), named);
			cols.splice(at, 0, { id: col, name, kind, ...(box && { box }) });
			f.columns = cols;
		});
		chosen = [id];
		picked = { field: id, column: col };
	}

	function remove(ids: string[]) {
		edit((c) => {
			c.fields = c.fields.filter((f) => !ids.includes(f.id));
			for (const id of ids) delete c.values[id];
			loosen(c.fields);
		});
		chosen = [];
	}

	const bind = () => edit((c) => toggleBind(c.fields, chosen));
	const layer = (to: Layer) => edit((c) => (c.fields = restack(c.fields, chosen, to)));

	function copy(ids: string[]) {
		const g = lift(character, session.doc.clocks, ids, true, session.doc.characters);
		const { x, y } = bounds(group.map((f) => f.box));
		keep({ ...g, at: { x, y } });
		const what = ids.length === 1 ? g.fields[0].label : t('{n} fields', { n: ids.length });
		session.notice = t('Copied {what}. {mod}V pastes in Edit layout, on any character.', {
			what,
			mod
		});
	}

	/** Where the fields were copied from, off any field already there, so pastes fan out. */
	function paste(g: Clip) {
		let ids: string[] = [];
		session.change((d) => (ids = place(g, live(d), d.clocks, tab.id, g.at, d.characters)));
		chosen = ids;
	}

	function saveTemplate(name: string) {
		session.change((d) => {
			const { tabs, fields } = $state.snapshot(live(d));
			d.templates.push({ id: newId(), name, tabs, fields });
		});
		session.notice = t('Saved "{name}" as a template.', { name });
	}

	function addTab() {
		const id = newId();
		edit((c) => c.tabs.push({ id, name: t('Tab {n}', { n: c.tabs.length + 1 }) }));
		tabId = id;
	}

	function grab(e: PointerEvent, mode: 'move' | 'size' | 'new', id: string | null, kind: Kind) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		if (id && e.shiftKey && mode === 'move') {
			chosen = toggled(character.fields, chosen, id);
			return;
		}
		// A press on the selection keeps it, to drag it all; a click alone then narrows it.
		const held = !!id && chosen.includes(id);
		if (id && !held) chosen = mates(character.fields, id);
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
				// On a table shown as cards it lands where it is dropped, after the other columns.
				const card = over?.querySelector<HTMLElement>('[data-card]');
				if (over && card) {
					const p = cardPoint(card, ev.clientX, ev.clientY);
					const at = cardBox(kind as ColumnKind, { x: p.x - 16, y: p.y - 12 });
					const index = fieldOf(character, over.dataset.table!).columns?.length ?? 0;
					drop = { field: over.dataset.table!, index, at };
				} else drop = over ? { field: over.dataset.table!, index: gapAt(over, ev.clientX) } : null;
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
			if (mode === 'size') {
				drag = { id, kind, box: clamp({ ...from!, w: from!.w + dx, h: from!.h + dy }) };
				return;
			}
			// The grabbed field snaps, and the rest of the selection keeps its place by it.
			const box = clamp({ ...from!, x: from!.x + dx, y: from!.y + dy });
			drag = { id, kind, box, by: { x: box.x - from!.x, y: box.y - from!.y } };
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
				if (into) addColumn(into.field, kind as ColumnKind, into.index, into.at);
				else if (done) add(kind, done.box);
				else if (!moved) add(kind);
			} else if (done?.by) {
				const by = done.by;
				reshape(chosen, (b) => ({ ...b, x: b.x + by.x, y: b.y + by.y }));
			} else if (done && id) {
				reshape([id], () => done.box);
			} else if (held && !moved && mode === 'move') {
				chosen = clicked(character.fields, chosen, id!);
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
			// A long field scrolls its own content first, as a page inside the sheet would; so
			// does a paged list's one row too tall for its box.
			const box = (e.target as Element).closest('.slot')?.querySelector(':scope > .content');
			const own = box && (e.target as Element).closest('[data-scroll]');
			if (!laying && box && [own, box].some((el) => el && scrolls(el, dx, dy))) return;
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
				() => (session.notice = t('Copied {name} as an image. Paste it into the chat.', { name })),
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
			session.notice = t(
				'This browser would not copy the image, so {name}.png was downloaded instead.',
				{ name }
			);
		} catch {
			session.notice = t('The image of {name} could not be made.', { name });
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
			else if (key === 'g' && laying && binding === (e.shiftKey ? 'unbind' : 'bind')) bind();
			// By code, since ⇧ turns ] into } on most layouts.
			else if (e.code === 'BracketRight' && f) layer(e.shiftKey ? 'front' : 'forward');
			else if (e.code === 'BracketLeft' && f) layer(e.shiftKey ? 'back' : 'backward');
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
			remove(group.map((g) => g.id));
		} else if (f && step) {
			const [dx, dy] = step.map((n) => n * SNAP);
			reshape(
				group.map((g) => g.id),
				(b) =>
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
			aria-label={t('Character name')}
			onchange={(e) => {
				const text = e.currentTarget.value.trim();
				if (text) edit((c) => (c.name = text));
			}}
		/>
		{#if session.gm}
			<button
				class:on={character.hidden}
				aria-pressed={!!character.hidden}
				title={t(
					'Players do not see a GM-only character, but their sheets can still draw on its tables'
				)}
				onclick={() => edit((c) => (c.hidden ? delete c.hidden : (c.hidden = true)))}
				>{t('GM only')}</button
			>
		{/if}
		<button
			disabled={sharing}
			title={t('Copy every tab, with each value in full, as an image to paste into a chat')}
			onclick={copyImage}>{sharing ? t('Copying…') : t('Copy image')}</button
		>
		<button
			title={t('Add a copy of this character, with every value, to start another from')}
			onclick={duplicateCharacter}>{t('Duplicate')}</button
		>
		<button
			class:on={editing}
			aria-pressed={editing}
			disabled={stacked}
			title={stacked
				? t('Widen the window to lay out fields')
				: t('Add, move and resize fields (E)')}
			onclick={toggleEditing}>{editing ? t('Done') : t('Edit layout')}</button
		>
		<button
			class="x"
			aria-label={t('Delete {name}', { name: character.name })}
			title={t('Delete character')}
			onclick={() =>
				session.change((d) => (d.characters = d.characters.filter((c) => c.id !== character.id)))}
			>×</button
		>
	</header>

	<nav class="tabs" aria-label={t('Tabs')}>
		{#each character.tabs as tb (tb.id)}
			{#if laying && tb.id === tab.id}
				<input
					class="tab active"
					value={tb.name}
					aria-label={t('Tab name')}
					onchange={(e) => {
						const text = e.currentTarget.value.trim();
						if (text) edit((c) => (c.tabs.find((x) => x.id === tb.id)!.name = text));
					}}
				/>
				{#if character.tabs.length > 1}
					<button
						class="x"
						aria-label={t('Delete tab {name}', { name: tb.name })}
						disabled={onTab.length > 0}
						title={onTab.length ? t('Move or delete its fields first') : t('Delete tab')}
						onclick={() => edit((c) => (c.tabs = c.tabs.filter((x) => x.id !== tb.id)))}>×</button
					>
				{/if}
			{:else}
				<button
					class="tab"
					class:active={tb.id === tab.id}
					aria-current={tb.id === tab.id}
					onclick={() => {
						tabId = tb.id;
						chosen = [];
					}}>{tb.name}</button
				>
			{/if}
		{/each}
		{#if laying}
			<button class="tab more" onclick={addTab}>{t('+ Tab')}</button>
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
		onpointermove={(e) =>
			company.length && !stacked && cursors.move(toSheet(view, ...fromMiddle(e)))}
		onpointerleave={() => company.length && cursors.move(null)}
		{@attach wheel}
	>
		<div class="viewport" style:--ox="{ox}px" style:--oy="{oy}px" style:--dots="{16 * view.z}px">
			{#if !onTab.length && !drag}
				<p class="empty">
					{stacked
						? t('Nothing on this tab yet.')
						: laying
							? t('Nothing on this tab yet. Drag a field in from the left.')
							: t('Nothing on this tab yet. Edit layout to add fields.')}
				</p>
			{/if}
			<div
				class="world"
				inert={drafting || undefined}
				style:transform={stacked ? undefined : `translate(${ox}px, ${oy}px) scale(${view.z})`}
			>
				{#if laying}<span class="origin" aria-hidden="true"></span>{/if}
				{#if laying}
					{#each frames as b, i (i)}
						<span
							class="binding"
							style:--x="{b.x}px"
							style:--y="{b.y}px"
							style:--w="{b.w}px"
							style:--h="{b.h}px"
							aria-hidden="true"
						></span>
					{/each}
				{/if}
				{#each stacked ? readingOrder(onTab) : onTab as f (f.id)}
					{@const b = boxOf(f)}
					{@const eyes = seen.get(f.id)}
					{@const peer = eyes && `var(--peer-${eyes[0].peer.color % COLORS})`}
					{#if eyes}
						<span
							class="mark"
							style:--x="{b.x}px"
							style:--y="{b.y}px"
							style:--w="{b.w}px"
							style:--peer={peer}
							>{eyes
								.map((e) =>
									e.writing ? t('{name} is writing', { name: nameOf(e.peer) }) : nameOf(e.peer)
								)
								.join(', ')}</span
						>
					{/if}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex: tabindex comes only with role="button" -->
					<div
						class="slot"
						class:seen={eyes}
						class:writing={eyes?.[0].writing}
						style:--peer={peer}
						class:selected={laying && chosen.includes(f.id)}
						class:target={drop?.field === f.id}
						class:dragging={moving.includes(f.id)}
						class:changed={chat.changes?.fields.has(f.id)}
						data-table={f.kind === 'table' ? f.id : undefined}
						style:--x="{b.x}px"
						style:--y="{b.y}px"
						style:--w="{b.w}px"
						style:--h="{b.h}px"
						role={laying ? 'button' : undefined}
						tabindex={laying ? 0 : undefined}
						aria-label={laying
							? t('{label}, {kind}. Arrow keys move it, Shift with arrows resizes it.', {
									label: f.label,
									kind: t(f.kind)
								})
							: undefined}
						onpointerdown={laying ? (e) => grab(e, 'move', f.id, f.kind) : undefined}
						onfocus={laying
							? () => chosen.includes(f.id) || (chosen = mates(character.fields, f.id))
							: undefined}
						onfocusin={(e) =>
							(e.target as Element).matches(TYPED) && presence.set({ editing: f.id })}
						onfocusout={() => presence.set({ editing: undefined })}
					>
						<div class="content">
							<FieldValue
								{character}
								field={f}
								{laying}
								picked={picked?.field === f.id ? picked.column : null}
								drop={drop?.field === f.id ? drop : null}
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
				{#if !stacked}
					{#each company as p (p.who)}
						{@const at = cursors.points[p.who]}
						{#if at}
							<span
								class="cursor"
								style:--peer="var(--peer-{p.color % COLORS})"
								style:translate="{at.x}px {at.y}px"
								style:scale={1 / view.z}
								aria-hidden="true"
								><svg viewBox="0 0 16 16" width="16" height="16"
									><path d="M1.5 1.5v12l3.2-3 2.3 5 2-.9-2.3-4.9h4.6z" /></svg
								><span class="who">{nameOf(p)}</span></span
							>
						{/if}
					{/each}
				{/if}
				{#if drag && !drag.id}
					<div
						class="slot ghost"
						style:--x="{drag.box.x}px"
						style:--y="{drag.box.y}px"
						style:--w="{drag.box.w}px"
						style:--h="{drag.box.h}px"
					>
						{t('New {kind}', { kind: t(drag.kind) })}
					</div>
				{/if}
			</div>
		</div>

		{#if laying}
			<Palette grab={(e, kind) => grab(e, 'new', null, kind)} {add} {binding} {bind} />
		{/if}
		{#if laying}
			<Toolbar {character} {field} {group} {column} {editField} {remove} {layer} {saveTemplate} />
		{/if}
		<div class="zoom" role="group" aria-label={t('Zoom and chat')}>
			{#if !stacked}
				<button
					class="dot"
					aria-label={t('Zoom out')}
					title={t('Zoom out (−)')}
					onclick={() => zoomBy(0.8)}><Icon name="minus" /></button
				>
				<button class="pct" title={t('Back to 100%')} onclick={() => look(zoomAt(view, 1))}
					>{Math.round(view.z * 100)}%</button
				>
				<button
					class="dot"
					aria-label={t('Zoom in')}
					title={t('Zoom in (+)')}
					onclick={() => zoomBy(1.25)}><Icon name="plus" /></button
				>
				<button
					class="dot"
					aria-label={t('Fit the tab')}
					title={t('Fit the tab (⇧1)')}
					onclick={fitTab}><Icon name="fit" /></button
				>
				<button
					class="dot"
					aria-label={t('Go to 0,0')}
					title={t('0,0 at 100% (⇧0)')}
					onclick={() => look(HOME)}><Icon name="home" /></button
				>
			{/if}
			<button
				class="dot"
				aria-label={t('Chat')}
				title={t('Ask Claude to change the room')}
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
		border: var(--field-border);
		border-radius: var(--radius);
		background: var(--field-bg);
		box-shadow: var(--field-shadow);
		cursor: auto;
	}
	.laying .slot {
		cursor: grab;
		user-select: none;
	}
	.laying .content {
		overflow: hidden;
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
	/* Someone else's selection, dashed, or where they are writing, solid, in their colour. */
	.slot.seen {
		outline: 2px dashed var(--peer);
		outline-offset: 2px;
	}
	.slot.writing {
		outline-style: solid;
	}
	.mark {
		position: absolute;
		left: var(--x);
		top: var(--y);
		z-index: 3;
		max-width: var(--w);
		translate: 0 calc(-100% - 4px);
		padding: 0 0.4em;
		overflow: hidden;
		border-radius: var(--radius) var(--radius) 0 0;
		background: var(--peer);
		color: var(--surface);
		font-size: 0.75rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		pointer-events: none;
	}
	/* Someone else's pointer: the same size at any zoom, eased between their updates. */
	.cursor {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 4;
		display: flex;
		transform-origin: 0 0;
		transition: translate 100ms linear;
		pointer-events: none;
	}
	.cursor svg {
		fill: var(--peer);
		stroke: var(--surface);
		stroke-width: 1;
	}
	.cursor .who {
		margin: 14px 0 0 -4px;
		padding: 0 0.35em;
		border-radius: var(--radius);
		background: var(--peer);
		color: var(--surface);
		font-size: 0.7rem;
		white-space: nowrap;
	}
	/* Round a selected binding, clear of its fields' outlines and under a label on their edge. */
	.binding {
		position: absolute;
		left: calc(var(--x) - 6px);
		top: calc(var(--y) - 6px);
		width: calc(var(--w) + 12px);
		height: calc(var(--h) + 12px);
		border: 1px dashed var(--accent);
		border-radius: calc(var(--radius) + 4px);
		pointer-events: none;
	}
	.slot.dragging {
		z-index: 2;
		cursor: grabbing;
		opacity: 0.9;
	}
	/* The box's content scrolls, not the box, so what sits on its edge (a hidden label's
	   controls) is not clipped. */
	.content {
		height: 100%;
		padding: 0.45rem 0.6rem;
		overflow: auto;
		border-radius: inherit;
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
	/* Relative for what floats on its edge; its box's x and y would shift it off the stage. */
	.stacked .slot {
		position: relative;
		left: auto;
		top: auto;
		width: auto;
		height: auto;
	}
	.stacked .content {
		height: auto;
		overflow: visible;
	}
	.stacked .mark {
		position: static;
		justify-self: start;
		margin-bottom: -0.6rem;
		translate: none;
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
