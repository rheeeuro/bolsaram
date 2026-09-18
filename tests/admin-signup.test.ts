/**
 * 주선자 가입(소셜 첫 로그인) · 전체공개 풀 · 모임 참여 통합 테스트.
 *
 * 이 서비스의 전제는 **가입이 열려 있다**는 것이다. 따라서 지켜야 하는 성질은
 * "가입이 되는가"보다 **"가입한 사람이 무엇까지 볼 수 있는가"** 다.
 *
 *   group_id IS NULL      → 전체공개. 모든 주선자가 본다.
 *   group_id IS NOT NULL  → 그 모임 주선자만 본다.
 *
 * 전체공개 프로필도 **고치는 것은 등록한 주선자만**이다 — 남이 등록한 프로필을
 * 아무 주선자나 고치면 안 된다.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import {
  closeGroup,
  consumeGroupInvite,
  createGroupForAdmin,
  issueGroupInvite,
  leaveGroup,
  readMyGroups,
  removeGroupAdmin,
  setActiveGroup,
  transferGroupOwnership,
  updateGroup,
} from "../apps/web/src/server/auth/group-invite";
import { loginWithOAuth } from "../apps/web/src/server/auth/oauth";

const TAG = `signuptest-${Date.now()}`;

let seq = 0;
function nextEmail(): string {
  seq += 1;
  return `${TAG}-${seq}@test.local`;
}

/** 제공자가 알려준 신원. 실제 호출 없이 그 뒤의 계정 처리만 본다. */
function identity(input: { email: string | null; displayName: string; subject?: string }) {
  seq += 1;
  return {
    provider: "GOOGLE" as const,
    subject: input.subject ?? `${TAG}-sub-${seq}`,
    email: input.email,
    displayName: input.displayName,
  };
}

/** 속한 모임 하나. 여러 모임에 속할 수 있으므로 어느 것인지 지정해 꺼낸다. */
async function readGroup(userId: string, groupId?: string) {
  const groups = await readMyGroups(userId);
  if (!groupId) return groups[0] ?? null;
  return groups.find((g) => g.groupId === groupId) ?? null;
}

/** 지금 보고 있는 모임(채널). */
async function readActiveGroupId(userId: string): Promise<string | null> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ active_group_id: string | null }>(
      `SELECT active_group_id FROM users WHERE id = $1`,
      [userId],
    );
    return r.rows[0]?.active_group_id ?? null;
  });
}

async function newAdmin(label: string): Promise<RlsContext & { userId: string }> {
  const userId = await loginWithOAuth(
    identity({ email: nextEmail(), displayName: `${TAG}-${label}` }),
  );
  return { userId, role: "ADMIN" };
}

/** 방에 남은 사건 종류를 순서대로. 나간 것과 내보내진 것을 구분해 본다(0046). */
async function readSystemKinds(groupId: string): Promise<string[]> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ system_kind: string }>(
      `SELECT system_kind FROM group_messages
        WHERE group_id = $1 AND system_kind IS NOT NULL ORDER BY created_at`,
      [groupId],
    );
    return r.rows.map((row) => row.system_kind);
  });
}

/** 모임에 동료 주선자 한 명을 붙인다. 초대 코드를 거쳐야 소속이 생긴다. */
async function addColleague(
  owner: { userId: string },
  groupId: string,
  label: string,
): Promise<RlsContext & { userId: string }> {
  const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
  const invited = await newAdmin(label);
  await consumeGroupInvite({ code: issued.code, userId: invited.userId });
  return invited;
}

