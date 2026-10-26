<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { Character, Field } from '../lib/doc';
	import {
		FormulaError,
		compile,
		highlight,
		isErr,
		render,
		result,
		show,
		suggest
	} from '../lib/formula';

	// Typed with labels, stored with ids. A formula that cannot be read is not saved: the
	// box keeps what was typed and says what is wrong.
	let {
		character,
		field,
		editField
	}: {
		character: Character;
		field: Field;
		editField: (id: string, fn: (f: Field) => void) => void;
	} = $props();

	let input = $state<HTMLTextAreaElement>();
	let problem = $state('');
	let caret = $state(0);
	let focused = $state(false);

	const written = (stored: string | undefined) =>
		stored ? `=${render(stored, character.fields)}` : '';
	const shown = $derived(written(field.formula));
	let text = $state(untrack(() => shown));
	// Someone else's edit, or a renamed label, shows unless this box is being typed in.
	$effect(() => {
		const next = shown;
		if (!untrack(() => focused)) text = next;
	});

	const pieces = $derived(highlight(text, character.fields));
	const hints = $derived(focused ? suggest(text, caret, character.fields) : null);
	const out = $derived(result(character, field.id));

	function save() {
		try {
			const stored = text.trim() && text.trim() !== '=' ? compile(text, character.fields) : '';
			problem = '';
			if (stored !== (field.formula ?? '')) editField(field.id, (f) => (f.formula = stored));
			text = written(stored);
		} catch (e) {
			if (!(e instanceof FormulaError)) throw e;
			problem = e.message;
		}
	}

	const track = (el: HTMLTextAreaElement) => (caret = el.selectionStart ?? el.value.length);

	async function take(option: string) {
		const at = hints!.from;
		text = text.slice(0, at) + option + text.slice(caret);
		caret = at + option.length;
		await tick();
		input!.focus();
		input!.setSelectionRange(caret, caret);
	}
</script>

<label for="formula-{field.id}"><span class="muted">Formula</span></label>
<!-- The textarea's own text is transparent over a coloured copy of it, so editing, the caret,
     selection and CJK input stay the browser's own. The copy, in flow, sets the height. -->
<div class="editor">
	<pre class="paint" aria-hidden="true">{#each pieces as p, i (i)}<span
				class={p.paint}
				data-depth={p.depth}>{p.text}</span
			>{/each}{' '}</pre>
	<textarea
		id="formula-{field.id}"
		bind:this={input}
		bind:value={text}
		rows="1"
		placeholder="=力量*2+1"
		spellcheck="false"
		autocomplete="off"
		onfocus={(e) => {
			focused = true;
			track(e.currentTarget);
		}}
		onblur={() => (focused = false)}
		oninput={(e) => track(e.currentTarget)}
		onkeyup={(e) => track(e.currentTarget)}
		onclick={(e) => track(e.currentTarget)}
		onkeydown={(e) => {
			if (e.key === 'Tab' && !e.shiftKey && hints?.options.length) {
				e.preventDefault();
				take(hints.options[0]);
			} else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
				// Shift or Alt with Enter breaks the line, as Alt+Enter does in Excel.
				e.preventDefault();
				e.currentTarget.blur();
			}
		}}
		onchange={save}></textarea>
</div>
{#if hints?.options.length}
	<div class="hints">
		{#each hints.options as o (o)}
			<!-- Pressing one keeps the focus in the box, so typing goes on. -->
			<button
				type="button"
				class="mono"
				onpointerdown={(e) => e.preventDefault()}
				onclick={() => take(o)}>{o}</button
			>
		{/each}
	</div>
{/if}
{#if problem}
	<p class="problem">{problem}</p>
{:else if field.formula}
	<p class="muted" title={isErr(out) ? out.why : undefined}>
		Shows <b class:err={isErr(out)}>{show(out)}</b>{#if isErr(out) && out.why}: {out.why}{/if}
	</p>
{/if}
<p class="muted">
	Labels as they are, or in [brackets] if they have spaces. HP.max reads a resource's max, a track
	counts its ticks, and Excel's functions work: SUM, IF, ROUND, COUNTIF…
</p>

<style>
	.mono {
		font-family: var(--mono);
		font-size: 0.85rem;
	}
	.editor {
		display: grid;
	}
	/* Both layers lay text out the same way, or the caret drifts off the colours. */
	.editor > * {
		grid-area: 1 / 1;
		min-width: 0;
		margin: 0;
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		font: 0.85rem/1.5 var(--mono);
		letter-spacing: normal;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		tab-size: 2;
	}
	.paint {
		background: var(--page);
		color: var(--ink);
	}
	textarea {
		height: 100%;
		overflow: hidden;
		resize: none;
		background: transparent;
		color: transparent;
		caret-color: var(--ink);
	}
	textarea::placeholder {
		color: var(--muted);
	}
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.fn {
		color: var(--code-fn);
	}
	.field {
		color: var(--code-field);
	}
	.num,
	.bool {
		color: var(--code-num);
	}
	.str {
		color: var(--code-str);
	}
	.op {
		color: var(--muted);
	}
	.paren[data-depth='0'] {
		color: var(--code-fn);
	}
	.paren[data-depth='1'] {
		color: var(--code-num);
	}
	.paren[data-depth='2'] {
		color: var(--code-field);
	}
	.unknown,
	.bad {
		color: var(--accent);
		text-decoration: underline wavy var(--accent);
		text-decoration-thickness: 1px;
	}
	.hints {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.hints button {
		padding: 0.05rem 0.45rem;
	}
	.muted,
	.problem {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.problem,
	.err {
		color: var(--accent);
	}
</style>
