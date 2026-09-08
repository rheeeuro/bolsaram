---
name: run-web
description: 볼사람 웹 앱을 띄우고 실제 화면·API 동작을 확인한다. 사용자가 앱 실행, 화면 확인, 동작 검증, 스크린샷을 요청할 때 사용한다.
---

# 웹 앱 실행과 동작 확인

## 어느 서버를 쓸지

- **PM2(운영 프로세스)** 가 이미 3020 을 쓰고 있다: `pm2 status bolsaram-web` 으로 확인.
  코드 변경을 반영하려면 `pnpm deploy:web` (빌드 + 재시작). 턴 종료 시 훅이 자동으로 한다.
- **개발 서버**로 확인하려면 먼저 PM2 앱을 멈춘다: `pm2 stop bolsaram-web` → `pnpm dev`.
  끝나면 `pm2 start bolsaram-web` 으로 되돌린다.

포트를 강제로 비우지 말 것. 이 호스트에는 다른 프로젝트 서버도 떠 있다.
`pkill -f next` 같은 광범위한 명령 대신 `ss -ltnp | grep ':3020'` 으로 PID 를 특정한다.

## 로그인

주선자 비밀번호는 저장소에 없다. 시드가 계정을 만들 때 한 번 출력하고, 이 호스트의
값은 교체돼 있다. 확인용 계정이 필요하면 `/api/auth/signup` 으로 새로 만든다.

```bash
# 주선자 — 확인용 계정을 만들어 쓴다(가입은 열려 있다. 비밀번호는 10자 이상)
PW="$(openssl rand -base64 12 | tr -d '/+=')"
curl -s -c /tmp/admin.jar -H 'content-type: application/json' \
  -d "{\"email\":\"check-$$@bolsaram.local\",\"password\":\"$PW\",\"displayName\":\"점검\"}" \
  http://127.0.0.1:3020/api/auth/signup

# 이미 아는 계정으로 들어갈 때
curl -s -c /tmp/admin.jar -H 'content-type: application/json' \
  -d "{\"email\":\"admin@bolsaram.local\",\"password\":\"$PW\"}" \
  http://127.0.0.1:3020/api/auth/admin-login

# 회원 — 비밀번호가 없다. 주선자로 초대를 발급해 그 토큰을 소비한다(1회용).
TOKEN=$(curl -s -b /tmp/admin.jar -H 'content-type: application/json' \
  -d '{"profileId":"<프로필 UUID>","expiresInHours":72}' \
  http://127.0.0.1:3020/api/admin/invites \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')
curl -s -c /tmp/m.jar -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\"}" http://127.0.0.1:3020/api/claim
```

프로필 UUID 는 `db-query` 스킬로 찾는다(`SELECT id, public_code FROM profiles LIMIT 5`).
토큰은 **입장코드와 같은 값**이고 한 번 쓰면 무효다 — 다시 로그인하려면 새로 발급한다.
신청/수락을 확인하려면 서로 다른 두 계정이 필요하다.

## 확인할 것

변경한 화면에 따라 골라 확인하고, **결과를 추측하지 말고 실제 응답을 인용**한다.

- 인증 화면: `/` `/enter`(회원 입장코드) `/login`(주선자) `/signup` `/claim/<토큰>`
- 회원 화면: `/discover` `/discover/<id>` `/signals` `/favorites` `/me`
- 관리자 화면: `/admin` `/admin/imports` `/admin/profiles` `/admin/requests` `/admin/members`
- 권한: 쿠키 없이 호출해 401, 회원 쿠키로 `/admin` 호출해 `/discover` 리다이렉트인지
- 정보 공개: 연결되지 않은 상대의 상세에 `realName` 키가 **없는지**

## 브라우저 스크린샷

이 호스트에는 Chromium 실행에 필요한 시스템 라이브러리(`libatk-1.0`)가 없어 Playwright 가
브라우저를 띄우지 못한다. 스크린샷 대신 렌더링된 HTML 에서 핵심 요소를 grep 으로 확인한다.
설치가 필요하면 사용자에게 먼저 확인한다(시스템 패키지 변경이다).
