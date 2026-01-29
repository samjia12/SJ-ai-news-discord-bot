# SQLite Schema (v1 draft)

This is a **draft** schema for the v1 implementation.

## Tables

### `guilds`
Stores per-guild configuration.

- `guild_id` TEXT PRIMARY KEY
- `allowed` INTEGER NOT NULL DEFAULT 0
- `channel_id` TEXT NULL
- `enabled` INTEGER NOT NULL DEFAULT 1
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### `secrets`
Stores translation provider keys (plaintext on disk, as requested).

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `provider` TEXT NOT NULL  -- openai | deepl | claude
- `api_key` TEXT NOT NULL
- `output_language` TEXT NOT NULL DEFAULT 'en'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

> v1 can simplify this further to a single-row table (global config).

### `sent_items`
Deduplication + audit record.

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `guild_id` TEXT NOT NULL
- `item_key` TEXT NOT NULL  -- guid or link
- `item_link` TEXT NOT NULL
- `published_at` TEXT NULL
- `sent_at` TEXT NOT NULL
- `status` TEXT NOT NULL  -- ok | error | skipped
- `error` TEXT NULL

Indexes:
- UNIQUE(`guild_id`, `item_key`)
- INDEX on (`guild_id`, `sent_at`)

### `daily_counters`
Tracks per-guild daily cap.

- `guild_id` TEXT NOT NULL
- `date` TEXT NOT NULL  -- YYYY-MM-DD
- `sent_count` INTEGER NOT NULL DEFAULT 0

PRIMARY KEY (`guild_id`, `date`)

### `poll_runs`
Tracks RSS polling runs for dashboard visibility.

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `started_at` TEXT NOT NULL
- `finished_at` TEXT NOT NULL
- `items_fetched` INTEGER NOT NULL
- `items_new` INTEGER NOT NULL
- `error` TEXT NULL

---

## Notes

- Dedup uses `item_key = guid || link`.
- Output truncation: 700 chars, append ` (truncated)`.
- Daily cap: 300 per guild per day.
- `/set_channel` writes `guilds.channel_id`.
- `/status` reads allowlist status, bound channel, daily usage, provider/language, last poll run.
