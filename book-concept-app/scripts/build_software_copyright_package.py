from __future__ import annotations

import csv
import json
import os
import re
import shutil
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "docs" / "software-copyright" / "MapToLearn_V1.0"
OUTPUT_ROOT = Path(os.environ.get("MAPTOLEARN_COPYRIGHT_OUTPUT", DEFAULT_OUTPUT_ROOT))
SCREENSHOT_ROOT = DEFAULT_OUTPUT_ROOT / "screenshots"
SOFTWARE_NAME = "MapToLearn AI书籍概念化学习软件"
VERSION = "V1.0"
FULL_NAME = f"{SOFTWARE_NAME} {VERSION}"
BODY_FONT = "SimSun"
HEADING_FONT = "Microsoft YaHei"
INK = "1F2933"
ACCENT = "285A76"
MUTED = "68737D"
LIGHT_FILL = "EEF3F6"
WAIT_FILL = "FFF2CC"
OFFICIAL_RULE_URL = "https://www.ncac.gov.cn/xxfb/flfg/bmgz/202410/t20241015_869486.html"


def set_run_font(run, name=BODY_FONT, size=10.5, bold=None, color=INK, italic=None):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    return run


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    tr_pr.append(repeat)


def set_table_geometry(table, widths_dxa):
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(sum(widths_dxa)))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_layout = tbl_pr.find(qn("w:tblLayout"))
    if tbl_layout is None:
        tbl_layout = OxmlElement("w:tblLayout")
        tbl_pr.append(tbl_layout)
    tbl_layout.set(qn("w:type"), "fixed")
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        grid_col = OxmlElement("w:gridCol")
        grid_col.set(qn("w:w"), str(width))
        grid.append(grid_col)
    for row in table.rows:
        for index, cell in enumerate(row.cells):
            width = widths_dxa[min(index, len(widths_dxa) - 1)]
            tc_w = cell._tc.get_or_add_tcPr().find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                cell._tc.get_or_add_tcPr().append(tc_w)
            tc_w.set(qn("w:w"), str(width))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_run_font(paragraph.add_run("第 "), size=8.5, color=MUTED)
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    paragraph._p.append(fld)
    set_run_font(paragraph.add_run(" 页"), size=8.5, color=MUTED)


def configure_document(doc, document_label):
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.35)
    section.right_margin = Cm(2.35)
    section.header_distance = Cm(1.0)
    section.footer_distance = Cm(1.0)

    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.25

    style_values = {
        "Title": (HEADING_FONT, 24, True, INK, 0, 10),
        "Subtitle": (HEADING_FONT, 12, False, MUTED, 0, 8),
        "Heading 1": (HEADING_FONT, 16, True, ACCENT, 16, 8),
        "Heading 2": (HEADING_FONT, 13, True, ACCENT, 12, 6),
        "Heading 3": (HEADING_FONT, 11.5, True, "365F75", 8, 4),
    }
    for style_name, (font, size, bold, color, before, after) in style_values.items():
        style = doc.styles[style_name]
        style.font.name = font
        style._element.rPr.rFonts.set(qn("w:eastAsia"), font)
        style.font.size = Pt(size)
        style.font.bold = bold
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    for list_name in ("List Bullet", "List Number"):
        style = doc.styles[list_name]
        style.font.name = BODY_FONT
        style._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
        style.font.size = Pt(10.5)
        style.paragraph_format.space_after = Pt(4)
        style.paragraph_format.line_spacing = 1.2

    header = section.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_run_font(p.add_run(FULL_NAME), HEADING_FONT, 8.5, True, MUTED)
    set_run_font(p.add_run(f"  |  {document_label}"), HEADING_FONT, 8.5, False, MUTED)
    footer = section.footer
    add_page_number(footer.paragraphs[0])


def new_document(label):
    doc = Document()
    configure_document(doc, label)
    return doc


def add_cover(doc, document_title, subtitle):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(74)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run("软件著作权登记材料"), HEADING_FONT, 11, True, ACCENT)
    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run(document_title), HEADING_FONT, 24, True, INK)
    p = doc.add_paragraph(style="Subtitle")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run(FULL_NAME), HEADING_FONT, 14, True, ACCENT)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(16)
    set_run_font(p.add_run(subtitle), BODY_FONT, 10.5, False, MUTED)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(100)
    set_run_font(p.add_run("著作权人：个人（身份信息待申请人补充）"), BODY_FONT, 11, True, INK)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run("材料版本：2026年8月编制"), BODY_FONT, 10.5, False, MUTED)
    doc.add_page_break()


def add_body(doc, text, bold_lead=None):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    if bold_lead and text.startswith(bold_lead):
        set_run_font(p.add_run(bold_lead), bold=True)
        set_run_font(p.add_run(text[len(bold_lead):]))
    else:
        set_run_font(p.add_run(text))
    return p


def add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        set_run_font(p.add_run(item))


