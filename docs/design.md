# Design

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| API server | Hono |
| Database | Cloudflare D1 (SQLite) |
| Frontend framework | React (TanStack Router + TanStack Query) |
| Build tool | Vite |
| UI components | shadcn/ui |
| Org parsing | org-toolkit (hexx/org-toolkit) |
| Project structure | Single package (`src/server/` + `src/client/`) |

## Data model

### memos

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT NOT NULL | First line of body, or `#+TITLE:` on import |
| body | TEXT NOT NULL | Raw org text |
| is_pinned | INTEGER NOT NULL DEFAULT 0 | Boolean flag |
| is_archived | INTEGER NOT NULL DEFAULT 0 | Boolean flag |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

### labels

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL UNIQUE | User-created label name |

### memo_labels

| Column | Type | Notes |
|---|---|---|
| memo_id | TEXT FK → memos(id) | CASCADE on delete |
| label_id | TEXT FK → labels(id) | CASCADE on delete |

Primary key: (memo_id, label_id)

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | /memos | List memos (search query, label filter, include archived) |
| POST | /memos | Create memo |
| GET | /memos/:id | Get memo by ID |
| PUT | /memos/:id | Update memo |
| DELETE | /memos/:id | Delete memo (physical) |
| PATCH | /memos/:id/pin | Toggle pin |
| PATCH | /memos/:id/archive | Toggle archive |
| GET | /labels | List labels |
| POST | /labels | Create label |
| DELETE | /labels/:id | Delete label |
| POST | /import | Import org text (multipart or JSON body) |
| GET | /memos/:id/export | Export single memo as .org |
| GET | /export | Export filtered memos as zip (query: label) |

## Import flow

1. Receive org text (file upload or paste)
2. Store raw org text as `body`
3. Parse with `org-toolkit`: extract `TITLE` from metadata, collect all heading tags via `walk()`
4. Title = `metadata.TITLE` if present, else first line of body
5. Labels = all collected heading tags → find-or-create in labels table → link via memo_labels
6. Create memo row

## Export flow

1. Retrieve memo from DB
2. Prepend `#+TITLE: {title}` and `#+FILETAGS: {label1:label2}` to the raw body text
3. Return as `.org` file download

For multi-memo export: filter by label, create individual .org files, pack into zip.

## PWA

- Offline read-only via Service Worker cache
- No offline write support (avoids conflict resolution complexity)

## org notation support

Headings (`*`), unordered lists (`-`, `+`), ordered lists (`1.`), bold (`*bold*`), italic (`/italic/`), strikethrough (`+strikethrough+`), code blocks (`#+BEGIN_SRC`), links (`[[url][description]]`).

