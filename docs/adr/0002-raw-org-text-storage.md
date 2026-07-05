# Store raw org text as memo body, not normalized AST output

We store the original org text verbatim as the memo body, rather than parsing with `org-toolkit` and re-serializing via `stringify()`. The `parse` → `stringify` roundtrip normalizes whitespace (e.g., strips list item indentation) and alters the original formatting, which would silently lose the user's original text. The AST is used only for metadata extraction (title, tags) during import.

A future reader might assume we'd use the AST for roundtripping — this ADR explains why we don't.

