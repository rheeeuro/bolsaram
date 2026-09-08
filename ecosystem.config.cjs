/**
 * 볼사람 PM2 구성.
 *
 * 이 저장소의 package.json 은 `"type": "module"` 이라 `.js` 로 두면 PM2 가 ESM 으로
 * 해석해 `module.exports` 를 못 읽는다. 확장자를 `.cjs` 로 고정한다.
 *
 * 앱을 추가·변경한 뒤에는 `pnpm pm2:save` 로 저장해야 재부팅 후에도 살아난다
 * (이 호스트는 systemd `pm2-euro.service` 로 PM2 를 복원한다).
 */
const path = require("node:path");

const ROOT = __dirname;
const WEB = path.join(ROOT, "apps/web");

/** 로그는 저장소 밖에 쌓지 않고 var/log 아래로 모은다(git 제외). */
const log = (name) => ({
  out_file: path.join(ROOT, "var/log", `${name}.out.log`),
  error_file: path.join(ROOT, "var/log", `${name}.err.log`),
  merge_logs: true,
  time: true,
});

module.exports = {
  apps: [
    // ── 웹 (프론트 + API, 상시) ────────────────────────────────
    // Next.js 는 빌드 산출물(.next)을 읽으므로 배포 전에 `pnpm build` 가 끝나 있어야 한다.
    // deploy-on-stop 훅이 코드 변경 시 빌드 후 이 앱을 재시작한다.
    {
      name: "bolsaram-web",
      script: "pnpm",
      args: "start",
      cwd: WEB,
      interpreter: "none",
      instances: 1,
      autorestart: true,
      exp_backoff_restart_delay: 3000,
      max_restarts: 50,
      min_uptime: "10s",
      // 재시작 폭주를 막기 위한 상한. 이 값을 넘으면 재시작하고 알림이 남는다.
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        // 실제 사용자를 받는 배포다. production 에서는 APP_ORIGIN 이 https 여야 하고
        // 기본 시크릿을 쓸 수 없다(apps/web/src/server/env.ts).
        APP_ENV: "production",
      },
      ...log("bolsaram-web"),
    },

    // ── DB 백업 (매일 03:40) ───────────────────────────────────
    // 정리(04:10)보다 **먼저** 돈다 — 정리가 지운 것도 하루치 백업에는 남아 있어야
    // 실수를 되돌릴 수 있다. 덤프는 var/backup 에 14개까지 쌓인다(같은 호스트다).
    {
      name: "bolsaram-backup",
      script: "bash",
      args: "scripts/db-backup.sh",
      cwd: ROOT,
      interpreter: "none",
      instances: 1,
      autorestart: false,
      cron_restart: "40 3 * * *",
      // 다른 디스크·마운트에 사본을 두려면 BACKUP_MIRROR_DIR 을 여기 넣는다.
      // 경로가 없거나 못 쓰면 경고만 하고 기본 백업은 유지한다.
      env: { NODE_ENV: "production" },
      ...log("bolsaram-backup"),
    },

    // ── 만료 데이터 정리 (매일 04:10) ──────────────────────────
    // 세션·OTP·초대·감사 로그 정리 + 방치된 Import 원본 사진 삭제.
    // cron 워커라 매 실행 새 프로세스로 뜬다 — 코드를 고쳐도 재시작할 필요가 없다.
    {
      name: "bolsaram-cleanup",
      script: "pnpm",
      args: "db:cleanup",
      cwd: ROOT,
      interpreter: "none",
      instances: 1,
      autorestart: false,
      cron_restart: "10 4 * * *",
      env: { NODE_ENV: "production" },
      ...log("bolsaram-cleanup"),
    },
  ],
};
