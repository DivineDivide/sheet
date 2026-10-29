<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import {
		cellOf,
		valueOf,
		type Character,
		type Clock,
		type Entry,
		type Field,
		type Resource,
		type Row
	} from '../lib/doc';
	import { cellResult, result, show } from '../lib/formula';
	import { bounds, settle } from '../lib/layout';
	import { markdown } from '../lib/markdown';

	// What gets pasted into a chat: every tab, every value in full. Each box keeps its place
	// and width from the sheet but grows to its whole value, because an image cannot scroll.
	let { character, clocks }: { character: Character; clocks: Clock[] } = $props();
	const sections = $derived(
		character.tabs
			// A button has nothing to show in a picture.
			.map((tab) => ({
				tab,
				fields: character.fields.filter((f) => f.tab === tab.id && f.kind !== 'button')
			}))
			.filter((s) => s.fields.length)
	);
	// The sheet runs left of 0,0 too; the card starts at its leftmost field.
	const span = $derived(bounds(character.fields.map((f) => f.box)));

	// Per tab, known only once the grown boxes have been measured.
	let laid = $state<Record<string, { tops: Record<string, number>; h: number }>>({});

	const measure =
		(tab: string, fields: Field[]): Attachment<HTMLElement> =>
		(canvas) => {
			const heights: Record<string, number> = {};
			for (const el of canvas.children as HTMLCollectionOf<HTMLElement>)
				heights[el.dataset.id!] = el.offsetHeight;
			const settled = settle(fields, heights);
			// Blank sheet above a tab's first field is no use in a picture.
			const y0 = Math.min(...fields.map((f) => f.box.y));
			const tops = Object.fromEntries(fields.map((f) => [f.id, settled[f.id] - y0]));
			laid[tab] = { tops, h: Math.max(...fields.map((f) => tops[f.id] + heights[f.id])) };
		};
</script>