/** 프로필을 만든다. groupId 가 null 이면 전체공개다. */
async function seedProfile(input: {
  groupId: string | null;
  createdBy: string;
  name: string;
}): Promise<string> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                             status, visibility, real_name, created_by)
       VALUES ($1,'FEMALE',1993,'SEOUL','ACTIVE','LISTED',$2,$3) RETURNING id`,
      [input.groupId, `${TAG}-${input.name}`, input.createdBy],
    );
    return r.rows[0]!.id;
  });
}

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("가입", () => {
  it("계정만 만든다 — 모임은 만들지 않는다", async () => {
    const admin = await newAdmin("기본");
    const groups = await withOwner(async (sql) => {
      const r = await sql.query(`SELECT 1 FROM group_admins WHERE user_id = $1`, [admin.userId]);
      return r.rowCount ?? 0;
    });
    // 주선자와 모임은 별개다. 가입 직후는 소속 없음이 정상이다.
    expect(groups).toBe(0);
  });

  it("같은 소셜 계정으로 다시 들어오면 같은 계정이다", async () => {
    // 첫 로그인이 가입이고 그다음부터는 로그인이다. 두 번째에 계정이 또 생기면 안 된다.
    const first = identity({ email: nextEmail(), displayName: `${TAG}-재로그인` });
    const userId = await loginWithOAuth(first);
    await expect(loginWithOAuth(first)).resolves.toBe(userId);
  });

  it("제공자가 다르더라도 확인된 이메일이 같으면 한 계정으로 잇는다", async () => {
    const email = nextEmail();
    const userId = await loginWithOAuth(
      identity({ email, displayName: `${TAG}-구글쪽` }),
    );
    const kakao = { ...identity({ email, displayName: `${TAG}-카카오쪽` }), provider: "KAKAO" as const };
    await expect(loginWithOAuth(kakao)).resolves.toBe(userId);
  });

  it("이메일을 주지 않아도 로그인된다 — 매번 새 계정이 되지는 않는다", async () => {
    // 카카오는 이메일이 선택 동의라 거절될 수 있다. 계정을 찾는 기준은 subject 다.
    const anonymous = {
      ...identity({ email: null, displayName: `${TAG}-이메일없음` }),
      provider: "KAKAO" as const,
    };
    const userId = await loginWithOAuth(anonymous);
    await expect(loginWithOAuth(anonymous)).resolves.toBe(userId);
  });

  it("멤버 계정에는 소셜 계정을 붙이지 않는다", async () => {
    // 멤버는 초대 링크로만 들어온다. 이메일이 겹친다고 멤버 계정을 열어주면 안 된다.
    const email = nextEmail();
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO users (role, phone, email, display_name)
         VALUES ('MEMBER', $1, $2, $3)`,
        [`0102000${(9000 + seq).toString().slice(-4)}`, email, `${TAG}-멤버`],
      ),
    );
    await expect(
      loginWithOAuth(identity({ email, displayName: `${TAG}-멤버가장` })),
    ).rejects.toThrow(/멤버 계정/);
  });
});

describe("전체공개 풀", () => {
  it("갓 가입한 주선자에게 전체공개 프로필이 보인다", async () => {
    const owner = await newAdmin("공개등록자");
    const publicId = await seedProfile({
      groupId: null,
      createdBy: owner.userId,
      name: "공개멤버",
    });

    const fresh = await newAdmin("신규");
    const visible = await withRls(fresh, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [publicId]);
      return r.rowCount ?? 0;
    });
    // 빈 화면 대신 전체공개 풀을 본다 — 이게 이번 모델의 핵심이다.
    expect(visible).toBe(1);
  });

  it("모임 소속 프로필은 갓 가입한 주선자에게 보이지 않는다", async () => {
    const owner = await newAdmin("모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-비공개모임`,
    });
    const hidden = await seedProfile({
      groupId,
      createdBy: owner.userId,
      name: "모임멤버",
    });

    const fresh = await newAdmin("외부인");
    const visible = await withRls(fresh, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [hidden]);
      return r.rowCount ?? 0;
    });
    expect(visible).toBe(0);
  });

  it("전체공개 프로필을 남이 고칠 수 없다", async () => {
    const owner = await newAdmin("원등록자");
    const publicId = await seedProfile({
      groupId: null,
      createdBy: owner.userId,
      name: "남의공개멤버",
    });

    const other = await newAdmin("남");
    const updated = await withRls(other, async (sql) => {
      const r = await sql.query(`UPDATE profiles SET bio = 'hacked' WHERE id = $1`, [publicId]);
      return r.rowCount ?? 0;
    });
    // 보이는 것과 고치는 것은 다르다.
    expect(updated).toBe(0);
  });

  it("전체공개 프로필을 등록한 주선자는 고칠 수 있다", async () => {
    const owner = await newAdmin("본인등록자");
    const publicId = await seedProfile({
      groupId: null,
      createdBy: owner.userId,
      name: "내공개멤버",
    });
    const updated = await withRls(owner, async (sql) => {
      const r = await sql.query(`UPDATE profiles SET bio = $2 WHERE id = $1`, [
        publicId,
        "본인 수정",
      ]);
      return r.rowCount ?? 0;
    });
    expect(updated).toBe(1);
  });
});

