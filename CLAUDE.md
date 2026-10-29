# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A character sheet with clocks, shared live by everyone in a room. The plan and its phases
are in `notes/trpg/plan-sheet.md`; phases 1 and 2 and live rooms are built. Formulas,
tables and Excel import followed, planned in `notes/trpg/plan-sheet-formulas-import.md`,
then buttons and rules, in `notes/trpg/plan-sheet-rules.md`, which folded statuses into
tables. A GM's page of data that other sheets draw on is `notes/trpg/plan-sheet-gm-page.md`.
Long lists that flip pages are `notes/trpg/plan-sheet-pages.md`; picks inside text, and entries
that run on across pages, `notes/trpg/plan-sheet-picks.md`.

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

`scripts/cdp.mjs` drives headless Chrome and `scripts/rooms.mjs` makes rooms on a dev
server, for checking the page or showing it: the `sheet-room` skill says how.

## Architecture

- **`src/lib/doc.ts`** — the whole session is one versioned JSON `Doc`: clocks, templates
  and characters. Each character owns its layout (tabs, and fields placed on them) as well
  as its values, so reshaping one never touches another. A template is a layout saved from
  a character and is never edited; `newCharacter` copies it. `duplicate` copies a character
  whole, values too, and points what it names of itself (`Name!Label`, sources, links) at
  the copy. A status is a row of a table
  (`statusTable`, which the Basic template has), whose Left a column rule counts down.
  A `hidden` character is a GM's, for their tables and cards: players' pages and exports
  leave it out (`shown`), but its data still reaches their browsers, so their sheets can
  draw on it. A player's chat sees it no more than their page does.
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
  every change and rejects one that breaks the doc; the client then takes it back. `apply`
  never writes an item's `id`, which the room stores each character's row by.
- **`src/lib/session.svelte.ts`** — the one store. Every edit goes through
  `session.change(fn)`, which diffs snapshots taken around `fn` into ops and sends them.
  Mutating `session.doc` directly skips that. Undo sends the reverse of this client's
  own step, minus any path someone else has changed since. Write only when an edit is
  finished (on blur, change or release), never per keystroke or drag frame: each change
  is a row written, and the free plan allows 100,000 a day.
- **Presence** — who is in a room and what each has selected or is writing in, from
  `notes/trpg/plan-sheet-collab.md`. `presence.ts` cuts what a browser sends to size
  (`presenceIn`). The room keeps each person's with their socket (`serializeAttachment`),
  never in storage, and passes it on before it loads the doc, so it costs no rows read or
  written. It names each connection and gives it the lowest free colour slot, drawn as
  `--peer-N`; a browser's tabs share one (`slotFor`), so a slot is a person (`people`), and a
  page that connects again has its old socket ended. `presence.svelte.ts` holds it in the browser, apart from `session`, so it never
  enters undo; `Sheet` sends the character, tab, Edit-layout selection and the field with
  focus, and outlines others' in their colours. Anyone can claim anything here, so a GM
  label grants nothing. `Prose` takes its textarea's value once, so another person's save
  never overwrites typing. While someone types in a `Prose`, its text rides their presence
  as a `draft` (every 250 ms, cut at 4,096 UTF-16 units so the attachment fits), named by the
  box's `at`, and others' `Prose` there shows it until the box is left: still one save.
- **Cursors** — over Cloudflare Realtime, never the room, so moving the pointer costs the
  room nothing. Each browser publishes a `cursor` data channel and hears everyone else's;
  the room wires them over its socket (`rtc` messages, `cursor.ts`), calling Realtime's API
  with `CF_REALTIME_ID` and `CF_REALTIME_KEY` (`worker/realtime.ts`). Session ids stay in the
  socket's attachment, never in a browser, and a person's channels close when they leave.
  Cloudflare has no spending cap, so `worker/meter.ts` is one: the room books the most each
  connection could cost, 5 minutes ahead on an alarm, and the one `Meter` says no once the
  last 31 days would pass 900 GB of the free 1,000 GB; then every connection ends. The
  booking trusts the rate, so a browser hearing more than `LIMIT_RATE` from someone has the
  room cut them off. `cursors.svelte.ts` holds the connection, and `Sheet` sends only while
  someone else is on its tab, at most 15 times a second.
