const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const REQUIRED_API_VERSION = "0.16.0";

const state = {
  config: {
    serverUrl: localStorage.getItem("motu.serverUrl") || "http://localhost:8000",
    apiKey: localStorage.getItem("motu.apiKey") || "",
  },
  projects: [],
  project: null,
  activeMapId: null,
  editingMapId: null,
  editingChapterId: null,
  pendingMapDeleteId: null,
  mapViewStates: new Map(),
  activeChapterId: localStorage.getItem("motu.activeChapterId") || null,
  selectedNodeId: null,
  selectedNodeIds: new Set(),
  selectedEdgeId: null,
  selectedEdgeIds: new Set(),
  editingNoteId: null,
  linkTargetNodeId: null,
  connectSourceId: null,
  portDrag: null,
  selectionDrag: null,
  chapterBulkMode: false,
  selectedChapterIds: new Set(),
  pendingChapterDeleteIds: [],
  pendingTxtFiles: [],
  pendingFullBookFile: null,
  pendingFullBookChapters: [],
  pendingMarkdownFiles: [],
  markdownImportBusy: false,
  pendingMarkdownIsZip: false,
  selectedTxtExportChapterIds: new Set(),
  selectedMarkdownExportChapterIds: new Set(),
  selectedStoryMapExportIds: new Set(),
  storyMapExportBusy: false,
  pendingProjectPackage: null,
  projectPackageImportBusy: false,
  pendingChapterSave: null,
  chapterSavePromise: null,
  pendingNodeSave: null,
  nodeSavePromise: null,
  pendingStoryMapPackage: null,
  storyMapImportBusy: false,
  pendingVolumeDeleteId: null,
  collapsedVolumeIds: new Set(),
  storyMapsCollapsed: false,
  camera: { x: 0, y: 0 },
  canvasAnchor: null,
  canvasBounds: null,
  canvasInitialized: false,
  canvasControlScheme: localStorage.getItem("motu.canvasControlScheme") === "classic" ? "classic" : "mixed",
  panMode: localStorage.getItem("motu.canvasPanMode") === "locked",
  spacePressed: false,
  ignoreCanvasClick: false,
  chapterTimer: null,
  nodeTimer: null,
  toastTimer: null,
  editorHistories: new Map(),
  editorHistoryTimer: null,
  applyingEditorHistory: false,
  split: { open: false, chapterId: null, width: 390 },
  find: { scope: "chapter", records: [], currentIndex: -1, query: "" },
};

const nodeTypeNames = { plot: "情节", character: "人物", place: "地点", conflict: "冲突", note: "便签" };
const nodeTypeColors = { plot: "blue", character: "violet", place: "green", conflict: "rose", note: "amber" };
const markdownShortcuts = [
  { category: "文本格式", name: "粗体", keys: ["Ctrl", "B"], action: "bold" },
  { category: "文本格式", name: "斜体", keys: ["Ctrl", "I"], action: "italic" },
  { category: "文本格式", name: "下划线", keys: ["Ctrl", "U"], action: "underline" },
  { category: "文本格式", name: "删除线", keys: ["Alt", "Shift", "5"], action: "strike" },
  { category: "文本格式", name: "行内代码", keys: ["Ctrl", "Shift", "`"], action: "inlineCode" },
  { category: "文本格式", name: "超链接", keys: ["Ctrl", "K"], action: "link" },
  { category: "文本格式", name: "图片", keys: ["Ctrl", "Shift", "I"], action: "image" },
  { category: "段落结构", name: "正文段落", keys: ["Ctrl", "0"], action: "paragraph" },
  { category: "段落结构", name: "一至六级标题", keys: ["Ctrl", "1–6"], action: "heading1" },
  { category: "段落结构", name: "引用", keys: ["Ctrl", "Shift", "Q"], action: "quote" },
  { category: "段落结构", name: "代码块", keys: ["Ctrl", "Shift", "K"], action: "codeFence" },
  { category: "段落结构", name: "数学公式块", keys: ["Ctrl", "Shift", "M"], action: "mathBlock" },
  { category: "段落结构", name: "有序列表", keys: ["Ctrl", "Shift", "["], action: "orderedList" },
  { category: "段落结构", name: "无序列表", keys: ["Ctrl", "Shift", "]"], action: "unorderedList" },
  { category: "段落结构", name: "表格", keys: ["Ctrl", "T"], action: "table" },
  { category: "编辑与选择", name: "保存", keys: ["Ctrl", "S"], action: "save" },
  { category: "编辑与选择", name: "撤销", keys: ["Ctrl", "Z"], action: "undo" },
  { category: "编辑与选择", name: "重做", keys: ["Ctrl", "Y"], action: "redo" },
  { category: "编辑与选择", name: "选择当前行", keys: ["Ctrl", "L"], action: "selectLine" },
  { category: "编辑与选择", name: "选择当前词", keys: ["Ctrl", "D"], action: "selectWord" },
  { category: "编辑与选择", name: "增加缩进", keys: ["Tab"], action: "indent" },
  { category: "编辑与选择", name: "减少缩进", keys: ["Shift", "Tab"], action: "outdent" },
];
const writingFontStacks = {
  serif: '"Noto Serif SC","Songti SC",serif',
  songti: 'SimSun,"Songti SC",serif',
  kaiti: 'KaiTi,"STKaiti",serif',
  yahei: '"Microsoft YaHei","PingFang SC",sans-serif',
  sans: 'Inter,"Microsoft YaHei","PingFang SC",sans-serif',
  mono: 'Consolas,"Microsoft YaHei",monospace',
};
const writingTypographyDefaults = {
  fontFamily: "serif", fontSize: 18, lineHeight: 2.05, width: 1040,
  color: "#292b39", bold: false, paragraphSpacing: true, firstIndent: false,
};
let writingTypography = { ...writingTypographyDefaults };
const writingAppearanceDefaults = { theme: "mist", guide: "none", night: false };
let writingAppearance = { ...writingAppearanceDefaults };
const findPanelLayoutDefaults = { x: null, y: null, compact: false, minimized: false };
let findPanelLayout = { ...findPanelLayoutDefaults };

function normalizedServerUrl(value = state.config.serverUrl) {
  return value.trim().replace(/\/+$/, "");
}

function versionParts(version) {
  return String(version || "").split(".").slice(0, 3).map(part => Number.parseInt(part, 10) || 0);
}

function apiVersionIsCompatible(version) {
  if (!version) return false;
  const current = versionParts(version);
  const required = versionParts(REQUIRED_API_VERSION);
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > required[index]) return true;
    if (current[index] < required[index]) return false;
  }
  return true;
}

function assertCompatibleApi(health) {
  const version = health?.version || "未知";
  if (apiVersionIsCompatible(version)) return;
  throw new Error(`后端版本 ${version} 过旧，当前前端需要 ${REQUIRED_API_VERSION} 或更高版本。请停止旧服务后重新运行 python dev.py`);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.config.apiKey) headers.Authorization = `Bearer ${state.config.apiKey}`;
  let response;
  try {
    response = await fetch(`${normalizedServerUrl()}${path}`, { ...options, headers });
  } catch (error) {
    throw new Error("无法连接服务器，请检查地址、HTTPS 与跨域设置");
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `请求失败（${response.status}）`);
  return data;
}

async function apiBlob(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.config.apiKey) headers.Authorization = `Bearer ${state.config.apiKey}`;
  let response;
  try {
    response = await fetch(`${normalizedServerUrl()}${path}`, { ...options, headers });
  } catch (_) {
    throw new Error("无法连接服务器，请检查地址、HTTPS 与跨域设置");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `请求失败（${response.status}）`);
  }
  return response.blob();
}

function setSaveState(label, mode = "") {
  const element = $("#saveState");
  element.className = `save-state ${mode}`;
  element.innerHTML = `<i></i>${escapeHtml(label)}`;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}

