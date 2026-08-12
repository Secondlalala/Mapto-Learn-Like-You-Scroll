import { Loader2, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api/client";

const MAX_REMOTE_CHARS = 5000;
const SPEED_STORAGE_KEY = "book-concept-app.tts.speed";

export default function VoiceButton({ card, text, label, compact = true, includeContext = true }) {
  // speaking 表示正在播放，loading 表示读取设置、加载模型或等待后端生成音频。
  // 两种状态分开后，按钮可准确显示“加载”与“停止”图标。
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const stoppedRef = useRef(false);

  const stop = () => {
    // 同时停止浏览器 TTS 和后端生成音频，并释放 Blob URL。
    // Blob URL 若不主动撤销会一直占用浏览器内存，连续朗读长寓言时尤其明显。
    stoppedRef.current = true;
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setSpeaking(false);
    setLoading(false);
  };

  const speak = async () => {
    if (speaking || loading) {
      stop();
      return;
    }

    // 朗读副本依次经过上下文组装、LaTeX 简化、符号清洗和长度保护。
    // 页面显示文本完全不变，公式仍由 KaTeX 按原始内容渲染。
    const content = limitText(sanitizeForSpeech(stripLatex(buildReadableText(card, text, includeContext))));
    if (!content) return;

    stoppedRef.current = false;
    setLoading(true);
    try {
      // 每次朗读读取当前设置，确保用户刚调整的引擎和语速立即生效。
      // 远程或本地模型不可用时自动回退浏览器 TTS，让朗读按钮始终有可用路径。
      const settings = await api.getTTSSettings().catch(() => null);
      const speed = readStoredSpeed(settings?.speed ?? 0.8);
      if (settings?.api_style === "browser") {
        setLoading(false);
        browserSpeak(content, setSpeaking, speed);
        return;
      }
      // 预加载失败仍继续请求语音，服务端会在朗读入口再次尝试懒加载或返回明确错误。
      await api.preloadTTS().catch(() => null);
      await playRemoteWholeText(content, speed);
    } catch {
      if (!stoppedRef.current) browserSpeak(content, setSpeaking, readStoredSpeed());
    } finally {
      setLoading(false);
    }
  };

  const playRemoteWholeText = async (content, speed) => {
    // 后端负责模型推理与磁盘缓存，前端只接收最终音频 Blob。
    // stoppedRef 用于处理用户在请求尚未返回时点击停止的竞态，避免迟到的响应突然开始播放。
    setSpeaking(true);
    const blob = await api.synthesizeSpeech(content, { speed });
    if (stoppedRef.current) return;
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    await playAudioUrl(url);
    stop();
  };

  const playAudioUrl = (url) =>
    new Promise((resolve, reject) => {
      // 使用独立 Audio 对象播放 Blob URL，结束和错误都通过 Promise 回到统一清理流程。
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = resolve;
      audio.onerror = reject;
      audio.play().then(() => setLoading(false)).catch(reject);
    });

  return (
    <button
      className={
        compact
          ? "inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 hover:bg-stone-50"
          : "inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 px-2 text-xs hover:bg-stone-50"
      }
      onClick={speak}
      title={label || "朗读"}
    >
      {loading ? <Loader2 className="animate-spin" size={compact ? 18 : 15} /> : speaking ? <VolumeX size={compact ? 18 : 15} /> : <Volume2 size={compact ? 18 : 15} />}
      {!compact && <span>{label || "朗读"}</span>}
    </button>
  );
}

function buildReadableText(card, sectionText, includeContext) {
  // 卡片主按钮默认朗读“标题 + 一句话 + 当前段落”；寓言按钮关闭上下文后只读寓言。
  if (!card) return sectionText || "";
  if (!includeContext) return sectionText || "";
  const current = sectionText || card.simple_explanation || card.fable || "";
  return [card.title, card.one_sentence, current].filter(Boolean).join("。");
}

function limitText(value) {
  // 对远程模型设置字符上限，避免超长卡片触发请求超时或过高内存占用。
  const content = String(value || "").trim();
  if (content.length <= MAX_REMOTE_CHARS) return content;
  return `${content.slice(0, MAX_REMOTE_CHARS)}。`;
}

function browserSpeak(content, setSpeaking, speed) {
  // 浏览器 TTS 作为低延迟模式和本地模型失败时的最终回退路径。
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = "zh-CN";
  utterance.rate = speed;
  utterance.pitch = 1.05;
  const voice = pickChineseVoice(window.speechSynthesis.getVoices());
  if (voice) utterance.voice = voice;
  utterance.onend = () => setSpeaking(false);
  utterance.onerror = () => setSpeaking(false);
  setSpeaking(true);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function readStoredSpeed(fallback = 0.8) {
  // 每次点击朗读都重新读取持久化语速，设置调整无需重新挂载卡片组件。
  if (typeof window === "undefined") return clampSpeed(fallback);
  return clampSpeed(window.localStorage.getItem(SPEED_STORAGE_KEY) ?? fallback);
}

function clampSpeed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.8;
  return Math.min(2, Math.max(0.2, parsed));
}

function pickChineseVoice(voices) {
  // 优先系统自然中文音色；没有中文时再选择在线自然音色，最终允许浏览器默认。
  const chineseVoices = voices.filter((voice) => /zh|Chinese|Mandarin|普通话|中文/i.test(`${voice.lang} ${voice.name}`));
  return (
    chineseVoices.find((voice) => /Natural|Online|Microsoft|Xiaoxiao|Yunxi|Huihui|Yaoyao/i.test(voice.name)) ||
    chineseVoices[0] ||
    voices.find((voice) => /Natural|Online/i.test(voice.name)) ||
    null
  );
}

function stripLatex(value) {
  // TTS 不直接朗读 LaTeX 控制命令，只保留公式中的变量和普通字符。
  // 显示端仍由 KaTeX 渲染原公式，这里的转换仅作用于送入语音模型的副本。
  return String(value || "")
    .replace(/\$\$([\s\S]*?)\$\$/g, "公式 $1。")
    .replace(/\$([^$]+)\$/g, "公式 $1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}_^]/g, " ");
}

function sanitizeForSpeech(value) {
  // 冒号统一改为中文逗号，句号作为主要分句边界；括号、引号和装饰符号全部移除。
  // 最终只允许中英文、数字、中文逗号和句号，降低模型遇到特殊符号时的异常停顿或发音。
  return String(value || "")
    .replace(/[，、]/g, "，")
    .replace(/[：:]/g, "，")
    .replace(/[。.!?！？；;\n\r]+/g, "。")
    .replace(/[“”„"‘’'（）()\[\]【】{}《》〈〉<>_#`~^/@\\+=\-—–•·]/g, " ")
    .replace(/[^\p{Script=Han}A-Za-z0-9，。\s]/gu, " ")
    .replace(/\s*，\s*/g, "，")
    .replace(/\s*。\s*/g, "。")
    .replace(/，+/g, "，")
    .replace(/。+/g, "。")
    .replace(/\s+/g, " ")
    .trim();
}
