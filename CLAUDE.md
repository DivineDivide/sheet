# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A character sheet with clocks and statuses that runs entirely in the browser. The plan
and its phases are in `notes/trpg/plan-sheet.md`; phases 1 and 2 are built.

## Commands

Run from `trpg/sheet/`:

```bash
npm run dev                       # :7476; the root launch.json's `sheet` preview runs this
npm test                          # vitest, over src/lib
npx vitest run src/lib/doc.test.ts -t expires   # a single test
npm run check                     # svelte-check: types in .ts and .svelte alike
npm run lint                      # prettier --check; `npm run format` rewrites
npm run deploy                    # build + wrangler deploy: assets only, goes live
```

## Architecture

- **`src/lib/doc.ts`** — the whole session is one versioned JSON `Doc`: clocks, templates
  (field lists) and characters (values plus statuses). A status is a stamp: it stores the
  clock reading when it was applied, and `left` / `phase` derive the rest, so advancing a
  clock rewrites nothing and stepping back is exact.
- **`src/lib/session.svelte.ts`** — the one store. Every edit goes through
  `session.change(fn)`, which snapshots for undo (`history.ts`), applies `fn` to the live
  doc and autosaves to `localStorage` under `sheet.doc`. Mutating `session.doc` directly
  skips both.
- **`src/lib/io.ts`** — export and import. `parse` refuses bad structure or dangling
  template/clock references whole. Field values are read through `valueOf`, which treats
  a value of the wrong kind as blank, so changing a field's kind needs no migration.
- **`src/lib/layout.ts`** — a field's optional `box` places it on a 12-column grid. In play,
  rows are sized by their content. `resolve` is the only reader: it flows box-less fields
  from older files and floats everything up, so stored boxes may hold holes or overlaps
  that never show. `place` is the one writer. The moved field holds its target while the
  others settle, then everything floats up again.
- **`src/components/`** — `Clocks`, `CharacterCard` with `FieldValue` per field, and
  `Templates` hosting `Builder`, the drag-and-drop canvas. The builder's row height and
  gap are pixel constants shared by its CSS and its pointer maths. A card is a size
  container: narrower than 36rem it stacks fields in reading order, wider it applies the
  grid.

Bump `VERSION` in `doc.ts` for any change to the document's shape, and teach `parse` to
migrate the old one. Adding an optional property, as `box` was, needs neither. Templates
hold layout, characters hold values: per-character geometry, or a status that writes
back to a clock, is how this would grow back into `mysite/table`.
