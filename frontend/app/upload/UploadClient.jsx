"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { API_URL } from "../lib";

const initialForm = {
  alias: "",
  gender: "여",
  age: "",
  region: "",
  job: "",
  height: "",
  description: "",
  ideal: "",
  privacy: "그룹 내 공개",
};

export default function UploadClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [form, setForm] = useState(initialForm);
  const [files, setFiles] = useState([]);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");

  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("업로드 토큰이 없습니다.");
      return;
    }
    let alive = true;
    fetch(`${API_URL}/api/upload-tokens/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || "업로드 링크를 확인하지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        if (!alive) return;
        setTokenInfo(payload);
        setStatus("ready");
      })
      .catch((error) => {
        if (!alive) return;
        setStatus("error");
        setMessage(error.message);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const onPickFiles = (event) => {
    const picked = Array.from(event.target.files || []);
    setFiles((current) => [...current, ...picked].slice(0, 3));
    event.target.value = "";
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!files.length) {
      setMessage("사진을 1장 이상 첨부해 주세요.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = new FormData();
    body.append("token", token);
    Object.entries(form).forEach(([key, value]) => body.append(key, value));
    files.forEach((file) => body.append("images", file));
    try {
      const response = await fetch(`${API_URL}/api/profiles`, { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "등록에 실패했습니다.");
      setStatus("done");
      setMessage(payload.message || "프로필 등록이 완료되었습니다.");
      setFiles([]);
    } catch (error) {
      setStatus("ready");
      setMessage(error.message);
    }
  };

  if (status === "checking") {
    return <main className="upload-screen"><section className="upload-panel"><p>업로드 링크를 확인하는 중</p></section></main>;
  }

  if (status === "error") {
    return <main className="upload-screen"><section className="upload-panel"><h1>업로드할 수 없습니다</h1><p>{message}</p></section></main>;
  }

  if (status === "done") {
    return <main className="upload-screen"><section className="upload-panel"><h1>등록 완료</h1><p>{message}</p><p className="upload-muted">관리자가 볼사람 웹에서 등록 내용을 확인할 수 있습니다.</p></section></main>;
  }

  return (
    <main className="upload-screen">
      <section className="upload-panel">
        <div className="upload-heading">
          <span>볼사람</span>
          <h1>프로필 업로드</h1>
          <p>{tokenInfo?.roomName || "방"}에 등록됩니다. 링크는 1회만 사용할 수 있습니다.</p>
        </div>
        <form className="upload-form" onSubmit={submit}>
          <label className="upload-field"><span>이름 또는 별칭</span><input value={form.alias} onChange={(event) => set("alias", event.target.value)} placeholder="95년생 여성 A" /></label>
          <div className="upload-grid">
            <label className="upload-field"><span>성별</span><select value={form.gender} onChange={(event) => set("gender", event.target.value)}><option value="여">여</option><option value="남">남</option></select></label>
            <label className="upload-field"><span>나이</span><input type="number" min="18" max="80" value={form.age} onChange={(event) => set("age", event.target.value)} required placeholder="31" /></label>
          </div>
          <div className="upload-grid">
            <label className="upload-field"><span>지역</span><input value={form.region} onChange={(event) => set("region", event.target.value)} required placeholder="서울 강남" /></label>
            <label className="upload-field"><span>키</span><input type="number" min="100" max="250" value={form.height} onChange={(event) => set("height", event.target.value)} placeholder="165" /></label>
          </div>
          <label className="upload-field"><span>직업</span><input value={form.job} onChange={(event) => set("job", event.target.value)} required placeholder="IT 서비스 기획" /></label>
          <label className="upload-field"><span>소개글</span><textarea rows={4} value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="성격, 취미, 참고할 내용을 적어주세요." /></label>
          <label className="upload-field"><span>원하는 상대 조건</span><input value={form.ideal} onChange={(event) => set("ideal", event.target.value)} placeholder="대화가 잘 통하는 분" /></label>
          <label className="upload-field"><span>공개 여부</span><select value={form.privacy} onChange={(event) => set("privacy", event.target.value)}><option value="그룹 내 공개">그룹 내 공개</option><option value="전체 공개">전체 공개</option><option value="비공개">비공개</option></select></label>
          <div className="upload-photos">
            <div><strong>사진</strong><span>{files.length}/3</span></div>
            <div className="upload-preview-row">
              {previews.map((preview, index) => <figure key={preview.url} className="upload-preview"><img src={preview.url} alt="" /><button type="button" onClick={() => setFiles(files.filter((_, position) => position !== index))}>삭제</button></figure>)}
              {files.length < 3 && <label className="upload-add"><input type="file" accept="image/*" multiple onChange={onPickFiles} />사진 추가</label>}
            </div>
          </div>
          {message && <div className="upload-message">{message}</div>}
          <button className="primary-button full-width" type="submit" disabled={status === "submitting"}>{status === "submitting" ? "저장 중" : "저장"}</button>
        </form>
      </section>
    </main>
  );
}
