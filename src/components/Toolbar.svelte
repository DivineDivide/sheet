<script lang="ts">
	import { fly } from 'svelte/transition';
	import {
		globalId,
		kinds,
		tagsIn,
		uniqueLabel,
		type Character,
		type Column,
		type Field,
		type Kind,
		type When
	} from '../lib/doc';
	import { compileLine, nameOf, names as namesOf, rowNames, type Name } from '../lib/formula';
	import { t } from '../lib/i18n.svelte';
	import { session } from '../lib/session.svelte';
	import { sources } from '../lib/source';
	import { tip } from '../lib/tip';
	import { ui, type Panel } from '../lib/ui.svelte';
	import { ruled, sheetOf } from '../lib/rules';
	import ColumnPanel from './ColumnPanel.svelte';
	import FormulaInput from './FormulaInput.svelte';
	import Icon from './Icon.svelte';
	import Rules from './Rules.svelte';

	let {
		character,
		field,
		group,
		column,
		editField,
		remove,
		saveTemplate
	}: {
		character: Character;
		field: Field | undefined;
		/** Every selected field, `field` among them. */
		group: Field[];
		/** The column of the selected table picked in its header. */
		column: Column | undefined;
		editField: (id: string, fn: (f: Field) => void) => void;
		remove: (ids: string[]) => void;
		saveTemplate: (name: string) => void;
	} = $props();

	const names = { field: 'Selected field', template: 'Save as template' } as const;
	const open = $derived(ui.panel === 'chat' ? null : ui.panel);
	const toggle = (p: Panel) => (ui.panel = open === p ? null : p);

	// Selecting a field brings its inspector up, even after it was closed.
	const selectedId = $derived(field?.id);
	$effect(() => {
		if (selectedId) ui.panel = 'field';
	});

	let templateName = $state('');

	const known = $derived(namesOf(sheetOf(session.doc, character)));
	type Whens = { when: When; text: string }[];
	const pressed = (t: Field, text: (c: Column) => string): Whens =>
		(t.columns ?? [])
			.filter((c) => c.kind === 'button')
			.map((c) => ({ when: { press: c.id }, text: text(c) }));
	const buttons = $derived<Whens>(
		character.fields
			.filter((f) => f.kind === 'button')
			.map((b) => ({ when: { press: b.id }, text: t('{label} pressed', { label: b.label }) }))
	);
	const ticks = $derived<Whens>(
		session.doc.clocks.map((k) => ({
			when: { tick: k.id },
			text: t('{name} ticks', { name: k.name })
		}))
	);
	const whens = $derived<Whens>([
		...buttons,
		...character.fields
			.filter((f) => f.kind === 'table')
			.flatMap((f) =>
				pressed(f, (c) => t('{table} {column} pressed', { table: f.label, column: c.name }))
			),
		...ticks
	]);
	// A column's rules hear only its own table's buttons, each in the row pressed.
	const columnWhens = $derived<Whens>(
		field
			? [
					...pressed(field, (c) => t('{column} pressed, in its row', { column: c.name })),
					...buttons,
					...ticks
				]
			: []
	);
	const rowKnown = $derived(field ? [...rowNames(field), ...known] : known);
	function fresh(label: string, kind: string, names: Name[]) {
		const text = `${nameOf({ label })} ${kind === 'text' || kind === 'choice' ? '= ""' : '+= 1'}`;
		try {
			return compileLine(text, names);
		} catch {
			return text;
		}
	}
</script>

