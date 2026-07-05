# Memo

A Google Keep-like memo application with org-mode import/export capabilities. Designed as a single-user PWA deployed on Cloudflare Workers.

## Language

**Memo**:
A structured text note with org-mode notation in its body. Each memo has a title (first line), body, creation timestamp, update timestamp, pinned flag, and archived flag.
_Avoid_: Note, card, entry, document

**Label**:
A user-defined tag that can be attached to multiple memos. Memos can have zero or more labels. Labels are used for filtering and organization.
_Avoid_: Tag, category, folder

**Pin**:
A boolean flag on a memo that causes it to appear at the top of the memo grid, visually separated from unpinned memos.
_Avoid_: Favorite, star, bookmark

**Archive**:
A boolean flag that hides a memo from the main view. Archived memos are accessible via a dedicated archive view and can be unarchived.
_Avoid_: Trash, delete, hide

**Import**:
Creating a new Memo from an `.org` file (upload) or org-mode text (paste). One `.org` file maps to one Memo. The `#+TITLE:` directive becomes the memo title. All heading tags in the file are collected as memo labels. Duplicate titles are allowed — a new Memo is always created.
_Avoid_: Upload, ingest, parse

**Export**:
Generating and downloading an `.org` file from a Memo. The title is written as `#+TITLE:`. Memo labels are written as `#+FILETAGS:`. Multiple memos filtered by label can be exported as a zip archive.
_Avoid_: Download, save, dump

**Org notation**:
The plain-text markup syntax used in the memo body, based on Emacs org-mode. Supported elements: headings (`*`), unordered lists (`-`, `+`), ordered lists (`1.`), bold (`*bold*`), italic (`/italic/`), strikethrough (`+strikethrough+`), code blocks (`#+BEGIN_SRC`), and links (`[[url][description]]`).
_Avoid_: Markdown, rich text, formatting
