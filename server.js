import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = __dirname;
const publicDir = path.join(workspaceRoot, "web");
const dataDir = path.join(workspaceRoot, "data");
const hostedDeployment = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
const defaultSourceDir = path.join(workspaceRoot, "Metalslime");
const runtimeSourceDir = process.env.YINUO_RUNTIME_SOURCE_DIR || process.env.METALSLIME_RUNTIME_SOURCE_DIR
  ? path.resolve(process.env.YINUO_RUNTIME_SOURCE_DIR || process.env.METALSLIME_RUNTIME_SOURCE_DIR)
  : hostedDeployment
    ? ""
    : path.join(dataDir, "runtime-corpus");
const profilePath = path.join(workspaceRoot, "metalslime_views.md");
const promptPath = path.join(workspaceRoot, "metalslime_investment_agent.md");
const indexPath = path.join(dataDir, "yinuo-index.json");
const settingsPath = path.join(dataDir, "settings.json");
const port = Number(process.env.PORT || 3000);
const sessionCookieName = "yinuo_session";

const topicRules = [
  {
    label: "energy",
    keywords: [
      "\u65b0\u80fd\u6e90",
      "\u50a8\u80fd",
      "\u9502",
      "\u9502\u77ff",
      "\u5149\u4f0f",
      "\u7535\u6c60",
      "\u5b81\u5fb7",
      "\u987a\u4ef7",
      "LIFSI",
      "\u6db2\u51b7",
      "\u94dc\u4ee3\u94f6"
    ]
  },
  {
    label: "consumer",
    keywords: [
      "\u6d88\u8d39",
      "\u767d\u9152",
      "\u8305\u53f0",
      "\u540d\u9152",
      "\u6f6e\u73a9",
      "\u91d1\u9970",
      "\u8336\u996e",
      "\u5185\u9700",
      "\u4eba\u53e3"
    ]
  },
  {
    label: "tire",
    keywords: [
      "\u8f6e\u80ce",
      "\u5de8\u80ce",
      "\u5168\u94a2\u80ce",
      "\u7ffb\u65b0",
      "\u8d5b\u8f6e",
      "\u666e\u5229\u53f8\u901a",
      "\u7c73\u5176\u6797"
    ]
  },
  {
    label: "tech",
    keywords: [
      "\u6e38\u620f",
      "AI",
      "\u7b97\u529b",
      "CPO",
      "PCB",
      "\u5f02\u73af",
      "\u4e8c\u6e38",
      "\u79d1\u6280"
    ]
  },
  {
    label: "trading",
    keywords: [
      "\u4ed3\u4f4d",
      "\u53cd\u5f39",
      "\u51cf\u4ed3",
      "\u8d5a\u94b1\u6548\u5e94",
      "\u8d1d\u5854",
      "alpha",
      "\u4f30\u503c",
      "\u98ce\u9669\u504f\u597d"
    ]
  }
];

let state = {
  sourceDir: defaultSourceDir,
  sourceDirs: [],
  runtimeSourceDir,
  profile: "",
  agentPrompt: "",
  documents: [],
  lastBuiltAt: null,
  stats: null,
  settings: {
    provider: "gemini",
    apiKey: "",
    model: process.env.GEMINI_MODEL || "gemini-3.1-pro-preview",
    username: "admin",
    passwordHash: "",
    loginKey: ""
  }
};
const sessions = new Map();

await initialize();

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      if (!isPublicApiRoute(requestUrl.pathname) && !isAuthenticated(req)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await handleApi(req, res, requestUrl);
      return;
    }

    await serveStatic(requestUrl.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error", detail: String(error.message || error) });
  }
});

server.listen(port, () => {
  console.log(`yinuo-agent running at http://localhost:${port}`);
});

async function initialize() {
  await fs.mkdir(dataDir, { recursive: true });
  state.runtimeSourceDir = await ensureRuntimeSourceDir(runtimeSourceDir);
  state.profile = await safeRead(profilePath);
  state.agentPrompt = await safeRead(promptPath);
  state.settings = await loadSettings();
  if (hostedDeployment && (!state.settings.username || !state.settings.passwordHash)) {
    throw new Error(
      "Web login is not configured. Set YINUO_WEB_USERNAME and either YINUO_WEB_PASSWORD_SHA256 or YINUO_WEB_PASSWORD before exposing the app."
    );
  }
  if (!hostedDeployment && !state.settings.passwordHash) {
    state.settings.loginKey = generateLoginKey();
    state.settings.username = state.settings.username || "admin";
    state.settings.passwordHash = sha256(state.settings.loginKey);
    console.log(`Local login generated. Username: ${state.settings.username}; password: ${state.settings.loginKey}`);
    await saveSettings();
  }
  await rebuildIndex();
}

