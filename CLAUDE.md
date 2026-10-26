# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A character sheet with clocks and statuses, shared live by everyone in a room. The plan
and its phases are in `notes/trpg/plan-sheet.md`; phases 1 and 2 and live rooms are built.
Formulas, tables and Excel import followed, planned in
`notes/trpg/plan-sheet-formulas-import.md`.

## Commands

Run from `trpg/sheet/`:

```bash
npm run dev                       # :7476, the Worker and its rooms included; launch.json's `sheet`
npm test                          # vitest, over src/lib
npx vitest run src/lib/doc.test.ts -t expires   # a single test
npm run check                     # wrangler types, svelte-check, then tsc over worker/
npm run lint                      # prettier --check; `npm run format` rewrites
npm run deploy                    # build + wrangler deploy: goes live
```

## Architecture

- **`src/lib/doc.ts`** — the whole session is one versioned JSON `Doc`: clocks, templates
  and characters. Each character owns its layout (tabs, and fields placed on them) as well
  as its values and statuses, so reshaping one never touches another. A template is a
  layout saved from a character and is never edited; `newCharacter` copies it. A status is
  a stamp: it stores the clock reading when it was applied, and `left` / `phase` derive the
  rest, so advancing a clock rewrites nothing and stepping back is exact.
- **Rooms** — every session lives in a room at `/r/<token>`, and the link is the only
  key. `worker/room.ts` is one SQLite Durable Object per room, storing each character
  as a row of its own, plus rows for clocks, templates and the character order. Players
  join by link alone; `/gm` (make, list and delete rooms) is behind a path-scoped Access
  app, and `worker/identity.ts` checks its JWT. `/` lists the rooms this browser has
  opened. Never put Worker-level Access on this Worker: it refuses WebSocket upgrades.
- **`src/lib/sync.ts`** — edits travel as ops on paths of ids (`set`, `del`, `order`),
  never array positions, and the room applies changes in arrival order, so the later
  edit to a path wins and no locks are needed. `Replica` keeps the room's confirmed doc
  and this client's unconfirmed changes; what shows is always the one with the other on
  top, which the randomised convergence test checks. The room runs `validate` after
  every change and rejects one that breaks the doc; the client then takes it back.
- **`src/lib/session.svelte.ts`** — the one store. Every edit goes through
  `session.change(fn)`, which diffs snapshots taken around `fn` into ops and sends them.
  Mutating `session.doc` directly skips that. Undo sends the reverse of this client's
  own step, minus any path someone else has changed since. Write only when an edit is
  finished (on blur, change or release), never per keystroke or drag frame: each change
  is a row written, and the free plan allows 100,000 a day.
- **`src/lib/io.ts`** — export and import. `parse` refuses bad structure or dangling
  tab/clock references whole. Version-1 files are checked as written, then `v1.ts`
  migrates them: each character gets its own copy of its template's layout on one tab,
  and the old 12-column grid becomes a 672px sheet. Field values are read through
  `valueOf`, which treats a value of the wrong kind as blank, so changing a field's kind
  needs no migration.
- **`src/lib/formula.ts`** — Excel's formula language over one character's fields, with
  its quirks on purpose (each is a test). A formula is stored with `@<id>` references and
  shown with labels (`compile` / `render`), so a rename breaks nothing; `@` takes a UUID
  exactly, so `@id-1` keeps its minus. Results are computed wherever they show and never
  stored, so they cost no rows written. A table column is `Table[Column]`, stored by column
  id. `highlight` colours the editor and must never throw on a half-typed formula.
- **Tables** — a `table` field's columns live on the field and its rows, each with an id,
  are the character's value, so rows and cells sync one by one through the keyed-list diff.
- **Excel import** — `src/lib/xlsx.ts` reads an .xlsx with ExcelJS, imported dynamically
  so only someone importing downloads it, into plain data. `src/lib/excel.ts` then decides
  by rules, from shape and bold alone, which cells make which field. It lists every cell no
  field took and checks each translated formula against Excel's saved result. Its tests
  build a made-up card in ExcelJS. Never commit a player's real card.
- **`src/lib/layout.ts`** — a field's `box` is pixels on its tab, snapped to 8 by `clamp`,
  which every write goes through. A tab runs on in every direction from 0,0, so boxes may
  be negative; layouts made before that sit right of and below 0,0, unmoved. Boxes may
  overlap; nothing settles them. A field's box is its size in play too, and content beyond
  it scrolls. Narrower than 640px the sheet ignores boxes and stacks fields in
  `readingOrder`.
- **`src/lib/view.ts`** — pan and zoom, in play and Edit layout alike. A `View` is the
  sheet point at the middle of the stage plus the zoom, so the window's size never enters
  it. `ui.svelte.ts` keeps each tab's view and the open panels outside `Sheet`, which is
  rebuilt for every character.
- **`src/lib/theme.svelte.ts`** — the theme is this browser's preference, not part of the
  document. `index.html` applies the saved one before paint. Themes are token sets in
  `app.css`, and components read only tokens, so a theme can reshape tags or track boxes
  without editing them.
- **`src/components/`** — `App` holds the top bar, where `Roster` shows three characters
  at a time and a + that opens the new-character popup, with a `Preview` of each
  template's first tab. `Sheet` holds tabs, the stage and the edit-mode gestures. Over the
  stage float `Palette` (left: kinds to drag in) and `Toolbar` (right: inspector, statuses,
  save as template), as round icons whose panels are 85% see-through (`--panel-bg`).
  Gestures listen on the window, because a drag from the palette is released over the
  sheet.
- **`src/lib/keys.ts`** — shortcuts listen on the window too: `App` takes the session-wide
  ones, `Sheet` those for the sheet on screen, and `plain` keeps single keys out of text
  boxes and open dialogs. `shortcuts` is the list `?` shows, so a new key goes there too.
  A copied field is kept in `Sheet`'s module script, so it pastes onto any character.
- **`src/lib/markdown.ts`** — text fields and entry descriptions go through `Prose`, which
  shows Markdown and the source only while it has focus; entry titles too, typed on one
  line, and field labels render the same Markdown wherever they show. `html: false` is
  what makes the `{@html}` safe for an imported file, so keep it. The styles are global
  (`.md` in `app.css`): scoped ones miss `{@html}`.
- **`src/lib/picture.ts`** — an image field's value is a data URL inside the document, so
  `shrink` caps a picture at 1024px as WebP (JPEG in Safari) before it is stored. A
  character row has a 2MB limit, and a change that would overflow it is rejected with
  a notice.
- **Copy image** — `Sheet` mounts `ShareCard` off screen, draws it with `html-to-image`
  and puts the PNG on the clipboard, or downloads it where that is refused. The card keeps
  every box's x and width but grows it to its whole value; `settle` then moves down only
  what sat under a grown box. `html-to-image` waits on `requestAnimationFrame`, so it
  never finishes in a hidden tab.

Bump `VERSION` in `doc.ts` for any change to the document's shape, and teach `parse` to
migrate the old one. Rooms already store the old shape too, so `Room.load` must migrate
it as well. Adding an optional property needs neither.
