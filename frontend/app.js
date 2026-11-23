const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  config: {
    serverUrl: localStorage.getItem("motu.serverUrl") || "http://localhost:8000",
    apiKey: localStorage.getItem("motu.apiKey") || "",
  },
  projects: [],
  project: null,
  activeChapterId: localStorage.getItem("motu.activeChapterId") || null,
  selectedNodeId: null,
  connectSourceId: null,
  chapterTimer: null,
  nodeTimer: null,
  toastTimer: null,
};

const nodeTypeNames = { plot: "情节", character: "人物", place: "地点", conflict: "冲突", note: "便签" };
const nodeTypeColors = { plot: "blue", character: "violet", place: "green", conflict: "rose", note: "amber" };

function normalizedServerUrl(value = state.config.serverUrl) {
  return value.trim().replace(/\/+$/, "");
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

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function wordCount(text = "") {
  const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return chinese + latin;
}

function activeChapter() {
  return state.project?.chapters.find(chapter => chapter.id === state.activeChapterId) || null;
}

async function boot() {
  bindEvents();
  $("#serverUrl").value = state.config.serverUrl;
  $("#apiKey").value = state.config.apiKey;
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
  await connect();
}

async function connect() {
  setSaveState("正在连接", "saving");
  try {
    await api("/api/health");
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
  state.project = await api(`/api/projects/${projectId}`);
  localStorage.setItem("motu.projectId", projectId);
  if (!state.project.chapters.some(chapter => chapter.id === state.activeChapterId)) {
    state.activeChapterId = state.project.chapters[0]?.id || null;
  }
  state.selectedNodeId = null;
  state.connectSourceId = null;
  renderAll();
  switchView("map");
  setSaveState("已同步", "saved");
}

function renderAll() {
  if (!state.project) return;
  $("#projectTitle").textContent = state.project.title;
  renderChapters();
  renderEditor();
  renderMap();
  renderChapterOptions();
}

function renderChapters(filter = $("#chapterSearch").value.trim().toLowerCase()) {
  if (!state.project) return;
  const chapters = state.project.chapters.filter(chapter => chapter.title.toLowerCase().includes(filter));
  $("#chapterList").innerHTML = chapters.map(chapter => {
    const index = state.project.chapters.indexOf(chapter) + 1;
    return `<li class="chapter-item ${chapter.id === state.activeChapterId ? "active" : ""}" data-chapter-id="${chapter.id}">
      <span class="chapter-number">${String(index).padStart(2, "0")}</span>
      <span class="chapter-copy"><strong>${escapeHtml(chapter.title)}</strong><small>${chapter.content ? escapeHtml(chapter.content.slice(0, 18).replace(/\s+/g, " ")) : "还没有正文"}</small></span>
      <span class="chapter-words">${wordCount(chapter.content)}</span>
    </li>`;
  }).join("");
  $("#chapterCount").textContent = `${state.project.chapters.length} 章`;
  $("#totalWords").textContent = state.project.chapters.reduce((sum, chapter) => sum + wordCount(chapter.content), 0).toLocaleString();
}

function renderEditor() {
  const chapter = activeChapter();
  if (!chapter) return;
  const index = state.project.chapters.indexOf(chapter) + 1;
  $("#chapterIndex").textContent = `CHAPTER ${String(index).padStart(2, "0")}`;
  $("#chapterTitleInput").value = chapter.title;
  $("#chapterContent").value = chapter.content;
  $("#chapterWords").textContent = `${wordCount(chapter.content)} 字`;
}

function renderChapterOptions() {
  const currentValue = $("#nodeChapter").value;
  $("#nodeChapter").innerHTML = `<option value="">不链接章节</option>${state.project.chapters.map((chapter, index) => `<option value="${chapter.id}">${String(index + 1).padStart(2, "0")} · ${escapeHtml(chapter.title)}</option>`).join("")}`;
  $("#nodeChapter").value = currentValue;
}

function renderMap() {
  if (!state.project) return;
  const chapterMap = new Map(state.project.chapters.map(chapter => [chapter.id, chapter.title]));
  $("#nodeLayer").innerHTML = state.project.nodes.map(node => `<article class="story-node shape-${node.shape} ${node.id === state.selectedNodeId ? "selected" : ""}" data-node-id="${node.id}" data-color="${node.color}" style="left:${node.x}px;top:${node.y}px" tabindex="0">
    <span class="node-link-type">${nodeTypeNames[node.node_type] || "节点"}</span>
    <strong class="node-label">${escapeHtml(node.label)}</strong>
    ${node.chapter_id ? `<span class="node-link">${escapeHtml(chapterMap.get(node.chapter_id) || "章节已删除")}</span>` : ""}
  </article>`).join("");
  $("#mapEmpty").classList.toggle("hidden", state.project.nodes.length > 0);
  requestAnimationFrame(renderEdges);
}

function renderEdges() {
  if (!state.project) return;
  const viewport = $("#mapViewport").getBoundingClientRect();
  const positions = new Map();
  $$(".story-node").forEach(element => {
    const rect = element.getBoundingClientRect();
    positions.set(element.dataset.nodeId, { x: rect.left - viewport.left + rect.width / 2, y: rect.top - viewport.top + rect.height / 2 });
  });
  $("#edgeLayer").setAttribute("viewBox", `0 0 ${Math.max(1, viewport.width)} ${Math.max(1, viewport.height)}`);
  $("#edgeLayer").innerHTML = `<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker></defs>` + state.project.edges.map(edge => {
    const source = positions.get(edge.source_id); const target = positions.get(edge.target_id);
    if (!source || !target) return "";
    const curve = Math.max(55, Math.abs(target.x - source.x) * .42);
    return `<path data-edge-id="${edge.id}" d="M ${source.x} ${source.y} C ${source.x + curve} ${source.y}, ${target.x - curve} ${target.y}, ${target.x} ${target.y}" />`;
  }).join("");
}

function selectChapter(chapterId) {
  if (!state.project?.chapters.some(chapter => chapter.id === chapterId)) return;
  state.activeChapterId = chapterId;
  localStorage.setItem("motu.activeChapterId", chapterId);
  renderChapters();
  renderEditor();
  switchView("write");
}

function switchView(view) {
  $$(".view-button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$(".view-panel").forEach(panel => panel.classList.remove("active", "mobile-active"));
  const panel = view === "map" ? $("#mapView") : $("#writeView");
  panel.classList.add("active", "mobile-active");
  $(".chapter-panel").classList.remove("mobile-active");
  $$(".mobile-nav button").forEach(button => button.classList.toggle("active", button.dataset.mobile === view));
  if (view === "map") requestAnimationFrame(renderMap);
}

function queueChapterSave() {
  const chapter = activeChapter();
  if (!chapter) return;
  chapter.title = $("#chapterTitleInput").value.trim() || "未命名章节";
  chapter.content = $("#chapterContent").value;
  $("#chapterWords").textContent = `${wordCount(chapter.content)} 字`;
  renderChapters();
  setSaveState("保存中", "saving");
  clearTimeout(state.chapterTimer);
  state.chapterTimer = setTimeout(async () => {
    try {
      const updated = await api(`/api/chapters/${chapter.id}`, { method: "PATCH", body: JSON.stringify({ title: chapter.title, content: chapter.content }) });
      Object.assign(chapter, updated);
      setSaveState("已同步", "saved");
    } catch (error) {
      setSaveState("保存失败", "error"); toast(error.message);
    }
  }, 650);
}

async function addChapter() {
  if (!state.project) return;
  try {
    const chapter = await api(`/api/projects/${state.project.id}/chapters`, { method: "POST", body: JSON.stringify({ title: `第 ${state.project.chapters.length + 1} 章` }) });
    state.project.chapters.push(chapter);
    renderChapterOptions();
    selectChapter(chapter.id);
    $("#chapterTitleInput").select();
    toast("新章节已创建");
  } catch (error) { toast(error.message); }
}

async function addNode(type = "plot", shape = "rounded") {
  if (!state.project) return;
  const viewport = $("#mapViewport");
  const x = Math.max(24, viewport.clientWidth / 2 - 84 + (Math.random() - .5) * 100);
  const y = Math.max(24, viewport.clientHeight / 2 - 50 + (Math.random() - .5) * 80);
  try {
    const node = await api(`/api/projects/${state.project.id}/nodes`, { method: "POST", body: JSON.stringify({ label: type === "note" ? "新便签" : `新${nodeTypeNames[type]}`, node_type: type, shape, color: nodeTypeColors[type], x, y, note: "", chapter_id: null }) });
    state.project.nodes.push(node);
    state.selectedNodeId = node.id;
    renderMap();
    openInspector(node.id);
  } catch (error) { toast(error.message); }
}

function openInspector(nodeId) {
  const node = state.project?.nodes.find(item => item.id === nodeId);
  if (!node) return;
  state.selectedNodeId = nodeId;
  $("#nodeLabel")?.remove();
  $("#nodeType").value = node.node_type;
  $("#nodeChapter").value = node.chapter_id || "";
  $("#nodeNote").value = node.note || "";
  let labelInput = document.createElement("label");
  labelInput.id = "nodeLabel";
  labelInput.innerHTML = `节点标题<input id="nodeLabelInput" maxlength="120" value="${escapeHtml(node.label)}" />`;
  $("#nodeType").closest("label").before(labelInput);
  $("#nodeLabelInput").addEventListener("input", queueNodeSave);
  $$(".color-picker button").forEach(button => button.classList.toggle("active", button.dataset.color === node.color));
  $("#jumpChapterButton").disabled = !node.chapter_id;
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
  if (event?.target?.id === "nodeNote") node.note = event.target.value;
  renderMap();
  $("#jumpChapterButton").disabled = !node.chapter_id;
  clearTimeout(state.nodeTimer);
  state.nodeTimer = setTimeout(() => saveNode(node, { label: node.label, note: node.note, node_type: node.node_type, chapter_id: node.chapter_id, color: node.color }), 450);
}

async function saveNode(node, payload) {
  try {
    const updated = await api(`/api/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    Object.assign(node, updated); setSaveState("已同步", "saved");
  } catch (error) { setSaveState("保存失败", "error"); toast(error.message); }
}

async function connectNode(targetId) {
  if (!state.connectSourceId) {
    state.connectSourceId = targetId;
    toast("已选择起点，再点一个节点完成连接");
    return;
  }
  if (state.connectSourceId === targetId) { toast("请选择另一个节点"); return; }
  try {
    const edge = await api(`/api/projects/${state.project.id}/edges`, { method: "POST", body: JSON.stringify({ source_id: state.connectSourceId, target_id: targetId, label: "" }) });
    state.project.edges.push(edge);
    state.connectSourceId = null;
    $("#connectButton").classList.remove("active");
    $("#connectButton").textContent = "连接节点";
    renderEdges(); toast("节点已连接");
  } catch (error) { state.connectSourceId = null; toast(error.message); }
}

function bindNodeInteractions() {
  const layer = $("#nodeLayer");
  layer.addEventListener("pointerdown", event => {
    const element = event.target.closest(".story-node");
    if (!element || $("#connectButton").classList.contains("active")) return;
    const node = state.project.nodes.find(item => item.id === element.dataset.nodeId);
    const viewport = $("#mapViewport").getBoundingClientRect();
    const startX = event.clientX; const startY = event.clientY; const originX = node.x; const originY = node.y;
    let moved = false;
    element.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      const dx = moveEvent.clientX - startX; const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      node.x = Math.max(0, Math.min(viewport.width - element.offsetWidth, originX + dx));
      node.y = Math.max(0, Math.min(viewport.height - element.offsetHeight, originY + dy));
      element.style.left = `${node.x}px`; element.style.top = `${node.y}px`; renderEdges();
    };
    const up = () => {
      element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", up);
      if (moved) saveNode(node, { x: node.x, y: node.y }); else openInspector(node.id);
    };
    element.addEventListener("pointermove", move); element.addEventListener("pointerup", up);
  });
  layer.addEventListener("click", event => {
    const element = event.target.closest(".story-node");
    if (element && $("#connectButton").classList.contains("active")) connectNode(element.dataset.nodeId);
  });
  layer.addEventListener("dblclick", event => {
    const element = event.target.closest(".story-node");
    const node = element && state.project.nodes.find(item => item.id === element.dataset.nodeId);
    if (node?.chapter_id) selectChapter(node.chapter_id);
  });
}

function bindEvents() {
  $$(".view-button").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#chapterList").addEventListener("click", event => {
    const item = event.target.closest(".chapter-item"); if (item) selectChapter(item.dataset.chapterId);
  });
  $("#chapterSearch").addEventListener("input", () => renderChapters());
  $("#addChapterButton").addEventListener("click", addChapter);
  $("#chapterTitleInput").addEventListener("input", queueChapterSave);
  $("#chapterContent").addEventListener("input", queueChapterSave);
  $$(".format-tools button").forEach(button => button.addEventListener("click", () => {
    const editor = $("#chapterContent");
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.slice(start, end);
    if (button.dataset.insert) editor.setRangeText(selected ? `${button.dataset.insert.slice(0, button.dataset.insert.length / 2)}${selected}${button.dataset.insert.slice(button.dataset.insert.length / 2)}` : button.dataset.insert, start, end, "end");
    else if (button.dataset.prefix) editor.setRangeText(button.dataset.prefix + selected, start, end, "end");
    editor.focus(); queueChapterSave();
  }));
  $("#focusButton").addEventListener("click", () => $("#app").classList.toggle("focus-mode"));
  $("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#testConnection").addEventListener("click", testConnection);
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#projectPicker").addEventListener("click", openProjectDialog);
  $("#createProjectButton").addEventListener("click", createProject);
  $("#projectList").addEventListener("click", event => {
    const item = event.target.closest(".project-option");
    if (item) { $("#projectDialog").close(); loadProject(item.dataset.projectId).catch(error => toast(error.message)); }
  });
  $$(".node-template").forEach(button => button.addEventListener("click", () => addNode(button.dataset.type, button.dataset.shape)));
  $("#emptyAddButton").addEventListener("click", () => addNode());
  $("#connectButton").addEventListener("click", event => {
    event.currentTarget.classList.toggle("active"); state.connectSourceId = null;
    event.currentTarget.textContent = event.currentTarget.classList.contains("active") ? "选择起点" : "连接节点";
  });
  $("#nodeType").addEventListener("change", queueNodeSave);
  $("#nodeChapter").addEventListener("change", queueNodeSave);
  $("#nodeNote").addEventListener("input", queueNodeSave);
  $$(".color-picker button").forEach(button => button.addEventListener("click", () => {
    const node = state.project?.nodes.find(item => item.id === state.selectedNodeId); if (!node) return;
    node.color = button.dataset.color; queueNodeSave(); openInspector(node.id);
  }));
  $("#jumpChapterButton").addEventListener("click", () => {
    const node = state.project?.nodes.find(item => item.id === state.selectedNodeId); if (node?.chapter_id) selectChapter(node.chapter_id);
  });
  $("#deleteNodeButton").addEventListener("click", deleteSelectedNode);
  $(".inspector-heading button").addEventListener("click", () => $(".inspector").classList.add("hidden"));
  bindNodeInteractions();
  window.addEventListener("resize", () => requestAnimationFrame(renderEdges));
  $$(".mobile-nav button").forEach(button => button.addEventListener("click", () => mobileNavigate(button.dataset.mobile)));
}

async function testConnection() {
  const url = normalizedServerUrl($("#serverUrl").value);
  const result = $("#connectionResult");
  result.textContent = "正在测试…"; result.className = "connection-result";
  try {
    const response = await fetch(`${url}/api/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result.textContent = "连接成功，服务器工作正常"; result.className = "connection-result ok";
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

async function deleteSelectedNode() {
  const node = state.project?.nodes.find(item => item.id === state.selectedNodeId); if (!node) return;
  if (!confirm(`删除节点“${node.label}”？相关连线也会删除。`)) return;
  try {
    await api(`/api/nodes/${node.id}`, { method: "DELETE" });
    state.project.nodes = state.project.nodes.filter(item => item.id !== node.id);
    state.project.edges = state.project.edges.filter(edge => edge.source_id !== node.id && edge.target_id !== node.id);
    state.selectedNodeId = null; $(".inspector").classList.add("hidden"); renderMap(); toast("节点已删除");
  } catch (error) { toast(error.message); }
}

function mobileNavigate(target) {
  $$(".mobile-nav button").forEach(button => button.classList.toggle("active", button.dataset.mobile === target));
  $(".chapter-panel").classList.remove("mobile-active");
  $$(".view-panel").forEach(panel => panel.classList.remove("mobile-active"));
  if (target === "chapters") $(".chapter-panel").classList.add("mobile-active");
  else if (target === "map") { $("#mapView").classList.add("active", "mobile-active"); requestAnimationFrame(renderMap); }
  else if (target === "settings") $("#settingsDialog").showModal();
  else $("#writeView").classList.add("active", "mobile-active");
}

boot();