<aside class="rail">
	<div class="icons">
		{#each ['field', 'template'] as const as p (p)}
			<button
				class="dot"
				aria-label={t(names[p])}
				title={t(names[p])}
				aria-expanded={open === p}
				onclick={() => toggle(p)}><Icon name={p} /></button
			>
		{/each}
	</div>

	{#if open}
		<section class="panel" transition:fly={{ x: 16, duration: 160 }}>
			{#if open === 'field'}
				<h2>{t('Selected')}</h2>
				{#if group.length > 1}
					<p class="muted">{group.map((f) => f.label).join(', ')}</p>
					<button onclick={() => remove(group.map((f) => f.id))}
						>{t('Delete {n} fields', { n: group.length })}</button
					>
				{:else if field}
					<label>
						<span class="muted">{t('Label')}</span>
						<input
							value={field.label}
							onchange={(e) => {
								const text = e.currentTarget.value.trim();
								if (!text) return;
								const label = uniqueLabel(text, character.fields, field.id);
								if (label !== text) {
									session.notice = t('Another field is labelled {text}, so this one is {label}.', {
										text,
										label
									});
									e.currentTarget.value = label;
								}
								editField(field.id, (f) => (f.label = label));
							}}
						/>
					</label>
					<label>
						<span class="muted">{t('Kind')}</span>
						<select
							value={field.kind}
							onchange={(e) => editField(field.id, (f) => (f.kind = e.currentTarget.value as Kind))}
						>
							{#each kinds as kind (kind)}
								<option value={kind}>{t(kind)}</option>
							{/each}
						</select>
					</label>
					{#if field.kind === 'table' || field.kind === 'entries'}
						<label {@attach tip(t('A page holds as many rows as fit the box'))}>
							<span class="muted">{t('Long lists')}</span>
							<select
								value={field.pages ? 'pages' : 'scroll'}
								onchange={(e) => {
									const paged = e.currentTarget.value === 'pages';
									editField(field.id, (f) => (paged ? (f.pages = true) : delete f.pages));
								}}
							>
								<option value="scroll">{t('Scroll')}</option>
								<option value="pages">{t('Flip pages')}</option>
							</select>
						</label>
					{/if}
					{#if field.kind === 'resource'}
						<label {@attach tip(t('A bar is pressed or dragged to set the current'))}>
							<span class="muted">{t('Shows as')}</span>
							<select
								value={field.bar ? 'bar' : 'numbers'}
								onchange={(e) => {
									const bar = e.currentTarget.value === 'bar';
									editField(field.id, (f) => (bar ? (f.bar = true) : delete f.bar));
								}}
							>
								<option value="numbers">{t('Numbers')}</option>
								<option value="bar">{t('Bar')}</option>
							</select>
						</label>
					{/if}
					{#if field.kind === 'formula'}
						{#key field.id}
							<FormulaInput {character} {field} {editField} />
						{/key}
					{:else if field.kind === 'table'}
						{@const tables = sources(session.doc).filter(
							(t) => t.id !== globalId(character, field)
						)}
						{#if tables.length}
							<label
								{@attach tip(
									t(
										"The table whose rows this one's + offers; a row added from it follows that row"
									)
								)}
							>
								<span class="muted">{t('Rows from')}</span>
								<select
									value={field.from ?? ''}
									onchange={(e) => {
										const from = e.currentTarget.value;
										editField(field.id, (f) => (from ? (f.from = from) : delete f.from));
									}}
								>
									<option value="">{t('No table')}</option>
									{#each tables as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								</select>
							</label>
						{/if}
						{#if column}
							<ColumnPanel
								{field}
								table={globalId(character, field)}
								{column}
								known={rowKnown}
								whens={columnWhens}
								fresh={fresh(column.name, column.kind, rowKnown)}
								{editField}
							/>
						{/if}
					{:else if field.kind === 'choice'}
						{@const tables = sources(session.doc)}
						{#if tables.length}
							<label {@attach tip(t("Another table's rows, by name, as the choices"))}>
								<span class="muted">{t('From')}</span>
								<select
									value={field.from ?? ''}
									onchange={(e) => {
										const from = e.currentTarget.value;
										editField(field.id, (f) => (from ? (f.from = from) : delete f.from));
									}}
								>
									<option value="">{t('Typed choices')}</option>
									{#each tables as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								</select>
							</label>
						{/if}
						{#if !field.from}
							<label>
								<span class="muted">{t('Choices')}</span>
								<input
									value={(field.choices ?? []).join(', ')}
									placeholder={t('Held, Sacrificed, Spent')}
									onchange={(e) => {
										const choices = tagsIn(e.currentTarget.value);
										editField(field.id, (f) =>
											choices.length ? (f.choices = choices) : delete f.choices
										);
									}}
								/>
							</label>
						{/if}
					{/if}
					{#if ruled.includes(field.kind)}
						<span class="muted">{t('Rules')}</span>
						{#key field.id}
							<Rules
								rules={field.rules ?? []}
								names={known}
								{whens}
								fresh={fresh(field.label, field.kind, known)}
								onchange={(rules) => {
									editField(field.id, (f) => {
										f.rules = rules.length ? rules : undefined;
									});
								}}
							/>
						{/key}
					{/if}
					{#if character.tabs.length > 1}
						<label>
							<span class="muted">{t('Tab')}</span>
							<select
								value={field.tab}
								onchange={(e) => editField(field.id, (f) => (f.tab = e.currentTarget.value))}
							>
								{#each character.tabs as t (t.id)}
									<option value={t.id}>{t.name}</option>
								{/each}
							</select>
						</label>
					{/if}
					<button onclick={() => remove([field.id])}>{t('Delete field')}</button>
				{:else}
					<p class="muted">{t('Nothing selected.')}</p>
				{/if}
			{:else}
				<h2>{t('Template')}</h2>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						saveTemplate(templateName.trim() || character.name);
						templateName = '';
					}}
				>
					<input
						bind:value={templateName}
						placeholder={character.name}
						aria-label={t('Template name')}
					/>
					<button type="submit">{t('Save')}</button>
				</form>
				<p class="muted">
					{t('Copies these tabs and fields, without values, to start new characters from.')}
				</p>
			{/if}
		</section>
	{/if}
</aside>

<style>
	/* Empty space in the rail is canvas: only its icons and panel take the pointer. */
	.rail {
		position: absolute;
		top: 12px;
		right: 12px;
		bottom: 12px;
		display: flex;
		flex-direction: row-reverse;
		align-items: flex-start;
		gap: 0.5rem;
		pointer-events: none;
	}
	.icons,
	.panel {
		pointer-events: auto;
		cursor: auto;
	}
	.icons {
		display: grid;
		gap: 0.45rem;
		padding: 0.4rem 0;
	}
	.panel {
		display: grid;
		gap: 0.5rem;
		width: 17rem;
		max-height: 100%;
		padding: 0.75rem;
		overflow: auto;
	}
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
	form {
		display: flex;
		gap: 0.3rem;
	}
	form input {
		flex: 1;
		width: 0;
	}
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
