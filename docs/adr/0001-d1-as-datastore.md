# D1 (SQLite) as the primary data store

We chose Cloudflare D1 over KV and R2 for memo and label storage. D1's relational model naturally fits the many-to-many relationship between memos and labels. KV would require manual index management, and R2 is object storage — neither is a good fit for structured, queryable data with filtering and search requirements.

