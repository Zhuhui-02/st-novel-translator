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
- Open an embedded Chinese translation workspace from a SillyTavern extension
  button.
- Import TXT and EPUB inside SillyTavern.
- Export JSON, TXT, and bilingual HTML from the embedded workspace.

## Embedded Workspace

After enabling the extension in SillyTavern, open Extensions and click
`打开小说翻译工作台`. The workspace appears inside SillyTavern as a large overlay
panel, not as a separate web app.

The embedded workspace supports:

- Project metadata and style settings.
- TXT, Markdown-like text, and EPUB import.
- Chapter and segment navigation.
- Translation editing.
- Glossary, name table, style rule, and QA tabs.
- Translation/review prompt generation.
- Sending a generated prompt to the SillyTavern chat input.
- JSON, TXT, and bilingual HTML export.

URL import is included as an experimental browser-side fetch. Sites such as
Kakuyomu usually require a future Server Plugin proxy because browsers often
block direct cross-site reads.

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
- EPUB import through browser-side JSZip loading.
- JSON import and export.
- Browser-local persistence.

Not included yet:

- Direct model API calls.
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
