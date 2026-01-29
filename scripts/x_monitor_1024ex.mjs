#!/usr/bin/env node
/**
 * X monitor for @1024EX
 *
 * Behavior:
 * - hourly: check recent tweets from @1024EX
 * - for tweets older than 24h and not yet processed: fetch replies (paginate)
 * - output a single report to stdout (empty string => no send)
 * - record processed tweetIds to ~/.clawdbot/x-monitor/1024EX.json
 *
 * Notes:
 * - uses `bird` CLI (cookie-auth). Assumes Chrome cookie source is configured in bird.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HANDLE = "1024EX";
const USER_ARG = `@${HANDLE}`;

const MAX_PAGES = Number(process.env.X_REPLIES_MAX_PAGES || 50);
const MIN_AGE_HOURS = Number(process.env.X_MIN_AGE_HOURS || 24);
// Safety cap to avoid processing very old backlog (e.g. first run).
// Override via env X_MAX_AGE_HOURS. Default: 240h (10 days).
const MAX_AGE_HOURS = Number.isFinite(Number(process.env.X_MAX_AGE_HOURS))
  ? Number(process.env.X_MAX_AGE_HOURS)
  : 240;
const TIMELINE_N = Number(process.env.X_TIMELINE_N || 30);
const MAX_TWEETS_PER_RUN = Number(process.env.X_MAX_TWEETS_PER_RUN || 2);
const REPLIES_DELAY_MS = Number(process.env.X_REPLIES_DELAY_MS || 800);

const STATE_DIR = process.env.X_MONITOR_STATE_DIR || path.join(os.homedir(), ".clawdbot", "x-monitor");
const STATE_PATH = process.env.X_MONITOR_STATE_PATH || path.join(STATE_DIR, `${HANDLE}.json`);

function runBird(args, { output = "json" } = {}) {
  // output: "json" | "json-full" | "plain"
  const flags = ["--plain", "--no-color"];
  if (output === "json") flags.push("--json");
  else if (output === "json-full") flags.push("--json-full");

  const fullArgs = [...args, ...flags];
  const res = spawnSync("bird", fullArgs, { encoding: "utf8" });
  return res;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function ensureState() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({ processed: {}, lastRunAt: null }, null, 2) + "\n",
      "utf8"
    );
  }
}

function loadState() {
  ensureState();
  const raw = fs.readFileSync(STATE_PATH, "utf8");
  const j = safeJsonParse(raw) || { processed: {} };
  if (!j.processed) j.processed = {};
  return j;
}

function saveState(state) {
  state.lastRunAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function hoursSince(date) {
  return (Date.now() - date.getTime()) / 36e5;
}

function tweetUrl(tweetId) {
  return `https://x.com/${HANDLE}/status/${tweetId}`;
}

function replyUrl(replyId) {
  // Reply IDs are globally addressable; user handle in URL is cosmetic
  return `https://x.com/i/web/status/${replyId}`;
}

function normText(s) {
  return (s || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractKeywords(text) {
  // Lightweight keyword extraction (English words + simple CJK 2-4 char chunks).
  // Goal: support theme summaries without any model calls.
  const stopEn = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "is",
    "are",
    "be",
    "been",
    "it",
    "this",
    "that",
    "these",
    "those",
    "you",
    "your",
    "we",
    "they",
    "i",
    "im",
    "it's",
    "its",
    "at",
    "as",
    "from",
    "by",
    "not",
    "now",
    "more",
    "less",
    "just",
    "like",
    "nice",
    "great",
    "good",
    "keep",
    "coming",
    "team",
    "listening",
    `@${HANDLE.toLowerCase()}`,
  ]);

  const stopZh = new Set([
    "这个",
    "那个",
    "我们",
    "你们",
    "他们",
    "一个",
    "一下",
    "不是",
    "可以",
    "没有",
    "就是",
    "感觉",
    "真的",
    "还是",
    "因为",
    "所以",
    "但是",
    "然后",
    "如果",
    "怎么",
    "什么",
    "哈哈",
    "谢谢",
    "支持",
    "不错",
  ]);

  const src = (text || "").toLowerCase();
  const freq = new Map();

  // English-ish tokens
  const words = src
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 3)
    .filter((w) => !stopEn.has(w));
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);

  // CJK chunks (2-4 chars) as a cheap approximation of words
  const cjk = (text || "")
    .replace(/https?:\/\/\S+/g, " ")
    .match(/[\u4e00-\u9fff]{2,4}/g);
  if (cjk) {
    for (const t of cjk) {
      if (stopZh.has(t)) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }

  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
}

function classifyStance(text) {
  const t = normText(text);
  const support = [
    "nice",
    "solid",
    "great",
    "good",
    "love",
    "awesome",
    "amazing",
    "well done",
    "keep cooking",
    "keep it",
    "keep them coming",
    "big win",
    "polished",
    "production-ready",
    "intuitive",
    "momentum",
    // zh
    "支持",
    "不错",
    "很好",
    "牛",
    "赞",
    "厉害",
    "期待",
  ];
  const skeptical = [
    "scam",
    "rug",
    "fake",
    "bot",
    "when token",
    "wen token",
    "airdrop",
    "issue",
    "bug",
    "broken",
    "not working",
    "why",
    "concern",
    "risk",
    // zh
    "骗局",
    "骗子",
    "割",
    "割韭菜",
    "假的",
    "假",
    "机器人",
    "刷",
    "空投",
  ];
  if (skeptical.some((k) => t.includes(k))) return "质疑";
  if (support.some((k) => t.includes(k))) return "支持";
  return "中立";
}

function buildThemes(replies) {
  // Lightweight, rule-based themes; avoids hallucination.
  const themes = [
    {
      key: "UX/界面与术语",
      keywords: ["ux", "ui", "copy", "label", "labels", "terminology", "intuitive", "polished", "readable"],
    },
    {
      key: "稳定性/性能/图表",
      keywords: ["stable", "stability", "refresh", "chart", "flow", "real-time", "hiccups", "faster"],
    },
    {
      key: "产品进度/上线期待",
      keywords: ["testnet", "beta", "production", "ready", "momentum", "progress", "shipping"],
    },
    {
      key: "交易体验/摩擦",
      keywords: ["trading", "experience", "friction", "actions", "smoother"],
    },
    {
      key: "其他",
      keywords: [],
    },
  ];

  const buckets = new Map(themes.map((t) => [t.key, []]));

  for (const r of replies) {
    const t = normText(r.text);
    let best = "其他";
    let bestScore = 0;
    for (const th of themes) {
      if (!th.keywords.length) continue;
      let score = 0;
      for (const kw of th.keywords) {
        if (t.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        best = th.key;
      }
    }
    buckets.get(best).push(r);
  }

  // Keep 3-6 themes with content
  const populated = [...buckets.entries()]
    .map(([k, items]) => ({ k, items }))
    .filter((x) => x.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length);

  return populated.slice(0, 6);
}

function pickRepresentative(items, n = 3) {
  // Prefer longer, more contentful replies; avoid duplicates
  const seen = new Set();
  const sorted = [...items].sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0));
  const out = [];
  for (const r of sorted) {
    const nt = normText(r.text);
    if (!nt) continue;
    if (seen.has(nt)) continue;
    seen.add(nt);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

function detectDupes(replies) {
  const map = new Map();
  for (const r of replies) {
    const nt = normText(r.text);
    if (!nt) continue;
    const arr = map.get(nt) || [];
    arr.push(r);
    map.set(nt, arr);
  }
  const dupes = [...map.entries()]
    .filter(([, arr]) => arr.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  return dupes;
}

function engagementStats(replies) {
  const authors = new Set();
  const likes = [];
  const rts = [];
  const quotes = [];

  for (const r of replies) {
    const u = r.author?.username;
    if (u) authors.add(u);
    if (Number.isFinite(r.likeCount)) likes.push(r.likeCount);
    if (Number.isFinite(r.retweetCount)) rts.push(r.retweetCount);
    if (Number.isFinite(r.quoteCount)) quotes.push(r.quoteCount);
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const p50 = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)];
  };

  return {
    uniqueAuthors: authors.size,
    likeAvg: avg(likes),
    likeP50: p50(likes),
    rtAvg: avg(rts),
    quoteAvg: avg(quotes),
  };
}

function lowEffortSignals(replies) {
  // Rough heuristics, only to flag potential bot/template dynamics.
  const praise = ["nice", "great", "good", "awesome", "amazing", "love", "solid", "cool", "based"];
  let shortGeneric = 0;
  let emptyOrLinky = 0;

  for (const r of replies) {
    const t = (r.text || "").trim();
    if (!t) {
      emptyOrLinky++;
      continue;
    }
    const stripped = t.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
    if (!stripped) {
      emptyOrLinky++;
      continue;
    }
    const nt = normText(stripped);
    const isShort = stripped.length <= 20;
    const isPraise = praise.some((k) => nt.includes(k));
    if (isShort && isPraise) shortGeneric++;
  }

  const n = replies.length || 1;
  return {
    shortGeneric,
    shortGenericRatio: shortGeneric / n,
    emptyOrLinky,
    emptyOrLinkyRatio: emptyOrLinky / n,
  };
}

function short(s, max = 240) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function formatReportForTweet(tweet, repliesResult, meta) {
  const { replies, fetchedCount, replyCount, rateLimitNote, nextCursor } = repliesResult;

  const legacy = tweet?._full?.legacy || {};
  const viewsObj = tweet?._full?.views || null;
  const viewsCount = viewsObj?.count ?? null;
  const viewsState = viewsObj?.state ?? null;

  const interaction = {
    reply: legacy.reply_count ?? tweet.replyCount ?? null,
    retweet: legacy.retweet_count ?? tweet.retweetCount ?? null,
    quote: legacy.quote_count ?? tweet.quoteCount ?? null,
    like: legacy.favorite_count ?? tweet.likeCount ?? null,
    bookmark: legacy.bookmark_count ?? tweet.bookmarkCount ?? null,
    views: viewsCount,
  };

  const stances = { 支持: 0, 质疑: 0, 中立: 0 };
  for (const r of replies) stances[classifyStance(r.text)]++;

  const coverage = replyCount != null && replyCount > 0 ? Math.min(1, fetchedCount / replyCount) : null;

  const keywords = extractKeywords(replies.map((r) => r.text).join("\n"));
  const themes = buildThemes(replies);
  const dupes = detectDupes(replies);
  const eng = engagementStats(replies);
  const le = lowEffortSignals(replies);

  const tlDr = (() => {
    if (fetchedCount === 0) return "TL;DR：该帖 24h 后可见回复很少/抓取为空（可能限流或互动低）。";
    const topTheme = themes[0]?.k;
    const tone = stances.支持 >= stances.质疑 * 3 ? "整体偏支持" : stances.质疑 > stances.支持 ? "质疑声更明显" : "观点较混合";
    return `TL;DR：抓取到 ${fetchedCount} 条回复，${tone}${topTheme ? `，主题集中在「${topTheme}」相关` : ""}。`;
  })();

  const lines = [];
  lines.push(`【@${HANDLE}｜24h 评论抓取与分析】`);
  lines.push(tlDr);
  lines.push("");

  lines.push(`原帖：${tweetUrl(tweet.id)}`);
  lines.push(`时间：${tweet.createdAt}（约 ${hoursSince(new Date(tweet.createdAt)).toFixed(1)}h 前）`);
  lines.push(`原帖摘要：${short(tweet.text, 280)}`);
  lines.push("");

  lines.push("互动概览（X 指标，含 views）：");
  lines.push(`- 回复数：${interaction.reply ?? "?"}`);
  lines.push(`- 转发数：${interaction.retweet ?? "?"}`);
  lines.push(`- 引用数：${interaction.quote ?? "?"}`);
  lines.push(`- 点赞数：${interaction.like ?? "?"}`);
  lines.push(`- 书签数：${interaction.bookmark ?? "?"}`);
  if (interaction.views != null) {
    lines.push(`- 浏览量 views：${interaction.views}${viewsState ? `（${viewsState}）` : ""}`);
  } else {
    lines.push(`- 浏览量 views：无法获取（原因：bird read --json-full 未返回 views.count；可能该帖 views 未开启/权限不足）`);
  }
  lines.push("");

  lines.push(`一、评论规模与参与度`);
  lines.push(`- X 显示回复数：${replyCount ?? "未知"}`);
  lines.push(
    `- 实际抓取：${fetchedCount}（bird replies --all；maxPages=${meta.maxPages}${meta.delayMs != null ? `；delayMs=${meta.delayMs}` : ""}）` +
      (nextCursor ? "；注意：存在 nextCursor，可能还有更多回复（达到 maxPages 或分页受阻/限流）。" : "") +
      (rateLimitNote ? `；注意：${rateLimitNote}` : "")
  );
  lines.push(`- 覆盖率（估算）：${coverage == null ? "无法估算" : `${(coverage * 100).toFixed(1)}%`}`);
  lines.push(`- 参与账号数（unique authors）：${eng.uniqueAuthors}`);
  if (eng.likeAvg != null || eng.likeP50 != null) {
    lines.push(
      `- 抓取样本的互动（仅样本统计）：like 平均=${eng.likeAvg == null ? "?" : eng.likeAvg.toFixed(2)} · like 中位数=${
        eng.likeP50 == null ? "?" : eng.likeP50
      }` +
        `${eng.rtAvg == null ? "" : ` · rt 平均=${eng.rtAvg.toFixed(2)}`}` +
        `${eng.quoteAvg == null ? "" : ` · quote 平均=${eng.quoteAvg.toFixed(2)}`}`
    );
  }
  lines.push("");

  lines.push(`二、观点分布（基于抓取文本的粗分类）`);
  lines.push(`- 支持：${stances.支持}`);
  lines.push(`- 质疑：${stances.质疑}`);
  lines.push(`- 中立：${stances.中立}`);
  lines.push("");

  // Reasons: quote actual comments as evidence.
  const supportExamples = pickRepresentative(replies.filter((r) => classifyStance(r.text) === "支持"), 3);
  const skepticExamples = pickRepresentative(replies.filter((r) => classifyStance(r.text) === "质疑"), 3);

  if (supportExamples.length) {
    lines.push(`支持侧主要理由（2-4 条；引用原文作为证据）`);
    for (const r of supportExamples) {
      lines.push(`- “${short(r.text, 220)}” — @${r.author?.username || "?"} ${replyUrl(r.id)}`);
    }
    lines.push("");
  } else {
    lines.push(`支持侧主要理由：样本不足（抓取样本中未明显出现支持型表述）。`);
    lines.push("");
  }

  if (skepticExamples.length) {
    lines.push(`质疑侧主要理由（2-4 条；引用原文作为证据）`);
    for (const r of skepticExamples) {
      lines.push(`- “${short(r.text, 220)}” — @${r.author?.username || "?"} ${replyUrl(r.id)}`);
    }
    lines.push("");
  } else {
    lines.push(`质疑侧主要理由：样本不足（抓取样本中未明显出现质疑型表述）。`);
    lines.push("");
  }

  lines.push(`三、主题聚类（3-6 类；每类 2-3 条代表性评论）`);
  for (const th of themes) {
    const reps = pickRepresentative(th.items, 3);
    const kw = extractKeywords(th.items.map((r) => r.text).join("\n")).slice(0, 6).map(([w]) => w);
    lines.push(`- 主题：${th.k}（n=${th.items.length}）`);
    if (kw.length) lines.push(`  关键词：${kw.join(", ")}`);
    for (const r of reps) {
      lines.push(`  - “${short(r.text, 200)}” — @${r.author?.username || "?"} ${replyUrl(r.id)}`);
    }
  }
  lines.push("");

  lines.push(`四、可执行结论（基于以上评论内容的可行动建议）`);
  // derive recommendations from themes + keywords
  const recs = [];
  const add = (p, t) => recs.push({ p, t });

  if (themes.some((t) => t.k.includes("UX"))) {
    add("高", "把‘copy/labels/terminology’这类改动做成对外可复用的变更日志模板（每周固定格式），持续强化“在听用户”的叙事。");
  }
  if (themes.some((t) => t.k.includes("稳定"))) {
    add("高", "针对‘chart refresh / real-time flow’之类敏感点，加一个公开的性能/稳定性指标页或里程碑（哪怕是简版），让赞美更可持续、更可引用。");
  }
  if (themes.some((t) => t.k.includes("产品进度"))) {
    add("中", "在更新帖末尾加一个“下一步（1-2 周）”的小节，引导用户期待与可参与的反馈点（把反馈问题写得具体）。");
  }
  if (themes.some((t) => t.k.includes("交易"))) {
    add("中", "把‘减少 friction’的点做成 30 秒短视频/动图前后对比；评论区的“更顺滑/更直观”可做引用素材。");
  }

  // 保底：确保至少 3 条（避免只有 1 条建议）。
  if (recs.length < 3) {
    add("中", "挑选 2-3 条高质量评论置顶/引用回复（感谢 + 追问一个可执行细节），把评论区变成“用户共创”证据。");
    add("中", "对低互动主题增加明确 CTA：例如‘你觉得最需要改的是 A/B/C？’或‘回复一个你最想交易的市场/标的’。");
    add("低", "把评论里出现的高频词/疑问整理成 FAQ 小卡片（下一条同类推文附上），减少重复解释成本。");
  }

  // 去重（同文案/同优先级的重复）
  const seenRec = new Set();
  const recsDedup = [];
  for (const r of recs) {
    const k = `${r.p}:${r.t}`;
    if (seenRec.has(k)) continue;
    seenRec.add(k);
    recsDedup.push(r);
  }

  for (const r of recsDedup.slice(0, 7)) lines.push(`- [${r.p}] ${r.t}`);
  lines.push("");

  lines.push(`五、风险与疑点（机器人/模板化迹象）`);
  const dupTotal = dupes.reduce((acc, [, arr]) => acc + arr.length, 0);
  const dupRatio = replies.length ? dupTotal / replies.length : 0;

  // 先给量化信号，再给证据。
  lines.push(
    `- 低信息量短评（<=20 字且偏泛化夸赞）占比：${(le.shortGenericRatio * 100).toFixed(1)}%（${le.shortGeneric}/${replies.length}）`
  );
  lines.push(`- 空白/仅链接/仅表情（粗略）占比：${(le.emptyOrLinkyRatio * 100).toFixed(1)}%（${le.emptyOrLinky}/${replies.length}）`);
  lines.push(`- 重复文本覆盖（同句多账号复读的总量占比，粗估）：${(dupRatio * 100).toFixed(1)}%（${dupTotal}/${replies.length}）`);

  if (!dupes.length) {
    lines.push("- 未发现明显的重复模板评论（基于抓取样本）。");
  } else {
    lines.push(`- 发现 ${dupes.length} 组“高度重复文本”评论，疑似模板化/刷评（证据：同一句话被不同账号重复发出）：`);
    for (const [text, arr] of dupes.slice(0, 5)) {
      const who = arr
        .slice(0, 4)
        .map((r) => `@${r.author?.username || "?"}(${replyUrl(r.id)})`)
        .join(" · ");
      lines.push(`  - “${short(text, 160)}” ×${arr.length}：${who}${arr.length > 4 ? " …" : ""}`);
    }
  }
  lines.push("");

  if (keywords.length) {
    lines.push("附：高频词（去停用词后的粗统计）");
    lines.push(
      keywords
        .slice(0, 12)
        .map(([w, c]) => `${w}(${c})`)
        .join(" · ")
    );
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  const state = loadState();

  // Quick auth check: whoami (bird whoami doesn't always support --json)
  const who = runBird(["whoami"], { output: "plain" });
  if (who.status !== 0) {
    const stderr = (who.stderr || "").trim();
    const hint = "请确认已在 Chrome 登录 x.com，然后运行：bird whoami（必要时：bird query-ids --fresh）。";
    const msg = [
      "【@1024EX 监控】失败：bird 认证/接口异常（whoami）。",
      hint,
      stderr ? `stderr(head)：${stderr.slice(0, 600)}${stderr.length > 600 ? "…" : ""}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    process.stdout.write(msg);
    return;
  }

  // Fetch recent tweets from user timeline
  const tl = runBird(["user-tweets", USER_ARG, "-n", String(TIMELINE_N)]);
  if (tl.status !== 0) {
    const stderr = (tl.stderr || "").trim();
    const msg = [
      "【@1024EX 监控】失败：读取用户时间线失败（bird user-tweets）。",
      "建议：先运行 bird whoami；如已登录但仍失败，可能 X 限流/QueryID 过期（可试 bird query-ids --fresh）。",
      stderr ? `stderr(head)：${stderr.slice(0, 600)}${stderr.length > 600 ? "…" : ""}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    process.stdout.write(msg);
    return;
  }

  const tlJson = safeJsonParse(tl.stdout);
  const tweets = Array.isArray(tlJson)
    ? tlJson
    : Array.isArray(tlJson?.tweets)
      ? tlJson.tweets
      : null;

  if (!tweets) {
    process.stdout.write(
      "【@1024EX 监控】解析 user-tweets JSON 失败；可能是 bird 输出格式变化或被限流。\n" +
        "\n--- raw stdout (head) ---\n" +
        tl.stdout.slice(0, 2000)
    );
    return;
  }

  // Eligible tweets: >= 24h old and not processed
  const eligible = tweets
    .filter((t) => t?.id && t?.createdAt)
    .map((t) => ({ ...t, createdAtDate: new Date(t.createdAt) }))
    .filter((t) => !Number.isNaN(t.createdAtDate.getTime()))
    .filter((t) => {
      const h = hoursSince(t.createdAtDate);
      if (h < MIN_AGE_HOURS) return false;
      if (MAX_AGE_HOURS != null && Number.isFinite(MAX_AGE_HOURS) && h > MAX_AGE_HOURS) return false;
      return true;
    })
    .filter((t) => !state.processed[t.id]);

  if (eligible.length === 0) {
    // No output => cron wrapper will not send
    return;
  }

  // Process the oldest first (more stable)
  eligible.sort((a, b) => a.createdAtDate.getTime() - b.createdAtDate.getTime());

  const reports = [];

  for (const tweet of eligible.slice(0, Math.max(1, MAX_TWEETS_PER_RUN))) {
    const replies = [];
    let rateLimitNote = "";

    // Fetch full tweet object so we can report views/quotes/bookmarks (required).
    const read = runBird(["read", tweet.id], { output: "json-full" });
    if (read.status !== 0) {
      const stderr = (read.stderr || "").trim();
      const msg = [
        `【@${HANDLE} 监控】失败：读取原帖详情失败（bird read）：${tweetUrl(tweet.id)}`,
        "可能原因：X 限流 / 登录态失效 / QueryID 过期。",
        "建议：在 Chrome 重新登录 x.com 后运行 bird whoami；必要时 bird query-ids --fresh。",
        stderr ? `stderr(head)：${stderr.slice(0, 600)}${stderr.length > 600 ? "…" : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      process.stdout.write(msg);
      return;
    }

    const readJson = safeJsonParse(read.stdout);
    if (!readJson || !readJson._raw) {
      const msg = [
        `【@${HANDLE} 监控】解析 read JSON 失败：${tweetUrl(tweet.id)}`,
        "\n--- raw stdout (head) ---\n" + (read.stdout || "").slice(0, 2000),
      ].join("\n");
      process.stdout.write(msg);
      return;
    }

    const tweetFull = {
      ...tweet,
      // bird --json-full puts raw tweet object under _raw
      _full: {
        views: readJson._raw?.views || null,
        legacy: readJson._raw?.legacy || null,
      },
    };

    const rep = runBird([
      "replies",
      tweet.id,
      "--all",
      "--max-pages",
      String(MAX_PAGES),
      "--delay",
      String(REPLIES_DELAY_MS),
    ]);
    if (rep.status !== 0) {
      const stderr = (rep.stderr || "").trim();
      const msg = [
        `【@${HANDLE} 监控】失败：抓取回复失败（bird replies）：${tweetUrl(tweet.id)}`,
        "可能原因：X 限流 / 登录态失效 / QueryID 过期。",
        "建议：在 Chrome 重新登录 x.com 后运行 bird whoami；必要时 bird query-ids --fresh。",
        stderr ? `stderr(head)：${stderr.slice(0, 600)}${stderr.length > 600 ? "…" : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      process.stdout.write(msg);
      return;
    }

    const j = safeJsonParse(rep.stdout);
    if (!j || !Array.isArray(j.tweets)) {
      const msg = [
        `【@${HANDLE} 监控】解析 replies JSON 失败：${tweetUrl(tweet.id)}`,
        "\n--- raw stdout (head) ---\n" + rep.stdout.slice(0, 2000),
      ].join("\n");
      process.stdout.write(msg);
      return;
    }

    replies.push(...j.tweets);

    // De-dupe & remove the root tweet if bird includes it.
    {
      const uniq = new Map();
      for (const r of replies) {
        if (!r?.id) continue;
        if (r.id === tweet.id) continue;
        if (!uniq.has(r.id)) uniq.set(r.id, r);
      }
      replies.length = 0;
      replies.push(...uniq.values());
    }

    // Heuristic: if nextCursor exists but tweets empty => likely rate limit/blocked paging
    if (j.nextCursor && j.tweets.length === 0) {
      rateLimitNote = "存在 nextCursor 但本页为空，疑似被限流/分页受阻；未能继续翻页。";
    }

    const report = formatReportForTweet(
      tweetFull,
      {
        replies,
        fetchedCount: replies.length,
        replyCount: tweetFull._full?.legacy?.reply_count ?? tweet.replyCount ?? null,
        rateLimitNote,
        nextCursor: j.nextCursor ?? null,
      },
      { maxPages: MAX_PAGES, delayMs: REPLIES_DELAY_MS }
    );

    reports.push(report);
    state.processed[tweet.id] = {
      processedAt: new Date().toISOString(),
      createdAt: tweetFull.createdAt,
      replyCount: tweetFull._full?.legacy?.reply_count ?? tweetFull.replyCount ?? null,
      fetched: replies.length,
      url: tweetUrl(tweet.id),
      views: tweetFull._full?.views?.count ?? null,
      quoteCount: tweetFull._full?.legacy?.quote_count ?? null,
      bookmarkCount: tweetFull._full?.legacy?.bookmark_count ?? null,
    };
  }

  saveState(state);

  process.stdout.write(reports.join("\n\n" + "=".repeat(40) + "\n\n"));
}

main();
