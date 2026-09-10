/** 회원 — 초대/가입/Claim 현황 (설계문서 §6). */
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";
import { Blank, Count, PageHeader, Panel, Row, RowList, Thumb } from "@/components/host/surface";
import { InviteRow } from "@/components/host/invite-row";

export const dynamic = "force-dynamic";

type MemberRow = {
  user_id: string | null;
  phone: string | null;
  last_login_at: Date | null;
  profile_id: string;
  public_code: number;
  real_name: string | null;
  invite_expires_at: Date | null;
  invite_claimed_at: Date | null;
};

type Entry = MemberRow & { imageUrl: string | null };

export default async function HostMembersPage() {
  const viewer = await requireAdminPage();

  const rows = await withRls(rlsContextOf(viewer), async (sql) => {
    const result = await sql.query<MemberRow>(`
      SELECT u.id AS user_id, u.phone, u.last_login_at,
             p.id AS profile_id, p.public_code, p.real_name,
             i.expires_at AS invite_expires_at, i.claimed_at AS invite_claimed_at
        FROM profiles p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN LATERAL (
          SELECT expires_at, claimed_at FROM invites
           WHERE profile_id = p.id AND revoked_at IS NULL
           ORDER BY created_at DESC LIMIT 1
        ) i ON true
       ORDER BY (p.user_id IS NOT NULL), p.created_at DESC
       LIMIT 300
    `);

    // 사진은 목록에서 사람을 알아보는 유일한 단서다 — 이름은 여기서만 보인다.
    const profiles = await findProfilesByIds(
      sql,
      result.rows.map((r) => r.profile_id),
    );
    const imageById = new Map(
      profiles.map((p) => [p.id, toCardView(p).primaryImage?.url ?? null]),
    );

    return result.rows.map<Entry>((row) => ({
      ...row,
      imageUrl: imageById.get(row.profile_id) ?? null,
    }));
  });

  const waiting = rows.filter((r) => r.user_id == null);
  const joined = rows.filter((r) => r.user_id != null);

  return (
    <>
      <PageHeader
        title="회원"
        description="등록한 분에게 초대 링크를 보내면 그 링크로 들어옵니다. 아이디와 비밀번호는 없습니다."
        aside={<Count>{rows.length}명</Count>}
      />

      {rows.length === 0 ? (
        <Panel>
          <Blank>
            아직 등록된 프로필이 없습니다. 「가져오기」에서 첫 프로필을 만들어 보세요.
          </Blank>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          <Panel
            title="초대를 기다리는 분"
            action={<Count>{waiting.length}명</Count>}
            className="overflow-hidden"
          >
            {waiting.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[var(--surface-text-muted)]">
                모두 초대를 마쳤습니다.
              </p>
            ) : (
              <div className="-mx-5 -my-5">
                <RowList>
                  {waiting.map((row) => (
                    <InviteRow
                      key={row.profile_id}
                      profileId={row.profile_id}
                      code={row.public_code}
                      name={row.real_name}
                      imageUrl={row.imageUrl}
                      expiresAt={row.invite_expires_at?.toISOString() ?? null}
                      claimedAt={row.invite_claimed_at?.toISOString() ?? null}
                    />
                  ))}
                </RowList>
              </div>
            )}
          </Panel>

          <Panel
            title="들어온 분"
            action={<Count>{joined.length}명</Count>}
            className="overflow-hidden"
          >
            {joined.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[var(--surface-text-muted)]">
                아직 들어온 분이 없습니다.
              </p>
            ) : (
              <div className="-mx-5 -my-5">
                <RowList>
                  {joined.map((row) => (
                    <Row key={row.profile_id} href={`/profiles/${row.profile_id}`}>
                      <Thumb url={row.imageUrl} size="sm" />
                      <Identity code={row.public_code} name={row.real_name} />
                      <div className="ml-auto flex items-center gap-3 text-[12.5px] text-[var(--surface-text-muted)]">
                        <span className="hidden sm:inline">{maskPhone(row.phone)}</span>
                        <span>
                          {row.last_login_at
                            ? `${row.last_login_at.toLocaleDateString("ko-KR")} 방문`
                            : "방문 전"}
                        </span>
                      </div>
                    </Row>
                  ))}
                </RowList>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

function Identity({ code, name }: { code: number; name: string | null }) {
  return (
    <div className="min-w-0">
      <p className="display text-[15px] text-[var(--surface-text)]">#{code}</p>
      <p className="truncate text-[12.5px] text-[var(--surface-text-muted)]">
        {name ?? "이름 없음"}
      </p>
    </div>
  );
}

/** 주선자 화면에서도 전화번호를 온전히 노출하지 않는다(설계문서 §12). */
function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  if (phone.length < 8) return "***";
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}

