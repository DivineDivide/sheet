<script lang="ts">
	import { newId, type Rule, type When } from '../lib/doc';
	import { compile, compileLine, type Name } from '../lib/formula';
	import CodeInput from './CodeInput.svelte';

	// Rules live on what they change, never on the button that sets them off.
	let {
		rules,
		names,
		whens,
		fresh,
		onchange,
		cond = (text) => compile(text, names),
		line = (text) => compileLine(text, names)
	}: {
		rules: Rule[];
		names: Name[];
		/** What can set a rule off here, the default first. */
		whens: { when: When; text: string }[];
		/** A new rule's line, as stored. */
		fresh: string;
		onchange: (rules: Rule[]) => void;
		/** Typed text to stored, throwing `FormulaError`; labels become ids unless told. */
		cond?: (text: string) => string;
		line?: (text: string) => string;
	} = $props();

	const key = (w: When) => ('press' in w ? `press:${w.press}` : `tick:${w.tick}`);
	const when = (k: string): When =>
		k.startsWith('press:') ? { press: k.slice(6) } : { tick: k.slice(5) };
	const put = (i: number, patch: Partial<Rule>) =>
		onchange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
</script>

{#each rules as rule, i (rule.id)}
	<fieldset class="rule">
		<span class="muted">When</span>
		<div class="head">
			<select
				value={key(rule.when)}
				aria-label="When"
				onchange={(e) => put(i, { when: when(e.currentTarget.value) })}
			>
				{#each whens as w (key(w.when))}
					<option value={key(w.when)}>{w.text}</option>
				{/each}
				{#if !whens.some((w) => key(w.when) === key(rule.when))}
					<option value={key(rule.when)}>something deleted</option>
				{/if}
			</select>
			<button
				class="x"
				aria-label="Delete rule"
				onclick={() => onchange(rules.filter((r) => r.id !== rule.id))}>×</button
			>
		</div>
		<span class="muted">If</span>
		<div>
			<CodeInput
				id="if-{rule.id}"
				label="If"
				value={rule.if ?? ''}
				{names}
				placeholder="always"
				compile={cond}
				onsave={(stored) => put(i, { if: stored || undefined })}
			/>
		</div>
		<span class="muted">Then</span>
		<div class="then">
			{#each rule.then as text, j (j)}
				<CodeInput
					id="then-{rule.id}-{j}"
					label="Then, line {j + 1}"
					value={text}
					{names}
					placeholder="HP -= 1d6"
					compile={line}
					onsave={(stored) =>
						put(i, {
							then: stored
								? rule.then.map((t, k) => (k === j ? stored : t))
								: rule.then.filter((_, k) => k !== j)
						})}
				/>
			{/each}
			<button class="more" onclick={() => put(i, { then: [...rule.then, ''] })}>+ Line</button>
		</div>
	</fieldset>
{/each}
<button
	disabled={!whens.length}
	title={whens.length ? undefined : 'Add a button or a clock first'}
	onclick={() => onchange([...rules, { id: newId(), when: whens[0].when, then: [fresh] }])}
	>+ Rule</button
>

<style>
	.rule {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: baseline;
		gap: 0.3rem 0.4rem;
		margin: 0;
		padding: 0.4rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.head {
		display: flex;
		gap: 0.3rem;
	}
	.head select {
		flex: 1;
		width: 0;
	}
	.then {
		display: grid;
		gap: 0.3rem;
	}
	.muted {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.more {
		justify-self: start;
		padding: 0.05rem 0.45rem;
		font-size: 0.8rem;
	}
</style>
