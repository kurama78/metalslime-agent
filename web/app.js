const messagesEl = document.getElementById("messages");
const sourcesEl = document.getElementById("sources");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("messageInput");
const loginOverlayEl = document.getElementById("loginOverlay");
const loginFormEl = document.getElementById("loginForm");
const loginKeyInputEl = document.getElementById("loginKeyInput");
const loginBtnEl = document.getElementById("loginBtn");
const loginErrorEl = document.getElementById("loginError");
const logoutBtnEl = document.getElementById("logoutBtn");
const rebuildBtn = document.getElementById("rebuildBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const clearSettingsBtn = document.getElementById("clearSettingsBtn");
const sourceDirEl = document.getElementById("sourceDir");
const providerInputEl = document.getElementById("providerInput");
const modelPresetInputEl = document.getElementById("modelPresetInput");
const modelInputEl = document.getElementById("modelInput");
const apiKeyInputEl = document.getElementById("apiKeyInput");
const apiKeyHintEl = document.getElementById("apiKeyHint");
const settingsModeHintEl = document.getElementById("settingsModeHint");
const connectionBannerEl = document.getElementById("connectionBanner");
const modeBadgeEl = document.getElementById("modeBadge");
const fileCountEl = document.getElementById("fileCount");
const chunkCountEl = document.getElementById("chunkCount");
const builtAtEl = document.getElementById("builtAt");

const history = [];
let isAuthenticated = false;

const MODEL_PRESETS = {
  gemini: [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "custom"
  ],
  openai: [
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-4o-mini",
    "gpt-4o",
    "custom"
  ]
};

bootstrap();

async function bootstrap() {
  bindEvents();
  const auth = await fetchJson("/api/auth/status");
  isAuthenticated = Boolean(auth.authenticated);
  renderAuthState();

  if (!isAuthenticated) {
    return;
  }

  appendWelcome();
  await refreshSettings();
  await refreshStatus();
}

function bindEvents() {
  loginFormEl.addEventListener("submit", onLogin);
  logoutBtnEl.addEventListener("click", onLogout);
  formEl.addEventListener("submit", onSubmit);
  rebuildBtn.addEventListener("click", onRebuild);
  saveSettingsBtn.addEventListener("click", onSaveSettings);
  clearSettingsBtn.addEventListener("click", onClearSettings);
  providerInputEl.addEventListener("change", onProviderChange);
  modelPresetInputEl.addEventListener("change", onModelPresetChange);
  modelInputEl.addEventListener("input", syncModelPresetFromInput);

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      inputEl.value = chip.textContent.trim();
      inputEl.focus();
    });
  });
}

async function onLogin(event) {
  event.preventDefault();
  loginBtnEl.disabled = true;
  loginBtnEl.textContent = "Unlocking...";
  loginErrorEl.textContent = "";

  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginKey: loginKeyInputEl.value.trim() })
    });

    isAuthenticated = true;
    loginKeyInputEl.value = "";
    renderAuthState();
    appendWelcome();
    await refreshSettings();
    await refreshStatus();
  } catch (error) {
    loginErrorEl.textContent = error.message || "Login failed";
  } finally {
    loginBtnEl.disabled = false;
    loginBtnEl.textContent = "Unlock";
  }
}

async function onLogout() {
  try {
    await fetchJson("/api/auth/logout", { method: "POST" });
  } finally {
    isAuthenticated = false;
    history.length = 0;
    messagesEl.innerHTML = "";
    sourcesEl.innerHTML = '<div class="empty-state">Evidence will appear here after you send a message.</div>';
    renderAuthState();
  }
}

function renderAuthState() {
  loginOverlayEl.classList.toggle("active", !isAuthenticated);
  document.body.style.overflow = isAuthenticated ? "" : "hidden";
}

function appendWelcome() {
  if (messagesEl.childElementCount > 0) {
    return;
  }

  appendMessage(
    "assistant",
    "This interface uses Metalslime's investment logic, not his tone or phrasing. The left sidebar shows whether Gemini, OpenAI, or local retrieval is currently active."
  );
}

