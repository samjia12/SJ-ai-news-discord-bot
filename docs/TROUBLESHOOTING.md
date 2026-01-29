# Troubleshooting (v1)

This guide covers common setup issues for **Docker + Discord slash commands**.

> Tip: Start with `/status` (ephemeral) to see allowlist status, channel binding, daily usage, and the last error.

---

## 1) `/set_channel` / `/status` doesn’t appear in Discord

### Symptoms
- You type `/set_channel` but nothing shows up.
- Discord autocomplete doesn’t list the commands.

### Causes & fixes
1) **Missing `applications.commands` scope in the invite URL**
   - Developer Portal → OAuth2 → URL Generator
   - Scopes: ✅ `bot`, ✅ `applications.commands`
   - Re-invite the bot (kick + re-invite if needed)

2) **Discord propagation delay**
   - Wait 30–120 seconds.

3) **Bot token mismatch**
   - The running container uses a different `DISCORD_BOT_TOKEN` than the bot you invited.
   - Fix:
     ```bash
     docker compose down
     docker compose up -d
     ```

---

## 2) `/set_channel` says “permission denied”

### Expected behavior
v1 only allows **server administrators** to run `/set_channel`.

### Fix
- Run `/set_channel` using an account with Administrator permission.

---

## 3) Bot posts nothing (silent)

### Checklist
1) Run `/status`
   - If **not allowlisted** → it will never post.
   - If **channel not set** → run `/set_channel` in the target channel.

2) Confirm your guild is allowlisted

- `.env` example:
  ```bash
  ALLOWLIST_GUILD_IDS=1437322703358136405
  ```

- Restart after changing `.env`:
  ```bash
  docker compose down
  docker compose up -d
  ```

3) Check bot permissions in the target channel
- View Channel
- Send Messages

---

## 4) Bot is in the server but can’t send messages

### Causes
- Missing permissions at channel level (overrides)
- Bot role is below another role that restricts it

### Fix
- In the target channel: Edit Channel → Permissions → ensure the bot (or its role) has:
  - View Channel
  - Send Messages

---

## 5) Translation fails (OpenAI / DeepL / Claude)

### Fix
- Verify you set the provider key in the dashboard.
- Confirm the key has quota / is valid.
- Check logs:
  ```bash
  docker compose logs -f
  ```

---

## 6) RSS fetch fails

### Fix
- Check your internet connection.
- Verify the RSS URL is reachable.
- Check logs:
  ```bash
  docker compose logs -f
  ```

---

## 7) Hitting the daily cap

- The bot stops posting after **300 items/day per guild**.
- The cap resets by date.

---

## 8) The dashboard won’t open

### Fix
- Check container status:
  ```bash
  docker compose ps
  ```
- View logs:
  ```bash
  docker compose logs -f
  ```
- If port 3000 is in use, change `PORT` in `.env` and restart.

---

## 9) I changed `.env` but nothing happens

Docker only reads `.env` at container start.

```bash
docker compose down
docker compose up -d
```

---

# 中文排错（v1）

> 建议：先跑 `/status`（只读/ephemeral）看 allowlist、是否绑定频道、今日用量、最后一次错误。

---

## 1）Discord 里看不到 `/set_channel` / `/status`

常见原因：
1) 邀请链接缺少 `applications.commands` scope
   - Developer Portal → OAuth2 → URL Generator
   - Scopes 勾选：✅ `bot` + ✅ `applications.commands`
   - 重新邀请（必要时踢掉再邀请）

2) Discord 同步需要一点时间
   - 等 30–120 秒

3) `.env` 里的 token 和你邀请进服务器的 bot 不是同一个
   - 修改 `.env` 后重启容器：
     ```bash
     docker compose down
     docker compose up -d
     ```

---

## 2）`/set_channel` 提示无权限

v1 设计：仅允许“服务器管理员”执行。

---

## 3）Bot 没有任何推送

排查顺序：
1) `/status` 看是否 allowlist 通过
2) `/status` 看是否已绑定频道（没绑定就去目标频道跑 `/set_channel`）
3) 检查 `.env` 的 `ALLOWLIST_GUILD_IDS` 是否包含该服务器 ID，并重启容器
4) 检查目标频道权限：View Channel + Send Messages

---

## 4）Bot 在服务器里但发不出消息

原因通常是：频道权限覆盖/角色层级。

解决：在目标频道权限里给 bot（或 bot 角色）开：
- View Channel
- Send Messages

---

## 5）翻译失败（OpenAI/DeepL/Claude）

- 确认控制台里已选择 provider 并填写 key
- 看日志：
  ```bash
  docker compose logs -f
  ```

---

## 6）RSS 拉取失败

- 检查网络
- 看日志：
  ```bash
  docker compose logs -f
  ```

---

## 7）达到每日上限

- 每个 guild 每天最多 300 条，第二天自动重置。

---

## 8）控制台打不开

- 看容器状态：
  ```bash
  docker compose ps
  ```
- 看日志：
  ```bash
  docker compose logs -f
  ```
- 若 3000 端口冲突，改 `.env` 里的 `PORT` 后重启

---

## 9）改了 `.env` 但没生效

改完 `.env` 一定要重启：
```bash
docker compose down
docker compose up -d
```
