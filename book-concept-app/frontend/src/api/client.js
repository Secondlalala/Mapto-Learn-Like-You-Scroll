const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.detail || "请求失败");
  }
  return data;
}

async function requestBlob(path, options = {}) {
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

export const api = {
  listBooks: () => request("/api/books"),
  getBook: (bookId) => request(`/api/books/${bookId}`),
  uploadBook: (file) => {
    const body = new FormData();
    body.append("file", file);
    return request("/api/upload", { method: "POST", body });
  },
  generateCards: (bookId, { force = false } = {}) =>
    request(`/api/books/${bookId}/generate-cards?force=${force ? "true" : "false"}`, { method: "POST" }),
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
