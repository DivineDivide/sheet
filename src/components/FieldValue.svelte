<script lang="ts">
	import {
		globalId,
		newId,
		valueOf,
		type Character,
		type Entry,
		type Field,
		type Resource,
		type Row,
		type Value
	} from '../lib/doc';
	import { isErr, names, render, result, show } from '../lib/formula';
	import { t } from '../lib/i18n.svelte';
	import { markdown } from '../lib/markdown';
	import { shrink } from '../lib/picture';
	import { hint, ready, sheetOf } from '../lib/rules';
	import { session } from '../lib/session.svelte';
	import { choicesOf, rowFrom, sourceOf } from '../lib/source';
	import { tip } from '../lib/tip';
	import { pageOf, ui } from '../lib/ui.svelte';
	import Bar from './Bar.svelte';
	import Icon from './Icon.svelte';
	import MapTree from './MapTree.svelte';
	import Pages from './Pages.svelte';
	import Picker from './Picker.svelte';
	import Prose from './Prose.svelte';
	import Table from './Table.svelte';

	// The rest are a table's, for its headers in Edit layout.
	let {
		character,
		field,
		laying = false,
		picked = null,
		drop = null,
		onpick
	}: {
		character: Character;
		field: Field;
		laying?: boolean;
		picked?: string | null;
		drop?: number | null;
		onpick?: (column: string) => void;
	} = $props();

	const v = $derived(valueOf(character, field));
	const sheet = $derived(sheetOf(session.doc, character));
	const out = $derived(field.kind === 'formula' ? result(sheet, field.id) : null);
	// Presses go to the room, which runs the rules, so a button waits while it is away.
	const why = $derived(
		field.kind !== 'button'
			? true
			: session.status === 'open'
				? ready(session.doc, character, field.id)
				: t('Waiting for the room to come back.')
	);

	// In Edit layout only the label's toggle is live, but a table edits its headers in place
	// and keeps the rest inert itself, and a map's nodes are dragged onto their parents.
	const dead = $derived(laying && field.kind !== 'table' && field.kind !== 'map');

	function toggleLabel() {
		session.change((d) => {
			const f = d.characters
				.find((c) => c.id === character.id)!
				.fields.find((x) => x.id === field.id)!;
			if (f.hideLabel) delete f.hideLabel;
			else f.hideLabel = true;
		});
	}

	function set(next: Value) {
		session.change((d) => {
			d.characters.find((c) => c.id === character.id)!.values[field.id] = next;
		});
	}

	let picker = $state<HTMLInputElement>();
	/** A tag is typed into a box that the label's + opens. */
	let adding = $state(false);
	let menu = $state<Picker>();
	let pages = $state<Pages>();
	let pageCount = $state(0);
	/** The table a table's + offers rows of. */
	const src = $derived(field.kind === 'table' ? sourceOf(session.doc, field.from) : undefined);
	/** Adds to a list, turning a paged one to its last page, where the new row lands. */
	const append = (item: Row | Entry) => {
		set([...(v as (Row | Entry)[]), item] as Value);
		pages?.last();
	};
	const blankRow = () => append({ id: newId(), cells: {} });

	// A field holding a list adds to it from a + by its label, not a button under the list.
	// `to` names the + with the label, a phrase of its own since Chinese puts the label first.
	const add = $derived.by(() => {
		const label = field.label;
		if (field.kind === 'entries')
			return {
				what: t('Add an entry'),
				to: t('Add an entry to {label}', { label }),
				run: () => append({ name: '', text: '' })
			};
		// A table following a map holds the map's one row.
		if (field.kind === 'table' && !laying && field.columns?.length && !field.follows)
			return {
				what: src ? t('Add a row, or one of {name}', { name: src.name }) : t('Add a row'),
				to: src
					? t('Add a row, or one of {name} to {label}', { name: src.name, label })
					: t('Add a row to {label}', { label }),
				run: (e: MouseEvent) => (src ? menu?.open(e.currentTarget as HTMLElement) : blankRow())
			};
		if (field.kind === 'tags')
			return {
				what: t('Add a tag'),
				to: t('Add a tag to {label}', { label }),
				run: () => (adding = true)
			};
		if (field.kind === 'track')
			return {
				what: t('Add a box'),
				to: t('Add a box to {label}', { label }),
				run: () => set([...(v as boolean[]), false])
			};
		return null;
	});

	async function take(file: File | undefined) {
		if (!file?.type.startsWith('image/')) return;
		try {
			set(await shrink(file));
		} catch {
			session.notice = t('{name} could not be read as a picture.', { name: file.name });
		}
	}

	const num = (text: string, fallback: number) => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) ? n : fallback;
	};
</script>

