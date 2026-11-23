"""Start the API and static frontend together for local development."""

import subprocess
import socket
import sys
import time
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXPECTED_API_VERSION = "0.3.0"


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
        client.settimeout(0.2)
        return client.connect_ex(("127.0.0.1", port)) == 0


def running_api_version():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=1) as response:
            return json.loads(response.read().decode("utf-8")).get("version")
    except Exception:
        return None


def main() -> int:
    if port_is_open(8000):
        version = running_api_version()
        if version:
            print(f"无法启动新版 API：端口 8000 正在运行旧版 {version}，当前代码需要 {EXPECTED_API_VERSION}。")
        else:
            print("无法启动 API：端口 8000 已被其他程序占用。")
        print("请在旧服务的终端按 Ctrl+C 停止它，再重新运行 python dev.py。")
        return 1
    commands = [[
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--app-dir",
            str(ROOT / "backend"),
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ]]
    reuse_frontend = port_is_open(4173)
    if not reuse_frontend:
        commands.append([
            sys.executable,
            "-m",
            "http.server",
            "4173",
            "--bind",
            "127.0.0.1",
            "--directory",
            str(ROOT / "frontend"),
        ])
    processes = [subprocess.Popen(command, cwd=str(ROOT)) for command in commands]
    print("\n墨图开发环境已启动：")
    print("  前端  http://127.0.0.1:4173")
    if reuse_frontend:
        print("        （检测到已有前端服务，继续复用）")
    print("  API   http://127.0.0.1:8000/docs")
    print("按 Ctrl+C 同时停止两个服务。\n")
    try:
        while all(process.poll() is None for process in processes):
            time.sleep(0.4)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
    failed = [process.returncode for process in processes if process.returncode not in (None, 0, -15)]
    return failed[0] if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
