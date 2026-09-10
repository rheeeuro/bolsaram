"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/**
 * 한 번만 보이는 값을 보여주고 복사시킨다.
 *
 * 초대 링크·입장코드·모임 초대 코드·텔레그램 연결 코드가 모두 이런 값이다 —
 * 발급 화면을 벗어나면 다시 볼 수 없고, 재발급하면 이전 것이 무효가 된다.
 * 그래서 **복사가 됐는지 확실히 말해준다.** 눌러도 아무 반응이 없으면 주선자는
 * 재발급을 눌러 방금 보낸 링크를 스스로 깨뜨린다.
 *
 * 클립보드는 실패할 수 있다(권한·비보안 컨텍스트). 그때는 직접 고르게 안내한다.
 */
export function CopyField({ label, value }: { label?: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <div>
      {label ? (
        <p className="mb-1 text-[11.5px] text-[var(--surface-text-muted)]">{label}</p>
      ) : null}
      <div className="flex gap-1.5">
        <Input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 flex-1 text-[11.5px]"
        />
        <Button
          size="sm"
          variant={state === "copied" ? "primary" : "secondary"}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setState("copied"))
              .catch(() => setState("failed"));
          }}
        >
          {state === "copied" ? "복사됨" : "복사"}
        </Button>
      </div>
      {state === "failed" ? (
        <p className="mt-1 text-[11px] text-[var(--color-danger)]">
          복사하지 못했습니다. 칸을 눌러 직접 선택해 주세요.
        </p>
      ) : null}
    </div>
  );
}
