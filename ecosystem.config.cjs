module.exports = {
  apps: [
    {
      name: "bolsaram-fe",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3020",
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_API_URL: "http://localhost:8010",
      },
    },
    {
      name: "bolsaram-be",
      cwd: ".",
      script: "backend/.venv/bin/python",
      args: "-m uvicorn backend.app.main:app --host 0.0.0.0 --port 8010",
      env: {
        FRONTEND_ORIGINS: "http://localhost:3020,http://127.0.0.1:3020",
      },
    },
  ],
};
