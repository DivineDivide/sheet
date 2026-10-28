<script lang="ts">
	import { t } from '../lib/i18n.svelte';
	import { session } from '../lib/session.svelte';

	// What the room did for each press and tick, newest first. Only the room writes it.
	const lines = $derived([...(session.doc.log ?? [])].reverse());
	const time = (at: number) =>
		new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
</script>

<button popovertarget="room-log" disabled={!lines.length} title={t('What presses and ticks did')}
	>{t('Log')}</button
>
<div id="room-log" popover>
	<ol>
		{#each lines as l (l.id)}
			<li><time>{time(l.at)}</time> {l.text}</li>
		{/each}
	</ol>
</div>

<style>
	[popover] {
		position: fixed;
		inset: 7.5rem 1rem auto auto;
		width: min(32rem, calc(100vw - 2rem));
		max-height: 60vh;
		margin: 0;
		padding: 0.5rem 0.75rem;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
	}
	ol {
		display: grid;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}
	time {
		font-family: var(--mono);
		color: var(--muted);
	}
</style>
