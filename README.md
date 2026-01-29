# SJ AI News Discord Bot

A self-hosted, **multi-guild** Discord bot that pulls AI news from a fixed RSS source, translates each item, and posts the translated text to your chosen Discord channel.

- **RSS source (fixed):** https://www.oaibest.com/rss.xml
- **Poll interval (fixed):** every 20 minutes
- **Translation providers:** OpenAI / DeepL / Claude (default: OpenAI)
- **Output language:** configurable in the local dashboard (default: English)
- **Per-guild daily cap:** 300 items
- **Max output length:** 700 chars, appends ` (truncated)` if exceeded
- **Discord commands:** `/set_channel`, `/status` (read-only)
- **Allowlist:** only guilds listed in `ALLOWLIST_GUILD_IDS` are allowed

---

## Table of Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Step-by-step setup (copy/paste)](#step-by-step-setup-copypaste)
  - [1) Create/prepare a Discord application & bot](#1-createprepare-a-discord-application--bot)
  - [2) Invite the bot to your server](#2-invite-the-bot-to-your-server)
  - [3) Run the dashboard + worker via Docker](#3-run-the-dashboard--worker-via-docker)
  - [4) Configure translation in the dashboard](#4-configure-translation-in-the-dashboard)
  - [5) Bind a channel with `/set_channel`](#5-bind-a-channel-with-set_channel)
  - [6) Verify with `/status`](#6-verify-with-status)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [License](#license)

---

## What it does

Once installed in a Discord server (guild), the bot:

1. Polls the RSS feed every 20 minutes.
2. Deduplicates items by `guid`/`link` (stored in SQLite).
3. Translates each item’s text using your selected provider.
4. Posts **only the translated text** into the channel you set via `/set_channel`.

> Note: This v1 intentionally does **not** post source links in Discord messages.

---

## How it works

- A local **web dashboard** runs on your computer (`http://localhost:3000`).
- The dashboard stores config in a local **SQLite** database.
- A background scheduler (in the same container) polls RSS and posts to Discord.
- Discord is configured by **slash commands** (no reading of normal message content).

---

## Requirements

- Docker Desktop (recommended)
- A Discord bot token (for the **public News Bot** you control)
- A translation API key (OpenAI / DeepL / Claude)
- A guild allowlist you control (`ALLOWLIST_GUILD_IDS`)

---

## Step-by-step setup (copy/paste)

### 1) Create/prepare a Discord application & bot

In the Discord Developer Portal:

- Enable **applications.commands** (needed for slash commands)
- Give the bot minimal permissions:
  - View Channels
  - Send Messages
  - Embed Links (optional)

> You do **not** need Message Content Intent because we do not read normal messages.

**Copy/paste checklist**

- Bot token: keep it safe, you will set it as an env var.

---

### 2) Invite the bot to your server

Generate an invite URL using **OAuth2 → URL Generator**:

**Scopes**
- `bot`
- `applications.commands`

**Bot Permissions**
- View Channels
- Send Messages
- (optional) Embed Links

Invite the bot into your guild.

> Important: the bot will only work in guilds listed in `ALLOWLIST_GUILD_IDS`.

---

### 3) Run the dashboard + worker via Docker

#### 3.1 Create `.env`

Copy the example env file and edit it:

```bash
cd SJ-ai-news-discord-bot
cp .env.example .env
```

Open `.env` and set:

- `ADMIN_PASSWORD`
- `DISCORD_BOT_TOKEN`
- `ALLOWLIST_GUILD_IDS`

#### 3.2 Start

```bash
docker compose up -d
```

#### 3.3 Open the dashboard

- Dashboard: http://localhost:3000

Log in using `ADMIN_PASSWORD`.

---

### 4) Configure translation in the dashboard

In the dashboard:

1. Select provider: OpenAI / DeepL / Claude (default OpenAI)
2. Paste your API key
3. Choose output language (default English)
4. Save
5. Use “Test translation” to verify

**Copy/paste (logs)**

```bash
docker compose logs -f
```

---

### 5) Bind a channel with `/set_channel`

In the Discord channel you want the news to be posted into:

- Run `/set_channel`

Rules:
- Only **server administrators** can run `/set_channel`.
- The bot will not post anything until a channel is set.

---

### 6) Verify with `/status`

Run `/status` in any channel.

It returns (ephemeral):
- allowlist status
- whether a channel is bound
- today’s sent count / 300
- provider + output language
- last poll time + last error (if any)

---

## Operations

### Stop

```bash
docker compose down
```

### Update (pull latest image / rebuild)

```bash
docker compose pull
# or if building locally:
docker compose build --no-cache

docker compose up -d
```

### Backups

SQLite lives under `./data/` (docker volume bind).

```bash
ls -la data/
```

Copy `data/app.sqlite` to back it up.

---

## Troubleshooting

### Bot posts nothing

1. Check allowlist: is your guild in `ALLOWLIST_GUILD_IDS`?
2. Run `/status` and confirm a channel is set.
3. Ensure the bot has channel permissions:
   - View Channel
   - Send Messages

### Slash commands don’t show up

- Ensure the bot was invited with **applications.commands** scope.
- Wait a minute (Discord command propagation can lag).

### Translation fails

- Verify your provider key in the dashboard.
- Check container logs:

```bash
docker compose logs -f
```

### Hitting the daily cap

- Per guild max is 300/day. `/status` shows usage.

---

## Security notes

- **Bot token** and **AI API keys** should never be committed to Git.
- This v1 stores AI API keys **in plaintext** in local SQLite (as requested).
- Keep the dashboard local (localhost) and protect it with a strong `ADMIN_PASSWORD`.

---

## License

MIT. See [LICENSE](./LICENSE).

---

# 中文说明（Chinese)

> 英文版在前面，中文版在后面；两者内容一致。

## 这是什么

这是一个自部署（本地 Docker）的 **多服务器（multi-guild）** Discord Bot：

- 每 20 分钟抓取固定 RSS： https://www.oaibest.com/rss.xml
- 对每条内容逐条翻译（OpenAI / DeepL / Claude，默认 OpenAI）
- 只把“翻译后的正文”发送到你用 `/set_channel` 绑定的 Discord 频道
- 每个 guild 每天最多发送 300 条
- 单条输出最多 700 字符，超过则追加 ` (truncated)`
- 仅处理 Slash Command，不读取普通聊天内容

注意：v1 **不发送来源链接**（不包含 `Source:`）。

## 使用前准备

- Docker Desktop
- 你控制的 Discord bot token（News Bot）
- 翻译 API key（OpenAI / DeepL / Claude）
- 允许使用的 Guild ID 白名单（`ALLOWLIST_GUILD_IDS`）

## 一步步安装（可复制粘贴）

### 1）准备 Discord Bot

在 Discord Developer Portal：

- 需要 `applications.commands`（支持 slash command）
- 最小权限：
  - View Channels
  - Send Messages
  - （可选）Embed Links

> 不需要 Message Content Intent（因为不读普通消息）。

### 2）邀请 bot 进入你的服务器

OAuth2 URL Generator：

- Scopes：`bot` + `applications.commands`
- Bot Permissions：View Channels + Send Messages (+ Embed Links)

### 3）用 Docker 启动

```bash
cd SJ-ai-news-discord-bot
cp .env.example .env
```

编辑 `.env`，填写：
- `ADMIN_PASSWORD`
- `DISCORD_BOT_TOKEN`
- `ALLOWLIST_GUILD_IDS`

启动：

```bash
docker compose up -d
```

打开控制台：
- http://localhost:3000

日志：

```bash
docker compose logs -f
```

### 4）在控制台填写翻译配置

- 选择 provider（OpenAI/DeepL/Claude）
- 填 API key
- 选择输出语言（默认英文）
- 保存，并用“Test translation”测试

### 5）在 Discord 里绑定推送频道

在目标频道执行：
- `/set_channel`

仅服务器管理员可执行。

### 6）排错

- 执行 `/status`（只读、ephemeral）查看：
  - 是否在 allowlist
  - 是否已绑定频道
  - 今日已发送条数 / 300
  - 当前 provider/语言
  - 最近一次拉取时间/最近错误

## 运维

停止：

```bash
docker compose down
```

数据在 `./data/app.sqlite`，可直接备份该文件。

## 安全提示

- token / key 不要提交到 Git
- v1 按需求会把 API key 明文存 SQLite（仅本机）
- 请设置强密码 `ADMIN_PASSWORD`，并保持控制台仅本机访问
