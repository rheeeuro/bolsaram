/**
 * 합성 시드 데이터 정리.
 *
 * 실회원을 받기 시작하면 `pnpm db:seed` 가 만든 합성 프로필이 진짜 사람들 사이에
 * 섞여 있게 된다. 회원 눈에는 구분이 안 되고, 그 프로필로 신청이 들어오면 아무도
 * 연결해 줄 수 없다.
 *
 *   pnpm db:purge-seed          무엇이 지워질지만 보여준다 (기본)
 *   pnpm db:purge-seed --yes    실제로 지운다
 *
 * 판별 기준은 이름이나 날짜 추측이 아니라 **표식**이다 — 시드가 만든 프로필은
 * `consent_method = 'SYNTHETIC'` 이다(마이그레이션 0019). 실제 사람의 프로필에는
 * 이 값이 붙지 않으므로 잘못 지울 수 없다.
 *
 * 지우는 것: 합성 프로필, 그 사진 파일, 그 프로필에 연결된 회원 계정.
 * 신청·관심·초대는 FK CASCADE 로 함께 사라진다.
 * **주선자 계정과 모임은 건드리지 않는다** — 사람이 쓰는 계정이다.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePools, withOwnerTx } from "../packages/db/src/client";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv();

const apply = process.argv.includes("--yes");
const storageRoot = path.resolve(ROOT, process.env.STORAGE_ROOT ?? "var/storage");

type Row = { id: string; public_code: number; storage_key: string | null; user_id: string | null };

async function main(): Promise<void> {
  await withOwnerTx(async (sql) => {
    const found = await sql.query<Row>(
      `SELECT p.id, p.public_code, i.storage_key, p.user_id
         FROM profiles p
         LEFT JOIN profile_images i ON i.profile_id = p.id
        WHERE p.consent_method = 'SYNTHETIC'
        ORDER BY p.public_code`,
    );

    const profileIds = [...new Set(found.rows.map((r) => r.id))];
    const userIds = [...new Set(found.rows.map((r) => r.user_id).filter((v): v is string => !!v))];
    const keys = [...new Set(found.rows.map((r) => r.storage_key).filter((v): v is string => !!v))];

    if (profileIds.length === 0) {
      console.info("합성 프로필이 없습니다.");
      return;
    }

    // 남는 것도 함께 보여준다 — "다 지웠는데 왜 아직 있지"를 없앤다.
    const rest = await sql.query<{ method: string | null; count: number }>(
      `SELECT consent_method AS method, count(*)::int AS count
         FROM profiles WHERE consent_method IS DISTINCT FROM 'SYNTHETIC'
        GROUP BY 1 ORDER BY 1`,
    );

    console.info(`합성 프로필 ${profileIds.length}건, 사진 ${keys.length}장, 회원 계정 ${userIds.length}개`);
    console.info(`  번호: ${found.rows.map((r) => r.public_code).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`);
    console.info("남는 것:");
    for (const row of rest.rows) {
      console.info(`  ${row.method ?? "기록 없음"}: ${row.count}건`);
    }

    if (!apply) {
      console.info("\n실제로 지우려면 --yes 를 붙이세요.");
      return;
    }

    // 파일을 먼저 지운다. 반대로 하면 참조를 잃은 파일이 영원히 남는다.
    // 경로 탈출은 DB 값이라도 확인한다.
    let files = 0;
    for (const key of keys) {
      const full = path.resolve(storageRoot, key);
      if (full !== storageRoot && !full.startsWith(storageRoot + path.sep)) {
        console.warn(`건너뜀(경로 이탈): ${key}`);
        continue;
      }
      await rm(full, { force: true });
      files += 1;
    }

    // profile_images·match_requests·favorites·invites 는 CASCADE 로 함께 사라진다.
    const profiles = await sql.query(`DELETE FROM profiles WHERE id = ANY($1)`, [profileIds]);
    const users =
      userIds.length > 0
        ? await sql.query(`DELETE FROM users WHERE id = ANY($1) AND role = 'MEMBER'`, [userIds])
        : { rowCount: 0 };

    console.info(
      `\n지웠습니다 — 프로필 ${profiles.rowCount ?? 0}건, 사진 ${files}장, 회원 계정 ${users.rowCount ?? 0}개`,
    );
  });
}

main()
  .then(() => closePools())
  .catch(async (error: unknown) => {
    console.error("정리 실패", error);
    await closePools();
    process.exitCode = 1;
  });
