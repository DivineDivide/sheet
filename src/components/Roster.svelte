<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { newCharacter, shown, type Character } from '../lib/doc';
	import { COLORS, nameOf } from '../lib/presence';
	import { presence } from '../lib/presence.svelte';
	import { session } from '../lib/session.svelte';
	import { t } from '../lib/i18n.svelte';
	import ExcelImport from './ExcelImport.svelte';
	import Icon from './Icon.svelte';
	import Preview from './Preview.svelte';

	let { current = $bindable(), character }: { current: string; character: Character | undefined } =
		$props();

	const doc = $derived(session.doc);

	let strip: HTMLElement;
	let dialog: HTMLDialogElement;
	let newName = $state('');
	let from = $state(session.doc.templates[0]?.id ?? '');
	// Falls back to Blank once the chosen template is deleted.
	const chosen = $derived(doc.templates.some((t) => t.id === from) ? from : '');
	/** Which ends of the strip have characters scrolled out past them. */
	let more = $state({ left: false, right: false });

	/** Adds a made character, as one change, so Undo takes it back. */
	function place(c: Character) {
		session.change((d) => d.characters.push(c));
		current = c.id;
		dialog.close();
	}

	function create(templateId: string) {
		const template = doc.templates.find((t) => t.id === templateId);
		const name = newName.trim() || t('Character {n}', { n: doc.characters.length + 1 });
		place(newCharacter(name, template && $state.snapshot(template)));
		from = templateId;
		newName = '';
	}

	function edges() {
		more = {
			left: strip.scrollLeft > 1,
			right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
		};
	}

	// A mouse wheel only scrolls up and down: each notch, or a trackpad's swipe of a third of
	// a character, moves one character along. Steps go from where the last one is headed, so
	// a quick run of them is not cut short by a scroll still under way.
	let wheeled = 0;
	let goal: number | null = null;
	function wheel(e: WheelEvent) {
		if (e.deltaX) return;
		wheeled += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
		const [a, b] = strip.querySelectorAll<HTMLElement>('.chip');
		const step = b ? b.offsetLeft - a.offsetLeft : 0;
		if (!step || Math.abs(wheeled) < step / 3) return;
		const end = strip.scrollWidth - strip.clientWidth;
		goal = Math.max(0, Math.min(end, (goal ?? strip.scrollLeft) + Math.sign(wheeled) * step));
		wheeled = 0;
		strip.scrollTo({ left: goal });
	}

	// Keeps the open character in sight however it was picked, by [ and ] too.
	$effect(() => {
		void character?.id;
		void doc.characters.length;
		tick().then(() => {
			strip.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			edges();
		});
	});
</script>