async function onSubmit(event) {
  event.preventDefault();
  const message = inputEl.value.trim();
  if (!message) return;

  appendMessage("user", message);
  history.push({ role: "user", content: message });
  inputEl.value = "";

  const loading = appendMessage("assistant", "Thinking...");

  try {
    const data = await fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history })
    });

    loading.remove();
    appendMessage("assistant", data.answer);
    history.push({ role: "assistant", content: data.answer });
    renderSources(data.sources || []);
  } catch (error) {
    loading.textContent = `Request failed: ${error.message}`;
  }
}

async function onRebuild() {
  rebuildBtn.disabled = true;
  rebuildBtn.textContent = "Rebuilding...";

  try {
    const data = await fetchJson("/api/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceDir: sourceDirEl.value.trim() || "Metalslime" })
    });

    appendMessage(
      "assistant",
      `Agent rebuilt.\nFiles: ${data.stats.fileCount}\nChunks: ${data.stats.chunkCount}\nTime: ${formatTime(data.lastBuiltAt)}`
    );
    await refreshStatus();
  } catch (error) {
    appendMessage("assistant", `Rebuild failed: ${error.message}`);
  } finally {
    rebuildBtn.disabled = false;
    rebuildBtn.textContent = "Rebuild Agent";
  }
}

async function onSaveSettings(event) {
  event.preventDefault();
  saveSettingsBtn.disabled = true;
  clearSettingsBtn.disabled = true;
  saveSettingsBtn.textContent = "Saving...";

  try {
    const data = await fetchJson("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelInputEl.value.trim(),
        provider: providerInputEl.value,
        apiKey: apiKeyInputEl.value
      })
    });

    apiKeyInputEl.value = "";
    apiKeyHintEl.textContent = data.hasApiKey
      ? `Saved key: ${data.apiKeyMasked}`
      : "No API key saved.";
    appendMessage(
      "assistant",
      `Settings saved.\nProvider: ${capitalize(data.provider)}\nModel: ${data.model}\nAPI key: ${data.hasApiKey ? "configured" : "not configured"}`
    );
    await refreshStatus();
  } catch (error) {
    appendMessage("assistant", `Save settings failed: ${error.message}`);
  } finally {
    saveSettingsBtn.disabled = false;
    clearSettingsBtn.disabled = false;
    saveSettingsBtn.textContent = "Save Settings";
  }
}

async function onClearSettings() {
  saveSettingsBtn.disabled = true;
  clearSettingsBtn.disabled = true;
  clearSettingsBtn.textContent = "Clearing...";

  try {
    await fetchJson("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelInputEl.value.trim(),
        provider: providerInputEl.value,
        clearApiKey: true
      })
    });

    apiKeyInputEl.value = "";
    apiKeyHintEl.textContent = "No API key saved.";
    appendMessage("assistant", "API key cleared.");
    await refreshStatus();
  } catch (error) {
    appendMessage("assistant", `Clear API key failed: ${error.message}`);
  } finally {
    saveSettingsBtn.disabled = false;
    clearSettingsBtn.disabled = false;
    clearSettingsBtn.textContent = "Clear Key";
  }
}

async function refreshStatus() {
  const data = await fetchJson("/api/status");

  modeBadgeEl.textContent = data.hasApiKey
    ? `${capitalize(data.provider)} / ${data.model}`
    : `Local retrieval (${capitalize(data.provider)})`;
  renderConnectionBanner(data);
  fileCountEl.textContent = data.stats?.fileCount ?? "-";
  chunkCountEl.textContent = data.stats?.chunkCount ?? "-";
  builtAtEl.textContent = data.lastBuiltAt ? formatTime(data.lastBuiltAt) : "-";
  sourceDirEl.value = relativeSourceDir(data.sourceDir || "Metalslime");
}

async function refreshSettings() {
  const data = await fetchJson("/api/settings");

  providerInputEl.value = data.provider || "gemini";
  renderModelPresets(providerInputEl.value, data.model || defaultModelForProvider(providerInputEl.value));
  modelInputEl.value = data.model || defaultModelForProvider(providerInputEl.value);
  apiKeyHintEl.textContent = data.hasApiKey
    ? `Saved key: ${data.apiKeyMasked}`
    : "No API key saved.";
  renderSettingsMode(Boolean(data.settingsLocked));
  updateApiKeyPlaceholder();
}