async function handleApi(req, res, requestUrl) {
  if (req.method === "GET" && requestUrl.pathname === "/api/auth/status") {
    sendJson(res, 200, {
      authenticated: isAuthenticated(req),
      loginRequired: true
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const username = String(body?.username || "");
    const password = String(body?.password || "");

    if (!isValidLogin(username, password)) {
      sendJson(res, 401, { error: "Invalid username or password" });
      return;
    }

    const sessionId = randomUUID();
    sessions.set(sessionId, { createdAt: Date.now() });
    setSessionCookie(req, res, sessionId);
    sendJson(res, 200, { ok: true, authenticated: true });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
    const sessionId = getSessionId(req);
    if (sessionId) {
      sessions.delete(sessionId);
    }
    clearSessionCookie(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/status") {
    sendJson(res, 200, {
      sourceDir: state.sourceDir,
      sourceDirs: state.sourceDirs,
      runtimeSourceDir: state.runtimeSourceDir,
      runtimeUploadEnabled: Boolean(state.runtimeSourceDir),
      lastBuiltAt: state.lastBuiltAt,
      stats: state.stats,
      hasApiKey: Boolean(getApiKey()),
      model: getModel(),
      provider: getProvider()
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/settings") {
    sendJson(res, 200, {
      hasApiKey: Boolean(getApiKey()),
      apiKeyMasked: maskApiKey(getApiKey()),
      model: getModel(),
      provider: getProvider(),
      settingsLocked: hostedDeployment
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/settings") {
    if (hostedDeployment) {
      sendJson(res, 403, {
        error: "Settings are managed by environment variables in hosted deployment."
      });
      return;
    }

    const body = await readJson(req);
    const nextProvider = normalizeProvider(body?.provider);
    const nextModel = String(body?.model || "").trim() || defaultModelForProvider(nextProvider);
    const nextApiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : null;
    const clearApiKey = Boolean(body?.clearApiKey);

    state.settings.provider = nextProvider;
    state.settings.model = nextModel;

    if (clearApiKey) {
      state.settings.apiKey = "";
    } else if (nextApiKey !== null && nextApiKey.length > 0) {
      state.settings.apiKey = nextApiKey;
    }

    await saveSettings();
    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(getApiKey()),
      apiKeyMasked: maskApiKey(getApiKey()),
      model: getModel(),
      provider: getProvider(),
      settingsLocked: hostedDeployment
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/rebuild") {
    const result = await rebuildIndex();
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/admin/import") {
    if (!state.runtimeSourceDir) {
      sendJson(res, 400, {
        error: "Runtime upload is disabled. Set YINUO_RUNTIME_SOURCE_DIR to a writable persistent path."
      });
      return;
    }

    const body = await readJson(req);
    const content = String(body?.content || "").trim();
    const title = String(body?.title || "").trim();
    const preferredName = String(body?.fileName || "").trim();

    if (!content) {
      sendJson(res, 400, { error: "Missing content" });
      return;
    }

    const fileName = buildRuntimeFileName(preferredName, title);
    const fullPath = path.join(state.runtimeSourceDir, fileName);
    const rendered = renderRuntimeMarkdown(title, content);
    await fs.writeFile(fullPath, rendered, "utf8");
    const result = await rebuildIndex();

    sendJson(res, 200, {
      ok: true,
      fileName,
      filePath: fullPath,
      lastBuiltAt: result.lastBuiltAt,
      stats: result.stats
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/chat") {
    const body = await readJson(req);
    const message = String(body?.message || "").trim();
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!message) {
      sendJson(res, 400, { error: "Missing message" });
      return;
    }

    const retrieval = retrieveRelevant(message, 8);
    const llmResult = getApiKey()
      ? await generateWithProvider(message, history, retrieval)
      : generateLocalAnswer(message, retrieval);
    const answer = typeof llmResult === "string" ? llmResult : llmResult.answer;
    const webSources = typeof llmResult === "string" ? [] : llmResult.webSources || [];

    sendJson(res, 200, {
      answer,
      sources: [
        ...retrieval.map((item) => ({
          type: "corpus",
          file: item.file,
          lineStart: item.lineStart,
          lineEnd: item.lineEnd,
          topic: item.topic,
          text: item.text
        })),
        ...webSources
      ],
      mode: getApiKey() ? getProvider() : "local"
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(requestPath, res) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function rebuildIndex() {
  const sourceDirs = getActiveSourceDirs();
  const files = await walkMarkdownFiles(sourceDirs);
  const documents = [];

  for (const file of files) {
    const content = await safeRead(file);
    const blocks = extractBlocks(content);

    for (const block of blocks) {
      documents.push({
        id: `${path.basename(file)}:${block.lineStart}`,
        file,
        lineStart: block.lineStart,
        lineEnd: block.lineEnd,
        text: block.text,
        topic: classifyTopic(block.text),
        tokens: tokenize(block.text)
      });
    }
  }

  state.sourceDir = defaultSourceDir;
  state.sourceDirs = sourceDirs;
  state.documents = documents;
  state.lastBuiltAt = new Date().toISOString();
  state.stats = {
    fileCount: files.length,
    chunkCount: documents.length
  };

  await fs.writeFile(
    indexPath,
    JSON.stringify(
      {
        sourceDir: state.sourceDir,
        sourceDirs: state.sourceDirs,
        runtimeSourceDir: state.runtimeSourceDir,
        profile: state.profile,
        agentPrompt: state.agentPrompt,
        documents: state.documents,
        lastBuiltAt: state.lastBuiltAt,
        stats: state.stats
      },
      null,
      2
    )
  );

  return {
    ok: true,
    sourceDir: state.sourceDir,
    sourceDirs: state.sourceDirs,
    runtimeSourceDir: state.runtimeSourceDir,
    lastBuiltAt: state.lastBuiltAt,
    stats: state.stats
  };
}

function getActiveSourceDirs() {
  return [defaultSourceDir, state.runtimeSourceDir].filter(Boolean);
}

async function walkMarkdownFiles(dirs) {
  const collected = [];

  for (const dir of dirs) {
    collected.push(...(await walkMarkdownFilesInDir(dir)));
  }

  return collected.sort((a, b) => a.localeCompare(b, "en"));
}

async function walkMarkdownFilesInDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFilesInDir(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let current = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i += 1) {
    const cleaned = cleanLine(lines[i]);

    if (!cleaned) {
      flush(i);
      continue;
    }

    if (current.length === 0) {
      startLine = i + 1;
    }

    current.push(cleaned);
  }

  flush(lines.length);
  return blocks;

  function flush(endIndex) {
    if (current.length === 0) {
      return;
    }

    const text = current.join(" ").replace(/\s+/g, " ").trim();
    current = [];

    if (text.length < 18) {
      return;
    }

    blocks.push({
      lineStart: startLine,
      lineEnd: endIndex,
      text
    });
  }
}

function cleanLine(line) {
  let value = line.trim();
  if (!value) {
    return "";
  }

  value = value.replace(/^[_\W]*$/, "");
  value = value.replace(/^>\s*/, "");
  value = value.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  value = value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  value = value.replace(/^#+\s*/, "");
  value = value.replace(/展开_.*$/, "");
  value = value.replace(/昨天\s+\d{1,2}:\d{2}.*$/, "");
  value = value.replace(/\s+/g, " ").trim();

  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return "";
  }

  if (/^[\[\]()!._\-·\s]+$/.test(value)) {
    return "";
  }

  return value;
}

function classifyTopic(text) {
  let best = { label: "other", score: 0 };

  for (const rule of topicRules) {
    let score = 0;
    for (const keyword of rule.keywords) {
      if (text.includes(keyword)) {
        score += keyword.length;
      }
    }
    if (score > best.score) {
      best = { label: rule.label, score };
    }
  }

  return best.label;
}

function tokenize(text) {
  const terms = new Set();
  const normalized = text.toLowerCase();

  for (const match of normalized.matchAll(/[a-z0-9]{2,}/g)) {
    terms.add(match[0]);
  }

  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const word = match[0];
    terms.add(word);
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i <= word.length - size; i += 1) {
        terms.add(word.slice(i, i + size));
      }
    }
  }

  return [...terms];
}

function inferTopicFromText(text) {
  if (
    text.includes("\u65b0\u80fd\u6e90") ||
    text.includes("\u50a8\u80fd") ||
    text.includes("\u9502") ||
    text.includes("\u9502\u77ff") ||
    text.includes("\u5149\u4f0f") ||
    text.includes("\u7535\u6c60")
  ) {
    return "energy";
  }

  if (
    text.includes("\u6d88\u8d39") ||
    text.includes("\u767d\u9152") ||
    text.includes("\u8305\u53f0") ||
    text.includes("\u6f6e\u73a9")
  ) {
    return "consumer";
  }

  if (
    text.includes("\u8f6e\u80ce") ||
    text.includes("\u5de8\u80ce") ||
    text.includes("\u8d5b\u8f6e")
  ) {
    return "tire";
  }

  if (
    text.includes("\u6e38\u620f") ||
    text.includes("AI") ||
    text.includes("CPO") ||
    text.includes("PCB")
  ) {
    return "tech";
  }

  let best = { label: "other", score: 0 };

  for (const rule of topicRules) {
    let score = 0;
    for (const keyword of rule.keywords) {
      if (text.includes(keyword)) {
        score += keyword.length * 2;
      }
    }
    if (rule.label === "trading") {
      score = Math.floor(score * 0.6);
    }
    if (score > best.score) {
      best = { label: rule.label, score };
    }
  }

  return best.label;
}

function retrieveRelevant(query, limit) {
  const queryTokens = tokenize(query);
  const inferredTopic = inferTopicFromText(query);
  const scored = [];

  for (const doc of state.documents) {
    let score = 0;

    for (const token of queryTokens) {
      if (doc.text.toLowerCase().includes(token)) {
        score += Math.min(token.length, 6);
      }
    }

    if (score > 0) {
      if (doc.topic === inferredTopic && inferredTopic !== "other") {
        score += 20;
      }
      if (doc.text.startsWith("回复@")) {
        score -= 3;
      }
      scored.push({ ...doc, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, "en"))
    .slice(0, limit);
}

async function generateWithOpenAI(message, history, retrieval) {
  const model = getModel();
  const freshnessWarning = buildFreshnessInstruction(message, false);
  const evidence = retrieval
    .map(
      (item, index) =>
        `[${index + 1}] ${path.basename(item.file)}:${item.lineStart}-${item.lineEnd} (${item.topic}) ${item.text}`
    )
    .join("\n");

  const recentHistory = history
    .slice(-8)
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`)
    .join("\n");

  const input = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: `${state.agentPrompt}\n\nToday is ${getCurrentDateString()}.\n\nOnly answer from the provided materials and obvious inference. Do not invent holdings or precise views that are not supported by the source documents.\n\n${freshnessWarning}`
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Metalslime summary:\n${state.profile}\n\nRetrieved source snippets:\n${evidence}\n\nRecent conversation:\n${recentHistory || "None"}\n\nQuestion:\n${message}`
        }
      ]
    }
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`
    },
    body: JSON.stringify({ model, input })
  });

  if (!response.ok) {
    const detail = await response.text();
    return {
      answer: [
      "OpenAI API call failed.",
      "",
      detail.slice(0, 300),
      "",
      generateLocalAnswer(message, retrieval)
      ].join("\n"),
      webSources: []
    };
  }

  const data = await response.json();
  return {
    answer: data.output_text?.trim() || generateLocalAnswer(message, retrieval),
    webSources: []
  };
}

async function generateWithGemini(message, history, retrieval) {
  const model = getModel();
  const grounded = needsFreshPublicInfo(message);
  const systemText = `${state.agentPrompt}\n\nToday is ${getCurrentDateString()}.\n\nOnly answer from the provided materials and obvious inference. Do not invent holdings or precise views that are not supported by the source documents.\n\n${buildFreshnessInstruction(message, grounded)}`;
  const evidence = retrieval
    .map(
      (item, index) =>
        `[${index + 1}] ${path.basename(item.file)}:${item.lineStart}-${item.lineEnd} (${item.topic}) ${item.text}`
    )
    .join("\n");

  const recentHistory = history
    .slice(-8)
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`)
    .join("\n");

  const promptText = [
    systemText,
    `Metalslime summary:\n${state.profile}`,
    `Retrieved source snippets:\n${evidence}`,
    `Recent conversation:\n${recentHistory || "None"}`,
    `Question:\n${message}`
  ].join("\n\n");

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }]
      }
    ],
    ...(grounded
      ? {
          tools: [
            {
              google_search: {}
            }
          ]
        }
      : {})
  };

  try {
    const data = await callGemini(model, getApiKey(), payload);
    const text = extractGeminiText(data);
    return {
      answer: text || generateLocalAnswer(message, retrieval),
      webSources: extractGroundingSources(data)
    };
  } catch (error) {
    return {
      answer: [
      "Gemini API call failed.",
      "",
      String(error.message || error).slice(0, 500),
      "",
      generateLocalAnswer(message, retrieval)
      ].join("\n"),
      webSources: []
    };
  }
}

async function generateWithProvider(message, history, retrieval) {
  const provider = getProvider();
  if (provider === "gemini") {
    return generateWithGemini(message, history, retrieval);
  }
  return generateWithOpenAI(message, history, retrieval);
}

function generateLocalAnswer(message, retrieval) {
  const topics = summarizeTopics(retrieval);
  const topEvidence = retrieval.slice(0, 4);
  const stance = buildLocalStance(message, topics, inferTopicFromText(message));

  const lines = [];
  lines.push("Local retrieval mode");
  lines.push("");
  lines.push("Conclusion");
  lines.push(stance.summary);
  lines.push("");
  lines.push("Focus first on these points:");
  for (const point of stance.points) {
    lines.push(`- ${point}`);
  }

  if (topEvidence.length) {
    lines.push("");
    lines.push("Relevant source evidence:");
    for (const item of topEvidence) {
      lines.push(`- ${path.basename(item.file)}:${item.lineStart} ${item.text}`);
    }
  }

  lines.push("");
  lines.push("Note");
  lines.push("No external LLM API is configured, so this answer is generated from local retrieval plus a rule-based Metalslime template. For time-sensitive public information, this mode cannot verify live web data.");
  return lines.join("\n");
}

function summarizeTopics(retrieval) {
  const counts = new Map();
  for (const item of retrieval) {
    counts.set(item.topic, (counts.get(item.topic) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
}

function buildLocalStance(message, topics, inferredTopic) {
  const lower = message.toLowerCase();
  const activeTopic = inferredTopic !== "other" ? inferredTopic : topics[0] || "trading";

  if (activeTopic === "energy") {
    return {
      summary:
        "This should be judged through new-energy-chain beta, demand growth, pass-through ability, and whether recent strong profit is sustainable. Metalslime is broadly constructive on new energy, but he repeatedly asks whether a move is only an oversold rebound or a false annualization story.",
      points: [
        "Check whether internal breadth and sector beta are improving, not just whether one leader bounced.",
        "Break down demand, orders, production, pass-through, and profit transfer, especially around storage and lithium.",
        "Stay skeptical of valuation expansion built on one strong quarter being treated as a new normal."
      ]
    };
  }

  if (activeTopic === "consumer") {
    return {
      summary:
        "In this framework, broad consumer is not a default high-beta area. Many sub-sectors look more like weak post-destocking recovery than durable growth.",
      points: [
        "First decide whether the sub-sector still has real industry beta.",
        "Look at channel inventory, sell-through, population structure, and valuation compression together.",
        "Be extra careful with regional liquor names and brands with fading national expansion."
      ]
    };
  }

  if (activeTopic === "tire") {
    return {
      summary:
        "Tires fit a mid-term industry thesis in the Metalslime framework. The key is not short-term excitement but global share gains, replacement-market economics, brand-lag advantages, and high-barrier sub-segments.",
      points: [
        "Separate generic competition from giant tires, high-end commercial tires, and retread systems.",
        "Track tariffs, global minimum tax, and raw-material inflation slope as hard constraints.",
        "Treat tires as a mid-term industry thesis, not just a one-quarter sentiment trade."
      ]
    };
  }

  if (activeTopic === "tech") {
    return {
      summary:
        "Games and many pure-theme tech directions deserve more caution here. The core test is earnings delivery and return on capital, not a large narrative.",
      points: [
        "Focus on earnings delivery and commercialization before theme heat.",
        "If the move is driven only by U.S. mapping or short writeups, confidence should be discounted.",
        "Sector-level return dynamics matter more than hype around a single product."
      ]
    };
  }

  if (
    lower.includes("\u5957") ||
    lower.includes("\u4e8f") ||
    lower.includes("\u5356") ||
    lower.includes("loss") ||
    lower.includes("sell")
  ) {
    return {
      summary:
        "If the real question is whether you are trapped and whether you should sell, this framework first judges position and rebound room before talking about long-term value.",
      points: [
        "Separate trend deterioration from short-term emotional liquidation.",
        "If it is only oversold and the market is waiting for a rebound, timing and exposure matter more than verbal bottom-calling.",
        "If the money-making effect keeps weakening, respect the negative flywheel first."
      ]
    };
  }

  return {
    summary:
      "Under the Metalslime framework, the first step is always industry beta and money-making effect, then company logic and trade timing. Without those first two steps, valuation and narrative are not stable.",
    points: [
      "Judge whether industry beta is improving, weakening, or gone.",
      "Then break down demand, pricing, orders, and earnings delivery without blindly annualizing one quarter.",
      "Only then give a position view, with explicit uncertainty where evidence is weak."
    ]
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function safeRead(filePath) {
  return fs.readFile(filePath, "utf8");
}


async function loadSettings() {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    const provider = normalizeProvider(process.env.LLM_PROVIDER || raw.provider);
    const auth = loadAuthSettings(raw);
    return {
      provider,
      apiKey:
        typeof process.env.GEMINI_API_KEY === "string" && provider === "gemini"
          ? process.env.GEMINI_API_KEY
          : typeof process.env.OPENAI_API_KEY === "string" && provider === "openai"
            ? process.env.OPENAI_API_KEY
            : typeof raw.apiKey === "string"
              ? raw.apiKey
              : "",
      ...auth,
      model:
        typeof process.env.GEMINI_MODEL === "string" && provider === "gemini" && process.env.GEMINI_MODEL.trim()
          ? process.env.GEMINI_MODEL.trim()
          : typeof process.env.OPENAI_MODEL === "string" && provider === "openai" && process.env.OPENAI_MODEL.trim()
            ? process.env.OPENAI_MODEL.trim()
            : typeof raw.model === "string" && raw.model.trim()
              ? raw.model
              : defaultModelForProvider(provider)
    };
  } catch {
    const provider = process.env.LLM_PROVIDER === "openai" ? "openai" : "gemini";
    const auth = loadAuthSettings({});
    return {
      provider,
      apiKey:
        provider === "openai"
          ? process.env.OPENAI_API_KEY || ""
          : process.env.GEMINI_API_KEY || "",
      ...auth,
      model: defaultModelForProvider(provider)
    };
  }
}

function loadAuthSettings(raw) {
  const username = firstNonEmpty(
    process.env.YINUO_WEB_USERNAME,
    process.env.METALSLIME_WEB_USERNAME,
    raw.username,
    raw.authUsername,
    "admin"
  );
  const passwordHash = normalizeSha256(
    firstNonEmpty(
      process.env.YINUO_WEB_PASSWORD_SHA256,
      process.env.METALSLIME_WEB_PASSWORD_SHA256,
      raw.passwordHash,
      raw.authPasswordHash
    )
  );
  const password = firstNonEmpty(process.env.YINUO_WEB_PASSWORD, process.env.METALSLIME_WEB_PASSWORD);
  const loginKey = firstNonEmpty(process.env.YINUO_LOGIN_KEY, process.env.METALSLIME_LOGIN_KEY, raw.loginKey);

  return {
    username,
    passwordHash: password ? sha256(password) : passwordHash || (loginKey ? sha256(loginKey) : ""),
    loginKey: hostedDeployment ? "" : loginKey || ""
  };
}

async function saveSettings() {
  if (hostedDeployment) {
    return;
  }
  await fs.writeFile(settingsPath, JSON.stringify(state.settings, null, 2));
}

function getApiKey() {
  if (state.settings.apiKey) {
    return state.settings.apiKey;
  }
  return getProvider() === "gemini"
    ? process.env.GEMINI_API_KEY || ""
    : process.env.OPENAI_API_KEY || "";
}

function getModel() {
  return state.settings.model || defaultModelForProvider(getProvider());
}

function getProvider() {
  return normalizeProvider(state.settings.provider);
}

function normalizeProvider(value) {
  return value === "openai" ? "openai" : "gemini";
}

function defaultModelForProvider(provider) {
  return provider === "openai"
    ? process.env.OPENAI_MODEL || "gpt-4.1-mini"
    : process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
}

function maskApiKey(apiKey) {
  if (!apiKey) {
    return "";
  }
  if (apiKey.length <= 8) {
    return "*".repeat(apiKey.length);
  }
  return `${apiKey.slice(0, 4)}${"*".repeat(Math.max(4, apiKey.length - 8))}${apiKey.slice(-4)}`;
}

function getCurrentDateString() {
  return new Date().toISOString().slice(0, 10);
}

function needsFreshPublicInfo(message) {
  const query = String(message || "").toLowerCase();
  const patterns = [
    "latest",
    "most recent",
    "today",
    "current",
    "now",
    "this week",
    "this month",
    "2025",
    "2026",
    "最近",
    "最新",
    "当前",
    "现在",
    "今天",
    "近期",
    "今年",
    "本周",
    "本月",
    "财报",
    "业绩",
    "q1",
    "q2",
    "q3",
    "q4"
  ];

  return patterns.some((pattern) => query.includes(pattern));
}

function buildFreshnessInstruction(message, grounded) {
  if (!needsFreshPublicInfo(message)) {
    return "If the question is not time-sensitive, prioritize the provided Metalslime corpus and your reasoning structure.";
  }

  if (grounded) {
    return "This question may depend on current or recent public information. Use Google Search grounding when needed. If you rely on current public information, anchor your answer to concrete dates and prefer grounded facts over model memory.";
  }

  return "This question may depend on current or recent public information. You do not have live web verification in this mode. Do not guess current facts or imply real-time certainty. If freshness matters, say that current public information cannot be verified in the current mode.";
}

function extractGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractGroundingSources(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) {
    return [];
  }

  const seen = new Set();
  const sources = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title || "web";
    if (!uri || seen.has(uri)) {
      continue;
    }
    seen.add(uri);
    sources.push({
      type: "web",
      topic: "web",
      title,
      url: uri,
      text: title
    });
  }

  return sources.slice(0, 8);
}

function jsonSanitizer(_key, value) {
  if (typeof value === "string") {
    return typeof value.toWellFormed === "function" ? value.toWellFormed() : value;
  }
  return value;
}

async function callGemini(model, apiKey, payload) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(payload, jsonSanitizer)
    }
  );

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(rawText.slice(0, 1000) || "Gemini request failed");
  }

  return JSON.parse(rawText);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(text);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function buildRuntimeFileName(preferredName, title) {
  const fromName = sanitizeFileSegment(preferredName.replace(/\.md$/i, ""));
  const fromTitle = sanitizeFileSegment(title);
  const base = fromName || fromTitle || `runtime-${Date.now()}`;
  return `${new Date().toISOString().slice(0, 10)}-${base}.md`;
}

