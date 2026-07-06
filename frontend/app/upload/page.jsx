import { Suspense } from "react";

import UploadClient from "./UploadClient";

export const metadata = {
  title: "프로필 업로드 · 볼사람",
};

export default function UploadPage() {
  return (
    <Suspense fallback={<main className="upload-screen"><section className="upload-panel"><p>업로드 링크를 확인하는 중</p></section></main>}>
      <UploadClient />
    </Suspense>
  );
}
