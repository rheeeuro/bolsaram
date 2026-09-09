# @bolsaram/ui-tokens — 디자인 토큰

색·타이포·간격·모션 토큰. 볼사람은 주선자를 위한 서비스이고, 주선자 화면과 회원 화면이
**같은 토큰 위에 밀도만 다른 표면**을 얹는다. 두 화면이 한 제품으로 보이게 하는 것이
이 패키지의 역할이다.

> **불변식: CSS 가 원본이다.**
> `src/theme.css` 가 값의 소스 오브 트루스이고, `src/index.ts` 에는 코드에서 참조해야 하는
> 것만 미러링한다. 색을 새로 만들 때는 CSS 를 먼저 고친다.
> 컴포넌트에 색·간격 값을 하드코딩하지 않는다.
>
> 이 README 는 현재 구조의 소스 오브 트루스다. 토큰 계열을 추가·삭제하면 함께 갱신한다.
> 작업 규칙은 [`.ai-harness/project.md`](../../.ai-harness/project.md) 를 따른다.

---

## 코드 구조

```
packages/ui-tokens/src/
├── theme.css   Tailwind @theme 토큰 + 표면 클래스 (원본)
└── index.ts    브랜드 문구, 모션 길이, 카드 비율 (TS 미러)
```

---

## 토큰 계열

| 계열            | 변수                                               | 쓰임                                          |
| --------------- | -------------------------------------------------- | --------------------------------------------- |
| ivory           | `--color-ivory-50…400`                             | 두 화면 공통 바탕 (warm ivory)                |
| rose / burgundy | `--color-rose-100…600`, `--color-burgundy-700…900` | 강조·감정 구간                                |
| ink             | `--color-ink-100…900`                              | 글자·경계 (따뜻한 회갈색, **순수 검정 금지**) |
| 상태            | `--color-success/warning/danger/info`              | 배지·알림                                     |
| 타이포          | `--font-display`, `--font-sans`                    | serif display + clean sans                    |
| 리듬            | `--radius-*`, `--shadow-*`                         | 카드·시트                                     |
| 모션            | `--ease-soft`, `--duration-quick/base/emotive`     | 절제된 전환                                   |

## 표면 클래스

레이아웃 최상단에 하나를 붙이고, 컴포넌트는 `--surface-*` 를 참조한다.

| 클래스            | 어디        | 성격                                       |
| ----------------- | ----------- | ------------------------------------------ |
| `.member-surface` | 회원 화면   | ivory-50 바탕, rose 강조                   |
| `.host-surface`   | 주선자 화면 | ivory-100 바탕(한 단 낮춤), rose 강조      |

두 표면은 팔레트가 같고 바탕 단계만 다르다 — 주선자 화면은 목록과 폼이 길어서 흰 카드가
떠 보여야 읽힌다. 같은 `Button`·`Badge` 컴포넌트가 양쪽에서 그대로 쓰인다.

## 모션 규칙

`--duration-emotive`(520ms)는 **감정 구간에서만** 쓴다 — 마음 보내기 확인, 신청 직후 연출.
리스트·필터 같은 기능 화면은 `quick`(140ms) 또는 `base`(240ms)를 쓴다.
`prefers-reduced-motion` 에서는 전역으로 애니메이션이 꺼진다.

## 하지 말 것

- 하트 남발, Tinder 식 swipe (설계문서 §13)
- 특정 방송 프로그램의 디자인·로고 복제
- 주선자 화면에 중성 회색 CRM 팔레트 사용 — 주선자 화면도 볼사람이다

## 유지보수

- 토큰을 추가하면 `theme.css` → (필요 시) `index.ts` 순으로 고친다.
- 검증: `pnpm --filter @bolsaram/ui-tokens typecheck`, 화면은 `run-web` 스킬로 확인.