<div class="roster">
	<nav
		class="strip"
		class:fade-left={more.left}
		class:fade-right={more.right}
		aria-label={t('Characters')}
		bind:this={strip}
		onscroll={edges}
		onscrollend={() => (goal = null)}
		onwheel={wheel}
	>
		{#each shown(doc.characters, session.gm) as c (c.id)}
			<button
				class="chip"
				class:active={c.id === character?.id}
				class:hidden={c.hidden}
				title={c.hidden ? t('GM only: players do not see this character') : undefined}
				aria-current={c.id === character?.id}
				onclick={() => (current = c.id)}
				animate:flip={{ duration: 200 }}
				in:scale={{ start: 0.6, duration: 200 }}
			>
				<span class="cname">{c.name}</span>
				{#each presence.others.filter((p) => p.character === c.id) as p (p.who)}
					<span
						class="here"
						style:--peer="var(--peer-{p.color % COLORS})"
						title={t('{name} is here', { name: nameOf(p) })}
					></span>
				{/each}
			</button>
		{/each}
	</nav>
	<button
		class="dot plus"
		aria-label={t('New character')}
		title={t('New character')}
		onclick={() => dialog.showModal()}><Icon name="plus" /></button
	>
</div>

<!-- Only the backdrop is the dialog itself; a click there closes it, as Esc does. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	aria-labelledby="new-title"
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<div class="inner">
		<h2 id="new-title">{t('New character')}</h2>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				create(chosen);
			}}
		>
			<input
				bind:value={newName}
				placeholder={t('Character {n}', { n: doc.characters.length + 1 })}
				aria-label={t('Name')}
			/>
			<button type="submit">{t('Create')}</button>
		</form>
		<p class="muted">{t('Pick what to start from. Enter starts from the one outlined.')}</p>
		<div class="cards">
			<button class="card" class:chosen={chosen === ''} onclick={() => create('')}>
				<Preview layout={null} />
				<span class="tname">{t('Blank')}</span>
			</button>
			{#each doc.templates as tp (tp.id)}
				<div class="wrap">
					<button class="card" class:chosen={chosen === tp.id} onclick={() => create(tp.id)}>
						<Preview layout={tp} />
						<span class="tname">{tp.name}</span>
					</button>
					<button
						class="x del"
						aria-label={t('Delete template {name}', { name: tp.name })}
						title={t('Delete template. Characters made from it keep their layout.')}
						onclick={() =>
							session.change((d) => (d.templates = d.templates.filter((x) => x.id !== tp.id)))}
						>×</button
					>
				</div>
			{/each}
		</div>
		<ExcelImport onadd={place} />
	</div>
</dialog>

<style>
	.roster {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	/* Three characters wide; the rest scroll, faded at whichever end has more. */
	.strip {
		--chip: 7.5rem;
		display: flex;
		gap: 0.3rem;
		max-width: min(100%, calc(3 * var(--chip) + 2 * 0.3rem));
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		--l: #000;
		--r: #000;
		mask-image: linear-gradient(
			to right,
			var(--l),
			#000 1.5rem,
			#000 calc(100% - 1.5rem),
			var(--r)
		);
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	/* Gliding to a character, by the wheel or by [ and ]; at once for those who ask so. */
	@media (prefers-reduced-motion: no-preference) {
		.strip {
			scroll-behavior: smooth;
		}
	}
	.fade-left {
		--l: transparent;
	}
	.fade-right {
		--r: transparent;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 0 0 var(--chip);
		border-radius: 999px;
		border-color: transparent;
		background: transparent;
		scroll-snap-align: start;
	}
	/* Who else has this character open. */
	.here {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		margin-left: -0.25rem;
		border-radius: 999px;
		background: var(--peer);
	}
	.chip.active {
		border-color: var(--line);
		background: var(--surface);
		color: var(--accent);
	}
	.chip.hidden {
		border-style: dashed;
		border-color: var(--line);
	}
	.cname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-head);
	}
	.plus {
		width: 2rem;
		height: 2rem;
	}
	/* Turns a quarter as it is hovered. Under .roster to outrank the global .dot hover. */
	.roster .plus:hover {
		transform: rotate(90deg) scale(1.08);
	}
	dialog {
		width: min(46rem, calc(100vw - 2rem));
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface);
		color: var(--ink);
	}
	dialog[open] {
		animation: pop 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.94) translateY(8px);
		}
	}
	.inner {
		display: grid;
		gap: 0.75rem;
		padding: 1rem 1.25rem 1.25rem;
	}
	h2 {
		margin: 0;
		font: inherit;
		font-family: var(--font-head);
		font-size: 1.1rem;
		font-weight: 600;
	}
	form {
		display: flex;
		gap: 0.4rem;
	}
	form input {
		flex: 1;
	}
	.muted {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(256px, 1fr));
		gap: 0.75rem;
	}
	.wrap {
		position: relative;
	}
	.card {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.5rem;
		border-radius: 10px;
		transition:
			transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
			border-color 0.15s;
	}
	.card:hover {
		transform: translateY(-2px);
	}
	.card.chosen {
		border-color: var(--accent);
	}
	.tname {
		font-family: var(--font-head);
	}
	.del {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
	}
</style>
