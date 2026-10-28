<script lang="ts">
	import { fly } from 'svelte/transition';
	import { chat, models } from '../lib/agent/client.svelte';
	import { t, type Phrase } from '../lib/i18n.svelte';
	import { markdown } from '../lib/markdown';
	import { tip } from '../lib/tip';
	import Icon from './Icon.svelte';

	let input = $state('');
	let log = $state<HTMLElement>();

	const verbs: Record<string, Phrase> = {
		read: 'Read',
		add_character: 'Added',
		edit_character: 'Changed',
		save_template: 'Saved template',
		remove_template: 'Removed template',
		edit_clocks: 'Changed clocks',
		edit_tabs: 'Changed tabs of',
		add_field: 'Added',
		edit_field: 'Changed',
		remove_field: 'Removed',
		set_value: 'Set',
		edit_table: 'Changed',
		set_rules: 'Set rules on'
	};

	// Follows the reply as it streams in.
	$effect(() => {
		const last = chat.said.at(-1);
		void (last && 'tools' in last && [last.text, last.tools.length]);
		void chat.said.length;
		log?.scrollTo({ top: log.scrollHeight });
	});

	function send(e?: Event) {
		e?.preventDefault();
		const text = input.trim();
		if (!text || chat.busy || chat.waiting) return;
		input = '';
		chat.ask(text);
	}
</script>

<section class="panel chat" aria-label={t('Chat')} transition:fly={{ y: 16, duration: 160 }}>
	<header>
		<h2>{t('Chat')}</h2>
		<select
			bind:value={chat.model}
			aria-label={t('Model')}
			disabled={chat.started || chat.busy}
			{@attach tip(
				chat.started ? t('A chat keeps its model') : t('The model that makes the draft')
			)}
		>
			{#each models as m (m.id)}
				<option value={m.id}>{m.name}</option>
			{/each}
		</select>
		<button
			class="dot"
			aria-label={t('New chat')}
			disabled={chat.busy || !chat.said.length}
			{@attach tip(t('New chat: discards the draft'))}
			onclick={() => chat.clear()}><Icon name="plus" /></button
		>
	</header>

	<div class="log" bind:this={log}>
		{#if !chat.said.length}
			<p class="muted">
				{t(
					"Say what to change on any character, template or clock, in any language. Claude reads this room's text, never its pictures, and makes a draft to look over before it reaches the room."
				)}
			</p>
		{/if}
		{#each chat.said as s, i (i)}
			{#if s.who === 'you'}
				<p class="you">{s.text}</p>
			{:else if s.who === 'note'}
				<p class="note">{s.text}</p>
			{:else}
				<div class="claude">
					{#each s.tools as tool, j (j)}
						<p class="tool" class:bad={!tool.ok} {@attach tip(tool.text)}>
							{tool.ok ? '✓' : '✗'}
							{verbs[tool.name] ? t(verbs[tool.name]) : tool.name}
							{tool.about}
						</p>
					{/each}
					{#if s.text}<div class="md">{@html markdown(s.text)}</div>{/if}
					{#if s.error}<p class="error">{s.error}</p>{/if}
					{#if chat.busy && i === chat.said.length - 1 && !s.text && !s.error}
						<p class="muted">{t('Working…')}</p>
					{/if}
				</div>
			{/if}
		{/each}
	</div>

	<form onsubmit={send}>
		<textarea
			bind:value={input}
			rows="2"
			aria-label={t('Say what to change')}
			placeholder={chat.waiting ? t('Waiting for the GM…') : t('Say what to change')}
			disabled={chat.waiting}
			onkeydown={(e) => {
				// Not while an input method is still composing, as for Chinese.
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) send(e);
			}}></textarea>
		<button disabled={chat.busy || chat.waiting || !input.trim()}>{t('Send')}</button>
	</form>
</section>

<style>
	.chat {
		position: absolute;
		right: calc(1rem + 12px);
		bottom: calc(1rem + 12px + 2.25rem + 0.5rem);
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: min(22rem, calc(100% - 2rem));
		max-height: min(32rem, 70%);
		padding: 0.75rem;
		/* The inspector's see-through panel, blurred: running text over the sheet is unreadable. */
		backdrop-filter: blur(14px);
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	h2 {
		margin: 0 auto 0 0;
		font: inherit;
		font-family: var(--font-head);
		font-size: 0.8rem;
		letter-spacing: var(--label-tracking);
		color: var(--muted);
	}
	select {
		font-size: 0.8rem;
	}
	header .dot {
		width: 1.9rem;
		height: 1.9rem;
	}
	.log {
		display: grid;
		align-content: start;
		gap: 0.5rem;
		min-height: 4rem;
		overflow: auto;
		overflow-wrap: anywhere;
	}
	p {
		margin: 0;
	}
	.you {
		justify-self: end;
		max-width: 85%;
		padding: 0.35rem 0.6rem;
		border-radius: 10px;
		background: color-mix(in oklab, var(--accent) 14%, var(--surface));
		white-space: pre-wrap;
	}
	.claude {
		display: grid;
		gap: 0.2rem;
	}
	.tool,
	.note,
	.muted {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.tool.bad {
		text-decoration: line-through;
	}
	.note {
		text-align: center;
	}
	.error {
		color: var(--accent);
	}
	form {
		display: flex;
		align-items: end;
		gap: 0.35rem;
	}
	textarea {
		flex: 1;
		width: 0;
		max-height: 8rem;
		field-sizing: content;
	}
</style>
