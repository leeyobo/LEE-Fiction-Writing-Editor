import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


DATABASE_PATH = Path(os.getenv("LEE_DATABASE_PATH", "./data/lee.db"))
API_KEY = os.getenv("LEE_API_KEY", "").strip()
CORS_ORIGINS = [item.strip() for item in os.getenv("LEE_CORS_ORIGINS", "*").split(",") if item.strip()]

DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def db():
    connection = sqlite3.connect(str(DATABASE_PATH), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                node_type TEXT NOT NULL DEFAULT 'plot',
                shape TEXT NOT NULL DEFAULT 'rounded',
                color TEXT NOT NULL DEFAULT 'blue',
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                label TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(project_id, source_id, target_id)
            );

            CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, position);
            CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
            CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
            """
        )


async def authorize(authorization: Optional[str] = Header(default=None)) -> None:
    if not API_KEY:
        return None
    expected = f"Bearer {API_KEY}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key 无效或缺失",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return None


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)


class ChapterCreate(BaseModel):
    title: str = Field(default="新章节", min_length=1, max_length=120)


class ChapterUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    content: Optional[str] = None
    position: Optional[int] = Field(default=None, ge=0)


NodeType = Literal["plot", "character", "place", "conflict", "note"]
NodeShape = Literal["rounded", "rectangle", "diamond", "pill", "note"]


class NodeCreate(BaseModel):
    label: str = Field(default="新节点", min_length=1, max_length=120)
    note: str = Field(default="", max_length=5000)
    node_type: NodeType = "plot"
    shape: NodeShape = "rounded"
    color: str = Field(default="blue", pattern="^(blue|violet|amber|green|rose|slate)$")
    x: float = 0
    y: float = 0
    chapter_id: Optional[str] = None


class NodeUpdate(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=5000)
    node_type: Optional[NodeType] = None
    shape: Optional[NodeShape] = None
    color: Optional[str] = Field(default=None, pattern="^(blue|violet|amber|green|rose|slate)$")
    x: Optional[float] = None
    y: Optional[float] = None
    chapter_id: Optional[str] = None


class EdgeCreate(BaseModel):
    source_id: str
    target_id: str
    label: str = Field(default="", max_length=80)


app = FastAPI(
    title="墨图小说编辑器 API",
    description="章节、故事地图节点和关系的自托管 API",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {"ok": True, "service": "lee-fiction-api", "version": "0.1.0"}


@app.get("/api/projects", dependencies=[Depends(authorize)])
def list_projects():
    with db() as connection:
        rows = connection.execute(
            "SELECT id, title, description, created_at, updated_at FROM projects ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/projects", status_code=201, dependencies=[Depends(authorize)])
def create_project(payload: ProjectCreate):
    project_id = new_id("project")
    chapter_id = new_id("chapter")
    timestamp = now()
    with db() as connection:
        connection.execute(
            "INSERT INTO projects(id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (project_id, payload.title, payload.description, timestamp, timestamp),
        )
        connection.execute(
            "INSERT INTO chapters(id, project_id, title, content, position, created_at, updated_at) VALUES (?, ?, ?, '', 0, ?, ?)",
            (chapter_id, project_id, "第一章", timestamp, timestamp),
        )
    return get_project(project_id)


@app.get("/api/projects/{project_id}", dependencies=[Depends(authorize)])
def get_project(project_id: str):
    with db() as connection:
        project = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        chapters = connection.execute(
            "SELECT * FROM chapters WHERE project_id = ? ORDER BY position, created_at", (project_id,)
        ).fetchall()
        nodes = connection.execute("SELECT * FROM nodes WHERE project_id = ?", (project_id,)).fetchall()
        edges = connection.execute("SELECT * FROM edges WHERE project_id = ?", (project_id,)).fetchall()
    return {
        **dict(project),
        "chapters": [dict(row) for row in chapters],
        "nodes": [dict(row) for row in nodes],
        "edges": [dict(row) for row in edges],
    }


@app.post("/api/projects/{project_id}/chapters", status_code=201, dependencies=[Depends(authorize)])
def create_chapter(project_id: str, payload: ChapterCreate):
    chapter_id = new_id("chapter")
    timestamp = now()
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM chapters WHERE project_id = ?", (project_id,)
        ).fetchone()["position"]
        connection.execute(
            "INSERT INTO chapters(id, project_id, title, content, position, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?)",
            (chapter_id, project_id, payload.title, position, timestamp, timestamp),
        )
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        row = connection.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    return dict(row)


@app.patch("/api/chapters/{chapter_id}", dependencies=[Depends(authorize)])
def update_chapter(chapter_id: str, payload: ChapterUpdate):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    changes["updated_at"] = now()
    with db() as connection:
        chapter = connection.execute("SELECT project_id FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
        if not chapter:
            raise HTTPException(status_code=404, detail="章节不存在")
        assignments = ", ".join(f"{column} = ?" for column in changes)
        connection.execute(f"UPDATE chapters SET {assignments} WHERE id = ?", (*changes.values(), chapter_id))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (changes["updated_at"], chapter["project_id"]))
        row = connection.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    return dict(row)


@app.delete("/api/chapters/{chapter_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_chapter(chapter_id: str):
    with db() as connection:
        chapter = connection.execute("SELECT project_id FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
        if not chapter:
            raise HTTPException(status_code=404, detail="章节不存在")
        count = connection.execute(
            "SELECT COUNT(*) AS count FROM chapters WHERE project_id = ?", (chapter["project_id"],)
        ).fetchone()["count"]
        if count <= 1:
            raise HTTPException(status_code=409, detail="作品至少需要保留一个章节")
        connection.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
    return Response(status_code=204)


@app.post("/api/projects/{project_id}/nodes", status_code=201, dependencies=[Depends(authorize)])
def create_node(project_id: str, payload: NodeCreate):
    node_id = new_id("node")
    timestamp = now()
    values = payload.model_dump()
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        if values["chapter_id"]:
            linked = connection.execute(
                "SELECT id FROM chapters WHERE id = ? AND project_id = ?", (values["chapter_id"], project_id)
            ).fetchone()
            if not linked:
                raise HTTPException(status_code=400, detail="链接的章节不属于当前作品")
        connection.execute(
            """INSERT INTO nodes(id, project_id, label, note, node_type, shape, color, x, y, chapter_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (node_id, project_id, values["label"], values["note"], values["node_type"], values["shape"],
             values["color"], values["x"], values["y"], values["chapter_id"], timestamp, timestamp),
        )
        row = connection.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
    return dict(row)


