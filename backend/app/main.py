import io
import json
import os
import re
import secrets
import sqlite3
import zipfile
import zlib
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
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


def serialize_node(row: sqlite3.Row) -> dict:
    data = dict(row)
    data.pop("scene_id", None)
    return data


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

            CREATE TABLE IF NOT EXISTS story_maps (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS volumes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scenes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                map_id TEXT NOT NULL REFERENCES story_maps(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                node_type TEXT NOT NULL DEFAULT 'plot',
                shape TEXT NOT NULL DEFAULT 'rounded',
                color TEXT NOT NULL DEFAULT 'blue',
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
                scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                map_id TEXT NOT NULL REFERENCES story_maps(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                label TEXT NOT NULL DEFAULT '',
                chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
                line_style TEXT NOT NULL DEFAULT 'solid',
                color TEXT NOT NULL DEFAULT 'blue',
                source_port TEXT NOT NULL DEFAULT 'right',
                target_port TEXT NOT NULL DEFAULT 'left',
                created_at TEXT NOT NULL,
                UNIQUE(project_id, source_id, target_id)
            );

            CREATE TABLE IF NOT EXISTS node_notes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                locked INTEGER NOT NULL DEFAULT 0,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, position);
            CREATE INDEX IF NOT EXISTS idx_volumes_project ON volumes(project_id, position);
            CREATE INDEX IF NOT EXISTS idx_story_maps_project ON story_maps(project_id, position);
            CREATE INDEX IF NOT EXISTS idx_scenes_chapter ON scenes(chapter_id, position);
            CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
            CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
            CREATE INDEX IF NOT EXISTS idx_node_notes_node ON node_notes(node_id, position);
            """
        )
        chapter_columns = {row["name"] for row in connection.execute("PRAGMA table_info(chapters)").fetchall()}
        if "volume_id" not in chapter_columns:
            connection.execute("ALTER TABLE chapters ADD COLUMN volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_chapters_volume ON chapters(volume_id, position)")
        node_columns = {row["name"] for row in connection.execute("PRAGMA table_info(nodes)").fetchall()}
        if "map_id" not in node_columns:
            connection.execute("ALTER TABLE nodes ADD COLUMN map_id TEXT REFERENCES story_maps(id) ON DELETE CASCADE")
        if "scene_id" not in node_columns:
            connection.execute("ALTER TABLE nodes ADD COLUMN scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_nodes_scene ON nodes(scene_id)")
        edge_columns = {row["name"] for row in connection.execute("PRAGMA table_info(edges)").fetchall()}
        edge_migrations = {
            "map_id": "ALTER TABLE edges ADD COLUMN map_id TEXT REFERENCES story_maps(id) ON DELETE CASCADE",
            "chapter_id": "ALTER TABLE edges ADD COLUMN chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL",
            "line_style": "ALTER TABLE edges ADD COLUMN line_style TEXT NOT NULL DEFAULT 'solid'",
            "color": "ALTER TABLE edges ADD COLUMN color TEXT NOT NULL DEFAULT 'blue'",
            "source_port": "ALTER TABLE edges ADD COLUMN source_port TEXT NOT NULL DEFAULT 'right'",
            "target_port": "ALTER TABLE edges ADD COLUMN target_port TEXT NOT NULL DEFAULT 'left'",
        }
        for column, statement in edge_migrations.items():
            if column not in edge_columns:
                connection.execute(statement)
        project_rows = connection.execute("SELECT id, created_at, updated_at FROM projects").fetchall()
        for project in project_rows:
            story_map = connection.execute(
                "SELECT id FROM story_maps WHERE project_id = ? ORDER BY position, created_at LIMIT 1",
                (project["id"],),
            ).fetchone()
            if not story_map:
                map_id = new_id("map")
                connection.execute(
                    """INSERT INTO story_maps(id, project_id, title, position, created_at, updated_at)
                       VALUES (?, ?, '主故事线', 0, ?, ?)""",
                    (map_id, project["id"], project["created_at"], project["updated_at"]),
                )
            else:
                map_id = story_map["id"]
            connection.execute(
                "UPDATE nodes SET map_id = ? WHERE project_id = ? AND map_id IS NULL",
                (map_id, project["id"]),
            )
            connection.execute(
                """UPDATE edges SET map_id = COALESCE(
                       (SELECT n.map_id FROM nodes n WHERE n.id = edges.source_id), ?
                   ) WHERE project_id = ? AND map_id IS NULL""",
                (map_id, project["id"]),
            )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_nodes_map ON nodes(map_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_edges_map ON edges(map_id)")
        scene_projects = connection.execute(
            "SELECT DISTINCT project_id FROM scenes ORDER BY project_id"
        ).fetchall()
        for project_row in scene_projects:
            project_id = project_row["project_id"]
            original_chapters = connection.execute(
                "SELECT * FROM chapters WHERE project_id = ? ORDER BY position, created_at", (project_id,)
            ).fetchall()
            next_position = 0
            for chapter in original_chapters:
                connection.execute(
                    "UPDATE chapters SET position = ? WHERE id = ?", (next_position, chapter["id"])
                )
                next_position += 1
                scenes = connection.execute(
                    "SELECT * FROM scenes WHERE chapter_id = ? ORDER BY position, created_at", (chapter["id"],)
                ).fetchall()
                for scene in scenes:
                    promoted_id = new_id("chapter")
                    connection.execute(
                        """INSERT INTO chapters(id, project_id, title, content, position, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            promoted_id, project_id, scene["title"], scene["content"], next_position,
                            scene["created_at"], scene["updated_at"],
                        ),
                    )
                    connection.execute(
                        "UPDATE nodes SET chapter_id = ?, scene_id = NULL, updated_at = ? WHERE scene_id = ?",
                        (promoted_id, now(), scene["id"]),
                    )
                    next_position += 1
            connection.execute("DELETE FROM scenes WHERE project_id = ?", (project_id,))
            connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now(), project_id))
        volume_projects = connection.execute("SELECT id, created_at, updated_at FROM projects").fetchall()
        for project in volume_projects:
            volume = connection.execute(
                "SELECT id FROM volumes WHERE project_id = ? ORDER BY position, created_at LIMIT 1",
                (project["id"],),
            ).fetchone()
            if not volume:
                volume_id = new_id("volume")
                connection.execute(
                    """INSERT INTO volumes(id, project_id, title, position, created_at, updated_at)
                       VALUES (?, ?, '第一卷', 0, ?, ?)""",
                    (volume_id, project["id"], project["created_at"], project["updated_at"]),
                )
            else:
                volume_id = volume["id"]
            connection.execute(
                "UPDATE chapters SET volume_id = ? WHERE project_id = ? AND volume_id IS NULL",
                (volume_id, project["id"]),
            )
        connection.execute(
            """INSERT INTO node_notes(id, project_id, node_id, content, locked, position, created_at, updated_at)
               SELECT 'note_' || lower(hex(randomblob(16))), n.project_id, n.id, n.note, 0, 0, n.updated_at, n.updated_at
               FROM nodes n
               WHERE trim(n.note) <> '' AND NOT EXISTS (SELECT 1 FROM node_notes nn WHERE nn.node_id = n.id)"""
        )
        connection.execute("UPDATE nodes SET note = '' WHERE trim(note) <> ''")


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


class StoryMapCreate(BaseModel):
    title: str = Field(default="新故事地图", min_length=1, max_length=120)


class StoryMapUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    position: Optional[int] = Field(default=None, ge=0)


class VolumeCreate(BaseModel):
    title: str = Field(default="新卷", min_length=1, max_length=120)


class ChapterCreate(BaseModel):
    title: str = Field(default="新章节", min_length=1, max_length=120)
    volume_id: Optional[str] = None