describe("모임 참여 (초대 코드)", () => {
  it("코드로 같은 모임에 합류한다", async () => {
    const owner = await newAdmin("초대자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-합류모임`,
    });
    const hidden = await seedProfile({ groupId, createdBy: owner.userId, name: "합류대상" });

    const invited = await newAdmin("초대받은이");
    // 합류 전에는 보이지 않는다.
    const before = await withRls(invited, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [hidden]);
      return r.rowCount ?? 0;
    });
    expect(before).toBe(0);

    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
    const joined = await consumeGroupInvite({ code: issued.code, userId: invited.userId });
    expect(joined.groupId).toBe(groupId);

    // 합류 후에는 보인다.
    const after = await withRls(invited, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [hidden]);
      return r.rowCount ?? 0;
    });
    expect(after).toBe(1);
  });

  it("같은 코드를 두 번 쓸 수 없다", async () => {
    const owner = await newAdmin("재사용초대자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-재사용모임`,
    });
    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });

    const first = await newAdmin("첫번째");
    await consumeGroupInvite({ code: issued.code, userId: first.userId });

    const second = await newAdmin("두번째");
    await expect(
      consumeGroupInvite({ code: issued.code, userId: second.userId }),
    ).rejects.toThrow(/이미 사용된/);
  });

  it("만료된 코드는 쓸 수 없다", async () => {
    const owner = await newAdmin("만료초대자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-만료모임`,
    });
    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
    await withOwner((sql) =>
      sql.query(
        `UPDATE group_invite_codes SET expires_at = now() - interval '1 minute'
          WHERE group_id = $1 AND consumed_at IS NULL`,
        [groupId],
      ),
    );
    const late = await newAdmin("늦은이");
    await expect(
      consumeGroupInvite({ code: issued.code, userId: late.userId }),
    ).rejects.toThrow(/만료/);
  });

  it("없는 코드는 쓸 수 없다", async () => {
    const admin = await newAdmin("헛코드");
    await expect(
      consumeGroupInvite({ code: "존재하지-않는-코드", userId: admin.userId }),
    ).rejects.toThrow(/만료되었거나 이미 사용된/);
  });

  it("이미 모임이 있어도 다른 모임에 함께 들어간다", async () => {
    const owner = await newAdmin("A모임장");
    const a = await createGroupForAdmin({ userId: owner.userId, name: `${TAG}-A모임` });
    const other = await newAdmin("B모임장");
    const b = await createGroupForAdmin({ userId: other.userId, name: `${TAG}-B모임` });

    const issued = await issueGroupInvite({ groupId: a.groupId, createdBy: owner.userId });
    await consumeGroupInvite({ code: issued.code, userId: other.userId });

    // 두 모임 다 남아 있고, 합류한 모임이 보고 있는 채널이 된다.
    const mine = await readMyGroups(other.userId);
    expect(mine.map((g) => g.groupId).sort()).toEqual([a.groupId, b.groupId].sort());
    expect(await readActiveGroupId(other.userId)).toBe(a.groupId);
  });

  it("같은 모임에 다시 합류해도 소속이 늘지 않는다", async () => {
    const owner = await newAdmin("중복초대자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-중복모임`,
    });
    const invited = await newAdmin("중복참여자");
    const first = await issueGroupInvite({ groupId, createdBy: owner.userId });
    await consumeGroupInvite({ code: first.code, userId: invited.userId });
    const second = await issueGroupInvite({ groupId, createdBy: owner.userId });
    await consumeGroupInvite({ code: second.code, userId: invited.userId });

    expect(await readMyGroups(invited.userId)).toHaveLength(1);
  });

  it("여러 모임에 속하면 양쪽 멤버를 모두 다룰 수 있다", async () => {
    const owner = await newAdmin("겸업초대자");
    const a = await createGroupForAdmin({ userId: owner.userId, name: `${TAG}-겸업A` });
    const worker = await newAdmin("겸업주선자");
    const b = await createGroupForAdmin({ userId: worker.userId, name: `${TAG}-겸업B` });

    const issued = await issueGroupInvite({ groupId: a.groupId, createdBy: owner.userId });
    await consumeGroupInvite({ code: issued.code, userId: worker.userId });

    const inA = await seedProfile({ groupId: a.groupId, createdBy: owner.userId, name: "A멤버" });
    const inB = await seedProfile({ groupId: b.groupId, createdBy: worker.userId, name: "B멤버" });

    // 보고 있는 채널과 무관하게 **두 모임 모두** RLS 를 통과한다 — 채널은 화면
    // 필터이지 권한이 아니다.
    const seen = await withRls(worker, async (sql) => {
      const r = await sql.query<{ id: string }>(
        `SELECT id FROM profiles WHERE id = ANY($1)`,
        [[inA, inB]],
      );
      return r.rows.map((row) => row.id).sort();
    });
    expect(seen).toEqual([inA, inB].sort());
  });

  it("합류한 사람은 개설자가 아니다", async () => {
    const owner = await newAdmin("개설자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-권한모임`,
    });
    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
    const invited = await newAdmin("참여자");
    await consumeGroupInvite({ code: issued.code, userId: invited.userId });

    const owners = await withOwner(async (sql) => {
      const r = await sql.query<{ user_id: string; is_owner: boolean }>(
        `SELECT user_id, is_owner FROM group_admins WHERE group_id = $1 ORDER BY added_at`,
        [groupId],
      );
      return r.rows;
    });
    expect(owners).toHaveLength(2);
    expect(owners.filter((o) => o.is_owner)).toHaveLength(1);
    expect(owners[0]!.user_id).toBe(owner.userId);
  });
});

