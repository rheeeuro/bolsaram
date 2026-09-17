/**
 * 프로필 해시태그 — 값의 모양을 한 곳에서 정한다.
 *
 * 태그는 AI 가 원문에서 뽑고 주선자가 검토 화면에서 고친다. 검색이 걸리는 값이라
 * 저장 형태가 흔들리면 「#여행」과 「여행 」이 서로 다른 태그가 된다. 그래서 쓰기 경로
 * (추출 결과 · 주선자 편집)와 읽기 경로(검색 쿼리)가 **같은 정규화**를 통과한다.
 */
import { z } from "zod";

export const HASHTAG_MAX_LENGTH = 20;
export const HASHTAG_MAX_COUNT = 10;

/**
 * 태그 하나를 저장 형태로 만든다. `#` 없이, 공백·구두점 없이, 소문자로 둔다.
 * 규칙에 맞는 글자가 하나도 없으면 null 이다(버린다).
 */
export function normalizeHashtag(raw: string): string | null {
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\p{Z}\s]+/gu, "")
    .replace(/^#+/u, "")
    // 글자·숫자·밑줄만 남긴다. 이모지와 구두점은 검색어로 입력하기 어렵다.
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .toLowerCase();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, HASHTAG_MAX_LENGTH);
}

/** 목록을 정규화한다. 중복은 처음 것만 남기고, 상한을 넘으면 앞에서부터 자른다. */
export function normalizeHashtags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const tag = normalizeHashtag(item);
    if (tag == null || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= HASHTAG_MAX_COUNT) break;
  }
  return out;
}

/**
 * 모델이 돌려주는 형태. 여기에는 transform 을 걸지 않는다 —
 * 이 스키마에서 OpenAI strict JSON Schema 를 생성하므로 pipe/transform 이 섞이면 깨진다.
 * 정규화는 저장 직전(`normalizeHashtags`)에 한다.
 */
export const rawHashtagListSchema = z
  .array(z.string().trim().min(1).max(HASHTAG_MAX_LENGTH * 2))
  .max(HASHTAG_MAX_COUNT * 2);

/** 저장·검색에 쓰는 형태. 받는 즉시 정규화한다. */
export const hashtagListSchema = rawHashtagListSchema.transform(normalizeHashtags);

/** 자유 입력(`#여행 #운동`, `여행, 운동`)을 태그 목록으로 쪼갠다. */
export function parseHashtagInput(raw: string): string[] {
  return normalizeHashtags(raw.split(/[#,\n]|\s+/u));
}

/** 화면 표기. 저장값에는 `#` 이 없다. */
export function formatHashtag(tag: string): string {
  return `#${tag}`;
}
