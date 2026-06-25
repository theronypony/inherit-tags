# Inherit Tags

Automatically tag new notes based on the selected tag in [Notebook Navigator](https://github.com/johansanneblad/notebook-navigator), and convert inline `#tags` to frontmatter metadata.

## Features

### Auto-Tagging

When you have a tag selected in Notebook Navigator and create a new note, the selected tag is
automatically added to the new note's frontmatter `tags:` array. It works with nested tags
(e.g. `work/meetings`) and preserves any existing tags.

- Falls back to the last-selected tag when the navigator pane is closed at note-creation time.
- Skips aggregate rows (e.g. "Tagged" / "Untagged").
- Skips a tag that's already implied by a more specific one already present
  (e.g. won't add `work` when the note already has `work/meetings`).
- Configurable per-folder exclusions (e.g. `Templates`).

### Inline Tag Converter

Converts inline `#tag` text in your notes' bodies into frontmatter `tags:` metadata, and removes the
original inline tags. This is useful for notes imported from other text editors that use inline
tagging, such as Bear Notes.

The converter is safety-first:

1. **Scope** — convert the whole vault or a single folder (recursively).
2. **Dry-run preview** — see exactly which files and tags would change, with the option to export a
   markdown report, before anything is modified.
3. **Double confirmation** — two warnings reminding you to back up your vault.
4. **Progress + cancel** — a progress modal with ETA that you can cancel mid-run.
5. **Transaction log** — a JSON record of every file touched, written to the plugin's data folder.

It correctly ignores `#` inside fenced code blocks, inline code, HTML, and frontmatter, and skips
markdown headings and (optionally) hex colors like `#FF5733`.

Run it from the command palette (**Inherit Tags: Convert inline tags to frontmatter**) or from the
plugin settings.

## Requirements

- [Notebook Navigator](https://github.com/johansanneblad/notebook-navigator) must be installed for
  the auto-tagging feature. (The inline tag converter works without it.)

## Settings

- **Enable auto-tagger** — turn Feature A on/off (default: on).
- **Exclude folders** — comma-separated folder paths excluded from auto-tagging.
- **Hex color filter** — skip `#FF5733`-style tokens during conversion (default: on).
- **Skip short numeric tags** — ignore 1–3 digit numbers like `#1`–`#999` (e.g. "Session #1"); 4-digit
  years like `#2024` are kept (default: off).
- **Custom tag exclusion (regex)** — skip inline tags whose name (without the leading `#`) matches a
  regular expression you supply, e.g. `^\d+$` for any pure number (default: empty/off).
- **Convert existing tags only** — only convert inline tags that already exist elsewhere in the vault
  (in another note) or in the note's own frontmatter; one-off inline tags found only in a single note
  are left alone (default: off).
  - **Strip single-note inline tags** — when the above is on, also remove those one-off inline tags
    from the body without adding them to frontmatter (default: off).

## Known Limitations

- Auto-tagging only applies to `.md` files (not canvas or other formats).
- The inline tag converter has **no undo** — always back up your vault before running it.

## Development

```bash
npm install
npm run dev     # watch build → main.js
npm run build   # typecheck + production build
npm test        # unit tests
```

Copy `main.js`, `manifest.json` (and `styles.css` if added) into
`<vault>/.obsidian/plugins/inherit-tags/` to test in a real vault.

## Implementation notes

- The inline-tag parsing (token grammar, code/HTML exclusion ranges, tag validation) is a faithful
  reimplementation of Notebook Navigator's internal logic, since the plugin cannot import NN's
  internal modules.
- The converter writes **frontmatter first, then strips the body**. This deviates from the original
  plan's body-first ordering on purpose: if a crash occurs between the two steps, the result is a
  recoverable duplicate (the inline tag is still present *and* in frontmatter) rather than
  irrecoverable data loss, and re-running the converter is idempotent.
