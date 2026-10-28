<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { session } from '../lib/session.svelte';
	import { t } from '../lib/i18n.svelte';

	let held = $state(false);

	// Long enough to read, 4s and a little per character, and never while the pointer is on it.
	$effect(() => {
		void session.noticeKey;
		const text = session.notice;
		if (!text || held) return;
		const t = setTimeout(() => (session.notice = null), Math.min(10_000, 4000 + text.length * 40));
		return () => clearTimeout(t);
	});
</script>

<!-- Always present, so a screen reader hears each notice that appears inside it. -->
<div class="toasts" role="status">
	<!-- Global: a local transition would not play when the {#if} around its {#key} ends. -->
	{#if session.notice}
		{#key session.noticeKey}
			<!-- svelte-ignore a11y_no_static_element_interactions: hovering only holds it open -->
			<div
				class="toast"
				in:fly|global={{ y: 12, duration: 180 }}
				out:fade|global={{ duration: 400 }}
				onpointerenter={() => (held = true)}
				onpointerleave={() => (held = false)}
			>
				<span>{session.notice}</span>
				<button class="x" aria-label={t('Dismiss')} onclick={() => (session.notice = null)}
					>×</button
				>
			</div>
		{/key}
	{/if}
</div>

<style>
	/* One cell, so a notice fading out and the next one coming in share the spot. */
	.toasts {
		position: fixed;
		bottom: 1.25rem;
		left: 50%;
		z-index: 10;
		display: grid;
		translate: -50% 0;
		pointer-events: none;
	}
	.toast {
		grid-area: 1 / 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: min(36rem, calc(100vw - 2rem));
		padding: 0.4rem 0.4rem 0.4rem 1rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
		pointer-events: auto;
	}
</style>
