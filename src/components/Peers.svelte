<script lang="ts">
	import { COLORS, nameOf, people, type Peer } from '../lib/presence';
	import { presence } from '../lib/presence.svelte';
	import { session } from '../lib/session.svelte';
	import { shown } from '../lib/doc';
	import { t } from '../lib/i18n.svelte';

	// Who is here, each in their colour; your own circle renames you.
	let renaming = $state(false);

	const self = $derived(presence.self);
	const badge = (p: Peer) => (p.name ? [...p.name][0] : p.gm ? 'GM' : String(p.color + 1));
	// A GM-only character is named only to whom the page shows it.
	const on = (p: Peer) =>
		shown(session.doc.characters, session.gm).find((c) => c.id === p.character)?.name;
</script>

<div class="peers" role="group" aria-label={t('Here now')}>
	{#each people(presence.others) as p (p.color)}
		{@const where = on(p)}
		<span
			class="peer"
			style:--peer="var(--peer-{p.color % COLORS})"
			title={where ? t('{name}, on {where}', { name: nameOf(p), where }) : nameOf(p)}
			>{badge(p)}</span
		>
	{/each}
	{#if self}
		{#if renaming}
			<input
				class="rename"
				value={presence.name}
				placeholder={nameOf({ ...self, name: undefined })}
				aria-label={t('Your name')}
				{@attach (el) => el.select()}
				onkeydown={(e) => {
					if (e.key === 'Enter') e.currentTarget.blur();
					else if (e.key === 'Escape') renaming = false;
				}}
				onblur={(e) => {
					if (renaming) presence.name = e.currentTarget.value;
					renaming = false;
				}}
			/>
		{:else}
			<button
				class="peer me"
				style:--peer="var(--peer-{self.color % COLORS})"
				title={t('You, as {name}: press to rename', { name: nameOf(self) })}
				onclick={() => (renaming = true)}>{badge(self)}</button
			>
		{/if}
	{/if}
</div>

<style>
	.peers {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-right: 0.5rem;
	}
	.peer {
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: var(--peer);
		color: var(--surface);
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1;
	}
	.me {
		box-shadow:
			0 0 0 2px var(--chrome),
			0 0 0 3px var(--peer);
	}
	.rename {
		width: 9rem;
	}
</style>