def add_steps(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        set_run_font(p.add_run(item))


def add_kv_table(doc, rows, wait_labels=()):
    table = doc.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    set_table_geometry(table, [2500, 6860])
    header = table.rows[0]
    set_repeat_table_header(header)
    for idx, value in enumerate(("项目", "填报内容")):
        set_cell_shading(header.cells[idx], LIGHT_FILL)
        p = header.cells[idx].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(p.add_run(value), HEADING_FONT, 9.5, True, ACCENT)
    for label, value in rows:
        cells = table.add_row().cells
        p = cells[0].paragraphs[0]
        set_run_font(p.add_run(label), HEADING_FONT, 9.5, True, INK)
        p = cells[1].paragraphs[0]
        set_run_font(p.add_run(value), BODY_FONT, 9.5, False, INK)
        if label in wait_labels or value.startswith("[待填写"):
            set_cell_shading(cells[1], WAIT_FILL)
    return table


def add_matrix(doc, headers, rows, widths):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    set_table_geometry(table, widths)
    set_repeat_table_header(table.rows[0])
    for index, value in enumerate(headers):
        set_cell_shading(table.rows[0].cells[index], LIGHT_FILL)
        p = table.rows[0].cells[index].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(p.add_run(value), HEADING_FONT, 9, True, ACCENT)
    for row in rows:
        cells = table.add_row().cells
        for index, value in enumerate(row):
            p = cells[index].paragraphs[0]
            set_run_font(p.add_run(str(value)), BODY_FONT, 8.8, False, INK)
    return table


def add_screenshot(doc, filename, caption, width_cm=9.2):
    path = SCREENSHOT_ROOT / filename
    if not path.exists():
        add_body(doc, f"[截图缺失：{filename}]")
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    run.add_picture(str(path), width=Cm(width_cm))
    p.paragraph_format.keep_with_next = True
    caption_p = doc.add_paragraph()
    caption_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(caption_p.add_run(caption), BODY_FONT, 9, False, MUTED)


def build_application_draft():
    source_line_count = sum(
        len(path.read_text(encoding="utf-8", errors="replace").splitlines())
        for path in source_files()
    )
    doc = new_document("在线申请表填报底稿")
    add_cover(doc, "软件著作权登记申请信息表", "用于中国版权保护中心在线登记系统填报；本文件不是官方申请表")
    doc.add_heading("1. 使用说明", level=1)
    add_body(doc, "本底稿根据项目当前源码、数据库结构、运行界面和构建配置整理。提交时应在官方登记系统逐项录入，由系统生成正式申请表后打印或按系统要求签署。所有黄色字段必须由申请人依据身份证件和真实联系方式补齐。")
    add_body(doc, "一致性要求：软件名称、版本号、著作权人姓名应在在线申请表、源程序材料、文档材料和身份证明中保持完全一致。")

    doc.add_heading("2. 软件基本信息", level=1)
    basic_rows = [
        ("软件全称", SOFTWARE_NAME),
        ("版本号", VERSION),
        ("材料统一名称", FULL_NAME),
        ("软件简称", "MapToLearn"),
        ("软件分类", "应用软件 / 教育学习软件"),
        ("开发方式", "独立开发（申请人提交前确认）"),
        ("权利取得方式", "原始取得"),
        ("权利范围", "全部权利"),
        ("开发完成日期", "建议填写：2026年8月9日（提交前确认）"),
        ("首次发表状态", "未发表（如已公开发布或正式对外提供，需按事实修改）"),
        ("版本说明", "首次登记版本"),
        ("源程序量", f"约{source_line_count:,}行自有生产源码；鉴别材料提交前、后各连续30页"),
    ]
    add_kv_table(doc, basic_rows)

    doc.add_heading("3. 著作权人信息（个人）", level=1)
    owner_rows = [
        ("姓名", "[待填写：必须与身份证完全一致]"),
        ("国籍", "[待填写]"),
        ("证件类型", "居民身份证（如适用）"),
        ("证件号码", "[待填写：身份证号码]"),
        ("省份 / 城市", "[待填写]"),
        ("详细联系地址", "[待填写]"),
        ("邮政编码", "[待填写]"),
        ("手机号码", "[待填写]"),
        ("电子邮箱", "[待填写]"),
        ("联系人", "[待填写：通常为申请人本人]"),
    ]
    add_kv_table(doc, owner_rows, wait_labels=tuple(label for label, _ in owner_rows))

    doc.add_heading("4. 开发与运行环境", level=1)
    env_rows = [
        ("开发硬件环境", "x86-64个人计算机；建议8GB以上内存"),
        ("开发操作系统", "Windows 10/11 64位"),
        ("开发工具", "Python 3.12、Node.js、npm、Vite、Git"),
        ("开发语言", "Python、JavaScript/JSX、CSS"),
        ("运行硬件环境", "x86-64个人计算机；建议8GB以上内存"),
        ("运行操作系统", "Windows 10/11 64位"),
        ("运行支撑环境", "现代浏览器、Python/FastAPI、SQLite及可选本地TTS运行库"),
        ("外部服务", "DeepSeek Chat Completions API（由用户自行配置API Key）"),
    ]
    add_kv_table(doc, env_rows)

    doc.add_heading("5. 软件功能与技术特点", level=1)
    add_body(doc, "开发目的：将Markdown或TXT书籍转化为具有章节体系、通俗解释、寓言故事、核心公式和可追问内容的学习卡片，降低专业书籍的理解与复习成本。")
    add_body(doc, "面向领域：教育学习、专业阅读、知识管理和人工智能辅助学习。")
    add_body(doc, "主要功能：支持书籍导入、章节与小节识别、按小节调用DeepSeek生成章节导览及概念卡片、折叠大纲、沉浸式上下滑动阅读、原文查看、复制、收藏、阅读进度恢复、公式渲染、上下文追问、语音朗读、下一节后台生成和本地持久化。")
    add_body(doc, "技术特点：本次登记范围仅为Web版。软件采用React与FastAPI前后端分离架构，SQLite保存书籍、卡片、生成进度和对话；生成过程按小节限量处理并记录游标；KaTeX渲染LaTeX公式；TTS支持浏览器、Kokoro和Sherpa中英文模式及音频缓存。")

    doc.add_heading("6. 申请人确认事项", level=1)
    add_bullets(doc, [
        "确认个人为本软件依法享有著作权的权利人，且不存在未披露的合作开发、委托开发或职务开发关系。",
        "确认2026年8月9日是否为可申报的开发完成日期；如不准确，应按真实日期修改全部材料。",
        "确认软件是否未发表；如曾公开发布、销售、上线应用商店或正式提供下载，应如实填写首次发表日期和地点。",
        "提交身份证明复印件或登记系统要求的电子身份证明，并完成申请人签名。",
        "本软件使用开源框架、第三方模型和DeepSeek云服务；登记权利范围仅覆盖申请人原创的业务代码、交互流程、数据组织和文档。",
    ])
    path = OUTPUT_ROOT / "01_软件著作权登记申请信息表_填报底稿.docx"
    doc.save(path)
    return path


def build_user_manual():
    doc = new_document("用户操作说明书")
    add_cover(doc, "用户操作说明书", "Web版主要功能、操作流程及异常处理")

    doc.add_heading("1. 软件概述", level=1)
    add_body(doc, f"{FULL_NAME}用于把Markdown或TXT书籍整理为系统化学习卡片。软件以章节和小节为组织单位，优先生成章节导览，再生成核心概念卡片，从而避免知识点零散。")
    add_bullets(doc, [
        "输入：Markdown（.md）或纯文本（.txt）书籍。",
        "处理：章节识别、小节切分、DeepSeek结构化生成、公式规范化与本地保存。",
        "输出：章节导览、概念解释、寓言故事、核心公式、知识关系和推荐追问。",
        "终端：Windows计算机上的现代Web浏览器。",
    ])

    doc.add_heading("2. 系统要求与启动", level=1)
    add_body(doc, "Windows Web版需要后端服务和前端服务同时运行。桌面上的“MapToLearn 启停控制”快捷方式提供启动、关闭和打开网页三个按钮。控制面板显示前后端当前状态，启动成功后默认打开 http://127.0.0.1:5173/。")
    add_steps(doc, [
        "双击桌面“MapToLearn 启停控制”快捷方式。",
        "点击“启动应用”，等待状态变为后端和前端均运行中。",
        "点击“打开网页”进入书库；使用结束后可点击“关闭应用”。",
    ])

    doc.add_page_break()
    doc.add_heading("3. 上传书籍与书库", level=1)
    add_screenshot(doc, "01_upload_library.png", "图1  上传与书库首页")
    add_steps(doc, [
        "点击或拖拽上传区域，选择.md或.txt文件。",
        "系统校验文件扩展名，自动识别文本编码并保存原文。",
        "上传成功后，书籍出现在“已上传书籍”列表中。",
        "点击书籍条目进入书籍详情页；书库会显示当前卡片数量。",
    ])
    add_body(doc, "上传内容为空、文件格式不支持或编码无法识别时，页面会显示错误信息。原始书籍文本和切分结果保存在本地数据库中。")

    doc.add_page_break()
    doc.add_heading("4. DeepSeek与语音设置", level=1)
    add_screenshot(doc, "02_settings.png", "图2  模型与语音设置")
    add_body(doc, "点击顶部“设置”打开模型与语音设置面板。DeepSeek区域用于配置API Key、API Base和模型名称。API Key由用户自行申请并输入，界面不会在截图或返回数据中显示完整密钥。")
    add_bullets(doc, [
        "真实模式：关闭mock，填写有效DeepSeek API Key，系统调用云端模型生成内容。",
        "Mock模式：不调用外部服务，仅生成用于界面验证的示例卡片。",
        "浏览器TTS：启动快，音色由操作系统和浏览器决定。",
        "Kokoro模式：本地模型，支持语音缓存和中英文分段。",
        "Sherpa模式：原生ONNX推理，可选择中文、英文音色并预加载模型。",
        "阅读速度：支持0.2至2.0倍范围，设置会保存供下次使用。",
    ])

    doc.add_page_break()
    doc.add_heading("5. 生成知识卡片", level=1)
    add_screenshot(doc, "03_book_cards.png", "图3  书籍详情与知识卡片列表")
    add_body(doc, "书籍详情页显示文件名、卡片总数和已处理小节位置。“继续生成”从当前游标处理下一节；“从头生成”会清空该书旧卡片和对话，再从第一节重新生成。")
    add_steps(doc, [
        "确认DeepSeek设置可用，进入目标书籍。",
        "首次使用选择“继续生成”；需要完全重做时选择“从头生成”。",
        "系统把一个小节的正文交给DeepSeek，单次最多返回20张卡片。",
        "每节优先生成一张导览卡，再生成若干概念卡。",
        "生成完成后游标前移，下次继续生成后续小节。",
    ])

    doc.add_page_break()
    doc.add_heading("6. 沉浸式卡片阅读", level=1)
    add_screenshot(doc, "04_reader.png", "图4  单卡沉浸阅读界面")
    add_body(doc, "点击“开始阅读”后，软件恢复上次退出时的卡片位置。中间区域每屏展示一张卡片；上下滚动或滑动切换卡片。桌面宽屏下，左侧显示可折叠文章大纲，右侧显示当前卡片的追问面板。")
    add_bullets(doc, [
        "导览卡说明本节为什么需要、能解决什么问题以及下级概念。",
        "概念卡包含一句话解释、通俗解释、寓言故事、核心公式、前置知识和关联概念。",
        "“复制”把当前卡片主要文字写入剪贴板。",
        "“收藏”切换当前卡片收藏状态并写入数据库。",
        "“查看原文片段”展开生成该卡片所依据的书籍原文。",
    ])

    doc.add_page_break()
    doc.add_heading("7. 公式与知识关系", level=1)
    add_screenshot(doc, "05_formula_card.png", "图5  LaTeX核心公式渲染")
    add_body(doc, "DeepSeek被要求以标准LaTeX格式返回公式。前端在显示前统一识别行内公式、块级公式和裸公式，并使用KaTeX进行渲染。公式说明逐项解释符号及其物理或数学含义。")
    add_body(doc, "点击“展开知识关系”可以查看前置知识和关联概念。公式缺失时界面明确显示“无明确公式”，避免把普通文本误当成数学表达式。")

    doc.add_heading("8. 追问当前卡片", level=1)
    add_body(doc, "追问面板绑定当前卡片。用户可以点击推荐问题或输入自定义问题。请求会携带卡片标题、章节、原文片段、已有解释和核心公式；回答按段落显示并继续支持LaTeX公式渲染。用户问题与模型回答保存在当前卡片的对话记录中。")
    add_steps(doc, [
        "切换到需要深入理解的卡片。",
        "点击一个推荐问题，或在输入框中填写问题。",
        "点击发送并等待回答；生成期间避免重复提交。",
        "切换回该卡片时可继续查看已保存的对话。",
    ])

    doc.add_heading("9. 语音朗读", level=1)
    add_body(doc, "卡片顶部的朗读按钮默认朗读标题、一句话解释和当前段落；“读寓言”只朗读寓言故事。远程或本地模型生成的音频按文本、语速、音色和模型版本建立缓存，相同内容再次播放时优先复用缓存。")
    add_body(doc, "输入TTS前，系统规范标点和空白，并按句号拆分长文本。模型未加载时可按需预加载；模型不可用时，Web版可回退到浏览器语音。")

    doc.add_heading("10. 大纲与后台生成", level=1)
    add_body(doc, "阅读器左侧大纲按章节编号构建可折叠树。点击小节跳到该节已有卡片。开启“阅读时立即自动生成下一节”后，进入当前小节时系统检查下一节是否已生成；若未生成，则在后台发起一次生成并显示进度。")
    add_body(doc, "自动生成通过生成游标和请求去重状态避免重复处理同一小节。生成失败时会显示错误信息，用户可以手动点击“生成下一节”重试。")

    doc.add_heading("11. 数据保存与隐私", level=1)
    add_bullets(doc, [
        "书籍正文、卡片、收藏、生成游标和对话保存在本机SQLite数据库。",
        "DeepSeek API Key保存在本机运行设置中，设置查询仅向前端返回掩码。",
        "调用DeepSeek时会发送当前小节或当前卡片上下文，用户应确认上传内容有权用于云端处理。",
        "TTS缓存仅用于重复播放；清理应用缓存后可重新生成。",
        "源代码鉴别材料不包含API Key、数据库内容、上传书籍或模型权重。",
    ])

    doc.add_heading("12. 常见问题", level=1)
    faq = [
        ("网页显示Failed to fetch", "确认控制面板中前后端均为运行中，并检查8000和5173端口。"),
        ("卡片生成速度慢", "系统按小节调用云API；网络、文本长度和模型响应时间都会影响速度。"),
        ("公式显示为普通字符", "确认返回内容使用LaTeX定界符；重新生成不规范卡片。"),
        ("首次朗读等待较长", "首次使用需要加载或下载模型；后续将复用模型实例和音频缓存。"),
        ("Sherpa语音不可用", "确认后端语音依赖和模型已安装，并在设置页执行模型预加载。"),
        ("书籍记录不见了", "确认后端工作目录和数据库路径正确，不要删除backend/app.db。"),
    ]
    add_matrix(doc, ["问题", "处理方法"], faq, [2800, 6560])

    doc.add_heading("13. 正常退出", level=1)
    add_body(doc, "关闭浏览器不会删除数据。需要释放本机服务时，打开桌面控制面板并点击“关闭应用”。如需迁移或重装，应先备份backend/app.db及必要的本地配置。")
    path = OUTPUT_ROOT / "02_用户操作说明书.docx"
    doc.save(path)
    return path


def build_design_manual():
    doc = new_document("软件设计说明书")
    add_cover(doc, "软件设计说明书", "系统架构、数据设计、模块职责、接口及安全边界")

    doc.add_heading("1. 文档目的与范围", level=1)
    add_body(doc, "本文档描述MapToLearn V1.0 Web版的总体架构、核心业务流程、数据库结构、接口约定、人工智能调用、语音服务和运行维护设计。本次登记范围仅为Web版，文档内容以Web项目源码和实际运行结果为依据。")

    doc.add_heading("2. 总体架构", level=1)
    add_body(doc, "Web版由浏览器前端、FastAPI后端、SQLite数据库和可选本地TTS服务组成分层结构。React前端通过JSON API访问后端；后端负责文件解析、章节切分、DeepSeek请求、卡片持久化、对话和TTS统一接口。")
    architecture_rows = [
        ("表现层", "React/Vite Web界面", "上传、书库、大纲、卡片、设置、追问"),
        ("接口层", "FastAPI路由", "请求校验、JSON响应、错误映射"),
        ("业务层", "解析、切分、卡片生成、对话、TTS协调", "维护生成顺序和上下文"),
        ("数据层", "SQLite、SQLAlchemy", "书籍、卡片、游标、收藏和对话"),
        ("外部能力", "DeepSeek API；Kokoro/Sherpa/系统TTS", "内容生成和语音合成"),
    ]
    add_matrix(doc, ["层次", "实现", "职责"], architecture_rows, [1700, 3200, 4460])

    doc.add_heading("3. Web前端模块", level=1)
    frontend_rows = [
        ("App", "页面状态路由、书库刷新、设置面板"),
        ("UploadPage / UploadBox", "文件选择、上传状态和错误提示"),
        ("BookPage", "卡片列表、继续生成、从头生成、开始阅读"),
        ("CardReaderPage", "阅读进度恢复、单卡分页、大纲、后台生成"),
        ("ConceptCard", "解释、寓言、公式、知识关系、原文、复制和收藏"),
        ("ChatPanel", "推荐问题、自定义追问、对话历史和LaTeX回答"),
        ("DeepSeekSettings", "模型、API和多TTS引擎配置"),
        ("VoiceButton", "文本清洗、TTS调用、缓存音频播放和回退"),
        ("RichText", "Markdown式段落和KaTeX公式渲染"),
        ("OutlineTree", "编号识别、层级构建、折叠与跳转"),
    ]
    add_matrix(doc, ["模块", "主要职责"], frontend_rows, [3000, 6360])

    doc.add_heading("4. 后端模块", level=1)
    backend_rows = [
        ("upload", "校验扩展名、保存文件、读取编码、切分并创建书籍"),
        ("books", "书库、详情、大纲和按游标生成卡片"),
        ("cards", "按小节排序读取卡片和收藏切换"),
        ("chat", "绑定当前卡片上下文调用DeepSeek并保存消息"),
        ("settings", "读取、掩码和更新DeepSeek/TTS运行设置"),
        ("tts", "预加载模型、合成音频、返回缓存命中标记"),
        ("file_parser", "MD/TXT校验、chardet编码识别和UTF-8规范化"),
        ("concept_splitter", "章节标题识别、段落聚合和长文本分块"),
        ("card_generator", "小节加载、前置内容过滤、游标和卡片保存"),
        ("deepseek_client", "Prompt构造、HTTP调用、JSON提取和异常转换"),
    ]
    add_matrix(doc, ["模块", "主要职责"], backend_rows, [3000, 6360])

    doc.add_heading("5. 数据模型", level=1)
    add_body(doc, "Web版使用SQLite和SQLAlchemy。删除书籍时卡片级联删除；删除卡片时对话级联删除。数组字段在SQLite中以JSON文本保存，通过Schema转换为字符串数组。")
    data_rows = [
        ("Book", "id、title、filename、file_type、raw_text、chunks_json、generation_cursor、created_at", "书籍原文、切分结果和生成位置"),
        ("ConceptCard", "book_id、section_index、card_type、chapter、title、source_text、one_sentence、simple_explanation、fable、formula等", "导览卡或概念卡"),
        ("ChatMessage", "card_id、role、content、created_at", "当前卡片的用户与助手消息"),
    ]
    add_matrix(doc, ["实体", "关键字段", "用途"], data_rows, [1800, 4800, 2760])

    doc.add_heading("6. 文本解析与章节切分", level=1)
    add_body(doc, "上传路由仅接受.md和.txt。文件保存后由chardet辅助判断编码，解码结果统一为Python Unicode字符串。切分器按空行分块，并识别Markdown井号标题、中文“第X章/节/篇/部”、Chapter N和Lecture N。")
    add_body(doc, "同一标题下的段落先聚合，再按最大字符数拆分。卡片生成阶段进一步按小节长度限制切分，续段标题追加“续N”。系统过滤目录、参考书、网址和机构信息等疑似前置材料。")

    doc.add_heading("7. 卡片生成流程", level=1)
    add_steps(doc, [
        "读取Book.chunks_json并转换为有序小节。",
        "根据generation_cursor选择尚未处理的小节。",
        "把完整小节或长度受控的续段发送给DeepSeek。",
        "要求返回JSON数组，第一张优先为section_overview，其余为concept。",
        "校验标题、卡片类型和数组字段，过滤目录及无意义词条。",
        "保存卡片并把游标前移；单次最多处理一个小节且不超过20张卡片。",
        "阅读器检测下一节未生成时触发同一增量接口并显示进度。",
    ])

    doc.add_heading("8. DeepSeek接口设计", level=1)
    add_body(doc, "服务使用Chat Completions兼容接口，默认模型为deepseek-chat。API Key仅在请求Authorization头中发送；后端设置查询只返回掩码。请求超时、HTTP错误和JSON结构异常会转换为可读错误。")
    add_body(doc, "卡片Prompt强调知识体系、章节导览、较长寓言、核心公式、符号解释和三个推荐问题。公式必须使用标准LaTeX，行内公式使用美元定界符，块级公式使用双美元定界符。追问Prompt携带当前卡片与原文，不发送整本书。")

    doc.add_heading("9. API接口", level=1)
    api_rows = [
        ("POST", "/api/upload", "上传MD/TXT并创建Book"),
        ("GET", "/api/books", "查询书库与卡片数量"),
        ("GET", "/api/books/{id}", "查询书籍详情"),
        ("GET", "/api/books/{id}/outline", "查询小节大纲和生成状态"),
        ("POST", "/api/books/{id}/generate-cards", "增量或强制重建卡片"),
        ("GET", "/api/books/{id}/cards", "查询有序卡片"),
        ("POST", "/api/cards/{id}/favorite", "切换收藏"),
        ("GET/POST", "/api/cards/{id}/chat", "读取或提交追问"),
        ("GET/PUT", "/api/settings/deepseek", "读取或更新模型设置"),
        ("GET/PUT", "/api/settings/tts", "读取或更新语音设置"),
        ("POST", "/api/tts/preload", "预加载语音模型"),
        ("POST", "/api/tts/speech", "合成音频并返回缓存标记"),
    ]
    add_matrix(doc, ["方法", "路径", "用途"], api_rows, [1500, 3900, 3960])

    doc.add_heading("10. 阅读状态与交互", level=1)
    add_body(doc, "Web版使用localStorage按book_id保存cardId、索引、小节索引和时间戳。进入阅读器后优先恢复cardId，若卡片已变化则回退到保存的索引。滚动位置换算为当前卡片索引，并触发收藏、复制、语音和追问等局部交互。")

    doc.add_heading("11. LaTeX公式渲染", level=1)
    add_body(doc, "前端对formula字段执行规范化：保留已有块级或行内定界符；把\\[...\\]和\\(...\\)转换为美元定界符；裸公式自动包装为块级公式。RichText负责识别文本中的公式片段并交给KaTeX渲染。")

    doc.add_heading("12. 语音体系", level=1)
    add_body(doc, "Web版语音统一由VoiceButton读取设置。浏览器模式使用Web Speech API；Kokoro模式通过本地服务生成音频；Sherpa模式在FastAPI进程内使用ONNX模型。中英文混合文本按字符语言拆段，生成后插入短静音并拼接。")

    doc.add_heading("13. 配置与敏感信息", level=1)
    add_bullets(doc, [
        "DeepSeek API Key从.env或运行设置读取，不写入源码和软著材料。",
        "设置查询返回masked_key，避免前端读取完整密钥。",
        "源程序包排除runtime_settings.json、数据库、上传文件、日志、模型权重和签名材料。",
        "调用云服务前由用户主动配置；上传书籍的版权和数据合规由用户负责确认。",
    ])

    doc.add_heading("14. 可靠性与性能", level=1)
    add_bullets(doc, [
        "按小节生成和字符上限控制单次Prompt规模，减少超时与上下文漂移。",
        "generation_cursor保证重启后可以从已完成位置继续。",
        "前端请求去重避免同一下一节被重复触发。",
        "TTS模型实例、下载文件和音频结果均复用缓存。",
        "数据库关系配置级联删除，避免孤立卡片和消息。",
        "桌面控制器通过端口和HTTP健康状态显示服务状态。",
    ])

    doc.add_heading("15. Web构建与部署", level=1)
    add_body(doc, "前端使用Vite执行开发服务和生产构建，后端使用Uvicorn运行FastAPI。桌面控制器负责启动、关闭和检测5173前端端口及8000后端端口，并通过HTTP健康接口确认服务状态。")
    add_body(doc, "生产部署时可将frontend/dist交由静态Web服务器托管，并通过反向代理访问FastAPI；本地单机模式则继续使用SQLite保存数据。部署环境必须通过环境变量或本地运行设置提供DeepSeek密钥，不得写入前端构建产物。")

    doc.add_heading("16. 第三方组件与权利边界", level=1)
    third_party_rows = [
        ("React", "MIT", "Web用户界面框架"),
        ("FastAPI / SQLAlchemy", "开源许可证", "API与数据访问框架"),
        ("KaTeX / Framer Motion / Lucide", "开源许可证", "公式、动画和图标"),
        ("sherpa-onnx", "Apache-2.0", "Web端离线TTS运行时"),
        ("DeepSeek API", "外部云服务", "按用户配置生成卡片和追问回答"),
    ]
    add_matrix(doc, ["组件", "许可/性质", "用途"], third_party_rows, [2600, 2200, 4560])
    add_body(doc, "申请人不主张上述第三方框架、模型、训练语料或云模型本身的著作权。本次登记材料聚焦申请人编写的业务流程、接口协调、数据模型、交互界面、状态管理、缓存策略和部署工具。")

    doc.add_heading("17. 版本与限制", level=1)
    add_body(doc, "V1.0 Web版支持MD和TXT，不支持PDF与EPUB。DeepSeek真实生成依赖用户网络和有效API Key；本地语音模型首次使用可能下载资源。软件不包含登录、支付和多用户权限管理。")
    path = OUTPUT_ROOT / "03_软件设计说明书.docx"
    doc.save(path)
    return path


def build_checklist():
    doc = new_document("提交材料检查清单")
    add_cover(doc, "软件著作权登记提交检查清单", "个人申请适用；提交前逐项核对并签名确认")
    doc.add_heading("1. 法定材料依据", level=1)
    add_body(doc, "《计算机软件著作权登记办法》规定，申请软件著作权登记应提交申请表、软件鉴别材料和相关证明文件；程序和一种文档原则上由前、后各连续30页组成，不足60页时提交全部；自然人还应提交身份证明。")
    add_body(doc, f"官方规则链接：{OFFICIAL_RULE_URL}")

    doc.add_heading("2. 本材料包", level=1)
    package_rows = [
        ("01", "软件著作权登记申请信息表_填报底稿", "将内容录入官方系统，不能代替系统生成的正式申请表"),
        ("02", "用户操作说明书", "可编辑DOCX及渲染PDF，作为产品使用文档"),
        ("03", "软件设计说明书", "可编辑DOCX及渲染PDF，补正或技术说明备用"),
        ("04", "Web版源程序鉴别材料", "DOCX及PDF各60页，每页50行，前30页和后30页"),
        ("05", "提交材料检查清单", "个人信息、签署、名称一致性和第三方边界检查"),
        ("06", "源程序文件清单", "记录入选文件、语言和源码行数，不作为必交材料"),
    ]
    add_matrix(doc, ["编号", "材料", "用途"], package_rows, [900, 3600, 4860])

    doc.add_heading("3. 个人信息与签署", level=1)
    checklist_rows = [
        ("□", "在线申请表中的姓名与身份证完全一致"),
        ("□", "证件号码、地址、电话、邮箱已填写并复核"),
        ("□", "身份证明按登记系统要求上传或提交"),
        ("□", "申请人已在正式申请表或电子流程中签名确认"),
        ("□", "确认不存在未披露的合作、委托或职务开发权属"),
        ("□", "开发完成日期和首次发表状态按真实情况填写"),
    ]
    add_matrix(doc, ["状态", "核对事项"], checklist_rows, [900, 8460])

    doc.add_heading("4. 名称与版本一致性", level=1)
    add_bullets(doc, [
        f"软件全称统一为：{SOFTWARE_NAME}。",
        f"版本号统一为：{VERSION}。",
        f"材料标题统一显示：{FULL_NAME}。",
        "正式申请表、文档页眉、源程序页眉和文件封面不得出现不同软件名称或版本。",
    ])

    doc.add_heading("5. 源程序检查", level=1)
    add_bullets(doc, [
        "共60页，前30页和后30页，每页50行。",
        "页眉含软件名称、版本和前段/后段标识，页脚含连续页码。",
        "源程序仅选取backend与frontend/src目录中的Web版自有源码。",
        "排除API Key、.env、运行设置、数据库、用户上传书籍、日志、缓存和模型文件。",
        "排除node_modules、虚拟环境、构建目录、自动生成代码和第三方JNI包装代码。",
        "如提交前继续修改核心源码，应重新生成源程序材料，避免文档与软件版本不一致。",
    ])

    doc.add_heading("6. 第三方与开源说明", level=1)
    add_body(doc, "登记并不转移第三方组件权利。提交材料中不要声称拥有DeepSeek模型、React、FastAPI、sherpa-onnx或相关语音模型等第三方内容的著作权。申请权利范围应限定于个人原创Web代码和文档。")

    doc.add_heading("7. 提交前最终确认", level=1)
    add_kv_table(doc, [
        ("申请人签名", "[待填写]"),
        ("确认日期", "[待填写]"),
        ("材料最终版本", FULL_NAME),
        ("备注", "所有黄色字段补齐后再提交；在线系统字段如有变化，以系统最新要求为准。"),
    ], wait_labels=("申请人签名", "确认日期"))
    path = OUTPUT_ROOT / "05_提交材料检查清单.docx"
    doc.save(path)
    return path


def source_files():
    roots = [
        PROJECT_ROOT / "backend",
        PROJECT_ROOT / "frontend" / "src",
    ]
    extensions = {".py", ".js", ".jsx", ".ts", ".tsx", ".css"}
    excluded = re.compile(r"(?:^|[\\/])(?:tests?|__tests__|node_modules|build|dist|\.venv|uploads|tts_models)(?:[\\/]|$)", re.I)
    files = []
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in extensions:
                continue
            relative = path.relative_to(PROJECT_ROOT).as_posix()
            if excluded.search(relative):
                continue
            files.append(path)
    return sorted(set(files), key=lambda p: p.relative_to(PROJECT_ROOT).as_posix().lower())


def comment_prefix(path):
    return "#" if path.suffix.lower() in {".py", ".ps1"} else "//"


def collect_source_lines():
    entries = []
    manifest = []
    for path in source_files():
        relative = path.relative_to(PROJECT_ROOT).as_posix()
        raw_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        nonblank = [(index, line.expandtabs(4).rstrip()) for index, line in enumerate(raw_lines, 1) if line.strip()]
        manifest.append({"path": relative, "language": path.suffix.lower().lstrip("."), "total_lines": len(raw_lines), "nonblank_lines": len(nonblank)})
        entries.append((relative, 0, f"{comment_prefix(path)} ===== FILE: {relative} ====="))
        for number, line in nonblank:
            entries.append((relative, number, line))
    return entries, manifest


def truncate_display(text, limit=118):
    text = text.replace("\x00", " ")
    width = 0
    output = []
    for char in text:
        char_width = 2 if ord(char) > 127 else 1
        if width + char_width > limit:
            output.append("...")
            break
        output.append(char)
        width += char_width
    return "".join(output)


def build_source_document(selected):
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.55)
    section.bottom_margin = Cm(1.55)
    section.left_margin = Cm(1.45)
    section.right_margin = Cm(1.45)
    section.header_distance = Cm(0.65)
    section.footer_distance = Cm(0.7)

    normal = doc.styles["Normal"]
    normal.font.name = "Courier New"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Courier New")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Courier New")
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    normal.font.size = Pt(6.2)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.line_spacing = Pt(10.2)
    normal.paragraph_format.widow_control = False

    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_run_font(header.add_run(FULL_NAME), HEADING_FONT, 8.2, True, MUTED)
    set_run_font(header.add_run("  |  Web版源程序鉴别材料"), HEADING_FONT, 8.2, False, MUTED)

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_run_font(footer.add_run("第 "), size=8, color=MUTED)
    page_field = OxmlElement("w:fldSimple")
    page_field.set(qn("w:instr"), "PAGE")
    footer._p.append(page_field)
    set_run_font(footer.add_run(" 页 / 共 60 页"), size=8, color=MUTED)

    for page_index in range(60):
        page_entries = selected[page_index * 50 : (page_index + 1) * 50]
        for row_index, (_relative, _source_line, code) in enumerate(page_entries):
            paragraph = doc.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(0)
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = Pt(10.2)
            paragraph.paragraph_format.widow_control = False
            run = paragraph.add_run(truncate_display(code))
            set_run_font(run, "Courier New", 6.2, False, INK)
            run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), BODY_FONT)
            if row_index == 49 and page_index < 59:
                run.add_break(WD_BREAK.PAGE)

    output = OUTPUT_ROOT / "04_源程序鉴别材料_60页.docx"
    doc.save(output)
    return output


