import { Loader2, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api/client";

const MAX_REMOTE_CHARS = 5000;
const SPEED_STORAGE_KEY = "book-concept-app.tts.speed";

export default function VoiceButton({ card, text, label, compact = true, includeContext = true }) {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const stoppedRef = useRef(false);

  const stop = () => {
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

    const content = limitText(sanitizeForSpeech(stripLatex(buildReadableText(card, text, includeContext))));
    if (!content) return;

    stoppedRef.current = false;
    setLoading(true);
    try {
      const settings = await api.getTTSSettings().catch(() => null);
      const speed = clampSpeed(settings?.speed ?? readStoredSpeed());
      storeSpeed(speed);
      if (settings?.api_style === "browser") {
        setLoading(false);
        browserSpeak(content, setSpeaking, speed);
        return;
      }
      await api.preloadTTS().catch(() => null);
      await playRemoteWholeText(content, speed);
    } catch {
      if (!stoppedRef.current) browserSpeak(content, setSpeaking, readStoredSpeed());
    } finally {
      setLoading(false);
    }
  };

  const playRemoteWholeText = async (content, speed) => {
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
  if (!card) return sectionText || "";
  if (!includeContext) return sectionText || "";
  const current = sectionText || card.simple_explanation || card.fable || "";
  return [card.title, card.one_sentence, current].filter(Boolean).join("。");
}

function limitText(value) {
  const content = String(value || "").trim();
  if (content.length <= MAX_REMOTE_CHARS) return content;
  return `${content.slice(0, MAX_REMOTE_CHARS)}。`;
}

function browserSpeak(content, setSpeaking, speed) {
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

function pickChineseVoice(voices) {
  const chineseVoices = voices.filter((voice) => /zh|Chinese|Mandarin|普通话|中文/i.test(`${voice.lang} ${voice.name}`));
  return (
    chineseVoices.find((voice) => /Natural|Online|Microsoft|Xiaoxiao|Yunxi|Huihui|Yaoyao/i.test(voice.name)) ||
    chineseVoices[0] ||
    voices.find((voice) => /Natural|Online/i.test(voice.name)) ||
    null
  );
}

function stripLatex(value) {
  return String(value || "")
    .replace(/\$\$([\s\S]*?)\$\$/g, "公式 $1。")
    .replace(/\$([^$]+)\$/g, "公式 $1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}_^]/g, " ");
}

function sanitizeForSpeech(value) {
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
