# MapToLearn Android

这是与网页版并行维护的独立 React Native 客户端。它使用本地 SQLite 保存书籍、卡片、生成位置、收藏、追问和语音缓存；DeepSeek 请求直接发送到云端，不依赖桌面 FastAPI 服务。

## 环境

- Windows 10/11
- Node.js 22
- JDK 17
- Android SDK 35、Build Tools 35.0.0、NDK 26.1 和 CMake 3.22.1
- Android 10（API 29）或更高版本的 ARM64 设备

项目环境检查：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check_android_environment.ps1
```

## 构建 APK

从 `book-concept-app` 目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build_android_apk.ps1 -Offline
```

脚本会在 `C:\mtl-build-<进程号>` 短路径完成依赖安装、测试、类型检查、Lint 和 release 构建，并把带时间戳的 APK 复制到仓库根目录的 `outputs` 文件夹。去掉 `-Offline` 可在缺少 Gradle 缓存时联网下载；检测到本地 `7897` 端口后会自动使用该代理。

安装到已开启 USB 调试的手机：

```powershell
adb install -r ..\outputs\MapToLearn-release-arm64-YYYYMMDD-HHMMSS.apk
```

## 中文离线语音

APK 内置 sherpa-onnx 1.13.4、ONNX Runtime ARM64 和 `vits-icefall-zh-aishell3` 中文模型。模型首次点击朗读时才加载，可在设置页提前点击“加载离线语音模型”。生成后的 WAV 保存在应用缓存中，相同文本、音色、模型和语速会直接复用。

模型支持 174 个说话人，界面提供中文女声和中文男声预设。离线推理在手机 CPU 上运行，不需要网络；Android 系统 TTS 可作为备用模式。第三方许可见 `THIRD_PARTY_NOTICES.md`，许可证文本同时打入 APK。

当前 release APK 使用 Android debug 证书签名，适合内部测试和侧载。发布到应用商店前必须配置长期保管的正式 release keystore；后续升级必须沿用同一签名。