class TextChapterImportItem(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(default="", max_length=2_000_000)


class TextChapterImport(BaseModel):
    volume_id: str = Field(min_length=1)
    files: List[TextChapterImportItem] = Field(min_length=1, max_length=50)


class MarkdownChapterImportItem(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(default="", max_length=2_000_000)
    target_chapter_id: Optional[str] = None


class MarkdownChapterImport(BaseModel):
    volume_id: Optional[str] = None
    mode: Literal["new", "replace"] = "new"
    files: List[MarkdownChapterImportItem] = Field(min_length=1, max_length=50)


class MarkdownChapterExportItem(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    volume_title: str = Field(default="未分类", max_length=120)
    content: str = Field(default="", max_length=50_000_000)


class MarkdownChapterExport(BaseModel):
    files: List[MarkdownChapterExportItem] = Field(min_length=1, max_length=1000)


class StoryMapPackageExport(BaseModel):
    map_ids: List[str] = Field(min_length=1, max_length=100)


class ChapterUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    content: Optional[str] = None
    position: Optional[int] = Field(default=None, ge=0)
    volume_id: Optional[str] = None


class ChapterBulkDelete(BaseModel):
    chapter_ids: List[str] = Field(min_length=1)


NodeType = Literal["plot", "character", "place", "conflict", "note"]
NodeShape = Literal[
    "rounded", "rectangle", "diamond", "circle", "pill", "note",
    "ellipse", "parallelogram", "hexagon", "document", "cylinder",
]


class NodeNoteCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)
    locked: bool = False


class NodeNoteUpdate(BaseModel):
    content: Optional[str] = Field(default=None, min_length=1, max_length=5000)
    locked: Optional[bool] = None
    position: Optional[int] = Field(default=None, ge=0)


class NodeCreate(BaseModel):
    label: str = Field(default="新节点", min_length=1, max_length=120)
    note: str = Field(default="", max_length=5000)
    node_type: NodeType = "plot"
    shape: NodeShape = "rounded"
    color: str = Field(default="blue", pattern="^(blue|violet|amber|green|rose|slate)$")
    x: float = 0
    y: float = 0
    chapter_id: Optional[str] = None
    map_id: Optional[str] = None


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
    label: str = Field(default="", max_length=5000)
    chapter_id: Optional[str] = None
    line_style: Literal["solid", "dashed", "dotted"] = "solid"
    color: str = Field(default="blue", pattern="^(blue|violet|amber|green|rose|slate)$")
    source_port: Literal[
        "top", "right", "bottom", "left", "top_left", "top_right", "bottom_right", "bottom_left"
    ] = "right"
    target_port: Literal[
        "top", "right", "bottom", "left", "top_left", "top_right", "bottom_right", "bottom_left"
    ] = "left"


class EdgeUpdate(BaseModel):
    label: Optional[str] = Field(default=None, max_length=5000)
    chapter_id: Optional[str] = None
    line_style: Optional[Literal["solid", "dashed", "dotted"]] = None
    color: Optional[str] = Field(default=None, pattern="^(blue|violet|amber|green|rose|slate)$")


class MapChapterReference(BaseModel):
    id: Optional[str] = None
    title: str = Field(min_length=1, max_length=120)
    volume_title: Optional[str] = Field(default=None, max_length=120)


class StoryMapPackageNode(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=5000)
    node_type: NodeType = "plot"
    shape: NodeShape = "rounded"
    color: str = Field(default="blue", pattern="^(blue|violet|amber|green|rose|slate)$")
    x: float = Field(default=0, allow_inf_nan=False)
    y: float = Field(default=0, allow_inf_nan=False)
    chapter: Optional[MapChapterReference] = None
    notes: List[NodeNoteCreate] = Field(default_factory=list, max_length=100)


class StoryMapPackageEdge(BaseModel):
    source_key: str = Field(min_length=1, max_length=120)
    target_key: str = Field(min_length=1, max_length=120)
    label: str = Field(default="", max_length=5000)
    chapter: Optional[MapChapterReference] = None
    line_style: Literal["solid", "dashed", "dotted"] = "solid"
    color: str = Field(default="blue", pattern="^(blue|violet|amber|green|rose|slate)$")
    source_port: Literal[
        "top", "right", "bottom", "left", "top_left", "top_right", "bottom_right", "bottom_left"
    ] = "right"
    target_port: Literal[
        "top", "right", "bottom", "left", "top_left", "top_right", "bottom_right", "bottom_left"
    ] = "left"


class StoryMapPackage(BaseModel):
    format: Literal["lee-story-map"] = "lee-story-map"
    version: int = Field(default=1, ge=1, le=1)
    title: str = Field(min_length=1, max_length=120)
    nodes: List[StoryMapPackageNode] = Field(default_factory=list, max_length=5000)
    edges: List[StoryMapPackageEdge] = Field(default_factory=list, max_length=10000)


class ProjectPackageVolume(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=120)
    position: int = Field(ge=0)


class ProjectPackageChapter(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    volume_key: Optional[str] = None
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(default="", max_length=50_000_000)
    position: int = Field(ge=0)


class ProjectPackageMap(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=120)
    position: int = Field(ge=0)


class ProjectPackageNode(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    map_key: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=5000)
    node_type: NodeType = "plot"
    shape: NodeShape = "rounded"
    color: str = Field(default="blue", pattern="^(blue|violet|amber|green|rose|slate)$")
    x: float = Field(default=0, allow_inf_nan=False)
    y: float = Field(default=0, allow_inf_nan=False)
    chapter_key: Optional[str] = None


class ProjectPackageEdge(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    map_key: str = Field(min_length=1, max_length=120)
    source_key: str = Field(min_length=1, max_length=120)
    target_key: str = Field(min_length=1, max_length=120)
    label: str = Field(default="", max_length=5000)
    chapter_key: Optional[str] = None
    line_style: Literal["solid", "dashed", "dotted"] = "solid"
    color: str = Field(default="blue", pattern="^(blue|violet|amber|green|rose|slate)$")
    source_port: Literal[
        "top", "right", "bottom", "left", "top_left", "top_right", "bottom_right", "bottom_left"
    ] = "right"
    target_port: Literal[
        "top", "right", "bottom", "left", "top_left", "top_right", "bottom_right", "bottom_left"
    ] = "left"


class ProjectPackageNote(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    node_key: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=5000)
    locked: bool = False
    position: int = Field(ge=0)


class ProjectPackage(BaseModel):
    format: Literal["lee-project"] = "lee-project"
    version: int = Field(default=1, ge=1, le=1)
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    volumes: List[ProjectPackageVolume] = Field(min_length=1, max_length=500)
    chapters: List[ProjectPackageChapter] = Field(default_factory=list, max_length=10000)
    maps: List[ProjectPackageMap] = Field(min_length=1, max_length=100)
    nodes: List[ProjectPackageNode] = Field(default_factory=list, max_length=50000)
    edges: List[ProjectPackageEdge] = Field(default_factory=list, max_length=100000)
    notes: List[ProjectPackageNote] = Field(default_factory=list, max_length=100000)


app = FastAPI(
    title="leeroboer Writing Studio API",
    description="章节、故事地图节点和关系的自托管 API",
    version="0.16.0",
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
    return {"ok": True, "service": "lee-fiction-api", "version": "0.16.0"}


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
    map_id = new_id("map")
    volume_id = new_id("volume")
    timestamp = now()
    with db() as connection:
        connection.execute(
            "INSERT INTO projects(id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (project_id, payload.title, payload.description, timestamp, timestamp),
        )
        connection.execute(
            """INSERT INTO story_maps(id, project_id, title, position, created_at, updated_at)
               VALUES (?, ?, '主故事线', 0, ?, ?)""",
            (map_id, project_id, timestamp, timestamp),
        )
        connection.execute(
            """INSERT INTO volumes(id, project_id, title, position, created_at, updated_at)
               VALUES (?, ?, '第一卷', 0, ?, ?)""",
            (volume_id, project_id, timestamp, timestamp),
        )
        connection.execute(
            "INSERT INTO chapters(id, project_id, volume_id, title, content, position, created_at, updated_at) VALUES (?, ?, ?, ?, '', 0, ?, ?)",
            (chapter_id, project_id, volume_id, "第一章", timestamp, timestamp),
        )
    return get_project(project_id)


@app.get("/api/projects/{project_id}", dependencies=[Depends(authorize)])
def get_project(project_id: str):
    with db() as connection:
        project = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        chapters = connection.execute(
            """SELECT chapters.* FROM chapters
               LEFT JOIN volumes ON volumes.id = chapters.volume_id
               WHERE chapters.project_id = ?
               ORDER BY volumes.position, chapters.position, chapters.created_at""",
            (project_id,),
        ).fetchall()
        volumes = connection.execute(
            "SELECT * FROM volumes WHERE project_id = ? ORDER BY position, created_at", (project_id,)
        ).fetchall()
        story_maps = connection.execute(
            "SELECT * FROM story_maps WHERE project_id = ? ORDER BY position, created_at", (project_id,)
        ).fetchall()
        nodes = connection.execute("SELECT * FROM nodes WHERE project_id = ?", (project_id,)).fetchall()
        edges = connection.execute("SELECT * FROM edges WHERE project_id = ?", (project_id,)).fetchall()
        notes = connection.execute(
            "SELECT * FROM node_notes WHERE project_id = ? ORDER BY node_id, position, created_at", (project_id,)
        ).fetchall()
    return {
        **dict(project),
        "maps": [dict(row) for row in story_maps],
        "volumes": [dict(row) for row in volumes],
        "chapters": [dict(row) for row in chapters],
        "nodes": [serialize_node(row) for row in nodes],
        "edges": [dict(row) for row in edges],
        "notes": [{**dict(row), "locked": bool(row["locked"])} for row in notes],
    }


@app.get("/api/projects/{project_id}/package", dependencies=[Depends(authorize)])
def export_project_package(project_id: str):
    with db() as connection:
        project = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        volumes = connection.execute(
            "SELECT id, title, position FROM volumes WHERE project_id = ? ORDER BY position, created_at",
            (project_id,),
        ).fetchall()
        chapters = connection.execute(
            "SELECT id, volume_id, title, content, position FROM chapters WHERE project_id = ? ORDER BY position, created_at",
            (project_id,),
        ).fetchall()
        maps = connection.execute(
            "SELECT id, title, position FROM story_maps WHERE project_id = ? ORDER BY position, created_at",
            (project_id,),
        ).fetchall()
        nodes = connection.execute(
            "SELECT * FROM nodes WHERE project_id = ? ORDER BY created_at, id", (project_id,)
        ).fetchall()
        edges = connection.execute(
            "SELECT * FROM edges WHERE project_id = ? ORDER BY created_at, id", (project_id,)
        ).fetchall()
        notes = connection.execute(
            "SELECT * FROM node_notes WHERE project_id = ? ORDER BY node_id, position, created_at", (project_id,)
        ).fetchall()
    package = {
        "format": "lee-project",
        "version": 1,
        "title": project["title"],
        "description": project["description"],
        "volumes": [{"key": row["id"], "title": row["title"], "position": row["position"]} for row in volumes],
        "chapters": [{
            "key": row["id"], "volume_key": row["volume_id"], "title": row["title"],
            "content": row["content"], "position": row["position"],
        } for row in chapters],
        "maps": [{"key": row["id"], "title": row["title"], "position": row["position"]} for row in maps],
        "nodes": [{
            "key": row["id"], "map_key": row["map_id"], "label": row["label"], "note": row["note"],
            "node_type": row["node_type"], "shape": row["shape"], "color": row["color"],
            "x": row["x"], "y": row["y"], "chapter_key": row["chapter_id"],
        } for row in nodes],
        "edges": [{
            "key": row["id"], "map_key": row["map_id"], "source_key": row["source_id"],
            "target_key": row["target_id"], "label": row["label"], "chapter_key": row["chapter_id"],
            "line_style": row["line_style"], "color": row["color"],
            "source_port": row["source_port"], "target_port": row["target_port"],
        } for row in edges],
        "notes": [{
            "key": row["id"], "node_key": row["node_id"], "content": row["content"],
            "locked": bool(row["locked"]), "position": row["position"],
        } for row in notes],
    }
    package_bytes = json.dumps(package, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(package_bytes) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="完整项目包不能超过 100 MB")
    return Response(content=package_bytes, media_type="application/json")


@app.post("/api/projects/import", status_code=201, dependencies=[Depends(authorize)])
def import_project_package(payload: ProjectPackage):
    total_text_size = sum(len(chapter.content) for chapter in payload.chapters)
    total_text_size += sum(len(note.content) for note in payload.notes)
    if total_text_size > 100_000_000:
        raise HTTPException(status_code=413, detail="完整项目包正文和便签总量不能超过 100 MB")

    def unique_keys(items, label):
        keys = [item.key for item in items]
        if len(set(keys)) != len(keys):
            raise HTTPException(status_code=400, detail=f"项目包中包含重复的{label}标识")
        return set(keys)

    volume_keys = unique_keys(payload.volumes, "故事卷")
    chapter_keys = unique_keys(payload.chapters, "章节")
    map_keys = unique_keys(payload.maps, "故事地图")
    node_keys = unique_keys(payload.nodes, "节点")
    unique_keys(payload.edges, "连线")
    unique_keys(payload.notes, "便签")

    for chapter in payload.chapters:
        if chapter.volume_key is not None and chapter.volume_key not in volume_keys:
            raise HTTPException(status_code=400, detail="项目包章节引用了不存在的故事卷")
    nodes_by_key = {node.key: node for node in payload.nodes}
    for node in payload.nodes:
        if node.map_key not in map_keys:
            raise HTTPException(status_code=400, detail="项目包节点引用了不存在的故事地图")
        if node.chapter_key is not None and node.chapter_key not in chapter_keys:
            raise HTTPException(status_code=400, detail="项目包节点引用了不存在的章节")
    edge_pairs = set()
    for edge in payload.edges:
        if edge.map_key not in map_keys:
            raise HTTPException(status_code=400, detail="项目包连线引用了不存在的故事地图")
        if edge.source_key not in node_keys or edge.target_key not in node_keys:
            raise HTTPException(status_code=400, detail="项目包连线引用了不存在的节点")
        source = nodes_by_key[edge.source_key]
        target = nodes_by_key[edge.target_key]
        if source.map_key != edge.map_key or target.map_key != edge.map_key:
            raise HTTPException(status_code=400, detail="项目包连线不能跨故事地图连接节点")
        if edge.source_key == edge.target_key:
            raise HTTPException(status_code=400, detail="项目包中不能包含连接自身的连线")
        pair = (edge.source_key, edge.target_key)
        if pair in edge_pairs:
            raise HTTPException(status_code=400, detail="项目包中包含重复连线")
        edge_pairs.add(pair)
        if edge.chapter_key is not None and edge.chapter_key not in chapter_keys:
            raise HTTPException(status_code=400, detail="项目包连线引用了不存在的章节")
    for note in payload.notes:
        if note.node_key not in node_keys:
            raise HTTPException(status_code=400, detail="项目包便签引用了不存在的节点")

    project_id = new_id("project")
    volume_ids = {item.key: new_id("volume") for item in payload.volumes}
    chapter_ids = {item.key: new_id("chapter") for item in payload.chapters}
    map_ids = {item.key: new_id("map") for item in payload.maps}
    node_ids = {item.key: new_id("node") for item in payload.nodes}
    edge_ids = {item.key: new_id("edge") for item in payload.edges}
    note_ids = {item.key: new_id("note") for item in payload.notes}
    timestamp = now()

    with db() as connection:
        connection.execute(
            "INSERT INTO projects(id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (project_id, payload.title, payload.description, timestamp, timestamp),
        )
        for volume in payload.volumes:
            connection.execute(
                "INSERT INTO volumes(id, project_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (volume_ids[volume.key], project_id, volume.title, volume.position, timestamp, timestamp),
            )
        for story_map in payload.maps:
            connection.execute(
                "INSERT INTO story_maps(id, project_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (map_ids[story_map.key], project_id, story_map.title, story_map.position, timestamp, timestamp),
            )
        for chapter in payload.chapters:
            connection.execute(
                """INSERT INTO chapters(id, project_id, volume_id, title, content, position, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (chapter_ids[chapter.key], project_id,
                 volume_ids.get(chapter.volume_key) if chapter.volume_key else None,
                 chapter.title, chapter.content, chapter.position, timestamp, timestamp),
            )
        for node in payload.nodes:
            connection.execute(
                """INSERT INTO nodes(id, project_id, map_id, label, note, node_type, shape, color, x, y,
                   chapter_id, scene_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)""",
                (node_ids[node.key], project_id, map_ids[node.map_key], node.label, node.note, node.node_type,
                 node.shape, node.color, node.x, node.y,
                 chapter_ids.get(node.chapter_key) if node.chapter_key else None, timestamp, timestamp),
            )
        for edge in payload.edges:
            connection.execute(
                """INSERT INTO edges(id, project_id, map_id, source_id, target_id, label, chapter_id,
                   line_style, color, source_port, target_port, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (edge_ids[edge.key], project_id, map_ids[edge.map_key], node_ids[edge.source_key],
                 node_ids[edge.target_key], edge.label,
                 chapter_ids.get(edge.chapter_key) if edge.chapter_key else None,
                 edge.line_style, edge.color, edge.source_port, edge.target_port, timestamp),
            )
        for note in payload.notes:
            connection.execute(
                """INSERT INTO node_notes(id, project_id, node_id, content, locked, position, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (note_ids[note.key], project_id, node_ids[note.node_key], note.content,
                 int(note.locked), note.position, timestamp, timestamp),
            )

    return get_project(project_id)


@app.post("/api/projects/{project_id}/maps", status_code=201, dependencies=[Depends(authorize)])
def create_story_map(project_id: str, payload: StoryMapCreate):
    map_id = new_id("map")
    timestamp = now()
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM story_maps WHERE project_id = ?",
            (project_id,),
        ).fetchone()["position"]
        connection.execute(
            """INSERT INTO story_maps(id, project_id, title, position, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (map_id, project_id, payload.title, position, timestamp, timestamp),
        )
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        row = connection.execute("SELECT * FROM story_maps WHERE id = ?", (map_id,)).fetchone()
    return dict(row)


def chapter_reference(connection: sqlite3.Connection, project_id: str, chapter_id: Optional[str]):
    if not chapter_id:
        return None
    row = connection.execute(
        """SELECT chapters.id, chapters.title, volumes.title AS volume_title
           FROM chapters LEFT JOIN volumes ON volumes.id = chapters.volume_id
           WHERE chapters.id = ? AND chapters.project_id = ?""",
        (chapter_id, project_id),
    ).fetchone()
    return dict(row) if row else None


@app.get("/api/projects/{project_id}/maps/{map_id}/package", dependencies=[Depends(authorize)])
def export_story_map_package(project_id: str, map_id: str):
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        return build_story_map_package(connection, project_id, map_id)


def build_story_map_package(connection: sqlite3.Connection, project_id: str, map_id: str):
    story_map = connection.execute(
        "SELECT id, title FROM story_maps WHERE id = ? AND project_id = ?", (map_id, project_id)
    ).fetchone()
    if not story_map:
        raise HTTPException(status_code=404, detail="故事地图不存在或不属于当前作品")
    node_rows = connection.execute(
        "SELECT * FROM nodes WHERE project_id = ? AND map_id = ? ORDER BY created_at, id",
        (project_id, map_id),
    ).fetchall()
    edge_rows = connection.execute(
        "SELECT * FROM edges WHERE project_id = ? AND map_id = ? ORDER BY created_at, id",
        (project_id, map_id),
    ).fetchall()
    note_rows = connection.execute(
        """SELECT node_notes.* FROM node_notes
           JOIN nodes ON nodes.id = node_notes.node_id
           WHERE nodes.project_id = ? AND nodes.map_id = ?
           ORDER BY node_notes.node_id, node_notes.position, node_notes.created_at""",
        (project_id, map_id),
    ).fetchall()
    notes_by_node = {}
    for row in note_rows:
        notes_by_node.setdefault(row["node_id"], []).append({
            "content": row["content"], "locked": bool(row["locked"]),
        })
    nodes = [{
        "key": row["id"], "label": row["label"], "note": row["note"],
        "node_type": row["node_type"], "shape": row["shape"], "color": row["color"],
        "x": row["x"], "y": row["y"],
        "chapter": chapter_reference(connection, project_id, row["chapter_id"]),
        "notes": notes_by_node.get(row["id"], []),
    } for row in node_rows]
    edges = [{
        "source_key": row["source_id"], "target_key": row["target_id"], "label": row["label"],
        "chapter": chapter_reference(connection, project_id, row["chapter_id"]),
        "line_style": row["line_style"], "color": row["color"],
        "source_port": row["source_port"], "target_port": row["target_port"],
    } for row in edge_rows]
    return {
        "format": "lee-story-map", "version": 1, "title": story_map["title"],
        "nodes": nodes, "edges": edges,
    }


@app.post("/api/projects/{project_id}/maps/export-zip", dependencies=[Depends(authorize)])
def export_story_maps_package_zip(project_id: str, payload: StoryMapPackageExport):
    if len(set(payload.map_ids)) != len(payload.map_ids):
        raise HTTPException(status_code=400, detail="导出列表中包含重复故事地图")
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        archive_buffer = io.BytesIO()
        used_names = set()
        with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for map_id in payload.map_ids:
                package = build_story_map_package(connection, project_id, map_id)
                base_name = safe_archive_component(package["title"])
                filename = f"{base_name}.leemap"
                suffix = 2
                while filename.casefold() in used_names:
                    filename = f"{base_name} ({suffix}).leemap"
                    suffix += 1
                used_names.add(filename.casefold())
                archive.writestr(
                    filename,
                    f"{json.dumps(package, ensure_ascii=False, indent=2)}\n",
                )
    return Response(content=archive_buffer.getvalue(), media_type="application/zip")


@app.post("/api/projects/{project_id}/maps/import", status_code=201, dependencies=[Depends(authorize)])
def import_story_map_package(project_id: str, payload: StoryMapPackage):
    if sum(len(node.notes) for node in payload.nodes) > 10_000:
        raise HTTPException(status_code=413, detail="故事地图数据包中的便签总数不能超过 10000 条")
    node_keys = [node.key for node in payload.nodes]
    if len(set(node_keys)) != len(node_keys):
        raise HTTPException(status_code=400, detail="地图数据包中包含重复节点标识")
    node_key_set = set(node_keys)
    edge_pairs = set()
    for edge in payload.edges:
        if edge.source_key not in node_key_set or edge.target_key not in node_key_set:
            raise HTTPException(status_code=400, detail="地图连线引用了不存在的节点")
        if edge.source_key == edge.target_key:
            raise HTTPException(status_code=400, detail="地图数据包中不能包含连接自身的连线")
        edge_pair = (edge.source_key, edge.target_key)
        if edge_pair in edge_pairs:
            raise HTTPException(status_code=400, detail="地图数据包中包含重复连线")
        edge_pairs.add(edge_pair)

    timestamp = now()
    map_id = new_id("map")
    node_ids = {node.key: new_id("node") for node in payload.nodes}
    imported_nodes = []
    imported_edges = []
    imported_notes = []
    resolved_links = 0
    unresolved_links = 0

    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        map_position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM story_maps WHERE project_id = ?",
            (project_id,),
        ).fetchone()["position"]
        connection.execute(
            "INSERT INTO story_maps(id, project_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (map_id, project_id, payload.title, map_position, timestamp, timestamp),
        )

        def resolve_chapter(reference):
            nonlocal resolved_links, unresolved_links
            if not reference:
                return None
            chapter = None
            if reference.id:
                chapter = connection.execute(
                    "SELECT id FROM chapters WHERE id = ? AND project_id = ?", (reference.id, project_id)
                ).fetchone()
            if not chapter:
                query = """SELECT chapters.id FROM chapters
                           LEFT JOIN volumes ON volumes.id = chapters.volume_id
                           WHERE chapters.project_id = ? AND chapters.title = ?"""
                params = [project_id, reference.title]
                if reference.volume_title is not None:
                    query += " AND COALESCE(volumes.title, '') = ?"
                    params.append(reference.volume_title)
                query += " ORDER BY volumes.position, chapters.position, chapters.created_at LIMIT 1"
                chapter = connection.execute(query, params).fetchone()
            if chapter:
                resolved_links += 1
                return chapter["id"]
            unresolved_links += 1
            return None

        for position, node in enumerate(payload.nodes):
            node_id = node_ids[node.key]
            connection.execute(
                """INSERT INTO nodes(id, project_id, map_id, label, note, node_type, shape, color, x, y,
                   chapter_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (node_id, project_id, map_id, node.label, node.note, node.node_type, node.shape,
                 node.color, node.x, node.y, resolve_chapter(node.chapter), timestamp, timestamp),
            )
            row = connection.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
            imported_nodes.append(serialize_node(row))
            for note_position, note in enumerate(node.notes):
                note_id = new_id("note")
                connection.execute(
                    """INSERT INTO node_notes(id, project_id, node_id, content, locked, position, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (note_id, project_id, node_id, note.content, int(note.locked), note_position, timestamp, timestamp),
                )
                note_row = connection.execute("SELECT * FROM node_notes WHERE id = ?", (note_id,)).fetchone()
                imported_notes.append({**dict(note_row), "locked": bool(note_row["locked"])})

        for edge in payload.edges:
            edge_id = new_id("edge")
            connection.execute(
                """INSERT INTO edges(id, project_id, map_id, source_id, target_id, label, chapter_id,
                   line_style, color, source_port, target_port, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (edge_id, project_id, map_id, node_ids[edge.source_key], node_ids[edge.target_key],
                 edge.label, resolve_chapter(edge.chapter), edge.line_style, edge.color,
                 edge.source_port, edge.target_port, timestamp),
            )
            imported_edges.append(dict(connection.execute("SELECT * FROM edges WHERE id = ?", (edge_id,)).fetchone()))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        imported_map = dict(connection.execute("SELECT * FROM story_maps WHERE id = ?", (map_id,)).fetchone())

    return {
        "map": imported_map,
        "nodes": imported_nodes,
        "edges": imported_edges,
        "notes": imported_notes,
        "chapter_links": {"resolved": resolved_links, "unresolved": unresolved_links},
    }


@app.post("/api/projects/{project_id}/maps/{map_id}/import", dependencies=[Depends(authorize)])
def replace_story_map_with_package(project_id: str, map_id: str, payload: StoryMapPackage):
    if sum(len(node.notes) for node in payload.nodes) > 10_000:
        raise HTTPException(status_code=413, detail="故事地图数据包中的便签总数不能超过 10000 条")
    node_keys = [node.key for node in payload.nodes]
    if len(set(node_keys)) != len(node_keys):
        raise HTTPException(status_code=400, detail="地图数据包中包含重复节点标识")
    node_key_set = set(node_keys)
    edge_pairs = set()
    for edge in payload.edges:
        if edge.source_key not in node_key_set or edge.target_key not in node_key_set:
            raise HTTPException(status_code=400, detail="地图连线引用了不存在的节点")
        if edge.source_key == edge.target_key:
            raise HTTPException(status_code=400, detail="地图数据包中不能包含连接自身的连线")
        edge_pair = (edge.source_key, edge.target_key)
        if edge_pair in edge_pairs:
            raise HTTPException(status_code=400, detail="地图数据包中包含重复连线")
        edge_pairs.add(edge_pair)

    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        target_map = connection.execute(
            "SELECT * FROM story_maps WHERE id = ? AND project_id = ?", (map_id, project_id)
        ).fetchone()
        if not target_map:
            raise HTTPException(status_code=404, detail="目标故事地图不存在或不属于当前作品")

        connection.execute("DELETE FROM nodes WHERE map_id = ?", (map_id,))
        node_ids = {node.key: new_id("node") for node in payload.nodes}
        timestamp = now()
        imported_nodes = []
        imported_edges = []
        imported_notes = []
        resolved_links = 0
        unresolved_links = 0

        def resolve_chapter(reference):
            nonlocal resolved_links, unresolved_links
            if not reference:
                return None
            chapter = None
            if reference.id:
                chapter = connection.execute(
                    "SELECT id FROM chapters WHERE id = ? AND project_id = ?", (reference.id, project_id)
                ).fetchone()
            if not chapter:
                query = """SELECT chapters.id FROM chapters
                           LEFT JOIN volumes ON volumes.id = chapters.volume_id
                           WHERE chapters.project_id = ? AND chapters.title = ?"""
                params = [project_id, reference.title]
                if reference.volume_title is not None:
                    query += " AND COALESCE(volumes.title, '') = ?"
                    params.append(reference.volume_title)
                query += " ORDER BY volumes.position, chapters.position, chapters.created_at LIMIT 1"
                chapter = connection.execute(query, params).fetchone()
            if chapter:
                resolved_links += 1
                return chapter["id"]
            unresolved_links += 1
            return None

        for position, node in enumerate(payload.nodes):
            node_id = node_ids[node.key]
            connection.execute(
                """INSERT INTO nodes(id, project_id, map_id, label, note, node_type, shape, color, x, y,
                   chapter_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (node_id, project_id, map_id, node.label, node.note, node.node_type, node.shape,
                 node.color, node.x, node.y, resolve_chapter(node.chapter), timestamp, timestamp),
            )
            row = connection.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
            imported_nodes.append(serialize_node(row))
            for note_position, note in enumerate(node.notes):
                note_id = new_id("note")
                connection.execute(
                    """INSERT INTO node_notes(id, project_id, node_id, content, locked, position, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (note_id, project_id, node_id, note.content, int(note.locked), note_position, timestamp, timestamp),
                )
                note_row = connection.execute("SELECT * FROM node_notes WHERE id = ?", (note_id,)).fetchone()
                imported_notes.append({**dict(note_row), "locked": bool(note_row["locked"])})

        for edge in payload.edges:
            edge_id = new_id("edge")
            connection.execute(
                """INSERT INTO edges(id, project_id, map_id, source_id, target_id, label, chapter_id,
                   line_style, color, source_port, target_port, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (edge_id, project_id, map_id, node_ids[edge.source_key], node_ids[edge.target_key],
                 edge.label, resolve_chapter(edge.chapter), edge.line_style, edge.color,
                 edge.source_port, edge.target_port, timestamp),
            )
            imported_edges.append(dict(connection.execute("SELECT * FROM edges WHERE id = ?", (edge_id,)).fetchone()))

        connection.execute("UPDATE story_maps SET updated_at = ? WHERE id = ?", (timestamp, map_id))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        updated_map = dict(connection.execute("SELECT * FROM story_maps WHERE id = ?", (map_id,)).fetchone())

    return {
        "map": updated_map,
        "nodes": imported_nodes,
        "edges": imported_edges,
        "notes": imported_notes,
        "chapter_links": {"resolved": resolved_links, "unresolved": unresolved_links},
    }


@app.patch("/api/maps/{map_id}", dependencies=[Depends(authorize)])
def update_story_map(map_id: str, payload: StoryMapUpdate):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    changes["updated_at"] = now()
    with db() as connection:
        story_map = connection.execute("SELECT project_id FROM story_maps WHERE id = ?", (map_id,)).fetchone()
        if not story_map:
            raise HTTPException(status_code=404, detail="故事地图不存在")
        assignments = ", ".join(f"{column} = ?" for column in changes)
        connection.execute(f"UPDATE story_maps SET {assignments} WHERE id = ?", (*changes.values(), map_id))
        connection.execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            (changes["updated_at"], story_map["project_id"]),
        )
        row = connection.execute("SELECT * FROM story_maps WHERE id = ?", (map_id,)).fetchone()
    return dict(row)


@app.delete("/api/maps/{map_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_story_map(map_id: str):
    with db() as connection:
        story_map = connection.execute("SELECT project_id FROM story_maps WHERE id = ?", (map_id,)).fetchone()
        if not story_map:
            raise HTTPException(status_code=404, detail="故事地图不存在")
        count = connection.execute(
            "SELECT COUNT(*) AS count FROM story_maps WHERE project_id = ?", (story_map["project_id"],)
        ).fetchone()["count"]
        if count <= 1:
            raise HTTPException(status_code=409, detail="作品至少需要保留一张故事地图")
        connection.execute("DELETE FROM story_maps WHERE id = ?", (map_id,))
        remaining = connection.execute(
            "SELECT id FROM story_maps WHERE project_id = ? ORDER BY position, created_at",
            (story_map["project_id"],),
        ).fetchall()
        for position, item in enumerate(remaining):
            connection.execute("UPDATE story_maps SET position = ? WHERE id = ?", (position, item["id"]))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now(), story_map["project_id"]))
    return Response(status_code=204)


@app.delete("/api/maps/{map_id}/canvas", dependencies=[Depends(authorize)])
def clear_story_map_canvas(map_id: str):
    with db() as connection:
        story_map = connection.execute("SELECT project_id FROM story_maps WHERE id = ?", (map_id,)).fetchone()
        if not story_map:
            raise HTTPException(status_code=404, detail="故事地图不存在")
        node_count = connection.execute(
            "SELECT COUNT(*) AS count FROM nodes WHERE map_id = ?", (map_id,)
        ).fetchone()["count"]
        edge_count = connection.execute(
            "SELECT COUNT(*) AS count FROM edges WHERE map_id = ?", (map_id,)
        ).fetchone()["count"]
        note_count = connection.execute(
            """SELECT COUNT(*) AS count FROM node_notes
               WHERE node_id IN (SELECT id FROM nodes WHERE map_id = ?)""",
            (map_id,),
        ).fetchone()["count"]
        connection.execute("DELETE FROM nodes WHERE map_id = ?", (map_id,))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now(), story_map["project_id"]))
    return {"nodes": node_count, "edges": edge_count, "notes": note_count}


@app.delete("/api/projects/{project_id}/canvas", dependencies=[Depends(authorize)])
def clear_project_canvas(project_id: str):
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        node_count = connection.execute(
            "SELECT COUNT(*) AS count FROM nodes WHERE project_id = ?", (project_id,)
        ).fetchone()["count"]
        edge_count = connection.execute(
            "SELECT COUNT(*) AS count FROM edges WHERE project_id = ?", (project_id,)
        ).fetchone()["count"]
        note_count = connection.execute(
            "SELECT COUNT(*) AS count FROM node_notes WHERE project_id = ?", (project_id,)
        ).fetchone()["count"]
        connection.execute("DELETE FROM nodes WHERE project_id = ?", (project_id,))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now(), project_id))
    return {"nodes": node_count, "edges": edge_count, "notes": note_count}


@app.post("/api/projects/{project_id}/volumes", status_code=201, dependencies=[Depends(authorize)])
def create_volume(project_id: str, payload: VolumeCreate):
    volume_id = new_id("volume")
    timestamp = now()
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM volumes WHERE project_id = ?",
            (project_id,),
        ).fetchone()["position"]
        connection.execute(
            """INSERT INTO volumes(id, project_id, title, position, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (volume_id, project_id, payload.title, position, timestamp, timestamp),
        )
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        row = connection.execute("SELECT * FROM volumes WHERE id = ?", (volume_id,)).fetchone()
    return dict(row)


@app.delete("/api/volumes/{volume_id}", dependencies=[Depends(authorize)])
def delete_volume(volume_id: str):
    timestamp = now()
    with db() as connection:
        volume = connection.execute(
            "SELECT id, project_id FROM volumes WHERE id = ?", (volume_id,)
        ).fetchone()
        if not volume:
            raise HTTPException(status_code=404, detail="故事卷不存在")
        volumes = connection.execute(
            "SELECT id FROM volumes WHERE project_id = ? ORDER BY position, created_at",
            (volume["project_id"],),
        ).fetchall()
        if len(volumes) <= 1:
            raise HTTPException(status_code=409, detail="作品至少需要保留一个故事卷")
        target_volume_id = next(item["id"] for item in volumes if item["id"] != volume_id)
        chapters = connection.execute(
            "SELECT id FROM chapters WHERE volume_id = ? ORDER BY position, created_at", (volume_id,)
        ).fetchall()
        next_position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM chapters WHERE volume_id = ?",
            (target_volume_id,),
        ).fetchone()["position"]
        for offset, chapter in enumerate(chapters):
            connection.execute(
                "UPDATE chapters SET volume_id = ?, position = ? WHERE id = ?",
                (target_volume_id, next_position + offset, chapter["id"]),
            )
        connection.execute("DELETE FROM volumes WHERE id = ?", (volume_id,))
        remaining_volumes = connection.execute(
            "SELECT id FROM volumes WHERE project_id = ? ORDER BY position, created_at",
            (volume["project_id"],),
        ).fetchall()
        for position, item in enumerate(remaining_volumes):
            connection.execute("UPDATE volumes SET position = ? WHERE id = ?", (position, item["id"]))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, volume["project_id"]))
    return {"deleted_volume_id": volume_id, "moved_chapters": len(chapters), "target_volume_id": target_volume_id}


@app.post("/api/projects/{project_id}/chapters", status_code=201, dependencies=[Depends(authorize)])
def create_chapter(project_id: str, payload: ChapterCreate):
    chapter_id = new_id("chapter")
    timestamp = now()
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        if payload.volume_id:
            volume = connection.execute(
                "SELECT id FROM volumes WHERE id = ? AND project_id = ?", (payload.volume_id, project_id)
            ).fetchone()
        else:
            volume = connection.execute(
                "SELECT id FROM volumes WHERE project_id = ? ORDER BY position, created_at LIMIT 1", (project_id,)
            ).fetchone()
        if not volume:
            raise HTTPException(status_code=400, detail="故事卷不存在或不属于当前作品")
        position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM chapters WHERE volume_id = ?",
            (volume["id"],),
        ).fetchone()["position"]
        connection.execute(
            "INSERT INTO chapters(id, project_id, volume_id, title, content, position, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?, ?)",
            (chapter_id, project_id, volume["id"], payload.title, position, timestamp, timestamp),
        )
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        row = connection.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    return dict(row)


@app.post("/api/projects/{project_id}/chapters/import-text", status_code=201, dependencies=[Depends(authorize)])
def import_text_chapters(project_id: str, payload: TextChapterImport):
    total_characters = sum(len(item.content) for item in payload.files)
    if total_characters > 10_000_000:
        raise HTTPException(status_code=413, detail="TXT 文件总内容过大，请分批导入（总计不超过 1000 万字）")
    timestamp = now()
    imported = []
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        volume = connection.execute(
            "SELECT id FROM volumes WHERE id = ? AND project_id = ?",
            (payload.volume_id, project_id),
        ).fetchone()
        if not volume:
            raise HTTPException(status_code=400, detail="故事卷不存在或不属于当前作品")
        position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM chapters WHERE volume_id = ?",
            (payload.volume_id,),
        ).fetchone()["position"]
        for offset, item in enumerate(payload.files):
            chapter_id = new_id("chapter")
            connection.execute(
                """INSERT INTO chapters(id, project_id, volume_id, title, content, position, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    chapter_id, project_id, payload.volume_id, item.title, item.content,
                    position + offset, timestamp, timestamp,
                ),
            )
            row = connection.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
            imported.append(dict(row))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
    return {"chapters": imported}


def safe_archive_component(value: str) -> str:
    component = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    if not component:
        component = "未命名"
    if re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", component, re.IGNORECASE):
        component = f"_{component}"
    return component[:120]


def read_markdown_archive(archive_bytes: bytes) -> List[dict]:
    if len(archive_bytes) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="ZIP 文件不能超过 12 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            entries = sorted(
                (entry for entry in archive.infolist()
                if not entry.is_dir() and entry.filename.lower().endswith((".md", ".markdown"))),
                key=lambda entry: entry.filename.casefold(),
            )
            if not entries:
                raise HTTPException(status_code=400, detail="ZIP 压缩包中没有 .md 文件")
            if len(entries) > 50:
                raise HTTPException(status_code=413, detail="ZIP 中一次最多导入 50 个 Markdown 文件")
            if any(entry.file_size > 6 * 1024 * 1024 for entry in entries):
                raise HTTPException(status_code=413, detail="ZIP 中单个 Markdown 文件不能超过 6 MB")
            if sum(entry.file_size for entry in entries) > 12 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="ZIP 中 Markdown 文件总大小不能超过 12 MB")
            files = []
            for entry in entries:
                if entry.flag_bits & 0x1:
                    raise HTTPException(status_code=400, detail="ZIP 中的 Markdown 文件不能加密")
                name = entry.filename.replace("\\", "/").rstrip("/").split("/")[-1]
                title = Path(name).stem.strip()[:120] or "未命名章节"
                try:
                    content = archive.read(entry).decode("utf-8-sig")
                except (UnicodeDecodeError, RuntimeError, NotImplementedError, OSError, zlib.error) as error:
                    raise HTTPException(status_code=400, detail=f"无法读取“{name}”：请使用 UTF-8 编码且不要加密") from error
                files.append({"title": title, "content": content, "name": name, "size": entry.file_size})
    except zipfile.BadZipFile as error:
        raise HTTPException(status_code=400, detail="无法读取 ZIP 文件，请确认压缩包有效") from error
    return files