function requireProject(actionLabel = "执行此操作") {
  if (state.project) return true;
  const message = `无法${actionLabel}：尚未连接写作服务器`;
  toast(message);
  $("#connectionResult").textContent = `${message}。本地开发请在项目根目录运行 python dev.py。`;
  $("#connectionResult").className = "connection-result error";
  if (!$("#settingsDialog").open) $("#settingsDialog").showModal();
  return false;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function wordCount(text = "") {
  const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return chinese + latin;
}

function markdownPlainText(text = "") {
  return String(text)
    .replace(/```[\s\S]*?```/g, "代码片段")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<\/?u>/g, "")
    .replace(/(?:\*\*|~~|`|\*)/g, "")
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownToReadableText(markdown = "") {
  const container = document.createElement("div");
  container.innerHTML = markdownToEditorHtml(markdown);
  const childrenText = node => [...node.childNodes].map(readableNodeText).join("");
  const readableNodeText = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\u00a0/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "pre") return `${node.textContent}\n\n`;
    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      return [...node.children]
        .filter(item => item.tagName.toLowerCase() === "li")
        .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${childrenText(item).trim()}`)
        .join("\n") + "\n\n";
    }
    if (tag === "table") {
      return [...node.querySelectorAll("tr")]
        .map(row => [...row.children].map(cell => cell.textContent.trim()).join("\t"))
        .join("\n") + "\n\n";
    }
    const content = childrenText(node);
    if (/^h[1-6]$/.test(tag) || tag === "p") return `${content.trim()}\n\n`;
    if (tag === "blockquote") return `${content.trim().split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
    if (tag === "li") return content;
    if (tag === "img") return node.getAttribute("alt") || "";
    return content;
  };
  return [...container.childNodes]
    .map(readableNodeText)
    .join("")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainTextToMarkdown(text = "") {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n(?:[\t ]*\n)+/)
    .map(paragraph => paragraph
      .split("\n")
      .map(line => line.replace(/[\t ]+$/g, ""))
      .join("  \n")
      .replace(/^\n+|\n+$/g, ""))
    .filter(Boolean)
    .join("\n\n");
}

function stripRepeatedExportTitle(content, filename) {
  const lines = String(content || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const fileTitle = String(filename || "").replace(/\.txt$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim();
  const firstLine = (lines[0] || "").trim().replace(/^#{1,6}\s+/, "");
  const normalize = value => String(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
  if (!fileTitle || normalize(firstLine) !== normalize(fileTitle)) return String(content || "").replace(/^\uFEFF/, "");
  lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.join("\n");
}

function parseFullBookTxt(text, metadata = {}) {
  const lines = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const chapters = [];
  let title = null;
  let content = [];
  const preamble = [];
  const normalizeLine = value => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
  const volumeNames = new Set((metadata.volumeNames || []).map(normalizeLine));
  const bookTitle = normalizeLine(metadata.bookTitle);
  const flush = () => {
    if (title === null) return;
    chapters.push({ title: title.trim(), content: content.join("\n").replace(/^\n+|\n+$/g, "") });
  };
  const chapterTitleFromLine = line => {
    const marked = line.match(/^\s*【章节】\s*(.+?)\s*$/);
    if (marked) return marked[1];
    const markdown = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (markdown) return markdown[1];
    const numbered = line.match(/^\s*(第\s*[0-9０-９一二三四五六七八九十百千零〇两]+\s*(?:章|回|节)(?:\s*[:：、.．-]?\s*.*)?)\s*$/);
    const named = line.match(/^\s*(序章|序言|楔子|引子|前言|尾声|后记|番外(?:篇)?)(?:\s*[:：、.．-]?\s*.*)?\s*$/);
    return numbered?.[1] || named?.[0]?.trim() || null;
  };
  for (const line of lines) {
    if (/^\s*【卷】/.test(line) || /^\s*【作品】/.test(line)) continue;
    if (volumeNames.has(normalizeLine(line)) || (bookTitle && bookTitle === normalizeLine(line))) continue;
    const nextTitle = chapterTitleFromLine(line);
    if (nextTitle) {
      if (title === null && preamble.some(item => item.trim())) {
        const opening = preamble.join("\n").trim();
        if (opening) chapters.push({ title: "序章", content: opening });
      }
      flush();
      title = nextTitle;
      content = [];
    } else if (title !== null) {
      content.push(line);
    } else if (!/^\s*【作品】/.test(line)) {
      preamble.push(line);
    }
  }
  flush();
  if (chapters.length) return chapters.map(chapter => ({ ...chapter, title: chapter.title.slice(0, 120) }));
  const fallbackContent = preamble.join("\n").trim();
  return fallbackContent ? [{ title: "", content: fallbackContent }] : [];
}

function safeTxtFilename(title) {
  let stem = String(title || "").trim()
    .replace(/\.txt$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  if (!stem) stem = "墨图导出";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = `_${stem}`;
  return `${stem}.txt`;
}

function safeMarkdownFilename(title) {
  let stem = String(title || "").trim()
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  if (!stem) stem = "墨图导出";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = `_${stem}`;
  return `${stem}.md`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadMarkdownFile(filename, content) {
  downloadBlob(safeMarkdownFilename(filename), new Blob([String(content)], { type: "text/markdown;charset=utf-8" }));
}

function downloadTxtFile(filename, content) {
  const windowsLineEndings = String(content).replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
  const blob = new Blob(["\uFEFF", windowsLineEndings], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeTxtFilename(filename);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resizeManuscript() {
  const editor = $("#chapterContent");
  if (!editor) return;
  editor.style.minHeight = `${Math.max(editor.scrollHeight, 640)}px`;
}

function safeMarkdownUrl(value) {
  const url = String(value || "").trim();
  return /^(?:https?:|mailto:|#|\/|\.\.?\/)/i.test(url) ? escapeHtml(url) : "#";
}

function inlineMarkdownToHtml(value = "") {
  const tokens = [];
  const stash = html => {
    const key = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return key;
  };
  let html = escapeHtml(value);
  html = html.replace(/`([^`\n]+)`/g, (_, content) => stash(`<code>${content}</code>`));
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => stash(`<img src="${safeMarkdownUrl(url)}" alt="${alt}" />`));
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => stash(`<a href="${safeMarkdownUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  html = html.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, (_, content) => stash(`<u>${content}</u>`));
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  tokens.forEach((token, index) => { html = html.split(`\uE000${index}\uE001`).join(token); });
  return html;
}

function markdownToEditorHtml(markdown = "") {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  const cells = line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^```\s*([^\s]*)/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      output.push(`<pre data-language="${escapeHtml(fence[1] || "")}"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim() === "$$") {
      const math = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "$$") math.push(lines[index++]);
      if (index < lines.length) index += 1;
      output.push(`<pre class="math-block">${escapeHtml(`$$\n${math.join("\n")}\n$$`)}</pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quoted.push(lines[index++].replace(/^>\s?/, ""));
      output.push(`<blockquote>${quoted.map(inlineMarkdownToHtml).join("<br>")}</blockquote>`);
      continue;
    }
    if (/^[-+*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-+*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^[-+*]\s+/, ""));
      output.push(`<ul>${items.map(item => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\d+\.\s+/, ""));
      output.push(`<ol>${items.map(item => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[index + 1])) {
      const headers = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      output.push(`<table><thead><tr>${headers.map(cell => `<th>${inlineMarkdownToHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const paragraphLines = [];
    while (index < lines.length && lines[index].trim()) {
      const currentLine = lines[index];
      const startsBlock = /^(?:\s{0,3}#{1,6}\s+|>\s?|[-+*]\s+|\d+\.\s+|```|\$\$\s*$)/.test(currentLine)
        || (currentLine.includes("|") && index + 1 < lines.length && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[index + 1]));
      if (paragraphLines.length && startsBlock) break;
      paragraphLines.push(currentLine);
      index += 1;
    }
    const paragraphHtml = paragraphLines.map((paragraphLine, lineIndex) => {
      const inline = inlineMarkdownToHtml(paragraphLine.replace(/[\t ]+$/g, ""));
      return inline + (lineIndex < paragraphLines.length - 1 ? "<br>" : "");
    }).join("");
    output.push(`<p>${paragraphHtml}</p>`);
  }
  return output.join("");
}

function inlineEditorNodeToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\u00a0/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  const content = [...node.childNodes].map(inlineEditorNodeToMarkdown).join("");
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "em" || tag === "i") return `*${content}*`;
  if (tag === "u") return `<u>${content}</u>`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${content}~~`;
  if (tag === "code") return `\`${content}\``;
  if (tag === "a") return `[${content}](${node.getAttribute("href") || "#"})`;
  if (tag === "img") return `![${node.getAttribute("alt") || "图片"}](${node.getAttribute("src") || ""})`;
  if (tag === "br") return "  \n";
  return content;
}

function editorBlockToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return inlineEditorNodeToMarkdown(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  const inline = () => [...node.childNodes].map(inlineEditorNodeToMarkdown).join("").trimEnd();
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline()}`;
  if (tag === "p" || tag === "div") return inline();
  if (tag === "blockquote") return inline().split("\n").map(line => `> ${line}`).join("\n");
  if (tag === "ul" || tag === "ol") return [...node.children].filter(child => child.tagName.toLowerCase() === "li").map((item, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${[...item.childNodes].map(inlineEditorNodeToMarkdown).join("")}`).join("\n");
  if (tag === "pre") {
    if (node.classList.contains("math-block")) return node.textContent;
    const language = node.dataset.language || "";
    return `\`\`\`${language}\n${node.textContent}\n\`\`\``;
  }
  if (tag === "table") {
    const rows = [...node.querySelectorAll("tr")].map(row => [...row.children].map(cell => cell.textContent.trim()));
    if (!rows.length) return "";
    return [`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map(row => `| ${row.join(" | ")} |`)].join("\n");
  }
  if (tag === "br") return "";
  return inline();
}

function richContainerToMarkdown(container) {
  return [...container.childNodes].map(editorBlockToMarkdown).join("\n\n").replace(/\u200B/g, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function editorToMarkdown() {
  return richContainerToMarkdown($("#chapterContent"));
}

function editorSelection() {
  const editor = $("#chapterContent");
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? { editor, selection, range } : null;
}

function insertRichHtml(html) {
  const editor = $("#chapterContent");
  editor.focus();
  let current = editorSelection();
  if (!current) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    current = { editor, selection, range };
  }
  current.range.deleteContents();
  const fragment = current.range.createContextualFragment(html);
  const lastNode = fragment.lastChild;
  current.range.insertNode(fragment);
  if (lastNode) {
    current.range.setStartAfter(lastNode);
    current.range.collapse(true);
    current.selection.removeAllRanges();
    current.selection.addRange(current.range);
  }
}

function wrapRichSelection(tag, placeholder) {
  const current = editorSelection();
  if (!current || current.range.collapsed) {
    insertRichHtml(`<${tag}>${escapeHtml(placeholder)}</${tag}>`);
    return;
  }
  const wrapper = document.createElement(tag);
  wrapper.appendChild(current.range.extractContents());
  current.range.insertNode(wrapper);
  current.range.selectNodeContents(wrapper);
  current.selection.removeAllRanges();
  current.selection.addRange(current.range);
}

function syncRichEditorChange() {
  resizeManuscript();
  scheduleEditorHistory();
  queueDocumentSave();
  renderSplitPane();
}

function chapterSnapshot(chapter = activeChapter(), fromEditor = false) {
  if (!chapter) return null;
  return {
    title: fromEditor ? ($("#chapterTitleInput").value.trim() || "未命名章节") : chapter.title,
    content: fromEditor ? editorToMarkdown() : (chapter.content || ""),
  };
}

function sameSnapshot(left, right) {
  return Boolean(left && right && left.title === right.title && left.content === right.content);
}

function ensureEditorHistory(chapter = activeChapter()) {
  if (!chapter) return null;
  if (!state.editorHistories.has(chapter.id)) {
    state.editorHistories.set(chapter.id, { entries: [chapterSnapshot(chapter)], index: 0 });
  }
  return state.editorHistories.get(chapter.id);
}

function commitEditorHistory(chapterId, snapshot) {
  const chapter = state.project?.chapters.find(item => item.id === chapterId);
  if (!chapter || !snapshot) return;
  const history = ensureEditorHistory(chapter);
  if (sameSnapshot(history.entries[history.index], snapshot)) {
    updateHistoryButtons();
    return;
  }
  history.entries.splice(history.index + 1);
  history.entries.push({ ...snapshot });
  if (history.entries.length > 100) history.entries.shift();
  history.index = history.entries.length - 1;
  updateHistoryButtons();
}

function flushEditorHistory() {
  clearTimeout(state.editorHistoryTimer);
  state.editorHistoryTimer = null;
  if (state.applyingEditorHistory) return;
  const chapter = activeChapter();
  if (chapter) commitEditorHistory(chapter.id, chapterSnapshot(chapter, true));
}

function scheduleEditorHistory() {
  if (state.applyingEditorHistory) return;
  clearTimeout(state.editorHistoryTimer);
  const chapterId = state.activeChapterId;
  state.editorHistoryTimer = setTimeout(() => {
    state.editorHistoryTimer = null;
    if (state.activeChapterId === chapterId) flushEditorHistory();
  }, 420);
}

function updateHistoryButtons() {
  const history = state.editorHistories.get(state.activeChapterId);
  const undo = $("#undoButton");
  const redo = $("#redoButton");
  if (!undo || !redo) return;
  undo.disabled = !history || history.index <= 0;
  redo.disabled = !history || history.index >= history.entries.length - 1;
}

function placeCaretAtEditorEnd() {
  const editor = $("#chapterContent");
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function applyEditorHistorySnapshot(snapshot) {
  const chapter = activeChapter();
  if (!chapter || !snapshot) return;
  state.applyingEditorHistory = true;
  chapter.title = snapshot.title;
  chapter.content = snapshot.content;
  $("#chapterTitleInput").value = snapshot.title;
  $("#chapterContent").innerHTML = markdownToEditorHtml(snapshot.content);
  $("#chapterWords").textContent = wordCount(snapshot.content) + " 字";
  renderChapters();
  renderLinkedNodes();
  renderSplitPane();
  resizeManuscript();
  queueDocumentSave();
  $("#chapterContent").focus();
  placeCaretAtEditorEnd();
  state.applyingEditorHistory = false;
  updateHistoryButtons();
}

function moveEditorHistory(direction) {
  flushEditorHistory();
  const history = ensureEditorHistory();
  if (!history) return;
  const nextIndex = history.index + direction;
  if (nextIndex < 0 || nextIndex >= history.entries.length) return;
  history.index = nextIndex;
  applyEditorHistorySnapshot(history.entries[history.index]);
}

function loadSplitViewLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem("motu.splitView") || "null");
    if (saved && typeof saved === "object") {
      state.split.open = Boolean(saved.open);
      state.split.chapterId = saved.chapterId || null;
      state.split.width = Math.max(300, Math.min(720, Number(saved.width) || 390));
    }
  } catch (_error) {
    state.split = { open: false, chapterId: null, width: 390 };
  }
  $("#writeView").style.setProperty("--split-pane-width", state.split.width + "px");
}

function saveSplitViewLayout() {
  localStorage.setItem("motu.splitView", JSON.stringify(state.split));
}

function defaultSplitChapterId() {
  const chapters = state.project?.chapters || [];
  return chapters.find(chapter => chapter.id !== state.activeChapterId)?.id || chapters[0]?.id || null;
}

function renderSplitChapterOptions() {
  const select = $("#splitChapterSelect");
  if (!select || !state.project) return;
  if (!state.project.chapters.some(chapter => chapter.id === state.split.chapterId)) {
    state.split.chapterId = defaultSplitChapterId();
  }
  select.innerHTML = state.project.chapters.map(chapter => (
    `<option value="${chapter.id}">${escapeHtml(chapterOptionLabel(chapter))}</option>`
  )).join("");
  select.value = state.split.chapterId || "";
}

function renderSplitPane() {
  if (!state.project) return;
  renderSplitChapterOptions();
  const chapter = state.project.chapters.find(item => item.id === state.split.chapterId);
  if (!chapter) return;
  const index = chapterNumberInVolume(chapter);
  const content = chapter.id === state.activeChapterId ? editorToMarkdown() : (chapter.content || "");
  $("#splitChapterIndex").textContent = `CHAPTER ${String(index).padStart(2, "0")}`;
  $("#splitChapterTitle").textContent = chapter.id === state.activeChapterId ? ($("#chapterTitleInput").value.trim() || chapter.title) : chapter.title;
  $("#splitChapterContent").innerHTML = content ? markdownToEditorHtml(content) : "<p class=\"split-empty\">这个章节还没有正文。</p>";
}

function setSplitView(open) {
  state.split.open = Boolean(open);
  const pane = $("#splitPane");
  const resizer = $("#splitPaneResizer");
  const button = $("#splitViewButton");
  const view = $("#writeView");
  view.classList.toggle("split-active", state.split.open);
  pane.hidden = !state.split.open;
  resizer.hidden = !state.split.open;
  button.classList.toggle("active", state.split.open);
  button.setAttribute("aria-pressed", String(state.split.open));
  if (state.split.open) {
    if (view.clientWidth) setSplitPaneWidth(state.split.width);
    renderSplitPane();
  }
  saveSplitViewLayout();
}

function setSplitPaneWidth(width) {
  const view = $("#writeView");
  const max = Math.max(320, Math.min(720, view.clientWidth * .62));
  state.split.width = Math.round(Math.max(300, Math.min(max, width)));
  view.style.setProperty("--split-pane-width", state.split.width + "px");
}

function bindSplitPaneResizer() {
  const resizer = $("#splitPaneResizer");
  resizer.addEventListener("pointerdown", event => {
    if (window.matchMedia("(max-width: 680px)").matches) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("dragging");
    const move = moveEvent => setSplitPaneWidth($("#writeView").getBoundingClientRect().right - moveEvent.clientX);
    const finish = () => {
      resizer.classList.remove("dragging");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      saveSplitViewLayout();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
  });
  resizer.addEventListener("keydown", event => {
    if (!state.split.open || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    setSplitPaneWidth(state.split.width + (event.key === "ArrowLeft" ? 20 : -20));
    saveSplitViewLayout();
  });
}

function applyMarkdownAction(action) {
  const editor = $("#chapterContent");
  if (!editor || !activeDocument()) return;
  editor.focus();
  const current = editorSelection();
  const selectedText = current?.selection.toString() || "";
  if (action === "bold") selectedText ? document.execCommand("bold") : wrapRichSelection("strong", "粗体文字");
  else if (action === "italic") selectedText ? document.execCommand("italic") : wrapRichSelection("em", "斜体文字");
  else if (action === "underline") selectedText ? document.execCommand("underline") : wrapRichSelection("u", "下划线文字");
  else if (action === "strike") selectedText ? document.execCommand("strikeThrough") : wrapRichSelection("del", "删除线文字");
  else if (action === "inlineCode") wrapRichSelection("code", "代码");
  else if (action === "link") {
    const url = window.prompt("请输入链接地址", "https://");
    if (url) selectedText ? document.execCommand("createLink", false, url) : insertRichHtml(`<a href="${safeMarkdownUrl(url)}">链接文字</a>`);
  } else if (action === "image") {
    const url = window.prompt("请输入图片地址", "https://");
    if (url) insertRichHtml(`<img src="${safeMarkdownUrl(url)}" alt="${escapeHtml(selectedText || "图片说明")}" />`);
  } else if (/^heading[1-6]$/.test(action)) document.execCommand("formatBlock", false, `h${action.slice(-1)}`);
  else if (action === "paragraph") document.execCommand("formatBlock", false, "p");
  else if (action === "quote") document.execCommand("formatBlock", false, "blockquote");
  else if (action === "unorderedList") document.execCommand("insertUnorderedList");
  else if (action === "orderedList") document.execCommand("insertOrderedList");
  else if (action === "indent") document.execCommand("indent");
  else if (action === "outdent") document.execCommand("outdent");
  else if (action === "codeFence") insertRichHtml(`<pre><code>${escapeHtml(selectedText || "代码")}</code></pre><p><br></p>`);
  else if (action === "mathBlock") insertRichHtml(`<pre class="math-block">${escapeHtml(`$$\n${selectedText || "公式"}\n$$`)}</pre><p><br></p>`);
  else if (action === "table") insertRichHtml("<table><thead><tr><th>列 1</th><th>列 2</th></tr></thead><tbody><tr><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>");
  else if (action === "selectLine" || action === "selectWord") {
    const selection = window.getSelection();
    if (selection.modify) {
      selection.collapseToStart();
      selection.modify("move", "backward", action === "selectLine" ? "lineboundary" : "word");
      selection.modify("extend", "forward", action === "selectLine" ? "lineboundary" : "word");
    }
    return;
  } else if (action === "save") { queueDocumentSave(); toast("正在保存章节"); return; }
  syncRichEditorChange();
}

function renderShortcutGroups(query = "") {
  const normalizeShortcutSearch = value => value.trim().toLowerCase().replace(/[+\s]/g, "");
  const normalized = normalizeShortcutSearch(query);
  const matches = markdownShortcuts.filter(shortcut => (
    normalizeShortcutSearch(`${shortcut.category} ${shortcut.name} ${shortcut.keys.join(" ")}`).includes(normalized)
  ));
  const categories = [...new Set(markdownShortcuts.map(shortcut => shortcut.category))];
  const markup = categories.map(category => {
    const shortcuts = matches.filter(shortcut => shortcut.category === category);
    if (!shortcuts.length) return "";
    return `<section class="shortcut-group"><h4>${escapeHtml(category)}</h4><div class="shortcut-list">${shortcuts.map(shortcut => (
      `<div class="shortcut-row"><span>${escapeHtml(shortcut.name)}</span><span class="shortcut-keys">${shortcut.keys.map(key => `<kbd>${escapeHtml(key)}</kbd>`).join("")}</span></div>`
    )).join("")}</div></section>`;
  }).join("");
  $("#shortcutGroups").innerHTML = markup || '<p class="shortcut-empty">没有找到相关快捷键</p>';
}

function setShortcutPanel(open) {
  const panel = $("#shortcutPanel");
  const button = $("#shortcutHelpButton");
  if (open) {
    setTypographyPanel(false);
    setBackgroundPanel(false);
    setFindReplacePanel(false);
  }
  panel.hidden = !open;
  button.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
  if (open) {
    renderShortcutGroups($("#shortcutSearch").value);
    requestAnimationFrame(() => $("#shortcutSearch").focus());
  }
}

function normalizedTypography(value = {}) {
  const numberInRange = (candidate, fallback, minimum, maximum) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  };
  return {
    fontFamily: writingFontStacks[value.fontFamily] ? value.fontFamily : writingTypographyDefaults.fontFamily,
    fontSize: numberInRange(value.fontSize, writingTypographyDefaults.fontSize, 14, 50),
    lineHeight: numberInRange(value.lineHeight, writingTypographyDefaults.lineHeight, 1.4, 2.8),
    width: numberInRange(value.width, writingTypographyDefaults.width, 620, 1280),
    color: /^#[0-9a-f]{6}$/i.test(value.color || "") ? value.color : writingTypographyDefaults.color,
    bold: Boolean(value.bold),
    paragraphSpacing: value.paragraphSpacing !== false,
    firstIndent: Boolean(value.firstIndent),
  };
}

function loadWritingTypography() {
  try {
    writingTypography = normalizedTypography(JSON.parse(localStorage.getItem("motu.writingTypography") || "{}"));
  } catch (_) {
    writingTypography = { ...writingTypographyDefaults };
  }
  applyWritingTypography();
}

function applyWritingTypography() {
  const view = $("#writeView");
  if (!view) return;
  view.style.setProperty("--writing-font", writingFontStacks[writingTypography.fontFamily]);
  view.style.setProperty("--writing-size", `${writingTypography.fontSize}px`);
  view.style.setProperty("--writing-line-height", String(writingTypography.lineHeight));
  view.style.setProperty("--writing-line-step", `${writingTypography.fontSize * writingTypography.lineHeight}px`);
  view.style.setProperty("--writing-width", `${writingTypography.width}px`);
  view.style.setProperty("--writing-color", writingTypography.color);
  view.style.setProperty("--writing-weight", writingTypography.bold ? "600" : "400");
  view.classList.toggle("compact-paragraphs", !writingTypography.paragraphSpacing);
  view.classList.toggle("first-line-indent", writingTypography.firstIndent);
  resizeManuscript();
}

function renderTypographyControls() {
  $("#writingFontFamily").value = writingTypography.fontFamily;
  $("#writingFontSize").value = writingTypography.fontSize;
  $("#writingLineHeight").value = writingTypography.lineHeight;
  $("#writingWidth").value = writingTypography.width;
  $("#writingTextColor").value = writingTypography.color;
  $("#writingParagraphSpacing").checked = writingTypography.paragraphSpacing;
  $("#writingFirstIndent").checked = writingTypography.firstIndent;
  $("#writingFontSizeValue").textContent = `${writingTypography.fontSize} px`;
  $("#writingLineHeightValue").textContent = writingTypography.lineHeight.toFixed(2).replace(/0$/, "");
  $("#writingWidthValue").textContent = `${writingTypography.width} px`;
  $("#writingBoldToggle").classList.toggle("active", writingTypography.bold);
  $("#writingBoldToggle").setAttribute("aria-pressed", String(writingTypography.bold));
}

function saveWritingTypography() {
  writingTypography = normalizedTypography(writingTypography);
  localStorage.setItem("motu.writingTypography", JSON.stringify(writingTypography));
  applyWritingTypography();
  renderTypographyControls();
}

function updateWritingTypographyFromControls() {
  writingTypography = normalizedTypography({
    ...writingTypography,
    fontFamily: $("#writingFontFamily").value,
    fontSize: $("#writingFontSize").value,
    lineHeight: $("#writingLineHeight").value,
    width: $("#writingWidth").value,
    color: $("#writingTextColor").value,
    paragraphSpacing: $("#writingParagraphSpacing").checked,
    firstIndent: $("#writingFirstIndent").checked,
  });
  saveWritingTypography();
}

function setTypographyPanel(open) {
  const panel = $("#typographyPanel");
  const button = $("#typographyButton");
  if (!panel || !button) return;
  if (open) {
    setShortcutPanel(false);
    setBackgroundPanel(false);
    setFindReplacePanel(false);
  }
  panel.hidden = !open;
  button.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
  if (open) renderTypographyControls();
}

function normalizedWritingAppearance(value = {}) {
  const themes = new Set(["mist", "eye", "parchment", "blue", "rose", "white"]);
  const guides = new Set(["none", "solid", "dashed"]);
  return {
    theme: themes.has(value.theme) ? value.theme : writingAppearanceDefaults.theme,
    guide: guides.has(value.guide) ? value.guide : writingAppearanceDefaults.guide,
    night: Boolean(value.night),
  };
}

function loadWritingAppearance() {
  try {
    writingAppearance = normalizedWritingAppearance(JSON.parse(localStorage.getItem("motu.writingAppearance") || "{}"));
  } catch (_) {
    writingAppearance = { ...writingAppearanceDefaults };
  }
  applyWritingAppearance();
}

function renderWritingAppearanceControls() {
  $$("#backgroundThemePicker [data-writing-theme]").forEach(button => {
    const active = button.dataset.writingTheme === writingAppearance.theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("#guideStylePicker [data-guide-style]").forEach(button => {
    const active = button.dataset.guideStyle === writingAppearance.guide;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const toggle = $("#nightModeToggle");
  if (toggle) {
    toggle.classList.toggle("active", writingAppearance.night);
    toggle.setAttribute("aria-checked", String(writingAppearance.night));
  }
  const quickToggle = $("#nightModeButton");
  if (quickToggle) {
    const label = writingAppearance.night ? "切换到浅色模式" : "切换到夜间模式";
    quickToggle.classList.toggle("active", writingAppearance.night);
    quickToggle.setAttribute("aria-pressed", String(writingAppearance.night));
    quickToggle.setAttribute("aria-label", label);
    quickToggle.title = label;
    quickToggle.textContent = writingAppearance.night ? "☀" : "◐";
  }
}

function applyWritingAppearance() {
  const view = $("#writeView");
  if (!view) return;
  ["mist", "eye", "parchment", "blue", "rose", "white"].forEach(theme => view.classList.remove(`theme-${theme}`));
  ["none", "solid", "dashed"].forEach(guide => view.classList.remove(`guide-${guide}`));
  view.classList.add(`theme-${writingAppearance.theme}`, `guide-${writingAppearance.guide}`);
  $("#app").classList.toggle("night-mode", writingAppearance.night);
  document.documentElement.style.colorScheme = writingAppearance.night ? "dark" : "light";
  renderWritingAppearanceControls();
}

function saveWritingAppearance() {
  writingAppearance = normalizedWritingAppearance(writingAppearance);
  localStorage.setItem("motu.writingAppearance", JSON.stringify(writingAppearance));
  applyWritingAppearance();
}

function setBackgroundPanel(open) {
  const panel = $("#backgroundPanel");
  const button = $("#backgroundButton");
  if (!panel || !button) return;
  if (open) {
    setShortcutPanel(false);
    setTypographyPanel(false);
    setFindReplacePanel(false);
  }
  panel.hidden = !open;
  button.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
  if (open) renderWritingAppearanceControls();
}

function findOptions() {
  return {
    caseSensitive: Boolean($("#findCaseSensitive")?.checked),
    wholeWord: Boolean($("#findWholeWord")?.checked),
  };
}

function isSearchWordCharacter(character = "") {
  return Boolean(character) && /[\p{L}\p{N}_]/u.test(character);
}

function findTextOccurrences(text, query, options = findOptions()) {
  if (!query) return [];
  const source = options.caseSensitive ? String(text) : String(text).toLocaleLowerCase();
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  const matches = [];
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const index = source.indexOf(needle, offset);
    if (index < 0) break;
    const wholeWordMatch = !options.wholeWord || (
      !isSearchWordCharacter(text[index - 1]) && !isSearchWordCharacter(text[index + query.length])
    );
    if (wholeWordMatch) matches.push(index);
    offset = index + Math.max(needle.length, 1);
  }
  return matches;
}

function containerTextRanges(container, query = $("#findTextInput")?.value || "") {
  if (!container || !query) return [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const segments = [];
  let text = "";
  let previousBlock = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    let block = node.parentNode;
    while (block?.parentNode && block.parentNode !== container) block = block.parentNode;
    if (previousBlock && block !== previousBlock) text += "\n";
    const start = text.length;
    text += node.nodeValue || "";
    segments.push({ node, start, end: text.length });
    previousBlock = block;
  }
  return findTextOccurrences(text, query).map(start => {
    const end = start + query.length;
    const first = segments.find(segment => start >= segment.start && start < segment.end);
    const last = [...segments].reverse().find(segment => end > segment.start && end <= segment.end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }).filter(Boolean);
}

function editorTextRanges(query = $("#findTextInput")?.value || "") {
  return containerTextRanges($("#chapterContent"), query);
}

function markdownTextRanges(markdown, query = $("#findTextInput")?.value || "") {
  const container = document.createElement("div");
  container.innerHTML = markdownToEditorHtml(markdown || "");
  return { container, ranges: containerTextRanges(container, query) };
}

function removeEmptyInlineFormatting(container) {
  [...container.querySelectorAll("strong,b,em,i,u,del,s,strike,code,a")].reverse().forEach(element => {
    if (!element.textContent && !element.querySelector("img")) element.remove();
  });
}

function replaceVisibleMarkdownText(markdown, query, replacement) {
  const { container, ranges } = markdownTextRanges(markdown, query);
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
  }
  removeEmptyInlineFormatting(container);
  return { text: richContainerToMarkdown(container), count: ranges.length };
}

function clearFindHighlights() {
  if (globalThis.CSS?.highlights) {
    CSS.highlights.delete("motu-find-match");
    CSS.highlights.delete("motu-find-current");
  }
}

function collectFindRecords() {
  const query = $("#findTextInput")?.value || "";
  if (!query || !state.project) return [];
  if (state.find.scope === "chapter") {
    return editorTextRanges(query).map((_, localIndex) => ({ chapterId: state.activeChapterId, localIndex }));
  }
  return state.project.chapters.flatMap(chapter => {
    const matches = markdownTextRanges(chapter.content || "", query).ranges;
    return matches.map((_, localIndex) => ({ chapterId: chapter.id, localIndex }));
  });
}

function currentFindRecord() {
  return state.find.records[state.find.currentIndex] || null;
}

function renderFindHighlights(scrollCurrent = false) {
  clearFindHighlights();
  const query = $("#findTextInput")?.value || "";
  if (!query) return;
  const ranges = editorTextRanges(query);
  const record = currentFindRecord();
  const currentRange = record?.chapterId === state.activeChapterId ? ranges[record.localIndex] : null;
  if (globalThis.Highlight && globalThis.CSS?.highlights) {
    if (ranges.length) CSS.highlights.set("motu-find-match", new Highlight(...ranges));
    if (currentRange) CSS.highlights.set("motu-find-current", new Highlight(currentRange));
  }
  if (scrollCurrent && currentRange) {
    const target = currentRange.startContainer.parentElement;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function updateFindControls() {
  const total = state.find.records.length;
  const current = total ? state.find.currentIndex + 1 : 0;
  $("#findMatchCounter").textContent = `${current} / ${total}`;
  const query = $("#findTextInput").value;
  $("#findMinimizedSummary").textContent = query ? `${query} · ${current}/${total}` : "等待查找";
  $("#findPreviousButton").disabled = total === 0;
  $("#findNextButton").disabled = total === 0;
  $("#replaceCurrentButton").disabled = total === 0;
  const activeMatches = query ? markdownTextRanges(activeChapter()?.content || "", query).ranges.length : 0;
  const bookMatches = query && state.project ? state.project.chapters.reduce((sum, chapter) => sum + markdownTextRanges(chapter.content || "", query).ranges.length, 0) : 0;
  $("#replaceChapterButton").disabled = activeMatches === 0;
  $("#replaceBookButton").disabled = bookMatches === 0;
}

function refreshFindResults({ reset = false, scroll = false } = {}) {
  const previous = currentFindRecord();
  state.find.query = $("#findTextInput")?.value || "";
  state.find.records = collectFindRecords();
  if (!state.find.records.length) state.find.currentIndex = -1;
  else if (reset) {
    const activeIndex = state.find.records.findIndex(record => record.chapterId === state.activeChapterId);
    state.find.currentIndex = activeIndex >= 0 ? activeIndex : 0;
  } else {
    const preservedIndex = previous ? state.find.records.findIndex(record => record.chapterId === previous.chapterId && record.localIndex === previous.localIndex) : -1;
    state.find.currentIndex = preservedIndex >= 0 ? preservedIndex : Math.min(Math.max(state.find.currentIndex, 0), state.find.records.length - 1);
  }
  updateFindControls();
  renderFindHighlights(scroll);
}

function activateCurrentFindRecord(scroll = true) {
  const record = currentFindRecord();
  if (!record) return;
  if (record.chapterId !== state.activeChapterId) {
    state.activeChapterId = record.chapterId;
    localStorage.setItem("motu.activeChapterId", record.chapterId);
    renderChapters();
    renderEditor();
    switchView("write");
    requestAnimationFrame(() => renderFindHighlights(scroll));
  } else renderFindHighlights(scroll);
  updateFindControls();
}

function navigateFind(direction) {
  if (!state.find.records.length) refreshFindResults({ reset: true });
  if (!state.find.records.length) return;
  state.find.currentIndex = (state.find.currentIndex + direction + state.find.records.length) % state.find.records.length;
  activateCurrentFindRecord(true);
}

function setFindScope(scope) {
  state.find.scope = scope === "book" ? "book" : "chapter";
  $$("#findScopePicker [data-find-scope]").forEach(button => {
    const active = button.dataset.findScope === state.find.scope;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  refreshFindResults({ reset: true });
}

function normalizedFindPanelLayout(value = {}) {
  const finiteOrNull = candidate => candidate === null || candidate === undefined || candidate === "" ? null : (Number.isFinite(Number(candidate)) ? Number(candidate) : null);
  return {
    x: finiteOrNull(value.x),
    y: finiteOrNull(value.y),
    compact: Boolean(value.compact),
    minimized: Boolean(value.minimized),
  };
}

function loadFindPanelLayout() {
  try {
    findPanelLayout = normalizedFindPanelLayout(JSON.parse(localStorage.getItem("motu.findPanelLayout") || "{}"));
  } catch (_) {
    findPanelLayout = { ...findPanelLayoutDefaults };
  }
  applyFindPanelLayout();
}

function saveFindPanelLayout() {
  applyFindPanelLayout();
  localStorage.setItem("motu.findPanelLayout", JSON.stringify(findPanelLayout));
}

function applyFindPanelLayout() {
  const panel = $("#findReplacePanel");
  if (!panel) return;
  panel.classList.toggle("compact", findPanelLayout.compact);
  panel.classList.toggle("minimized", findPanelLayout.minimized);
  const compactButton = $("#findCompactButton");
  compactButton?.setAttribute("aria-pressed", String(findPanelLayout.compact));
  if (compactButton) {
    compactButton.textContent = findPanelLayout.compact ? "标准窗" : "小窗";
    compactButton.title = findPanelLayout.compact ? "切换到标准窗口" : "切换小窗模式";
  }
  const minimizeButton = $("#findMinimizeButton");
  minimizeButton?.setAttribute("aria-pressed", String(findPanelLayout.minimized));
  if (minimizeButton) {
    const label = findPanelLayout.minimized ? "恢复查找窗口" : "最小化查找窗口";
    minimizeButton.textContent = findPanelLayout.minimized ? "▢" : "—";
    minimizeButton.title = label;
    minimizeButton.setAttribute("aria-label", label);
  }
  if (window.innerWidth <= 900) {
    panel.style.left = "10px";
    panel.style.top = "112px";
    panel.style.transform = "none";
    return;
  }
  if (findPanelLayout.x === null || findPanelLayout.y === null) {
    panel.style.removeProperty("left");
    panel.style.removeProperty("top");
    panel.style.removeProperty("transform");
    return;
  }
  const width = panel.getBoundingClientRect().width || (findPanelLayout.compact ? 430 : 620);
  const height = panel.getBoundingClientRect().height || 64;
  findPanelLayout.x = Math.max(8, Math.min(window.innerWidth - width - 8, findPanelLayout.x));
  findPanelLayout.y = Math.max(8, Math.min(window.innerHeight - height - 8, findPanelLayout.y));
  panel.style.left = `${findPanelLayout.x}px`;
  panel.style.top = `${findPanelLayout.y}px`;
  panel.style.transform = "none";
}

function bindFindPanelDrag() {
  const panel = $("#findReplacePanel");
  const handle = $("#findPanelDragHandle");
  if (!panel || !handle) return;
  handle.addEventListener("pointerdown", event => {
    if (window.innerWidth <= 900 || event.button !== 0 || event.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    const start = { pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top };
    handle.setPointerCapture(event.pointerId);
    panel.classList.add("dragging");
    event.preventDefault();
    const move = moveEvent => {
      const width = panel.getBoundingClientRect().width;
      const height = panel.getBoundingClientRect().height;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, start.left + moveEvent.clientX - start.pointerX));
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, start.top + moveEvent.clientY - start.pointerY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.transform = "none";
      findPanelLayout.x = left;
      findPanelLayout.y = top;
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      panel.classList.remove("dragging");
      localStorage.setItem("motu.findPanelLayout", JSON.stringify(findPanelLayout));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
}

function setFindReplacePanel(open, focusReplacement = false) {
  const panel = $("#findReplacePanel");
  const button = $("#findReplaceButton");
  if (!panel || !button) return;
  if (open) {
    setShortcutPanel(false);
    setTypographyPanel(false);
    setBackgroundPanel(false);
  }
  panel.hidden = !open;
  button.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
  if (!open) {
    clearFindHighlights();
    return;
  }
  applyFindPanelLayout();
  refreshFindResults({ reset: true });
  if (!findPanelLayout.minimized) requestAnimationFrame(() => (focusReplacement ? $("#replaceTextInput") : $("#findTextInput")).focus());
}

function replaceCurrentFindMatch() {
  const record = currentFindRecord();
  if (!record) return;
  if (record.chapterId !== state.activeChapterId) {
    activateCurrentFindRecord(false);
    requestAnimationFrame(replaceCurrentFindMatch);
    return;
  }
  const ranges = editorTextRanges($("#findTextInput").value);
  const range = ranges[record.localIndex];
  if (!range) return;
  clearFindHighlights();
  const replacement = document.createTextNode($("#replaceTextInput").value);
  range.deleteContents();
  range.insertNode(replacement);
  range.setStartAfter(replacement);
  range.collapse(true);
  removeEmptyInlineFormatting($("#chapterContent"));
  syncRichEditorChange();
  refreshFindResults({ scroll: true });
}

async function replaceAcrossChapters(chapters, label) {
  const query = $("#findTextInput").value;
  if (!query || !chapters.length) return;
  flushEditorHistory();
  const replacement = $("#replaceTextInput").value;
  const updates = chapters.map(chapter => {
    const result = replaceVisibleMarkdownText(chapter.content || "", query, replacement);
    return { chapter, ...result };
  }).filter(update => update.count > 0);
  const total = updates.reduce((sum, update) => sum + update.count, 0);
  if (!total) { toast("没有可替换的匹配项"); return; }
  updates.forEach(update => ensureEditorHistory(update.chapter));
  clearTimeout(state.chapterTimer);
  setSaveState("正在替换", "saving");
  try {
    const saved = await Promise.all(updates.map(update => api(`/api/chapters/${update.chapter.id}`, {
      method: "PATCH", body: JSON.stringify({ title: update.chapter.title, content: update.text }),
    })));
    saved.forEach((chapter, index) => {
      Object.assign(updates[index].chapter, chapter);
      commitEditorHistory(chapter.id, chapterSnapshot(chapter));
    });
    renderChapters();
    renderEditor();
    setSaveState("已同步", "saved");
    refreshFindResults({ reset: true, scroll: true });
    toast(`${label}完成，共替换 ${total} 处`);
  } catch (error) {
    setSaveState("替换失败", "error");
    toast(error.message);
  }
}

function handleMarkdownShortcut(event) {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.code === "KeyZ") {
    event.preventDefault();
    moveEditorHistory(event.shiftKey ? 1 : -1);
    return;
  }
  if (mod && !event.shiftKey && event.code === "KeyY") {
    event.preventDefault();
    moveEditorHistory(1);
    return;
  }
  let action = null;
  if (event.key === "Tab" && !mod && !event.altKey) action = event.shiftKey ? "outdent" : "indent";
  else if (event.altKey && event.shiftKey && event.code === "Digit5") action = "strike";
  else if (mod && event.shiftKey && event.code === "Backquote") action = "inlineCode";
  else if (mod && event.shiftKey && event.code === "KeyK") action = "codeFence";
  else if (mod && event.shiftKey && event.code === "KeyQ") action = "quote";
  else if (mod && event.shiftKey && event.code === "KeyM") action = "mathBlock";
  else if (mod && event.shiftKey && event.code === "KeyI") action = "image";
  else if (mod && event.shiftKey && event.code === "BracketLeft") action = "orderedList";
  else if (mod && event.shiftKey && event.code === "BracketRight") action = "unorderedList";
  else if (mod && !event.shiftKey && /^Digit[0-6]$/.test(event.code)) action = event.code === "Digit0" ? "paragraph" : `heading${event.code.slice(-1)}`;
  else if (mod && !event.shiftKey && event.code === "KeyB") action = "bold";
  else if (mod && !event.shiftKey && event.code === "KeyI") action = "italic";
  else if (mod && !event.shiftKey && event.code === "KeyU") action = "underline";
  else if (mod && !event.shiftKey && event.code === "KeyK") action = "link";
  else if (mod && !event.shiftKey && event.code === "KeyT") action = "table";
  else if (mod && !event.shiftKey && event.code === "KeyS") action = "save";
  else if (mod && !event.shiftKey && event.code === "KeyL") action = "selectLine";
  else if (mod && !event.shiftKey && event.code === "KeyD") action = "selectWord";
  if (!action) return;
  event.preventDefault();
  applyMarkdownAction(action);
}

function activeChapter() {
  return state.project?.chapters.find(chapter => chapter.id === state.activeChapterId) || null;
}

function activeStoryMap() {
  return state.project?.maps?.find(storyMap => storyMap.id === state.activeMapId) || null;
}

function activeMapNodes() {
  return state.project?.nodes.filter(node => node.map_id === state.activeMapId) || [];
}

function activeMapEdges() {
  return state.project?.edges.filter(edge => edge.map_id === state.activeMapId) || [];
}

function activeMapNotes() {
  const nodeIds = new Set(activeMapNodes().map(node => node.id));
  return state.project?.notes.filter(note => nodeIds.has(note.node_id)) || [];
}

function activeDocument() {
  return activeChapter();
}

async function boot() {
  loadWritingTypography();
  loadWritingAppearance();
  loadFindPanelLayout();
  loadSplitViewLayout();
  bindEvents();
  $("#serverUrl").value = state.config.serverUrl;
  $("#apiKey").value = state.config.apiKey;
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
  await connect();
}

async function connect() {
  setSaveState("正在连接", "saving");
  try {
    const health = await api("/api/health");
    assertCompatibleApi(health);
    state.projects = await api("/api/projects");
    if (!state.projects.length) {
      const created = await api("/api/projects", { method: "POST", body: JSON.stringify({ title: "我的第一部小说", description: "" }) });
      state.projects = [created];
    }
    const storedId = localStorage.getItem("motu.projectId");
    await loadProject(state.projects.some(item => item.id === storedId) ? storedId : state.projects[0].id);
    setSaveState("已同步", "saved");
  } catch (error) {
    setSaveState("连接失败", "error");
    $("#projectTitle").textContent = "未连接服务器";
    $("#connectionResult").textContent = error.message;
    $("#connectionResult").className = "connection-result error";
    $("#settingsDialog").showModal();
  }
}

async function loadProject(projectId) {
  setSaveState("正在载入", "saving");
  clearTimeout(state.editorHistoryTimer);
  state.editorHistoryTimer = null;
  state.editorHistories.clear();
  state.project = await api(`/api/projects/${projectId}`);
  state.project.notes ||= [];
  state.project.maps ||= [];
  localStorage.setItem("motu.projectId", projectId);
  const storedMapId = localStorage.getItem(`motu.activeMapId.${projectId}`);
  state.activeMapId = state.project.maps.some(storyMap => storyMap.id === storedMapId)
    ? storedMapId
    : state.project.maps[0]?.id || null;
  state.mapViewStates.clear();
  if (!state.project.chapters.some(chapter => chapter.id === state.activeChapterId)) {
    state.activeChapterId = state.project.chapters[0]?.id || null;
  }
  state.selectedNodeId = null;
  state.selectedNodeIds.clear();
  state.selectedEdgeId = null;
  state.selectedEdgeIds.clear();
  state.connectSourceId = null;
  state.chapterBulkMode = false;
  state.selectedChapterIds.clear();
  state.pendingChapterDeleteIds = [];
  state.pendingVolumeDeleteId = null;
  try {
    state.collapsedVolumeIds = new Set(JSON.parse(localStorage.getItem(`motu.collapsedVolumes.${projectId}`) || "[]"));
  } catch (_) {
    state.collapsedVolumeIds = new Set();
  }
  state.storyMapsCollapsed = localStorage.getItem(`motu.storyMapsCollapsed.${projectId}`) === "true";
  state.camera = { x: 0, y: 0 };
  state.canvasAnchor = null;
  state.canvasBounds = null;
  state.canvasInitialized = false;
  renderAll();
  switchView("map");
  setSaveState("已同步", "saved");
}

function renderAll() {
  if (!state.project) return;
  $("#projectTitle").textContent = state.project.title;
  renderStoryMaps();
  renderChapters();
  renderEditor();
  renderMap();
  renderChapterOptions();
  renderSplitChapterOptions();
  setSplitView(state.split.open);
}

function renderStoryMaps() {
  if (!state.project) return;
  const maps = state.project.maps || [];
  const mapViewActive = $("#mapView")?.classList.contains("active");
  const collapseButton = $("#collapseStoryMapsButton");
  $("#storyMapList").hidden = state.storyMapsCollapsed;
  collapseButton.textContent = state.storyMapsCollapsed ? "▸" : "▾";
  collapseButton.setAttribute("aria-expanded", String(!state.storyMapsCollapsed));
  collapseButton.setAttribute("aria-label", `${state.storyMapsCollapsed ? "展开" : "折叠"}故事地图`);
  $("#storyMapList").innerHTML = maps.map(storyMap => {
    const nodeCount = state.project.nodes.filter(node => node.map_id === storyMap.id).length;
    return `<li class="story-map-item ${mapViewActive && storyMap.id === state.activeMapId ? "active" : ""}" data-story-map-id="${storyMap.id}" title="${escapeHtml(storyMap.title)} · ${nodeCount} 个节点">
      <span class="story-map-icon" aria-hidden="true">◇</span>
      <span class="story-map-name">${escapeHtml(storyMap.title)}</span>
      <span class="story-map-actions"><button type="button" data-rename-map="${storyMap.id}" title="重命名地图">改名</button><button type="button" data-delete-map="${storyMap.id}" title="${maps.length <= 1 ? "作品至少需要保留一张地图" : "删除地图"}" ${maps.length <= 1 ? "disabled" : ""}>删除</button></span>
    </li>`;
  }).join("");
  const current = activeStoryMap();
  $("#activeMapTitle").textContent = current?.title || "故事地图";
}

function chapterMatchesFilter(chapter, filter) {
  return chapter.title.toLowerCase().includes(filter);
}

function chapterNumberInVolume(chapter) {
  if (!state.project || !chapter) return 0;
  const volumeChapters = state.project.chapters.filter(item => item.volume_id === chapter.volume_id);
  const index = volumeChapters.findIndex(item => item.id === chapter.id);
  return index >= 0 ? index + 1 : state.project.chapters.indexOf(chapter) + 1;
}

function chapterOptionLabel(chapter) {
  const number = String(chapterNumberInVolume(chapter)).padStart(2, "0");
  const volume = state.project?.volumes.find(item => item.id === chapter.volume_id);
  return `${number} · ${chapter.title}${volume ? `（${volume.title}）` : ""}`;
}

function sortProjectChapters() {
  if (!state.project) return;
  const volumeOrder = new Map(state.project.volumes.map((volume, index) => [volume.id, index]));
  state.project.chapters.sort((left, right) => {
    const volumeDifference = (volumeOrder.get(left.volume_id) ?? Number.MAX_SAFE_INTEGER)
      - (volumeOrder.get(right.volume_id) ?? Number.MAX_SAFE_INTEGER);
    return volumeDifference || left.position - right.position;
  });
}

function renderChapters(filter = $("#chapterSearch").value.trim().toLowerCase()) {
  if (!state.project) return;
  state.project.volumes ||= [];
  $(".chapter-panel").classList.toggle("bulk-mode", state.chapterBulkMode);
  $("#chapterBatchButton").classList.toggle("active", state.chapterBulkMode);
  $("#chapterBatchButton").textContent = state.chapterBulkMode ? "完成" : "批量删除";
  $("#chapterBatchButton").disabled = state.project.chapters.length <= 1;
  const chapters = state.project.chapters.filter(chapter => chapterMatchesFilter(chapter, filter));
  const totalVolumes = state.project.volumes.length;
  const writeViewActive = $("#writeView")?.classList.contains("active");
  const visibleVolumes = filter
    ? state.project.volumes.filter(volume => chapters.some(chapter => chapter.volume_id === volume.id))
    : state.project.volumes;
  $("#chapterList").innerHTML = visibleVolumes.map(volume => {
    const volumeChapters = chapters.filter(chapter => chapter.volume_id === volume.id);
    const allVolumeChapters = state.project.chapters.filter(chapter => chapter.volume_id === volume.id);
    const selectedVolumeChapters = allVolumeChapters.filter(chapter => state.selectedChapterIds.has(chapter.id));
    const allVolumeSelected = allVolumeChapters.length > 0 && selectedVolumeChapters.length === allVolumeChapters.length;
    const volumeTotal = allVolumeChapters.length;
    const chapterRows = volumeChapters.map(chapter => {
      const index = chapterNumberInVolume(chapter);
      const checked = state.selectedChapterIds.has(chapter.id);
      return `<li class="chapter-group ${checked ? "selected-for-delete" : ""}">
        <div class="chapter-item ${state.chapterBulkMode ? "bulk-select" : ""} ${writeViewActive && chapter.id === state.activeChapterId ? "active" : ""}" data-chapter-id="${chapter.id}">
          ${state.chapterBulkMode ? `<input class="chapter-select" type="checkbox" data-chapter-select="${chapter.id}" aria-label="选择${escapeHtml(chapter.title)}" ${checked ? "checked" : ""} />` : ""}
          <span class="chapter-number">${String(index).padStart(2, "0")}</span>
          <span class="chapter-copy"><strong>${escapeHtml(chapter.title)}</strong></span>
          <span class="chapter-trailing"><span class="chapter-words">${wordCount(chapter.content)}</span><button class="chapter-action-button" type="button" data-rename-chapter="${chapter.id}" aria-label="修改${escapeHtml(chapter.title)}标题" title="修改章节标题">修改</button><button class="chapter-action-button" type="button" data-delete-chapter="${chapter.id}" aria-label="删除${escapeHtml(chapter.title)}" title="${state.project.chapters.length <= 1 ? "作品至少需要保留一个章节" : "删除章节"}" ${state.project.chapters.length <= 1 ? "disabled" : ""}>删除</button></span>
        </div>
      </li>`;
    }).join("");
    const collapsed = !filter && state.collapsedVolumeIds.has(volume.id);
    const volumeActions = state.chapterBulkMode
      ? `<button class="volume-select-all-button" type="button" data-select-all-volume="${volume.id}" aria-pressed="${allVolumeSelected}" title="${allVolumeSelected ? "取消选择" : "选择"}${escapeHtml(volume.title)}的全部章节">${allVolumeSelected ? "取消全选" : "全选"}</button><button class="volume-delete-selected-button" type="button" data-delete-volume-selected="${volume.id}" ${selectedVolumeChapters.length ? "" : "disabled"} title="删除本卷选中的 ${selectedVolumeChapters.length} 个章节">删除所选</button>`
      : `<button class="volume-add-chapter" type="button" data-add-chapter-volume="${volume.id}" title="在${escapeHtml(volume.title)}中新建章节">＋ 章节</button><button class="volume-delete-button" type="button" data-delete-volume="${volume.id}" title="删除故事卷" ${totalVolumes <= 1 ? "disabled" : ""}>删卷</button>`;
    return `<li class="volume-group">
      <div class="volume-label">
        <div class="volume-label-info"><button class="volume-collapse-button" type="button" data-toggle-volume="${volume.id}" aria-controls="volume-chapters-${volume.id}" aria-expanded="${!collapsed}" aria-label="${collapsed ? "展开" : "折叠"}${escapeHtml(volume.title)}">${collapsed ? "▸" : "▾"}</button><strong>${escapeHtml(volume.title)}</strong><small>${volumeTotal} 章</small></div>
        <div class="volume-actions">${volumeActions}</div>
      </div>
      <ol id="volume-chapters-${volume.id}" class="volume-chapter-list" ${collapsed ? "hidden" : ""}>${chapterRows}</ol>
    </li>`;
  }).join("");
  const chapterWords = state.project.chapters.reduce((sum, chapter) => sum + wordCount(chapter.content), 0);
  $("#totalWords").textContent = chapterWords.toLocaleString();
}

function renderEditor() {
  const chapter = activeChapter();
  if (!chapter) return;
  ensureEditorHistory(chapter);
  const chapterIndex = chapterNumberInVolume(chapter);
  $("#chapterIndex").textContent = `CHAPTER ${String(chapterIndex).padStart(2, "0")}`;
  $("#chapterSubtitle").textContent = "在安静里，把故事写下来。";
  $("#chapterTitleInput").value = chapter.title;
  $("#chapterContent").innerHTML = markdownToEditorHtml(chapter.content);
  $("#chapterWords").textContent = `${wordCount(chapter.content)} 字`;
  renderLinkedNodes();
  updateHistoryButtons();
  requestAnimationFrame(resizeManuscript);
}

function renderLinkedNodes() {
  if (!state.project) return;
  const nodes = state.project.nodes.filter(node => node.chapter_id === state.activeChapterId);
  const edges = state.project.edges.filter(edge => edge.chapter_id === state.activeChapterId);
  const nodeMap = new Map(state.project.nodes.map(node => [node.id, node.label]));
  const storyMapNames = new Map(state.project.maps.map(storyMap => [storyMap.id, storyMap.title]));
  const pills = [
    ...nodes.map(node => `<button class="linked-node-pill" type="button" data-linked-node-id="${node.id}">图形 · ${escapeHtml(node.label)} · ${escapeHtml(storyMapNames.get(node.map_id) || "故事地图")}</button>`),
    ...edges.map(edge => `<button class="linked-node-pill linked-edge-pill" type="button" data-linked-edge-id="${edge.id}">箭头 · ${escapeHtml(nodeMap.get(edge.source_id) || "起点")} → ${escapeHtml(nodeMap.get(edge.target_id) || "终点")} · ${escapeHtml(storyMapNames.get(edge.map_id) || "故事地图")}</button>`),
  ];
  $("#linkedNodeBar").innerHTML = pills.length ? `<span class="linked-node-label">关联故事地图</span>${pills.join("")}` : "";
}

function renderChapterOptions() {
  const currentValue = $("#nodeChapter").value;
  $("#nodeChapter").innerHTML = `<option value="">不链接章节</option>${state.project.chapters.map(chapter => `<option value="${chapter.id}">${escapeHtml(chapterOptionLabel(chapter))}</option>`).join("")}`;
  $("#nodeChapter").value = currentValue;
}

function nodePortMarkup(shape) {
  const ports = shape === "hexagon"
    ? [
        ["top_left", "左上角"], ["top_right", "右上角"], ["right", "右侧角"],
        ["bottom_right", "右下角"], ["bottom_left", "左下角"], ["left", "左侧角"],
      ]
    : [["top", "上方"], ["right", "右侧"], ["bottom", "下方"], ["left", "左侧"]];
  return ports.map(([port, label]) => `<button class="node-port port-${port.replaceAll("_", "-")}" data-port="${port}" type="button" title="从${label}连接"></button>`).join("");
}

const MAX_CANVAS_RADIUS = 10000;
const CANVAS_GROWTH_MARGIN = 260;

function nodeWorldSize(node) {
  if (node.shape === "circle") return { width: 124, height: 124 };
  if (node.shape === "diamond") return { width: 188, height: 188 };
  if (node.shape === "hexagon") return { width: 168, height: 146 };
  if (["ellipse", "cylinder"].includes(node.shape)) return { width: 168, height: 100 };
  return { width: 168, height: 86 };
}

function ensureCanvasState() {
  if (state.canvasInitialized || !state.project) return;
  const viewport = $("#mapViewport").getBoundingClientRect();
  if (!viewport.width || !viewport.height) return;
  state.canvasAnchor = { x: viewport.width / 2, y: viewport.height / 2 };
  state.canvasBounds = { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height };
  state.canvasInitialized = true;
  expandCanvasBoundsForNodes();
}

function expandCanvasBoundsForNodes() {
  if (!state.canvasBounds || !state.project) return;
  const limit = state.canvasAnchor || { x: 0, y: 0 };
  activeMapNodes().forEach(node => {
    const size = nodeWorldSize(node);
    state.canvasBounds.minX = Math.max(limit.x - MAX_CANVAS_RADIUS, Math.min(state.canvasBounds.minX, node.x - CANVAS_GROWTH_MARGIN));
    state.canvasBounds.minY = Math.max(limit.y - MAX_CANVAS_RADIUS, Math.min(state.canvasBounds.minY, node.y - CANVAS_GROWTH_MARGIN));
    state.canvasBounds.maxX = Math.min(limit.x + MAX_CANVAS_RADIUS, Math.max(state.canvasBounds.maxX, node.x + size.width + CANVAS_GROWTH_MARGIN));
    state.canvasBounds.maxY = Math.min(limit.y + MAX_CANVAS_RADIUS, Math.max(state.canvasBounds.maxY, node.y + size.height + CANVAS_GROWTH_MARGIN));
  });
}

function expandCanvasBoundsToVisible() {
  if (!state.canvasBounds || !state.canvasAnchor) return;
  const viewport = $("#mapViewport");
  const visible = { left: -state.camera.x, top: -state.camera.y, right: viewport.clientWidth - state.camera.x, bottom: viewport.clientHeight - state.camera.y };
  if (visible.left < state.canvasBounds.minX) state.canvasBounds.minX = Math.max(state.canvasAnchor.x - MAX_CANVAS_RADIUS, visible.left - CANVAS_GROWTH_MARGIN);
  if (visible.top < state.canvasBounds.minY) state.canvasBounds.minY = Math.max(state.canvasAnchor.y - MAX_CANVAS_RADIUS, visible.top - CANVAS_GROWTH_MARGIN);
  if (visible.right > state.canvasBounds.maxX) state.canvasBounds.maxX = Math.min(state.canvasAnchor.x + MAX_CANVAS_RADIUS, visible.right + CANVAS_GROWTH_MARGIN);
  if (visible.bottom > state.canvasBounds.maxY) state.canvasBounds.maxY = Math.min(state.canvasAnchor.y + MAX_CANVAS_RADIUS, visible.bottom + CANVAS_GROWTH_MARGIN);
}

function clampCamera() {
  if (!state.canvasAnchor) return;
  const viewport = $("#mapViewport");
  const minWorldX = state.canvasAnchor.x - MAX_CANVAS_RADIUS; const maxWorldX = state.canvasAnchor.x + MAX_CANVAS_RADIUS;
  const minWorldY = state.canvasAnchor.y - MAX_CANVAS_RADIUS; const maxWorldY = state.canvasAnchor.y + MAX_CANVAS_RADIUS;
  state.camera.x = Math.max(viewport.clientWidth - maxWorldX, Math.min(-minWorldX, state.camera.x));
  state.camera.y = Math.max(viewport.clientHeight - maxWorldY, Math.min(-minWorldY, state.camera.y));
}

function applyCamera() {
  ensureCanvasState();
  if (!state.canvasInitialized) return;
  const viewport = $("#mapViewport");
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  clampCamera();
  expandCanvasBoundsToVisible();
  $("#nodeLayer").style.transform = `translate(${state.camera.x}px, ${state.camera.y}px)`;
  $("#mapViewport").style.backgroundPosition = `${state.camera.x}px ${state.camera.y}px`;
  renderEdges();
  renderMinimap();
}

function panCanvasBy(dx, dy) {
  ensureCanvasState();
  state.camera.x += dx; state.camera.y += dy;
  applyCamera();
}

function centerCanvasOnAnchor() {
  ensureCanvasState();
  const viewport = $("#mapViewport");
  state.camera.x = viewport.clientWidth / 2 - state.canvasAnchor.x;
  state.camera.y = viewport.clientHeight / 2 - state.canvasAnchor.y;
  applyCamera();
  toast("已回到流程图开始中心");
}

function centerCanvasOnWorldPoint(x, y) {
  ensureCanvasState();
  const viewport = $("#mapViewport");
  state.camera.x = viewport.clientWidth / 2 - x;
  state.camera.y = viewport.clientHeight / 2 - y;
  applyCamera();
}

function renderMinimap() {
  if (!state.canvasInitialized || !state.canvasBounds || !state.project) return;
  const viewport = $("#mapViewport"); const panel = $("#minimapPanel"); const svg = $("#minimapSvg");
  const bounds = state.canvasBounds;
  const width = Math.max(1, bounds.maxX - bounds.minX); const height = Math.max(1, bounds.maxY - bounds.minY);
  const nodesForMap = activeMapNodes();
  const edgesForMap = activeMapEdges();
  const shouldShow = nodesForMap.length >= 5 || width > viewport.clientWidth * 1.15 || height > viewport.clientHeight * 1.15 || Math.abs(state.camera.x) + Math.abs(state.camera.y) > 20;
  panel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;
  const placedLeft = parseFloat(panel.style.left); const placedTop = parseFloat(panel.style.top);
  if (Number.isFinite(placedLeft) && Number.isFinite(placedTop)) {
    panel.style.left = `${Math.max(8, Math.min(viewport.clientWidth - panel.offsetWidth - 8, placedLeft))}px`;
    panel.style.top = `${Math.max(8, Math.min(viewport.clientHeight - panel.offsetHeight - 8, placedTop))}px`;
  }
  svg.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const nodeMap = new Map(nodesForMap.map(node => [node.id, node]));
  const colors = { blue: "#60a5fa", violet: "#8b5cf6", green: "#34d399", amber: "#f59e0b", rose: "#fb7185", slate: "#94a3b8" };
  const edges = edgesForMap.map(edge => {
    const source = nodeMap.get(edge.source_id); const target = nodeMap.get(edge.target_id);
    if (!source || !target) return "";
    const sourceSize = nodeWorldSize(source); const targetSize = nodeWorldSize(target);
    return `<line x1="${source.x + sourceSize.width / 2}" y1="${source.y + sourceSize.height / 2}" x2="${target.x + targetSize.width / 2}" y2="${target.y + targetSize.height / 2}" stroke="${colors[edge.color] || colors.blue}"/>`;
  }).join("");
  const nodes = nodesForMap.map(node => {
    const size = nodeWorldSize(node);
    return `<rect x="${node.x}" y="${node.y}" width="${size.width}" height="${size.height}" rx="12" fill="${colors[node.color] || colors.blue}"/>`;
  }).join("");
  const visibleX = -state.camera.x; const visibleY = -state.camera.y;
  svg.innerHTML = `<g class="minimap-edges">${edges}</g><g class="minimap-nodes">${nodes}</g><circle class="minimap-anchor" cx="${state.canvasAnchor.x}" cy="${state.canvasAnchor.y}" r="10"/><rect id="minimapViewportRect" class="minimap-viewport-rect" x="${visibleX}" y="${visibleY}" width="${viewport.clientWidth}" height="${viewport.clientHeight}"/>`;
}

function renderMap() {
  if (!state.project) return;
  ensureCanvasState();
  const nodesForMap = activeMapNodes();
  const edgesForMap = activeMapEdges();
  renderStoryMaps();
  $("#clearCanvasButton").disabled = nodesForMap.length === 0 && edgesForMap.length === 0;
  const chapterMap = new Map(state.project.chapters.map(chapter => [chapter.id, chapter.title]));
  $("#nodeLayer").innerHTML = nodesForMap.map(node => {
    const notes = state.project.notes.filter(note => note.node_id === node.id);
    const noteCards = notes.map(note => `<div class="node-note-card ${note.locked ? "locked" : ""}" data-note-id="${note.id}" title="点击编辑便签">${escapeHtml(note.content)}</div>`).join("");
    const selected = node.id === state.selectedNodeId || state.selectedNodeIds.has(node.id);
    return `<article class="story-node shape-${node.shape} ${selected ? "selected" : ""}" data-node-id="${node.id}" data-color="${node.color}" style="left:${node.x}px;top:${node.y}px" tabindex="0">
    ${nodePortMarkup(node.shape)}
    <button class="node-menu-button" type="button" title="节点操作">•••</button>
    ${notes.length ? `<div class="node-notes-popover has-notes ${notes.some(note => note.locked) ? "has-locked" : ""}">${noteCards}</div>` : ""}
    <div class="node-inner"><span class="node-type">${nodeTypeNames[node.node_type] || "节点"}</span>
    <strong class="node-label">${escapeHtml(node.label)}</strong>
    ${node.chapter_id ? `<span class="node-link">${escapeHtml(chapterMap.get(node.chapter_id) || "章节已删除")}</span>` : ""}
    </div>
  </article>`;
  }).join("");
  $("#mapEmpty").classList.toggle("hidden", nodesForMap.length > 0);
  requestAnimationFrame(applyCamera);
}

function renderEdges() {
  if (!state.project) return;
  const viewport = $("#mapViewport").getBoundingClientRect();
  const positions = new Map();
  const shapeMap = new Map(activeMapNodes().map(node => [node.id, node.shape]));
  $$(".story-node").forEach(element => {
    const rect = element.getBoundingClientRect();
    positions.set(element.dataset.nodeId, {
      top: { x: rect.left - viewport.left + rect.width / 2, y: rect.top - viewport.top },
      top_left: { x: rect.left - viewport.left + rect.width * .25, y: rect.top - viewport.top },
      top_right: { x: rect.left - viewport.left + rect.width * .75, y: rect.top - viewport.top },
      right: { x: rect.right - viewport.left, y: rect.top - viewport.top + rect.height / 2 },
      bottom: { x: rect.left - viewport.left + rect.width / 2, y: rect.bottom - viewport.top },
      bottom_right: { x: rect.left - viewport.left + rect.width * .75, y: rect.bottom - viewport.top },
      bottom_left: { x: rect.left - viewport.left + rect.width * .25, y: rect.bottom - viewport.top },
      left: { x: rect.left - viewport.left, y: rect.top - viewport.top + rect.height / 2 },
    });
  });
  $("#edgeLayer").setAttribute("viewBox", `0 0 ${Math.max(1, viewport.width)} ${Math.max(1, viewport.height)}`);
  const paths = activeMapEdges().map(edge => {
    const sourcePort = normalizedEdgePort(shapeMap.get(edge.source_id), edge.source_port || "right", "source");
    const targetPort = normalizedEdgePort(shapeMap.get(edge.target_id), edge.target_port || "left", "target");
    const source = positions.get(edge.source_id)?.[sourcePort];
    const target = positions.get(edge.target_id)?.[targetPort];
    if (!source || !target) return "";
    const path = connectorPath(source, target, sourcePort, targetPort);
    const middle = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 - 7 };
    const style = edge.line_style || "solid";
    const color = edge.color || "blue";
    const selected = edge.id === state.selectedEdgeId || state.selectedEdgeIds.has(edge.id) ? " selected" : "";
    const chapter = state.project.chapters.find(item => item.id === edge.chapter_id);
    const chapterIndex = chapter ? chapterNumberInVolume(chapter) : 0;
    const lines = [];
    if (edge.label?.trim()) lines.push(edge.label.trim().split(/\r?\n/)[0].slice(0, 28));
    if (chapter) lines.push(`链接 ${String(chapterIndex).padStart(2, "0")} · ${chapter.title.slice(0, 24)}`);
    const label = lines.length ? `<text class="edge-label" x="${middle.x}" y="${middle.y - (lines.length - 1) * 7}" text-anchor="middle">${lines.map((line, index) => `<tspan x="${middle.x}" dy="${index ? 15 : 0}">${escapeHtml(line)}</tspan>`).join("")}</text>` : "";
    return `<path class="edge-hit" data-edge-id="${edge.id}" d="${path}"/><path class="edge-line line-${style}${selected}" data-edge-color="${color}" marker-end="url(#arrow-${color})" data-edge-id="${edge.id}" d="${path}"/>${label}`;
  }).join("");
  let preview = "";
  if (state.portDrag) {
    const source = positions.get(state.portDrag.sourceId)?.[state.portDrag.sourcePort];
    const target = state.portDrag.pointer;
    const targetPort = state.portDrag.targetPort || suggestedPreviewTargetPort(source, target);
    if (source && target) preview = `<path class="edge-preview" d="${connectorPath(source, target, state.portDrag.sourcePort, targetPort)}"/>`;
  }
  const markerColors = { blue: "#6f93c5", violet: "#7c3aed", green: "#0f9f78", amber: "#e59a28", rose: "#dc5670", slate: "#64748b" };
  const markers = Object.entries(markerColors).map(([name, value]) => `<marker id="arrow-${name}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${value}"></path></marker>`).join("");
  $("#edgeLayer").innerHTML = `<defs>${markers}</defs>${paths}${preview}`;
}

function normalizedEdgePort(shape, port, role) {
  if (shape !== "hexagon") return port;
  if (port === "top") return role === "source" ? "top_right" : "top_left";
  if (port === "bottom") return role === "source" ? "bottom_right" : "bottom_left";
  return port;
}

function suggestedPreviewTargetPort(source, target) {
  if (!source || !target) return "left";
  const dx = target.x - source.x; const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "left" : "right";
  return dy >= 0 ? "top" : "bottom";
}

function suggestedPortsBetweenNodes(sourceId, targetId) {
  const sourceElement = document.querySelector(`.story-node[data-node-id="${sourceId}"]`);
  const targetElement = document.querySelector(`.story-node[data-node-id="${targetId}"]`);
  if (!sourceElement || !targetElement) return { sourcePort: "right", targetPort: "left" };
  const source = sourceElement.getBoundingClientRect(); const target = targetElement.getBoundingClientRect();
  const dx = target.left + target.width / 2 - (source.left + source.width / 2);
  const dy = target.top + target.height / 2 - (source.top + source.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { sourcePort: "right", targetPort: "left" } : { sourcePort: "left", targetPort: "right" };
  return dy >= 0 ? { sourcePort: "bottom", targetPort: "top" } : { sourcePort: "top", targetPort: "bottom" };
}

function connectorPath(source, target, sourcePort, targetPort) {
  const vectors = {
    top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0],
    top_left: [-.5, -.866], top_right: [.5, -.866],
    bottom_right: [.5, .866], bottom_left: [-.5, .866],
  };
  const sourceVector = vectors[sourcePort] || vectors.right;
  const targetVector = vectors[targetPort] || vectors.left;
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const bend = Math.max(48, Math.min(150, distance * .42));
  const c1 = { x: source.x + sourceVector[0] * bend, y: source.y + sourceVector[1] * bend };
  const c2 = { x: target.x + targetVector[0] * bend, y: target.y + targetVector[1] * bend };
  return `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`;
}

function selectChapter(chapterId) {
  const chapter = state.project?.chapters.find(item => item.id === chapterId);
  if (!chapter) return;
  if (state.activeChapterId !== chapterId) flushEditorHistory();
  if (state.collapsedVolumeIds.delete(chapter.volume_id)) {
    localStorage.setItem(`motu.collapsedVolumes.${state.project.id}`, JSON.stringify([...state.collapsedVolumeIds]));
  }
  state.activeChapterId = chapterId;
  localStorage.setItem("motu.activeChapterId", chapterId);
  renderChapters();
  renderEditor();
  renderSplitPane();
  switchView("write");
  if (!$("#findReplacePanel")?.hidden) requestAnimationFrame(() => refreshFindResults({ reset: true }));
}

function switchView(view) {
  if ($("#shortcutPanel")) setShortcutPanel(false);
  if ($("#typographyPanel")) setTypographyPanel(false);
  if ($("#backgroundPanel")) setBackgroundPanel(false);
  if (view === "map" && $("#findReplacePanel")) setFindReplacePanel(false);
  $$(".view-button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$(".view-panel").forEach(panel => panel.classList.remove("active", "mobile-active"));
  const panel = view === "map" ? $("#mapView") : $("#writeView");
  panel.classList.add("active", "mobile-active");
  $(".chapter-panel").classList.remove("mobile-active");
  $$(".mobile-nav button").forEach(button => button.classList.toggle("active", button.dataset.mobile === view));
  if (view === "map") {
    $(".inspector").classList.add("hidden");
    requestAnimationFrame(renderMap);
  } else if (state.split.open) {
    requestAnimationFrame(() => setSplitPaneWidth(state.split.width));
  }
  renderStoryMaps();
  renderChapters();
}

function queueDocumentSave() {
  const document = activeDocument();
  if (!document) return;
  document.title = $("#chapterTitleInput").value.trim() || "未命名章节";
  document.content = editorToMarkdown();
  const pending = { document, title: document.title, content: document.content };
  state.pendingChapterSave = pending;
  $("#chapterWords").textContent = `${wordCount(document.content)} 字`;
  renderChapters();
  renderSplitPane();
  setSaveState("保存中", "saving");
  clearTimeout(state.chapterTimer);
  state.chapterTimer = setTimeout(() => {
    state.chapterTimer = null;
    if (state.pendingChapterSave === pending) state.pendingChapterSave = null;
    const request = persistPendingChapterSnapshot(pending);
    state.chapterSavePromise = request;
    request.finally(() => {
      if (state.chapterSavePromise === request) state.chapterSavePromise = null;
    }).catch(() => {});
  }, 650);
}

async function persistChapterSnapshot(pending) {
  try {
    const updated = await api(`/api/chapters/${pending.document.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: pending.title, content: pending.content }),
    });
    Object.assign(pending.document, updated);
    setSaveState("已同步", "saved");
    return updated;
  } catch (error) {
    setSaveState("保存失败", "error");
    toast(error.message);
    throw error;
  }
}

