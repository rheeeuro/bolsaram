/**
 * DB 관련 환경변수 로딩.
 * 웹 앱은 자체 env 모듈을 쓰고, 여기서는 CLI(마이그레이션/시드)와 커넥션 풀 생성에
 * 필요한 최소한만 읽는다.
 */
export type DbEnv = {
  /** 소유자 커넥션. 마이그레이션·시드·인증 경로 전용. RLS 를 우회한다. */
  ownerUrl: string;
  /** 런타임 커넥션. RLS 가 적용되는 NOBYPASSRLS 롤. */
  appUrl: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`환경변수 ${name} 이(가) 필요합니다. .env.example 을 참고하세요.`);
  }
  return value;
}

export function readDbEnv(): DbEnv {
  return {
    ownerUrl: required("DATABASE_URL"),
    appUrl: process.env.APP_DATABASE_URL ?? required("DATABASE_URL"),
  };
}
