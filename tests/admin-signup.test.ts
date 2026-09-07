/**
 * 주선자 가입 · 전체공개 풀 · 모임 참여 통합 테스트.
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
  consumeGroupInvite,
  issueGroupInvite,
  leaveGroup,
  readMyGroup,
  updateGroup,
} from "../apps/web/src/server/auth/group-invite";
import { loginAdmin } from "../apps/web/src/server/auth/login";
import { createGroupForAdmin, signupAdmin } from "../apps/web/src/server/auth/signup";

const TAG = `signuptest-${Date.now()}`;
const PASSWORD = "signup-password-1234";

let seq = 0;
function nextEmail(): string {
  seq += 1;
  return `${TAG}-${seq}@test.local`;
}

async function newAdmin(label: string): Promise<RlsContext & { userId: string }> {
  const created = await signupAdmin({
    email: nextEmail(),
    password: PASSWORD,
    displayName: `${TAG}-${label}`,
  });
  return { userId: created.userId, role: "ADMIN" };
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
    await sql.query(`DELETE FROM admin_login_failures WHERE email LIKE $1`, [`${TAG}%`]);
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

  it("가입한 비밀번호로 바로 로그인된다", async () => {
    const email = nextEmail();
    const created = await signupAdmin({
      email,
      password: PASSWORD,
      displayName: `${TAG}-로그인`,
    });
    await expect(loginAdmin(email, PASSWORD)).resolves.toBe(created.userId);
  });

  it("같은 이메일로 두 번 가입할 수 없다", async () => {
    const email = nextEmail();
    const base = { password: PASSWORD, displayName: `${TAG}-중복` };
    await signupAdmin({ email, ...base });
    await expect(signupAdmin({ email, ...base })).rejects.toThrow(/이미 등록된 이메일/);
  });
});

describe("전체공개 풀", () => {
  it("갓 가입한 주선자에게 전체공개 프로필이 보인다", async () => {
    const owner = await newAdmin("공개등록자");
    const publicId = await seedProfile({
      groupId: null,
      createdBy: owner.userId,
      name: "공개회원",
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
      name: "모임회원",
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
      name: "남의공개회원",
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
      name: "내공개회원",
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

  it("이미 모임에 속해 있으면 합류할 수 없다", async () => {
    const owner = await newAdmin("A모임장");
    const a = await createGroupForAdmin({ userId: owner.userId, name: `${TAG}-A모임` });
    const other = await newAdmin("B모임장");
    await createGroupForAdmin({ userId: other.userId, name: `${TAG}-B모임` });

    const issued = await issueGroupInvite({ groupId: a.groupId, createdBy: owner.userId });
    await expect(
      consumeGroupInvite({ code: issued.code, userId: other.userId }),
    ).rejects.toThrow(/이미 모임에 속해/);
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
    const group = await readMyGroup(owner.userId);
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
    const group = await readMyGroup(owner.userId);
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
    expect(await readMyGroup(owner.userId)).toMatchObject({
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
    expect(await readMyGroup(owner.userId)).toMatchObject({ description: null });
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

    expect(await readMyGroup(owner.userId)).toMatchObject({ isOwner: true });
    expect(await readMyGroup(invited.userId)).toMatchObject({ isOwner: false });
  });
});

describe("모임 나가기", () => {
  it("빈 모임은 나가면서 사라진다", async () => {
    const admin = await newAdmin("빈모임장");
    const { groupId } = await createGroupForAdmin({
      userId: admin.userId,
      name: `${TAG}-빈모임`,
    });
    const result = await leaveGroup(admin.userId);
    expect(result.deletedGroup).toBe(true);
    expect(await readMyGroup(admin.userId)).toBeNull();

    const left = await withOwner(async (sql) => {
      const r = await sql.query(`SELECT 1 FROM groups WHERE id = $1`, [groupId]);
      return r.rowCount ?? 0;
    });
    // 주인 없는 빈 모임을 남기지 않는다.
    expect(left).toBe(0);
  });

  it("마지막 주선자는 회원이 남아 있으면 나갈 수 없다", async () => {
    const admin = await newAdmin("마지막주선자");
    const { groupId } = await createGroupForAdmin({
      userId: admin.userId,
      name: `${TAG}-회원있는모임`,
    });
    await seedProfile({ groupId, createdBy: admin.userId, name: "남는회원" });

    // 나가면 그 회원을 아무도 볼 수 없게 된다 — 되돌릴 방법이 없으므로 막는다.
    await expect(leaveGroup(admin.userId)).rejects.toThrow(/남아 있어 나갈 수 없습니다/);
    expect(await readMyGroup(admin.userId)).not.toBeNull();
  });

  it("동료가 있으면 회원이 남아 있어도 나갈 수 있다", async () => {
    const owner = await newAdmin("떠나는개설자");
    const { groupId } = await createGroupForAdmin({
      userId: owner.userId,
      name: `${TAG}-인수모임`,
    });
    await seedProfile({ groupId, createdBy: owner.userId, name: "인수될회원" });

    const issued = await issueGroupInvite({ groupId, createdBy: owner.userId });
    const successor = await newAdmin("후임");
    await consumeGroupInvite({ code: issued.code, userId: successor.userId });

    const result = await leaveGroup(owner.userId);
    expect(result.deletedGroup).toBe(false);
    expect(await readMyGroup(owner.userId)).toBeNull();

    // 개설자가 후임에게 넘어가야 한다 — 개설자 없는 모임을 만들 수 없다.
    const after = await readMyGroup(successor.userId);
    expect(after).toMatchObject({ groupId, isOwner: true });
    expect(after?.admins).toHaveLength(1);
  });

  it("나간 뒤에는 그 모임 회원이 보이지 않는다", async () => {
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

    await leaveGroup(owner.userId);
    const visible = await withRls(owner, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [hidden]);
      return r.rowCount ?? 0;
    });
    expect(visible).toBe(0);
  });

  it("모임이 없으면 나갈 수 없다", async () => {
    const admin = await newAdmin("무소속나가기");
    await expect(leaveGroup(admin.userId)).rejects.toThrow(/속한 모임이 없습니다/);
  });
});