function persistPendingChapterSnapshot(pending) {
  return persistChapterSnapshot(pending).catch(error => {
    if (!state.pendingChapterSave) state.pendingChapterSave = pending;
    throw error;
  });
}

async function flushPendingProjectEdits() {
  if (state.chapterTimer !== null) {
    clearTimeout(state.chapterTimer);
    state.chapterTimer = null;
  }
  if (state.chapterSavePromise) await state.chapterSavePromise;
  const pendingChapter = state.pendingChapterSave;
  if (pendingChapter) {
    state.pendingChapterSave = null;
    const request = persistPendingChapterSnapshot(pendingChapter);
    state.chapterSavePromise = request;
    request.finally(() => {
      if (state.chapterSavePromise === request) state.chapterSavePromise = null;
    }).catch(() => {});
    await request;
  }

  if (state.nodeTimer !== null) {
    clearTimeout(state.nodeTimer);
    state.nodeTimer = null;
  }
  if (state.nodeSavePromise) {
    const saved = await state.nodeSavePromise;
    if (!saved) throw new Error("节点修改尚未保存，请检查服务器连接后重试");
  }
  const pendingNode = state.pendingNodeSave;
  if (pendingNode) {
    const request = api(`/api/nodes/${pendingNode.node.id}`, {
      method: "PATCH",
      body: JSON.stringify(pendingNode.payload),
    }).then(updated => {
      Object.assign(pendingNode.node, updated);
      setSaveState("已同步", "saved");
      return updated;
    });
    state.nodeSavePromise = request;
    request.finally(() => {
      if (state.nodeSavePromise === request) state.nodeSavePromise = null;
    }).catch(() => {});
    let saved;
    try {
      saved = await request;
    } catch (error) {
      if (!state.pendingNodeSave) state.pendingNodeSave = pendingNode;
      throw error;
    }
    if (!saved) {
      if (!state.pendingNodeSave) state.pendingNodeSave = pendingNode;
      throw new Error("节点修改尚未保存，请检查服务器连接后重试");
    }
  }
}