describe("모임 정보", () => {
  it("만들 때 설명을 함께 넣는다", async () => {
    const owner = await newAdmin("설명등록자");
    await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-설명모임`,
      description: "계리사·회계사 중심으로 봅니다",
    });
    const group = await readGroup(owner.userId);
    expect(group).toMatchObject({
      name: `${TAG}-설명모임`,
      description: "계리사·회계사 중심으로 봅니다",
      isOwner: true,
    });
  });

  it("이름과 설명을 고칠 수 있다", async () => {
    const owner = await newAdmin("수정자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-수정전`,
    });
    await updateGroup({ groupId, name: `${TAG}-수정후`, description: "새 설명" });
    const group = await readGroup(owner.userId);
    expect(group).toMatchObject({ name: `${TAG}-수정후`, description: "새 설명" });
  });

  it("보낸 항목만 바뀐다", async () => {
    const owner = await newAdmin("부분수정자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-부분`,
      description: "원래 설명",
    });
    // 이름만 보내면 설명은 그대로여야 한다.
    await updateGroup({ groupId, name: `${TAG}-부분2` });
    expect(await readGroup(owner.userId)).toMatchObject({
      name: `${TAG}-부분2`,
      description: "원래 설명",
    });
  });

  it("설명을 빈 문자열로 보내면 지운다", async () => {
    const owner = await newAdmin("설명삭제자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-삭제`,
      description: "지울 설명",
    });
    await updateGroup({ groupId, description: "" });
    expect(await readGroup(owner.userId)).toMatchObject({ description: null });
  });

  it("합류한 주선자는 개설자로 표시되지 않는다", async () => {
    const owner = await newAdmin("표시개설자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-표시모임`,
    });
    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
    const invited = await newAdmin("표시참여자");
    await consumeGroupInvite({ code: issued.code, userId: invited.userId });

    expect(await readGroup(owner.userId)).toMatchObject({ isOwner: true });
    expect(await readGroup(invited.userId)).toMatchObject({ isOwner: false });
  });
});

