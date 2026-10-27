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
<!-- The field shows its result; only what went wrong is said here. -->
{#if field.formula && isErr(out)}
	<p class="err">
		{show(out)}{#if out.why}: {out.why}{/if}
	</p>
{/if}

<style>
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.err {
		margin: 0;
		font-size: 0.8rem;
		color: var(--accent);
	}
</style>
