"use client";

import { useEffect } from "react";

/**
 * 멤버·주선자 화면에서 사진 위의 우클릭·길게 누르기 메뉴(「이미지 저장」)를 띄우지 않는다.
 *
 * 캡처를 막는 장치가 아니다 — 원본 파일을 손쉽게 가져가는 길만 닫는다. 캡처에는
 * 서버가 합성한 보는 사람 표시가 남는다. 사진이 아닌 곳의 메뉴(글자 복사 등)는 그대로 둔다.
 *
 * `hideWhenAway` 면 탭을 떠나거나 창이 포커스를 잃는 동안 `<html data-photo-away>` 를
 * 달아 사진을 검게 덮는다(`globals.css`). 캡처 도구가 창을 가져가는 경우와 화면 녹화
 * 중 다른 창으로 옮기는 경우만 걸린다 — 단축키 캡처는 웹에서 알 수 없다.
 */
export function PhotoGuard({ hideWhenAway = false }: { hideWhenAway?: boolean }) {
  useEffect(() => {
    const block = (event: Event) => {
      if (event.target instanceof HTMLImageElement) event.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    document.addEventListener("dragstart", block);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
    };
  }, []);

  useEffect(() => {
    if (!hideWhenAway) return;
    const root = document.documentElement;
    const setAway = (away: boolean) => {
      if (away) root.dataset.photoAway = "";
      else delete root.dataset.photoAway;
    };
    const onVisibility = () => setAway(document.visibilityState === "hidden");
    const onBlur = () => setAway(true);
    const onFocus = () => setAway(false);
    // 처음 열릴 때는 숨은 탭인지만 본다. `hasFocus()` 까지 보면 포커스 없는
    // 헤드리스 브라우저(가이드 화면 사진)에서 사진이 검게 찍힌다.
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      setAway(false);
    };
  }, [hideWhenAway]);

  return null;
}
