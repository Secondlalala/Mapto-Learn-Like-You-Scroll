const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request(path, options = {}) {
  // JSON 请求统一经过此入口，使错误信息始终优先使用后端 detail 字段。
  // API_BASE 可在构建时覆盖，开发环境默认连接本机 FastAPI 服务。
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.detail || "请求失败");
  }
  return data;
}

async function requestBlob(path, options = {}) {
  // 语音接口返回二进制 Blob；失败响应仍按 JSON/文本解析，不能直接当音频播放。
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    let detail = "请求失败";
    try {
      detail = JSON.parse(text)?.detail || detail;
    } catch {
      detail = text || detail;
    }
    throw new Error(detail);
  }
  return response.blob();
}

async function downloadDatabase(path, fallbackFilename) {
  // 数据库导出仍由后端鉴权和生成快照；浏览器这里只负责把已完成的响应交给系统下载目录。
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const text = await response.text();
    let detail = "导出失败";
    try {
      detail = JSON.parse(text)?.detail || detail;
    } catch {
      detail = text || detail;
    }
    throw new Error(detail);
  }
  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition") || "";
  const filename = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

export const api = {
  // 页面组件只调用语义化方法，不在各处重复拼接路径、请求头和序列化规则。
  listBooks: () => request("/api/books"),
  getBook: (bookId) => request(`/api/books/${bookId}`),
  uploadBook: (file) => {
    // 浏览器自动为 FormData 生成带 boundary 的 Content-Type，不能手动覆盖请求头。
    const body = new FormData();
    body.append("file", file);
    return request("/api/upload", { method: "POST", body });
  },
  generateCards: (bookId, { force = false } = {}) =>
    request(`/api/books/${bookId}/generate-cards?force=${force ? "true" : "false"}`, { method: "POST" }),
  startAllBooksGeneration: () => request("/api/generation-jobs/all-books", { method: "POST" }),
  startBookGeneration: (bookId) => request(`/api/books/${bookId}/generation-job`, { method: "POST" }),
  getCurrentGenerationJob: () => request("/api/generation-jobs/current"),
  pauseGenerationJob: (jobId) => request(`/api/generation-jobs/${jobId}/pause`, { method: "POST" }),
  resumeGenerationJob: (jobId) => request(`/api/generation-jobs/${jobId}/resume`, { method: "POST" }),
  downloadApplicationDatabase: () => downloadDatabase("/api/exports/app-database", "maptolearn-app.db"),
  downloadBookDatabase: (bookId) => downloadDatabase(`/api/books/${bookId}/export-database`, `maptolearn-book-${bookId}.db`),
  getOutline: (bookId) => request(`/api/books/${bookId}/outline`),
  listCards: (bookId) => request(`/api/books/${bookId}/cards`),
  toggleFavorite: (cardId) => request(`/api/cards/${cardId}/favorite`, { method: "POST" }),
  listMessages: (cardId) => request(`/api/cards/${cardId}/chat`),
  ask: (cardId, question) =>
    request(`/api/cards/${cardId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  getDeepSeekSettings: () => request("/api/settings/deepseek"),
  updateDeepSeekSettings: (payload) =>
    request("/api/settings/deepseek", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  getTTSSettings: () => request("/api/settings/tts"),
  updateTTSSettings: (payload) =>
    request("/api/settings/tts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  preloadTTS: () =>
    request("/api/tts/preload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  synthesizeSpeech: (text, options = {}) =>
    requestBlob("/api/tts/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...options }),
    }),
};
