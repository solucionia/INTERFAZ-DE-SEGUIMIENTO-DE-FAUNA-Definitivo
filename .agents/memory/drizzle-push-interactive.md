---
name: drizzle-kit push interactive prompts
description: How to add new tables in this repo when `npm run db:push` blocks on interactive prompts / a dangerous unrelated truncate.
---

`npm run db:push` (drizzle-kit) is interactive here and its prompts CANNOT be answered from the agent shell: piped stdin (`printf '\n'`, `\r`) is ignored (needs a real TTY), and `script -qec` just hangs the pty until timeout. `expect`/`unbuffer`/`node-pty` are not installed.

Two blockers seen when adding new tables:
1. For each new table drizzle asks "created or renamed from another table?" (it lists every existing table as a rename candidate).
2. There is a PRE-EXISTING drift: push wants to add `processed_sftp_files_filename_unique` to the already-populated `processed_sftp_files` table (~6500 rows) and offers to **truncate** it. NEVER accept truncation.

**Reliable path to add new tables:** create them via raw SQL (`executeSql` in code_execution) with DDL that exactly matches the Drizzle table definition (column types, defaults `gen_random_uuid()`/`now()`, FKs with the same ON DELETE, named unique constraints `<table>_<col>_unique`, and the same index names). Then push recognizes them as existing and stops prompting about them. Do NOT run push to "finish" — it will still stop on the processed_sftp_files truncate prompt.

**Why:** the environment can't feed keystrokes to drizzle's prompt lib, and the only remaining push prompt is a destructive truncate on a live table.
**How to apply:** whenever a task adds tables/columns to `shared/schema.ts`, apply the change with matching raw SQL DDL instead of relying on `db:push`.
