import { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, Events } from 'discord.js';
import { nowIso, todayUtcDate } from '../db/db.mjs';

function parseAllowlist() {
  const raw = process.env.ALLOWLIST_GUILD_IDS || '';
  const set = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return set;
}

export function startDiscordBot({ db }) {
  const allowlist = parseAllowlist();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const ready = new Promise((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });

  client.once(Events.ClientReady, async () => {
    console.log(`[discord] logged in as ${client.user.tag}`);

    // Register slash commands for allowlisted guilds (fast propagation).
    const commands = [
      new SlashCommandBuilder().setName('set_channel').setDescription('Bind this channel as the news posting channel (admins only).'),
      new SlashCommandBuilder().setName('pause').setDescription('Pause posting in this server (admins only).'),
      new SlashCommandBuilder().setName('resume').setDescription('Resume posting in this server (admins only).'),
      new SlashCommandBuilder().setName('status').setDescription('Show bot status for this server (read-only).'),
    ].map((c) => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    const appId = client.application?.id;

    if (!appId) {
      console.warn('[discord] warning: cannot resolve application id; slash command registration skipped.');
      return;
    }

    const guildIds = Array.from(allowlist);
    if (guildIds.length === 0) {
      console.warn('[discord] ALLOWLIST_GUILD_IDS is empty; bot will not operate anywhere.');
    }

    for (const gid of guildIds) {
      try {
        await rest.put(Routes.applicationGuildCommands(appId, gid), { body: commands });
        console.log(`[discord] registered commands for guild ${gid}`);
      } catch (e) {
        console.warn(`[discord] failed to register commands for guild ${gid}: ${e?.message || e}`);
      }
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guildId) {
      await safeReply(interaction, 'This bot only works inside a Discord server (guild).', true);
      return;
    }

    const guildId = interaction.guildId;
    const isAllowed = allowlist.has(guildId);

    // Upsert guild row on any interaction.
    upsertGuild(db, { guildId, allowed: isAllowed ? 1 : 0 });

    if (!isAllowed) {
      await safeReply(
        interaction,
        `This server is not allowlisted. Ask the bot owner to add this Guild ID to ALLOWLIST_GUILD_IDS.\n\nGuild ID: ${guildId}`,
        true
      );
      return;
    }

    if (interaction.commandName === 'set_channel') {
      const member = interaction.member;
      // member can be GuildMember or APIInteractionGuildMember
      const perms = member?.permissions;
      const isAdmin = perms && new PermissionsBitField(perms).has(PermissionsBitField.Flags.Administrator);

      if (!isAdmin) {
        await safeReply(interaction, 'Permission denied: only server administrators can run /set_channel.', true);
        return;
      }

      const channelId = interaction.channelId;
      setGuildChannel(db, { guildId, channelId });

      await safeReply(interaction, `✅ Channel bound. I will post news into <#${channelId}> for this server.`, true);
      return;
    }

    if (interaction.commandName === 'pause' || interaction.commandName === 'resume') {
      const member = interaction.member;
      const perms = member?.permissions;
      const isAdmin = perms && new PermissionsBitField(perms).has(PermissionsBitField.Flags.Administrator);

      if (!isAdmin) {
        await safeReply(interaction, `Permission denied: only server administrators can run /${interaction.commandName}.`, true);
        return;
      }

      const enabled = interaction.commandName === 'resume' ? 1 : 0;
      setGuildEnabled(db, { guildId, enabled });

      await safeReply(interaction, enabled ? '✅ Resumed. I will post news again for this server.' : '⏸️ Paused. I will not post news for this server until you /resume.', true);
      return;
    }

    if (interaction.commandName === 'status') {
      const row = getGuild(db, guildId);
      const daily = getDailyCount(db, { guildId, date: todayUtcDate() });
      const globalCfg = getGlobalConfig(db);
      const lastPoll = getLastPollRun(db);

      const lines = [];
      lines.push(`Allowlist: ${isAllowed ? 'allowed' : 'denied'}`);
      lines.push(`Channel: ${row?.channel_id ? `<#${row.channel_id}>` : 'not set (run /set_channel)'}`);
      lines.push(`Enabled: ${row?.enabled ? 'yes' : 'no'}`);
      lines.push(`Daily usage: ${daily}/300`);
      lines.push(`Translator: ${globalCfg ? `${globalCfg.provider} (lang=${globalCfg.output_language})` : 'not configured (set in dashboard)'}`);
      if (lastPoll) {
        lines.push(`Last poll: ${lastPoll.finished_at}${lastPoll.error ? ` (error: ${lastPoll.error})` : ''}`);
      } else {
        lines.push('Last poll: (none yet)');
      }

      await safeReply(interaction, lines.join('\n'), true);
      return;
    }

    await safeReply(interaction, 'Unknown command.', true);
  });

  client.login(process.env.DISCORD_BOT_TOKEN);

  return {
    client,
    ready,
    send: async ({ channelId, content }) => {
      await ready;
      const ch = await client.channels.fetch(channelId);
      if (!ch || !('send' in ch)) throw new Error(`Cannot send to channel ${channelId}`);
      // @ts-ignore
      await ch.send({ content });
    },
  };
}

function upsertGuild(db, { guildId, allowed }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO guilds (guild_id, allowed, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       allowed=excluded.allowed,
       updated_at=excluded.updated_at`
  ).run(guildId, allowed, now, now);
}

function setGuildChannel(db, { guildId, channelId }) {
  const now = nowIso();
  db.prepare(
    `UPDATE guilds SET channel_id=?, updated_at=? WHERE guild_id=?`
  ).run(channelId, now, guildId);
}

function setGuildEnabled(db, { guildId, enabled }) {
  const now = nowIso();
  db.prepare(
    `UPDATE guilds SET enabled=?, updated_at=? WHERE guild_id=?`
  ).run(enabled, now, guildId);
}

function getGuild(db, guildId) {
  return db.prepare(`SELECT * FROM guilds WHERE guild_id=?`).get(guildId);
}

function getDailyCount(db, { guildId, date }) {
  const row = db.prepare(`SELECT sent_count FROM daily_counters WHERE guild_id=? AND date=?`).get(guildId, date);
  return row?.sent_count ?? 0;
}

function getGlobalConfig(db) {
  // v1 simplification: use the most recently updated row as the global config.
  return db
    .prepare(`SELECT provider, output_language FROM secrets ORDER BY updated_at DESC LIMIT 1`)
    .get();
}

function getLastPollRun(db) {
  return db.prepare(`SELECT finished_at, error FROM poll_runs ORDER BY id DESC LIMIT 1`).get();
}

async function safeReply(interaction, content, ephemeral = true) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral });
    } else {
      await interaction.reply({ content, ephemeral });
    }
  } catch (e) {
    console.warn('[discord] reply failed:', e?.message || e);
  }
}