function sanitizeFileSegment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function renderRuntimeMarkdown(title, content) {
  const lines = [];
  if (title) {
    lines.push(`# ${title}`);
    lines.push("");
  }
  lines.push(content.trim());
  lines.push("");
  return lines.join("\n");
}

async function ensureRuntimeSourceDir(dir) {
  if (!dir) {
    return "";
  }

  try {
    await fs.mkdir(dir, { recursive: true });
    return dir;
  } catch (error) {
    if (hostedDeployment) {
      console.warn(
        `Runtime corpus disabled because the configured path is not writable: ${dir}. ` +
          `Attach a Render persistent disk and mount it to the configured path to enable runtime imports.`
      );
      console.warn(error);
      return "";
    }
    throw error;
  }
}

function isPublicApiRoute(pathname) {
  return pathname === "/api/auth/status" || pathname === "/api/auth/login";
}

function isAuthenticated(req) {
  const sessionId = getSessionId(req);
  return Boolean(sessionId && sessions.has(sessionId));
}

function isValidLogin(username, password) {
  const expectedUsername = state.settings.username || "admin";
  const expectedPasswordHash = state.settings.passwordHash || "";

  if (!username || !password || !expectedPasswordHash) {
    return false;
  }

  return (
    constantTimeEquals(username, expectedUsername) &&
    constantTimeEquals(sha256(password), expectedPasswordHash)
  );
}

function getSessionId(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${sessionCookieName}=`)) {
      return decodeURIComponent(cookie.slice(sessionCookieName.length + 1));
    }
  }
  return "";
}

function setSessionCookie(req, res, sessionId) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  const length = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(length);
  const paddedRight = Buffer.alloc(length);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  return timingSafeEqual(paddedLeft, paddedRight) && leftBuffer.length === rightBuffer.length;
}

function generateLoginKey() {
  return randomBytes(24).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeSha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
