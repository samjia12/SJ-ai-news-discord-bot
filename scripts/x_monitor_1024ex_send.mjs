#!/usr/bin/env node
/**
 * Wrapper runner for @1024EX monitor:
 * - runs scripts/x_monitor_1024ex.mjs with env (X_REPLIES_MAX_PAGES, etc.)
 * - if stdout is empty => do nothing
 * - else split into <=3500 chars and send to Telegram (DM + group)
 *
 * Usage:
 *   node scripts/x_monitor_1024ex_send.mjs
 *   X_REPLIES_MAX_PAGES=50 node scripts/x_monitor_1024ex_send.mjs
 *   node scripts/x_monitor_1024ex_send.mjs --dry-run
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const TELEGRAM_DM = process.env.TG_DM || "412432207";
const TELEGRAM_GROUP = process.env.TG_GROUP || "-5289849700";
const MAX_CHARS = Number(process.env.TG_MAX_CHARS || 3500);

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run") || argv.includes("-n");

function splitSmart(text, maxChars) {
  const t = String(text || "");
  if (t.length <= maxChars) return [t];

  const chunks = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + maxChars);
    let cut = end;

    // Prefer splitting on newline within the last ~200 chars of the window.
    const window = t.slice(i, end);
    const lastNl = window.lastIndexOf("\n");
    if (lastNl > Math.max(0, window.length - 200)) {
      cut = i + lastNl + 1;
    } else {
      // Otherwise, try the last space.
      const lastSp = window.lastIndexOf(" ");
      if (lastSp > Math.max(0, window.length - 120)) cut = i + lastSp + 1;
    }

    if (cut <= i) cut = end;
    chunks.push(t.slice(i, cut));
    i = cut;
  }

  return chunks.map((c) => c.trim()).filter(Boolean);
}

function runNodeScript() {
  const scriptPath = path.join(process.cwd(), "scripts", "x_monitor_1024ex.mjs");
  const env = {
    ...process.env,
    X_REPLIES_MAX_PAGES: process.env.X_REPLIES_MAX_PAGES || "50",
  };

  const res = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env,
    maxBuffer: 50 * 1024 * 1024,
  });

  // If the script itself crashed, surface a short error as “content to send”.
  if (res.status !== 0) {
    const stderr = (res.stderr || "").trim();
    const stdout = (res.stdout || "").trim();
    const msg = [
      "【@1024EX 监控】失败：脚本执行异常（node exit != 0）",
      `exitCode=${res.status}`,
      stdout ? `stdout(head):\n${stdout.slice(0, 800)}${stdout.length > 800 ? "…" : ""}` : null,
      stderr ? `stderr(head):\n${stderr.slice(0, 800)}${stderr.length > 800 ? "…" : ""}` : null,
      "建议：确认 bird 登录态（Chrome 已登录 x.com），并运行 bird whoami 检查。",
    ]
      .filter(Boolean)
      .join("\n");

    return { ok: false, text: msg };
  }

  return { ok: true, text: res.stdout || "" };
}

function sendTelegram(target, message) {
  const res = spawnSync(
    "clawdbot",
    [
      "message",
      "send",
      "--channel",
      "telegram",
      "--target",
      String(target),
      "--message",
      message,
    ],
    { encoding: "utf8" }
  );

  return res;
}

function main() {
  const { text } = runNodeScript();
  const body = String(text || "");

  if (!body.trim()) {
    // stdout empty: do nothing
    return;
  }

  const parts = splitSmart(body, MAX_CHARS);
  const n = parts.length;

  if (DRY_RUN) {
    process.stdout.write(`DRY_RUN: would send ${n} part(s) to Telegram ${TELEGRAM_DM} + ${TELEGRAM_GROUP}\n`);
    parts.forEach((p, idx) => {
      process.stdout.write(`\n(${idx + 1}/${n})\n`);
      process.stdout.write(p);
      process.stdout.write("\n");
    });
    return;
  }

  for (let idx = 0; idx < parts.length; idx++) {
    const prefix = `(${idx + 1}/${n}) `;
    const msg = prefix + parts[idx];

    const dm = sendTelegram(TELEGRAM_DM, msg);
    if (dm.status !== 0) {
      process.stderr.write(`Telegram DM send failed (exit=${dm.status})\n`);
      process.stderr.write((dm.stderr || dm.stdout || "").slice(0, 2000));
      process.exit(2);
    }

    const group = sendTelegram(TELEGRAM_GROUP, msg);
    if (group.status !== 0) {
      process.stderr.write(`Telegram group send failed (exit=${group.status})\n`);
      process.stderr.write((group.stderr || group.stdout || "").slice(0, 2000));
      process.exit(3);
    }
  }
}

main();
