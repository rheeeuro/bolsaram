/**
 * 시드 관리자 비밀번호를 정한다.
 *
 * 고정값을 쓰지 않는다 — 저장소에 적힌 값은 새로 시드한 환경이 공개 주소에 붙는 순간
 * 그대로 로그인 경로가 된다. `SEED_ADMIN_PASSWORD` 를 주면 그 값을 쓰고, 없으면 매
 * 실행 새로 만들어 시드 결과에만 한 번 출력한다.
 *
 * 이 모듈이 CLI 와 분리돼 있는 이유는 테스트가 시드를 실행하지 않고 판정만 확인하기
 * 위해서다(`seed.ts` 는 import 만으로 시드가 돈다).
 */
import { randomBytes } from "node:crypto";
import { SIGNUP_PASSWORD_MIN } from "@bolsaram/schemas";

export type SeedAdminPassword = { password: string; fromEnv: boolean };

/** `SEED_ADMIN_PASSWORD` 가 비어 있지 않게 설정돼 있으면 그 값. */
export function seedAdminPasswordFromEnv(env = process.env): string | null {
  const given = env.SEED_ADMIN_PASSWORD?.trim();
  return given ? given : null;
}

export function resolveSeedAdminPassword(env = process.env): SeedAdminPassword {
  const given = seedAdminPasswordFromEnv(env);
  if (given) {
    if (given.length < SIGNUP_PASSWORD_MIN) {
      throw new Error(
        `SEED_ADMIN_PASSWORD 는 ${SIGNUP_PASSWORD_MIN}자 이상이어야 합니다(가입 규칙과 동일).`,
      );
    }
    return { password: given, fromEnv: true };
  }
  // base64url 16자. 가입 최소 길이보다 길고 셸에 그대로 붙여 쓸 수 있다.
  return { password: randomBytes(12).toString("base64url"), fromEnv: false };
}
