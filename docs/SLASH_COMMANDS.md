# Slash Commands (v1)

## `/set_channel`

**Purpose:** bind the current channel as the posting target for this guild.

- Permission: **server administrators only**
- Behavior:
  - If guild is not in allowlist → ephemeral error
  - Save `channel_id` for this `guild_id` in SQLite
  - Reply ephemeral: success message

## `/status` (read-only)

**Purpose:** diagnostic status output.

- Permission: anyone (read-only) or admins only (your call in code; v1 suggested: anyone)
- Reply: ephemeral
  - allowlist: allowed/denied
  - channel binding: channel_id or "not set"
  - daily usage: sent_count / 300
  - translation: provider + output language
  - RSS: last poll time + last error