async function addChapterToVolume(volumeId) {
  if (!requireProject("新建章节")) return;
  const volume = state.project.volumes.find(item => item.id === volumeId);
  if (!volume) return;
  try {
    const volumeChapters = state.project.chapters.filter(chapter => chapter.volume_id === volumeId);
    const existingNumbers = volumeChapters
      .map(chapter => chapter.title.match(/^第\s*(\d+)\s*章(?:\s|$)/)?.[1])
      .filter(Boolean)
      .map(Number);
    const chapterNumber = Math.max(volumeChapters.length, ...existingNumbers, 0) + 1;
    const chapter = await api(`/api/projects/${state.project.id}/chapters`, {
      method: "POST",
      body: JSON.stringify({ title: `第 ${chapterNumber} 章`, volume_id: volumeId }),
    });
    state.project.chapters.push(chapter);
    sortProjectChapters();
    state.chapterBulkMode = false;
    state.selectedChapterIds.clear();
    renderChapterOptions();
    selectChapter(chapter.id);
    $("#chapterTitleInput").select();
    toast(`已在“${volume.title}”中新建章节`);
  } catch (error) { toast(error.message); }
}

function showImportExportOverview() {
  $("#importExportDialogTitle").textContent = "导入 / 导出";
  $("#importExportOverview").hidden = false;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#storyMapExportPanel").hidden = true;
  $("#storyMapImportPanel").hidden = true;
  $("#projectPackageImportPanel").hidden = true;
  $("#backToImportExportButton").hidden = true;
}