- **`src/lib/io.ts`** — export and import. `parse` refuses bad structure or dangling
  tab/clock references whole. Older files are checked as written, then migrated. `v1.ts`
  gives each character its own copy of its template's layout on one tab, and turns the old
  12-column grid into a 672px sheet. `v2.ts` turns statuses into a Statuses table and drops
  presets and clocks' rules; `Room.load` runs it too, writing the new rows back once, so
  the tables keep their ids. Field values are read through `valueOf`, which treats a value
  of the wrong kind as blank, so changing a field's kind needs no migration.
- **`src/lib/formula.ts`** — Excel's formula language over one character's fields, with
  its quirks on purpose (each is a test). A formula is stored with `@<id>` references and
  shown with labels (`compile` / `render`), so a rename breaks nothing; `@` takes a UUID
  exactly, so `@id-1` keeps its minus. Results are computed wherever they show and never
  stored, so they cost no rows written. A table column is `Table[Column]`, stored by column
  id. `highlight` colours the editor and must never throw on a half-typed formula. Clocks
  are named like fields and stored by id. A status is read from its table, as
  `SUMIF(Statuses[Name], "Poison", Statuses[Stacks])`. Field labels are unique within a
  character (`uniqueLabel`), so a label names one field on any tab. Another character's
  field is `Name!Label`, as Excel names another sheet, stored by `globalId`, since every
  character made from one template shares its field ids; so are source tables. A character
  names its own fields that way too, so a card copied off the GM's page still reads GM!Weapons.
  A bare label never reaches past the character's own. `sheetOf` hands every formula the room's
  characters (`others`), and a rule may read them but never change them.
- **`src/lib/rules.ts`** — when a button is pressed or a clock ticks, rules run: each is a
  formula condition and lines like `HP -= 1d6`, and lives on what it changes (a field or a
  table column), never on the button or the clock. The room runs them: a client sends an
  act (`press`, `tick` or `back`, naming the reading it saw), and `Room.act` calls `fire`
  with its own dice, so a press counts once and nobody rolls again. `fire` tests every
  condition before any rule's lines run, takes a rule that fails part-way back whole, and
  logs each event. It returns the ops and the ops that take
  them back, which the presser's ⌘Z sends as an ordinary edit. A rule may hear another
  character's button or map, stored by `globalId`, so every player's may hear the GM's: a
  press runs each character's rules that hear it (`heard`), each on its own character, which
  its lines still never leave. A tick's log line keeps
  both, so Back takes the last tick to this reading back, its rules' effects with it. No
  rule sets off another event, so every event ends. A line sets a track by its count, ticked
  from the left, or by its `.boxes`, text of `x` and `.`; tags take `+=` and `-=` a tag at a
  time. Dice roll only in rules: a formula
  field that rolls shows #VALUE!. Its spec is the map-step cooldown and poison, a rule on
  the Statuses table.
