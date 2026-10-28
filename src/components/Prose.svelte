<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { markdown } from '../lib/markdown';

	// Text shown as Markdown, with its source only while it is being written. A `line` is a
	// title: its source is one line, and Enter commits rather than breaking it.
	let {
		value,
		label,
		empty = 'Click to write. Markdown works.',
		line = false,
		onchange
	}: {
		value: string;
		label: string;
		empty?: string;
		line?: boolean;
		onchange: (text: string) => void;
	} = $props();

	let writing = $state(false);

	const focusAtEnd: Attachment<HTMLTextAreaElement> = (el) => {
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	};
</script>

{#if writing}
	<!-- A textarea for a line too, so a long title wraps instead of scrolling sideways. Its
	     value is taken once: someone else saving this text must not overwrite the typing. -->
	<textarea
		class={line ? 'line' : 'grow'}
		rows={line ? 1 : undefined}
		value={untrack(() => value)}
		aria-label={label}
		placeholder={line ? empty : 'Markdown: **bold**, *italic*, - lists, # headings'}
		{@attach focusAtEnd}
		onkeydown={(e) => {
			if (!line || e.key !== 'Enter') return;
			e.preventDefault();
			e.currentTarget.blur();
		}}
		onchange={(e) => {
			const text = e.currentTarget.value;
			onchange(line ? text.replace(/\n/g, ' ') : text);
		}}
		onblur={() => (writing = false)}></textarea>
{:else}
	<!-- The source shows while this has focus, from a click or Tab. Pressing a link takes
	     no focus, so in Safari too the link opens instead. -->
	<div
		class="md {line ? 'line' : 'grow'}"
		role="textbox"
		aria-multiline={!line}
		aria-label={label}
		tabindex="0"
		onfocus={() => (writing = true)}
		onpointerdown={(e) => (e.target as Element).closest('a') && e.preventDefault()}
	>
		{#if value}{@html markdown(value)}{:else}<span class="hint">{empty}</span>{/if}
	</div>
{/if}

<style>
	/* Grows with its text, and at least fills its box on the sheet. */
	.grow {
		flex: 1 0 auto;
		field-sizing: content;
		min-height: 2.8em;
		line-height: 1.55;
	}
	.line {
		flex: 1;
		width: 0;
		field-sizing: content;
		resize: none;
		padding-left: 0;
		border-color: transparent;
		background: transparent;
		font-weight: 600;
		line-height: 1.45;
	}
	/* Where the textarea's text would sit, and as tall, so a click lands where it looks. */
	.md {
		padding: 0.2rem 0.45rem;
		border: 1px solid transparent;
		border-radius: var(--radius);
		cursor: text;
	}
	.md.line {
		padding-left: 0;
	}
	.md:hover {
		border-color: var(--line);
	}
	.hint {
		color: var(--muted);
	}
</style>
