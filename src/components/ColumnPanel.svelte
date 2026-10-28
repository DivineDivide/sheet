<script lang="ts">
	import { columnKinds, type Column, type Field, type When } from '../lib/doc';
	import { compile, type Name } from '../lib/formula';
	import { t } from '../lib/i18n.svelte';
	import { ruledColumns } from '../lib/rules';
	import { session } from '../lib/session.svelte';
	import { sources } from '../lib/source';
	import { tip } from '../lib/tip';
	import CodeInput from './CodeInput.svelte';
	import Rules from './Rules.svelte';

	// The table column picked by its icon; its name is edited in its header. Rows keep a
	// deleted column's cells, unseen, so Undo brings the column back with them.
	let {
		field,
		table,
		column,
		known,
		whens,
		fresh,
		editField
	}: {
		field: Field;
		/** The table's `globalId`, which its columns cannot draw on. */
		table: string;
		column: Column;
		/** This row's cells first, then the character's fields. */
		known: Name[];
		whens: { when: When; text: string }[];
		fresh: string;
		editField: (id: string, fn: (f: Field) => void) => void;
	} = $props();

	const change = (fn: (cols: Column[]) => Column[]) =>
		editField(field.id, (f) => {
			f.columns = fn(f.columns ?? []);
		});
	const put = (patch: Partial<Column>) =>
		change((cs) => cs.map((c) => (c.id === column.id ? { ...c, ...patch } : c)));
	/** Commas or 、 between choices, as Excel's lists and Chinese both write them. */
	const split = (text: string) =>
		text
			.split(/[,，、]/)
			.map((s) => s.trim())
			.filter(Boolean);
</script>

<h2>{t('Column {name}', { name: column.name })}</h2>
<label>
	<span class="muted">{t('Holds')}</span>
	<select
		value={column.kind}
		onchange={(e) => put({ kind: e.currentTarget.value as Column['kind'] })}
	>
		{#each columnKinds as k (k)}<option value={k}>{t(k)}</option>{/each}
	</select>
</label>
{#if column.kind === 'choice'}
	{@const tables = sources(session.doc).filter((t) => t.id !== table)}
	{#if tables.length}
		<label
			{@attach tip(
				t(
					"Another table's rows as the choices: choosing one fills the row's cells of the same name, which then follow that row"
				)
			)}
		>
			<span class="muted">{t('From')}</span>
			<select
				value={column.from ?? ''}
				onchange={(e) => put({ from: e.currentTarget.value || undefined })}
			>
				<option value="">{t('Typed choices')}</option>
				{#each tables as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
			</select>
		</label>
	{/if}
	{#if !column.from}
		<label>
			<span class="muted">{t('Choices')}</span>
			<input
				value={(column.choices ?? []).join(', ')}
				placeholder={t('Held, Sacrificed, Spent')}
				onchange={(e) => put({ choices: split(e.currentTarget.value) })}
			/>
		</label>
	{/if}
{:else if column.kind === 'formula'}
	<label for="formula-{column.id}"><span class="muted">{t('Formula')}</span></label>
	<CodeInput
		id="formula-{column.id}"
		label={t('Formula')}
		value={column.formula ?? ''}
		names={known}
		prefix="="
		placeholder="=[@Cost]*2"
		compile={(text) => compile(text, known)}
		onsave={(stored) => put({ formula: stored || undefined })}
	/>
{:else if column.kind === 'resource'}
	<label {@attach tip(t('A bar is pressed or dragged to set the current'))}>
		<span class="muted">{t('Shows as')}</span>
		<select
			value={column.bar ? 'bar' : 'numbers'}
			onchange={(e) => put({ bar: e.currentTarget.value === 'bar' || undefined })}
		>
			<option value="numbers">{t('Numbers')}</option>
			<option value="bar">{t('Bar')}</option>
		</select>
	</label>
{/if}
{#if ruledColumns.includes(column.kind)}
	<span class="muted">{t('Rules')}</span>
	{#key column.id}
		<Rules
			rules={column.rules ?? []}
			names={known}
			{whens}
			{fresh}
			onchange={(rules) => put({ rules: rules.length ? rules : undefined })}
		/>
	{/key}
{/if}
<button onclick={() => change((cs) => cs.filter((c) => c.id !== column.id))}
	>{t('Delete column')}</button
>

<style>
	h2 {
		margin: 0;
		font: inherit;
		font-family: var(--font-head);
		font-size: 0.8rem;
		letter-spacing: var(--label-tracking);
		color: var(--muted);
	}
	label {
		display: grid;
		gap: 0.2rem;
	}
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
