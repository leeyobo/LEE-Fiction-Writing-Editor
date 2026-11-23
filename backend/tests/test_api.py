import tempfile
import unittest
import sqlite3
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
        project = self.client.post("/api/projects", json={"title": "Test novel", "description": ""}).json()
        loaded = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual(loaded["title"], "Test novel")
        self.assertEqual(len(loaded["chapters"]), 1)

        chapter = loaded["chapters"][0]
        response = self.client.patch(
            f"/api/chapters/{chapter['id']}",
            json={"title": "Chapter one", "content": "The story begins in the rain."},
        )
        self.assertEqual(response.status_code, 200)

        first = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "Storm", "node_type": "plot", "shape": "rounded", "color": "blue", "x": 80, "y": 90, "chapter_id": chapter["id"]},
        ).json()
        second = self.client.post(
            f"/api/projects/{project['id']}/nodes",
            json={"label": "Visitor", "node_type": "character", "shape": "pill", "color": "violet", "x": 320, "y": 90},
        ).json()
        edge = self.client.post(
            f"/api/projects/{project['id']}/edges",
            json={
                "source_id": first["id"], "target_id": second["id"], "label": "introduces",
                "source_port": "bottom", "target_port": "top", "line_style": "dashed",
            },
        )
        self.assertEqual(edge.status_code, 201)
        self.assertEqual(edge.json()["source_port"], "bottom")
        edge_update = self.client.patch(
            f"/api/edges/{edge.json()['id']}",
            json={"label": "A conditional transition", "chapter_id": chapter["id"], "line_style": "dotted"},
        )
        self.assertEqual(edge_update.status_code, 200)
        self.assertEqual(edge_update.json()["line_style"], "dotted")

        scene_link = self.client.post(
            f"/api/nodes/{first['id']}/scene",
            json={"chapter_id": chapter["id"]},
        )
        self.assertEqual(scene_link.status_code, 201)
        scene = scene_link.json()["scene"]
        self.assertEqual(scene["title"], "Storm")
        scene_update = self.client.patch(
            f"/api/scenes/{scene['id']}",
            json={"content": "Rain covers the old harbor."},
        )
        self.assertEqual(scene_update.status_code, 200)

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
        locked_update = self.client.patch(
            f"/api/notes/{first_note.json()['id']}",
            json={"locked": True},
        )
        self.assertTrue(locked_update.json()["locked"])

        final = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual(len(final["nodes"]), 2)
        self.assertEqual(len(final["edges"]), 1)
        self.assertEqual(final["edges"][0]["chapter_id"], chapter["id"])
        self.assertEqual(final["edges"][0]["label"], "A conditional transition")
        self.assertEqual(len(final["scenes"]), 1)
        self.assertEqual(len(final["notes"]), 2)
        self.assertTrue(all(note["locked"] for note in final["notes"]))
        self.assertEqual(final["nodes"][0]["chapter_id"], chapter["id"])
        self.assertEqual(final["nodes"][0]["scene_id"], scene["id"])
        self.assertEqual(final["scenes"][0]["content"], "Rain covers the old harbor.")

    def test_existing_database_gets_scene_link_migration(self):
        legacy_path = Path(self.temporary_directory.name) / "legacy.db"
        with sqlite3.connect(str(legacy_path)) as connection:
            connection.execute(
                """CREATE TABLE nodes (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '', node_type TEXT NOT NULL DEFAULT 'plot',
                    shape TEXT NOT NULL DEFAULT 'rounded', color TEXT NOT NULL DEFAULT 'blue',
                    x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, chapter_id TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE edges (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
                    UNIQUE(project_id, source_id, target_id)
                )"""
            )
        main.DATABASE_PATH = legacy_path
        main.init_db()
        with sqlite3.connect(str(legacy_path)) as connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(nodes)").fetchall()}
            edge_columns = {row[1] for row in connection.execute("PRAGMA table_info(edges)").fetchall()}
            scene_table = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scenes'"
            ).fetchone()
        self.assertIn("scene_id", columns)
        self.assertTrue({"chapter_id", "line_style", "source_port", "target_port"}.issubset(edge_columns))
        self.assertIsNotNone(scene_table)

    def test_api_key_protects_writing_data(self):
        main.API_KEY = "test-secret"
        denied = self.client.get("/api/projects")
        allowed = self.client.get("/api/projects", headers={"Authorization": "Bearer test-secret"})
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)


if __name__ == "__main__":
    unittest.main()

