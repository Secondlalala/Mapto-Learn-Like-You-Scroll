import { KeyRound, Loader2, Save, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";

const SPEED_STORAGE_KEY = "book-concept-app.tts.speed";

const CHINESE_VOICES = [
  { value: "zf_xiaoxiao", label: "zf_xiaoxiao 女声，普通话" },
  { value: "zf_001", label: "zf_001 女声，普通话" },
  { value: "zm_yunxi", label: "zm_yunxi 男声，普通话" },
  { value: "zm_009", label: "zm_009 男声，普通话" },
];

const ENGLISH_VOICES = [
  { value: "af_heart", label: "af_heart 女声，美式英语" },
  { value: "af_bella", label: "af_bella 女声，美式英语" },
  { value: "am_adam", label: "am_adam 男声，美式英语" },
  { value: "bf_emma", label: "bf_emma 女声，英式英语" },
  { value: "bm_george", label: "bm_george 男声，英式英语" },
];

export default function DeepSeekSettings({ open, onClose }) {
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-chat");
  const [mock, setMock] = useState(false);
  const [masked, setMasked] = useState("");

  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsUrl, setTtsUrl] = useState("http://127.0.0.1:9977/tts");
  const [ttsStyle, setTtsStyle] = useState("kokoro");
  const [ttsVoice, setTtsVoice] = useState("zf_xiaoxiao");
  const [ttsEnglishVoice, setTtsEnglishVoice] = useState("af_heart");
  const [ttsModel, setTtsModel] = useState("kokoro-82m");
  const [ttsLangCode, setTtsLangCode] = useState("z");
  const [ttsDevice, setTtsDevice] = useState("auto");
  const [ttsSpeed, setTtsSpeed] = useState(readStoredSpeed);

  const [busy, setBusy] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([api.getDeepSeekSettings(), api.getTTSSettings()]).then(([deepseek, tts]) => {
      setApiBase(deepseek.api_base);
      setModel(deepseek.model);
      setMock(deepseek.mock);
      setMasked(deepseek.api_key_masked);
      setTtsEnabled(tts.enabled);
      setTtsUrl(tts.api_url);
      setTtsStyle(tts.api_style);
      setTtsVoice(tts.voice || "zf_xiaoxiao");
      setTtsEnglishVoice(tts.english_voice || "af_heart");
      setTtsModel(tts.model || "kokoro-82m");
      setTtsLangCode(tts.lang_code || "z");
      setTtsDevice(tts.device || "auto");
      const speed = clampSpeed(tts.speed ?? readStoredSpeed());
      setTtsSpeed(speed);
      storeSpeed(speed);
    });
  }, [open]);

  if (!open) return null;

  const updateSpeed = (value) => {
    const speed = clampSpeed(value);
    setTtsSpeed(speed);
    storeSpeed(speed);
  };

  const ttsPayload = () => ({
    enabled: ttsEnabled,
    api_url: ttsUrl,
    api_style: ttsStyle,
    voice: ttsVoice,
    english_voice: ttsEnglishVoice,
    model: ttsModel,
    lang_code: ttsLangCode,
    device: ttsDevice,
    speed: clampSpeed(ttsSpeed),
  });

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const payload = ttsPayload();
      storeSpeed(payload.speed);
      const [deepseek, tts] = await Promise.all([
        api.updateDeepSeekSettings({ api_key: apiKey, api_base: apiBase, model, mock }),
        api.updateTTSSettings(payload),
      ]);
      setMasked(deepseek.api_key_masked);
      setApiKey("");
      if (typeof tts.speed === "number") updateSpeed(tts.speed);
      setMessage("设置已保存。");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const preload = async () => {
    setPreloading(true);
    setMessage("");
    try {
      const payload = ttsPayload();
      storeSpeed(payload.speed);
      await api.updateTTSSettings(payload);
      const data = await api.preloadTTS();
      setMessage(data.detail || "语音模型已加载。");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setPreloading(false);
    }
  };

  const usingKokoro = ttsStyle === "kokoro";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <form className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white p-5 shadow-2xl" onSubmit={save}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-950">
            <KeyRound size={18} />
            模型与语音设置
          </h2>
          <button type="button" className="rounded-md p-1 hover:bg-stone-100" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <section className="border-b border-stone-100 pb-4">
          <h3 className="mb-3 text-sm font-semibold text-stone-500">DeepSeek</h3>
          <Field label="API Key">
            <input
              className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={masked ? `已保存：${masked}，留空则不修改` : "sk-..."}
              type="password"
            />
          </Field>
          <Field label="API Base">
            <input className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
          </Field>
          <Field label="模型">
            <input className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={model} onChange={(event) => setModel(event.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={mock} onChange={(event) => setMock(event.target.checked)} />
            使用 mock 模式，不调用真实 DeepSeek
          </label>
        </section>

        <section className="mt-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-500">
            <Volume2 size={16} />
            语音朗读
          </h3>
          <label className="mb-3 flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={ttsEnabled} onChange={(event) => setTtsEnabled(event.target.checked)} />
            启用语音朗读
          </label>

          <Field label={`阅读速度：${clampSpeed(ttsSpeed).toFixed(2)}x`}>
            <div className="flex items-center gap-3">
              <input className="w-full accent-stone-900" type="range" min="0.2" max="2" step="0.05" value={ttsSpeed} onChange={(event) => updateSpeed(event.target.value)} />
              <input className="h-9 w-20 rounded-md border border-stone-300 px-2 text-sm outline-none focus:border-stone-900" type="number" min="0.2" max="2" step="0.05" value={ttsSpeed} onChange={(event) => updateSpeed(event.target.value)} />
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="语音引擎">
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={ttsStyle} onChange={(event) => setTtsStyle(event.target.value)}>
                <option value="browser">浏览器自带 TTS，响应最快</option>
                <option value="kokoro">Kokoro 本地模型，音质更自然</option>
              </select>
            </Field>
            <Field label="推理设备">
              <select className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={ttsDevice} onChange={(event) => setTtsDevice(event.target.value)} disabled={!usingKokoro}>
                <option value="auto">auto：优先 GPU</option>
                <option value="cuda">cuda：使用 GPU</option>
                <option value="cpu">cpu：使用 CPU</option>
              </select>
            </Field>
          </div>

          {usingKokoro && (
            <>
              <Field label="服务地址">
                <input className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={ttsUrl} onChange={(event) => setTtsUrl(event.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="中文 Voice">
                  <select className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)}>
                    {CHINESE_VOICES.map((voice) => (
                      <option key={voice.value} value={voice.value}>{voice.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="英文 Voice">
                  <select className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={ttsEnglishVoice} onChange={(event) => setTtsEnglishVoice(event.target.value)}>
                    {ENGLISH_VOICES.map((voice) => (
                      <option key={voice.value} value={voice.value}>{voice.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="语言模式">
                  <select className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={ttsLangCode} onChange={(event) => setTtsLangCode(event.target.value)}>
                    <option value="z">z：中文普通话模型</option>
                    <option value="auto">auto：中英自动识别</option>
                    <option value="a">a：美式英语</option>
                    <option value="b">b：英式英语</option>
                  </select>
                </Field>
                <Field label="Model">
                  <select className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900" value={ttsModel} onChange={(event) => setTtsModel(event.target.value)}>
                    <option value="kokoro-82m">Kokoro-82M</option>
                  </select>
                </Field>
              </div>
              <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm hover:bg-stone-50 disabled:opacity-50" onClick={preload} disabled={preloading}>
                {preloading ? <Loader2 className="animate-spin" size={15} /> : <Volume2 size={15} />}
                加载语音模型
              </button>
            </>
          )}
        </section>

        {message && <p className="mt-4 rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700">{message}</p>}

        <button className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-medium text-white disabled:opacity-50" disabled={busy}>
          <Save size={16} />
          保存设置
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  );
}

function readStoredSpeed() {
  if (typeof window === "undefined") return 0.8;
  return clampSpeed(window.localStorage.getItem(SPEED_STORAGE_KEY) ?? 0.8);
}

function storeSpeed(value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SPEED_STORAGE_KEY, String(clampSpeed(value)));
}

function clampSpeed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.8;
  return Math.min(2, Math.max(0.2, parsed));
}