def build_source_material():
    entries, manifest = collect_source_lines()
    if len(entries) < 3000:
        raise RuntimeError(f"可用自有源码不足3000行：{len(entries)}")
    selected = entries[:1500] + entries[-1500:]
    source_docx = build_source_document(selected)
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    output = OUTPUT_ROOT / "04_源程序鉴别材料_60页.pdf"
    c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    page_width, page_height = A4
    margin_x = 30
    start_y = page_height - 50
    line_height = 14.25
    for page_index in range(60):
        segment = "Web版源程序前30页" if page_index < 30 else "Web版源程序后30页"
        c.setFillColor(HexColor("#1F2933"))
        c.setFont("STSong-Light", 8.5)
        c.drawString(margin_x, page_height - 25, f"{FULL_NAME}  |  {segment}")
        c.setStrokeColor(HexColor("#9AA5AE"))
        c.line(margin_x, page_height - 31, page_width - margin_x, page_height - 31)
        page_entries = selected[page_index * 50 : (page_index + 1) * 50]
        c.setFont("STSong-Light", 6.8)
        for row_index, (_relative, _source_line, code) in enumerate(page_entries):
            rendered = truncate_display(code)
            c.drawString(margin_x, start_y - row_index * line_height, rendered)
        c.setFont("STSong-Light", 8)
        c.setFillColor(HexColor("#68737D"))
        c.drawRightString(page_width - margin_x, 20, f"第 {page_index + 1} 页 / 共 60 页")
        c.showPage()
    c.save()

    manifest_path = OUTPUT_ROOT / "06_源程序文件清单.csv"
    with manifest_path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=["path", "language", "total_lines", "nonblank_lines"])
        writer.writeheader()
        writer.writerows(manifest)
    return output, source_docx, manifest_path, len(entries), manifest


