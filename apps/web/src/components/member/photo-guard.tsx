"use client";

import { useEffect } from "react";

/**
 * 멤버 화면에서 사진 위의 우클릭·길게 누르기 메뉴(「이미지 저장」)를 띄우지 않는다.
 *
 * 캡처를 막는 장치가 아니다 — 원본 파일을 손쉽게 가져가는 길만 닫는다. 캡처에는
 * 서버가 합성한 보는 사람 표시가 남는다. 사진이 아닌 곳의 메뉴(글자 복사 등)는 그대로 둔다.
 */
export function PhotoGuard() {
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
  return null;
}