- **`src/lib/agent/`** — the chat's draft tools, from `notes/trpg/plan-sheet-agent.md`.
  `view.ts` shows a room as text by names and labels, never ids, with boxes in 16px dots;
  `tools.ts` changes a draft of the room through the editor's own checks (`uniqueLabel`,
  `clamp`, `compile`), and `runTool` takes a failed or invalid call back whole. A tool's
  error is for the model to read, so say what is wrong and what is there instead.
  `chat.ts` is one prompt's loop. `worker/agent.ts` is one Durable Object per room that
  calls Claude and keeps each chat's draft for a day. No call may leave from where Claude
  isn't offered (`worker/regions.ts`): the endpoint checks the asker's country first, and
  the object checks its own. In the browser, `client.svelte.ts` holds the chat, and
  `session.draft` shows its draft in place of the room, holding edits back until it is
  applied or discarded. A page opened from `/gm` (`?gm`) is a GM's once `/gm/api/me`
  answers; a player's Apply is a proposal, which the `Room` keeps until a GM settles it.
  A GM's page asks through `/gm/api/rooms/<token>/agent`, behind Access, and only that chat
  reads, changes or marks GM-only characters (the tools' `gm`); a player's works on the
  room as their page shows it. `runTool` runs `follow` after each call, as the editor does.
  The chat gets each picture as a placeholder naming where it is (`pictures.ts`), so a copy
  in a draft takes the room's own picture wherever the draft shows or lands.
- **Tables** — a `table` field's columns live on the field and its rows, each with an id,
  are the character's value, so rows and cells sync one by one through the keyed-list diff.
  A column holds any kind a cell can (`columnKinds`), read through `cellOf` as `valueOf`
  reads a field. A formula column is worked out per row, where a column's name or `[@Col]`
  reads that row's cell. A column's rules run in every row, or only in the row whose button
  column was pressed. In Edit layout a kind dropped from the palette onto a table becomes a
  column there (`Table` owns its headers: rename, drag the icon to move, press it to open
  `ColumnPanel` in the inspector). A table draws rows from another, usually a GM-only
  character's (`source.ts`): a choice column's `from` offers that table's rows by name, and
  a table's `from` its +. Such a row keeps a `link` and follows its source row, since
  `session.change` runs `follow` after every edit and `fire` after every event, through its
  own writes so Back and ⌘Z take both; its cells from the source are read-only. A `choice`
  field is a dropdown on its own, of typed `choices` or of a `from` table's rows by name
  (`choicesOf`); it keeps only the name, since a field has no row to follow.
- **Maps** — from `notes/trpg/plan-sheet-map.md`. A `map` field draws a table's rows (its
  `from`, usually a GM-only character's) as a tree, left to right by depth (`map.ts`), so
  all it stores of the shape is `parents`, each placed row's parent and `''` for a root. A
  row with none waits in Edit layout's Unplaced tray until dragged onto a node. Its value
  is the current row's id, and a formula reads it as that row's name. Pressing a node is an
  act, as a button's is: `fire` moves the map first, so the rules that hear its press read
  the node pressed, and logs the move by name. Several maps may share a table. A table that
  `follows` a map keeps one row, linked to the current node (`track` in `source.ts`, which
  `follow` runs first), so a shared page shows the place's own cells, picture and all, and
  the press's ⌘Z takes both back. The row stays from node to node, so its cells the place
  has no column for stay. The chat hangs nodes with `arrange_map` and moves a map with
  `set_value`, which runs no rules: only a person's press is an act.
- **The log** — `doc.log` holds the last 50 events. Clients cannot write it, since it is
  not among `isChange`'s roots. It is a row of its own in the room.
- **Excel import** — `src/lib/xlsx.ts` reads an .xlsx with ExcelJS, imported dynamically
  so only someone importing downloads it, into plain data. `src/lib/excel.ts` then decides
  by rules, from shape and bold alone, which cells make which field. It lists every cell no
  field took and checks each translated formula against Excel's saved result. Its tests
  build a made-up card in ExcelJS. Never commit a player's real card.
- **`src/lib/layout.ts`** — a field's `box` is pixels on its tab, snapped to 8 by `clamp`,
  which every write goes through. A tab runs on in every direction from 0,0, so boxes may
  be negative; layouts made before that sit right of and below 0,0, unmoved. Boxes may
  overlap; nothing settles them. A field's box is its size in play too, and content beyond
  it scrolls, inside the box (`.content`), so what sits on its edge is never clipped: a
  `hideLabel` field's controls float there on hover. In Edit layout every label shows, with
  the toggle that hides it right after it; a hidden one, struck through, floats on the edge
  with those controls, while the box is hovered or selected, so the box reads as in play.
  `FieldValue` keeps all else inert there. A table or entries list with `pages` flips
  pages instead (`Pages`): every row stays drawn and measured, `pageStarts` fits whole rows to the box,
  and rows off the page carry `data-off`. An entries list `flow`s instead: its pages are CSS columns
  shifted into view, so an entry taller than the box runs on by line, and one that fits stays whole.
  Each browser keeps its own page in `ui.pages`. Narrower than 640px the
  sheet ignores boxes and stacks fields in `readingOrder`.
- **`src/lib/view.ts`** — pan and zoom, in play and Edit layout alike. A `View` is the
  sheet point at the middle of the stage plus the zoom, so the window's size never enters
  it. `ui.svelte.ts` keeps each tab's view and the open panels outside `Sheet`, which is
  rebuilt for every character.
- **`src/lib/theme.svelte.ts`** — the theme is this browser's preference, not part of the
  document. `index.html` applies the saved one before paint. Themes are token sets in
  `app.css`, and components read only tokens, so a theme can reshape tags or track boxes
  without editing them. A set applies to any element with `data-theme`, each taking the
  whole Light set first, so the theme picker draws each theme as a circle of its surface
  with an F in its ink and font, the closed picker the current one's.
- **`src/lib/i18n.svelte.ts`** — the language is this browser's too, English or Traditional
  Chinese, switched beside the theme (`notes/trpg/sheet-zh.md`, with its glossary). A phrase
  is its English text, `t('Add a box')`, and `src/lib/zh/` maps it to Chinese; a phrase
  missing there fails `npm run check`. Modules the Worker loads never import it, so what
  they say (the log, the room's refusals, `io.ts`'s errors) stays English.
- **`src/components/`** — `CodeInput` is the coloured, completing box for formulas, rule
  conditions and lines; `Rules` edits a list of rules with it. `App` holds the top bar,
  where `Roster` shows three characters at a time and a + that opens the new-character
  popup, with a `Preview` of each template's first tab. `Sheet` holds tabs, the stage and the edit-mode gestures. Over the
  stage float, in Edit layout, `Palette` (left: kinds to drag in, then the bind tool) and
  `Toolbar` (right: inspector and save as template), as round icons whose panels are 85%
  see-through (`--panel-bg`). Fields sharing a `bind` on a tab are bound (`bind.ts`): a
  click selects them all, and a drag, the arrows, ⌘C and Delete act on the whole
  selection, so they move, copy and delete as one; a second click picks one out. A
  table's + menu (`Picker`) sits on the stage as well, after the viewport, so the stage clips it, its panels float over it, and it stays on its table
  as the sheet pans. `Bar` draws a resource whose field or column has `bar`: a thin bar
  after the current / max boxes, where a press, a drag or an arrow key sets the current,
  written on release. The inspector holds inputs, not explanations, and a button says what it
  does only in its hover hint (`tip.ts`). Each clock in `Clocks` has
  a link icon listing the fields and columns its ticks run or that read it.
  Gestures listen on the window, because a drag from the palette is released over the
  sheet.
- **`src/lib/keys.ts`** — shortcuts listen on the window too: `App` takes the session-wide
  ones, `Sheet` those for the sheet on screen, and `plain` keeps single keys out of text
  boxes and open dialogs. `shortcuts` is the list `?` shows, so a new key goes there too.
  Copied fields are kept in `clip.ts` and this browser, so they paste onto any character,
  in any room; `group.ts` re-binds their formulas and rules where they land.
- **`src/lib/markdown.ts`** — text fields and entry descriptions go through `Prose`, which
  shows Markdown and the source only while it has focus; entry titles too, typed on one
  line, and field labels render the same Markdown wherever they show. `html: false` is
  what makes the `{@html}` safe for an imported file, so keep it. The styles are global
  (`.md` in `app.css`): scoped ones miss `{@html}`. A pick, `{Character!Table}` or `{a|b|c}`,
  keeps its choice in the text (`{a|b|c=b}`); only `Prose` draws it as a dropdown, finding it in
  the source by `data-at` for `setPick`, and elsewhere it shows the choice. It names its table by
  name, not id, so a rename leaves it showing as typed. The chat reads each pick with what it
  offers (`picksIn`), and its tools refuse a new choice it doesn't offer.
- **`src/lib/picture.ts`** — an image field's value is a data URL inside the document, so
  `shrink` caps a picture at 1024px as WebP (JPEG in Safari) before it is stored, and an
  image column's at 512px (`CELL`), since a table holds many. A
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