function safeProjectFilename(title) {
  let stem = String(title || "墨图作品").trim()
    .replace(/\.(?:leeproj|json)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  if (!stem) stem = "墨图作品";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = `_${stem}`;
  return `${stem}.leeproj`;
}

async function exportCurrentProjectPackage() {
  if (!requireProject("导出完整作品")) return;
  const button = $("#exportProjectPackageButton");
  button.disabled = true;
  const originalText = button.querySelector("strong").textContent;
  button.querySelector("strong").textContent = "正在导出…";
  try {
    await flushPendingProjectEdits();
    const blob = await apiBlob(`/api/projects/${state.project.id}/package`);
    downloadBlob(safeProjectFilename(state.project.title), blob);
    toast(`已导出完整作品“${state.project.title}”`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.querySelector("strong").textContent = originalText;
  }
}

function openProjectPackageImportPanel() {
  if (!requireProject("导入完整作品")) return;
  state.pendingProjectPackage = null;
  state.projectPackageImportBusy = false;
  $("#projectPackageFile").value = "";
  $("#projectPackageTitle").value = "";
  renderProjectPackageImportSummary();
  $("#importExportDialogTitle").textContent = "导入完整作品";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#storyMapExportPanel").hidden = true;
  $("#storyMapImportPanel").hidden = true;
  $("#projectPackageImportPanel").hidden = false;
  $("#backToImportExportButton").hidden = false;
}

async function selectProjectPackageFile(file) {
  state.pendingProjectPackage = null;
  if (!file) { renderProjectPackageImportSummary(); return; }
  if (!/\.(?:leeproj|json)$/i.test(file.name)) {
    renderProjectPackageImportSummary("请选择 .leeproj 或 JSON 完整项目包");
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    renderProjectPackageImportSummary("完整项目包不能超过 100 MB");
    return;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, "");
    const data = JSON.parse(text);
    if (!data || data.format !== "lee-project" || data.version !== 1 || typeof data.title !== "string"
      || typeof data.description !== "string" || !Array.isArray(data.volumes) || !Array.isArray(data.chapters)
      || !Array.isArray(data.maps) || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !Array.isArray(data.notes)) {
      throw new Error("文件格式不受支持，请选择墨图导出的完整作品包");
    }
    if (!data.volumes.length || !data.maps.length || data.volumes.length > 500 || data.chapters.length > 10000
      || data.maps.length > 100 || data.nodes.length > 50000 || data.edges.length > 100000 || data.notes.length > 100000) {
      throw new Error("项目包内容数量超出限制，请检查文件内容");
    }
    if (data.volumes.some(item => !item || typeof item.key !== "string" || typeof item.title !== "string")
      || data.chapters.some(item => !item || typeof item.key !== "string" || typeof item.title !== "string" || typeof item.content !== "string")
      || data.maps.some(item => !item || typeof item.key !== "string" || typeof item.title !== "string")
      || data.nodes.some(item => !item || typeof item.key !== "string" || typeof item.map_key !== "string" || typeof item.label !== "string")
      || data.edges.some(item => !item || typeof item.key !== "string" || typeof item.map_key !== "string" || typeof item.source_key !== "string" || typeof item.target_key !== "string")
      || data.notes.some(item => !item || typeof item.key !== "string" || typeof item.node_key !== "string" || typeof item.content !== "string")) {
      throw new Error("项目包中的卷、章节或地图数据结构不完整");
    }
    if (data.chapters.some(item => item.content.length > 50_000_000)
      || data.chapters.reduce((sum, item) => sum + item.content.length, 0)
        + data.notes.reduce((sum, item) => sum + item.content.length, 0) > 100_000_000) {
      throw new Error("项目包正文或便签总量超出支持范围");
    }
    state.pendingProjectPackage = data;
    $("#projectPackageTitle").value = data.title.slice(0, 120);
    renderProjectPackageImportSummary();
  } catch (error) {
    renderProjectPackageImportSummary(error instanceof SyntaxError ? "无法解析该文件：请检查 JSON 格式" : error.message);
  }
}

function renderProjectPackageImportSummary(error = "") {
  const summary = $("#projectPackageImportSummary");
  const button = $("#confirmProjectPackageImportButton");
  const data = state.pendingProjectPackage;
  const title = $("#projectPackageTitle").value.trim();
  const validationError = error || (data && !title ? "请输入导入后作品名称" : "");
  summary.classList.toggle("error", Boolean(validationError));
  summary.textContent = validationError || (data
    ? `已读取“${data.title}” · ${data.volumes.length} 卷 · ${data.chapters.length} 章 · ${data.maps.length} 张地图 · ${data.nodes.length} 个节点 · ${data.edges.length} 条连线 · ${data.notes.length} 条便签`
    : "尚未选择项目包");
  button.disabled = !data || Boolean(validationError) || state.projectPackageImportBusy;
  button.textContent = state.projectPackageImportBusy ? "正在导入新作品…" : "导入为新作品";
}

async function importProjectPackage() {
  const data = state.pendingProjectPackage;
  if (!data) return;
  const title = $("#projectPackageTitle").value.trim();
  if (!title) { toast("请输入导入后作品名称"); return; }
  state.projectPackageImportBusy = true;
  renderProjectPackageImportSummary();
  try {
    await flushPendingProjectEdits();
    const project = await api("/api/projects/import", {
      method: "POST",
      body: JSON.stringify({ ...data, title }),
    });
    state.projects = [project, ...state.projects.filter(item => item.id !== project.id)];
    $("#importExportDialog").close();
    await loadProject(project.id);
    toast(`已将“${project.title}”导入为新作品`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.projectPackageImportBusy = false;
    renderProjectPackageImportSummary();
  }
}

function safeStoryMapFilename(title) {
  let stem = String(title || "故事地图").trim()
    .replace(/\.(?:leemap|json)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  if (!stem) stem = "故事地图";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = `_${stem}`;
  return `${stem}.leemap`;
}

function openStoryMapPackageExportPanel() {
  if (!requireProject("导出故事地图")) return;
  state.selectedStoryMapExportIds = new Set();
  state.storyMapExportBusy = false;
  renderStoryMapPackageExportList();
  $("#importExportDialogTitle").textContent = "导出故事地图";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#storyMapExportPanel").hidden = false;
  $("#storyMapImportPanel").hidden = true;
  $("#backToImportExportButton").hidden = false;
}

function renderStoryMapPackageExportList() {
  const maps = state.project?.maps || [];
  const selectedIds = state.selectedStoryMapExportIds;
  const list = $("#storyMapExportList");
  const selectAll = $("#selectAllStoryMapExports");
  const summary = $("#storyMapExportSummary");
  const button = $("#confirmStoryMapExportButton");
  list.replaceChildren(...maps.map(storyMap => {
    const label = document.createElement("label");
    label.className = "chapter-txt-export-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.exportStoryMap = storyMap.id;
    checkbox.checked = selectedIds.has(storyMap.id);
    const title = document.createElement("span");
    title.textContent = storyMap.title;
    label.append(checkbox, title);
    return label;
  }));
  const selectedCount = selectedIds.size;
  summary.textContent = `已选择 ${selectedCount} 张地图`;
  selectAll.checked = maps.length > 0 && selectedCount === maps.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < maps.length;
  button.disabled = selectedCount === 0 || state.storyMapExportBusy;
  button.textContent = selectedCount > 1 ? `打包导出所选地图（${selectedCount}）` : "导出所选地图";
}

async function exportSelectedStoryMapPackages() {
  if (!requireProject("导出故事地图")) return;
  const selected = (state.project?.maps || []).filter(storyMap => state.selectedStoryMapExportIds.has(storyMap.id));
  if (!selected.length) { toast("请先选择要导出的故事地图"); return; }
  const button = $("#confirmStoryMapExportButton");
  state.storyMapExportBusy = true;
  renderStoryMapPackageExportList();
  button.textContent = selected.length > 1 ? "正在打包 ZIP…" : "正在导出地图…";
  try {
    if (selected.length === 1) {
      const storyMap = selected[0];
      const data = await api(`/api/projects/${state.project.id}/maps/${storyMap.id}/package`);
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json;charset=utf-8" });
      downloadBlob(safeStoryMapFilename(storyMap.title), blob);
      toast(`已导出地图“${storyMap.title}”`);
    } else {
      const blob = await apiBlob(`/api/projects/${state.project.id}/maps/export-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map_ids: selected.map(storyMap => storyMap.id) }),
      });
      const filename = safeStoryMapFilename(`${state.project.title}-所选地图`).replace(/\.leemap$/i, ".zip");
      downloadBlob(filename, blob);
      toast(`已打包导出 ${selected.length} 张故事地图`);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    state.storyMapExportBusy = false;
    renderStoryMapPackageExportList();
  }
}

function openStoryMapPackageImportPanel() {
  if (!requireProject("导入故事地图")) return;
  state.pendingStoryMapPackage = null;
  state.storyMapImportBusy = false;
  $("#storyMapImportMode").value = "new";
  $("#storyMapPackageFile").value = "";
  $("#storyMapImportTitle").value = "";
  renderStoryMapReplacementTargets();
  updateStoryMapImportMode();
  renderStoryMapImportSummary();
  $("#importExportDialogTitle").textContent = "导入故事地图";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#storyMapExportPanel").hidden = true;
  $("#storyMapImportPanel").hidden = false;
  $("#backToImportExportButton").hidden = false;
}

function renderStoryMapReplacementTargets() {
  const select = $("#storyMapReplacementTarget");
  const maps = state.project?.maps || [];
  select.replaceChildren(...maps.map(storyMap => {
    const option = document.createElement("option");
    option.value = storyMap.id;
    option.textContent = storyMap.title;
    return option;
  }));
  if (maps.some(storyMap => storyMap.id === state.activeMapId)) {
    select.value = state.activeMapId;
  }
}

function updateStoryMapImportMode() {
  const replacing = $("#storyMapImportMode").value === "replace";
  $("#storyMapReplacementTargetField").hidden = !replacing;
  $("#storyMapImportTitleField").hidden = replacing;
  $("#confirmStoryMapImportButton").textContent = state.storyMapImportBusy
    ? "正在处理地图…"
    : replacing ? "替换所选地图" : "导入为新地图";
  renderStoryMapImportSummary();
}

async function selectStoryMapPackageFile(file) {
  state.pendingStoryMapPackage = null;
  if (!file) { renderStoryMapImportSummary(); return; }
  if (!/\.(?:leemap|json)$/i.test(file.name)) {
    renderStoryMapImportSummary("请选择 .leemap 或 JSON 地图数据包");
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    renderStoryMapImportSummary("故事地图数据包不能超过 15 MB");
    return;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, "");
    const data = JSON.parse(text);
    if (!data || data.format !== "lee-story-map" || data.version !== 1 || typeof data.title !== "string"
      || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error("文件格式不受支持，请选择墨图导出的 .leemap 地图包");
    }
    if (data.nodes.some(node => !node || typeof node !== "object" || typeof node.key !== "string" || typeof node.label !== "string")
      || data.edges.some(edge => !edge || typeof edge !== "object" || typeof edge.source_key !== "string" || typeof edge.target_key !== "string")) {
      throw new Error("地图数据包的节点或连线结构不完整");
    }
    if (data.nodes.length > 5000 || data.edges.length > 10000) {
      throw new Error("地图数据包内容过多，节点上限 5000，连线上限 10000");
    }
    state.pendingStoryMapPackage = data;
    $("#storyMapImportTitle").value = data.title.slice(0, 120);
    renderStoryMapImportSummary();
  } catch (error) {
    renderStoryMapImportSummary(error instanceof SyntaxError ? "无法解析该文件：请检查 JSON 格式" : error.message);
  }
}

function renderStoryMapImportSummary(error = "") {
  const summary = $("#storyMapImportSummary");
  const button = $("#confirmStoryMapImportButton");
  const data = state.pendingStoryMapPackage;
  const title = $("#storyMapImportTitle").value.trim();
  const replacing = $("#storyMapImportMode").value === "replace";
  const targetMapId = $("#storyMapReplacementTarget").value;
  const invalidKeys = data && new Set(data.nodes.map(node => node.key)).size !== data.nodes.length;
  const linksValid = data && data.edges.every(edge => data.nodes.some(node => node.key === edge.source_key)
    && data.nodes.some(node => node.key === edge.target_key));
  const validationError = error || (data && !replacing && !title ? "请输入导入后地图名称" : "")
    || (invalidKeys ? "地图数据包中包含重复节点标识" : "")
    || (data && replacing && !targetMapId ? "请选择要替换的现有地图" : "")
    || (data && !linksValid ? "地图数据包中的连线引用了不存在的节点" : "");
  summary.classList.toggle("error", Boolean(validationError));
  summary.textContent = validationError || (data
    ? `已读取“${data.title}” · ${data.nodes.length} 个节点 · ${data.edges.length} 条连线 · ${data.nodes.reduce((total, node) => total + (node.notes?.length || 0), 0)} 条便签`
    : "尚未选择数据包");
  button.disabled = !data || Boolean(validationError) || state.storyMapImportBusy;
  button.textContent = state.storyMapImportBusy
    ? replacing ? "正在替换地图…" : "正在创建地图…"
    : replacing ? "替换所选地图" : "导入为新地图";
}

async function importStoryMapPackage() {
  const data = state.pendingStoryMapPackage;
  if (!state.project || !data) return;
  const replacing = $("#storyMapImportMode").value === "replace";
  const targetMapId = $("#storyMapReplacementTarget").value;
  const title = $("#storyMapImportTitle").value.trim();
  if (replacing && !targetMapId) { toast("请选择要替换的现有地图"); return; }
  if (!replacing && !title) { toast("请输入导入后地图名称"); return; }
  const targetMap = state.project.maps.find(storyMap => storyMap.id === targetMapId);
  if (replacing && !window.confirm(`替换“${targetMap?.title || "所选地图"}”会移除该地图当前的节点、连线和便签，并导入数据包内容。此操作无法撤销，是否继续？`)) return;
  const button = $("#confirmStoryMapImportButton");
  state.storyMapImportBusy = true;
  renderStoryMapImportSummary();
  button.textContent = replacing ? "正在替换地图…" : "正在创建地图…";
  try {
    const endpoint = replacing
      ? `/api/projects/${state.project.id}/maps/${targetMapId}/import`
      : `/api/projects/${state.project.id}/maps/import`;
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ ...data, title: replacing ? data.title : title }),
    });
    if (replacing) {
      const oldNodeIds = new Set(state.project.nodes.filter(node => node.map_id === result.map.id).map(node => node.id));
      state.project.nodes = state.project.nodes.filter(node => node.map_id !== result.map.id).concat(result.nodes);
      state.project.edges = state.project.edges.filter(edge => edge.map_id !== result.map.id).concat(result.edges);
      state.project.notes = state.project.notes.filter(note => !oldNodeIds.has(note.node_id)).concat(result.notes);
      const mapIndex = state.project.maps.findIndex(storyMap => storyMap.id === result.map.id);
      if (mapIndex >= 0) state.project.maps[mapIndex] = result.map;
      state.selectedNodeId = null;
      state.selectedNodeIds.clear();
      state.selectedEdgeId = null;
      state.selectedEdgeIds.clear();
    } else {
      state.project.maps.push(result.map);
      state.project.nodes.push(...result.nodes);
      state.project.edges.push(...result.edges);
      state.project.notes.push(...result.notes);
    }
    $("#importExportDialog").close();
    selectStoryMap(result.map.id);
    const unresolved = result.chapter_links.unresolved;
    const action = replacing ? "地图已替换" : "地图已导入";
    toast(unresolved
      ? `${action}；${unresolved} 个章节关联在当前作品中未匹配`
      : replacing ? `已替换地图“${result.map.title}”` : `已导入地图“${result.map.title}”`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.storyMapImportBusy = false;
    renderStoryMapImportSummary();
  }
}

function openImportExportDialog() {
  if (!requireProject("导入/导出")) return;
  showImportExportOverview();
  $("#importExportDialog").showModal();
}

function openTxtImportPanel() {
  if (!requireProject("导入 TXT 章节")) return;
  const volumeSelect = $("#importTxtVolume");
  volumeSelect.innerHTML = state.project.volumes
    .map(volume => `<option value="${volume.id}">${escapeHtml(volume.title)}</option>`)
    .join("");
  const activeVolumeId = state.project.chapters.find(chapter => chapter.id === state.activeChapterId)?.volume_id;
  volumeSelect.value = state.project.volumes.some(volume => volume.id === activeVolumeId)
    ? activeVolumeId
    : state.project.volumes[0]?.id || "";
  $("#importTxtMode").value = "new";
  renderTxtTargetChapterOptions(state.activeChapterId);
  $("#importTxtTargetChapterField").hidden = true;
  $("#importTxtModeHint").textContent = "文件内容将导入为目标卷中的新章节，按现有章节顺序自动编号。";
  $("#importTxtFiles").value = "";
  $("#importTxtEncoding").value = "utf-8";
  state.pendingTxtFiles = [];
  renderTxtImportFileSummary();
  $("#importExportDialogTitle").textContent = "导入 TXT 章节";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = false;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#backToImportExportButton").hidden = false;
}

function openMarkdownImportPanel() {
  if (!requireProject("导入 Markdown 章节")) return;
  const activeVolumeId = state.project.chapters.find(chapter => chapter.id === state.activeChapterId)?.volume_id;
  $("#markdownImportVolume").innerHTML = state.project.volumes
    .map(volume => `<option value="${volume.id}">${escapeHtml(volume.title)}</option>`)
    .join("");
  $("#markdownImportVolume").value = state.project.volumes.some(volume => volume.id === activeVolumeId)
    ? activeVolumeId
    : state.project.volumes[0]?.id || "";
  $("#markdownImportMode").value = "new";
  $("#markdownImportFiles").value = "";
  state.pendingMarkdownFiles = [];
  renderMarkdownImportSummary();
  $("#importExportDialogTitle").textContent = "导入 Markdown 章节";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = false;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#backToImportExportButton").hidden = false;
}

function openChapterMarkdownExportPanel() {
  if (!requireProject("导出 Markdown")) return;
  state.selectedMarkdownExportChapterIds = new Set();
  $("#chapterMarkdownExportMode").value = "combined";
  renderChapterMarkdownExportList();
  $("#importExportDialogTitle").textContent = "导出章节 Markdown";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = false;
  $("#backToImportExportButton").hidden = false;
}

function parseMarkdownChapterFile(name, content, size = 0) {
  const normalized = String(content || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let title = String(name || "").replace(/\.(?:md|markdown)$/i, "").split(/[\\/]/).pop().trim() || "未命名章节";
  const headingIndex = lines.findIndex(line => line.trim());
  const heading = headingIndex >= 0 ? lines[headingIndex].match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/) : null;
  if (heading) {
    title = heading[1].trim().slice(0, 120) || title;
    lines.splice(headingIndex, 1);
    while (lines.length && !lines[0].trim()) lines.shift();
  }
  return { name, title: title.slice(0, 120), content: lines.join("\n"), size, targetChapterId: "" };
}

async function selectMarkdownImportFiles(fileList) {
  const files = [...(fileList || [])];
  state.pendingMarkdownFiles = [];
  state.pendingMarkdownIsZip = false;
  if (!files.length) { renderMarkdownImportSummary(); return; }
  const zipFiles = files.filter(file => file.name.toLowerCase().endsWith(".zip"));
  if (zipFiles.length && (zipFiles.length !== 1 || files.length !== 1)) {
    renderMarkdownImportSummary("ZIP 压缩包请单独选择，不能与 Markdown 文件混选");
    return;
  }
  if (files.some(file => !/\.(?:md|markdown|zip)$/i.test(file.name))) {
    renderMarkdownImportSummary("请选择 .md、.markdown 文件或一个 .zip 压缩包");
    return;
  }
  if (files.length > 50) {
    renderMarkdownImportSummary("一次最多导入 50 个 Markdown 文件");
    return;
  }
  if (zipFiles.length) {
    const file = zipFiles[0];
    if (file.size > 12 * 1024 * 1024) {
      renderMarkdownImportSummary("ZIP 文件不能超过 12 MB");
      return;
    }
    renderMarkdownImportSummary("正在读取 ZIP 中的 Markdown 文件…");
    try {
      const archive = await api(`/api/projects/${state.project.id}/chapters/parse-markdown-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: await file.arrayBuffer(),
      });
      state.pendingMarkdownIsZip = true;
      state.pendingMarkdownFiles = archive.files.map(item => parseMarkdownChapterFile(item.name, item.content, item.size));
      renderMarkdownImportSummary();
    } catch (error) {
      renderMarkdownImportSummary(error.message);
    }
    return;
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (files.some(file => file.size > 6 * 1024 * 1024)) {
    renderMarkdownImportSummary("单个 Markdown 文件不能超过 6 MB");
    return;
  }
  if (totalBytes > 12 * 1024 * 1024) {
    renderMarkdownImportSummary("本次 Markdown 文件总大小不能超过 12 MB");
    return;
  }
  try {
    const decoded = await Promise.all(files.map(async file => {
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch (_) {
        throw new Error(`“${file.name}”不是有效的 UTF-8 Markdown 文件`);
      }
      return parseMarkdownChapterFile(file.name, content, file.size);
    }));
    state.pendingMarkdownFiles = decoded.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" }));
    renderMarkdownImportSummary();
  } catch (error) {
    renderMarkdownImportSummary(error.message);
  }
}

function renderMarkdownImportSummary(error = "") {
  const fileList = $("#markdownImportFileList");
  const summary = $("#markdownImportSummary");
  const button = $("#confirmMarkdownImportButton");
  const files = state.pendingMarkdownFiles;
  const volumeId = $("#markdownImportVolume").value;
  const mode = $("#markdownImportMode").value;
  const allChapters = state.project?.chapters || [];
  const volumeChapters = mode === "replace"
    ? allChapters
    : allChapters.filter(chapter => chapter.volume_id === volumeId);
  $("#markdownImportVolumeField").hidden = mode === "replace";
  const usedTargets = new Set();
  const usedTitles = new Set(volumeChapters.map(chapter => chapter.title.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")));
  let validationError = error;
  if (!validationError && files.length > 50) validationError = "一次最多导入 50 个 Markdown 文件";
  if (!validationError && files.some(file => file.content.length > 2_000_000)) validationError = "单个章节正文不能超过 200 万字符";
  if (!validationError && files.reduce((total, file) => total + file.content.length, 0) > 10_000_000) validationError = "Markdown 正文总量不能超过 1000 万字符";
  if (!validationError && mode === "replace" && files.length > volumeChapters.length) validationError = "当前作品中的现有章节不足以一一匹配，请改为新建章节";

  fileList.replaceChildren(...files.map((file, index) => {
    const item = document.createElement("li");
    item.className = "markdown-import-entry";
    const details = document.createElement("div");
    details.className = "markdown-import-entry-details";
    const name = document.createElement("span");
    name.textContent = file.name;
    const info = document.createElement("small");
    info.textContent = `章节标题：${file.title} · ${(file.size / 1024).toFixed(file.size >= 1024 * 1024 ? 0 : 1)} ${file.size >= 1024 * 1024 ? "MB" : "KB"}`;
    details.append(name, info);
    item.append(details);
    if (mode === "replace") {
      const target = document.createElement("select");
      target.dataset.markdownTarget = String(index);
      const targetOptions = volumeChapters.filter(chapter => !usedTargets.has(chapter.id) || chapter.id === file.targetChapterId);
      targetOptions.forEach(chapter => {
        const option = document.createElement("option");
        option.value = chapter.id;
        option.textContent = chapterOptionLabel(chapter);
        target.append(option);
      });
      let preferred = targetOptions.find(chapter => chapter.id === file.targetChapterId);
      if (!preferred) {
        const normalizedTitle = file.title.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
        preferred = targetOptions.find(chapter => chapter.title.normalize("NFKC").trim().toLocaleLowerCase("zh-CN") === normalizedTitle)
          || targetOptions.find(chapter => !usedTargets.has(chapter.id));
      }
      target.value = preferred?.id || "";
      file.targetChapterId = target.value;
      if (target.value) usedTargets.add(target.value);
      item.append(target);
    } else {
      const title = document.createElement("small");
      title.className = "markdown-import-chapter-title";
      title.textContent = `将新建：${file.title}${usedTitles.has(file.title.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")) ? "（与已有章节同名）" : ""}`;
      item.append(title);
    }
    return item;
  }));

  if (!validationError && mode === "replace" && files.some(file => !file.targetChapterId)) {
    validationError = "请为每个 Markdown 文件选择不同的目标章节";
  }
  if (!validationError && mode === "replace" && new Set(files.map(file => file.targetChapterId)).size !== files.length) {
    validationError = "每个文件必须对应不同的目标章节";
  }
  summary.classList.toggle("error", Boolean(validationError));
  const action = mode === "replace" ? "替换正文" : "新建章节";
  summary.textContent = validationError || (files.length
    ? `${state.pendingMarkdownIsZip ? "ZIP 中" : "已选"} ${files.length} 个 Markdown 文件 · ${(files.reduce((total, file) => total + file.size, 0) / 1024).toFixed(1)} KB · 将${action}`
    : "尚未选择文件");
  button.textContent = mode === "replace" ? "替换所选章节正文" : "导入为新章节";
  button.disabled = !files.length || Boolean(validationError) || state.markdownImportBusy || (mode === "new" && !volumeId);
}

async function importMarkdownFiles() {
  if (!state.project || !state.pendingMarkdownFiles.length) return;
  const files = state.pendingMarkdownFiles;
  const mode = $("#markdownImportMode").value;
  const volumeId = $("#markdownImportVolume").value;
  const volume = state.project.volumes.find(item => item.id === volumeId);
  if (mode === "new" && !volume) { toast("请选择要导入到的故事卷"); return; }
  if (mode === "replace" && !window.confirm(`将用 ${files.length} 个 Markdown 文件分别替换所选章节的全部正文，章节标题和故事地图关联会保留。是否继续？`)) return;
  const button = $("#confirmMarkdownImportButton");
  state.markdownImportBusy = true;
  renderMarkdownImportSummary();
  button.textContent = mode === "replace" ? "正在替换章节正文…" : "正在导入 Markdown…";
  try {
    const payloadFiles = files.map(file => ({
      title: file.title,
      content: file.content,
      ...(mode === "replace" ? { target_chapter_id: file.targetChapterId } : {}),
    }));
    if (mode === "replace" && files.some(file => file.targetChapterId === state.activeChapterId)) {
      clearTimeout(state.chapterTimer);
      state.chapterTimer = null;
    }
    const result = await api(`/api/projects/${state.project.id}/chapters/import-markdown`, {
      method: "POST",
      body: JSON.stringify({ volume_id: mode === "new" ? volumeId : null, mode, files: payloadFiles }),
    });
    if (mode === "replace") {
      result.chapters.forEach(updated => {
        const current = state.project.chapters.find(chapter => chapter.id === updated.id);
        if (current) Object.assign(current, updated);
        if (updated.id === state.activeChapterId) {
          state.editorHistories.set(updated.id, { entries: [chapterSnapshot(updated)], index: 0 });
        }
      });
      updateHistoryButtons();
    } else {
      state.project.chapters.push(...result.chapters);
      sortProjectChapters();
    }
    state.chapterBulkMode = false;
    state.selectedChapterIds.clear();
    $("#importExportDialog").close();
    renderChapters();
    renderChapterOptions();
    if (mode === "new") selectChapter(result.chapters[0].id);
    else if (result.chapters.some(chapter => chapter.id === state.activeChapterId)) renderEditor();
    renderSplitPane();
    toast(mode === "replace"
      ? `已用 ${result.chapters.length} 个 Markdown 文件替换章节正文`
      : `已将 ${result.chapters.length} 个 Markdown 文件导入“${volume.title}”`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.markdownImportBusy = false;
    renderMarkdownImportSummary();
  }
}

function openChapterTxtExportPanel() {
  if (!requireProject("导出章节")) return;
  state.selectedTxtExportChapterIds = new Set();
  $("#chapterTxtExportMode").value = "combined";
  renderChapterTxtExportList();
  $("#importExportDialogTitle").textContent = "导出章节 TXT";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = true;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = false;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#backToImportExportButton").hidden = false;
}

function renderChapterTxtExportList() {
  const list = $("#chapterTxtExportList");
  const selectAll = $("#selectAllTxtExportChapters");
  const summary = $("#chapterTxtExportSummary");
  const exportButton = $("#confirmChapterTxtExportButton");
  const exportModeField = $("#chapterTxtExportModeField");
  const selectedIds = state.selectedTxtExportChapterIds;
  const chapters = state.project?.chapters || [];
  const volumes = state.project?.volumes || [];
  list.replaceChildren(...volumes.map(volume => {
    const volumeChapters = chapters.filter(chapter => chapter.volume_id === volume.id);
    if (!volumeChapters.length) return null;
    const group = document.createElement("section");
    group.className = "chapter-txt-export-volume";
    const heading = document.createElement("label");
    heading.className = "chapter-txt-export-volume-heading";
    const volumeCheckbox = document.createElement("input");
    volumeCheckbox.type = "checkbox";
    volumeCheckbox.dataset.exportVolume = volume.id;
    const volumeSelectedCount = volumeChapters.filter(chapter => selectedIds.has(chapter.id)).length;
    volumeCheckbox.checked = volumeSelectedCount === volumeChapters.length;
    volumeCheckbox.indeterminate = volumeSelectedCount > 0 && volumeSelectedCount < volumeChapters.length;
    const volumeName = document.createElement("strong");
    volumeName.textContent = volume.title;
    const volumeCount = document.createElement("small");
    volumeCount.textContent = `${volumeChapters.length} 章`;
    heading.append(volumeCheckbox, volumeName, volumeCount);
    const chapterList = document.createElement("div");
    chapterList.className = "chapter-txt-export-items";
    volumeChapters.forEach(chapter => {
      const label = document.createElement("label");
      label.className = "chapter-txt-export-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.exportChapter = chapter.id;
      checkbox.checked = selectedIds.has(chapter.id);
      const title = document.createElement("span");
      title.textContent = chapterOptionLabel(chapter);
      label.append(checkbox, title);
      chapterList.append(label);
    });
    group.append(heading, chapterList);
    return group;
  }).filter(Boolean));
  const selectedCount = selectedIds.size;
  summary.textContent = `已选择 ${selectedCount} 个章节`;
  selectAll.checked = chapters.length > 0 && selectedCount === chapters.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < chapters.length;
  exportButton.disabled = selectedCount === 0;
  exportModeField.hidden = selectedCount < 2;
  exportButton.textContent = selectedCount > 1 ? `导出所选章节（${selectedCount}）` : "导出所选章节";
}

function renderChapterMarkdownExportList() {
  const list = $("#chapterMarkdownExportList");
  const selectAll = $("#selectAllMarkdownExportChapters");
  const summary = $("#chapterMarkdownExportSummary");
  const exportButton = $("#confirmChapterMarkdownExportButton");
  const modeField = $("#chapterMarkdownExportModeField");
  const selectedIds = state.selectedMarkdownExportChapterIds;
  const chapters = state.project?.chapters || [];
  const volumes = state.project?.volumes || [];
  list.replaceChildren(...volumes.map(volume => {
    const volumeChapters = chapters.filter(chapter => chapter.volume_id === volume.id);
    if (!volumeChapters.length) return null;
    const group = document.createElement("section");
    group.className = "chapter-txt-export-volume";
    const heading = document.createElement("label");
    heading.className = "chapter-txt-export-volume-heading";
    const volumeCheckbox = document.createElement("input");
    volumeCheckbox.type = "checkbox";
    volumeCheckbox.dataset.markdownExportVolume = volume.id;
    const selectedCount = volumeChapters.filter(chapter => selectedIds.has(chapter.id)).length;
    volumeCheckbox.checked = selectedCount === volumeChapters.length;
    volumeCheckbox.indeterminate = selectedCount > 0 && selectedCount < volumeChapters.length;
    const volumeName = document.createElement("strong");
    volumeName.textContent = volume.title;
    const volumeCount = document.createElement("small");
    volumeCount.textContent = `${volumeChapters.length} 章`;
    heading.append(volumeCheckbox, volumeName, volumeCount);
    const chapterList = document.createElement("div");
    chapterList.className = "chapter-txt-export-items";
    volumeChapters.forEach(chapter => {
      const label = document.createElement("label");
      label.className = "chapter-txt-export-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.markdownExportChapter = chapter.id;
      checkbox.checked = selectedIds.has(chapter.id);
      const title = document.createElement("span");
      title.textContent = chapterOptionLabel(chapter);
      label.append(checkbox, title);
      chapterList.append(label);
    });
    group.append(heading, chapterList);
    return group;
  }).filter(Boolean));
  const selectedCount = selectedIds.size;
  summary.textContent = `已选择 ${selectedCount} 个章节`;
  selectAll.checked = chapters.length > 0 && selectedCount === chapters.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < chapters.length;
  exportButton.disabled = selectedCount === 0;
  modeField.hidden = selectedCount < 2;
  exportButton.textContent = selectedCount > 1 ? `导出所选章节（${selectedCount}）` : "导出所选章节";
}

function markdownDocumentForChapter(chapter) {
  const body = String(chapter.content || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  return body ? `# ${chapter.title}\n\n${body}\n` : `# ${chapter.title}\n`;
}

async function exportSelectedChapterMarkdown() {
  if (!requireProject("导出 Markdown")) return;
  const selected = state.project.chapters
    .filter(chapter => state.selectedMarkdownExportChapterIds.has(chapter.id))
    .map(chapterSnapshotForExport);
  if (!selected.length) { toast("请先选择要导出的章节"); return; }
  if (selected.length === 1) {
    downloadMarkdownFile(selected[0].title, markdownDocumentForChapter(selected[0]));
    toast(`已导出章节“${selected[0].title}” Markdown`);
    return;
  }
  const mode = $("#chapterMarkdownExportMode").value;
  if (mode === "separate") {
    const volumeTitles = new Map(state.project.volumes.map(volume => [volume.id, volume.title]));
    const usedFilenames = new Set();
    selected.forEach(chapter => {
      const base = safeMarkdownFilename(`${volumeTitles.get(chapter.volume_id) || state.project.title}-${chapter.title}`);
      const extension = ".md";
      let filename = base;
      let suffix = 2;
      while (usedFilenames.has(filename.toLocaleLowerCase("zh-CN"))) {
        filename = `${base.slice(0, -extension.length)} (${suffix})${extension}`;
        suffix += 1;
      }
      usedFilenames.add(filename.toLocaleLowerCase("zh-CN"));
      downloadBlob(filename, new Blob([markdownDocumentForChapter(chapter)], { type: "text/markdown;charset=utf-8" }));
    });
    toast(`已分别导出 ${selected.length} 个 Markdown 文件`);
    return;
  }
  if (mode === "zip") {
    const button = $("#confirmChapterMarkdownExportButton");
    button.disabled = true;
    button.textContent = "正在打包 ZIP…";
    try {
      const volumeTitles = new Map(state.project.volumes.map(volume => [volume.id, volume.title]));
      const blob = await apiBlob(`/api/projects/${state.project.id}/chapters/export-markdown-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: selected.map(chapter => ({
          title: chapter.title,
          volume_title: volumeTitles.get(chapter.volume_id) || "未分类",
          content: chapter.content || "",
        })) }),
      });
      downloadBlob(safeTxtFilename(`${state.project.title}-选中章节`).replace(/\.txt$/i, ".zip"), blob);
      toast(`已打包导出 ${selected.length} 个章节 Markdown`);
    } catch (error) {
      toast(error.message);
    } finally {
      renderChapterMarkdownExportList();
    }
    return;
  }
  const volumeTitles = new Map(state.project.volumes.map(volume => [volume.id, volume.title]));
  const volumeOrder = new Map(state.project.volumes.map((volume, index) => [volume.id, index]));
  selected.sort((left, right) => {
    const volumeDifference = (volumeOrder.get(left.volume_id) ?? Number.MAX_SAFE_INTEGER)
      - (volumeOrder.get(right.volume_id) ?? Number.MAX_SAFE_INTEGER);
    return volumeDifference || left.position - right.position;
  });
  const blocks = [];
  state.project.volumes.forEach(volume => {
    const chapters = selected.filter(chapter => chapter.volume_id === volume.id);
    if (!chapters.length) return;
    blocks.push(`# ${volume.title}\n\n${chapters.map(chapter =>
      `## ${chapter.title}\n\n${String(chapter.content || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim()}`.trimEnd(),
    ).join("\n\n")}`);
  });
  downloadMarkdownFile(`${state.project.title}-选中章节`, `${blocks.join("\n\n")}\n`);
  toast(`已合并导出 ${selected.length} 个章节 Markdown`);
}

function exportSelectedChapterTxt() {
  if (!requireProject("导出章节")) return;
  const selected = state.project.chapters
    .filter(chapter => state.selectedTxtExportChapterIds.has(chapter.id))
    .map(chapterSnapshotForExport);
  if (!selected.length) { toast("请先选择要导出的章节"); return; }
  if (selected.length === 1) {
    const chapter = selected[0];
    const content = markdownToReadableText(chapter.content);
    downloadTxtFile(chapter.title, `${chapter.title}\n\n${content}`);
    toast(`已导出章节“${chapter.title}”`);
    return;
  }
  if ($("#chapterTxtExportMode").value === "separate") {
    const volumeTitles = new Map(state.project.volumes.map(volume => [volume.id, volume.title]));
    selected.forEach(chapter => {
      const filename = `${volumeTitles.get(chapter.volume_id) || state.project.title}-${chapter.title}`;
      const content = markdownToReadableText(chapter.content);
      downloadTxtFile(filename, `${chapter.title}\n\n${content}`);
    });
    toast(`已分别导出 ${selected.length} 个章节 TXT`);
    return;
  }
  const volumeOrder = new Map(state.project.volumes.map((volume, index) => [volume.id, index]));
  selected.sort((left, right) => {
    const volumeDifference = (volumeOrder.get(left.volume_id) ?? Number.MAX_SAFE_INTEGER)
      - (volumeOrder.get(right.volume_id) ?? Number.MAX_SAFE_INTEGER);
    return volumeDifference || left.position - right.position;
  });
  const blocks = [];
  state.project.volumes.forEach(volume => {
    const volumeChapters = selected.filter(chapter => chapter.volume_id === volume.id);
    if (!volumeChapters.length) return;
    blocks.push(`【卷】${volume.title}\n\n${volumeChapters.map(chapter =>
      `【章节】${chapter.title}\n\n${markdownToReadableText(chapter.content)}`.trimEnd(),
    ).join("\n\n")}`);
  });
  downloadTxtFile(`${state.project.title}-选中章节`, `【作品】${state.project.title}\n\n${blocks.join("\n\n")}`);
  toast(`已合并导出 ${selected.length} 个章节`);
}

function renderTxtTargetChapterOptions(preferredChapterId = $("#importTxtTargetChapter")?.value) {
  const volumeId = $("#importTxtVolume").value;
  const chapters = state.project?.chapters.filter(chapter => chapter.volume_id === volumeId) || [];
  const select = $("#importTxtTargetChapter");
  select.innerHTML = chapters.map(chapter => `<option value="${chapter.id}">${escapeHtml(chapterOptionLabel(chapter))}</option>`).join("");
  if (chapters.some(chapter => chapter.id === preferredChapterId)) select.value = preferredChapterId;
  else {
    const activeChapter = chapters.find(chapter => chapter.id === state.activeChapterId);
    select.value = activeChapter?.id || chapters[0]?.id || "";
  }
  if (chapters.length && select.value) return;
  $("#importTxtMode").value = "new";
  $("#importTxtTargetChapterField").hidden = true;
  $("#importTxtModeHint").textContent = "目标故事卷中还没有章节，请选择“新建章节”导入内容。";
}

function renderTxtImportFileSummary() {
  const files = state.pendingTxtFiles;
  const fileList = $("#importTxtFileList");
  const summary = $("#importTxtSummary");
  const importButton = $("#confirmImportTxtButton");
  const mode = $("#importTxtMode").value;
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  let error = "";
  if (files.length > 50) error = "一次最多导入 50 个 TXT 文件";
  else if (files.some(file => file.size > 5 * 1024 * 1024)) error = "单个文件不能超过 5 MB";
  else if (totalBytes > 10 * 1024 * 1024) error = "本次文件总大小不能超过 10 MB，请分批导入";
  else if (files.some(file => !file.name.toLowerCase().endsWith(".txt"))) error = "请选择 .txt 文本文件";
  else if (mode === "existing" && files.length > 0 && files.length !== 1) error = "替换已有章节时，请只选择一个 TXT 文件";

  fileList.replaceChildren(...files.map(file => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const size = document.createElement("span");
    name.textContent = file.name;
    size.textContent = `${(file.size / 1024).toFixed(file.size >= 1024 * 1024 ? 0 : 1)} ${file.size >= 1024 * 1024 ? "MB" : "KB"}`;
    item.append(name, size);
    return item;
  }));
  summary.classList.toggle("error", Boolean(error));
  const volumeId = $("#importTxtVolume").value;
  const targetChapter = state.project?.chapters.find(chapter => chapter.id === $("#importTxtTargetChapter").value);
  const firstNumber = volumeId && state.project ? nextChapterNumberInVolume(volumeId) : 1;
  const targetDescription = mode === "existing"
    ? `将替换“${targetChapter?.title || "所选章节"}”的正文`
    : files.length === 1
      ? `将新建第 ${firstNumber} 章`
      : `将新建第 ${firstNumber}–${firstNumber + files.length - 1} 章`;
  summary.textContent = error || (files.length
    ? `已选 ${files.length} 个文件 · ${(totalBytes / 1024).toFixed(1)} KB · ${targetDescription}`
    : "尚未选择文件");
  importButton.textContent = mode === "existing" ? "替换章节正文" : "导入为新章节";
  importButton.disabled = !files.length || Boolean(error) || !$("#importTxtVolume").value
    || (mode === "existing" && !$("#importTxtTargetChapter").value);
}

function nextChapterNumberInVolume(volumeId) {
  const volumeChapters = state.project.chapters.filter(chapter => chapter.volume_id === volumeId);
  const existingNumbers = volumeChapters
    .map(chapter => chapter.title.match(/^第\s*(\d+)\s*章(?:\s|$)/)?.[1])
    .filter(Boolean)
    .map(Number);
  return Math.max(volumeChapters.length, ...existingNumbers, 0) + 1;
}

async function importTxtFiles() {
  if (!state.project) return;
  const files = [...state.pendingTxtFiles].sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" }));
  if (!files.length) return;
  const mode = $("#importTxtMode").value;
  const volumeId = $("#importTxtVolume").value;
  const volume = state.project.volumes.find(item => item.id === volumeId);
  if (!volume) { toast("请选择要导入到的故事卷"); return; }
  const targetChapter = mode === "existing"
    ? state.project.chapters.find(chapter => chapter.id === $("#importTxtTargetChapter").value && chapter.volume_id === volumeId)
    : null;
  if (mode === "existing" && !targetChapter) { toast("请选择要替换正文的章节"); return; }
  if (mode === "existing" && files.length !== 1) { toast("替换已有章节时，请只选择一个 TXT 文件"); return; }
  const button = $("#confirmImportTxtButton");
  const encoding = $("#importTxtEncoding").value;
  button.disabled = true;
  button.textContent = "正在读取并导入…";
  try {
    const decodedFiles = await Promise.all(files.map(async file => {
      const buffer = await file.arrayBuffer();
      let content;
      try {
        content = new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
      } catch (_) {
        throw new Error(`“${file.name}”无法按 ${encoding.toUpperCase()} 解码，请检查文件编码后重试`);
      }
      return { file, content: plainTextToMarkdown(stripRepeatedExportTitle(content, file.name)) };
    }));
    if (decodedFiles.some(item => item.content.length > 2_000_000)) {
      throw new Error("单个 TXT 正文不能超过 200 万字符，请拆分文件后重试");
    }
    if (decodedFiles.reduce((total, item) => total + item.content.length, 0) > 10_000_000) {
      throw new Error("本次 TXT 正文总量不能超过 1000 万字符，请分批导入");
    }
    if (mode === "existing") {
      if (!window.confirm(`将用“${files[0].name}”替换“${targetChapter.title}”的全部正文？章节标题和故事地图关联会保留。`)) return;
      if (targetChapter.id === state.activeChapterId) {
        clearTimeout(state.chapterTimer);
        state.chapterTimer = null;
      }
      const updated = await api(`/api/chapters/${targetChapter.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: decodedFiles[0].content }),
      });
      Object.assign(targetChapter, updated);
      if (targetChapter.id === state.activeChapterId) {
        state.editorHistories.set(targetChapter.id, { entries: [chapterSnapshot(targetChapter)], index: 0 });
        updateHistoryButtons();
      }
      state.chapterBulkMode = false;
      state.selectedChapterIds.clear();
      $("#importExportDialog").close();
      renderChapters();
      renderChapterOptions();
      selectChapter(targetChapter.id);
      toast(`已将 TXT 内容写入“${targetChapter.title}”（原章节标题已保留）`);
      return;
    }
    const firstNumber = nextChapterNumberInVolume(volumeId);
    const importedFiles = decodedFiles.map((item, index) => ({
      title: `第 ${firstNumber + index} 章`,
      content: item.content,
    }));
    const result = await api(`/api/projects/${state.project.id}/chapters/import-text`, {
      method: "POST",
      body: JSON.stringify({ volume_id: volumeId, files: importedFiles }),
    });
    state.project.chapters.push(...result.chapters);
    sortProjectChapters();
    state.chapterBulkMode = false;
    state.selectedChapterIds.clear();
    $("#importExportDialog").close();
    renderChapterOptions();
    selectChapter(result.chapters[0].id);
    toast(`已将 ${result.chapters.length} 个 TXT 文件导入“${volume.title}”`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = $("#importTxtMode").value === "existing" ? "替换章节正文" : "导入为新章节";
    renderTxtImportFileSummary();
  }
}

function openFullBookImportPanel() {
  if (!requireProject("导入全书")) return;
  const activeVolumeId = state.project.chapters.find(chapter => chapter.id === state.activeChapterId)?.volume_id;
  $("#fullBookImportVolume").innerHTML = state.project.volumes
    .map(volume => `<option value="${volume.id}">${escapeHtml(volume.title)}</option>`)
    .join("");
  $("#fullBookImportVolume").value = state.project.volumes.some(volume => volume.id === activeVolumeId)
    ? activeVolumeId
    : state.project.volumes[0]?.id || "";
  $("#fullBookImportFile").value = "";
  $("#fullBookImportEncoding").value = "utf-8";
  state.pendingFullBookFile = null;
  state.pendingFullBookChapters = [];
  renderFullBookImportPreview();
  $("#importExportDialogTitle").textContent = "导入全书 TXT";
  $("#importExportOverview").hidden = true;
  $("#txtImportPanel").hidden = true;
  $("#fullBookImportPanel").hidden = false;
  $("#markdownImportPanel").hidden = true;
  $("#chapterTxtExportPanel").hidden = true;
  $("#chapterMarkdownExportPanel").hidden = true;
  $("#backToImportExportButton").hidden = false;
}

function renderFullBookImportPreview(error = "") {
  const preview = $("#fullBookChapterPreview");
  const summary = $("#fullBookImportSummary");
  const button = $("#confirmFullBookImportButton");
  preview.replaceChildren(...state.pendingFullBookChapters.slice(0, 20).map((chapter, index) => {
    const item = document.createElement("li");
    const title = document.createElement("span");
    const count = document.createElement("span");
    title.textContent = chapter.title || `第 ${index + 1} 章`;
    count.textContent = `${wordCount(chapter.content)} 字`;
    item.append(title, count);
    return item;
  }));
  if (state.pendingFullBookChapters.length > 20) {
    const more = document.createElement("li");
    more.textContent = `还有 ${state.pendingFullBookChapters.length - 20} 个章节…`;
    preview.append(more);
  }
  summary.classList.toggle("error", Boolean(error));
  summary.textContent = error || (state.pendingFullBookFile
    ? state.pendingFullBookChapters.length
      ? `识别到 ${state.pendingFullBookChapters.length} 个章节 · ${(state.pendingFullBookFile.size / 1024).toFixed(1)} KB`
      : "文件中没有识别到正文或章节内容"
    : "尚未选择文件");
  button.disabled = !state.pendingFullBookChapters.length || Boolean(error) || !$("#fullBookImportVolume").value;
}

async function selectFullBookImportFile(file) {
  state.pendingFullBookFile = file || null;
  state.pendingFullBookChapters = [];
  if (!file) { renderFullBookImportPreview(); return; }
  if (!file.name.toLowerCase().endsWith(".txt")) {
    renderFullBookImportPreview("请选择 .txt 文本文件");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    renderFullBookImportPreview("全书 TXT 文件不能超过 10 MB");
    return;
  }
  try {
    const content = new TextDecoder($("#fullBookImportEncoding").value, { fatal: true })
      .decode(await file.arrayBuffer())
      .replace(/^\uFEFF/, "");
    const bookTitle = file.name.replace(/\.txt$/i, "").replace(/-全书$/i, "");
    state.pendingFullBookChapters = parseFullBookTxt(content, {
      bookTitle,
      volumeNames: state.project.volumes.map(volume => volume.title),
    }).map((chapter, index) => ({
      title: chapter.title || `第 ${index + 1} 章`,
      content: plainTextToMarkdown(chapter.content),
    }));
    if (state.pendingFullBookChapters.length > 50) {
      state.pendingFullBookChapters = [];
      renderFullBookImportPreview("一次最多导入 50 个章节，请拆分文件后重试");
      return;
    }
    if (state.pendingFullBookChapters.some(chapter => chapter.content.length > 2_000_000)) {
      state.pendingFullBookChapters = [];
      renderFullBookImportPreview("单个章节正文不能超过 200 万字符，请拆分文件后重试");
      return;
    }
    if (state.pendingFullBookChapters.reduce((total, chapter) => total + chapter.content.length, 0) > 10_000_000) {
      state.pendingFullBookChapters = [];
      renderFullBookImportPreview("全书正文总量不能超过 1000 万字符");
      return;
    }
    if (!content.trim()) renderFullBookImportPreview("文件内容为空");
    else renderFullBookImportPreview();
  } catch (_) {
    renderFullBookImportPreview(`无法按 ${$("#fullBookImportEncoding").value.toUpperCase()} 解码，请检查文件编码后重试`);
  }
}

async function importFullBookTxt() {
  if (!state.project || !state.pendingFullBookChapters.length) return;
  const volumeId = $("#fullBookImportVolume").value;
  const volume = state.project.volumes.find(item => item.id === volumeId);
  if (!volume) { toast("请选择要导入到的故事卷"); return; }
  if (state.pendingFullBookChapters.length > 50) { toast("一次最多导入 50 个章节"); return; }
  const button = $("#confirmFullBookImportButton");
  button.disabled = true;
  button.textContent = "正在导入全书…";
  try {
    const firstNumber = nextChapterNumberInVolume(volumeId);
    const files = state.pendingFullBookChapters.map((chapter, index) => ({
      title: chapter.title || `第 ${firstNumber + index} 章`,
      content: chapter.content,
    }));
    const result = await api(`/api/projects/${state.project.id}/chapters/import-text`, {
      method: "POST",
      body: JSON.stringify({ volume_id: volumeId, files }),
    });
    state.project.chapters.push(...result.chapters);
    sortProjectChapters();
    state.chapterBulkMode = false;
    state.selectedChapterIds.clear();
    $("#importExportDialog").close();
    renderChapterOptions();
    selectChapter(result.chapters[0].id);
    toast(`已将全书拆分并导入 ${result.chapters.length} 个章节到“${volume.title}”`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = "导入为新章节";
    renderFullBookImportPreview();
  }
}

function chapterSnapshotForExport(chapter) {
  if (chapter.id !== state.activeChapterId) return chapter;
  return {
    ...chapter,
    title: $("#chapterTitleInput").value.trim() || "未命名章节",
    content: editorToMarkdown(),
  };
}

function exportBookTxt() {
  if (!requireProject("导出全书")) return;
  const chapterSnapshots = state.project.chapters.map(chapterSnapshotForExport);
  if (!chapterSnapshots.length) { toast("当前作品没有可导出的章节"); return; }
  const volumeOrder = new Map(state.project.volumes.map((volume, index) => [volume.id, index]));
  chapterSnapshots.sort((left, right) => {
    const volumeDifference = (volumeOrder.get(left.volume_id) ?? Number.MAX_SAFE_INTEGER)
      - (volumeOrder.get(right.volume_id) ?? Number.MAX_SAFE_INTEGER);
    return volumeDifference || left.position - right.position;
  });
  const volumeBlocks = state.project.volumes.map(volume => {
    const chapters = chapterSnapshots.filter(chapter => chapter.volume_id === volume.id);
    if (!chapters.length) return "";
    const chapterBlocks = chapters.map(chapter => {
      const content = markdownToReadableText(chapter.content);
      return `【章节】${chapter.title}\n\n${content}`.trimEnd();
    });
    return `【卷】${volume.title}\n\n${chapterBlocks.join("\n\n")}`;
  }).filter(Boolean);
  const unassignedChapters = chapterSnapshots.filter(chapter => !volumeOrder.has(chapter.volume_id));
  if (unassignedChapters.length) {
    volumeBlocks.push(`【卷】未分类\n\n${unassignedChapters.map(chapter => `【章节】${chapter.title}\n\n${markdownToReadableText(chapter.content)}`.trimEnd()).join("\n\n")}`);
  }
  downloadTxtFile(`${state.project.title}-全书`, `【作品】${state.project.title}\n\n${volumeBlocks.join("\n\n")}`);
  toast(`已导出全书，共 ${chapterSnapshots.length} 个章节`);
}

function openNewVolumeDialog() {
  if (!requireProject("新建故事卷")) return;
  $("#newVolumeTitle").value = `第 ${state.project.volumes.length + 1} 卷`;
  $("#newVolumeDialog").showModal();
  requestAnimationFrame(() => {
    $("#newVolumeTitle").focus();
    $("#newVolumeTitle").select();
  });
}

async function saveNewVolume() {
  const title = $("#newVolumeTitle").value.trim();
  if (!title) { toast("故事卷名称不能为空"); $("#newVolumeTitle").focus(); return; }
  const button = $("#saveNewVolumeButton");
  button.disabled = true;
  try {
    const volume = await api(`/api/projects/${state.project.id}/volumes`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    state.project.volumes.push(volume);
    $("#newVolumeDialog").close();
    renderChapters();
    toast(`“${volume.title}”已创建`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function openDeleteVolumeDialog(volumeId) {
  const volume = state.project?.volumes.find(item => item.id === volumeId);
  if (!volume) return;
  if (state.project.volumes.length <= 1) { toast("作品至少需要保留一个故事卷"); return; }
  const chapters = state.project.chapters.filter(chapter => chapter.volume_id === volumeId);
  const target = state.project.volumes.find(item => item.id !== volumeId);
  state.pendingVolumeDeleteId = volumeId;
  $("#deleteVolumeSummary").textContent = `将删除“${volume.title}”。`;
  $("#deleteVolumeDetails").textContent = chapters.length
    ? `其中 ${chapters.length} 个章节将移动到“${target.title}”，章节正文和故事地图链接会保留。`
    : "这个故事卷没有章节。";
  $("#deleteVolumeDialog").showModal();
}

async function deletePendingVolume() {
  const volumeId = state.pendingVolumeDeleteId;
  if (!volumeId) return;
  const button = $("#confirmDeleteVolumeButton");
  button.disabled = true;
  try {
    const result = await api(`/api/volumes/${volumeId}`, { method: "DELETE" });
    state.project.volumes = state.project.volumes.filter(volume => volume.id !== volumeId);
    state.collapsedVolumeIds.delete(volumeId);
    localStorage.setItem(`motu.collapsedVolumes.${state.project.id}`, JSON.stringify([...state.collapsedVolumeIds]));
    state.project.chapters.forEach(chapter => {
      if (chapter.volume_id === volumeId) chapter.volume_id = result.target_volume_id;
    });
    sortProjectChapters();
    state.pendingVolumeDeleteId = null;
    $("#deleteVolumeDialog").close();
    renderChapters();
    renderChapterOptions();
    renderSplitPane();
    renderEditor();
    toast(result.moved_chapters
      ? `故事卷已删除，${result.moved_chapters} 个章节已移动到其他卷`
      : "故事卷已删除");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function openChapterRenameDialog(chapterId) {
  const chapter = state.project?.chapters.find(item => item.id === chapterId);
  if (!chapter || !requireProject("修改章节标题")) return;
  state.editingChapterId = chapter.id;
  $("#renameChapterInput").value = chapter.title;
  $("#renameChapterDialog").showModal();
  requestAnimationFrame(() => {
    $("#renameChapterInput").focus();
    $("#renameChapterInput").select();
  });
}

async function saveChapterRename() {
  const chapter = state.project?.chapters.find(item => item.id === state.editingChapterId);
  if (!chapter) return;
  const trimmedTitle = $("#renameChapterInput").value.trim();
  if (!trimmedTitle) { toast("章节标题不能为空"); $("#renameChapterInput").focus(); return; }
  if ([...trimmedTitle].length > 120) { toast("章节标题不能超过 120 个字符"); $("#renameChapterInput").focus(); return; }
  if (trimmedTitle === chapter.title) { $("#renameChapterDialog").close(); return; }
  const button = $("#saveChapterRenameButton");
  button.disabled = true;
  try {
    const updated = await api(`/api/chapters/${chapter.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: trimmedTitle }),
    });
    Object.assign(chapter, updated);
    if (chapter.id === state.activeChapterId) {
      clearTimeout(state.chapterTimer);
      $("#chapterTitleInput").value = chapter.title;
    }
    renderChapters();
    renderChapterOptions();
    renderSplitPane();
    renderMap();
    $("#renameChapterDialog").close();
    toast("章节标题已更新");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function rememberActiveMapView() {
  if (!state.activeMapId || !state.canvasInitialized) return;
  state.mapViewStates.set(state.activeMapId, {
    camera: { ...state.camera },
    anchor: state.canvasAnchor ? { ...state.canvasAnchor } : null,
    bounds: state.canvasBounds ? { ...state.canvasBounds } : null,
    initialized: state.canvasInitialized,
  });
}

function restoreMapView(mapId) {
  const saved = state.mapViewStates.get(mapId);
  state.camera = saved?.camera ? { ...saved.camera } : { x: 0, y: 0 };
  state.canvasAnchor = saved?.anchor ? { ...saved.anchor } : null;
  state.canvasBounds = saved?.bounds ? { ...saved.bounds } : null;
  state.canvasInitialized = Boolean(saved?.initialized);
}

function selectStoryMap(mapId, { openView = true } = {}) {
  if (!state.project?.maps.some(storyMap => storyMap.id === mapId)) return;
  if (state.activeMapId !== mapId) {
    rememberActiveMapView();
    state.activeMapId = mapId;
    localStorage.setItem(`motu.activeMapId.${state.project.id}`, mapId);
    restoreMapView(mapId);
    state.selectedNodeId = null; state.selectedNodeIds.clear();
    state.selectedEdgeId = null; state.selectedEdgeIds.clear();
    state.connectSourceId = null;
    $("#connectButton").classList.remove("active");
    $("#connectButton").innerHTML = '<span class="arrow-preview">→</span>箭头';
    $("#canvasContextMenu").hidden = true;
    $(".inspector").classList.add("hidden");
  }
  renderStoryMaps();
  renderMap();
  if (openView) switchView("map");
}

function openStoryMapDialog(mapId = null) {
  if (!requireProject(mapId ? "编辑故事地图" : "新建故事地图")) return;
  state.editingMapId = mapId;
  const storyMap = state.project?.maps.find(item => item.id === mapId);
  $("#storyMapDialogTitle").textContent = storyMap ? "重命名故事地图" : "新建故事地图";
  $("#saveStoryMapButton").textContent = storyMap ? "保存名称" : "创建地图";
  $("#storyMapNameInput").value = storyMap?.title || `故事地图 ${(state.project.maps || []).length + 1}`;
  $("#storyMapDialog").showModal();
  requestAnimationFrame(() => $("#storyMapNameInput").select());
}

async function saveStoryMap() {
  const title = $("#storyMapNameInput").value.trim();
  if (!title) { $("#storyMapNameInput").focus(); return; }
  const button = $("#saveStoryMapButton");
  button.disabled = true;
  try {
    if (state.editingMapId) {
      const updated = await api(`/api/maps/${state.editingMapId}`, { method: "PATCH", body: JSON.stringify({ title }) });
      Object.assign(state.project.maps.find(item => item.id === updated.id), updated);
      renderStoryMaps();
      toast("故事地图已重命名");
    } else {
      const created = await api(`/api/projects/${state.project.id}/maps`, { method: "POST", body: JSON.stringify({ title }) });
      state.project.maps.push(created);
      $("#storyMapDialog").close();
      selectStoryMap(created.id);
      toast("新故事地图已创建");
      return;
    }
    $("#storyMapDialog").close();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function openStoryMapDeleteDialog(mapId) {
  const storyMap = state.project?.maps.find(item => item.id === mapId);
  if (!storyMap) return;
  if (state.project.maps.length <= 1) { toast("作品至少需要保留一张故事地图"); return; }
  const nodes = state.project.nodes.filter(node => node.map_id === mapId);
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = state.project.edges.filter(edge => edge.map_id === mapId);
  const notes = state.project.notes.filter(note => nodeIds.has(note.node_id));
  state.pendingMapDeleteId = mapId;
  $("#storyMapDeleteSummary").textContent = `将删除“${storyMap.title}”。`;
  $("#storyMapDeleteDetails").textContent = `其中包含 ${nodes.length} 个节点、${edges.length} 条连接线和 ${notes.length} 条便签。`;
  $("#storyMapDeleteDialog").showModal();
}

async function deletePendingStoryMap() {
  const mapId = state.pendingMapDeleteId;
  if (!mapId) return;
  const button = $("#confirmStoryMapDeleteButton");
  button.disabled = true;
  try {
    await api(`/api/maps/${mapId}`, { method: "DELETE" });
    const deletedNodeIds = new Set(state.project.nodes.filter(node => node.map_id === mapId).map(node => node.id));
    state.project.maps = state.project.maps.filter(item => item.id !== mapId);
    state.project.nodes = state.project.nodes.filter(node => node.map_id !== mapId);
    state.project.edges = state.project.edges.filter(edge => edge.map_id !== mapId);
    state.project.notes = state.project.notes.filter(note => !deletedNodeIds.has(note.node_id));
    state.mapViewStates.delete(mapId);
    state.pendingMapDeleteId = null;
    $("#storyMapDeleteDialog").close();
    if (state.activeMapId === mapId) {
      state.activeMapId = state.project.maps[0].id;
      localStorage.setItem(`motu.activeMapId.${state.project.id}`, state.activeMapId);
      restoreMapView(state.activeMapId);
    }
    clearCanvasSelection();
    renderStoryMaps();
    renderLinkedNodes();
    toast("故事地图已删除，章节正文未受影响");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

async function addNode(type = "plot", shape = "rounded", position = null) {
  if (!requireProject("添加故事节点")) return;
  const viewport = $("#mapViewport");
  ensureCanvasState();
  const x = position?.x ?? viewport.clientWidth / 2 - state.camera.x - 84 + (Math.random() - .5) * 100;
  const y = position?.y ?? viewport.clientHeight / 2 - state.camera.y - 50 + (Math.random() - .5) * 80;
  try {
    const shapeNames = {
      rectangle: "新流程", rounded: "新节点", diamond: "新判断", circle: "新节点",
      ellipse: "开始 / 结束", parallelogram: "输入 / 输出", hexagon: "新准备",
      document: "新文档", cylinder: "新数据",
    };
    const node = await api(`/api/projects/${state.project.id}/nodes`, { method: "POST", body: JSON.stringify({ label: shapeNames[shape] || "新节点", node_type: type, shape, color: nodeTypeColors[type], x, y, note: "", chapter_id: null, map_id: state.activeMapId }) });
    state.project.nodes.push(node);
    state.selectedNodeId = node.id;
    state.selectedNodeIds = new Set([node.id]);
    state.selectedEdgeId = null;
    state.selectedEdgeIds.clear();
    expandCanvasBoundsForNodes();
    renderMap();
  } catch (error) { toast(error.message); }
}

function selectNodeForActions(nodeId) {
  state.selectedNodeId = nodeId;
  state.selectedNodeIds = new Set([nodeId]);
  state.selectedEdgeId = null;
  state.selectedEdgeIds.clear();
  renderMap();
}

function notesForSelectedNode() {
  return state.project?.notes.filter(note => note.node_id === state.selectedNodeId) || [];
}

function renderNoteDialog(noteId = state.editingNoteId) {
  const notes = notesForSelectedNode();
  state.editingNoteId = notes.some(note => note.id === noteId) ? noteId : null;
  $("#noteList").innerHTML = notes.map(note => `<button class="note-list-item ${note.id === state.editingNoteId ? "active" : ""}" type="button" data-dialog-note-id="${note.id}"><span>${escapeHtml(note.content.replace(/\s+/g, " "))}</span><small>${note.locked ? "已锁定" : "悬停显示"}</small></button>`).join("");
  const note = notes.find(item => item.id === state.editingNoteId);
  $("#editingNoteId").value = note?.id || "";
  $("#noteContent").value = note?.content || "";
  $("#noteLocked").checked = Boolean(note?.locked);
  $("#deleteNoteButton").hidden = !note;
}

function openNoteDialog(noteId = null) {
  if (!state.selectedNodeId) return;
  renderNoteDialog(noteId);
  if (!$("#noteDialog").open) $("#noteDialog").showModal();
  requestAnimationFrame(() => $("#noteContent").focus());
}

async function saveCurrentNote() {
  const node = state.project?.nodes.find(item => item.id === state.selectedNodeId);
  const content = $("#noteContent").value.trim();
  if (!node || !content) { toast("请先填写便签内容"); return; }
  const payload = { content, locked: $("#noteLocked").checked };
  try {
    if (state.editingNoteId) {
      const updated = await api(`/api/notes/${state.editingNoteId}`, { method: "PATCH", body: JSON.stringify(payload) });
      Object.assign(state.project.notes.find(note => note.id === updated.id), updated);
    } else {
      const created = await api(`/api/nodes/${node.id}/notes`, { method: "POST", body: JSON.stringify(payload) });
      state.project.notes.push(created);
      state.editingNoteId = created.id;
    }
    renderMap();
    renderNoteDialog(state.editingNoteId);
    toast("便签已保存");
  } catch (error) { toast(error.message); }
}

async function deleteCurrentNote() {
  if (!state.editingNoteId) return;
  try {
    await api(`/api/notes/${state.editingNoteId}`, { method: "DELETE" });
    state.project.notes = state.project.notes.filter(note => note.id !== state.editingNoteId);
    state.editingNoteId = null;
    renderMap();
    renderNoteDialog();
    toast("便签已删除");
  } catch (error) { toast(error.message); }
}

function openChapterLinkDialog() {
  const node = state.project?.nodes.find(item => item.id === state.selectedNodeId);
  if (!node) return;
  $("#chapterLinkList").innerHTML = state.project.volumes.map(volume => {
    const chapters = state.project.chapters.filter(chapter => chapter.volume_id === volume.id);
    if (!chapters.length) return "";
    const options = chapters.map(chapter => (
      `<button class="chapter-link-option ${chapter.id === node.chapter_id ? "active" : ""}" type="button" data-link-chapter-id="${chapter.id}"><b>${String(chapterNumberInVolume(chapter)).padStart(2, "0")}</b><span>${escapeHtml(chapter.title)}</span></button>`
    )).join("");
    return `<section class="chapter-link-volume"><div class="chapter-link-volume-heading"><span>${escapeHtml(volume.title)}</span><small>${chapters.length} 章</small></div><div class="chapter-link-volume-options">${options}</div></section>`;
  }).join("");
  $("#unlinkChapterButton").hidden = !node.chapter_id;
  if (!$("#chapterLinkDialog").open) $("#chapterLinkDialog").showModal();
}

function startChapterLinkMode() {
  if (!state.selectedNodeId) return;
  state.chapterBulkMode = false;
  state.selectedChapterIds.clear();
  renderChapters();
  state.linkTargetNodeId = state.selectedNodeId;
  $(".chapter-panel").classList.add("link-target-mode");
  setStoryMapPickerDisabled(true);
  toast("请从左侧作品目录选择要链接的章节");
}

function setStoryMapPickerDisabled(disabled) {
  const storyMapSection = $(".story-map-list-section");
  storyMapSection.inert = disabled;
  storyMapSection.setAttribute("aria-disabled", String(disabled));
}

function cancelChapterLinkMode(showToast = true) {
  if (!state.linkTargetNodeId) return;
  state.linkTargetNodeId = null;
  $(".chapter-panel").classList.remove("link-target-mode");
  setStoryMapPickerDisabled(false);
  if (showToast) toast("已取消选择章节");
}

async function setNodeChapterLink(chapterId) {
  const node = state.project?.nodes.find(item => item.id === state.selectedNodeId);
  if (!node) return;
  try {
    const updated = await api(`/api/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ chapter_id: chapterId }) });
    Object.assign(node, updated);
    cancelChapterLinkMode(false);
    renderMap();
    if ($("#chapterLinkDialog").open) $("#chapterLinkDialog").close();
    toast(chapterId ? "章节链接已建立；点击图形即可进入章节" : "章节链接已断开");
  } catch (error) { toast(error.message); }
}

function openInspector(nodeId) {
  const node = state.project?.nodes.find(item => item.id === nodeId);
  if (!node) return;
  state.selectedNodeId = nodeId;
  state.selectedNodeIds = new Set([nodeId]);
  state.selectedEdgeId = null;
  state.selectedEdgeIds.clear();
  $("#nodeLabel")?.remove();
  $("#nodeType").value = node.node_type;
  $("#nodeChapter").value = node.chapter_id || "";
  let labelInput = document.createElement("label");
  labelInput.id = "nodeLabel";
  labelInput.innerHTML = `节点标题<input id="nodeLabelInput" maxlength="120" value="${escapeHtml(node.label)}" />`;
  $("#nodeType").closest("label").before(labelInput);
  $("#nodeLabelInput").addEventListener("input", queueNodeSave);
  $$(".color-picker button").forEach(button => button.classList.toggle("active", button.dataset.color === node.color));
  $("#jumpChapterButton").disabled = !node.chapter_id;
  $("#jumpChapterButton").textContent = "打开链接章节";
  $("#inspector")?.classList.remove("hidden");
  $(".inspector").classList.remove("hidden");
  renderMap();
}

function queueNodeSave(event) {
  const node = state.project?.nodes.find(item => item.id === state.selectedNodeId);
  if (!node) return;
  if (event?.target?.id === "nodeLabelInput") node.label = event.target.value || "未命名节点";
  if (event?.target?.id === "nodeType") node.node_type = event.target.value;
  if (event?.target?.id === "nodeChapter") node.chapter_id = event.target.value || null;
  renderMap();
  $("#jumpChapterButton").disabled = !node.chapter_id;
  const payload = { label: node.label, node_type: node.node_type, chapter_id: node.chapter_id, color: node.color };
  const pending = { node, payload };
  state.pendingNodeSave = pending;
  clearTimeout(state.nodeTimer);
  state.nodeTimer = setTimeout(() => {
    state.nodeTimer = null;
    if (state.pendingNodeSave === pending) state.pendingNodeSave = null;
    const request = saveNode(node, payload).then(saved => {
      if (!saved && !state.pendingNodeSave) state.pendingNodeSave = pending;
      return saved;
    });
    state.nodeSavePromise = request;
    request.finally(() => {
      if (state.nodeSavePromise === request) state.nodeSavePromise = null;
    }).catch(() => {});
  }, 450);
}

async function saveNode(node, payload) {
  try {
    const updated = await api(`/api/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    Object.assign(node, updated); setSaveState("已同步", "saved");
    return true;
  } catch (error) { setSaveState("保存失败", "error"); toast(error.message); return false; }
}

function openNodeLinkedContent(node) {
  if (!node?.chapter_id) return;
  $(".inspector").classList.add("hidden");
  selectChapter(node.chapter_id);
}

function focusNodeOnMap(nodeId) {
  const node = state.project?.nodes.find(item => item.id === nodeId);
  if (!node) return;
  selectStoryMap(node.map_id, { openView: false });
  state.selectedNodeId = nodeId;
  state.selectedNodeIds = new Set([nodeId]);
  state.selectedEdgeId = null;
  state.selectedEdgeIds.clear();
  switchView("map");
  requestAnimationFrame(() => {
    const size = nodeWorldSize(node);
    centerCanvasOnWorldPoint(node.x + size.width / 2, node.y + size.height / 2);
    const element = document.querySelector(`.story-node[data-node-id="${nodeId}"]`);
    if (!element) return;
    element.classList.add("focus-pulse");
    setTimeout(() => element.classList.remove("focus-pulse"), 1200);
  });
}

function focusEdgeOnMap(edgeId) {
  const edge = state.project?.edges.find(item => item.id === edgeId);
  if (!edge) return;
  selectStoryMap(edge.map_id, { openView: false });
  state.selectedNodeId = null;
  state.selectedNodeIds.clear();
  state.selectedEdgeId = edgeId;
  state.selectedEdgeIds = new Set([edgeId]);
  switchView("map");
  requestAnimationFrame(() => {
    const source = state.project.nodes.find(node => node.id === edge.source_id);
    const target = state.project.nodes.find(node => node.id === edge.target_id);
    if (source && target) {
      const sourceSize = nodeWorldSize(source); const targetSize = nodeWorldSize(target);
      centerCanvasOnWorldPoint(
        (source.x + sourceSize.width / 2 + target.x + targetSize.width / 2) / 2,
        (source.y + sourceSize.height / 2 + target.y + targetSize.height / 2) / 2,
      );
    } else renderEdges();
  });
}

async function createEdgeBetween(sourceId, targetId, sourcePort = "right", targetPort = "left") {
  if (sourceId === targetId) { toast("请选择另一个图形"); return null; }
  try {
    const edge = await api(`/api/projects/${state.project.id}/edges`, {
      method: "POST",
      body: JSON.stringify({ source_id: sourceId, target_id: targetId, label: "", source_port: sourcePort, target_port: targetPort, line_style: "solid", color: "blue" }),
    });
    state.project.edges.push(edge);
    state.selectedEdgeId = edge.id;
    state.selectedEdgeIds = new Set([edge.id]);
    state.selectedNodeId = null;
    state.selectedNodeIds.clear();
    renderMap();
    toast("箭头已连接；点击或右键箭头可添加备注与章节");
    return edge;
  } catch (error) { toast(error.message); return null; }
}

function openEdgeDialog(edgeId) {
  const edge = state.project?.edges.find(item => item.id === edgeId);
  if (!edge) return;
  state.selectedEdgeId = edgeId;
  state.selectedEdgeIds = new Set([edgeId]);
  state.selectedNodeId = null;
  state.selectedNodeIds.clear();
  $("#edgeNote").value = edge.label || "";
  $("#edgeStyle").value = edge.line_style || "solid";
  $$("#edgeColorPicker [data-edge-color]").forEach(button => button.classList.toggle("active", button.dataset.edgeColor === (edge.color || "blue")));
  $("#edgeChapter").innerHTML = `<option value="">不链接章节</option>${state.project.chapters.map(chapter => `<option value="${chapter.id}">${escapeHtml(chapterOptionLabel(chapter))}</option>`).join("")}`;
  $("#edgeChapter").value = edge.chapter_id || "";
  $("#openEdgeChapterButton").disabled = !edge.chapter_id;
  renderMap();
  if (!$("#edgeDialog").open) $("#edgeDialog").showModal();
}

async function saveSelectedEdge() {
  const edge = state.project?.edges.find(item => item.id === state.selectedEdgeId);
  if (!edge) return;
  const color = $("#edgeColorPicker [data-edge-color].active")?.dataset.edgeColor || "blue";
  const payload = { label: $("#edgeNote").value.trim(), line_style: $("#edgeStyle").value, chapter_id: $("#edgeChapter").value || null, color };
  try {
    const updated = await api(`/api/edges/${edge.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    Object.assign(edge, updated);
    $("#edgeDialog").close();
    renderEdges();
    toast("箭头设置已保存");
  } catch (error) { toast(error.message); }
}

async function deleteSelectedEdge() {
  const edge = state.project?.edges.find(item => item.id === state.selectedEdgeId);
  if (!edge) return;
  try {
    await api(`/api/edges/${edge.id}`, { method: "DELETE" });
    state.project.edges = state.project.edges.filter(item => item.id !== edge.id);
    state.selectedEdgeId = null;
    state.selectedEdgeIds.delete(edge.id);
    if ($("#edgeDialog").open) $("#edgeDialog").close();
    renderEdges();
    toast("箭头已删除");
  } catch (error) { toast(error.message); }
}

function openSelectedEdgeChapter() {
  const edge = state.project?.edges.find(item => item.id === state.selectedEdgeId);
  if (edge?.chapter_id) { $("#edgeDialog").close(); selectChapter(edge.chapter_id); }
}

async function connectNode(targetId) {
  if (!state.connectSourceId) {
    state.connectSourceId = targetId;
    toast("已选择起点，再点一个节点完成连接");
    return;
  }
  if (state.connectSourceId === targetId) { toast("请选择另一个节点"); return; }
  const sourceId = state.connectSourceId;
  state.connectSourceId = null;
  $("#connectButton").classList.remove("active");
  $("#connectButton").innerHTML = '<span class="arrow-preview">→</span>箭头';
  const ports = suggestedPortsBetweenNodes(sourceId, targetId);
  await createEdgeBetween(sourceId, targetId, ports.sourcePort, ports.targetPort);
}

function clearConnectionTargets() {
  $$(".story-node.connection-target").forEach(element => element.classList.remove("connection-target"));
  $$(".node-port.snap-target").forEach(element => element.classList.remove("snap-target"));
}

function updateConnectionTarget(clientX, clientY, sourceId, viewport) {
  clearConnectionTargets();
  let nearestNode = null; let nearestDistance = Infinity;
  $$(".story-node").forEach(element => {
    if (element.dataset.nodeId === sourceId) return;
    const rect = element.getBoundingClientRect();
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) { nearestDistance = distance; nearestNode = element; }
  });
  if (!nearestNode || nearestDistance > 72) return null;
  nearestNode.classList.add("connection-target");
  let nearestPort = null; let portDistance = Infinity;
  nearestNode.querySelectorAll(".node-port").forEach(port => {
    const rect = port.getBoundingClientRect();
    const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    const distance = Math.hypot(x - clientX, y - clientY);
    if (distance < portDistance) { portDistance = distance; nearestPort = { element: port, x, y }; }
  });
  if (!nearestPort || portDistance > 46) return null;
  nearestPort.element.classList.add("snap-target");
  return {
    targetId: nearestNode.dataset.nodeId,
    targetPort: nearestPort.element.dataset.port,
    pointer: { x: nearestPort.x - viewport.left, y: nearestPort.y - viewport.top },
  };
}

function bindNodeInteractions() {
  const layer = $("#nodeLayer");
  layer.addEventListener("pointerdown", event => {
    if (state.panMode || state.spacePressed || event.button === 1) return;
    const port = event.target.closest(".node-port");
    if (port) {
      event.preventDefault();
      event.stopPropagation();
      const element = port.closest(".story-node");
      const viewport = $("#mapViewport").getBoundingClientRect();
      state.portDrag = {
        sourceId: element.dataset.nodeId,
        sourcePort: port.dataset.port,
        pointer: { x: event.clientX - viewport.left, y: event.clientY - viewport.top },
      };
      const movePort = moveEvent => {
        const snapTarget = updateConnectionTarget(moveEvent.clientX, moveEvent.clientY, state.portDrag.sourceId, viewport);
        state.portDrag.pointer = snapTarget?.pointer || { x: moveEvent.clientX - viewport.left, y: moveEvent.clientY - viewport.top };
        state.portDrag.targetPort = snapTarget?.targetPort || null;
        state.portDrag.snapTarget = snapTarget;
        renderEdges();
      };
      const finishPort = async upEvent => {
        window.removeEventListener("pointermove", movePort);
        window.removeEventListener("pointerup", finishPort);
        const targetPort = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest(".node-port");
        const drag = state.portDrag;
        state.portDrag = null;
        clearConnectionTargets();
        renderEdges();
        const targetId = targetPort?.closest(".story-node")?.dataset.nodeId || drag.snapTarget?.targetId;
        const targetPortName = targetPort?.dataset.port || drag.snapTarget?.targetPort;
        if (targetId && targetPortName) await createEdgeBetween(drag.sourceId, targetId, drag.sourcePort, targetPortName);
      };
      window.addEventListener("pointermove", movePort);
      window.addEventListener("pointerup", finishPort, { once: true });
      return;
    }
    const element = event.target.closest(".story-node");
    if (!element || event.button !== 0 || event.target.closest(".node-note-card, .node-menu-button") || $("#connectButton").classList.contains("active")) return;
    const node = state.project.nodes.find(item => item.id === element.dataset.nodeId);
    const selectedIds = state.selectedNodeIds.has(node.id)
      ? state.selectedNodeIds
      : new Set([node.id]);
    const activeNodes = new Map(activeMapNodes().map(item => [item.id, item]));
    const dragNodes = [...selectedIds]
      .map(id => activeNodes.get(id))
      .filter(Boolean)
      .map(dragNode => ({
        node: dragNode,
        element: layer.querySelector(`.story-node[data-node-id="${dragNode.id}"]`),
        originX: dragNode.x,
        originY: dragNode.y,
      }))
      .filter(item => item.element);
    const startX = event.clientX; const startY = event.clientY;
    let moved = false;
    element.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      const dx = moveEvent.clientX - startX; const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      dragNodes.forEach(item => {
        item.node.x = item.originX + dx;
        item.node.y = item.originY + dy;
        item.element.style.left = `${item.node.x}px`;
        item.element.style.top = `${item.node.y}px`;
      });
      renderEdges();
      expandCanvasBoundsForNodes(); renderMinimap();
    };
    const up = () => {
      element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", up);
      if (moved) {
        dragNodes.forEach(item => saveNode(item.node, { x: item.node.x, y: item.node.y }));
      }
      else if (node.chapter_id) openNodeLinkedContent(node);
      else selectNodeForActions(node.id);
    };
    element.addEventListener("pointermove", move); element.addEventListener("pointerup", up);
  });
  layer.addEventListener("click", event => {
    const element = event.target.closest(".story-node");
    if (!element) return;
    if (event.target.closest(".node-port")) return;
    if (event.target.closest(".node-menu-button")) {
      selectNodeForActions(element.dataset.nodeId);
      const buttonRect = event.target.closest(".node-menu-button").getBoundingClientRect();
      showCanvasContextMenu(buttonRect.right, buttonRect.bottom + 4);
      return;
    }
    const noteCard = event.target.closest(".node-note-card");
    if (noteCard) { state.selectedNodeId = element.dataset.nodeId; openNoteDialog(noteCard.dataset.noteId); return; }
    if ($("#connectButton").classList.contains("active")) connectNode(element.dataset.nodeId);
  });
}

function clearCanvasSelection() {
  state.selectedNodeId = null;
  state.selectedNodeIds.clear();
  state.selectedEdgeId = null;
  state.selectedEdgeIds.clear();
  $("#canvasContextMenu").hidden = true;
  renderMap();
}

function showCanvasContextMenu(clientX, clientY) {
  const viewport = $("#mapViewport").getBoundingClientRect();
  const menu = $("#canvasContextMenu");
  const hasNodes = state.selectedNodeIds.size > 0 || Boolean(state.selectedNodeId);
  const hasEdges = state.selectedEdgeIds.size > 0 || Boolean(state.selectedEdgeId);
  const singleNode = state.selectedNodeIds.size === 1 && !hasEdges;
  const selectedNode = singleNode ? state.project?.nodes.find(node => state.selectedNodeIds.has(node.id)) : null;
  menu.querySelector('[data-context-action="edit-edge"]').hidden = state.selectedEdgeIds.size !== 1;
  menu.querySelectorAll("[data-node-context]").forEach(item => { item.hidden = !singleNode; });
  menu.querySelector('[data-context-action="link"]').textContent = selectedNode?.chapter_id ? "更改章节" : "连接章节";
  menu.querySelector('[data-context-action="unlink-chapter"]').hidden = !selectedNode?.chapter_id;
  menu.querySelector('[data-context-action="color"]').setAttribute("aria-expanded", "false");
  $("#quickColorPalette").hidden = true;
  menu.querySelector('[data-context-action="delete"]').hidden = !hasNodes && !hasEdges;
  menu.hidden = false;
  menu.style.left = `${Math.min(viewport.width - menu.offsetWidth - 8, Math.max(8, clientX - viewport.left))}px`;
  menu.style.top = `${Math.min(viewport.height - menu.offsetHeight - 8, Math.max(8, clientY - viewport.top))}px`;
}

function edgePathIntersectsRegion(path, region, viewportBounds) {
  try {
    const length = path.getTotalLength();
    const step = Math.max(2, Math.min(4, length / 100));
    for (let distance = 0; distance <= length; distance += step) {
      const point = path.getPointAtLength(distance);
      const clientX = viewportBounds.left + point.x;
      const clientY = viewportBounds.top + point.y;
      if (clientX >= region.left && clientX <= region.right && clientY >= region.top && clientY <= region.bottom) return true;
    }
    const end = path.getPointAtLength(length);
    const endX = viewportBounds.left + end.x; const endY = viewportBounds.top + end.y;
    return endX >= region.left && endX <= region.right && endY >= region.top && endY <= region.bottom;
  } catch (_) { return false; }
}

function startCanvasPan(event) {
  event.preventDefault();
  const viewport = $("#mapViewport");
  const clearOnStationaryClick = event.button === 0 && !state.panMode && !state.spacePressed;
  const startX = event.clientX; const startY = event.clientY;
  const origin = { ...state.camera };
  let moved = false;
  viewport.classList.add("panning");
  const move = moveEvent => {
    const dx = moveEvent.clientX - startX; const dy = moveEvent.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    state.camera.x = origin.x + dx;
    state.camera.y = origin.y + dy;
    applyCamera();
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    viewport.classList.remove("panning");
    if (moved) {
      state.ignoreCanvasClick = true;
      setTimeout(() => { state.ignoreCanvasClick = false; }, 120);
    } else if (clearOnStationaryClick) clearCanvasSelection();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}

function setCanvasInteractionMode(locked, announce = false) {
  state.panMode = Boolean(locked);
  const viewport = $("#mapViewport");
  const button = $("#panModeButton");
  viewport.classList.toggle("pan-mode", state.panMode);
  button.classList.toggle("active", state.panMode);
  button.setAttribute("aria-pressed", String(state.panMode));
  button.textContent = state.panMode ? "退出锁定" : "锁定抓手";
  button.title = state.panMode ? "退出后可同时拖动画布和操作图形" : "锁定后可从图形上直接拖动画布";
  localStorage.setItem("motu.canvasPanMode", state.panMode ? "locked" : "mixed");
  if (announce) {
    const unlockedMessage = state.canvasControlScheme === "classic" ? "已退出锁定抓手，恢复经典框选操作" : "已开启导航与编辑并存模式";
    toast(state.panMode ? "已锁定抓手：拖动任意位置都将平移画布" : unlockedMessage);
  }
}

function setCanvasControlScheme(scheme, announce = false) {
  const nextScheme = scheme === "classic" ? "classic" : "mixed";
  const changed = state.canvasControlScheme !== nextScheme;
  state.canvasControlScheme = nextScheme;
  if (changed && state.panMode) setCanvasInteractionMode(false);
  const classic = state.canvasControlScheme === "classic";
  const viewport = $("#mapViewport");
  const button = $("#classicInteractionToggle");
  viewport.classList.toggle("classic-controls", classic);
  button.classList.toggle("active", classic);
  button.setAttribute("aria-checked", String(classic));
  button.title = classic ? "关闭后恢复空白处直接拖动画布" : "开启后恢复原来的空白拖动框选方式";
  $("#mapHelpText").innerHTML = classic
    ? "经典操作 · 空白处拖动框选 · 开启抓手或按住空格/中键拖动画布 · 图形可直接操作"
    : "空白处拖动画布 · 图形可直接操作 · <kbd>Shift + 鼠标左键</kbd> <strong>可选择区域</strong>";
  localStorage.setItem("motu.canvasControlScheme", state.canvasControlScheme);
  if (announce) toast(classic ? "已切换为经典操作方式" : "已切换为导航与编辑并存方式");
}

function bindMinimapInteractions() {
  const viewport = $("#mapViewport"); const panel = $("#minimapPanel"); const handle = $("#minimapHandle"); const svg = $("#minimapSvg");
  setCanvasInteractionMode(state.panMode);
  setCanvasControlScheme(state.canvasControlScheme);
  try {
    const saved = JSON.parse(localStorage.getItem("motu.minimapPosition") || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      panel.style.left = `${saved.left}px`; panel.style.top = `${saved.top}px`; panel.style.right = "auto"; panel.style.bottom = "auto";
    }
  } catch (_) {}
  handle.addEventListener("pointerdown", event => {
    event.preventDefault(); event.stopPropagation();
    const viewportRect = viewport.getBoundingClientRect(); const panelRect = panel.getBoundingClientRect();
    const startX = event.clientX; const startY = event.clientY;
    const originLeft = panelRect.left - viewportRect.left; const originTop = panelRect.top - viewportRect.top;
    const move = moveEvent => {
      const left = Math.max(8, Math.min(viewport.clientWidth - panel.offsetWidth - 8, originLeft + moveEvent.clientX - startX));
      const top = Math.max(8, Math.min(viewport.clientHeight - panel.offsetHeight - 8, originTop + moveEvent.clientY - startY));
      panel.style.left = `${left}px`; panel.style.top = `${top}px`; panel.style.right = "auto"; panel.style.bottom = "auto";
    };
    const finish = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish);
      localStorage.setItem("motu.minimapPosition", JSON.stringify({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }));
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  });
  svg.addEventListener("pointerdown", event => {
    event.preventDefault(); event.stopPropagation();
    const svgRect = svg.getBoundingClientRect(); const bounds = state.canvasBounds;
    if (!bounds || !svgRect.width || !svgRect.height) return;
    const scaleX = (bounds.maxX - bounds.minX) / svgRect.width; const scaleY = (bounds.maxY - bounds.minY) / svgRect.height;
    let originCamera = { ...state.camera }; const startX = event.clientX; const startY = event.clientY;
    if (!event.target.closest("#minimapViewportRect")) {
      const worldX = bounds.minX + (event.clientX - svgRect.left) * scaleX;
      const worldY = bounds.minY + (event.clientY - svgRect.top) * scaleY;
      state.camera.x = viewport.clientWidth / 2 - worldX; state.camera.y = viewport.clientHeight / 2 - worldY; applyCamera();
      originCamera = { ...state.camera };
    }
    const move = moveEvent => {
      state.camera.x = originCamera.x - (moveEvent.clientX - startX) * scaleX;
      state.camera.y = originCamera.y - (moveEvent.clientY - startY) * scaleY;
      applyCamera();
    };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  });
  $("#centerCanvasButton").addEventListener("click", event => { event.stopPropagation(); centerCanvasOnAnchor(); });
  $("#panModeButton").addEventListener("click", event => {
    event.stopPropagation();
    setCanvasInteractionMode(!state.panMode, true);
  });
  $("#classicInteractionToggle").addEventListener("click", event => {
    event.stopPropagation();
    setCanvasControlScheme(state.canvasControlScheme === "classic" ? "mixed" : "classic", true);
  });
  viewport.addEventListener("wheel", event => {
    if (event.target.closest(".minimap-panel")) return;
    event.preventDefault(); panCanvasBy(-event.deltaX, -event.deltaY);
  }, { passive: false });
  document.addEventListener("keydown", event => {
    if (event.code !== "Space" || event.target.matches("input, textarea, select, button")) return;
    event.preventDefault(); state.spacePressed = true; viewport.classList.add("space-pan");
  });
  document.addEventListener("keyup", event => {
    if (event.code === "Space") { state.spacePressed = false; viewport.classList.remove("space-pan"); }
  });
  window.addEventListener("blur", () => { state.spacePressed = false; viewport.classList.remove("space-pan", "panning"); });
}

function bindCanvasSelection() {
  const viewport = $("#mapViewport");
  viewport.addEventListener("pointerdown", event => {
    if (event.target.closest(".minimap-panel, .canvas-context-menu")) return;
    if (state.panMode || state.spacePressed || event.button === 1) { startCanvasPan(event); return; }
    if (event.button !== 0) return;
    const interactiveTarget = event.target.closest("button, .story-node, .node-quick-actions, .canvas-context-menu, .map-empty, .minimap-panel, [data-edge-id]");
    if (interactiveTarget) return;
    const shouldRegionSelect = state.canvasControlScheme === "classic" || event.shiftKey;
    if (!shouldRegionSelect) { startCanvasPan(event); return; }
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const bounds = viewport.getBoundingClientRect();
    const start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, clientX: event.clientX, clientY: event.clientY };
    state.selectionDrag = { start, current: start };
    const rectElement = $("#selectionRect");
    rectElement.hidden = false;
    viewport.classList.add("selecting-region");
    const draw = current => {
      const left = Math.min(start.x, current.x); const top = Math.min(start.y, current.y);
      rectElement.style.left = `${left}px`; rectElement.style.top = `${top}px`;
      rectElement.style.width = `${Math.abs(current.x - start.x)}px`; rectElement.style.height = `${Math.abs(current.y - start.y)}px`;
    };
    draw(start);
    const move = moveEvent => {
      moveEvent.preventDefault();
      const current = { x: moveEvent.clientX - bounds.left, y: moveEvent.clientY - bounds.top, clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      state.selectionDrag.current = current;
      draw(current);
    };
    const finish = upEvent => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      rectElement.hidden = true;
      viewport.classList.remove("selecting-region");
      const current = state.selectionDrag?.current || start;
      state.selectionDrag = null;
      const moved = Math.abs(current.x - start.x) + Math.abs(current.y - start.y) > 8;
      state.ignoreCanvasClick = moved;
      if (moved) setTimeout(() => { state.ignoreCanvasClick = false; }, 120);
      if (!moved) return;
      const region = {
        left: Math.min(start.clientX, current.clientX), right: Math.max(start.clientX, current.clientX),
        top: Math.min(start.clientY, current.clientY), bottom: Math.max(start.clientY, current.clientY),
      };
      const ids = $$(".story-node").filter(element => {
        const box = element.getBoundingClientRect();
        return box.right >= region.left && box.left <= region.right && box.bottom >= region.top && box.top <= region.bottom;
      }).map(element => element.dataset.nodeId);
      const edgeIds = $$("#edgeLayer .edge-line[data-edge-id]").filter(path => edgePathIntersectsRegion(path, region, bounds)).map(path => path.dataset.edgeId);
      state.selectedNodeIds = new Set(ids);
      state.selectedNodeId = ids.length === 1 ? ids[0] : null;
      state.selectedEdgeIds = new Set(edgeIds);
      state.selectedEdgeId = edgeIds.length === 1 ? edgeIds[0] : null;
      renderMap();
      const selectedCount = ids.length + edgeIds.length;
      if (selectedCount) toast(`已选中 ${ids.length} 个图形、${edgeIds.length} 条连接线，可右键删除`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  });
}

function bindEvents() {
  $$(".view-button").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#collapseStoryMapsButton").addEventListener("click", () => {
    state.storyMapsCollapsed = !state.storyMapsCollapsed;
    if (state.project) {
      localStorage.setItem(`motu.storyMapsCollapsed.${state.project.id}`, String(state.storyMapsCollapsed));
    }
    renderStoryMaps();
  });
  $("#storyMapList").addEventListener("click", event => {
    const renameButton = event.target.closest("[data-rename-map]");
    if (renameButton) { openStoryMapDialog(renameButton.dataset.renameMap); return; }
    const deleteButton = event.target.closest("[data-delete-map]");
    if (deleteButton) { openStoryMapDeleteDialog(deleteButton.dataset.deleteMap); return; }
    const item = event.target.closest("[data-story-map-id]");
    if (item) selectStoryMap(item.dataset.storyMapId);
  });
  $("#addStoryMapButton").addEventListener("click", () => openStoryMapDialog());
  $("#saveStoryMapButton").addEventListener("click", saveStoryMap);
  $("#storyMapNameInput").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); saveStoryMap(); }
  });
  $("#confirmStoryMapDeleteButton").addEventListener("click", deletePendingStoryMap);
  $("#cancelChapterLinkButton").addEventListener("click", () => cancelChapterLinkMode());
  $("#chapterList").addEventListener("click", event => {
    const selectAllVolumeButton = event.target.closest("[data-select-all-volume]");
    if (selectAllVolumeButton) {
      const volumeId = selectAllVolumeButton.dataset.selectAllVolume;
      const volumeChapterIds = state.project.chapters
        .filter(chapter => chapter.volume_id === volumeId)
        .map(chapter => chapter.id);
      const allSelected = volumeChapterIds.length > 0 && volumeChapterIds.every(id => state.selectedChapterIds.has(id));
      volumeChapterIds.forEach(id => {
        if (allSelected) state.selectedChapterIds.delete(id);
        else state.selectedChapterIds.add(id);
      });
      renderChapters();
      return;
    }
    const deleteVolumeSelectedButton = event.target.closest("[data-delete-volume-selected]");
    if (deleteVolumeSelectedButton) {
      const volumeId = deleteVolumeSelectedButton.dataset.deleteVolumeSelected;
      const selectedIds = state.project.chapters
        .filter(chapter => chapter.volume_id === volumeId && state.selectedChapterIds.has(chapter.id))
        .map(chapter => chapter.id);
      openChapterDeleteDialog(selectedIds);
      return;
    }
    const toggleVolumeButton = event.target.closest("[data-toggle-volume]");
    if (toggleVolumeButton) {
      const volumeId = toggleVolumeButton.dataset.toggleVolume;
      if (state.collapsedVolumeIds.has(volumeId)) state.collapsedVolumeIds.delete(volumeId);
      else state.collapsedVolumeIds.add(volumeId);
      localStorage.setItem(`motu.collapsedVolumes.${state.project.id}`, JSON.stringify([...state.collapsedVolumeIds]));
      renderChapters();
      return;
    }
    const addChapterButton = event.target.closest("[data-add-chapter-volume]");
    if (addChapterButton) { addChapterToVolume(addChapterButton.dataset.addChapterVolume); return; }
    const deleteVolumeButton = event.target.closest("[data-delete-volume]");
    if (deleteVolumeButton) { openDeleteVolumeDialog(deleteVolumeButton.dataset.deleteVolume); return; }
    const renameButton = event.target.closest("[data-rename-chapter]");
    if (renameButton) { openChapterRenameDialog(renameButton.dataset.renameChapter); return; }
    const deleteButton = event.target.closest("[data-delete-chapter]");
    if (deleteButton) { openChapterDeleteDialog([deleteButton.dataset.deleteChapter]); return; }
    const selectInput = event.target.closest("[data-chapter-select]");
    if (selectInput) {
      if (selectInput.checked) state.selectedChapterIds.add(selectInput.dataset.chapterSelect);
      else state.selectedChapterIds.delete(selectInput.dataset.chapterSelect);
      renderChapters();
      return;
    }
    const chapterItem = event.target.closest(".chapter-item");
    if (state.chapterBulkMode && chapterItem) {
      const chapterId = chapterItem.dataset.chapterId;
      if (state.selectedChapterIds.has(chapterId)) state.selectedChapterIds.delete(chapterId);
      else state.selectedChapterIds.add(chapterId);
      renderChapters();
      return;
    }
    if (state.linkTargetNodeId) {
      const chapterId = chapterItem?.dataset.chapterId;
      if (chapterId) { state.selectedNodeId = state.linkTargetNodeId; setNodeChapterLink(chapterId); }
      return;
    }
    const item = event.target.closest(".chapter-item"); if (item) selectChapter(item.dataset.chapterId);
  });
  $("#chapterSearch").addEventListener("input", () => renderChapters());
  $("#openImportExportButton").addEventListener("click", openImportExportDialog);
  $("#exportStoryMapPackageButton").addEventListener("click", openStoryMapPackageExportPanel);
  $("#storyMapExportList").addEventListener("change", event => {
    const checkbox = event.target.closest("[data-export-story-map]");
    if (!checkbox) return;
    if (checkbox.checked) state.selectedStoryMapExportIds.add(checkbox.dataset.exportStoryMap);
    else state.selectedStoryMapExportIds.delete(checkbox.dataset.exportStoryMap);
    renderStoryMapPackageExportList();
  });
  $("#selectAllStoryMapExports").addEventListener("change", event => {
    state.selectedStoryMapExportIds = event.currentTarget.checked
      ? new Set((state.project?.maps || []).map(storyMap => storyMap.id))
      : new Set();
    renderStoryMapPackageExportList();
  });
  $("#confirmStoryMapExportButton").addEventListener("click", exportSelectedStoryMapPackages);
  $("#backFromStoryMapExportButton").addEventListener("click", showImportExportOverview);
  $("#openStoryMapPackageImportButton").addEventListener("click", openStoryMapPackageImportPanel);
  $("#storyMapPackageFile").addEventListener("change", event => selectStoryMapPackageFile(event.currentTarget.files[0]));
  $("#storyMapImportMode").addEventListener("change", updateStoryMapImportMode);
  $("#storyMapImportTitle").addEventListener("input", () => renderStoryMapImportSummary());
  $("#confirmStoryMapImportButton").addEventListener("click", importStoryMapPackage);
  $("#backFromStoryMapImportButton").addEventListener("click", showImportExportOverview);
  $("#exportProjectPackageButton").addEventListener("click", exportCurrentProjectPackage);
  $("#openProjectPackageImportButton").addEventListener("click", openProjectPackageImportPanel);
  $("#projectPackageFile").addEventListener("change", event => selectProjectPackageFile(event.currentTarget.files[0]));
  $("#projectPackageTitle").addEventListener("input", () => renderProjectPackageImportSummary());
  $("#confirmProjectPackageImportButton").addEventListener("click", importProjectPackage);
  $("#backFromProjectPackageImportButton").addEventListener("click", showImportExportOverview);
  $("#openTxtImportFromTransfer").addEventListener("click", openTxtImportPanel);
  $("#openFullBookImportFromTransfer").addEventListener("click", openFullBookImportPanel);
  $("#openChapterTxtExportButton").addEventListener("click", openChapterTxtExportPanel);
  $("#openMarkdownImportButton").addEventListener("click", openMarkdownImportPanel);
  $("#openChapterMarkdownExportButton").addEventListener("click", openChapterMarkdownExportPanel);
  $("#chapterTxtExportList").addEventListener("change", event => {
    const volumeCheckbox = event.target.closest("[data-export-volume]");
    if (volumeCheckbox) {
      const volumeId = volumeCheckbox.dataset.exportVolume;
      state.project.chapters.filter(chapter => chapter.volume_id === volumeId).forEach(chapter => {
        if (volumeCheckbox.checked) state.selectedTxtExportChapterIds.add(chapter.id);
        else state.selectedTxtExportChapterIds.delete(chapter.id);
      });
      renderChapterTxtExportList();
      return;
    }
    const chapterCheckbox = event.target.closest("[data-export-chapter]");
    if (!chapterCheckbox) return;
    if (chapterCheckbox.checked) state.selectedTxtExportChapterIds.add(chapterCheckbox.dataset.exportChapter);
    else state.selectedTxtExportChapterIds.delete(chapterCheckbox.dataset.exportChapter);
    renderChapterTxtExportList();
  });
  $("#selectAllTxtExportChapters").addEventListener("change", event => {
    state.selectedTxtExportChapterIds = event.currentTarget.checked
      ? new Set(state.project.chapters.map(chapter => chapter.id))
      : new Set();
    renderChapterTxtExportList();
  });
  $("#confirmChapterTxtExportButton").addEventListener("click", exportSelectedChapterTxt);
  $("#chapterMarkdownExportList").addEventListener("change", event => {
    const volumeCheckbox = event.target.closest("[data-markdown-export-volume]");
    if (volumeCheckbox) {
      const volumeId = volumeCheckbox.dataset.markdownExportVolume;
      state.project.chapters.filter(chapter => chapter.volume_id === volumeId).forEach(chapter => {
        if (volumeCheckbox.checked) state.selectedMarkdownExportChapterIds.add(chapter.id);
        else state.selectedMarkdownExportChapterIds.delete(chapter.id);
      });
      renderChapterMarkdownExportList();
      return;
    }
    const chapterCheckbox = event.target.closest("[data-markdown-export-chapter]");
    if (!chapterCheckbox) return;
    if (chapterCheckbox.checked) state.selectedMarkdownExportChapterIds.add(chapterCheckbox.dataset.markdownExportChapter);
    else state.selectedMarkdownExportChapterIds.delete(chapterCheckbox.dataset.markdownExportChapter);
    renderChapterMarkdownExportList();
  });
  $("#selectAllMarkdownExportChapters").addEventListener("change", event => {
    state.selectedMarkdownExportChapterIds = event.currentTarget.checked
      ? new Set(state.project.chapters.map(chapter => chapter.id))
      : new Set();
    renderChapterMarkdownExportList();
  });
  $("#confirmChapterMarkdownExportButton").addEventListener("click", exportSelectedChapterMarkdown);
  $("#backFromChapterMarkdownExportButton").addEventListener("click", showImportExportOverview);
  $("#backFromChapterTxtExportButton").addEventListener("click", showImportExportOverview);
  $("#exportBookTxtButton").addEventListener("click", exportBookTxt);
  $("#backToImportExportButton").addEventListener("click", showImportExportOverview);
  $("#backFromTxtImportButton").addEventListener("click", showImportExportOverview);
  $("#importTxtFiles").addEventListener("change", event => {
    state.pendingTxtFiles = [...event.currentTarget.files];
    renderTxtImportFileSummary();
  });
  $("#importTxtVolume").addEventListener("change", () => {
    renderTxtTargetChapterOptions();
    renderTxtImportFileSummary();
  });
  $("#importTxtMode").addEventListener("change", () => {
    let existing = $("#importTxtMode").value === "existing";
    if (existing && !$("#importTxtTargetChapter").value) {
      $("#importTxtMode").value = "new";
      existing = false;
    }
    $("#importTxtTargetChapterField").hidden = !existing;
    $("#importTxtModeHint").textContent = existing
      ? "只选择一个 TXT 文件。内容会替换所选章节正文，章节标题与故事地图关联保持不变。"
      : "文件内容将导入为目标卷中的新章节，按现有章节顺序自动编号。";
    renderTxtImportFileSummary();
  });
  $("#importTxtTargetChapter").addEventListener("change", renderTxtImportFileSummary);
  $("#confirmImportTxtButton").addEventListener("click", importTxtFiles);
  $("#fullBookImportFile").addEventListener("change", event => selectFullBookImportFile(event.currentTarget.files[0]));
  $("#fullBookImportEncoding").addEventListener("change", () => {
    if (state.pendingFullBookFile) selectFullBookImportFile(state.pendingFullBookFile);
  });
  $("#confirmFullBookImportButton").addEventListener("click", importFullBookTxt);
  $("#fullBookImportVolume").addEventListener("change", () => renderFullBookImportPreview());
  $("#backFromFullBookImportButton").addEventListener("click", showImportExportOverview);
  $("#markdownImportFiles").addEventListener("change", event => selectMarkdownImportFiles(event.currentTarget.files));
  $("#markdownImportVolume").addEventListener("change", () => renderMarkdownImportSummary());
  $("#markdownImportMode").addEventListener("change", () => renderMarkdownImportSummary());
  $("#markdownImportFileList").addEventListener("change", event => {
    const target = event.target.closest("[data-markdown-target]");
    if (!target) return;
    const file = state.pendingMarkdownFiles[Number(target.dataset.markdownTarget)];
    if (file) file.targetChapterId = target.value;
    renderMarkdownImportSummary();
  });
  $("#confirmMarkdownImportButton").addEventListener("click", importMarkdownFiles);
  $("#backFromMarkdownImportButton").addEventListener("click", showImportExportOverview);
  $("#importExportDialog").addEventListener("click", event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#importExportDialog").addEventListener("close", () => {
    state.pendingTxtFiles = [];
    state.pendingFullBookFile = null;
    state.pendingFullBookChapters = [];
    state.pendingMarkdownFiles = [];
    state.pendingMarkdownIsZip = false;
    state.markdownImportBusy = false;
    state.selectedTxtExportChapterIds.clear();
    state.selectedMarkdownExportChapterIds.clear();
    state.selectedStoryMapExportIds.clear();
    state.storyMapExportBusy = false;
    state.pendingStoryMapPackage = null;
    state.storyMapImportBusy = false;
    state.pendingProjectPackage = null;
    state.projectPackageImportBusy = false;
    $("#importTxtFiles").value = "";
    $("#fullBookImportFile").value = "";
    $("#markdownImportFiles").value = "";
    $("#storyMapPackageFile").value = "";
    $("#projectPackageFile").value = "";
    renderTxtImportFileSummary();
    renderFullBookImportPreview();
    renderMarkdownImportSummary();
    renderStoryMapImportSummary();
    renderProjectPackageImportSummary();
    showImportExportOverview();
  });
  $("#addVolumeButton").addEventListener("click", openNewVolumeDialog);
  $("#saveNewVolumeButton").addEventListener("click", saveNewVolume);
  $("#newVolumeTitle").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); saveNewVolume(); }
  });
  $("#confirmDeleteVolumeButton").addEventListener("click", deletePendingVolume);
  $("#saveChapterRenameButton").addEventListener("click", saveChapterRename);
  $("#renameChapterInput").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); saveChapterRename(); }
  });
  $("#chapterBatchButton").addEventListener("click", toggleChapterBulkMode);
  $("#confirmChapterDeleteButton").addEventListener("click", deletePendingChapters);
  $("#chapterTitleInput").addEventListener("input", () => {
    scheduleEditorHistory();
    queueDocumentSave();
  });
  $("#chapterTitleInput").addEventListener("keydown", event => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.code === "KeyZ") {
      event.preventDefault();
      moveEditorHistory(event.shiftKey ? 1 : -1);
    } else if (mod && !event.shiftKey && event.code === "KeyY") {
      event.preventDefault();
      moveEditorHistory(1);
    }
  });
  $("#chapterContent").addEventListener("input", () => {
    syncRichEditorChange();
    if (!$("#findReplacePanel").hidden) requestAnimationFrame(() => refreshFindResults());
  });
  $("#chapterContent").addEventListener("keydown", handleMarkdownShortcut);
  $("#undoButton").addEventListener("click", () => moveEditorHistory(-1));
  $("#redoButton").addEventListener("click", () => moveEditorHistory(1));
  $$(".format-tools [data-md-action]").forEach(button => {
    button.addEventListener("pointerdown", event => event.preventDefault());
    button.addEventListener("click", () => applyMarkdownAction(button.dataset.mdAction));
  });
  $("#shortcutHelpButton").addEventListener("click", event => {
    event.stopPropagation();
    setShortcutPanel($("#shortcutPanel").hidden);
  });
  $("#closeShortcutPanel").addEventListener("click", () => setShortcutPanel(false));
  $("#shortcutSearch").addEventListener("input", event => renderShortcutGroups(event.currentTarget.value));
  $("#typographyButton").addEventListener("click", event => {
    event.stopPropagation();
    setTypographyPanel($("#typographyPanel").hidden);
  });
  $("#closeTypographyPanel").addEventListener("click", () => setTypographyPanel(false));
  ["#writingFontFamily", "#writingFontSize", "#writingLineHeight", "#writingWidth", "#writingTextColor"].forEach(selector => {
    $(selector).addEventListener("input", updateWritingTypographyFromControls);
  });
  ["#writingParagraphSpacing", "#writingFirstIndent"].forEach(selector => {
    $(selector).addEventListener("change", updateWritingTypographyFromControls);
  });
  $("#writingBoldToggle").addEventListener("click", () => {
    writingTypography.bold = !writingTypography.bold;
    saveWritingTypography();
  });
  $("#resetTypographyButton").addEventListener("click", () => {
    writingTypography = { ...writingTypographyDefaults };
    saveWritingTypography();
    toast("已恢复默认排版");
  });
  $("#backgroundButton").addEventListener("click", event => {
    event.stopPropagation();
    setBackgroundPanel($("#backgroundPanel").hidden);
  });
  $("#closeBackgroundPanel").addEventListener("click", () => setBackgroundPanel(false));
  $("#nightModeToggle").addEventListener("click", () => {
    writingAppearance.night = !writingAppearance.night;
    saveWritingAppearance();
  });
  $("#backgroundThemePicker").addEventListener("click", event => {
    const button = event.target.closest("[data-writing-theme]");
    if (!button) return;
    writingAppearance.theme = button.dataset.writingTheme;
    saveWritingAppearance();
  });
  $("#guideStylePicker").addEventListener("click", event => {
    const button = event.target.closest("[data-guide-style]");
    if (!button) return;
    writingAppearance.guide = button.dataset.guideStyle;
    saveWritingAppearance();
  });
  $("#resetBackgroundButton").addEventListener("click", () => {
    writingAppearance = { ...writingAppearanceDefaults };
    saveWritingAppearance();
    toast("背景与稿纸设置已恢复默认");
  });
  $("#findReplaceButton").addEventListener("click", event => {
    event.stopPropagation();
    const opening = $("#findReplacePanel").hidden;
    if (opening && findPanelLayout.minimized) {
      findPanelLayout.minimized = false;
      saveFindPanelLayout();
    }
    setFindReplacePanel(opening);
  });
  $("#closeFindReplacePanel").addEventListener("click", () => setFindReplacePanel(false));
  $("#findCompactButton").addEventListener("click", () => {
    findPanelLayout.compact = !findPanelLayout.compact;
    saveFindPanelLayout();
  });
  $("#findMinimizeButton").addEventListener("click", () => {
    findPanelLayout.minimized = !findPanelLayout.minimized;
    saveFindPanelLayout();
    if (!findPanelLayout.minimized) requestAnimationFrame(() => $("#findTextInput").focus());
  });
  $("#findTextInput").addEventListener("input", () => refreshFindResults({ reset: true }));
  $("#findTextInput").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    navigateFind(event.shiftKey ? -1 : 1);
  });
  $("#findScopePicker").addEventListener("click", event => {
    const button = event.target.closest("[data-find-scope]");
    if (button) setFindScope(button.dataset.findScope);
  });
  $("#findCaseSensitive").addEventListener("change", () => refreshFindResults({ reset: true }));
  $("#findWholeWord").addEventListener("change", () => refreshFindResults({ reset: true }));
  $("#findPreviousButton").addEventListener("click", () => navigateFind(-1));
  $("#findNextButton").addEventListener("click", () => navigateFind(1));
  $("#replaceCurrentButton").addEventListener("click", replaceCurrentFindMatch);
  $("#replaceChapterButton").addEventListener("click", () => replaceAcrossChapters([activeChapter()], "本章替换"));
  $("#replaceBookButton").addEventListener("click", () => replaceAcrossChapters(state.project?.chapters || [], "全书替换"));
  $("#nightModeButton").addEventListener("click", () => {
    writingAppearance.night = !writingAppearance.night;
    saveWritingAppearance();
  });
  $("#splitViewButton").addEventListener("click", () => setSplitView(!state.split.open));
  $("#closeSplitPane").addEventListener("click", () => setSplitView(false));
  $("#splitChapterSelect").addEventListener("change", event => {
    state.split.chapterId = event.currentTarget.value || null;
    renderSplitPane();
    saveSplitViewLayout();
  });
  bindSplitPaneResizer();
  window.addEventListener("resize", () => {
    if (state.split.open && $("#writeView").classList.contains("active")) setSplitPaneWidth(state.split.width);
  });
  $("#editorMapButton").addEventListener("click", () => switchView("map"));
  $("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#testConnection").addEventListener("click", testConnection);
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#projectPicker").addEventListener("click", openProjectDialog);
  $("#createProjectButton").addEventListener("click", createProject);
  $("#projectList").addEventListener("click", event => {
    const item = event.target.closest(".project-option");
    if (item) { $("#projectDialog").close(); loadProject(item.dataset.projectId).catch(error => toast(error.message)); }
  });
  $$(".node-template").forEach(button => {
    button.addEventListener("click", event => {
      if (event.detail === 0) addNode(button.dataset.type, button.dataset.shape);
    });
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const start = { x: event.clientX, y: event.clientY };
      let moved = false;
      let dragPreview = null;
      const previewLabels = {
        rectangle: "新流程", rounded: "新节点", diamond: "新判断", circle: "新节点",
        ellipse: "开始 / 结束", parallelogram: "输入 / 输出", hexagon: "新准备",
        document: "新文档", cylinder: "新数据",
      };
      const updateDragPreview = pointerEvent => {
        if (!dragPreview) {
          dragPreview = document.createElement("div");
          dragPreview.className = `story-node shape-${button.dataset.shape} node-drag-preview`;
          dragPreview.dataset.color = "blue";
          const inner = document.createElement("div");
          inner.className = "node-inner";
          const typeLabel = document.createElement("span");
          typeLabel.className = "node-type";
          typeLabel.textContent = "情节";
          const title = document.createElement("span");
          title.className = "node-label";
          title.textContent = previewLabels[button.dataset.shape] || "新节点";
          inner.append(typeLabel, title);
          dragPreview.append(inner);
          document.body.append(dragPreview);
        }
        const viewportBounds = $("#mapViewport").getBoundingClientRect();
        const previewWidth = dragPreview.offsetWidth;
        const previewHeight = dragPreview.offsetHeight;
        dragPreview.style.left = `${pointerEvent.clientX - previewWidth / 2}px`;
        dragPreview.style.top = `${pointerEvent.clientY - previewHeight / 2}px`;
        dragPreview.classList.toggle(
          "drop-target-active",
          pointerEvent.clientX >= viewportBounds.left && pointerEvent.clientX <= viewportBounds.right
            && pointerEvent.clientY >= viewportBounds.top && pointerEvent.clientY <= viewportBounds.bottom,
        );
      };
      const removeDragPreview = () => {
        dragPreview?.remove();
        dragPreview = null;
      };
      button.setPointerCapture(pointerId);
      button.classList.add("dragging");
      const move = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return;
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 6) {
          moved = true;
          updateDragPreview(moveEvent);
        }
      };
      const finish = upEvent => {
        if (upEvent.pointerId !== pointerId) return;
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerup", finish);
        button.removeEventListener("pointercancel", cancel);
        button.classList.remove("dragging");
        removeDragPreview();
        if (!moved) {
          addNode(button.dataset.type, button.dataset.shape);
          return;
        }
        const viewport = $("#mapViewport");
        const bounds = viewport.getBoundingClientRect();
        if (upEvent.clientX < bounds.left || upEvent.clientX > bounds.right || upEvent.clientY < bounds.top || upEvent.clientY > bounds.bottom) return;
        addNode(button.dataset.type, button.dataset.shape, {
          x: upEvent.clientX - bounds.left - state.camera.x - 80,
          y: upEvent.clientY - bounds.top - state.camera.y - 40,
        });
      };
      const cancel = cancelEvent => {
        if (cancelEvent.pointerId !== pointerId) return;
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerup", finish);
        button.removeEventListener("pointercancel", cancel);
        button.classList.remove("dragging");
        removeDragPreview();
      };
      button.addEventListener("pointermove", move);
      button.addEventListener("pointerup", finish);
      button.addEventListener("pointercancel", cancel);
    });
  });
  $("#mapViewport").addEventListener("click", event => {
    if (state.ignoreCanvasClick) { state.ignoreCanvasClick = false; return; }
    if (event.target === $("#mapViewport") || event.target === $("#nodeLayer") || event.target === $("#edgeLayer")) clearCanvasSelection();
  });
  $("#edgeLayer").addEventListener("click", event => {
    const edgeId = event.target.closest("[data-edge-id]")?.dataset.edgeId;
    const edge = state.project?.edges.find(item => item.id === edgeId);
    if (!edge) return;
    event.stopPropagation();
    if (edge.chapter_id) selectChapter(edge.chapter_id);
    else openEdgeDialog(edge.id);
  });
  $("#mapViewport").addEventListener("contextmenu", event => {
    event.preventDefault();
    const nodeElement = event.target.closest(".story-node");
    const edgeId = event.target.closest("[data-edge-id]")?.dataset.edgeId;
    if (edgeId) {
      if (!state.selectedEdgeIds.has(edgeId)) {
        state.selectedEdgeIds = new Set([edgeId]);
        state.selectedNodeId = null; state.selectedNodeIds.clear();
      }
      state.selectedEdgeId = state.selectedEdgeIds.size === 1 ? edgeId : null;
      renderMap();
    } else if (nodeElement) {
      const nodeId = nodeElement.dataset.nodeId;
      if (!state.selectedNodeIds.has(nodeId)) {
        state.selectedNodeIds = new Set([nodeId]);
        state.selectedEdgeId = null; state.selectedEdgeIds.clear();
      }
      state.selectedNodeId = state.selectedNodeIds.size === 1 ? nodeId : null;
      renderMap();
    }
    showCanvasContextMenu(event.clientX, event.clientY);
  });
  $("#canvasContextMenu").addEventListener("click", async event => {
    const action = event.target.closest("[data-context-action]")?.dataset.contextAction;
    if (!action) return;
    const menu = $("#canvasContextMenu");
    if (action === "color") {
      const palette = $("#quickColorPalette");
      palette.hidden = !palette.hidden;
      event.target.closest("[data-context-action]").setAttribute("aria-expanded", String(!palette.hidden));
      const viewportRect = $("#mapViewport").getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.bottom > viewportRect.bottom - 8) menu.style.top = `${Math.max(8, parseFloat(menu.style.top) - (menuRect.bottom - viewportRect.bottom + 8))}px`;
      return;
    }
    menu.hidden = true;
    if (action === "edit-edge" && state.selectedEdgeId) openEdgeDialog(state.selectedEdgeId);
    if (action === "note") openNoteDialog();
    if (action === "link") {
      const node = state.project?.nodes.find(item => item.id === state.selectedNodeId);
      if (node?.chapter_id) openChapterLinkDialog(); else startChapterLinkMode();
    }
    if (action === "unlink-chapter") await setNodeChapterLink(null);
    if (action === "settings") openInspector(state.selectedNodeId);
    if (action === "delete") await deleteCanvasSelection();
    if (action === "clear") clearCanvasSelection();
  });
  $("#emptyAddButton").addEventListener("click", () => addNode("plot", "rectangle"));
  $("#clearCanvasButton").addEventListener("click", openClearCanvasDialog);
  $("#confirmClearCanvasButton").addEventListener("click", clearActiveMapCanvas);
  $("#connectButton").addEventListener("click", event => {
    event.currentTarget.classList.toggle("active"); state.connectSourceId = null;
    event.currentTarget.innerHTML = event.currentTarget.classList.contains("active") ? '<span class="arrow-preview">→</span>选起点' : '<span class="arrow-preview">→</span>箭头';
  });
  $("#quickColorPalette").addEventListener("click", event => {
    const color = event.target.closest("[data-quick-color]")?.dataset.quickColor;
    const node = state.project?.nodes.find(item => item.id === state.selectedNodeId);
    if (!color || !node) return;
    node.color = color; saveNode(node, { color }); $("#quickColorPalette").hidden = true; $("#canvasContextMenu").hidden = true; renderMap();
  });
  $("#noteList").addEventListener("click", event => { const id = event.target.closest("[data-dialog-note-id]")?.dataset.dialogNoteId; if (id) renderNoteDialog(id); });
  $("#newNoteButton").addEventListener("click", () => { state.editingNoteId = null; renderNoteDialog(); $("#noteContent").focus(); });
  $("#saveNoteButton").addEventListener("click", saveCurrentNote);
  $("#deleteNoteButton").addEventListener("click", deleteCurrentNote);
  $("#chapterLinkList").addEventListener("click", event => { const id = event.target.closest("[data-link-chapter-id]")?.dataset.linkChapterId; if (id) setNodeChapterLink(id); });
  $("#unlinkChapterButton").addEventListener("click", () => setNodeChapterLink(null));
  $("#saveEdgeButton").addEventListener("click", saveSelectedEdge);
  $("#deleteEdgeButton").addEventListener("click", () => deleteSelectedEdge());
  $("#openEdgeChapterButton").addEventListener("click", openSelectedEdgeChapter);
  $("#edgeColorPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-edge-color]");
    if (!button) return;
    $$("#edgeColorPicker [data-edge-color]").forEach(item => item.classList.toggle("active", item === button));
  });
  $("#nodeType").addEventListener("change", queueNodeSave);
  $("#nodeChapter").addEventListener("change", queueNodeSave);
  $$(".color-picker button").forEach(button => button.addEventListener("click", () => {
    const node = state.project?.nodes.find(item => item.id === state.selectedNodeId); if (!node) return;
    node.color = button.dataset.color; queueNodeSave(); openInspector(node.id);
  }));
  $("#jumpChapterButton").addEventListener("click", () => {
    const node = state.project?.nodes.find(item => item.id === state.selectedNodeId); openNodeLinkedContent(node);
  });
  $("#linkedNodeBar").addEventListener("click", event => {
    const nodeButton = event.target.closest("[data-linked-node-id]");
    const edgeButton = event.target.closest("[data-linked-edge-id]");
    if (nodeButton) focusNodeOnMap(nodeButton.dataset.linkedNodeId);
    if (edgeButton) focusEdgeOnMap(edgeButton.dataset.linkedEdgeId);
  });
  $("#deleteNodeButton").addEventListener("click", deleteSelectedNode);
  $(".inspector-heading button").addEventListener("click", () => $(".inspector").classList.add("hidden"));
  bindNodeInteractions();
  bindCanvasSelection();
  bindMinimapInteractions();
  bindFindPanelDrag();
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest("#canvasContextMenu")) $("#canvasContextMenu").hidden = true;
    if (!event.target.closest("#shortcutPanel") && !event.target.closest("#shortcutHelpButton")) setShortcutPanel(false);
    if (!event.target.closest("#typographyPanel") && !event.target.closest("#typographyButton")) setTypographyPanel(false);
    if (!event.target.closest("#backgroundPanel") && !event.target.closest("#backgroundButton")) setBackgroundPanel(false);
    const inspector = $("#inspector");
    if (!inspector.classList.contains("hidden") && !event.target.closest("#inspector") && !event.target.closest('[data-context-action="settings"]')) inspector.classList.add("hidden");
  });
  document.addEventListener("keydown", event => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && (event.code === "KeyF" || event.code === "KeyH")) {
      event.preventDefault();
      if (!$("#writeView").classList.contains("active")) switchView("write");
      if (findPanelLayout.minimized) {
        findPanelLayout.minimized = false;
        saveFindPanelLayout();
      }
      setFindReplacePanel(true, event.code === "KeyH");
      return;
    }
    if (event.key === "F3" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if ($("#findReplacePanel").hidden) {
        if (findPanelLayout.minimized) {
          findPanelLayout.minimized = false;
          saveFindPanelLayout();
        }
        setFindReplacePanel(true);
      }
      else navigateFind(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key !== "Escape") return;
    if (!$("#shortcutPanel").hidden) setShortcutPanel(false);
    if (!$("#typographyPanel").hidden) setTypographyPanel(false);
    if (!$("#backgroundPanel").hidden) setBackgroundPanel(false);
    if (!$("#findReplacePanel").hidden) setFindReplacePanel(false);
  });
  window.addEventListener("resize", () => requestAnimationFrame(() => { applyCamera(); resizeManuscript(); applyFindPanelLayout(); }));
  $$(".mobile-nav button").forEach(button => button.addEventListener("click", () => mobileNavigate(button.dataset.mobile)));
}

