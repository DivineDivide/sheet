<script lang="ts">
	import { t } from '../lib/i18n.svelte';
	import { shortcuts } from '../lib/keys';

	let dialog: HTMLDialogElement;

	export function toggle() {
		if (dialog.open) dialog.close();
		else dialog.showModal();
	}
</script>

<!-- Only the backdrop is the dialog itself; a click there closes it, as Esc does. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	aria-labelledby="keys-title"
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<div class="inner">
		<h2 id="keys-title">{t('Keyboard shortcuts')}</h2>
		<p class="muted">{t('Single keys work while no text box has the cursor.')}</p>
		{#each shortcuts as [title, rows] (title)}
			<h3>{t(title)}</h3>
			<table>
				<tbody>
					{#each rows as [keys, does] (does)}
						<tr>
							<td>
								{#each keys as k (k)}<kbd>{typeof k === 'string' ? k : t(k.word)}</kbd>{/each}
							</td>
							<td>{t(does)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/each}
		<form method="dialog">
			<button>{t('Close')}</button>
		</form>
	</div>
</dialog>

<style>
	dialog {
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	.inner {
		display: grid;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
	}
	h2,
	h3 {
		margin: 0;
		font: inherit;
		font-family: var(--font-head);
		letter-spacing: var(--label-tracking);
	}
	h2 {
		font-size: 1.1rem;
		font-weight: 600;
	}
	h3 {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	table {
		border-collapse: collapse;
	}
	td {
		padding: 0.2rem 1rem 0.2rem 0;
		vertical-align: baseline;
	}
	td:first-child {
		white-space: nowrap;
	}
	kbd {
		display: inline-block;
		min-width: 1.6em;
		margin-right: 0.2rem;
		padding: 0 0.35rem;
		border: 1px solid var(--line);
		border-bottom-width: 2px;
		border-radius: 4px;
		background: var(--page);
		font-family: var(--mono);
		font-size: 0.8rem;
		text-align: center;
	}
	.muted {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
	form {
		justify-self: end;
	}
</style>
