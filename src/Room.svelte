<script lang="ts">
	import App from './App.svelte';
	import { t } from './lib/i18n.svelte';
	import { session } from './lib/session.svelte';
</script>

{#if session.ready}
	<App />
{:else}
	<p class="wait">
		{session.status === 'missing'
			? t('There is no room at this link. Ask your GM for a new one.')
			: t('Connecting…')}
	</p>
{/if}

<style>
	.wait {
		padding: 2rem 1rem;
		color: var(--muted);
		text-align: center;
	}
</style>