async function testConnection() {
  const url = normalizedServerUrl($("#serverUrl").value);
  const result = $("#connectionResult");
  result.textContent = "正在测试…"; result.className = "connection-result";
  try {
    const response = await fetch(`${url}/api/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    assertCompatibleApi(health);
    result.textContent = `连接成功，服务器版本 ${health.version}`; result.className = "connection-result ok";
  } catch (error) {
    result.textContent = `连接失败：${error.message}`; result.className = "connection-result error";
  }
}

async function saveSettings() {
  const value = normalizedServerUrl($("#serverUrl").value);
  if (!/^https?:\/\//i.test(value)) { $("#connectionResult").textContent = "地址需要以 http:// 或 https:// 开头"; return; }
  state.config.serverUrl = value; state.config.apiKey = $("#apiKey").value.trim();
  localStorage.setItem("motu.serverUrl", value); localStorage.setItem("motu.apiKey", state.config.apiKey);
  $("#settingsDialog").close(); await connect();
}

function openProjectDialog() {
  if (!state.project && !state.projects.length) {
    requireProject("打开作品库");
    return;
  }
  $("#projectList").innerHTML = state.projects.map(project => `<button class="project-option" type="button" data-project-id="${project.id}"><strong>${escapeHtml(project.title)}</strong><small>${project.id === state.project?.id ? "当前作品" : "打开"}</small></button>`).join("");
  $("#projectDialog").showModal();
}

async function createProject() {
  const input = $("#newProjectTitle"); const title = input.value.trim();
  if (!title) { input.focus(); return; }
  try {
    const project = await api("/api/projects", { method: "POST", body: JSON.stringify({ title, description: "" }) });
    state.projects.unshift(project); input.value = ""; $("#projectDialog").close(); await loadProject(project.id); toast("新作品已创建");
  } catch (error) { toast(error.message); }
}

function toggleChapterBulkMode() {
  if (state.linkTargetNodeId) { toast("请先完成或取消章节链接"); return; }
  if (!state.chapterBulkMode && state.project.chapters.length <= 1) { toast("作品至少需要保留一个章节"); return; }
  state.chapterBulkMode = !state.chapterBulkMode;
  state.selectedChapterIds.clear();
  renderChapters();
}

function openChapterDeleteDialog(chapterIds) {
  if (!state.project) return;
  if (state.linkTargetNodeId) { toast("请先完成或取消章节链接"); return; }
  const ids = [...new Set(chapterIds)].filter(id => state.project.chapters.some(chapter => chapter.id === id));
  if (!ids.length) return;
  if (state.project.chapters.length - ids.length < 1) { toast("作品至少需要保留一个章节"); return; }
  const deleted = new Set(ids);
  const chapters = state.project.chapters.filter(chapter => deleted.has(chapter.id));
  const nodeLinkCount = state.project.nodes.filter(node => deleted.has(node.chapter_id)).length;
  const edgeLinkCount = state.project.edges.filter(edge => deleted.has(edge.chapter_id)).length;
  state.pendingChapterDeleteIds = ids;
  $("#chapterDeleteTitle").textContent = ids.length === 1 ? "确认删除章节？" : `确认删除 ${ids.length} 个章节？`;
  $("#chapterDeleteSummary").textContent = ids.length === 1 ? `将删除“${chapters[0].title}”。` : `将批量删除选中的 ${ids.length} 个章节。`;
  $("#chapterDeleteDetails").textContent = `${nodeLinkCount} 个节点链接和 ${edgeLinkCount} 个箭头链接会自动断开。`;
  $("#chapterDeleteDialog").showModal();
}

async function deletePendingChapters() {
  const ids = [...state.pendingChapterDeleteIds];
  if (!state.project || !ids.length) return;
  const deletingActiveDocument = ids.includes(state.activeChapterId);
  if (deletingActiveDocument) clearTimeout(state.chapterTimer);
  const button = $("#confirmChapterDeleteButton");
  button.disabled = true;
  button.textContent = "正在删除…";
  try {
    const result = await api(`/api/projects/${state.project.id}/chapters/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ chapter_ids: ids }),
    });
    const deleted = new Set(ids);
    ids.forEach(id => state.editorHistories.delete(id));
    state.project.chapters = state.project.chapters.filter(chapter => !deleted.has(chapter.id));
    const nextPositionByVolume = new Map();
    state.project.chapters.forEach(chapter => {
      const position = nextPositionByVolume.get(chapter.volume_id) || 0;
      chapter.position = position;
      nextPositionByVolume.set(chapter.volume_id, position + 1);
    });
    sortProjectChapters();
    state.project.nodes.forEach(node => { if (deleted.has(node.chapter_id)) node.chapter_id = null; });
    state.project.edges.forEach(edge => { if (deleted.has(edge.chapter_id)) edge.chapter_id = null; });
    if (deleted.has(state.activeChapterId)) {
      state.activeChapterId = state.project.chapters[0].id;
      localStorage.setItem("motu.activeChapterId", state.activeChapterId);
    }
    if (deleted.has(state.split.chapterId)) state.split.chapterId = defaultSplitChapterId();
    state.chapterBulkMode = false;
    state.selectedChapterIds.clear();
    state.pendingChapterDeleteIds = [];
    $("#chapterDeleteDialog").close();
    $(".inspector").classList.add("hidden");
    renderAll();
    toast(`已删除 ${result.chapters} 个章节`);
  } catch (error) {
    if (deletingActiveDocument) queueDocumentSave();
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "确认删除";
  }
}