describe("모임 나가기", () => {
  it("빈 모임은 나가면서 사라진다", async () => {
    const admin = await newAdmin("빈모임장");
    const { groupId } = await createGroupForAdmin({
      userId: admin.userId,
      name: `${TAG}-빈모임`,
    });
    const result = await leaveGroup(admin.userId, groupId);
    expect(result.deletedGroup).toBe(true);
    expect(await readGroup(admin.userId)).toBeNull();

    const left = await withOwner(async (sql) => {
      const r = await sql.query(`SELECT 1 FROM groups WHERE id = $1`, [groupId]);
      return r.rowCount ?? 0;
    });
    // 주인 없는 빈 모임을 남기지 않는다.
    expect(left).toBe(0);
  });

  it("마지막 주선자는 멤버가 남아 있으면 나갈 수 없다", async () => {
    const admin = await newAdmin("마지막주선자");
    const { groupId } = await createGroupForAdmin({
      userId: admin.userId,
      name: `${TAG}-멤버있는모임`,
    });
    await seedProfile({ groupId, createdBy: admin.userId, name: "남는멤버" });

    // 나가면 그 멤버를 아무도 볼 수 없게 된다 — 되돌릴 방법이 없으므로 막는다.
    await expect(leaveGroup(admin.userId, groupId)).rejects.toThrow(/남아 있어 나갈 수 없습니다/);
    expect(await readGroup(admin.userId)).not.toBeNull();
  });

  it("동료가 있으면 멤버가 남아 있어도 나갈 수 있다", async () => {
    const owner = await newAdmin("떠나는개설자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-인수모임`,
    });
    await seedProfile({ groupId, createdBy: owner.userId, name: "인수될멤버" });

    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
    const successor = await newAdmin("후임");
    await consumeGroupInvite({ code: issued.code, userId: successor.userId });

    const result = await leaveGroup(owner.userId, groupId);
    expect(result.deletedGroup).toBe(false);
    expect(await readGroup(owner.userId)).toBeNull();

    // 개설자가 후임에게 넘어가야 한다 — 개설자 없는 모임을 만들 수 없다.
    const after = await readGroup(successor.userId);
    expect(after).toMatchObject({ groupId, isOwner: true });
    expect(after?.admins).toHaveLength(1);
  });

  it("나간 뒤에는 그 모임 멤버가 보이지 않는다", async () => {
    const owner = await newAdmin("나갈사람");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-차단확인모임`,
    });
    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
    const stays = await newAdmin("남을사람");
    await consumeGroupInvite({ code: issued.code, userId: stays.userId });
    const hidden = await seedProfile({
      groupId,
      createdBy: stays.userId,
      name: "나간뒤안보임",
    });

    await leaveGroup(owner.userId, groupId);
    const visible = await withRls(owner, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [hidden]);
      return r.rowCount ?? 0;
    });
    expect(visible).toBe(0);
  });

  it("속하지 않은 모임에서는 나갈 수 없다", async () => {
    const stranger = await newAdmin("무소속나가기");
    const owner = await newAdmin("남의모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-남의모임`,
    });
    await expect(leaveGroup(stranger.userId, groupId)).rejects.toThrow(/속하지 않은 모임/);
  });

  it("여러 모임 중 하나만 나가면 나머지는 남는다", async () => {
    const admin = await newAdmin("한곳만나가기");
    const stay = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-남길모임` });
    const go = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-떠날모임` });

    await leaveGroup(admin.userId, go.groupId);

    const mine = await readMyGroups(admin.userId);
    expect(mine.map((g) => g.groupId)).toEqual([stay.groupId]);
    // 나간 모임을 보고 있었으므로 남은 모임으로 옮겨 간다.
    expect(await readActiveGroupId(admin.userId)).toBe(stay.groupId);
  });

  it("마지막 모임을 나가면 전체공개로 떨어진다", async () => {
    const admin = await newAdmin("전체공개로");
    const { groupId } = await createGroupForAdmin({
      userId: admin.userId,
      name: `${TAG}-마지막모임`,
    });
    await leaveGroup(admin.userId, groupId);
    expect(await readActiveGroupId(admin.userId)).toBeNull();
  });
});

