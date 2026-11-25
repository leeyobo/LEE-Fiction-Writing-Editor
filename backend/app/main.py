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


app = FastAPI(
    title="墨图小说编辑器 API",
    description="章节、故事地图节点和关系的自托管 API",
    version="0.10.0",
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
    return {"ok": True, "service": "lee-fiction-api", "version": "0.10.0"}


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