def write_readme(source_count, manifest):
    total_lines = sum(item["total_lines"] for item in manifest)
    content = f"""# {FULL_NAME} 软件著作权登记材料包

## 已生成材料

1. `01_软件著作权登记申请信息表_填报底稿.docx`：用于录入官方在线申请表，不是官方表单。
2. `02_用户操作说明书.docx`：Web版操作说明。
3. `03_软件设计说明书.docx`：架构、数据、接口和模块设计。
4. `04_源程序鉴别材料_60页.docx` / `.pdf`：前30页和后30页，每页50行；源码行不带材料行号或原文件行号。
5. `05_提交材料检查清单.docx`：个人申请提交前检查。
6. `06_源程序文件清单.csv`：源码选择范围和行数审计。

申请底稿、说明书、检查清单和源程序材料均提供可编辑 Word 版本；同时提供 PDF 便于预览、打印和线上提交。

## 必须由申请人补充

- 身份证姓名、证件号码、国籍、联系地址、邮编、电话和邮箱。
- 确认开发完成日期是否为2026年8月9日。
- 确认软件是否为未发表。
- 确认不存在合作开发、委托开发、职务开发或其他权属安排。

## 源码审计

- 自有生产源码文件：{len(manifest)}个。
- 统计源码行数：{total_lines}行（含空行）。
- 可用于鉴别材料的非空源码及文件标识行：{source_count}行。
- 源程序仅来自`backend`与`frontend/src`中的Web版自有源码。
- 已排除密钥、数据库、上传书籍、日志、模型、依赖库和测试代码。

## 官方依据

- 国家版权局《计算机软件著作权登记办法》：{OFFICIAL_RULE_URL}

在线申请表字段和提交方式可能调整，最终以中国版权保护中心登记系统当日页面为准。
"""
    path = OUTPUT_ROOT / "README_申报说明.md"
    path.write_text(content, encoding="utf-8")
    return path


def main():
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    documents = [
        build_application_draft(),
        build_user_manual(),
        build_design_manual(),
        build_checklist(),
    ]
    source_pdf, source_docx, manifest_path, source_count, manifest = build_source_material()
    readme_path = write_readme(source_count, manifest)
    metadata = {
        "software_name": SOFTWARE_NAME,
        "version": VERSION,
        "documents": [path.name for path in documents],
        "source_pdf": source_pdf.name,
        "source_docx": source_docx.name,
        "manifest": manifest_path.name,
        "readme": readme_path.name,
        "production_source_files": len(manifest),
        "production_source_lines": sum(item["total_lines"] for item in manifest),
        "eligible_source_entries": source_count,
    }
    (OUTPUT_ROOT / "package_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
