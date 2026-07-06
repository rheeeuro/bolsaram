module.exports = {
  apps: [
    {
      name: "bolsaram-fe",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3020",
      env: {
        NODE_ENV: "production",
        BACKEND_API_URL: "http://127.0.0.1:8010",
      },
    },
    {
      name: "bolsaram-be",
      cwd: ".",
      script: "backend/.venv/bin/python",
      args: "-m uvicorn backend.app.main:app --host 0.0.0.0 --port 8010",
      env: {
        FRONTEND_ORIGINS: "http://localhost:3020,http://127.0.0.1:3020",
        // 카카오 챗봇에 돌려줄 업로드 링크의 공개 HTTPS 주소. 예: https://bolsaram.example.com
        PUBLIC_BASE_URL: "http://127.0.0.1:3020",
        // 카카오 업로드가 기본으로 등록될 방 public_id. 챗봇 파라미터 roomId가 있으면 그 값을 우선 사용한다.
        KAKAO_DEFAULT_ROOM_ID: "",
        // 카카오 챗봇 스킬 서버가 X-Kakao-Api-Key 헤더로 보낼 공용 키. 비어 있으면 헤더 검증을 건너뛴다.
        KAKAO_API_KEY: "",
      },
    },
    {
      name: "bolsaram-maintenance",
      cwd: ".",
      script: "backend/.venv/bin/python",
      args: "-m backend.app.maintenance",
      autorestart: false,
      cron_restart: "0 4 * * *",
    },
  ],
};
