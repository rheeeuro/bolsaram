/**
 * 이상형 조건 채우기 — 조건 칸이 비어 있는 프로필의 이상형 글을 추출에 한 번 통과시킨다.
 *
 * 이상형 조건(`profiles.ideal_criteria`, 0070)은 가져오기 분석이 함께 뽑는다. 그 전에 등록된
 * 프로필은 칸이 비어 있어 추천에 쓰이지 않으므로, 이 스크립트로 한 번 채운다.
 *
 *   pnpm ai:backfill-ideal          누구를 채울지만 보여준다 (기본)
 *   pnpm ai:backfill-ideal --yes    실제로 AI 를 부르고 저장한다
 *
 * - 앱의 추출 프로바이더를 그대로 쓴다(`AI_PROVIDER`) — 같은 프롬프트, 같은 Zod 검증.
 * - **보내는 것은 이상형 글과 성별·출생연도·종교뿐이다.** 상대적 나이(「연상」)와
 *   「같은 종교」를 풀 때 필요한 값이다. 이름·연락처·원문 전체는 보내지 않는다.
 * - 이미 조건이 있는 프로필은 건드리지 않는다(`ideal_criteria IS NULL` 일 때만 쓴다).
 *   주선자가 고친 값을 덮지 않기 위해서다.
 * - 출력에는 공개 번호만 남긴다. 이상형 글·AI 응답은 찍지 않는다.
 *
 * owner 커넥션을 쓰는 운영 스크립트다(`purge-seed` 와 같다). 세션이 없어 RLS 컨텍스트를
 * 만들 수 없고, 모든 모임의 프로필을 한 번에 다뤄야 한다.
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { closePools, withOwner } from "../packages/db/src/client";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";

// 해외 API 는 TCP 연결이 250ms(Node 기본값)를 넘어 완료 직전에 취소된다(ai-check 와 같다).
setDefaultAutoSelectFamilyAttemptTimeout(2_000);
loadDotEnv();

const apply = process.argv.includes("--yes");
const CONCURRENCY = 3;

type Row = {
  id: string;
  public_code: number;
  gender: string;
  birth_year: number;
  religion: string | null;
  ideal_type_text: string;
};

async function main(): Promise<void> {
  // 앱 모듈은 환경변수를 읽은 뒤에 불러온다 — env() 가 처음 불릴 때 값을 굳힌다.
  const { extractionProvider } = await import("../apps/web/src/server/ai/index");
  const { GENDER_LABELS, RELIGION_LABELS, isIdealCriteriaEmpty, normalizeIdealCriteria } =
    await import("@bolsaram/schemas");

  const rows = await withOwner(async (sql) => {
    const result = await sql.query<Row>(
      `SELECT id, public_code, gender, birth_year, religion, ideal_type_text
         FROM profiles
        WHERE ideal_criteria IS NULL
          AND ideal_type_text IS NOT NULL AND btrim(ideal_type_text) <> ''
        ORDER BY public_code`,
    );
    return result.rows;
  });

  const provider = extractionProvider();
  console.info(`프로바이더: ${provider.name} · 대상 ${rows.length}명`);
  if (rows.length === 0) return;
  console.info(rows.map((r) => `${r.public_code}번`).join(" "));
  if (!apply) {
    console.info("미리보기입니다. 실제로 채우려면 --yes 를 붙이세요.");
    return;
  }

  const counts = { filled: 0, empty: 0, failed: 0 };
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++]!;
      const lines = [
        `${row.birth_year}년생 ${GENDER_LABELS[row.gender as keyof typeof GENDER_LABELS] ?? ""}`,
        row.religion ? `종교: ${RELIGION_LABELS[row.religion as keyof typeof RELIGION_LABELS] ?? row.religion}` : null,
        `이상형: ${row.ideal_type_text.trim()}`,
      ].filter((line): line is string => line != null);
      try {
        const result = await provider.extract({ text: lines.join("\n") });
        const raw = result.fields.idealCriteria;
        const criteria = raw ? normalizeIdealCriteria(raw) : null;
        if (!criteria || isIdealCriteriaEmpty(criteria)) {
          counts.empty += 1;
          console.info(`${row.public_code}번 · 견줄 조건 없음`);
          continue;
        }
        await withOwner((sql) =>
          sql.query(
            `UPDATE profiles SET ideal_criteria = $1 WHERE id = $2 AND ideal_criteria IS NULL`,
            [criteria, row.id],
          ),
        );
        counts.filled += 1;
        console.info(`${row.public_code}번 · 채움`);
      } catch (error) {
        counts.failed += 1;
        // 오류 본문에 원문이 섞일 수 있어 메시지만 남긴다.
        console.error(`${row.public_code}번 · 실패: ${error instanceof Error ? error.message : "알 수 없음"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  console.info(`채움 ${counts.filled} · 조건 없음 ${counts.empty} · 실패 ${counts.failed}`);
  if (counts.failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePools());