describe("모임 폐쇄", () => {
  it("모임장은 빈 모임을 폐쇄한다", async () => {
    const owner = await newAdmin("폐쇄모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-폐쇄할모임`,
    });

    await closeGroup({ actorId: owner.userId, groupId });

    const left = await withOwner(async (sql) => {
      const r = await sql.query(`SELECT 1 FROM groups WHERE id = $1`, [groupId]);
      return r.rowCount ?? 0;
    });
    expect(left).toBe(0);
    expect(await readGroup(owner.userId, groupId)).toBeNull();
  });

  it("멤버가 남아 있으면 폐쇄할 수 없다", async () => {
    const owner = await newAdmin("멤버남은모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-멤버남은모임`,
    });
    await seedProfile({ groupId, createdBy: owner.userId, name: "폐쇄막는멤버" });

    // 모임이 사라지면 RLS 가 그 멤버를 전부 가린다 — 되살릴 길이 없으므로 막는다.
    await expect(closeGroup({ actorId: owner.userId, groupId })).rejects.toThrow(
      /남아 있어 폐쇄할 수 없습니다/,
    );
    expect(await readGroup(owner.userId, groupId)).not.toBeNull();
  });

  it("모임장이 아닌 주선자는 폐쇄할 수 없다", async () => {
    const owner = await newAdmin("폐쇄권한개설자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-폐쇄권한모임`,
    });
    const colleague = await addColleague(owner, groupId, "폐쇄못하는동료");

    await expect(closeGroup({ actorId: colleague.userId, groupId })).rejects.toThrow(
      /모임장만/,
    );
    expect(await readGroup(owner.userId, groupId)).not.toBeNull();
  });

  it("속하지 않은 사람은 폐쇄할 수 없다", async () => {
    const owner = await newAdmin("폐쇄남의모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-남의모임`,
    });
    const stranger = await newAdmin("폐쇄행인");

    await expect(closeGroup({ actorId: stranger.userId, groupId })).rejects.toThrow(
      /모임장만/,
    );
    expect(await readGroup(owner.userId, groupId)).not.toBeNull();
  });

  it("남은 주선자도 함께 빠지고 보고 있던 방을 잃는다", async () => {
    const owner = await newAdmin("데리고나가는모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-동료있는빈모임`,
    });
    const colleague = await addColleague(owner, groupId, "함께빠지는동료");
    // 합류하면 그 모임을 보게 된다.
    expect(await readActiveGroupId(colleague.userId)).toBe(groupId);

    await closeGroup({ actorId: owner.userId, groupId });

    expect(await readGroup(colleague.userId, groupId)).toBeNull();
    // groups 가 사라지면 ON DELETE SET NULL 로 보고 있던 방도 비워진다(0036).
    expect(await readActiveGroupId(colleague.userId)).toBeNull();
  });

  it("보고 있던 모임을 폐쇄하면 남은 모임으로 옮겨 간다", async () => {
    const admin = await newAdmin("두모임폐쇄자");
    const stays = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-남는방` });
    const closes = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-닫는방` });
    await setActiveGroup(admin.userId, closes.groupId);

    const result = await closeGroup({ actorId: admin.userId, groupId: closes.groupId });

    expect(result.activeGroupId).toBe(stays.groupId);
    expect(await readActiveGroupId(admin.userId)).toBe(stays.groupId);
  });
});

