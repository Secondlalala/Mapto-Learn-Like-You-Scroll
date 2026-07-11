# AI 书籍概念化学习 App MVP

这是一个前后端分离 MVP：上传 `.md` / `.txt` 书籍后，后端按章节/小节切分内容，把每一节交给 DeepSeek 判断重要概念，并生成“章节概览 + 概念卡片”。前端提供可折叠大纲、卡片阅读、收藏、复制、追问、公式渲染和语音朗读。

## 技术栈

- 前端：React + Vite + Tailwind CSS + Framer Motion + KaTeX
- 后端：FastAPI + SQLite + SQLAlchemy
- AI：DeepSeek Chat Completions API
- 语音：本地 Kokoro-82M 服务，失败时回退浏览器 TTS

## 启动

后端：

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

如果没有 `.venv`：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python init_db.py
uvicorn main:app --reload --port 8000
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

打开：http://localhost:5173

## DeepSeek 设置

可以在网页右上角设置里填写 API Key，也可以在 `backend/.env` 中配置：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_MOCK=false
```

网页设置会保存到 `backend/runtime_settings.json`。如果打开 mock 模式，系统只生成示例卡片，不会调用真实 DeepSeek。

## Kokoro-82M 中英语音

当前默认使用本地 Kokoro-82M，并启用中英自动识别：

```env
TTS_ENABLED=true
TTS_API_URL=http://127.0.0.1:9977/tts
TTS_API_STYLE=kokoro
TTS_VOICE=zf_xiaoxiao
TTS_ENGLISH_VOICE=af_heart
TTS_MODEL=kokoro-82m
TTS_LANG_CODE=auto
TTS_DEVICE=auto
```

后端启动时会自动开启 Kokoro 服务，地址是 `http://127.0.0.1:9977/tts`。`TTS_LANG_CODE=auto` 时，中文片段使用 `zf_xiaoxiao`，英文片段使用 `af_heart`，混合文本会分段合成并拼接成一个音频。第一次朗读可能需要加载或下载 voice 文件，耗时会明显更长；之后会快很多。朗读失败时，前端会自动回退到浏览器内置 TTS。

### GPU 加速

如果机器有 NVIDIA GPU，安装 CUDA 版 PyTorch 后，`TTS_DEVICE=auto` 会优先使用 CUDA：

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install --force-reinstall "torch==2.11.0+cu128" --index-url https://download.pytorch.org/whl/cu128
```

检查是否启用成功：

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Kokoro 服务状态页 `http://127.0.0.1:9977/health` 中如果看到 `resolved_auto_device` 为 `cuda`，就表示朗读推理会走 GPU。

## API

- `POST /api/upload` 上传 `.md` / `.txt`
- `GET /api/books` 获取书籍列表
- `GET /api/books/{book_id}` 获取书籍信息
- `GET /api/books/{book_id}/outline` 获取可折叠大纲
- `POST /api/books/{book_id}/generate-cards?force=true` 从头重新生成知识卡片
- `POST /api/books/{book_id}/generate-cards` 从当前进度继续生成知识卡片
- `GET /api/books/{book_id}/cards` 获取知识卡片
- `POST /api/cards/{card_id}/favorite` 切换收藏
- `GET /api/cards/{card_id}/chat` 获取追问记录
- `POST /api/cards/{card_id}/chat` 针对当前知识点追问
- `GET /api/settings/deepseek` 查看 DeepSeek 配置
- `PUT /api/settings/deepseek` 保存 DeepSeek 配置
- `GET /api/settings/tts` 查看 Kokoro/TTS 配置
- `PUT /api/settings/tts` 保存 Kokoro/TTS 配置
- `POST /api/tts/speech` 生成朗读音频
