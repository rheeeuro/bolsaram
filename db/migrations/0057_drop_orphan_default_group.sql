-- 빈 DB에 설치하면 0010 의 이관 블록이 주선자도 프로필도 없는 「기본 모임」을 하나 남긴다.
-- 소속 주선자가 없어 아무도 보거나 고칠 수 없는 모임이므로 지운다.
-- 기존 데이터를 이관받은 기본 모임(주선자나 프로필이 있는 경우)은 그대로 둔다.
DELETE FROM groups g
 WHERE g.name = '기본 모임'
   AND g.created_by IS NULL
   AND NOT EXISTS (SELECT 1 FROM group_admins ga WHERE ga.group_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.group_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM import_sessions s WHERE s.group_id = g.id);
