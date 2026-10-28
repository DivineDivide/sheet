<script lang="ts">
	import { t } from './lib/i18n.svelte';
	import { visits } from './lib/session.svelte';

	const rooms = visits();
</script>

<main class="page">
	<h1>sheet</h1>
	{#if rooms.length}
		<p>{t('Rooms this browser has opened:')}</p>
		<ul>
			{#each rooms as r (r.token)}
				<li><a href="/r/{r.token}">{r.name}</a></li>
			{/each}
		</ul>
	{:else}
		<p>{t('Every session lives in a room. Ask your GM for the link to yours.')}</p>
	{/if}
	<p class="muted"><a href="/gm">{t('GMs: make and manage rooms')}</a></p>
</main>

<style>
	.page {
		max-width: 36rem;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	h1 {
		font-family: var(--font-head);
		letter-spacing: var(--label-tracking);
	}
	a {
		color: var(--accent);
	}
	.muted {
		margin-top: 2rem;
		color: var(--muted);
	}
</style>
