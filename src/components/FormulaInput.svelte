<script lang="ts">
	import type { Character, Field } from '../lib/doc';
	import { compile, isErr, names, result, show } from '../lib/formula';
	import { sheetOf } from '../lib/rules';
	import { session } from '../lib/session.svelte';
	import CodeInput from './CodeInput.svelte';

	let {
		character,
		field,
		editField
	}: {
		character: Character;
		field: Field;
		editField: (id: string, fn: (f: Field) => void) => void;
	} = $props();

	const sheet = $derived(sheetOf(session.doc, character));
	const known = $derived(names(sheet));
	const out = $derived(result(sheet, field.id));
</script>

<label for="formula-{field.id}"><span class="muted">Formula</span></label>
<CodeInput
	id="formula-{field.id}"
	label="Formula"
	value={field.formula ?? ''}
	names={known}
	prefix="="
	placeholder="=力量*2+1"
	compile={(text) => compile(text, known)}
	onsave={(stored) => editField(field.id, (f) => (f.formula = stored))}
/>
{#if field.formula}
	<p class="muted" title={isErr(out) ? out.why : undefined}>
		Shows <b class:err={isErr(out)}>{show(out)}</b>{#if isErr(out) && out.why}: {out.why}{/if}
	</p>
{/if}
<p class="muted">
	Labels as they are, or in [brackets] if they have spaces. HP.max reads a resource's max, a track
	counts its ticks, a clock reads its number and a status its stacks. Excel's functions work: SUM,
	IF, ROUND, COUNTIF…
</p>

<style>
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.err {
		color: var(--accent);
	}
</style>
