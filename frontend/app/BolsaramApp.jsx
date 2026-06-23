"use client";

import { useEffect, useMemo, useState } from "react";

import { API_URL, CURRENT_YEAR, statuses, matchStatuses, emptyCandidate, defaultFilters, api, roomUrl, roomIdFromPath, updateBrowserUrl, normalize, age, initials, primaryPhotoUrl, splitWords, jobGroup, closeRegion, matchScore, parseRawProfile, shareMessage, detectPrivacyRisks } from "./lib";

export default function BolsaramApp({ initialInviteCode = "", initialRoomId = "" }) {
  const [authMode, setAuthMode] = useState("login");
  const [auth, setAuth] = useState({ name: "", email: "", password: "" });
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [publicRooms, setPublicRooms] = useState([]);
  const [room, setRoom] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [matches, setMatches] = useState([]);
  const [members, setMembers] = useState([]);
  const [view, setView] = useState("candidates");
  const [selectedId, setSelectedId] = useState(null);
  const [sortMode, setSortMode] = useState("recent");
  const [filters, setFilters] = useState(defaultFilters);
  const [candidateDraft, setCandidateDraft] = useState(emptyCandidate);
  const [editingId, setEditingId] = useState(null);
  const [roomDraft, setRoomDraft] = useState({ name: "", visibility: "public" });
  const [joinCode, setJoinCode] = useState(initialInviteCode);
  const [joinMode, setJoinMode] = useState("public");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [tone, setTone] = useState("clean");
  const [includeClean, setIncludeClean] = useState(true);
  const [loading, setLoading] = useState(true);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const loadRoomState = async (roomId, options = {}) => {
    const payload = await api(`/api/rooms/${roomId}/state`);
    setRoom(payload.room);
    setCandidates(payload.candidates);
    setLogs(payload.logs);
    setMatches(payload.matches || []);
    setSelectedId((current) => (payload.candidates.some((candidate) => candidate.id === current) ? current : payload.candidates[0]?.id || null));
    if (options.syncUrl !== false) updateBrowserUrl(roomUrl(payload.room.id));
  };

  const clearRoomState = (options = {}) => {
    setRoom(null);
    setCandidates([]);
    setLogs([]);
    setMatches([]);
    setView("candidates");
    setSelectedId(null);
    if (options.syncUrl !== false) updateBrowserUrl("/");
  };

  const loadRooms = async (preferredRoomId = null, openPreferred = false) => {
    const payload = await api("/api/rooms");
    setRooms(payload.rooms);
    if (openPreferred && preferredRoomId) {
      await loadRoomState(preferredRoomId);
    } else if (room && !payload.rooms.some((item) => item.id === room.id)) {
      clearRoomState();
    }
  };

  const loadPublicRooms = async () => {
    const payload = await api("/api/rooms/public");
    setPublicRooms(payload.rooms);
  };

  const openJoinModal = () => {
    setJoinMode("public");
    setModal("join");
    loadPublicRooms().catch((error) => notify(error.message));
  };

  const startApp = async (currentUser, code = joinCode, roomId = initialRoomId) => {
    setUser(currentUser);
    if (code) {
      try {
        const joined = await api("/api/rooms/join", { method: "POST", body: { code } });
        setJoinCode("");
        await loadRooms(joined.room.id, true);
        notify("비공개방에 입장했습니다.");
        return;
      } catch (error) {
        notify(error.message);
      }
    }
    await loadRooms(roomId || null, Boolean(roomId));
  };

  useEffect(() => {
    let alive = true;
    api("/api/me")
      .then(async ({ user: currentUser }) => {
        if (!alive) return;
        if (currentUser) await startApp(currentUser, initialInviteCode, initialRoomId);
      })
      .catch((error) => notify(error.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    const syncFromLocation = () => {
      const pathRoomId = roomIdFromPath(window.location.pathname);
      setModal(null);
      if (pathRoomId) {
        loadRoomState(pathRoomId, { syncUrl: false }).catch((error) => notify(error.message));
      } else {
        clearRoomState({ syncUrl: false });
      }
    };

    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [user]);

  const selected = useMemo(() => candidates.find((candidate) => candidate.id === selectedId) || candidates[0] || null, [candidates, selectedId]);

  const filteredCandidates = useMemo(() => {
    const rows = candidates.filter((candidate) => {
      const text = normalize([candidate.alias, candidate.gender, candidate.location, candidate.job, candidate.education, candidate.religion, candidate.smoke, candidate.drink, candidate.mbti, candidate.personality, candidate.hobbies, candidate.ideal, candidate.memo, candidate.status].join(" "));
      if (filters.search && !text.includes(normalize(filters.search))) return false;
      if (filters.gender !== "all" && candidate.gender !== filters.gender) return false;
      if (filters.minAge && age(candidate) < Number(filters.minAge)) return false;
      if (filters.maxAge && age(candidate) > Number(filters.maxAge)) return false;
      if (filters.minHeight && Number(candidate.height) < Number(filters.minHeight)) return false;
      if (filters.region && !normalize(candidate.location).includes(normalize(filters.region))) return false;
      if (filters.job !== "all" && jobGroup(candidate.job) !== filters.job) return false;
      if (filters.religion !== "all" && candidate.religion !== filters.religion) return false;
      if (filters.nonSmoker && candidate.smoke !== "비흡연") return false;
      if (filters.status !== "all" && candidate.status !== filters.status) return false;
      return true;
    });
    return rows.sort((a, b) => (sortMode === "score" && selected ? matchScore(selected, b).score - matchScore(selected, a).score : new Date(b.createdAt) - new Date(a.createdAt)));
  }, [candidates, filters, selected, sortMode]);

  const duplicatePreview = useMemo(() => {
    if (!candidateDraft.alias && !candidateDraft.birthYear) return null;
    return candidates.find((other) => {
      if (editingId && other.id === editingId) return false;
      const sameAlias = normalize(other.alias) && normalize(other.alias) === normalize(candidateDraft.alias);
      const sameProfile = other.gender === candidateDraft.gender && Math.abs(other.birthYear - Number(candidateDraft.birthYear)) <= 1 && normalize(other.location) === normalize(candidateDraft.location) && normalize(other.job).slice(0, 4) === normalize(candidateDraft.job).slice(0, 4);
      return sameAlias || sameProfile;
    });
  }, [candidateDraft, candidates, editingId]);

  const duplicateCandidates = (base = null) => {
    const duplicates = [];
    candidates.forEach((candidate, index) => {
      candidates.slice(index + 1).forEach((other) => {
        const sameProfile = candidate.gender === other.gender && Math.abs(candidate.birthYear - other.birthYear) <= 1 && normalize(candidate.location) === normalize(other.location) && normalize(candidate.job).slice(0, 4) === normalize(other.job).slice(0, 4);
        const sameAlias = normalize(candidate.alias) && normalize(candidate.alias) === normalize(other.alias);
        if ((sameProfile || sameAlias) && (!base || candidate.id === base.id || other.id === base.id)) duplicates.push(candidate.id === base?.id ? other : candidate);
      });
    });
    return duplicates;
  };

  const stats = {
    available: candidates.filter((candidate) => candidate.status === "소개 가능").length,
    reviewing: candidates.filter((candidate) => ["검토 중", "제안 완료"].includes(candidate.status)).length,
    duplicates: duplicateCandidates().length,
  };

  const recommendations = selected
    ? candidates
        .filter((other) => other.id !== selected.id && other.gender !== selected.gender)
        .map((candidate) => ({ candidate, ...matchScore(selected, candidate) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    : [];

  const operatorChecks = selected
    ? [
        { level: duplicateCandidates(selected)[0] ? "risk" : "", text: duplicateCandidates(selected)[0] ? `${duplicateCandidates(selected)[0].alias} 후보와 중복 가능성이 있습니다.` : "중복 의심 항목이 없습니다." },
        { level: selected.privacy === "비공개" ? "warn" : "", text: `${selected.privacy} 상태입니다.` },
        { level: selected.smoke === "미입력" ? "warn" : "", text: selected.smoke === "미입력" ? "흡연 여부 재확인이 필요합니다." : `${selected.smoke}으로 기록되어 있습니다.` },
        { level: ["거절", "보류", "매칭 완료"].includes(selected.status) ? "risk" : "", text: `현재 상태는 ${selected.status}입니다.` },
      ]
    : [];

  const ownLogs = selected ? logs.filter((log) => log.pair.includes(selected.id)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const isViewer = room?.role === "viewer";
  const shareText = selected ? shareMessage(selected, tone, includeClean) : "";
  const shareRisks = selected ? detectPrivacyRisks([selected.job, selected.education, selected.location, selected.personality, selected.ideal, selected.memo].join(" ")) : [];

  const submitAuth = async (event) => {
    event.preventDefault();
    try {
      const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = authMode === "signup" ? auth : { email: auth.email, password: auth.password };
      const payload = await api(endpoint, { method: "POST", body });
      await startApp(payload.user);
    } catch (error) {
      notify(error.message);
    }
  };

  const createRoom = async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/rooms", { method: "POST", body: roomDraft });
      setModal(null);
      setRoomDraft({ name: "", visibility: "public" });
      await loadRooms(payload.room.id, true);
      notify(payload.room.visibility === "private" ? `비공개방 코드 ${payload.room.inviteCode}가 발급됐습니다.` : "공개방을 생성했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const joinRoom = async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/rooms/join", { method: "POST", body: { code: joinCode } });
      setJoinCode("");
      setModal(null);
      await loadRooms(payload.room.id, true);
      notify("비공개방에 입장했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const joinPublicRoom = async (targetRoom) => {
    try {
      if (targetRoom.isMember) {
        setModal(null);
        await loadRoomState(targetRoom.id);
        return;
      }
      const payload = await api("/api/rooms/join-public", { method: "POST", body: { roomId: targetRoom.id } });
      setModal(null);
      await loadRooms(payload.room.id, true);
      notify("공개방에 입장했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const openCandidateCreate = () => {
    setEditingId(null);
    setCandidateDraft(emptyCandidate);
    setModal("candidate");
  };

  const openCandidateEdit = (candidate) => {
    setEditingId(candidate.id);
    setCandidateDraft({
      ...emptyCandidate,
      ...candidate,
      birthYear: String(candidate.birthYear ?? ""),
      height: candidate.height ? String(candidate.height) : "",
      rawText: "",
    });
    setModal("candidate");
  };

  const saveCandidate = async (event) => {
    event.preventDefault();
    if (!room) return notify("먼저 방을 선택해 주세요.");
    try {
      const body = { ...candidateDraft, birthYear: Number(candidateDraft.birthYear), height: candidateDraft.height ? Number(candidateDraft.height) : null };
      delete body.rawText;
      if (editingId) {
        const payload = await api(`/api/candidates/${editingId}`, { method: "PATCH", body });
        setCandidates((items) => items.map((item) => (item.id === payload.candidate.id ? payload.candidate : item)));
        setSelectedId(payload.candidate.id);
        notify("후보 정보를 수정했습니다.");
      } else {
        const payload = await api(`/api/rooms/${room.id}/candidates`, { method: "POST", body });
        setCandidates((items) => [payload.candidate, ...items]);
        setSelectedId(payload.candidate.id);
        notify("후보를 등록했습니다.");
      }
      setCandidateDraft(emptyCandidate);
      setEditingId(null);
      setModal(null);
    } catch (error) {
      notify(error.message);
    }
  };

  const deleteCandidate = async (candidate) => {
    if (!candidate) return;
    if (typeof window !== "undefined" && !window.confirm(`${candidate.alias} 후보를 삭제할까요? 관련 진행 로그도 함께 삭제됩니다.`)) return;
    try {
      await api(`/api/candidates/${candidate.id}`, { method: "DELETE" });
      setCandidates((items) => {
        const next = items.filter((item) => item.id !== candidate.id);
        setSelectedId((current) => (current === candidate.id ? next[0]?.id || null : current));
        return next;
      });
      setLogs((items) => items.filter((log) => !log.pair.includes(candidate.id)));
      notify("후보를 삭제했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const uploadPhoto = async (file) => {
    if (!file || !selected) return;
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_URL}/api/candidates/${selected.id}/photos`, { method: "POST", credentials: "include", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "사진 업로드에 실패했습니다.");
      setCandidates((items) => items.map((item) => (item.id === payload.candidate.id ? payload.candidate : item)));
      notify("사진을 추가했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const removePhoto = async (photoId) => {
    try {
      const payload = await api(`/api/photos/${photoId}`, { method: "DELETE" });
      setCandidates((items) => items.map((item) => (item.id === payload.candidate.id ? payload.candidate : item)));
      notify("사진을 삭제했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const saveStatus = async (status) => {
    if (!selected) return;
    try {
      const payload = await api(`/api/candidates/${selected.id}/status`, { method: "PATCH", body: { status } });
      setCandidates((items) => items.map((item) => (item.id === payload.candidate.id ? payload.candidate : item)));
      setLogs(payload.logs);
      notify("상태를 저장했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const addReviewLog = async (otherId = null) => {
    if (!room || !selected) return;
    const other = candidates.find((candidate) => candidate.id === otherId) || recommendations[0]?.candidate;
    if (!other) return;
    try {
      const payload = await api(`/api/rooms/${room.id}/logs`, { method: "POST", body: { candidateId: Number(selected.id), otherId: Number(other.id) } });
      setLogs((items) => [payload.log, ...items]);
      setCandidates(payload.candidates);
      notify("검토 로그를 추가했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const createMatch = async (aId, bId) => {
    if (!room || !aId || !bId) return;
    try {
      const payload = await api(`/api/rooms/${room.id}/matches`, { method: "POST", body: { candidateAId: Number(aId), candidateBId: Number(bId) } });
      setMatches((items) => [payload.match, ...items.filter((item) => item.id !== payload.match.id)]);
      if (payload.logs) setLogs(payload.logs);
      notify("매칭 보드에 추가했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const updateMatchStatus = async (matchId, status) => {
    try {
      const payload = await api(`/api/matches/${matchId}/status`, { method: "PATCH", body: { status } });
      setMatches((items) => items.map((item) => (item.id === payload.match.id ? payload.match : item)));
      if (payload.logs) setLogs(payload.logs);
      notify("매칭 상태를 변경했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const openMembersModal = async () => {
    if (!room) return;
    setModal("members");
    try {
      const payload = await api(`/api/rooms/${room.id}/members`);
      setMembers(payload.members);
    } catch (error) {
      notify(error.message);
    }
  };

  const changeRole = async (memberId, role) => {
    try {
      const payload = await api(`/api/rooms/${room.id}/members/${memberId}`, { method: "PATCH", body: { role } });
      setMembers(payload.members);
      notify("역할을 변경했습니다.");
    } catch (error) {
      notify(error.message);
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setRooms([]);
    setPublicRooms([]);
    setRoom(null);
    setCandidates([]);
    setLogs([]);
    setMatches([]);
  };

  if (loading) return <div className="loading-screen">볼사람을 불러오는 중</div>;

  if (!user) {
    const isSignup = authMode === "signup";
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <Brand centered />
          <form className="auth-form" onSubmit={submitAuth}>
            <div>
              <h2>{isSignup ? "회원가입" : "로그인"}</h2>
              <p>{isSignup ? "가입하면 기본 공개방이 자동으로 생성됩니다." : initialInviteCode ? `비공개방 코드 ${initialInviteCode}로 입장하려면 먼저 로그인해 주세요.` : initialRoomId ? `방 ${initialRoomId}로 입장하려면 먼저 로그인해 주세요.` : "계정으로 입장해 방별 후보 데이터를 관리하세요."}</p>
            </div>
            {isSignup && <Field label="이름"><input value={auth.name} onChange={(event) => setAuth({ ...auth, name: event.target.value })} required autoComplete="name" placeholder="홍길동" /></Field>}
            <Field label="이메일"><input type="email" value={auth.email} onChange={(event) => setAuth({ ...auth, email: event.target.value })} required autoComplete="email" placeholder="you@example.com" /></Field>
            <Field label="비밀번호"><input type="password" value={auth.password} onChange={(event) => setAuth({ ...auth, password: event.target.value })} required minLength={6} autoComplete={isSignup ? "new-password" : "current-password"} placeholder="6자 이상" /></Field>
            <button className="primary-button full-width" type="submit">{isSignup ? "회원가입" : "로그인"}</button>
            <button className="text-button auth-toggle" type="button" onClick={() => setAuthMode(isSignup ? "login" : "signup")}>{isSignup ? "로그인으로 전환" : "회원가입으로 전환"}</button>
          </form>
        </section>
        <Toast message={toast} />
      </main>
    );
  }

  if (!room) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <Brand caption={`${user.name}님 · ${user.email}`} />
          <div className="room-bar">
            <button className="secondary-button" type="button" onClick={() => setModal("room")}>방 생성</button>
            <button className="primary-button" type="button" onClick={openJoinModal}>새로운 방 참가하기</button>
          </div>
          <div className="top-actions">
            <button className="text-button" type="button" onClick={logout}>로그아웃</button>
          </div>
        </header>

        <RoomHome rooms={rooms} onOpen={(targetRoom) => loadRoomState(targetRoom.id).catch((error) => notify(error.message))} onCreate={() => setModal("room")} onJoin={openJoinModal} />

        {modal === "room" && <Modal title="방 생성" description="공개방은 로그인 사용자에게 보이고, 비공개방은 링크나 코드로 입장합니다." onClose={() => setModal(null)}><form onSubmit={createRoom}><Field label="방 이름"><input value={roomDraft.name} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value })} required placeholder="30대 초중반 소개팅방" /></Field><Field label="공개 설정"><select value={roomDraft.visibility} onChange={(event) => setRoomDraft({ ...roomDraft, visibility: event.target.value })}><option value="public">공개방</option><option value="private">비공개방</option></select></Field><div className="dialog-footer"><button className="text-button" type="button" onClick={() => setModal(null)}>취소</button><button className="primary-button" type="submit">생성</button></div></form></Modal>}
        {modal === "join" && <JoinRoomModal mode={joinMode} setMode={setJoinMode} publicRooms={publicRooms} joinCode={joinCode} setJoinCode={setJoinCode} onJoinPrivate={joinRoom} onJoinPublic={joinPublicRoom} onRefreshPublic={loadPublicRooms} onClose={() => setModal(null)} />}
        <Toast message={toast} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand caption={`${user.name}님 · ${user.email}`} />
        <div className="room-bar">
          <button className="secondary-button" type="button" onClick={clearRoomState}>방 목록</button>
          <label className="room-select-label">
            <span>방</span>
            <select value={room?.id || ""} onChange={(event) => loadRoomState(event.target.value).catch((error) => notify(error.message))} disabled={!rooms.length}>
              {rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <span className={`room-badge ${room?.visibility === "private" ? "private" : ""}`}>{room?.visibility === "private" ? "비공개" : "공개"}</span>
          {isViewer && <span className="room-badge viewer">읽기 전용</span>}
          <button className="secondary-button" type="button" onClick={openMembersModal}>멤버</button>
          <button className="secondary-button" type="button" onClick={() => setModal("room")}>방 생성</button>
          <button className="secondary-button" type="button" onClick={openJoinModal}>새로운 방 참가하기</button>
          <button className="icon-button" type="button" disabled={!room || room.visibility !== "private"} title="입장 링크 복사" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}${room.inviteUrl}`);
            notify(`입장 링크와 코드 ${room.inviteCode}를 복사했습니다.`);
          }}>링크</button>
        </div>
        <div className="top-actions">
          {!isViewer && <button className="icon-button" type="button" title="현재 방에 샘플 데이터 복원" onClick={async () => {
            if (!room) return;
            const payload = await api(`/api/rooms/${room.id}/sample`, { method: "POST" });
            setCandidates(payload.candidates);
            setLogs(payload.logs);
            setSelectedId(payload.candidates[0]?.id || null);
            notify("현재 방에 샘플 데이터를 복원했습니다.");
          }}>복원</button>}
          {!isViewer && <button className="primary-button" type="button" onClick={openCandidateCreate}>후보 등록</button>}
          <button className="text-button" type="button" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <div className="room-meta">
        <span>방 아이디 <strong>{room.id}</strong></span><span className="meta-divider">{`${typeof window !== "undefined" ? window.location.origin : ""}${roomUrl(room.id)}`}</span>
        {room?.visibility === "private" ? <><span>입장 코드 <strong>{room.inviteCode}</strong></span><span className="meta-divider">{`${typeof window !== "undefined" ? window.location.origin : ""}${room.inviteUrl}`}</span>{room.role === "owner" && <button className="text-button" type="button" onClick={async () => {
          const payload = await api(`/api/rooms/${room.id}/regenerate-code`, { method: "POST" });
          setRoom(payload.room);
          setRooms((items) => items.map((item) => item.id === payload.room.id ? payload.room : item));
          notify("입장 코드를 재발급했습니다.");
        }}>코드 재발급</button>}</> : <span>공개방입니다.</span>}
      </div>

      <nav className="workspace-tabs">
        <button className={`tab-button ${view === "dashboard" ? "active" : ""}`} type="button" onClick={() => setView("dashboard")}>현황</button>
        <button className={`tab-button ${view === "candidates" ? "active" : ""}`} type="button" onClick={() => setView("candidates")}>후보 {candidates.length}</button>
        <button className={`tab-button ${view === "board" ? "active" : ""}`} type="button" onClick={() => setView("board")}>매칭 보드 {matches.length}</button>
      </nav>

      {view === "dashboard" && <Dashboard candidates={candidates} matches={matches} logs={logs} onOpenCandidates={() => setView("candidates")} onOpenBoard={() => setView("board")} />}

      {view === "candidates" && <main className="workspace">
        <aside className="filter-panel">
          <div className="panel-heading"><h2>필터</h2><button className="text-button" type="button" onClick={() => setFilters(defaultFilters)}>초기화</button></div>
          <Field label="검색"><input type="search" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="지역, 직업, 취미, 메모" /></Field>
          <Field label="성별"><select value={filters.gender} onChange={(event) => setFilters({ ...filters, gender: event.target.value })}><option value="all">전체</option><option value="남">남</option><option value="여">여</option></select></Field>
          <div className="range-grid"><Field label="최소 나이"><input type="number" value={filters.minAge} onChange={(event) => setFilters({ ...filters, minAge: event.target.value })} /></Field><Field label="최대 나이"><input type="number" value={filters.maxAge} onChange={(event) => setFilters({ ...filters, maxAge: event.target.value })} /></Field></div>
          <Field label="최소 키"><input type="number" value={filters.minHeight} onChange={(event) => setFilters({ ...filters, minHeight: event.target.value })} /></Field>
          <Field label="지역"><input value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })} /></Field>
          <Field label="직업군"><select value={filters.job} onChange={(event) => setFilters({ ...filters, job: event.target.value })}><option value="all">전체</option><option value="금융">금융권</option><option value="대기업">대기업</option><option value="공무원">공무원</option><option value="IT">IT</option><option value="전문직">전문직</option></select></Field>
          <Field label="종교"><select value={filters.religion} onChange={(event) => setFilters({ ...filters, religion: event.target.value })}><option value="all">전체</option><option value="무교">무교</option><option value="기독교">기독교</option><option value="천주교">천주교</option><option value="불교">불교</option></select></Field>
          <label className="field check-field"><input type="checkbox" checked={filters.nonSmoker} onChange={(event) => setFilters({ ...filters, nonSmoker: event.target.checked })} /><span>비흡연만</span></label>
          <Field label="활동 상태"><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">전체</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></Field>
          <div className="stats-strip"><Stat label="전체 후보" value={candidates.length} /><Stat label="소개 가능" value={stats.available} /><Stat label="진행 중" value={stats.reviewing} /><Stat label="중복 의심" value={stats.duplicates} /></div>
        </aside>

        <section className="list-panel">
          <div className="panel-heading"><div><h2>후보자</h2><p>{filteredCandidates.length}명</p></div><div className="view-tabs"><button className={`tab-button ${sortMode === "recent" ? "active" : ""}`} type="button" onClick={() => setSortMode("recent")}>최근</button><button className={`tab-button ${sortMode === "score" ? "active" : ""}`} type="button" onClick={() => setSortMode("score")}>추천순</button></div></div>
          <div className="candidate-list">
            {filteredCandidates.map((candidate) => <button key={candidate.id} className={`candidate-card ${candidate.id === selected?.id ? "active" : ""}`} type="button" onClick={() => setSelectedId(candidate.id)}><div className="avatar" style={{ background: candidate.color }}>{primaryPhotoUrl(candidate) ? <img src={primaryPhotoUrl(candidate)} alt="" /> : initials(candidate)}</div><div className="card-main"><div className="card-title"><h3>{candidate.alias}</h3><span>{age(candidate)}세</span></div><p className="card-meta">{candidate.location} · {candidate.job}<br />{candidate.height || "-"}cm · {candidate.education}</p><div className="tag-row"><span className="tag">{candidate.status}</span><span className="tag">{candidate.smoke}</span><span className="tag accent">{jobGroup(candidate.job)}</span></div></div></button>)}
          </div>
        </section>

        <section className="detail-panel">
          {!selected ? <div className="detail-empty"><h2>후보를 선택하세요</h2></div> : <div className="detail-content">
            <div className="profile-header"><div className="avatar large" style={{ background: selected.color }}>{primaryPhotoUrl(selected) ? <img src={primaryPhotoUrl(selected)} alt={selected.alias} /> : initials(selected)}</div><div className="profile-header-main"><div className="status-row"><h2>{selected.alias}</h2><span className="status-pill">{selected.status}</span></div><p>{age(selected)}세 · {selected.location} · {selected.job}</p><div className="tag-row">{[selected.mbti, selected.smoke, selected.religion, selected.privacy].filter(Boolean).map((tag) => <span key={tag} className="tag">{tag}</span>)}{!selected.consent && <span className="tag risk">동의 미확인</span>}</div></div>{!isViewer && <div className="profile-actions"><button className="secondary-button compact" type="button" onClick={() => openCandidateEdit(selected)}>수정</button><button className="text-button danger" type="button" onClick={() => deleteCandidate(selected)}>삭제</button></div>}</div>
            <div className="photo-strip">{(selected.photos || []).map((photo) => <div key={photo.id} className="photo-thumb"><img src={`${API_URL}${photo.imageUrl}`} alt="" />{photo.isPrimary && <span className="photo-flag">대표</span>}{!isViewer && <button type="button" className="photo-remove" title="사진 삭제" onClick={() => removePhoto(photo.id)}>×</button>}</div>)}{!isViewer && <label className="photo-add"><input type="file" accept="image/*" onChange={(event) => { uploadPhoto(event.target.files?.[0]); event.target.value = ""; }} /><span>＋ 사진</span></label>}</div>
            <div className="detail-grid"><InfoBlock title="프로필" rows={[["성별", selected.gender], ["출생연도", `${selected.birthYear}년`], ["키", `${selected.height || "-"}cm`], ["학력", selected.education || "-"], ["종교", selected.religion || "-"], ["음주", selected.drink || "-"], ["성격", selected.personality || "-"], ["취미", selected.hobbies || "-"], ["이상형", selected.ideal || "-"], ["메모", selected.memo || "-"], ["연락처", selected.contact || "-"]]} /><div className="info-block"><h3>운영 체크</h3><div className="check-list">{operatorChecks.map((check) => <div key={check.text} className="check-item"><span className={`check-dot ${check.level}`}></span><span>{check.text}</span></div>)}</div></div></div>
            <div className="status-editor"><Field label="진행 상태"><select defaultValue={selected.status} disabled={isViewer} onChange={(event) => saveStatus(event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></Field></div>
            <div className="section-heading"><h3>추천 후보</h3><span>검토용 점수</span></div>
            <div className="recommendation-list">{recommendations.length ? recommendations.map((item) => <div key={item.candidate.id} className="recommendation-card"><div className="score-ring" style={{ "--score": `${item.score * 3.6}deg` }}><span>{item.score}</span></div><div><h4>{item.candidate.alias}</h4><p>{item.candidate.birthYear}년생 · {item.candidate.job} · {item.candidate.location}<br />{item.reasons.join(" · ")}</p></div>{!isViewer && <button className="secondary-button compact" type="button" onClick={() => createMatch(selected.id, item.candidate.id)}>매칭</button>}</div>) : <div className="recommendation-card"><p>추천 가능한 상대 후보가 없습니다.</p></div>}</div>
            <div className="section-heading"><h3>진행 로그</h3>{!isViewer && <button className="secondary-button compact" type="button" onClick={() => addReviewLog()}>검토 등록</button>}</div>
            <div className="timeline">{ownLogs.length ? ownLogs.map((log) => { const other = candidates.find((item) => item.id === log.pair.find((id) => id !== selected.id)); return <div key={log.id} className="timeline-item"><time>{log.date} · {log.status}</time>{selected.alias} ↔ {other?.alias || "상대 후보"}<br />{log.memo}</div>; }) : <div className="timeline-item"><time>기록 없음</time>아직 연결 이력이 없습니다.</div>}</div>
            <div className="section-heading"><h3>카톡 공유글</h3><select className="compact-select" value={tone} onChange={(event) => setTone(event.target.value)}><option value="clean">깔끔한 정보형</option><option value="natural">자연스러운 소개형</option><option value="openchat">오픈채팅용</option><option value="formal">격식 있는 소개형</option></select></div>
            {shareRisks.length > 0 && <div className="privacy-warning"><strong>개인정보 노출 주의</strong> 후보 정보에 {shareRisks.join(", ")} 형식이 포함되어 있습니다. 공유 전 제거를 권장합니다.</div>}
            <label className="field check-field clean-toggle"><input type="checkbox" checked={includeClean} onChange={(event) => setIncludeClean(event.target.checked)} /><span>클린메시지 자동 삽입</span></label>
            <textarea className="share-text" readOnly value={shareText} rows={includeClean ? 13 : 8}></textarea><button className="primary-button full-width" type="button" onClick={() => { navigator.clipboard.writeText(shareText); notify("공유글을 복사했습니다."); }}>공유글 복사</button>
          </div>}
        </section>
      </main>}

      {view === "board" && <MatchBoard matches={matches} candidates={candidates} onStatus={updateMatchStatus} onOpenCandidates={() => setView("candidates")} canWrite={!isViewer} />}

      {modal === "candidate" && <Modal title={editingId ? "후보 수정" : "후보 등록"} description={editingId ? "후보 정보를 수정합니다." : "오픈채팅 문장을 붙여넣으면 주요 필드를 채웁니다."} onClose={() => { setModal(null); setEditingId(null); setCandidateDraft(emptyCandidate); }}><CandidateForm draft={candidateDraft} setDraft={setCandidateDraft} duplicate={duplicatePreview} onSubmit={saveCandidate} editing={Boolean(editingId)} /></Modal>}
      {modal === "members" && <MembersModal members={members} isOwner={room?.role === "owner"} onChangeRole={changeRole} onClose={() => setModal(null)} />}
      {modal === "room" && <Modal title="방 생성" description="공개방은 로그인 사용자에게 보이고, 비공개방은 링크나 코드로 입장합니다." onClose={() => setModal(null)}><form onSubmit={createRoom}><Field label="방 이름"><input value={roomDraft.name} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value })} required placeholder="30대 초중반 소개팅방" /></Field><Field label="공개 설정"><select value={roomDraft.visibility} onChange={(event) => setRoomDraft({ ...roomDraft, visibility: event.target.value })}><option value="public">공개방</option><option value="private">비공개방</option></select></Field><div className="dialog-footer"><button className="text-button" type="button" onClick={() => setModal(null)}>취소</button><button className="primary-button" type="submit">생성</button></div></form></Modal>}
      {modal === "join" && <JoinRoomModal mode={joinMode} setMode={setJoinMode} publicRooms={publicRooms} joinCode={joinCode} setJoinCode={setJoinCode} onJoinPrivate={joinRoom} onJoinPublic={joinPublicRoom} onRefreshPublic={loadPublicRooms} onClose={() => setModal(null)} />}
      <Toast message={toast} />
    </div>
  );
}

function Brand({ caption = "후보 구조화 · 조건 검토 · 진행 관리", centered = false }) {
  return <div className={`brand ${centered ? "auth-brand" : ""}`}><div className="brand-mark">B</div><div><h1>볼사람</h1><p>{caption}</p></div></div>;
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Stat({ label, value }) {
  return <div className="stat-row"><span>{label}</span><strong>{value}</strong></div>;
}

function RoomHome({ rooms, onOpen, onCreate, onJoin }) {
  return <main className="room-home">
    <section className="room-home-head">
      <div>
        <h2>입장중인 방</h2>
        <p>{rooms.length}개 방</p>
      </div>
      <div className="room-home-actions">
        <button className="secondary-button" type="button" onClick={onCreate}>방 생성</button>
        <button className="primary-button" type="button" onClick={onJoin}>새로운 방 참가하기</button>
      </div>
    </section>
    {rooms.length ? <div className="room-grid">
      {rooms.map((item) => <button key={item.id} className="room-card" type="button" onClick={() => onOpen(item)}>
        <div className="room-card-top">
          <span className={`room-badge ${item.visibility === "private" ? "private" : ""}`}>{item.visibility === "private" ? "비공개" : "공개"}</span>
          <span>{item.role === "owner" ? "소유자" : "멤버"}</span>
        </div>
        <h3>{item.name}</h3>
        <div className="room-card-stats">
          <span>후보 {item.candidateCount || 0}</span>
          <span>멤버 {item.memberCount || 0}</span>
        </div>
      </button>)}
    </div> : <div className="room-empty">
      <h3>입장중인 방이 없습니다.</h3>
      <div className="room-home-actions">
        <button className="secondary-button" type="button" onClick={onCreate}>방 생성</button>
        <button className="primary-button" type="button" onClick={onJoin}>새로운 방 참가하기</button>
      </div>
    </div>}
  </main>;
}

function Dashboard({ candidates, matches, logs, onOpenCandidates, onOpenBoard }) {
  const byId = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const available = candidates.filter((candidate) => candidate.status === "소개 가능").length;
  const activeMatches = matches.filter((match) => !["완료", "거절"].includes(match.status)).length;
  const meeting = matches.filter((match) => match.status === "만남 예정").length;
  const consentNeeded = candidates.filter((candidate) => !candidate.consent).length;
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const inactive = candidates.filter((candidate) => candidate.updatedAt && new Date(candidate.updatedAt).getTime() < ninetyDaysAgo && candidate.privacy !== "비공개").length;
  const cards = [
    { label: "등록 후보", value: candidates.length, onClick: onOpenCandidates },
    { label: "소개 가능", value: available, onClick: onOpenCandidates },
    { label: "진행 중 매칭", value: activeMatches, onClick: onOpenBoard },
    { label: "만남 예정", value: meeting, onClick: onOpenBoard },
    { label: "동의 확인 필요", value: consentNeeded, alert: consentNeeded > 0, onClick: onOpenCandidates },
    { label: "장기 미활동(90일+)", value: inactive, alert: inactive > 0, onClick: onOpenCandidates },
  ];
  const breakdown = statuses.map((status) => ({ status, count: candidates.filter((candidate) => candidate.status === status).length })).filter((row) => row.count);
  const recent = logs.slice(0, 8);
  const aliasOf = (id) => byId.get(id)?.alias || "삭제된 후보";
  return <main className="dashboard">
    <div className="metric-grid">
      {cards.map((card) => <button key={card.label} type="button" className={`metric-card ${card.alert ? "alert" : ""}`} onClick={card.onClick}>
        <span className="metric-value">{card.value}</span>
        <span className="metric-label">{card.label}</span>
      </button>)}
    </div>
    <div className="dashboard-cols">
      <section className="info-block">
        <h3>후보 상태 분포</h3>
        {breakdown.length ? <div className="breakdown-list">{breakdown.map((row) => <div key={row.status} className="breakdown-row"><span>{row.status}</span><strong>{row.count}</strong></div>)}</div> : <p className="dashboard-empty">등록된 후보가 없습니다.</p>}
      </section>
      <section className="info-block">
        <h3>최근 활동</h3>
        {recent.length ? <div className="timeline">{recent.map((log) => <div key={log.id} className="timeline-item"><time>{log.date} · {log.status}</time>{aliasOf(log.pair[0])}{log.pair[1] ? ` ↔ ${aliasOf(log.pair[1])}` : ""}<br />{log.memo}</div>)}</div> : <p className="dashboard-empty">아직 활동 기록이 없습니다.</p>}
      </section>
    </div>
  </main>;
}

const ROLE_LABELS = { owner: "소유자", admin: "관리자", member: "멤버", viewer: "읽기 전용" };

function MembersModal({ members, isOwner, onChangeRole, onClose }) {
  return <Modal title="멤버" description={isOwner ? "방 멤버의 역할을 변경할 수 있습니다." : "방 멤버 목록입니다."} onClose={onClose}>
    <div className="member-list">
      {members.map((member) => <div key={member.id} className="member-row">
        <div><h3>{member.name}</h3><p>{member.email}</p></div>
        {member.role === "owner" || !isOwner
          ? <span className="tag">{ROLE_LABELS[member.role] || member.role}</span>
          : <select value={member.role} onChange={(event) => onChangeRole(member.id, event.target.value)}>
              <option value="admin">관리자</option>
              <option value="member">멤버</option>
              <option value="viewer">읽기 전용</option>
            </select>}
      </div>)}
    </div>
  </Modal>;
}

function MatchBoard({ matches, candidates, onStatus, onOpenCandidates, canWrite = true }) {
  const byId = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const columns = matchStatuses.map((status) => ({ status, items: matches.filter((match) => match.status === status) }));
  if (!matches.length) {
    return <main className="match-board empty">
      <div className="room-empty">
        <h3>아직 매칭이 없습니다.</h3>
        <p>후보 상세의 추천 후보에서 “매칭”을 누르면 보드에 추가됩니다.</p>
        <button className="primary-button" type="button" onClick={onOpenCandidates}>후보 보기</button>
      </div>
    </main>;
  }
  return <main className="match-board">
    {columns.map((column) => <section key={column.status} className="board-column">
      <div className="board-column-head"><h3>{column.status}</h3><span>{column.items.length}</span></div>
      <div className="board-cards">
        {column.items.map((match) => {
          const a = byId.get(match.candidateAId);
          const b = byId.get(match.candidateBId);
          return <article key={match.id} className="board-card">
            <div className="board-card-pair">
              <span className="dot" style={{ background: a?.color || "#999" }}></span>{a?.alias || "삭제된 후보"}
              <span className="board-card-link">↔</span>
              <span className="dot" style={{ background: b?.color || "#999" }}></span>{b?.alias || "삭제된 후보"}
            </div>
            {match.score != null && <div className="board-card-score">{match.score}점</div>}
            {match.reasonSummary && <p className="board-card-reason">{match.reasonSummary}</p>}
            {["수락", "연락처 교환", "만남 예정", "완료"].includes(match.status)
              ? <div className="board-card-contact">📞 {a?.contact || "미입력"} · {b?.contact || "미입력"}</div>
              : <div className="board-card-contact locked">🔒 수락 후 연락처 공개</div>}
            <select value={match.status} disabled={!canWrite} onChange={(event) => onStatus(match.id, event.target.value)}>
              {matchStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </article>;
        })}
      </div>
    </section>)}
  </main>;
}

function JoinRoomModal({ mode, setMode, publicRooms, joinCode, setJoinCode, onJoinPrivate, onJoinPublic, onRefreshPublic, onClose }) {
  return <Modal title="새로운 방 참가하기" description="공개방 또는 비공개방" onClose={onClose}>
    <div className="join-tabs">
      <button className={`tab-button ${mode === "public" ? "active" : ""}`} type="button" onClick={() => { setMode("public"); onRefreshPublic().catch(() => {}); }}>공개방</button>
      <button className={`tab-button ${mode === "private" ? "active" : ""}`} type="button" onClick={() => setMode("private")}>비공개방</button>
    </div>
    {mode === "public" ? <div className="public-room-list">
      {publicRooms.length ? publicRooms.map((item) => <div key={item.id} className="public-room-row">
        <div>
          <h3>{item.name}</h3>
          <p>후보 {item.candidateCount || 0} · 멤버 {item.memberCount || 0}</p>
        </div>
        <button className={item.isMember ? "secondary-button" : "primary-button"} type="button" onClick={() => onJoinPublic(item)}>{item.isMember ? "열기" : "입장"}</button>
      </div>) : <div className="room-empty compact-empty"><h3>공개방이 없습니다.</h3><button className="secondary-button" type="button" onClick={() => onRefreshPublic().catch(() => {})}>새로고침</button></div>}
    </div> : <form onSubmit={onJoinPrivate}>
      <Field label="방 코드"><input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} required placeholder="AB12CD34" /></Field>
      <div className="dialog-footer"><button className="text-button" type="button" onClick={onClose}>취소</button><button className="primary-button" type="submit">입장</button></div>
    </form>}
  </Modal>;
}

function InfoBlock({ title, rows }) {
  return <div className="info-block"><h3>{title}</h3><dl>{rows.map(([label, value]) => <div key={label} className="fact-row"><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>;
}

function Modal({ title, description, onClose, children }) {
  return <div className="modal-backdrop"><section className="candidate-dialog"><div className="candidate-form"><div className="dialog-heading"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" type="button" onClick={onClose}>닫기</button></div>{children}</div></section></div>;
}

function CandidateForm({ draft, setDraft, duplicate, onSubmit, editing = false }) {
  const set = (key, value) => setDraft({ ...draft, [key]: value });
  const risks = detectPrivacyRisks([draft.rawText, draft.job, draft.education, draft.location, draft.personality, draft.ideal, draft.memo].join(" "));
  return <form onSubmit={onSubmit}>
    <Field label="카톡 원문"><textarea rows={4} value={draft.rawText} onChange={(event) => set("rawText", event.target.value)} placeholder="95년생 / 김포공항쪽 거주 / 키 163 / 연세대 학부졸 / 현대자동차 7년차 / ESFJ" /></Field>
    <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setDraft({ ...draft, ...parseRawProfile(draft.rawText) })}>자동 분리</button><span className="notice">{duplicate ? `${duplicate.alias} 후보와 중복 가능` : ""}</span></div>
    <div className="form-grid">
      <Field label="이름 또는 별칭"><input value={draft.alias} onChange={(event) => set("alias", event.target.value)} required /></Field>
      <Field label="성별"><select value={draft.gender} onChange={(event) => set("gender", event.target.value)}><option value="여">여</option><option value="남">남</option></select></Field>
      <Field label="출생연도"><input type="number" min="1970" max="2100" value={draft.birthYear} onChange={(event) => set("birthYear", event.target.value)} required /></Field>
      <Field label="키"><input type="number" min="140" max="210" value={draft.height} onChange={(event) => set("height", event.target.value)} /></Field>
      <Field label="거주지"><input value={draft.location} onChange={(event) => set("location", event.target.value)} /></Field>
      <Field label="직장/직업"><input value={draft.job} onChange={(event) => set("job", event.target.value)} /></Field>
      <Field label="학력"><input value={draft.education} onChange={(event) => set("education", event.target.value)} /></Field>
      <Field label="종교"><SelectSimple value={draft.religion} onChange={(value) => set("religion", value)} values={["미입력", "무교", "기독교", "천주교", "불교"]} /></Field>
      <Field label="흡연"><SelectSimple value={draft.smoke} onChange={(value) => set("smoke", value)} values={["미입력", "비흡연", "흡연"]} /></Field>
      <Field label="음주"><SelectSimple value={draft.drink} onChange={(value) => set("drink", value)} values={["미입력", "안함", "가끔", "자주"]} /></Field>
      <Field label="MBTI"><input value={draft.mbti} onChange={(event) => set("mbti", event.target.value)} /></Field>
      <Field label="공개 범위"><SelectSimple value={draft.privacy} onChange={(value) => set("privacy", value)} values={["그룹 내 공개", "전체 공개", "비공개"]} /></Field>
      <label className="field wide"><span>성격</span><input value={draft.personality} onChange={(event) => set("personality", event.target.value)} /></label>
      <label className="field wide"><span>취미</span><input value={draft.hobbies} onChange={(event) => set("hobbies", event.target.value)} /></label>
      <label className="field wide"><span>이상형</span><input value={draft.ideal} onChange={(event) => set("ideal", event.target.value)} /></label>
      <label className="field wide"><span>소개 메모</span><textarea rows={3} value={draft.memo} onChange={(event) => set("memo", event.target.value)} /></label>
      <label className="field wide"><span>연락처 (비공개 · 매칭 수락 후 공개)</span><input value={draft.contact} onChange={(event) => set("contact", event.target.value)} placeholder="010-0000-0000" /></label>
    </div>
    {risks.length > 0 && <div className="privacy-warning">입력값에 {risks.join(", ")} 형식이 감지됐습니다. 식별 가능 정보는 최소화해 주세요.</div>}
    <label className="field check-field consent-field"><input type="checkbox" checked={Boolean(draft.consent)} onChange={(event) => set("consent", event.target.checked)} required /><span>본인은 해당 후보자의 소개 목적 정보 등록 및 공유 동의를 받았습니다.</span></label>
    <div className="dialog-footer"><button className="primary-button" type="submit">{editing ? "수정 저장" : "저장"}</button></div>
  </form>;
}

function SelectSimple({ value, values, onChange }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select>;
}

function Toast({ message }) {
  return <div className={`toast ${message ? "show" : ""}`} role="status" aria-live="polite">{message}</div>;
}
