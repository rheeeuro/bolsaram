/**
 * 시드 관리자 비밀번호 판정.
 *
 * "안 되는 것"을 본다 — 시드가 저장소에 적힌 고정값을 심지 않는 것, 가입 규칙보다
 * 짧은 값을 받아주지 않는 것.
 */
import { describe, expect, it } from "vitest";
import { SIGNUP_PASSWORD_MIN } from "@bolsaram/schemas";
import {
  resolveSeedAdminPassword,
  seedAdminPasswordFromEnv,
} from "../packages/db/src/cli/seed-admin-password";

describe("resolveSeedAdminPassword", () => {
  it("환경변수가 없으면 매번 다른 값을 만든다", () => {
    const a = resolveSeedAdminPassword({});
    const b = resolveSeedAdminPassword({});
    expect(a.fromEnv).toBe(false);
    expect(a.password).not.toBe(b.password);
  });

  it("만든 값은 가입 최소 길이를 넘는다", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(resolveSeedAdminPassword({}).password.length).toBeGreaterThanOrEqual(
        SIGNUP_PASSWORD_MIN,
      );
    }
  });

  it("만든 값에 셸이나 URL 에서 깨지는 문자가 없다", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(resolveSeedAdminPassword({}).password).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("옛 문서 기본값을 다시 심지 않는다", () => {
    // 이 값이 저장소에 문서화돼 있던 동안 공개 주소의 관리자 계정이 그대로 열려 있었다.
    for (let i = 0; i < 50; i += 1) {
      expect(resolveSeedAdminPassword({}).password).not.toBe("bolsaram-admin");
    }
  });

  it("환경변수를 주면 그 값을 쓴다", () => {
    const given = "seed-admin-password";
    expect(resolveSeedAdminPassword({ SEED_ADMIN_PASSWORD: given })).toEqual({
      password: given,
      fromEnv: true,
    });
  });

  it("환경변수 앞뒤 공백은 떼어낸다", () => {
    expect(resolveSeedAdminPassword({ SEED_ADMIN_PASSWORD: "  0123456789ab  " }).password).toBe(
      "0123456789ab",
    );
  });

  it("가입 규칙보다 짧은 값은 거부한다", () => {
    expect(() => resolveSeedAdminPassword({ SEED_ADMIN_PASSWORD: "short" })).toThrow(
      /SEED_ADMIN_PASSWORD/,
    );
  });

  it("빈 값이나 공백만 있는 값은 없는 것으로 본다", () => {
    for (const value of ["", "   "]) {
      expect(seedAdminPasswordFromEnv({ SEED_ADMIN_PASSWORD: value })).toBeNull();
      expect(resolveSeedAdminPassword({ SEED_ADMIN_PASSWORD: value }).fromEnv).toBe(false);
    }
  });
});