describe("모임장", () => {
  it("모임장을 넘기면 둘의 표시가 맞바뀐다", async () => {
    const owner = await newAdmin("넘기는모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-위임모임`,
    });
    const colleague = await addColleague(owner, groupId, "받는동료");

    await transferGroupOwnership({
      actorId: owner.userId,
      groupId,
      targetUserId: colleague.userId,
    });

    expect(await readGroup(owner.userId, groupId)).toMatchObject({ isOwner: false });
    expect(await readGroup(colleague.userId, groupId)).toMatchObject({ isOwner: true });
    // 소속은 그대로다 — 넘긴 사람도 계속 그 모임 주선자다.
    expect((await readGroup(owner.userId, groupId))?.admins).toHaveLength(2);
  });

  it("모임장이 아니면 넘길 수 없다", async () => {
    const owner = await newAdmin("안넘기는모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-위임차단모임`,
    });
    const colleague = await addColleague(owner, groupId, "권한없는동료");

    // 보통 주선자가 모임장을 자기에게 끌어올 수 없다.
    await expect(
      transferGroupOwnership({
        actorId: colleague.userId,
        groupId,
        targetUserId: colleague.userId,
      }),
    ).rejects.toThrow(/이미 모임장입니다/);
    await expect(
      transferGroupOwnership({
        actorId: colleague.userId,
        groupId,
        targetUserId: owner.userId,
      }),
    ).rejects.toThrow(/모임장만/);
    expect(await readGroup(owner.userId, groupId)).toMatchObject({ isOwner: true });
  });

  it("속하지 않은 사람에게는 넘길 수 없다", async () => {
    const owner = await newAdmin("혼자모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-외부위임모임`,
    });
    const stranger = await newAdmin("무소속대상");

    await expect(
      transferGroupOwnership({ actorId: owner.userId, groupId, targetUserId: stranger.userId }),
    ).rejects.toThrow(/주선자가 아닙니다/);
    expect(await readGroup(owner.userId, groupId)).toMatchObject({ isOwner: true });
  });

  it("내보낸 주선자는 그 모임 멤버를 더 이상 보지 못한다", async () => {
    const owner = await newAdmin("내보내는모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-추방모임`,
    });
    const colleague = await addColleague(owner, groupId, "나갈동료");
    const hidden = await seedProfile({
      groupId,
      createdBy: owner.userId,
      name: "추방뒤안보임",
    });

    // 내보내기 전에는 보인다.
    const before = await withRls(colleague, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [hidden]);
      return r.rowCount ?? 0;
    });
    expect(before).toBe(1);

    await removeGroupAdmin({ actorId: owner.userId, groupId, targetUserId: colleague.userId });

    const after = await withRls(colleague, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [hidden]);
      return r.rowCount ?? 0;
    });
    expect(after).toBe(0);
    expect(await readGroup(colleague.userId, groupId)).toBeNull();
    // 보고 있던 채널도 정리된다(0036 트리거).
    expect(await readActiveGroupId(colleague.userId)).toBeNull();
  });

  it("모임장이 아니면 내보낼 수 없다", async () => {
    const owner = await newAdmin("표적모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-추방차단모임`,
    });
    const colleague = await addColleague(owner, groupId, "시도하는동료");

    // 보통 주선자가 모임장을 밀어낼 수 없다.
    await expect(
      removeGroupAdmin({ actorId: colleague.userId, groupId, targetUserId: owner.userId }),
    ).rejects.toThrow(/모임장만/);
    expect((await readGroup(owner.userId, groupId))?.admins).toHaveLength(2);
  });

  it("자기 자신은 내보낼 수 없다", async () => {
    const owner = await newAdmin("자기추방");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-자기추방모임`,
    });

    // 모임장이 빠지는 것은 나가기다 — 승계·빈 모임 정리가 함께 일어나야 한다.
    await expect(
      removeGroupAdmin({ actorId: owner.userId, groupId, targetUserId: owner.userId }),
    ).rejects.toThrow(/모임 나가기로/);
    expect(await readGroup(owner.userId, groupId)).not.toBeNull();
  });

  it("방에는 나간 것과 내보낸 것이 구분돼 남는다", async () => {
    const owner = await newAdmin("기록모임장");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-기록모임`,
    });
    const leaves = await addColleague(owner, groupId, "스스로나갈동료");
    const removed = await addColleague(owner, groupId, "내보내질동료");

    await leaveGroup(leaves.userId, groupId);
    await removeGroupAdmin({ actorId: owner.userId, groupId, targetUserId: removed.userId });
    await transferGroupOwnership({
      actorId: owner.userId,
      groupId,
      targetUserId: (await addColleague(owner, groupId, "넘겨받을동료")).userId,
    });

    expect(await readSystemKinds(groupId)).toEqual([
      // 모임을 만든 사람도 들어온 기록이 하나 남는다.
      "ADMIN_JOINED",
      "ADMIN_JOINED",
      "ADMIN_JOINED",
      "ADMIN_LEFT",
      "ADMIN_REMOVED",
      "ADMIN_JOINED",
      "OWNER_TRANSFERRED",
    ]);
  });
});

