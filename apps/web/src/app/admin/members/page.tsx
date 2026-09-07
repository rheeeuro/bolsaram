/** 회원 — 초대/가입/Claim 현황 (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge } from "@/components/ui/badge";
import { Card, Table, Td, Th } from "@/components/admin/table";

export const dynamic = "force-dynamic";

type MemberRow = {
  user_id: string | null;
  phone: string | null;
  display_name: string | null;
  last_login_at: Date | null;
  profile_id: string;
  public_code: number;
  real_name: string | null;
  status: string;
  invite_expires_at: Date | null;
  invite_claimed_at: Date | null;
};

export default async function AdminMembersPage() {
  const viewer = await requireAdminPage();

  const rows = await withRls(rlsContextOf(viewer), async (sql) => {
    const result = await sql.query<MemberRow>(`
      SELECT u.id AS user_id, u.phone, u.display_name, u.last_login_at,
             p.id AS profile_id, p.public_code, p.real_name, p.status::text AS status,
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
    return result.rows;
  });

  const unclaimed = rows.filter((r) => r.user_id == null).length;

  return (
    <>
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-[18px] font-semibold tracking-tight">회원</h1>
        <span className="text-[12.5px] text-[var(--surface-text-muted)]">
          전체 {rows.length}건 · 미연결 {unclaimed}건
        </span>
      </header>

      {rows.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-[13px] text-[var(--surface-text-muted)]">
            아직 등록된 프로필이 없습니다. Import Inbox 에서 프로필을 만들어 보세요.
          </p>
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>프로필</Th>
              <Th>이름</Th>
              <Th>계정</Th>
              <Th>연락처</Th>
              <Th>초대</Th>
              <Th>최근 로그인</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.profile_id} className="hover:bg-[var(--surface-muted)]">
                <Td className="font-medium">#{row.public_code}</Td>
                <Td>{row.real_name ?? "—"}</Td>
                <Td>
                  {row.user_id ? (
                    <Badge tone="active">연결됨</Badge>
                  ) : (
                    <Badge tone="neutral">미연결</Badge>
                  )}
                </Td>
                <Td className="text-[var(--surface-text-muted)]">{maskPhone(row.phone)}</Td>
                <Td>{inviteState(row)}</Td>
                <Td className="text-[var(--surface-text-muted)]">
                  {row.last_login_at ? row.last_login_at.toLocaleDateString("ko-KR") : "—"}
                </Td>
                <Td>
                  <Link
                    href={`/admin/profiles/${row.profile_id}`}
                    className="text-[12.5px] text-[var(--surface-accent)] underline"
                  >
                    {row.user_id ? "관리" : "초대 발급"}
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

/** 관리자 화면에서도 전화번호를 온전히 노출하지 않는다(설계문서 §12). */
function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  if (phone.length < 8) return "***";
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}

function inviteState(row: MemberRow) {
  if (row.user_id) return <span className="text-[var(--surface-text-muted)]">—</span>;
  if (!row.invite_expires_at) {
    return <span className="text-[12.5px] text-[var(--surface-text-muted)]">미발급</span>;
  }
  if (row.invite_claimed_at) return <Badge tone="active">사용됨</Badge>;
  if (row.invite_expires_at.getTime() < Date.now()) return <Badge tone="danger">만료</Badge>;
  return (
    <span className="text-[12.5px]">
      대기 · {row.invite_expires_at.toLocaleDateString("ko-KR")}까지
    </span>
  );
}
