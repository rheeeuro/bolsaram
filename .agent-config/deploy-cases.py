#!/usr/bin/env python3
"""임시 프로젝트와 가짜 PM2/pnpm/curl로 자동 배포를 검증한다. 운영 앱은 건드리지 않는다."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bolsaram-deploy-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT / ".claude/hooks", self.root / ".claude/hooks")
        (self.root / ".agent-config").mkdir()
        for name in ["deploy-state.py", "hook-files.py"]:
            shutil.copy(ROOT / ".agent-config" / name, self.root / ".agent-config" / name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.calls_file = self.root / "calls.jsonl"
        self.env = {
            **os.environ, "CLAUDE_PROJECT_DIR": str(self.root),
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "FAKE_CALLS": str(self.calls_file), "FAKE_BUILD_FAIL": "0",
            "FAKE_HEALTH_FAIL": "0", "FAKE_PM2_FAIL": "0", "FAKE_OFFLINE": "0",
            "AGENT_DEPLOY_STATE": str(self.root / ".claude/.deploy-state.json"),
            "AGENT_DEPLOY_LOCK": str(self.root / ".claude/.deploy.lock"),
            "AGENT_TURN_MARKER": str(self.root / ".claude/.turn-start"),
            "AGENT_PENDING_CHANGES": str(self.root / ".claude/.pending-changes"),
        }
        stub = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['FAKE_CALLS'], 'a') as out:
    out.write(json.dumps([name, *args]) + '\\n')
if name == 'pnpm':
    if os.environ['FAKE_BUILD_FAIL'] == '1':
        print('synthetic build failure')
        sys.exit(1)
if name == 'pm2':
    if args == ['jlist']:
        state = 'stopped' if os.environ['FAKE_OFFLINE'] == '1' else 'online'
        print(json.dumps([{'name': name, 'pm2_env': {'status': state}} for name in ['bolsaram-web', 'bolsaram-health']]))
    elif os.environ['FAKE_PM2_FAIL'] == '1':
        sys.exit(1)
if name == 'curl' and os.environ['FAKE_HEALTH_FAIL'] == '1':
    sys.exit(22)
"""
        for name in ["pm2", "pnpm", "curl", "sleep", "docker"]:
            path = self.bin / name
            path.write_text(stub)
            path.chmod(0o755)
        self.write("apps/web/src/example.ts", "export const value = 1;")
        self.write("packages/db/src/r2.ts", "export const storage = 1;")
        self.write(".env", "SYNTHETIC_SECRET=never-print-this")
        self.run_hook("mark-turn-start.sh")

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def run_hook(self, name, payload=None):
        result = subprocess.run(
            ["bash", str(self.root / ".claude/hooks" / name)],
            input=json.dumps(payload or {}), text=True, capture_output=True,
            cwd=self.root, env=self.env, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def calls(self):
        if not self.calls_file.exists():
            return []
        return [json.loads(line) for line in self.calls_file.read_text().splitlines()]

    def test_shared_generated_lifecycle(self):
        sync = load_module("sync", ROOT / ".agent-config/sync.py")
        manifest = json.loads((ROOT / ".agent-config/manifest.json").read_text())
        for quality in [True, False]:
            manifest["hooks"]["quality_after_edit"] = quality
            for config in [sync.claude_settings(manifest), sync.codex_hooks(manifest)]:
                hooks = config["hooks"]
                self.assertIn("mark-turn-start.sh", hooks["UserPromptSubmit"][0]["hooks"][0]["command"])
                self.assertIn("deploy-on-stop.sh", hooks["Stop"][0]["hooks"][0]["command"])
                self.assertEqual(hooks["Stop"][0]["hooks"][0]["timeout"], 600)
                self.assertTrue(any("track-changes.sh" in h["command"] for group in hooks["PostToolUse"] for h in group["hooks"]))
        manifest["hooks"]["deploy_on_stop"] = False
        for config in [sync.claude_settings(manifest), sync.codex_hooks(manifest)]:
            self.assertNotIn("Stop", config["hooks"])
            self.assertNotIn("UserPromptSubmit", config["hooks"])

    def test_shell_change_rebuilds_once_then_noop(self):
        self.write("apps/web/src/example.ts", "export const value = 2;")
        self.run_hook("deploy-on-stop.sh")
        calls = self.calls()
        self.assertIn(["pnpm", "build"], calls)
        self.assertIn(["pm2", "restart", "bolsaram-web"], calls)
        self.assertTrue(any(call[0] == "curl" for call in calls))
        self.assertLess(calls.index(["pnpm", "build"]), calls.index(["pm2", "restart", "bolsaram-web"]))
        self.run_hook("mark-turn-start.sh")
        self.run_hook("deploy-on-stop.sh")
        self.assertEqual(self.calls(), calls)

    def test_env_changed_between_turns_is_detected_without_reading_secret(self):
        self.run_hook("deploy-on-stop.sh")
        self.write(".env", "SYNTHETIC_SECRET=another-private-value")
        self.run_hook("mark-turn-start.sh")
        result = self.run_hook("deploy-on-stop.sh")
        self.assertIn(["pm2", "restart", "bolsaram-web"], self.calls())
        self.assertIn(["pm2", "restart", "bolsaram-health"], self.calls())
        state = Path(self.env["AGENT_DEPLOY_STATE"]).read_text()
        self.assertNotIn("another-private-value", state + result.stdout + result.stderr)
        self.assertNotIn("SYNTHETIC_SECRET", state)

    def test_shell_delete_and_db_r2_change_are_detected(self):
        (self.root / "apps/web/src/example.ts").unlink()
        self.run_hook("deploy-on-stop.sh")
        self.assertIn(["pnpm", "build"], self.calls())
        self.calls_file.unlink()
        self.write("packages/db/src/r2.ts", "export const storage = 2;")
        self.run_hook("deploy-on-stop.sh")
        self.assertIn(["pnpm", "build"], self.calls())

    def test_build_failure_preserves_changes_for_retry(self):
        self.write("apps/web/src/example.ts", "broken source")
        self.env["FAKE_BUILD_FAIL"] = "1"
        for active in [False, True]:
            result = self.run_hook("deploy-on-stop.sh", {"stop_hook_active": active})
            response = json.loads(result.stdout)
            self.assertIn("systemMessage" if active else "decision", response)
            if not active:
                self.assertEqual(response["decision"], "block")
            self.assertNotIn("continue", response)
            self.assertTrue(Path(self.env["AGENT_PENDING_CHANGES"]).exists())
        self.assertNotIn(["pm2", "restart", "bolsaram-web"], self.calls())
        self.env["FAKE_BUILD_FAIL"] = "0"
        self.run_hook("deploy-on-stop.sh")
        self.assertIn(["pm2", "restart", "bolsaram-web"], self.calls())
        self.assertFalse(Path(self.env["AGENT_PENDING_CHANGES"]).exists())

    def test_http_failure_blocks_even_when_pm2_is_online(self):
        self.write("apps/web/src/example.ts", "changed")
        self.env["FAKE_HEALTH_FAIL"] = "1"
        result = self.run_hook("deploy-on-stop.sh")
        self.assertEqual(json.loads(result.stdout)["decision"], "block")
        self.assertTrue(Path(self.env["AGENT_PENDING_CHANGES"]).exists())
        self.env["FAKE_HEALTH_FAIL"] = "0"
        self.run_hook("deploy-on-stop.sh")
        self.assertFalse(Path(self.env["AGENT_PENDING_CHANGES"]).exists())

    def test_failed_pm2_commands_are_not_reported_as_success(self):
        self.write("apps/web/src/example.ts", "changed")
        self.env["FAKE_PM2_FAIL"] = "1"
        result = self.run_hook("deploy-on-stop.sh")
        self.assertEqual(json.loads(result.stdout)["decision"], "block")
        self.assertTrue(Path(self.env["AGENT_PENDING_CHANGES"]).exists())

    def test_offline_app_is_not_started_and_changes_are_retained(self):
        self.write("apps/web/src/example.ts", "changed")
        self.env["FAKE_OFFLINE"] = "1"
        self.run_hook("deploy-on-stop.sh")
        self.assertFalse(any(call[:2] in [["pm2", "start"], ["pm2", "restart"]] for call in self.calls()))
        self.assertTrue(Path(self.env["AGENT_PENDING_CHANGES"]).exists())

    def test_docs_generated_files_and_cron_do_not_restart_web(self):
        self.write("docs/notes.md", "notes")
        self.write("apps/web/.next/cache/output.ts", "generated")
        self.write("packages/db/src/cleanup.ts", "cron changes")
        self.run_hook("deploy-on-stop.sh")
        self.assertFalse(any(call[0] in ["pnpm", "pm2", "curl"] for call in self.calls()))

    def test_claude_and_codex_record_multi_file_paths(self):
        self.run_hook("track-changes.sh", {"tool_name": "Edit", "cwd": str(self.root), "tool_input": {"file_path": "apps/web/src/example.ts"}})
        patch = "*** Begin Patch\n*** Update File: packages/db/src/r2.ts\n*** Move to: packages/db/src/storage.ts\n*** Delete File: apps/web/src/old.ts\n*** End Patch"
        self.run_hook("track-changes.sh", {"tool_name": "apply_patch", "cwd": str(self.root), "tool_input": {"command": patch}})
        pending = Path(self.env["AGENT_PENDING_CHANGES"]).read_text().splitlines()
        for name in ["apps/web/src/example.ts", "packages/db/src/r2.ts", "packages/db/src/storage.ts", "apps/web/src/old.ts"]:
            self.assertIn(str(self.root / name), pending)

    def test_lock_prevents_concurrent_build(self):
        import fcntl
        self.write("apps/web/src/example.ts", "changed")
        with open(self.env["AGENT_DEPLOY_LOCK"], "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.run_hook("deploy-on-stop.sh")
            self.assertEqual(self.calls(), [])
        self.run_hook("deploy-on-stop.sh")
        self.assertIn(["pnpm", "build"], self.calls())


if __name__ == "__main__":
    unittest.main(verbosity=2)