<div
	class="field"
	{@attach tip(
		field.kind === 'button' && !laying ? hint(session.doc, character, field.id, why) : ''
	)}
>
	{#if field.kind !== 'button'}
		{@const paged = !!field.pages && pageCount > 1 && !laying}
		{#if laying || !field.hideLabel || add || paged || field.kind === 'track'}
			<div class="head" class:bare={field.hideLabel}>
				{#if laying || !field.hideLabel}
					<div class="label md" class:gone={field.hideLabel} inert={dead || undefined}>
						{@html markdown(field.label)}
					</div>
				{/if}
				{#if laying}
					<button
						class="icon toggle"
						class:off={field.hideLabel}
						aria-label={t(field.hideLabel ? "Show {label}'s label" : "Hide {label}'s label", {
							label: field.label
						})}
						{@attach tip(field.hideLabel ? t('Show the label') : t('Hide the label, for everyone'))}
						onpointerdown={(e) => e.stopPropagation()}
						onclick={toggleLabel}><Icon name={field.hideLabel ? 'label-off' : 'label'} /></button
					>
				{/if}
				<div class="controls" inert={dead || undefined}>
					{#if add}
						<button class="icon" aria-label={add.to} {@attach tip(add.what)} onclick={add.run}
							><Icon name="plus" /></button
						>
						{#if src}
							<Picker
								bind:this={menu}
								{src}
								onblank={blankRow}
								onpick={(item) => append(rowFrom(src, item, field.columns ?? []))}
							/>
						{/if}
					{/if}
					{#if paged}
						{@const at = globalId(character, field)}
						{@const page = pageOf(at, pageCount)}
						<nav class="pager" aria-label={t('Pages of {label}', { label: field.label })}>
							<button
								class="icon"
								aria-label={t('Previous page')}
								disabled={page === 0}
								onclick={() => (ui.pages[at] = page - 1)}><Icon name="prev" /></button
							>
							<span>{page + 1} / {pageCount}</span>
							<button
								class="icon"
								aria-label={t('Next page')}
								disabled={page === pageCount - 1}
								onclick={() => (ui.pages[at] = page + 1)}><Icon name="next" /></button
							>
						</nav>
					{/if}
					{#if field.kind === 'track'}
						{@const boxes = v as boolean[]}
						<button
							class="icon"
							aria-label={t('Remove a box from {label}', { label: field.label })}
							disabled={boxes.length === 0}
							{@attach tip(t('Remove a box'))}
							onclick={() => set(boxes.slice(0, -1))}><Icon name="minus" /></button
						>
					{/if}
				</div>
			</div>
		{/if}
	{/if}

	<div class="body" inert={dead || undefined}>
		{#if field.kind === 'button'}
			<button
				class="press md"
				disabled={why !== true}
				onclick={() => session.act({ press: { character: character.id, field: field.id } })}
				>{@html markdown(field.label)}</button
			>
		{:else if field.kind === 'number'}
			{@const n = v as number}
			<div class="row">
				<button aria-label={t('{label} down', { label: field.label })} onclick={() => set(n - 1)}
					>−</button
				>
				<input
					class="short"
					type="number"
					value={n}
					aria-label={field.label}
					onchange={(e) => set(num(e.currentTarget.value, n))}
				/>
				<button aria-label={t('{label} up', { label: field.label })} onclick={() => set(n + 1)}
					>+</button
				>
			</div>
		{:else if field.kind === 'resource' && field.bar}
			<div class="row"><Bar value={v as Resource} label={field.label} {set} /></div>
		{:else if field.kind === 'resource'}
			{@const r = v as Resource}
			<div class="row">
				<button
					aria-label={t('{label} down', { label: field.label })}
					onclick={() => set({ ...r, cur: r.cur - 1 })}>−</button
				>
				<input
					class="short"
					type="number"
					value={r.cur}
					aria-label={t('{label} current', { label: field.label })}
					onchange={(e) => set({ ...r, cur: num(e.currentTarget.value, r.cur) })}
				/>
				<span class="of">/</span>
				<input
					class="short"
					type="number"
					value={r.max}
					aria-label={t('{label} max', { label: field.label })}
					onchange={(e) => set({ ...r, max: num(e.currentTarget.value, r.max) })}
				/>
				<button
					aria-label={t('{label} up', { label: field.label })}
					onclick={() => set({ ...r, cur: r.cur + 1 })}>+</button
				>
			</div>
		{:else if field.kind === 'track'}
			{@const boxes = v as boolean[]}
			<div class="row">
				{#each boxes as on, i (i)}
					<button
						class="box"
						class:on
						aria-label={t('{label} box {n}', { label: field.label, n: i + 1 })}
						aria-pressed={on}
						onclick={() => set(boxes.map((b, j) => (j === i ? !b : b)))}
					></button>
				{/each}
			</div>
		{:else if field.kind === 'formula'}
			{#if field.formula?.trim()}
				<output
					class="big"
					class:err={isErr(out)}
					title={isErr(out) ? out.why : `=${render(field.formula, names(sheet))}`}
					>{show(out)}</output
				>
			{:else}
				<span class="none">{t('No formula yet. Set one in Edit layout.')}</span>
			{/if}
		{:else if field.kind === 'text'}
			<Prose
				value={v as string}
				label={field.label}
				at={globalId(character, field)}
				onchange={set}
			/>
		{:else if field.kind === 'choice'}
			{@const choices = choicesOf(session.doc, field)}
			<div class="row">
				<select
					class="choice"
					value={v as string}
					aria-label={field.label}
					onchange={(e) => set(e.currentTarget.value)}
				>
					<option value=""></option>
					{#each choices as o (o)}<option>{o}</option>{/each}
					<!-- A value from before the choices changed still shows. -->
					{#if v && !choices.includes(v as string)}<option>{v}</option>{/if}
				</select>
			</div>
		{:else if field.kind === 'map'}
			<MapTree {character} {field} {laying} />
		{:else if field.kind === 'entries'}
			{@const entries = v as Entry[]}
			{@const put = (i: number, patch: Partial<Entry>) =>
				set(entries.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
			<Pages
				bind:this={pages}
				on={!!field.pages}
				at={globalId(character, field)}
				rows=".entries > li"
				bind:count={pageCount}
			>
				<ol class="entries">
					{#each entries as entry, i (i)}
						<li>
							<div class="row top">
								<Prose
									line
									value={entry.name}
									at="{globalId(character, field)}/{i}/name"
									label={t('{label} name', { label: field.label })}
									empty={t('Name')}
									onchange={(name) => put(i, { name })}
								/>
								<button
									class="x"
									aria-label={t('Remove {name}', { name: entry.name })}
									onclick={() => set(entries.filter((_, j) => j !== i))}>×</button
								>
							</div>
							<Prose
								value={entry.text}
								at="{globalId(character, field)}/{i}/text"
								label={t('{name} description', { name: entry.name })}
								empty={t('Description, in Markdown.')}
								onchange={(text) => put(i, { text })}
							/>
						</li>
					{/each}
				</ol>
			</Pages>
		{:else if field.kind === 'table'}
			<Pages
				bind:this={pages}
				on={!!field.pages}
				at={globalId(character, field)}
				rows=".grid > tbody > tr"
				bind:count={pageCount}
			>
				<Table {character} {field} rows={v as Row[]} {set} {laying} {picked} {drop} {onpick} />
			</Pages>
		{:else if field.kind === 'image'}
			{@const src = v as string}
			<!-- A drop stops here: on the window it would be taken for a session file to import.
		     Paste reaches this once it has focus, from a click or Tab. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex: focusable so a paste has somewhere to land -->
			<div
				class="picture"
				role="group"
				aria-label={field.label}
				tabindex="0"
				ondragover={(e) => {
					e.preventDefault();
					e.stopPropagation();
				}}
				ondrop={(e) => {
					e.preventDefault();
					e.stopPropagation();
					take(e.dataTransfer?.files[0]);
				}}
				onpaste={(e) => {
					const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
					if (!file) return;
					e.preventDefault();
					take(file);
				}}
			>
				{#if src}
					<img {src} alt={field.label} />
					<span class="tools">
						<button onclick={() => picker?.click()}>{t('Replace')}</button>
						<button class="x" aria-label={t('Remove the picture')} onclick={() => set('')}>×</button
						>
					</span>
				{:else}
					<button class="pick" onclick={() => picker?.click()}
						>{t('Pick, drop or paste a picture')}</button
					>
				{/if}
				<input
					bind:this={picker}
					type="file"
					accept="image/*"
					hidden
					onchange={(e) => {
						take(e.currentTarget.files?.[0]);
						e.currentTarget.value = '';
					}}
				/>
			</div>
		{:else if field.kind === 'tags'}
			{@const tags = v as string[]}
			<div class="row wrap">
				{#each tags as tag, i (i)}
					<span class="tag">
						{tag}
						<button
							class="x"
							aria-label={t('Remove {name}', { name: tag })}
							onclick={() => set(tags.filter((_, j) => j !== i))}>×</button
						>
					</span>
				{/each}
				{#if adding}
					<!-- Stays open after Enter for the next tag; closes when it loses focus. -->
					<input
						class="add"
						aria-label={t('Add to {label}', { label: field.label })}
						{@attach (el) => el.focus()}
						onblur={() => (adding = false)}
						onkeydown={(e) => {
							const text = e.currentTarget.value.trim();
							if (e.key !== 'Enter' || !text) return;
							set([...tags, text]);
							e.currentTarget.value = '';
						}}
					/>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* Fills its box on the sheet, so a text field's box sets how much shows before it scrolls. */
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		height: 100%;
	}
	/* A hidden label's line keeps its controls, on the box's top edge at the right, as a
	   legend sits, so they cover no row. Placed against the box, not this, whose content
	   scrolls and would clip them. Shown while the box is hovered or one has focus, and
	   always where nothing can hover; faded, not gone, so the menu a + opens can follow it.
	   In Edit layout the struck label and its toggle ride there too, so the box reads as in
	   play, and show while it is selected. */
	.head.bare {
		position: absolute;
		top: 0;
		right: 0.6rem;
		z-index: 1;
		translate: 0 -50%;
		padding: 0 0.15rem;
		border: var(--field-border);
		border-radius: var(--radius);
		background: var(--field-bg);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s;
	}
	:global(.slot:hover) .head.bare,
	:global(.slot.selected) .head.bare,
	.head.bare:focus-within {
		opacity: 1;
		pointer-events: auto;
	}
	@media (hover: none) {
		.head.bare {
			opacity: 1;
			pointer-events: auto;
		}
	}
	/* Fills its box, down to the 3×3 smallest, and clips a label too long for it. */
	.press {
		flex: 1;
		min-height: min(2.5rem, 100%);
		padding: 0.2rem;
		overflow: hidden;
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}
	/* Stacked on a narrow screen no box sets its height, so it stays tall enough to tap. */
	:global(.stacked) .press {
		min-height: 2.5rem;
	}
	.press:disabled {
		opacity: 0.45;
	}
	/* Boxless, so what it holds lays out as before; there to be inert in Edit layout. */
	.body,
	.controls {
		display: contents;
	}
	/* Beside the label in Edit layout: shown while the box is hovered or selected, and always
	   once the label is hidden, which then shows faded and struck through on the box's edge. */
	.toggle {
		opacity: 0;
	}
	:global(.slot:hover) .toggle,
	:global(.slot.selected) .toggle,
	.toggle:focus-visible,
	.toggle.off {
		opacity: 1;
	}
	.label.gone {
		opacity: 0.55;
		text-decoration: line-through;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		min-height: 1.25rem;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: var(--muted);
	}
	.icon:hover:not(:disabled) {
		color: var(--accent);
	}
	.icon:disabled {
		opacity: 0.4;
	}
	.icon :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}
	/* At the right end of the label's line. */
	.pager {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		margin-left: auto;
		font-size: 0.72rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.label {
		font-family: var(--font-head);
		font-size: 0.75rem;
		letter-spacing: var(--label-tracking);
		color: var(--muted);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.choice {
		flex: 1;
	}
	.wrap {
		flex-wrap: wrap;
	}
	/* Room for three digits, in a serif theme too. */
	.short {
		width: 7.5ch;
		font-variant-numeric: tabular-nums;
	}
	.of {
		color: var(--muted);
	}
	.big {
		font-size: 1.4rem;
		font-variant-numeric: tabular-nums;
	}
	.err {
		color: var(--accent);
	}
	.none {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.box {
		width: 1.4rem;
		height: 1.4rem;
		margin: 0 0.1rem;
		padding: 0;
		border-radius: var(--track-radius);
		rotate: var(--track-turn);
	}
	.box.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.05rem 0.4rem 0.05rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--tag-radius);
		clip-path: var(--tag-clip);
		background: var(--tag-bg);
		font-size: 0.85rem;
	}
	.add {
		width: 9ch;
	}
	.entries {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.entries li {
		display: grid;
		gap: 0.2rem;
		padding-left: 0.6rem;
		border-left: 2px solid var(--entry-rule);
	}
	.row.top {
		align-items: start;
	}
	/* Fills what its box leaves under the label; the picture fits inside, uncropped. */
	.picture {
		position: relative;
		display: grid;
		flex: 1 1 0;
		min-height: 4rem;
		border-radius: var(--radius);
	}
	.picture:focus-visible {
		outline: 1px solid var(--accent);
	}
	img {
		width: 100%;
		height: 100%;
		min-height: 0;
		object-fit: contain;
	}
	.tools {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		display: flex;
		gap: 0.2rem;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.tools button {
		background: var(--surface);
	}
	.picture:hover .tools,
	.picture:focus-within .tools {
		opacity: 1;
	}
	.pick {
		border-style: dashed;
		color: var(--muted);
	}
</style>
