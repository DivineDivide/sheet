<script lang="ts" module>
	import type { Kind } from '../lib/doc';
	import type { Phrase } from '../lib/i18n.svelte';

	export const hints: Record<Kind, Phrase> = {
		number: 'a single value',
		resource: 'current / max, with − and +',
		track: 'a row of boxes to tick',
		formula: 'worked out from other fields, as in Excel',
		button: "press it to run fields' rules",
		text: 'free text, in Markdown',
		tags: 'a list of short labels',
		entries: 'titled items, described in Markdown',
		table: 'rows under columns: drop kinds onto it',
		image: 'a picture: pick, drop or paste one'
	};
</script>

<script lang="ts">
	import { kinds } from '../lib/doc';
	import { t } from '../lib/i18n.svelte';
	import { mod } from '../lib/keys';
	import Icon from './Icon.svelte';

	let {
		grab,
		add,
		binding,
		bind
	}: {
		grab: (e: PointerEvent, kind: Kind) => void;
		add: (kind: Kind) => void;
		/** What the bind tool would do to the selected fields. */
		binding: 'bind' | 'unbind' | null;
		bind: () => void;
	} = $props();

	const binds = $derived(
		binding === 'unbind'
			? { name: 'unbind' as const, hint: t('let them move on their own (⇧{mod}G)', { mod }) }
			: {
					name: 'bind' as const,
					hint: binding
						? t('move, copy and delete them as one ({mod}G)', { mod })
						: t('⇧-click two fields or more first')
				}
	);
</script>

<!-- Two columns, as in SAO's menu: round icons, and beside each a bar naming it, which
     slides out as its icon is hovered. -->
<aside class="rail" aria-label={t('Add and bind fields')}>
	{#each kinds as kind (kind)}
		<button
			class="kind"
			aria-label={t('Add {kind}: {hint}. Drag onto the sheet, or click.', {
				kind: t(kind),
				hint: t(hints[kind])
			})}
			onpointerdown={(e) => grab(e, kind)}
			onclick={(e) => e.detail === 0 && add(kind)}
		>
			<span class="dot"><Icon name={kind} /></span>
			<span class="bar" aria-hidden="true">
				<b>{t(kind)}</b>
				<small>{t(hints[kind])}</small>
			</span>
		</button>
	{/each}
	<hr />
	<button
		class="kind tool"
		aria-label={t('{tool}: {hint}', { tool: t(binds.name), hint: binds.hint })}
		disabled={!binding}
		onclick={bind}
	>
		<span class="dot"><Icon name={binds.name} /></span>
		<span class="bar" aria-hidden="true">
			<b>{t(binds.name)}</b>
			<small>{binds.hint}</small>
		</span>
	</button>
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
	.tool {
		cursor: pointer;
	}
	/* Disabled fades only the icon: its bar still says how to use it. */
	.tool:disabled {
		cursor: default;
		opacity: 1;
	}
	.tool:disabled .dot {
		opacity: 0.4;
	}
	hr {
		width: 100%;
		margin: 0.1rem 0;
		border: none;
		border-top: 1px solid var(--line);
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