<article class="card" style:width="{span.w}px">
	<header>
		<h1>{character.name}</h1>
		<span class="clocks">
			{#each clocks as k (k.id)}<span>{k.name} {k.now}</span>{/each}
		</span>
	</header>

	{#each sections as { tab, fields } (tab.id)}
		{@const at = laid[tab.id]}
		<section>
			{#if sections.length > 1}<h2>{tab.name}</h2>{/if}
			<div class="canvas" style:height="{at?.h ?? 0}px" {@attach measure(tab.id, fields)}>
				{#each fields as f (f.id)}
					{@const v = valueOf(character, f)}
					<div
						class="field"
						data-id={f.id}
						style:left="{f.box.x - span.x}px"
						style:top="{at?.tops[f.id] ?? f.box.y}px"
						style:width="{f.box.w}px"
						style:min-height="{f.box.h}px"
						style:height={f.kind === 'image' ? `${f.box.h}px` : undefined}
					>
						{#if !f.hideLabel}<div class="label md">{@html markdown(f.label)}</div>{/if}
						{#if f.kind === 'number'}
							<span class="big">{v}</span>
						{:else if f.kind === 'resource'}
							{@const r = v as Resource}
							<span class="big">{r.cur} <span class="of">/ {r.max}</span></span>
							<span class="meter"
								><span style:width="{Math.min(100, Math.max(0, (r.cur / (r.max || 1)) * 100))}%"
								></span></span
							>
						{:else if f.kind === 'formula'}
							<span class="big">{show(result({ ...character, clocks }, f.id))}</span>
						{:else if f.kind === 'track'}
							{@const boxes = v as boolean[]}
							<span class="track">
								{#each boxes as on, j (j)}<span class="box" class:on></span>{/each}
							</span>
						{:else if f.kind === 'text'}
							{#if v}<div class="md">{@html markdown(v as string)}</div>{:else}<span class="none"
									>—</span
								>{/if}
						{:else if f.kind === 'choice'}
							{#if v}<span>{v}</span>{:else}<span class="none">—</span>{/if}
						{:else if f.kind === 'image'}
							<!-- Its box's own height, unlike the rest: known before the picture loads. -->
							{#if v}<img class="pic" src={v as string} alt={f.label} />{:else}<span class="none"
									>—</span
								>{/if}
						{:else if f.kind === 'tags'}
							{@const tags = v as string[]}
							{#if tags.length}
								<span class="tags">
									{#each tags as tag, j (j)}<span class="tag">{tag}</span>{/each}
								</span>
							{:else}<span class="none">—</span>{/if}
						{:else if f.kind === 'table'}
							{@const rows = v as Row[]}
							<!-- Buttons, as on their own, have nothing to show. -->
							{@const cols = (f.columns ?? []).filter((c) => c.kind !== 'button')}
							{#if rows.length && cols.length}
								<table class="grid">
									<thead>
										<tr
											>{#each cols as c (c.id)}<th>{c.name}</th>{/each}</tr
										>
									</thead>
									<tbody>
										{#each rows as r (r.id)}
											<tr>
												{#each cols as c (c.id)}
													{@const cell = cellOf(r, c)}
													<td class="md">
														{#if c.kind === 'track'}
															{@const boxes = cell as boolean[]}
															<span class="track">
																{#each boxes as on, j (j)}<span class="box" class:on></span>{/each}
															</span>
														{:else if c.kind === 'formula'}
															{c.formula?.trim()
																? show(cellResult({ ...character, clocks }, f.id, c.id, r.id))
																: ''}
														{:else if c.kind === 'resource'}
															{(cell as Resource).cur} / {(cell as Resource).max}
														{:else if c.kind === 'tags'}
															{((cell as string[] | undefined) ?? []).join(', ')}
														{:else}
															{@html markdown(String(cell ?? ''))}
														{/if}
													</td>
												{/each}
											</tr>
										{/each}
									</tbody>
								</table>
							{:else}<span class="none">—</span>{/if}
						{:else if f.kind === 'entries'}
							{@const entries = v as Entry[]}
							{#if entries.length}
								<ol class="entries">
									{#each entries as entry, j (j)}
										<li>
											<div class="md title">{@html markdown(entry.name)}</div>
											{#if entry.text}<div class="md">{@html markdown(entry.text)}</div>{/if}
										</li>
									{/each}
								</ol>
							{:else}<span class="none">—</span>{/if}
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/each}
</article>

<style>
	/* Sizes follow the sheet's, so a value wraps in the image where it wraps in play. */
	.card {
		display: grid;
		gap: 14px;
		box-sizing: content-box;
		padding: 24px;
		background: var(--backdrop);
		color: var(--ink);
		font: 15px/1.45 var(--font-body);
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--line);
	}
	h1 {
		flex: 1;
		margin: 0;
		font-family: var(--font-head);
		font-size: 26px;
		letter-spacing: var(--label-tracking);
	}
	.clocks {
		display: flex;
		gap: 10px;
		font-family: var(--mono);
		font-size: 13px;
		color: var(--muted);
	}
	section {
		display: grid;
		gap: 10px;
	}
	h2 {
		margin: 4px 0 0;
		font-family: var(--font-head);
		font-size: 13px;
		letter-spacing: var(--label-tracking);
		color: var(--accent);
	}
	h2::before {
		content: var(--tab-mark);
	}
	.canvas {
		position: relative;
	}
	.field {
		position: absolute;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.45rem 0.6rem;
		border: var(--field-border);
		border-radius: var(--radius);
		background: var(--field-bg);
		box-shadow: var(--field-shadow);
	}
	.label {
		font-family: var(--font-head);
		font-size: 0.75rem;
		letter-spacing: var(--label-tracking);
		color: var(--muted);
	}
	.big {
		font-size: 22px;
		font-variant-numeric: tabular-nums;
	}
	.of {
		font-size: 15px;
		color: var(--muted);
	}
	.meter {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
	}
	.meter span {
		display: block;
		height: 100%;
		border-radius: 2px;
		background: var(--accent);
	}
	.track {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 2px;
	}
	.box {
		width: 1.2rem;
		height: 1.2rem;
		border: 1px solid var(--muted);
		border-radius: var(--track-radius);
		rotate: var(--track-turn);
	}
	.box.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.tag {
		padding: 0.05rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--tag-radius);
		clip-path: var(--tag-clip);
		background: var(--tag-bg);
		font-size: 0.85rem;
	}
	.entries {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.entries li {
		display: grid;
		gap: 0.2rem;
		padding-left: 0.6rem;
		border-left: 2px solid var(--entry-rule);
	}
	.title {
		font-weight: 600;
	}
	.grid {
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	.grid th {
		padding: 2px 6px;
		border-bottom: 1px solid var(--line);
		font-weight: normal;
		text-align: left;
		color: var(--muted);
	}
	.grid td {
		padding: 2px 6px;
		border-bottom: 1px solid color-mix(in oklab, var(--line) 60%, transparent);
		vertical-align: top;
	}
	.pic {
		flex: 1;
		min-height: 0;
		width: 100%;
		object-fit: contain;
	}
	.none {
		color: var(--muted);
	}
</style>
