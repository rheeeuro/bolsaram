/**
 * 서버 기동 훅.
 *
 * 이 파일은 Node 와 Edge 런타임 양쪽에서 평가되므로 여기에는 분기만 둔다.
 * 실제 기동 작업(환경변수 검증, 네트워크 설정)은 `startup-node.ts` 에 있다 —
 * Node 전용 모듈을 여기서 직접 import 하면 번들러가 Edge 기준으로 경고한다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startup } = await import("./startup-node");
  startup();
}
