import sqlite3
import tempfile
import unittest
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
        with sqlite3.connect(str(main.DATABASE_PATH)) as connection:
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
        with sqlite3.connect(str(main.DATABASE_PATH)) as connection:
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
