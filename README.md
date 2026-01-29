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
- [More troubleshooting](#more-troubleshooting)
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

You will do this in the **Discord Developer Portal**:

- Open: https://discord.com/developers/applications
- Click **New Application** → name it (e.g. `News Bot`) → **Create**

#### 1.1 Create the bot user + copy the token

1) Left sidebar → **Bot**
2) Click **Add Bot** → confirm
3) Under **Token** → click **Reset Token** → copy the token

> Keep this token secret. You will set it in `.env` as `DISCORD_BOT_TOKEN`.

#### 1.2 Enable what you need (and avoid what you don’t)

We only use **slash commands** and outbound sending.

- ✅ We DO need: **applications.commands** (slash commands)
- ✅ We DO need to be able to **send messages** to a channel
- ❌ We do NOT need to read normal message content

So in **Bot → Privileged Gateway Intents**:
- **Message Content Intent**: **OFF** (not needed)
- **Server Members Intent**: **OFF** (not needed)
- **Presence Intent**: **OFF**

Why?
- We only receive **slash command interactions** and send outbound messages.
- We do **not** parse or read user chat messages, so Message Content intent is unnecessary.

#### 1.3 Recommended server permissions (minimum)

When inviting the bot to a server, grant:
- ✅ View Channels
- ✅ Send Messages
- ✅ Read Message History (optional, but helpful for troubleshooting)
- ✅ Embed Links (optional)

---

### Copy/paste checklist

- [ ] Bot token copied
- [ ] Intents left OFF (Message Content / Members / Presence)
- [ ] You know the target guild ID(s) for `ALLOWLIST_GUILD_IDS`

---

### 2) Invite the bot to your server

In the Discord Developer Portal:

1) Left sidebar → **OAuth2** → **URL Generator**

#### 2.1 Scopes

Check:
- ✅ `bot`
- ✅ `applications.commands`

> `applications.commands` is required for `/set_channel` and `/status`.

#### 2.2 Bot permissions

Select the minimum permissions:
- ✅ View Channels
- ✅ Send Messages
- ✅ Read Message History (optional)
- ✅ Embed Links (optional)

#### 2.3 Generate invite URL

- Copy the generated URL at the bottom
- Open it in your browser
- Choose the target server (guild) → **Authorize**

> Important: the bot will only operate in guilds listed in `ALLOWLIST_GUILD_IDS`.

#### 2.4 Get the Guild ID (for allowlist)

On Discord (desktop):
1) User Settings → Advanced → enable **Developer Mode**
2) Right-click your server name → **Copy Server ID**
3) Put it into `.env` as `ALLOWLIST_GUILD_IDS=<guildId>`

Copy/paste example:

```bash
# Example (replace with your server id)
ALLOWLIST_GUILD_IDS=1437322703358136405
```

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

Quick checks:
- Run `/status` (ephemeral) to confirm allowlist + channel binding + last error.
- Check container logs:

```bash
docker compose logs -f
```

## More troubleshooting

See: [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)

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

在 **Discord Developer Portal** 操作：

- 打开：https://discord.com/developers/applications
- 点 **New Application** → 填名字（例如 `News Bot`）→ **Create**

#### 1.1 创建 Bot 并复制 Token

1) 左侧 **Bot**
2) 点 **Add Bot** → 确认
3) 在 **Token** 区域点 **Reset Token** → 复制 token

> token 只会显示一次，请妥善保存。稍后写入 `.env` 的 `DISCORD_BOT_TOKEN`。

#### 1.2 Intents（建议全部关闭）

本项目只用 **Slash Command + 发消息**，不读普通消息内容。

在 **Bot → Privileged Gateway Intents**：
- Message Content Intent：**关闭**（不需要）
- Server Members Intent：**关闭**（不需要）
- Presence Intent：**关闭**（不需要）

#### 1.3 邀请时的最小权限

邀请 bot 进服务器时建议授予：
- ✅ View Channels
- ✅ Send Messages
- （可选）Read Message History
- （可选）Embed Links

---

### 快速检查清单（可复制粘贴）

- [ ] 已复制 bot token
- [ ] Intents 保持关闭（Message Content / Members / Presence）
- [ ] 已准备好要写入 `ALLOWLIST_GUILD_IDS` 的服务器 ID

### 2）邀请 bot 进入你的服务器

在 Discord Developer Portal：

1) 左侧 **OAuth2** → **URL Generator**

#### 2.1 Scopes

勾选：
- ✅ `bot`
- ✅ `applications.commands`

> `applications.commands` 是 `/set_channel` 和 `/status` 必需的。

#### 2.2 Bot Permissions

建议最小权限：
- ✅ View Channels
- ✅ Send Messages
- （可选）Read Message History
- （可选）Embed Links

#### 2.3 生成并打开邀请链接

- 复制页面底部生成的 URL
- 用浏览器打开 → 选择你的服务器 → Authorize

#### 2.4 获取 Server ID（用于白名单）

Discord 桌面端：
1) 用户设置 → 高级 → 打开 **开发者模式**
2) 右键你的服务器名 → **复制服务器 ID**
3) 写入 `.env`：

```bash
ALLOWLIST_GUILD_IDS=1437322703358136405
```

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