function openClearCanvasDialog() {
  if (!requireProject("清空画布")) return;
  const nodes = activeMapNodes().length;
  const edges = activeMapEdges().length;
  const notes = activeMapNotes().length;
  if (!nodes && !edges) { toast("当前画布已经是空的"); return; }
  $("#clearCanvasSummary").textContent = `将清空“${activeStoryMap()?.title || "当前地图"}”：删除 ${nodes} 个节点、${edges} 条连接线和 ${notes} 条便签。`;
  $("#clearCanvasDialog").showModal();
}

async function clearActiveMapCanvas() {
  if (!state.project) return;
  const button = $("#confirmClearCanvasButton");
  button.disabled = true;
  button.textContent = "正在清空…";
  try {
    const result = await api(`/api/maps/${state.activeMapId}/canvas`, { method: "DELETE" });
    const deletedNodeIds = new Set(activeMapNodes().map(node => node.id));
    state.project.nodes = state.project.nodes.filter(node => node.map_id !== state.activeMapId);
    state.project.edges = state.project.edges.filter(edge => edge.map_id !== state.activeMapId);
    state.project.notes = state.project.notes.filter(note => !deletedNodeIds.has(note.node_id));
    state.selectedNodeId = null; state.selectedNodeIds.clear();
    state.selectedEdgeId = null; state.selectedEdgeIds.clear();
    state.connectSourceId = null;
    state.camera = { x: 0, y: 0 };
    state.canvasAnchor = null;
    state.canvasBounds = null;
    state.canvasInitialized = false;
    state.mapViewStates.delete(state.activeMapId);
    $("#connectButton").classList.remove("active");
    $("#connectButton").innerHTML = '<span class="arrow-preview">→</span>箭头';
    $(".inspector").classList.add("hidden");
    $("#clearCanvasDialog").close();
    renderMap();
    renderStoryMaps();
    renderLinkedNodes();
    toast(`“${activeStoryMap()?.title || "故事地图"}”已清空：${result.nodes} 个节点、${result.edges} 条连接线`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "确认清空";
  }
}

async function deleteCanvasSelection() {
  const nodeIds = state.selectedNodeIds.size ? [...state.selectedNodeIds] : (state.selectedNodeId ? [state.selectedNodeId] : []);
  const edgeIds = state.selectedEdgeIds.size ? [...state.selectedEdgeIds] : (state.selectedEdgeId ? [state.selectedEdgeId] : []);
  if (!nodeIds.length && !edgeIds.length) return;
  try {
    for (const edgeId of edgeIds) await api(`/api/edges/${edgeId}`, { method: "DELETE" });
    for (const nodeId of nodeIds) await api(`/api/nodes/${nodeId}`, { method: "DELETE" });
    const deletedNodes = new Set(nodeIds); const deletedEdges = new Set(edgeIds);
    state.project.nodes = state.project.nodes.filter(node => !deletedNodes.has(node.id));
    state.project.edges = state.project.edges.filter(edge => !deletedEdges.has(edge.id) && !deletedNodes.has(edge.source_id) && !deletedNodes.has(edge.target_id));
    state.project.notes = state.project.notes.filter(note => !deletedNodes.has(note.node_id));
    state.selectedNodeId = null; state.selectedNodeIds.clear();
    state.selectedEdgeId = null; state.selectedEdgeIds.clear();
    $(".inspector").classList.add("hidden");
    renderMap();
    toast(`已删除 ${nodeIds.length} 个图形、${edgeIds.length} 条连接线`);
  } catch (error) { toast(error.message); }
}

async function deleteSelectedNode() {
  const ids = state.selectedNodeIds.size ? [...state.selectedNodeIds] : (state.selectedNodeId ? [state.selectedNodeId] : []);
  const nodes = state.project?.nodes.filter(item => ids.includes(item.id)) || [];
  if (!nodes.length) return;
  try {
    await Promise.all(ids.map(id => api(`/api/nodes/${id}`, { method: "DELETE" })));
    const deletedIds = new Set(ids);
    state.project.nodes = state.project.nodes.filter(item => !deletedIds.has(item.id));
    state.project.edges = state.project.edges.filter(edge => !deletedIds.has(edge.source_id) && !deletedIds.has(edge.target_id));
    state.project.notes = state.project.notes.filter(note => !deletedIds.has(note.node_id));
    state.selectedNodeId = null; state.selectedNodeIds.clear(); state.selectedEdgeId = null; state.selectedEdgeIds.clear();
    $(".inspector").classList.add("hidden"); renderMap();
    toast(nodes.length === 1 ? "节点已删除" : `已删除 ${nodes.length} 个图形`);
  } catch (error) { toast(error.message); }
}

function mobileNavigate(target) {
  $$(".mobile-nav button").forEach(button => button.classList.toggle("active", button.dataset.mobile === target));
  $(".chapter-panel").classList.remove("mobile-active");
  $$(".view-panel").forEach(panel => panel.classList.remove("mobile-active"));
  if (target === "chapters") $(".chapter-panel").classList.add("mobile-active");
  else if (target === "map") { $(".inspector").classList.add("hidden"); $("#mapView").classList.add("active", "mobile-active"); requestAnimationFrame(renderMap); }
  else if (target === "settings") $("#settingsDialog").showModal();
  else $("#writeView").classList.add("active", "mobile-active");
}

boot();

