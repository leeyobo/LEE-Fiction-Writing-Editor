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
            json={"source_id": first["id"], "target_id": second["id"], "label": "introduces"},
        )
        self.assertEqual(edge.status_code, 201)

        final = self.client.get(f"/api/projects/{project['id']}").json()
        self.assertEqual(len(final["nodes"]), 2)
        self.assertEqual(len(final["edges"]), 1)
        self.assertEqual(final["nodes"][0]["chapter_id"], chapter["id"])

    def test_api_key_protects_writing_data(self):
        main.API_KEY = "test-secret"
        denied = self.client.get("/api/projects")
        allowed = self.client.get("/api/projects", headers={"Authorization": "Bearer test-secret"})
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)


if __name__ == "__main__":
    unittest.main()