describe("보고 있는 모임(채널)", () => {
  it("속한 모임으로 전환하고 전체공개로 돌아온다", async () => {
    const admin = await newAdmin("채널전환자");
    const one = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-채널1` });
    const two = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-채널2` });

    // 마지막으로 만든 모임을 보고 있다.
    expect(await readActiveGroupId(admin.userId)).toBe(two.groupId);

    await setActiveGroup(admin.userId, one.groupId);
    expect(await readActiveGroupId(admin.userId)).toBe(one.groupId);

    // null 은 전체공개 채널이다.
    await setActiveGroup(admin.userId, null);
    expect(await readActiveGroupId(admin.userId)).toBeNull();
  });

  it("속하지 않은 모임은 볼 수 없다", async () => {
    const stranger = await newAdmin("남의채널");
    const owner = await newAdmin("채널주인");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-남의채널`,
    });
    await expect(setActiveGroup(stranger.userId, groupId)).rejects.toThrow(/속하지 않은 모임/);
    expect(await readActiveGroupId(stranger.userId)).toBeNull();
  });

  it("런타임 롤은 채널을 바꿀 수 없다", async () => {
    const admin = await newAdmin("직접변경시도");
    const { groupId } = await createGroupForAdmin({
      userId: admin.userId,
      name: `${TAG}-직접변경`,
    });
    // 앱 롤에는 이 컬럼의 UPDATE 권한이 없다(0036). 채널 전환은 인증 레이어만 한다.
    await expect(
      withRls(admin, (sql) =>
        sql.query(`UPDATE users SET active_group_id = NULL WHERE id = $1`, [admin.userId]),
      ),
    ).rejects.toThrow();
    expect(await readActiveGroupId(admin.userId)).toBe(groupId);
  });
});

describe("나가기와 보고 있는 모임", () => {
  it("전체공개를 보고 있으면 모임을 나가도 그대로 둔다", async () => {
    const admin = await newAdmin("전체공개유지");
    const { groupId } = await createGroupForAdmin({
      userId: admin.userId,
      name: `${TAG}-유지확인모임`,
    });
    // 일부러 전체공개로 옮겨 둔 상태다. 무관한 모임을 나갔다고 끌려가면 안 된다.
    await setActiveGroup(admin.userId, null);
    const result = await leaveGroup(admin.userId, groupId);
    expect(result.activeGroupId).toBeNull();
    expect(await readActiveGroupId(admin.userId)).toBeNull();
  });

  it("다른 모임을 보고 있으면 그 모임을 계속 본다", async () => {
    const admin = await newAdmin("다른방유지");
    const watching = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-보는방` });
    const leaving = await createGroupForAdmin({ userId: admin.userId, name: `${TAG}-떠나는방` });
    await setActiveGroup(admin.userId, watching.groupId);

    const result = await leaveGroup(admin.userId, leaving.groupId);
    expect(result.activeGroupId).toBe(watching.groupId);
  });
});
