package com.secondlalala.maptolearn

import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.k2fsa.sherpa.onnx.GeneratedAudio
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.getOfflineTtsConfig
import java.io.File
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

class MapToLearnTtsModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  companion object {
    private const val MODEL_DIR = "vits-icefall-zh-aishell3"
    private const val MODEL_VERSION = "sherpa-onnx-1.13.4-aishell3"
  }

  // ONNX 推理和模型初始化统一放在单线程队列中执行。
  // 这样可以避免用户连续点击朗读时并发访问同一个 OfflineTts 实例，
  // 同时把耗时工作移出 React Native 主线程，防止界面在生成语音时卡住。
  private val executor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var offlineTts: OfflineTts? = null
  private var mediaPlayer: MediaPlayer? = null
  private var systemTts: TextToSpeech? = null

  override fun getName() = "MapToLearnTts"

  @ReactMethod
  fun preload(promise: Promise) {
    executor.execute {
      try {
        val tts = ensureOfflineTts()
        promise.resolve(statusMap(tts))
      } catch (cause: Throwable) {
        promise.reject("E_TTS_PRELOAD", "内置中文模型加载失败：${cause.message}", cause)
      }
    }
  }

  @ReactMethod
  fun speakOffline(text: String, requestedSpeed: Double, requestedSpeakerId: Double, promise: Promise) {
    executor.execute {
      try {
        val cleanText = sanitizeForSpeech(text)
        if (cleanText.isBlank()) {
          throw IllegalArgumentException("朗读内容不能为空")
        }
        val speed = requestedSpeed.coerceIn(0.2, 2.0).toFloat()
        val tts = ensureOfflineTts()
        val speakerId = requestedSpeakerId.toInt().coerceIn(0, max(0, tts.numSpeakers() - 1))
        // 缓存键同时包含模型版本、说话人、语速和清洗后的文本。
        // 任一参数变化都会生成新的音频文件，避免错误复用旧语速或旧音色；
        // 使用摘要作为文件名也能规避正文过长以及文件名非法字符问题。
        val cacheKey = sha256("$MODEL_VERSION\u0000$speakerId\u0000$speed\u0000$cleanText")
        val cacheDir = File(context.cacheDir, "offline-tts").apply { mkdirs() }
        val output = File(cacheDir, "$cacheKey.wav")
        val cacheHit = output.isFile && output.length() > 44

        if (!cacheHit) {
          synthesizeToFile(tts, cleanText, speed, speakerId, output)
        }
        playFile(output, cacheKey, cacheHit, promise)
      } catch (cause: Throwable) {
        promise.reject("E_TTS_SYNTHESIS", "中文语音生成失败：${cause.message}", cause)
      }
    }
  }

  @ReactMethod
  fun speakSystem(text: String, requestedSpeed: Double, promise: Promise) {
    mainHandler.post {
      try {
        systemTts?.stop()
        systemTts?.shutdown()
        var engine: TextToSpeech? = null
        engine = TextToSpeech(context) { status ->
          if (status != TextToSpeech.SUCCESS || engine == null) {
            promise.reject("E_SYSTEM_TTS", "Android 系统语音初始化失败")
            return@TextToSpeech
          }
          systemTts = engine
          engine?.language = Locale.SIMPLIFIED_CHINESE
          engine?.setSpeechRate(requestedSpeed.coerceIn(0.2, 2.0).toFloat())
          val result = engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "maptolearn-system")
          if (result == TextToSpeech.ERROR) {
            promise.reject("E_SYSTEM_TTS", "Android 系统语音播放失败")
          } else {
            promise.resolve(null)
          }
        }
      } catch (cause: Throwable) {
        promise.reject("E_SYSTEM_TTS", "Android 系统语音不可用：${cause.message}", cause)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    mainHandler.post {
      mediaPlayer?.stopSafely()
      mediaPlayer?.release()
      mediaPlayer = null
      systemTts?.stop()
      promise.resolve(null)
    }
  }

  override fun invalidate() {
    mainHandler.post {
      mediaPlayer?.stopSafely()
      mediaPlayer?.release()
      mediaPlayer = null
      systemTts?.stop()
      systemTts?.shutdown()
      systemTts = null
    }
    executor.execute {
      offlineTts?.release()
      offlineTts = null
    }
    executor.shutdown()
    super.invalidate()
  }

  private fun ensureOfflineTts(): OfflineTts {
    offlineTts?.let { return it }
    // 规则 FST 负责日期、数字和多音字等中文文本的规范化。
    // 线程数根据设备核心数限制在 2 到 4 之间，在推理速度、发热和内存占用之间取平衡。
    // 模型实例只初始化一次，后续朗读直接复用，减少首次之后的等待时间。
    val ruleFsts = listOf("phone.fst", "date.fst", "number.fst", "new_heteronym.fst")
      .joinToString(",") { "$MODEL_DIR/$it" }
    val config = getOfflineTtsConfig(
      modelDir = MODEL_DIR,
      modelName = "model.onnx",
      acousticModelName = "",
      vocoder = "",
      voices = "",
      lexicon = "lexicon.txt",
      dataDir = "",
      dictDir = "",
      ruleFsts = ruleFsts,
      ruleFars = "",
      numThreads = min(4, max(2, Runtime.getRuntime().availableProcessors() / 2)),
    )
    return OfflineTts(assetManager = context.assets, config = config).also { offlineTts = it }
  }

  private fun synthesizeToFile(
    tts: OfflineTts,
    text: String,
    speed: Float,
    speakerId: Int,
    output: File,
  ) {
    // 长文本先按句号和逗号拆成模型更容易处理的短句，再逐句推理。
    // 合并时在相邻句子间插入 80 毫秒静音，既避免句尾粘连，也不会产生明显长停顿。
    // 所有片段必须使用同一采样率，否则合并后的 WAV 将无法正确播放。
    val pieces = splitForInference(text).map { sentence ->
      tts.generate(sentence, sid = speakerId, speed = speed)
    }
    if (pieces.isEmpty() || pieces.any { it.sampleRate != pieces[0].sampleRate }) {
      throw IllegalStateException("模型没有生成有效音频")
    }
    val sampleRate = pieces[0].sampleRate
    val silence = FloatArray((sampleRate * 0.08).toInt())
    val totalSamples = pieces.sumOf { it.samples.size } + silence.size * max(0, pieces.size - 1)
    val combined = FloatArray(totalSamples)
    var offset = 0
    pieces.forEachIndexed { index, audio ->
      audio.samples.copyInto(combined, destinationOffset = offset)
      offset += audio.samples.size
      if (index < pieces.lastIndex) {
        silence.copyInto(combined, destinationOffset = offset)
        offset += silence.size
      }
    }
    if (!GeneratedAudio(combined, sampleRate).save(output.absolutePath)) {
      throw IllegalStateException("语音缓存写入失败")
    }
  }

  private fun playFile(output: File, cacheKey: String, cacheHit: Boolean, promise: Promise) {
    mainHandler.post {
      try {
        mediaPlayer?.stopSafely()
        mediaPlayer?.release()
        mediaPlayer = MediaPlayer().apply {
          setDataSource(output.absolutePath)
          setOnCompletionListener { completed ->
            completed.release()
            if (mediaPlayer === completed) mediaPlayer = null
          }
          prepare()
          start()
        }
        promise.resolve(Arguments.createMap().apply {
          putString("cacheKey", cacheKey)
          putString("filePath", output.absolutePath)
          putBoolean("cacheHit", cacheHit)
        })
      } catch (cause: Throwable) {
        promise.reject("E_TTS_PLAYBACK", "缓存语音播放失败：${cause.message}", cause)
      }
    }
  }

  private fun statusMap(tts: OfflineTts) = Arguments.createMap().apply {
    putString("modelVersion", MODEL_VERSION)
    putInt("sampleRate", tts.sampleRate())
    putInt("numSpeakers", tts.numSpeakers())
  }

  private fun sanitizeForSpeech(source: String): String {
    // 语音模型只保留文字、数字、中文逗号和句号。
    // 冒号改为逗号以保留语义停顿；公式括号、引号和装饰符号替换为空格，
    // 防止模型把符号读成异常音节。连续标点和空白最后会被归一化。
    return source
      .replace(Regex("[：:]"), "，")
      .replace(Regex("[，,、]+"), "，")
      .replace(Regex("[。.!?！？；;\\n\\r]+"), "。")
      .replace(Regex("[“”„‟\\\"＂‘’‚‛'＇()（）\\[\\]【】{}｛｝<>《》〈〉|｜*_#`~^/@\\\\+=\\-—–…·•]"), " ")
      .replace(Regex("[^\\p{L}\\p{N}，。\\s]"), " ")
      .replace(Regex("\\s*，\\s*"), "，")
      .replace(Regex("\\s*。\\s*"), "。")
      .replace(Regex("\\s+"), " ")
      .trim()
  }

  private fun splitForInference(text: String): List<String> {
    // 句号是首选切分边界。单句超过 120 字时再按逗号拆分，并尽量把短分句重新组合到上限内。
    // 返回结果统一补句号，确保模型在每个片段末尾产生自然的收尾语调。
    return text.split('。').flatMap { rawSentence ->
      val sentence = rawSentence.trim()
      if (sentence.length <= 120) {
        listOf(sentence)
      } else {
        sentence.split('，').fold(mutableListOf<String>()) { chunks, part ->
          val cleanPart = part.trim()
          if (cleanPart.isEmpty()) return@fold chunks
          val last = chunks.lastOrNull()
          if (last != null && last.length + cleanPart.length + 1 <= 120) {
            chunks[chunks.lastIndex] = "$last，$cleanPart"
          } else {
            chunks.add(cleanPart)
          }
          chunks
        }
      }
    }.filter { it.isNotBlank() }.map { "$it。" }
  }

  private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

  private fun MediaPlayer.stopSafely() {
    try {
      if (isPlaying) stop()
    } catch (_: IllegalStateException) {
      // The player may already be completed or released.
    }
  }
}
