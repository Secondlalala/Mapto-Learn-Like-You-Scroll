from __future__ import annotations

import json
from json import JSONDecodeError
from typing import Any

import httpx

from services.runtime_settings import get_deepseek_config


class DeepSeekNotConfiguredError(RuntimeError):
    pass


class DeepSeekClient:
    def __init__(self):
        # 每次业务请求创建客户端并读取当前运行时设置，使网页刚保存的配置立即生效。
        self.config = get_deepseek_config()

    async def generate_cards_from_section(
        self,
        section_text: str,
        section_title: str,
        target_count: int = 6,
        include_overview: bool = True,
    ) -> list[dict[str, Any]]:
        # mock 模式用于无密钥演示；真实模式必须明确配置 API Key，不能静默伪造结果。
        if self.config["mock"]:
            return self._mock_section_cards(section_text, section_title, target_count, include_overview)
        if not self.config["api_key"]:
            raise DeepSeekNotConfiguredError("请先在 DeepSeek 设置中填写 API Key。")

        # 导览卡规则根据数据库中是否已有导览动态切换，保证整节只有一个体系入口。
        overview_rule = (
            "第一张必须是 section_overview 类型的导览卡，介绍为什么需要这一节、它能做什么、会展开哪些下级概念，并用一个完整寓言概括本节。"
            if include_overview
            else "不要生成导览卡，只生成 concept 类型的概念卡。"
        )
        prompt = f"""你是一位量子场论课程设计师和教材精读老师。请按“知识体系”而不是零散词条来处理下面这一节教材。

任务：
1. 阅读整节内容，输出 1 到 {target_count} 张学习卡片。
2. {overview_rule}
3. 导览卡 title 使用“导览：小节标题”的形式，card_type 为 "section_overview"。
4. 概念卡 card_type 为 "concept"，只选择对理解本节结构有用的核心概念、公式、推理方法或物理图像。
5. 不要提取目录、参考书、网址、作者机构、页眉页脚、普通英文单词。
6. 每张卡都要服务于本节知识体系：说明它在本节中的位置，以及它和其他概念的关系。
7. fable 要完整、具体、较长，建议 250-450 字。导览卡寓言概括整节；概念卡寓言解释该概念。
8. 所有公式必须使用标准 LaTeX。行内公式用 $...$，整行公式用 $$...$$。
9. formula 字段只写一个最核心的公式或空字符串。不要 Markdown 代码块，不要图片，不要 Unicode 近似公式。可以写裸公式，也可以写 $$...$$ 包裹的公式。
10. formula_explanation 必须逐个解释公式符号和物理含义，也要用 LaTeX 表示符号。
11. 必须只输出 JSON 数组，不要 Markdown，不要额外说明。

JSON 对象格式：
{{
  "card_type": "section_overview 或 concept",
  "title": "卡片标题",
  "source_text": "支撑卡片的原文片段",
  "one_sentence": "一句话说明",
  "simple_explanation": "系统性解释，说明本卡在本节中的作用",
  "fable": "完整寓言",
  "formula": "$$S = \\\\int d^4x\\\\,\\\\mathcal{{L}}$$",
  "formula_explanation": "$S$ 表示作用量，$\\\\mathcal{{L}}$ 表示拉格朗日密度，$d^4x$ 表示对四维时空积分。",
  "prerequisites": ["前置知识"],
  "related_concepts": ["关联概念"],
  "questions": ["推荐追问1", "推荐追问2", "推荐追问3"]
}}

小节标题：
{section_title}

小节内容：
{section_text}"""
        # 卡片属于结构化抽取任务，使用较低温度减少字段遗漏和 JSON 波动。
        content = await self._chat(prompt, temperature=0.25)
        try:
            data = _json_from_text(content)
        except JSONDecodeError as exc:
            raise RuntimeError(f"DeepSeek 返回内容不是合法 JSON：{content[:500]}") from exc
        # 即便 JSON 合法，也只接受“对象数组”；其他类型视为本轮没有可保存卡片。
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    async def answer_question(self, card: Any, question: str) -> str:
        # 追问提示包含卡片原文、已有解释和核心公式，让回答限定在当前知识点上下文。
        if self.config["mock"]:
            return (
                f"可以这样理解：你问的是“{question}”。围绕 {card.title}，先看它在当前小节中的位置，"
                f"再看它依赖的前提和关联概念。卡片中的核心提示是：{card.one_sentence}"
            )
        if not self.config["api_key"]:
            raise DeepSeekNotConfiguredError("请先在 DeepSeek 设置中填写 API Key。")

        prompt = f"""你是一位耐心、准确、擅长公式排版的量子场论老师。

当前卡片类型：{getattr(card, "card_type", "concept")}

当前概念/导览：
{card.title}

所属章节：
{card.chapter}

原文片段：
{card.source_text}

已有解释：
{card.simple_explanation}

核心公式：
{card.formula}

用户问题：
{question}

回答要求：
1. 用清晰分段回答，避免一整坨文字。
2. 所有公式必须使用标准 LaTeX。行内公式用 $...$，整行公式用 $$...$$。
3. 不要使用 Unicode 近似符号替代 LaTeX，例如不要只写 ∫、ψ、ϕ；应写 $\\int$、$\\psi$、$\\phi$。
4. 解释每个公式符号的含义。
5. 回答要服务于“本节知识体系”，说明它和上下级概念的关系。"""
        # 追问允许略高温度以获得更自然的教学表达，但仍保持较低随机性。
        return await self._chat(prompt, temperature=0.35)

    async def _chat(self, prompt: str, temperature: float = 0.35) -> str:
        # DeepSeek 使用与 OpenAI Chat Completions 兼容的请求格式，密钥只放在后端请求头。
        url = f"{self.config['api_base'].rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {self.config['api_key']}"}
        payload = {
            "model": self.config["model"],
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
        }
        # 超时单独转换为可读错误，用户可以据此缩短小节或稍后重试。
        try:
            async with httpx.AsyncClient(timeout=35) as client:
                resp = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise RuntimeError("DeepSeek API 请求超时，请稍后重试或减少单次生成内容。") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"DeepSeek API 网络连接失败：{exc}") from exc
        # 同时校验 HTTP 状态和响应 JSON 层级，避免把网关错误页当作模型答案。
        try:
            if resp.status_code >= 400:
                detail = resp.text[:500]
                raise RuntimeError(f"DeepSeek API 调用失败：HTTP {resp.status_code} {detail}")
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, JSONDecodeError) as exc:
            raise RuntimeError(f"DeepSeek API 返回格式异常：{resp.text[:500]}") from exc

    def _mock_section_cards(
        self,
        section_text: str,
        section_title: str,
        target_count: int,
        include_overview: bool,
    ) -> list[dict[str, Any]]:
        # mock 数据保持与真实接口完全相同的字段结构，便于前端离线联调。
        cards: list[dict[str, Any]] = []
        if include_overview:
            cards.append(
                {
                    "card_type": "section_overview",
                    "title": f"导览：{section_title}",
                    "source_text": section_text[:900],
                    "one_sentence": f"这一节建立 {section_title} 的学习地图。",
                    "simple_explanation": "真实模式下，DeepSeek 会先生成一张导览卡，说明本节为什么重要、能解决什么问题，以及会展开哪些下级概念。",
                    "fable": "一位学生进入一座新城市。旧办法是随机走进每条街，把看到的招牌都记下来；新办法是先登上钟楼，看清城市分区、主干道和桥梁。导览卡就像这座钟楼，它不急着解释每块砖，而是先告诉学生：这座城为什么建在这里，哪条路通向市场，哪条路通向城门，哪些建筑之后需要细看。等地图在脑中成形，再走进街巷时，每个细节都有了位置。",
                    "formula": "",
                    "formula_explanation": "",
                    "prerequisites": ["本节上下文", "章节目标"],
                    "related_concepts": ["下级概念", "学习路径"],
                    "questions": ["这一节解决什么问题？", "本节有哪些核心概念？", "这些概念如何连接？"],
                }
            )
        cards.append(
            {
                "card_type": "concept",
                "title": "示例概念",
                "source_text": section_text[:900],
                "one_sentence": "这是 mock 模式下的概念卡示例。",
                "simple_explanation": "关闭 mock 并填写 DeepSeek API Key 后，系统会按小节生成真实概念卡。",
                "fable": "老师把一节课拆成地图和路标：地图先说明方向，路标再指向关键转弯。概念卡就是那些路标，它们不会孤零零出现，而是服务于整节课的路径。",
                "formula": "$$S = \\int d^4x\\,\\mathcal{L}$$",
                "formula_explanation": "$S$ 是作用量，$\\mathcal{L}$ 是拉格朗日密度，$d^4x$ 表示四维时空体积元。",
                "prerequisites": ["DeepSeek API Key"],
                "related_concepts": ["导览卡", "概念卡"],
                "questions": ["如何生成真实卡片？", "为什么按小节生成？", "如何继续生成后续内容？"],
            }
        )
        return cards[:target_count]


def _json_from_text(text: str) -> Any:
    # 优先解析纯 JSON；若模型意外包裹 Markdown 代码块或说明文字，再截取首尾 JSON。
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.removeprefix("json").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # 同时兼容对象和数组起始符，并选择最早出现的位置作为候选 JSON 起点。
        start_candidates = [i for i in [cleaned.find("{"), cleaned.find("[")] if i >= 0]
        if not start_candidates:
            raise
        start = min(start_candidates)
        end = max(cleaned.rfind("}"), cleaned.rfind("]"))
        return json.loads(cleaned[start : end + 1])