@app.post("/api/projects/{project_id}/chapters/parse-markdown-zip", dependencies=[Depends(authorize)])
async def parse_markdown_zip(project_id: str, request: Request):
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="作品不存在")
    archive_bytes = bytearray()
    async for chunk in request.stream():
        archive_bytes.extend(chunk)
        if len(archive_bytes) > 12 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="ZIP 文件不能超过 12 MB")
    return {"files": read_markdown_archive(bytes(archive_bytes))}


@app.post("/api/projects/{project_id}/chapters/import-markdown", status_code=201, dependencies=[Depends(authorize)])
def import_markdown_chapters(project_id: str, payload: MarkdownChapterImport):
    total_characters = sum(len(item.content) for item in payload.files)
    if total_characters > 10_000_000:
        raise HTTPException(status_code=413, detail="Markdown 文件总内容过大，请分批导入（总计不超过 1000 万字）")
    if payload.mode == "replace":
        target_ids = [item.target_chapter_id for item in payload.files]
        if any(not chapter_id for chapter_id in target_ids) or len(set(target_ids)) != len(target_ids):
            raise HTTPException(status_code=400, detail="替换模式下，每个 Markdown 文件必须指定不同的目标章节")
    timestamp = now()
    imported = []
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        volume = None
        if payload.mode == "new":
            if not payload.volume_id:
                raise HTTPException(status_code=400, detail="新建章节时必须选择故事卷")
            volume = connection.execute(
                "SELECT id FROM volumes WHERE id = ? AND project_id = ?", (payload.volume_id, project_id)
            ).fetchone()
            if not volume:
                raise HTTPException(status_code=400, detail="故事卷不存在或不属于当前作品")
        if payload.mode == "replace":
            targets = []
            for item in payload.files:
                target = connection.execute(
                    "SELECT * FROM chapters WHERE id = ? AND project_id = ?",
                    (item.target_chapter_id, project_id),
                ).fetchone()
                if not target:
                    raise HTTPException(status_code=400, detail="目标章节不存在或不属于当前作品")
                targets.append(target)
            for target, item in zip(targets, payload.files):
                connection.execute(
                    "UPDATE chapters SET content = ?, updated_at = ? WHERE id = ?",
                    (item.content, timestamp, target["id"]),
                )
                row = connection.execute("SELECT * FROM chapters WHERE id = ?", (target["id"],)).fetchone()
                imported.append(dict(row))
        else:
            position = connection.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM chapters WHERE volume_id = ?",
                (payload.volume_id,),
            ).fetchone()["position"]
            for offset, item in enumerate(payload.files):
                chapter_id = new_id("chapter")
                connection.execute(
                    """INSERT INTO chapters(id, project_id, volume_id, title, content, position, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (chapter_id, project_id, payload.volume_id, item.title, item.content,
                     position + offset, timestamp, timestamp),
                )
                row = connection.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
                imported.append(dict(row))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
    return {"chapters": imported, "mode": payload.mode}


@app.post("/api/projects/{project_id}/chapters/export-markdown-zip", dependencies=[Depends(authorize)])
def export_markdown_zip(project_id: str, payload: MarkdownChapterExport):
    total_characters = sum(len(item.content) for item in payload.files)
    if total_characters > 50_000_000:
        raise HTTPException(status_code=413, detail="Markdown ZIP 内容过大，请分批导出")
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="作品不存在")
    archive_buffer = io.BytesIO()
    used_paths = set()
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in payload.files:
            volume = safe_archive_component(item.volume_title)
            title = safe_archive_component(item.title)
            base_path = f"{volume}/{title}"
            path = f"{base_path}.md"
            duplicate = 2
            while path.casefold() in used_paths:
                path = f"{base_path} ({duplicate}).md"
                duplicate += 1
            used_paths.add(path.casefold())
            body = item.content or ""
            archive.writestr(path, f"# {item.title}\n\n{body}" if body else f"# {item.title}\n")
    return Response(content=archive_buffer.getvalue(), media_type="application/zip")


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
        if "volume_id" in changes:
            volume = connection.execute(
                "SELECT id FROM volumes WHERE id = ? AND project_id = ?",
                (changes["volume_id"], chapter["project_id"]),
            ).fetchone()
            if not volume:
                raise HTTPException(status_code=400, detail="故事卷不存在或不属于当前作品")
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


@app.post("/api/projects/{project_id}/chapters/bulk-delete", dependencies=[Depends(authorize)])
def bulk_delete_chapters(project_id: str, payload: ChapterBulkDelete):
    chapter_ids = list(dict.fromkeys(payload.chapter_ids))
    placeholders = ", ".join("?" for _ in chapter_ids)
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        rows = connection.execute(
            f"SELECT id FROM chapters WHERE project_id = ? AND id IN ({placeholders})",
            (project_id, *chapter_ids),
        ).fetchall()
        if len(rows) != len(chapter_ids):
            raise HTTPException(status_code=400, detail="部分章节不存在或不属于当前作品")
        total = connection.execute(
            "SELECT COUNT(*) AS count FROM chapters WHERE project_id = ?", (project_id,)
        ).fetchone()["count"]
        if total - len(chapter_ids) < 1:
            raise HTTPException(status_code=409, detail="作品至少需要保留一个章节")
        connection.execute(
            f"DELETE FROM chapters WHERE project_id = ? AND id IN ({placeholders})",
            (project_id, *chapter_ids),
        )
        volumes = connection.execute(
            "SELECT id FROM volumes WHERE project_id = ? ORDER BY position, created_at", (project_id,)
        ).fetchall()
        for volume in volumes:
            remaining = connection.execute(
                "SELECT id FROM chapters WHERE volume_id = ? ORDER BY position, created_at", (volume["id"],)
            ).fetchall()
            for position, chapter in enumerate(remaining):
                connection.execute("UPDATE chapters SET position = ? WHERE id = ?", (position, chapter["id"]))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now(), project_id))
    return {"chapters": len(chapter_ids)}


@app.post("/api/projects/{project_id}/nodes", status_code=201, dependencies=[Depends(authorize)])
def create_node(project_id: str, payload: NodeCreate):
    node_id = new_id("node")
    timestamp = now()
    values = payload.model_dump()
    with db() as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="作品不存在")
        if values["map_id"]:
            story_map = connection.execute(
                "SELECT id FROM story_maps WHERE id = ? AND project_id = ?", (values["map_id"], project_id)
            ).fetchone()
        else:
            story_map = connection.execute(
                "SELECT id FROM story_maps WHERE project_id = ? ORDER BY position, created_at LIMIT 1", (project_id,)
            ).fetchone()
        if not story_map:
            raise HTTPException(status_code=400, detail="故事地图不存在或不属于当前作品")
        values["map_id"] = story_map["id"]
        if values["chapter_id"]:
            linked = connection.execute(
                "SELECT id FROM chapters WHERE id = ? AND project_id = ?", (values["chapter_id"], project_id)
            ).fetchone()
            if not linked:
                raise HTTPException(status_code=400, detail="链接的章节不属于当前作品")
        connection.execute(
            """INSERT INTO nodes(id, project_id, map_id, label, note, node_type, shape, color, x, y, chapter_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (node_id, project_id, values["map_id"], values["label"], values["note"], values["node_type"], values["shape"],
             values["color"], values["x"], values["y"], values["chapter_id"], timestamp, timestamp),
        )
        row = connection.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
    return serialize_node(row)


@app.patch("/api/nodes/{node_id}", dependencies=[Depends(authorize)])
def update_node(node_id: str, payload: NodeUpdate):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    changes["updated_at"] = now()
    with db() as connection:
        node = connection.execute("SELECT project_id, chapter_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
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
    return serialize_node(row)


@app.delete("/api/nodes/{node_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_node(node_id: str):
    with db() as connection:
        result = connection.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="节点不存在")
    return Response(status_code=204)


@app.post("/api/nodes/{node_id}/notes", status_code=201, dependencies=[Depends(authorize)])
def create_node_note(node_id: str, payload: NodeNoteCreate):
    note_id = new_id("note")
    timestamp = now()
    with db() as connection:
        node = connection.execute("SELECT project_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="节点不存在")
        position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM node_notes WHERE node_id = ?", (node_id,)
        ).fetchone()["position"]
        connection.execute(
            """INSERT INTO node_notes(id, project_id, node_id, content, locked, position, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (note_id, node["project_id"], node_id, payload.content, int(payload.locked), position, timestamp, timestamp),
        )
        row = connection.execute("SELECT * FROM node_notes WHERE id = ?", (note_id,)).fetchone()
    return {**dict(row), "locked": bool(row["locked"])}


@app.patch("/api/notes/{note_id}", dependencies=[Depends(authorize)])
def update_node_note(note_id: str, payload: NodeNoteUpdate):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    if "locked" in changes:
        changes["locked"] = int(changes["locked"])
    changes["updated_at"] = now()
    with db() as connection:
        note = connection.execute("SELECT id FROM node_notes WHERE id = ?", (note_id,)).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="便签不存在")
        assignments = ", ".join(f"{column} = ?" for column in changes)
        connection.execute(f"UPDATE node_notes SET {assignments} WHERE id = ?", (*changes.values(), note_id))
        row = connection.execute("SELECT * FROM node_notes WHERE id = ?", (note_id,)).fetchone()
    return {**dict(row), "locked": bool(row["locked"])}


@app.delete("/api/notes/{note_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_node_note(note_id: str):
    with db() as connection:
        result = connection.execute("DELETE FROM node_notes WHERE id = ?", (note_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="便签不存在")
    return Response(status_code=204)


@app.post("/api/projects/{project_id}/edges", status_code=201, dependencies=[Depends(authorize)])
def create_edge(project_id: str, payload: EdgeCreate):
    if payload.source_id == payload.target_id:
        raise HTTPException(status_code=400, detail="不能连接节点自身")
    edge_id = new_id("edge")
    timestamp = now()
    with db() as connection:
        nodes = connection.execute(
            "SELECT id, map_id FROM nodes WHERE project_id = ? AND id IN (?, ?)",
            (project_id, payload.source_id, payload.target_id),
        ).fetchall()
        if len(nodes) != 2:
            raise HTTPException(status_code=400, detail="连线节点不属于当前作品")
        map_ids = {node["map_id"] for node in nodes}
        if len(map_ids) != 1:
            raise HTTPException(status_code=400, detail="不能连接不同故事地图中的节点")
        map_id = next(iter(map_ids))
        if payload.chapter_id:
            chapter = connection.execute(
                "SELECT id FROM chapters WHERE id = ? AND project_id = ?", (payload.chapter_id, project_id)
            ).fetchone()
            if not chapter:
                raise HTTPException(status_code=400, detail="连线链接的章节不属于当前作品")
        try:
            connection.execute(
                """INSERT INTO edges(
                       id, project_id, map_id, source_id, target_id, label, chapter_id,
                       line_style, color, source_port, target_port, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    edge_id, project_id, map_id, payload.source_id, payload.target_id, payload.label,
                    payload.chapter_id, payload.line_style, payload.color,
                    payload.source_port, payload.target_port, timestamp,
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="这两个节点已经连接")
        row = connection.execute("SELECT * FROM edges WHERE id = ?", (edge_id,)).fetchone()
    return dict(row)


@app.patch("/api/edges/{edge_id}", dependencies=[Depends(authorize)])
def update_edge(edge_id: str, payload: EdgeUpdate):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    with db() as connection:
        edge = connection.execute("SELECT project_id FROM edges WHERE id = ?", (edge_id,)).fetchone()
        if not edge:
            raise HTTPException(status_code=404, detail="连线不存在")
        chapter_id = changes.get("chapter_id")
        if chapter_id:
            chapter = connection.execute(
                "SELECT id FROM chapters WHERE id = ? AND project_id = ?", (chapter_id, edge["project_id"])
            ).fetchone()
            if not chapter:
                raise HTTPException(status_code=400, detail="连线链接的章节不属于当前作品")
        assignments = ", ".join(f"{column} = ?" for column in changes)
        connection.execute(f"UPDATE edges SET {assignments} WHERE id = ?", (*changes.values(), edge_id))
        row = connection.execute("SELECT * FROM edges WHERE id = ?", (edge_id,)).fetchone()
    return dict(row)


@app.delete("/api/edges/{edge_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_edge(edge_id: str):
    with db() as connection:
        result = connection.execute("DELETE FROM edges WHERE id = ?", (edge_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="连线不存在")
    return Response(status_code=204)

