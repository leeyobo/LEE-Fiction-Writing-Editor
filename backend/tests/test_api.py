import io
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

from app import main


class ApiFlowTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        main.DATABASE_PATH = Path(self.temporary_directory.name) / "test.db"
        main.API_KEY = ""
        main.init_db()
        self.client_context = TestClient(main.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def test_project_chapter_and_map_roundtrip(self):
        project = self.client.post(
            "/api/projects", json={"title": "Test novel", "description": ""}
        ).json()
        chapter = project["chapters"][0]
        response = self.client.patch(
            f"/api/chapters/{chapter['id']}",
            json={"title": "Chapter one", "content": "The story begins in the rain."},
        )
        self.assertEqual(response.status_code, 200)

        first = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={
                "label": "Storm", "node_type": "plot", "shape": "rounded",
                "color": "blue", "x": 80, "y": 90, "chapter_id": chapter["id"],
            },
        ).json()
        second = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={
                "label": "Visitor", "node_type": "character", "shape": "hexagon",
                "color": "violet", "x": 320, "y": 90,
            },
        ).json()
        edge = self.client.post(
            f"/api/projects/{project['id']}/edges",
            json={
                "source_id": first["id"], "target_id": second["id"], "label": "introduces",
                "source_port": "bottom", "target_port": "top_left",
                "line_style": "dashed", "color": "green",
            },
        )
        self.assertEqual(edge.status_code, 201)
        edge_update = self.client.patch(
            f"/api/edges/{edge.json()['id']}",
            json={
                "label": "A conditional transition", "chapter_id": chapter["id"],
                "line_style": "dotted", "color": "rose",
            },
        )
        self.assertEqual(edge_update.status_code, 200)

        first_note = self.client.post(
            f"/api/nodes/{first['id']}/notes",
            json={"content": "Reveal the hidden motive.", "locked": False},
        )
        second_note = self.client.post(
            f"/api/nodes/{first['id']}/notes",
            json={"content": "Keep this clue visible.", "locked": True},
        )
        self.assertEqual(first_note.status_code, 201)
        self.assertEqual(second_note.status_code, 201)
        self.client.patch(f"/api/notes/{first_note.json()['id']}", json={"locked": True})

        final = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertNotIn("scenes", final)
        self.assertEqual(len(final["nodes"]), 2)
        self.assertNotIn("scene_id", final["nodes"][0])
        self.assertEqual(final["nodes"][0]["chapter_id"], chapter["id"])
        self.assertEqual(final["edges"][0]["chapter_id"], chapter["id"])
        self.assertEqual(final["edges"][0]["line_style"], "dotted")
        self.assertEqual(final["edges"][0]["color"], "rose")
        self.assertTrue(all(note["locked"] for note in final["notes"]))

        cleared = self.client.delete(f"/api/projects/{project['id']}/canvas")
        self.assertEqual(cleared.json(), {"nodes": 2, "edges": 1, "notes": 2})
        after_clear = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual(after_clear["nodes"], [])
        self.assertEqual(after_clear["edges"], [])
        self.assertEqual(after_clear["notes"], [])
        self.assertEqual(after_clear["chapters"][0]["content"], "The story begins in the rain.")

    def test_legacy_scenes_are_promoted_to_chapters_and_links_follow(self):
        project = self.client.post(
            "/api/projects", json={"title": "Legacy novel", "description": ""}
        ).json()
        original = project["chapters"][0]
        node = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "Old scene node", "chapter_id": original["id"]},
        ).json()
        timestamp = main.now()
        legacy_scene_id = "scene_legacy"
        with closing(sqlite3.connect(str(main.DATABASE_PATH))) as connection, connection:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute(
                """INSERT INTO scenes(id, project_id, chapter_id, title, content, position, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    legacy_scene_id, project["id"], original["id"], "Promoted scene",
                    "Preserved scene content.", 0, timestamp, timestamp,
                ),
            )
            connection.execute(
                "UPDATE nodes SET scene_id = ? WHERE id = ?", (legacy_scene_id, node["id"])
            )

        main.init_db()
        loaded = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertNotIn("scenes", loaded)
        self.assertEqual([item["title"] for item in loaded["chapters"]], ["第一章", "Promoted scene"])
        promoted = loaded["chapters"][1]
        self.assertEqual(promoted["content"], "Preserved scene content.")
        linked_node = next(item for item in loaded["nodes"] if item["id"] == node["id"])
        self.assertEqual(linked_node["chapter_id"], promoted["id"])
        self.assertNotIn("scene_id", linked_node)
        with closing(sqlite3.connect(str(main.DATABASE_PATH))) as connection, connection:
            remaining_scenes = connection.execute("SELECT COUNT(*) FROM scenes").fetchone()[0]
        self.assertEqual(remaining_scenes, 0)

    def test_bulk_delete_chapters_keeps_one_and_detaches_map_links(self):
        project = self.client.post(
            "/api/projects", json={"title": "Delete chapters", "description": ""}
        ).json()
        first = project["chapters"][0]
        second = self.client.post(
            f"/api/projects/{project['id']}/chapters", json={"title": "Second"}
        ).json()
        third = self.client.post(
            f"/api/projects/{project['id']}/chapters", json={"title": "Third"}
        ).json()
        source = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "Source", "chapter_id": second["id"]},
        ).json()
        target = self.client.post(
            f"/api/projects/{project['id']}/nodes", json={"label": "Target"}
        ).json()
        edge = self.client.post(
            f"/api/projects/{project['id']}/edges",
            json={"source_id": source["id"], "target_id": target["id"], "chapter_id": second["id"]},
        )
        self.assertEqual(edge.status_code, 201)

        deleted = self.client.post(
            f"/api/projects/{project['id']}/chapters/bulk-delete",
            json={"chapter_ids": [second["id"], third["id"]]},
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"chapters": 2})
        remaining = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual([chapter["id"] for chapter in remaining["chapters"]], [first["id"]])
        self.assertIsNone(next(node for node in remaining["nodes"] if node["id"] == source["id"])["chapter_id"])
        self.assertIsNone(remaining["edges"][0]["chapter_id"])

        refused = self.client.post(
            f"/api/projects/{project['id']}/chapters/bulk-delete",
            json={"chapter_ids": [first["id"]]},
        )
        self.assertEqual(refused.status_code, 409)

    def test_story_maps_are_independent_and_delete_cascades_only_one_map(self):
        project = self.client.post(
            "/api/projects", json={"title": "Multiple maps", "description": ""}
        ).json()
        first_map = project["maps"][0]
        second_map = self.client.post(
            f"/api/projects/{project['id']}/maps", json={"title": "人物关系"}
        ).json()
        chapter = project["chapters"][0]
        first_node = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "主线节点", "map_id": first_map["id"], "chapter_id": chapter["id"]},
        ).json()
        second_node = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "人物节点", "map_id": second_map["id"], "chapter_id": chapter["id"]},
        ).json()
        second_target = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "人物节点二", "map_id": second_map["id"]},
        ).json()
        self.client.post(
            f"/api/nodes/{second_node['id']}/notes",
            json={"content": "只属于人物关系图", "locked": True},
        )
        edge = self.client.post(
            f"/api/projects/{project['id']}/edges",
            json={"source_id": second_node["id"], "target_id": second_target["id"]},
        )
        self.assertEqual(edge.status_code, 201)
        self.assertEqual(edge.json()["map_id"], second_map["id"])
        cross_map = self.client.post(
            f"/api/projects/{project['id']}/edges",
            json={"source_id": first_node["id"], "target_id": second_node["id"]},
        )
        self.assertEqual(cross_map.status_code, 400)

        cleared = self.client.delete(f"/api/maps/{second_map['id']}/canvas")
        self.assertEqual(cleared.json(), {"nodes": 2, "edges": 1, "notes": 1})
        after_clear = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual([node["id"] for node in after_clear["nodes"]], [first_node["id"]])
        self.assertEqual(after_clear["nodes"][0]["chapter_id"], chapter["id"])
        self.assertEqual(after_clear["notes"], [])
        self.assertEqual(len(after_clear["maps"]), 2)

        deleted = self.client.delete(f"/api/maps/{second_map['id']}")
        self.assertEqual(deleted.status_code, 204)
        after_delete = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual([item["id"] for item in after_delete["maps"]], [first_map["id"]])
        refused = self.client.delete(f"/api/maps/{first_map['id']}")
        self.assertEqual(refused.status_code, 409)

    def test_existing_single_canvas_database_is_migrated_to_default_story_map(self):
        legacy_path = Path(self.temporary_directory.name) / "legacy-map.db"
        timestamp = main.now()
        with closing(sqlite3.connect(str(legacy_path))) as connection, connection:
            connection.executescript(
                """
                CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE nodes (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
                    node_type TEXT NOT NULL DEFAULT 'plot', shape TEXT NOT NULL DEFAULT 'rounded', color TEXT NOT NULL DEFAULT 'blue',
                    x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, chapter_id TEXT, scene_id TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE edges (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
                    label TEXT NOT NULL DEFAULT '', chapter_id TEXT, line_style TEXT NOT NULL DEFAULT 'solid',
                    color TEXT NOT NULL DEFAULT 'blue', source_port TEXT NOT NULL DEFAULT 'right', target_port TEXT NOT NULL DEFAULT 'left',
                    created_at TEXT NOT NULL, UNIQUE(project_id, source_id, target_id)
                );
                """
            )
            connection.execute(
                "INSERT INTO projects VALUES (?, ?, ?, ?, ?)",
                ("project_old", "Old project", "", timestamp, timestamp),
            )
            for node_id in ("node_a", "node_b"):
                connection.execute(
                    """INSERT INTO nodes(id, project_id, label, created_at, updated_at)
                       VALUES (?, 'project_old', ?, ?, ?)""",
                    (node_id, node_id, timestamp, timestamp),
                )
            connection.execute(
                """INSERT INTO edges(id, project_id, source_id, target_id, created_at)
                   VALUES ('edge_old', 'project_old', 'node_a', 'node_b', ?)""",
                (timestamp,),
            )

        current_path = main.DATABASE_PATH
        try:
            main.DATABASE_PATH = legacy_path
            main.init_db()
            with closing(sqlite3.connect(str(legacy_path))) as connection, connection:
                connection.row_factory = sqlite3.Row
                story_maps = connection.execute("SELECT * FROM story_maps").fetchall()
                node_map_ids = {row["map_id"] for row in connection.execute("SELECT map_id FROM nodes")}
                edge_map_id = connection.execute("SELECT map_id FROM edges").fetchone()["map_id"]
            self.assertEqual(len(story_maps), 1)
            self.assertEqual(story_maps[0]["title"], "主故事线")
            self.assertEqual(node_map_ids, {story_maps[0]["id"]})
            self.assertEqual(edge_map_id, story_maps[0]["id"])
        finally:
            main.DATABASE_PATH = current_path

    def test_volumes_create_chapters_and_delete_preserving_chapter_content(self):
        project = self.client.post(
            "/api/projects", json={"title": "Volume workflow", "description": ""}
        ).json()
        first_volume = project["volumes"][0]
        first_chapter = project["chapters"][0]
        self.assertEqual(first_volume["title"], "第一卷")
        self.assertEqual(first_chapter["volume_id"], first_volume["id"])

        second_volume_response = self.client.post(
            f"/api/projects/{project['id']}/volumes", json={"title": "第二卷"}
        )
        self.assertEqual(second_volume_response.status_code, 201)
        second_volume = second_volume_response.json()
        moved_chapter = self.client.post(
            f"/api/projects/{project['id']}/chapters",
            json={"title": "第二卷第一章", "volume_id": second_volume["id"]},
        ).json()
        self.client.patch(
            f"/api/chapters/{moved_chapter['id']}",
            json={"content": "正文需要在删除卷后保留。"},
        )

        deleted = self.client.delete(f"/api/volumes/{second_volume['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["moved_chapters"], 1)
        self.assertEqual(deleted.json()["target_volume_id"], first_volume["id"])

        updated = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual([volume["id"] for volume in updated["volumes"]], [first_volume["id"]])
        preserved = next(chapter for chapter in updated["chapters"] if chapter["id"] == moved_chapter["id"])
        self.assertEqual(preserved["volume_id"], first_volume["id"])
        self.assertEqual(preserved["content"], "正文需要在删除卷后保留。")

        refused = self.client.delete(f"/api/volumes/{first_volume['id']}")
        self.assertEqual(refused.status_code, 409)

    def test_import_txt_files_as_new_chapters_in_selected_volume(self):
        project = self.client.post(
            "/api/projects", json={"title": "TXT import", "description": ""}
        ).json()
        second_volume = self.client.post(
            f"/api/projects/{project['id']}/volumes", json={"title": "第二卷"}
        ).json()
        response = self.client.post(
            f"/api/projects/{project['id']}/chapters/import-text",
            json={
                "volume_id": second_volume["id"],
                "files": [
                    {"title": "新章节 A", "content": "第一段\n第二段"},
                    {"title": "新章节 B", "content": "正文 B"},
                ],
            },
        )
        self.assertEqual(response.status_code, 201)
        imported = response.json()["chapters"]
        self.assertEqual([chapter["title"] for chapter in imported], ["新章节 A", "新章节 B"])
        self.assertEqual([chapter["content"] for chapter in imported], ["第一段\n第二段", "正文 B"])
        self.assertEqual([chapter["position"] for chapter in imported], [0, 1])
        self.assertTrue(all(chapter["volume_id"] == second_volume["id"] for chapter in imported))

        invalid_volume = self.client.post(
            f"/api/projects/{project['id']}/chapters/import-text",
            json={"volume_id": "volume_other_project", "files": [{"title": "不应写入", "content": "正文"}]},
        )
        self.assertEqual(invalid_volume.status_code, 400)
        final_project = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual(len(final_project["chapters"]), 3)

    def test_markdown_import_new_and_replace_existing_chapters(self):
        project = self.client.post(
            "/api/projects", json={"title": "Markdown import", "description": ""}
        ).json()
        volume = project["volumes"][0]
        second_volume = self.client.post(
            f"/api/projects/{project['id']}/volumes", json={"title": "第二卷"}
        ).json()
        first = project["chapters"][0]
        second = self.client.post(
            f"/api/projects/{project['id']}/chapters",
            json={"title": "第二卷第一章", "volume_id": second_volume["id"]},
        ).json()
        linked_node = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "保留关联", "chapter_id": first["id"]},
        ).json()

        created = self.client.post(
            f"/api/projects/{project['id']}/chapters/import-markdown",
            json={
                "volume_id": volume["id"],
                "files": [
                    {"title": "导入章节 A", "content": "# A\n\n**正文 A**"},
                    {"title": "导入章节 B", "content": "正文 B"},
                ],
            },
        )
        self.assertEqual(created.status_code, 201)
        created_chapters = created.json()["chapters"]
        self.assertEqual([chapter["title"] for chapter in created_chapters], ["导入章节 A", "导入章节 B"])
        self.assertEqual(created_chapters[0]["content"], "# A\n\n**正文 A**")
        self.assertEqual([chapter["position"] for chapter in created_chapters], [1, 2])

        replaced = self.client.post(
            f"/api/projects/{project['id']}/chapters/import-markdown",
            json={
                "volume_id": None,
                "mode": "replace",
                "files": [
                    {"title": "不改章节标题", "target_chapter_id": first["id"], "content": "替换第一章正文"},
                    {"title": "不改第二章标题", "target_chapter_id": second["id"], "content": "替换第二章正文"},
                ],
            },
        )
        self.assertEqual(replaced.status_code, 201)
        self.assertEqual([chapter["title"] for chapter in replaced.json()["chapters"]], ["第一章", "第二卷第一章"])
        self.assertEqual([chapter["content"] for chapter in replaced.json()["chapters"]], ["替换第一章正文", "替换第二章正文"])
        invalid_replace = self.client.post(
            f"/api/projects/{project['id']}/chapters/import-markdown",
            json={
                "volume_id": volume["id"],
                "mode": "replace",
                "files": [
                    {"title": "A", "target_chapter_id": first["id"], "content": "不应部分写入"},
                    {"title": "B", "target_chapter_id": "missing", "content": "无效目标"},
                ],
            },
        )
        self.assertEqual(invalid_replace.status_code, 400)
        final_project = self.client.get(f"/api/projects/{project['id']}").json()
        final_first = next(chapter for chapter in final_project["chapters"] if chapter["id"] == first["id"])
        self.assertEqual(final_first["content"], "替换第一章正文")
        self.assertEqual(next(node for node in final_project["nodes"] if node["id"] == linked_node["id"])["chapter_id"], first["id"])

    def test_markdown_zip_export_and_import_parser_roundtrip(self):
        project = self.client.post(
            "/api/projects", json={"title": "Markdown ZIP", "description": ""}
        ).json()
        volume = project["volumes"][0]
        export = self.client.post(
            f"/api/projects/{project['id']}/chapters/export-markdown-zip",
            json={
                "files": [
                    {"title": "第一章", "volume_title": "第一卷", "content": "**正文一**"},
                    {"title": "第二章", "volume_title": "第一卷", "content": "正文二"},
                    {"title": "第一章", "volume_title": "第二卷", "content": "同名章节"},
                ],
            },
        )
        self.assertEqual(export.status_code, 200)
        self.assertEqual(export.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
            self.assertEqual(archive.namelist(), ["第一卷/第一章.md", "第一卷/第二章.md", "第二卷/第一章.md"])
            self.assertEqual(archive.read("第一卷/第一章.md").decode("utf-8"), "# 第一章\n\n**正文一**")
        parsed = self.client.post(
            f"/api/projects/{project['id']}/chapters/parse-markdown-zip",
            content=export.content,
            headers={"Content-Type": "application/zip"},
        )
        self.assertEqual(parsed.status_code, 200)
        self.assertEqual([item["title"] for item in parsed.json()["files"]], ["第一章", "第二章", "第一章"])
        imported = self.client.post(
            f"/api/projects/{project['id']}/chapters/import-markdown",
            json={"volume_id": volume["id"], "files": [
                {"title": item["title"], "content": item["content"]}
                for item in parsed.json()["files"]
            ]},
        )
        self.assertEqual(imported.status_code, 201)
        self.assertEqual(len(imported.json()["chapters"]), 3)

        invalid_zip = self.client.post(
            f"/api/projects/{project['id']}/chapters/parse-markdown-zip",
            content=b"not a zip",
            headers={"Content-Type": "application/zip"},
        )
        self.assertEqual(invalid_zip.status_code, 400)

    def test_existing_chapters_migrate_to_a_default_volume(self):
        legacy_path = Path(self.temporary_directory.name) / "legacy-volume.db"
        timestamp = main.now()
        with closing(sqlite3.connect(str(legacy_path))) as connection, connection:
            connection.executescript(
                """
                CREATE TABLE projects (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE chapters (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                """
            )
            connection.execute(
                "INSERT INTO projects VALUES (?, ?, '', ?, ?)",
                ("legacy_project", "Legacy", timestamp, timestamp),
            )
            connection.execute(
                "INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("legacy_chapter", "legacy_project", "Saved chapter", "Saved content", 0, timestamp, timestamp),
            )

        current_path = main.DATABASE_PATH
        try:
            main.DATABASE_PATH = legacy_path
            main.init_db()
            project = self.client.get("/api/projects/legacy_project").json()
            self.assertEqual(len(project["volumes"]), 1)
            self.assertEqual(project["volumes"][0]["title"], "第一卷")
            self.assertEqual(project["chapters"][0]["id"], "legacy_chapter")
            self.assertEqual(project["chapters"][0]["volume_id"], project["volumes"][0]["id"])
            self.assertEqual(project["chapters"][0]["content"], "Saved content")
        finally:
            main.DATABASE_PATH = current_path

    def test_api_key_protects_writing_data(self):
        main.API_KEY = "test-secret"
        denied = self.client.get("/api/projects")
        allowed = self.client.get(
            "/api/projects", headers={"Authorization": "Bearer test-secret"}
        )
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)


if __name__ == "__main__":
    unittest.main()