@app.patch("/api/nodes/{node_id}", dependencies=[Depends(authorize)])
def update_node(node_id: str, payload: NodeUpdate):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    changes["updated_at"] = now()
    with db() as connection:
        node = connection.execute("SELECT project_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="节点不存在")
        chapter_id = changes.get("chapter_id")
        if chapter_id:
            linked = connection.execute(
                "SELECT id FROM chapters WHERE id = ? AND project_id = ?", (chapter_id, node["project_id"])
            ).fetchone()
            if not linked:
                raise HTTPException(status_code=400, detail="链接的章节不属于当前作品")
        assignments = ", ".join(f"{column} = ?" for column in changes)
        connection.execute(f"UPDATE nodes SET {assignments} WHERE id = ?", (*changes.values(), node_id))
        row = connection.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
    return dict(row)


@app.delete("/api/nodes/{node_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_node(node_id: str):
    with db() as connection:
        result = connection.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="节点不存在")
    return Response(status_code=204)


@app.post("/api/projects/{project_id}/edges", status_code=201, dependencies=[Depends(authorize)])
def create_edge(project_id: str, payload: EdgeCreate):
    if payload.source_id == payload.target_id:
        raise HTTPException(status_code=400, detail="不能连接节点自身")
    edge_id = new_id("edge")
    timestamp = now()
    with db() as connection:
        node_count = connection.execute(
            "SELECT COUNT(*) AS count FROM nodes WHERE project_id = ? AND id IN (?, ?)",
            (project_id, payload.source_id, payload.target_id),
        ).fetchone()["count"]
        if node_count != 2:
            raise HTTPException(status_code=400, detail="连线节点不属于当前作品")
        try:
            connection.execute(
                "INSERT INTO edges(id, project_id, source_id, target_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (edge_id, project_id, payload.source_id, payload.target_id, payload.label, timestamp),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="这两个节点已经连接")
        row = connection.execute("SELECT * FROM edges WHERE id = ?", (edge_id,)).fetchone()
    return dict(row)


@app.delete("/api/edges/{edge_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_edge(edge_id: str):
    with db() as connection:
        result = connection.execute("DELETE FROM edges WHERE id = ?", (edge_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="连线不存在")
    return Response(status_code=204)

