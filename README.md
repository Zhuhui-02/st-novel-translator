# ST Novel Translator

ST Novel Translator is a SillyTavern UI extension for long-form novel translation.
It treats a novel as a translation project with chapters, aligned segments,
translation memory, glossary entries, character/entity names, style rules, and
quality checks.

The first version is intentionally frontend-only. It stores project data in the
browser through `localforage` when available, with `localStorage` as a fallback.

## Features

- Import plain text or Markdown-like novel text.
- Split text into chapters and translation segments.
- Maintain bilingual segment rows with status tracking.
- Manage glossary entries, character names, and style rules.
- Build translation prompts from project context.
- Copy prompts or send them to the SillyTavern chat input.
- Run lightweight local QA checks for empty translations, length drift, and
  terminology consistency.
- Export and import project JSON.
- Use the standalone Chinese workspace in `standalone/` for TXT/EPUB import and
  JSON/TXT/HTML export.
- Optionally run the local scraper service for URL import experiments.

## Standalone Chinese Workspace

Open `standalone/index.html` from a local static server or publish the repository
through GitHub Pages. The page supports:

- TXT and Markdown-like text import.
- EPUB import through browser-side JSZip.
- Chapter and segment navigation.
- Translation editing.
- Glossary and name tables.
- Prompt generation and local QA.
- JSON, TXT, and bilingual HTML export.

For URL import, the page first tries browser fetch. If the site blocks cross-site
requests, run the local helper:

```text
npm run scraper
```

Then try the URL again. The helper exposes:

```text
http://localhost:8787/api/fetch?url=https%3A%2F%2Fkakuyomu.jp%2F...
```

Use site scraping carefully and only for content you have permission to process.

## Install From SillyTavern

After this project is pushed to GitHub, install it directly inside SillyTavern:

1. Open SillyTavern.
2. Open Extensions.
3. Select `Install extension`.
4. Paste the repository URL:

```text
https://github.com/Zhuhui-02/st-novel-translator
```

SillyTavern will clone the repository into its third-party extension folder.

## Manual Installation

Copy this repository folder into:

```text
SillyTavern/public/scripts/extensions/third-party/st-novel-translator
```

Then restart SillyTavern or reload the browser page and enable the extension from
the Extensions panel.

## Current Status

This is an MVP. It is designed for immediate manual testing in SillyTavern and
for direct installation once the GitHub repository exists.

Working:

- Project settings.
- Text import.
- Chapter and segment splitting.
- Segment translation editing.
- Glossary, names, and style rule tables.
- Translation prompt generation.
- Review prompt generation.
- Local QA checks.
- JSON import and export.
- Browser-local persistence.

Not included yet:

- Direct model API calls.
- EPUB parsing.
- SQLite/server-plugin storage.
- Batch background translation queue.
- DOCX/HTML export.

## Architecture

```text
index.js
  Loads SillyTavern context, mounts the UI, and wires user actions.

src/state.js
  Holds the project model, reducers, import/export helpers, and selectors.

src/storage.js
  Persists project state through localforage or localStorage.

src/segmenter.js
  Splits imported text into chapters and paragraph-sized segments.

src/prompt-builder.js
  Builds translation and review prompts from style rules, glossary entries,
  entities, and nearby context.

src/qa.js
  Runs local deterministic quality checks.
```

## MVP Data Model

- `Project`: title, language pair, style profile, timestamps.
- `Chapter`: title, order, status.
- `Segment`: source text, translated text, status, notes, hash.
- `Glossary`: source term, target term, type, priority, notes.
- `Entity`: source name, translated name, aliases, role, speech style.
- `StyleRule`: prioritized style instruction and examples.
- `QAIssue`: deterministic issue linked to a segment.

## Notes

This extension does not call a model API directly yet. It prepares robust prompts
and can place them in the SillyTavern input box so the current SillyTavern
connection, model, presets, and personas remain in control.

Future versions can add a server plugin for SQLite, EPUB parsing, batch export,
and background translation jobs.