function onProviderChange() {
  const nextDefault = defaultModelForProvider(providerInputEl.value);
  const currentValue = modelInputEl.value.trim();
  renderModelPresets(providerInputEl.value, currentValue || nextDefault);
  if (!currentValue || isKnownDefaultModel(currentValue)) {
    modelInputEl.value = nextDefault;
    modelPresetInputEl.value = nextDefault;
  }
  updateApiKeyPlaceholder();
}

function updateApiKeyPlaceholder() {
  apiKeyInputEl.placeholder = providerInputEl.value === "openai" ? "sk-..." : "AIza...";
}

function onModelPresetChange() {
  if (modelPresetInputEl.value !== "custom") {
    modelInputEl.value = modelPresetInputEl.value;
  }
}

function syncModelPresetFromInput() {
  const presets = MODEL_PRESETS[providerInputEl.value] || [];
  const currentValue = modelInputEl.value.trim();
  modelPresetInputEl.value = presets.includes(currentValue) ? currentValue : "custom";
}

function renderModelPresets(provider, currentModel) {
  const presets = MODEL_PRESETS[provider] || [];
  modelPresetInputEl.innerHTML = "";

  presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset;
    option.textContent = preset;
    modelPresetInputEl.appendChild(option);
  });

  modelPresetInputEl.value = presets.includes(currentModel) ? currentModel : "custom";
}

function defaultModelForProvider(provider) {
  return provider === "openai" ? "gpt-4.1-mini" : "gemini-2.5-flash";
}

function isKnownDefaultModel(model) {
  return Object.values(MODEL_PRESETS).some((list) => list.includes(model) && model !== "custom");
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function renderConnectionBanner(status) {
  connectionBannerEl.className = "connection-banner";

  if (!status.hasApiKey) {
    connectionBannerEl.classList.add("connection-local");
    connectionBannerEl.textContent = "Local retrieval only";
    return;
  }

  if (status.provider === "gemini") {
    connectionBannerEl.classList.add("connection-gemini");
    connectionBannerEl.textContent = `Gemini connected · ${status.model}`;
    return;
  }

  connectionBannerEl.classList.add("connection-openai");
  connectionBannerEl.textContent = `OpenAI connected · ${status.model}`;
}

function appendMessage(role, text) {
  const item = document.createElement("div");
  item.className = `message ${role}`;
  item.textContent = text;
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return item;
}

function renderSources(sources) {
  sourcesEl.innerHTML = "";
  if (!sources.length) {
    sourcesEl.innerHTML = '<div class="empty-state">No directly relevant source snippet was found.</div>';
    return;
  }

  sources.forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";

    const meta = document.createElement("div");
    meta.className = "source-meta";
    meta.textContent = `${basename(source.file)}:${source.lineStart}-${source.lineEnd} · ${source.topic}`;

    const body = document.createElement("p");
    body.textContent = source.text;

    card.append(meta, body);
    sourcesEl.appendChild(card);
  });
}

function basename(filePath) {
  return filePath.split(/[/\\]/).pop();
}

function relativeSourceDir(filePath) {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || "Metalslime";
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderSettingsMode(locked) {
  providerInputEl.disabled = locked;
  modelPresetInputEl.disabled = locked;
  modelInputEl.disabled = locked;
  apiKeyInputEl.disabled = locked;
  saveSettingsBtn.disabled = locked;
  clearSettingsBtn.disabled = locked;

  settingsModeHintEl.textContent = locked
    ? "Hosted deployment detected. Provider, model, API key, and login key are managed by environment variables."
    : "Configure provider, model, and API keys here.";
  apiKeyHintEl.textContent = locked
    ? "API key is managed server-side and not editable from the web UI."
    : apiKeyHintEl.textContent;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    isAuthenticated = false;
    renderAuthState();
    throw new Error(data.error || "Unauthorized");
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}
