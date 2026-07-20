"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./workspace.css";
import "./loading.css";
import "./workspace-auth.css";

type Message = { id?: string; role: "user" | "assistant"; text: string; tools?: string[]; streaming?: boolean; incomplete?: boolean; rating?: "up" | "down" };
type SavedSearch = { id: string; title: string; status: string; created_at: string; updated_at: string };
type UsageState = {
  windowStartedAt: string | null;
  windowEndsAt: string | null;
  percentage: number;
  warningPercentage: number;
  status: "available" | "almost_used" | "limit_reached";
  enforcementActive: boolean;
};
export type AuthorizedWorkspace = {
  id: string;
  name: string;
  primaryMarket: string;
  role: "owner" | "member";
  trialEndsAt: string;
  usage: UsageState;
};

function localUsageTime(value: string | null) {
  if (!value) return "Starts with your next request";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function SignalMark() {
  return <span className="shell-mark" aria-hidden="true"><i /><i /><i /><b /></span>;
}

function MicrophoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" /></svg>;
}

function ActionIcon({ name }: { name: "copy" | "up" | "down" | "new" }) {
  if (name === "copy") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
  if (name === "up") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4V10h3Zm0 9h10.2a2 2 0 0 0 1.9-1.4l1.5-5A2 2 0 0 0 18.7 10H15l.7-3.2A2.3 2.3 0 0 0 13.5 4L8 10v9" /></svg>;
  if (name === "down") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14V4H4v10h3Zm0-9h10.2a2 2 0 0 1 1.9 1.4l1.5 5a2 2 0 0 1-1.9 2.6H15l.7 3.2a2.3 2.3 0 0 1-2.2 2.8L8 14V5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

export default function WorkspaceClient({ workspace }: { workspace: AuthorizedWorkspace }) {
  const draftKey = `storm-signal-draft:${workspace.id}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [searchMenuId, setSearchMenuId] = useState<string | null>(null);
  const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
  const [editingSearchTitle, setEditingSearchTitle] = useState("");
  const [searchActionBusy, setSearchActionBusy] = useState<string | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [title, setTitle] = useState("New search");
  const [greeting, setGreeting] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [activityStatus, setActivityStatus] = useState("Understanding your request…");
  const [showJump, setShowJump] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<Message | null>(null);
  const [feedbackReasons, setFeedbackReasons] = useState<string[]>([]);
  const [feedbackDetails, setFeedbackDetails] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [usage, setUsage] = useState<UsageState>(workspace.usage);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const followLatestRef = useRef(true);
  const usageButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch("/api/chat").then((response) => response.json()).then((data) => setConfigured(Boolean(data.configured))).catch(() => setConfigured(false));
    try { setInput(sessionStorage.getItem(draftKey) || ""); } catch { /* Device storage may be unavailable. */ }
    const hour = new Date().getHours();
    setGreeting(hour < 11 ? "Good morning." : hour >= 18 ? "Planning the next move?" : "");
    fetch("/api/conversations").then((response) => response.json()).then(async (data) => {
      const searches = Array.isArray(data.conversations) ? data.conversations as SavedSearch[] : [];
      setSavedSearches(searches);
      if (searches[0]) await loadConversation(searches[0].id);
      else setLoadingSearch(false);
    }).catch(() => setLoadingSearch(false));
  }, [draftKey]);

  useEffect(() => {
    const thread = scrollRef.current;
    if (!thread || !followLatestRef.current || (!messages.length && !busy)) return;
    const frame = requestAnimationFrame(() => {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, busy]);

  useEffect(() => {
    const composerInput = inputRef.current;
    if (!composerInput) return;
    composerInput.style.height = "auto";
    composerInput.style.height = `${Math.min(composerInput.scrollHeight, 168)}px`;
  }, [input]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  useEffect(() => {
    if (!usage.windowEndsAt) return;
    const remaining = new Date(usage.windowEndsAt).getTime() - Date.now();
    const interval = window.setInterval(() => void refreshUsage(), 60_000);
    const reopening = window.setTimeout(() => void refreshUsage(), Math.max(1_000, remaining + 1_000));
    return () => { window.clearInterval(interval); window.clearTimeout(reopening); };
  }, [usage.windowEndsAt]);

  async function refreshUsage() {
    setUsageLoading(true);
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.usage) return;
      setUsage({
        windowStartedAt: data.usage.window_started_at ?? null,
        windowEndsAt: data.usage.window_ends_at ?? null,
        percentage: Number(data.usage.usage_percentage ?? 0),
        warningPercentage: Number(data.usage.warning_percentage ?? 90),
        status: data.usage.usage_status ?? "available",
        enforcementActive: Boolean(data.usage.enforcement_active),
      });
    } finally { setUsageLoading(false); }
  }

  function closeUsage() {
    setUsageOpen(false);
    requestAnimationFrame(() => usageButtonRef.current?.focus());
  }

  function updateInput(value: string) {
    setInput(value);
    try { if (value) sessionStorage.setItem(draftKey, value); else sessionStorage.removeItem(draftKey); } catch { /* Device storage may be unavailable. */ }
  }

  function beginSearch() {
    abortRef.current?.abort();
    recorderRef.current?.stop();
    setMessages([]);
    updateInput("");
    setConversationId(null);
    setBusy(false);
    setTitle("New search");
    setContextOpen(false);
    setNavOpen(false);
    setAccountOpen(false);
    setSearchMenuId(null);
    setEditingSearchId(null);
    setShowJump(false);
    followLatestRef.current = true;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function loadConversation(id: string) {
    setLoadingSearch(true);
    setNavOpen(false);
    setContextOpen(false);
    setSearchMenuId(null);
    setEditingSearchId(null);
    try {
      const response = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The search could not be loaded.");
      const restored = (Array.isArray(data.messages) ? data.messages : []).map((message: { id?: string; role: string; content?: { text?: string; tools?: string[]; status?: string } }) => ({
        id: message.id,
        role: message.role === "user" ? "user" as const : "assistant" as const,
        text: message.content?.text || "",
        tools: message.content?.tools,
        incomplete: message.content?.status === "incomplete",
      })).filter((message: Message) => message.text);
      setConversationId(data.conversation.id);
      setTitle(data.conversation.title || "Saved search");
      setMessages(restored);
      setShowJump(false);
      followLatestRef.current = true;
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "The search could not be loaded.");
    } finally {
      setLoadingSearch(false);
    }
  }

  async function refreshSearches(activeId?: string) {
    try {
      const response = await fetch("/api/conversations");
      const data = await response.json();
      if (response.ok && Array.isArray(data.conversations)) {
        setSavedSearches(data.conversations);
        if (activeId) setConversationId(activeId);
      }
    } catch { /* The active conversation remains usable if navigation refresh fails. */ }
  }

  function startRenaming(search: SavedSearch) {
    setSearchMenuId(null);
    setEditingSearchId(search.id);
    setEditingSearchTitle(search.title);
  }

  async function renameSearch(event: FormEvent, search: SavedSearch) {
    event.preventDefault();
    const nextTitle = editingSearchTitle.trim().replace(/\s+/g, " ");
    if (!nextTitle || nextTitle === search.title) { setEditingSearchId(null); return; }
    setSearchActionBusy(search.id);
    setVoiceError("");
    try {
      const response = await fetch("/api/conversations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: search.id, title: nextTitle }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This search could not be renamed.");
      setSavedSearches((current) => current.map((item) => item.id === search.id ? { ...item, ...data.conversation } : item));
      if (conversationId === search.id) setTitle(data.conversation.title);
      setEditingSearchId(null);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "This search could not be renamed.");
    } finally { setSearchActionBusy(null); }
  }

  async function deleteSearch(search: SavedSearch) {
    setSearchMenuId(null);
    if (!window.confirm(`Delete “${search.title}”? This will permanently remove the conversation and its messages.`)) return;
    setSearchActionBusy(search.id);
    setVoiceError("");
    try {
      const response = await fetch(`/api/conversations?id=${encodeURIComponent(search.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "This search could not be deleted.");
      }
      const remaining = savedSearches.filter((item) => item.id !== search.id);
      setSavedSearches(remaining);
      if (conversationId === search.id) {
        if (remaining[0]) await loadConversation(remaining[0].id);
        else beginSearch();
      }
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "This search could not be deleted.");
    } finally { setSearchActionBusy(null); }
  }

  function chooseStarter(starter: string) {
    updateInput(starter);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function toggleRecording() {
    setVoiceError("");
    if (recording) { recorderRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Voice input is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        setRecording(false);
        setTranscribing(true);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        const mimeType = recorder.mimeType || "audio/webm";
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const form = new FormData();
        form.append("audio", new File(chunksRef.current, `storm-signal-recording.${extension}`, { type: mimeType }));
        try {
          const response = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await response.json();
          if (response.status === 401) { window.location.href = "/login?returnTo=%2Fworkspace"; return; }
          if (response.status === 402) { window.location.href = "/workspace/expired"; return; }
          if (!response.ok) throw new Error(data.error || "The recording could not be transcribed.");
          updateInput(input.trim() ? `${input.trim()} ${data.text}` : data.text);
          requestAnimationFrame(() => inputRef.current?.focus());
        } catch (error) {
          setVoiceError(error instanceof Error ? error.message : "The recording could not be transcribed.");
        } finally {
          setTranscribing(false);
          chunksRef.current = [];
          void refreshUsage();
        }
      };
      recorder.start();
      setRecording(true);
    } catch {
      setVoiceError("Microphone access was not granted.");
    }
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy || usageLimited) return;
    if (messages.length === 0) setTitle(clean.length > 52 ? `${clean.slice(0, 49).trim()}…` : clean);
    followLatestRef.current = true;
    setShowJump(false);
    setMessages((current) => [...current, { role: "user", text: clean }]);
    updateInput("");
    setBusy(true);
    setActivityStatus("Understanding your request…");
    const controller = new AbortController();
    abortRef.current = controller;
    const streamMessageId = crypto.randomUUID();
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: clean, conversationId, requestId: crypto.randomUUID() }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json();
        if (response.status === 401) { try { sessionStorage.setItem(draftKey, clean); } catch {} window.location.href = "/login?returnTo=%2Fworkspace"; return; }
        if (response.status === 402) { window.location.href = "/workspace/expired"; return; }
        if (response.status === 429) { setMessages((current) => [...current, { role: "assistant", text: data.error || "This workspace has reached its current usage allowance. Try again shortly." }]); return; }
        throw new Error(data.error || "The request could not be completed.");
      }
      if (!response.body) throw new Error("The response stream was not available.");
      setMessages((current) => [...current, { id: streamMessageId, role: "assistant", text: "", streaming: true }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let activeConversationId = conversationId;
      const updateStreamMessage = (update: (message: Message) => Message) => setMessages((current) => current.map((message) => message.id === streamMessageId ? update(message) : message));
      const handleEvent = (event: { type?: string; conversationId?: string; title?: string; message?: string; messageId?: string; delta?: string; tools?: string[]; error?: string }) => {
        if (event.type === "conversation") {
          activeConversationId = event.conversationId || activeConversationId;
          if (activeConversationId) setConversationId(activeConversationId);
          if (event.title) setTitle(event.title);
        } else if (event.type === "status" && event.message) {
          setActivityStatus(event.message);
        } else if (event.type === "delta" && event.delta) {
          updateStreamMessage((message) => ({ ...message, text: message.text + event.delta }));
        } else if (event.type === "evidence") {
          updateStreamMessage((message) => ({ ...message, tools: event.tools || [] }));
        } else if (event.type === "done") {
          updateStreamMessage((message) => ({ ...message, id: event.messageId || message.id, tools: event.tools || message.tools, streaming: false }));
        } else if (event.type === "stopped") {
          updateStreamMessage((message) => ({ ...message, streaming: false, incomplete: true, text: message.text || "Response stopped. You can continue when you’re ready." }));
        } else if (event.type === "error") {
          updateStreamMessage((message) => ({ ...message, streaming: false, incomplete: true, text: message.text || event.error || "Storm Signal could not complete this request." }));
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer));
      updateStreamMessage((message) => ({ ...message, streaming: false }));
      if (activeConversationId) void refreshSearches(activeConversationId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setMessages((current) => current.map((message) => message.id === streamMessageId ? { ...message, streaming: false, incomplete: true, text: message.text || "Response stopped. You can continue when you’re ready." } : message));
      else setMessages((current) => [...current, { role: "assistant", text: `I couldn’t complete that request. ${error instanceof Error ? error.message : "Please try again."}` }]);
    } finally {
      abortRef.current = null;
      setBusy(false);
      void refreshUsage();
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void send(input); }

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    followLatestRef.current = nearBottom;
    setShowJump(!nearBottom && messages.length > 0);
  }

  function jumpToLatest() {
    followLatestRef.current = true;
    setShowJump(false);
    const thread = scrollRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }

  async function copyMessage(message: Message) {
    if (!message.id) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1800);
    } catch { setVoiceError("This response could not be copied."); }
  }

  async function rateMessage(message: Message, rating: "up" | "down") {
    if (!message.id || message.streaming) return;
    if (rating === "down") {
      setFeedbackMessage(message); setFeedbackReasons([]); setFeedbackDetails(""); setFeedbackError("");
      return;
    }
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, rating } : item));
    const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: message.id, rating }) });
    if (!response.ok) {
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, rating: undefined } : item));
      setVoiceError("Your feedback could not be saved.");
    }
  }

  async function submitFeedback(event: FormEvent) {
    event.preventDefault();
    if (!feedbackMessage?.id) return;
    setFeedbackBusy(true); setFeedbackError("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: feedbackMessage.id, rating: "down", reasons: feedbackReasons, details: feedbackDetails }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your feedback could not be saved.");
      setMessages((current) => current.map((item) => item.id === feedbackMessage.id ? { ...item, rating: "down" } : item));
      setFeedbackMessage(null);
    } catch (error) { setFeedbackError(error instanceof Error ? error.message : "Your feedback could not be saved."); }
    finally { setFeedbackBusy(false); }
  }

  const primaryMarket = workspace.primaryMarket || "your primary market";
  const starters = [
    `Show me recent hail and wind reports in ${primaryMarket}.`,
    `Which areas in ${primaryMarket} have the strongest evidence from the last 48 hours?`,
    "Help me compare two areas I’m considering.",
  ];
  const hasConversation = messages.length > 0;
  const hasEvidence = messages.some((message) => Boolean(message.tools?.length));
  const usageLimited = usage.enforcementActive && usage.status === "limit_reached";
  const usageWarning = usage.enforcementActive && usage.status === "almost_used";
  const accessReturnsAt = localUsageTime(usage.windowEndsAt);
  const compactUsage = usage.windowStartedAt ? `${Math.round(usage.percentage)}%` : "Available";

  function renderComposer(initial = false) {
    return <form className={`composer ${initial ? "composer-initial" : ""} ${usageLimited ? "is-limited" : ""}`} onSubmit={submit}>
      {(usageWarning || usageLimited) && <div className={`usage-notice ${usageLimited ? "is-limited" : ""}`} role="status">{usageLimited ? `You’ve reached your current usage limit. You can continue at ${accessReturnsAt}.` : `You’re close to your current usage limit. More access at ${accessReturnsAt}.`}</div>}
      <textarea ref={inputRef} value={input} onChange={(event) => updateInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (input.trim() && !usageLimited) void send(input); } }} placeholder={usageLimited ? `Available again at ${accessReturnsAt}` : "Ask Storm Signal"} rows={1} aria-label="Message Storm Signal" disabled={usageLimited} />
      <div className="composer-bottom">
        <span>{recording ? "Listening… tap the microphone when you’re done." : transcribing ? "Turning your recording into text…" : "You make the call. Verify final conditions in the field."}</span>
        <div className="composer-actions">
          <button type="button" className={`mic-button ${recording ? "is-recording" : ""}`} aria-label={recording ? "Stop recording" : "Start voice input"} aria-pressed={recording} onClick={() => void toggleRecording()} disabled={busy || transcribing || configured === false || usageLimited}>{transcribing ? <i className="transcribing-dots">•••</i> : <MicrophoneIcon />}</button>
          {busy ? <button type="button" className="stop-button" aria-label="Stop response" onClick={() => abortRef.current?.abort()}>■</button> : <button className="send-button" aria-label="Send message" disabled={!input.trim() || usageLimited}>↑</button>}
        </div>
      </div>
      {voiceError && <p className="voice-error" role="status">{voiceError}</p>}
    </form>;
  }

  return <main className="workspace-shell">
    {navOpen && <button className="shell-scrim" aria-label="Close workspace navigation" onClick={() => setNavOpen(false)} />}
    <aside className={`workspace-side ${navOpen ? "is-open" : ""}`}>
      <div className="side-top">
        <a href="/" className="workspace-brand"><SignalMark /><b>Storm Signal</b></a>
        <button className="mobile-close" onClick={() => setNavOpen(false)} aria-label="Close navigation">×</button>
      </div>
      <button className="new-thread" onClick={beginSearch}><span>＋</span> New search</button>
      <div className="side-scroll">
        <div className="side-section">
          <div className="side-heading"><p>YOUR SEARCHES</p></div>
          {savedSearches.length ? <nav className="recent-list" aria-label="Your searches">{savedSearches.map((search) => (
            <div className={`recent-item${search.id === conversationId ? " active" : ""}`} key={search.id}>
              {editingSearchId === search.id ? (
                <form className="recent-rename" onSubmit={(event) => void renameSearch(event, search)}>
                  <input aria-label="Search name" autoFocus maxLength={80} value={editingSearchTitle} onChange={(event) => setEditingSearchTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditingSearchId(null); }} />
                  <button type="submit" aria-label="Save name" disabled={searchActionBusy === search.id}>✓</button>
                  <button type="button" aria-label="Cancel rename" onClick={() => setEditingSearchId(null)}>×</button>
                </form>
              ) : <>
                <button className="recent-main" onClick={() => void loadConversation(search.id)}><i /><span><b>{search.title}</b><small>{search.id === conversationId ? "Current search" : new Date(search.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span></button>
                <button className="recent-more" aria-label={`Actions for ${search.title}`} aria-expanded={searchMenuId === search.id} onClick={() => setSearchMenuId((current) => current === search.id ? null : search.id)}>•••</button>
                {searchMenuId === search.id && <div className="recent-menu"><button onClick={() => startRenaming(search)}>Rename</button><button className="danger" onClick={() => void deleteSearch(search)} disabled={searchActionBusy === search.id}>Delete</button></div>}
              </>}
            </div>
          ))}</nav> : <p className="side-empty">Your completed searches will appear here.</p>}
        </div>
      </div>
      <div className="side-account">
        <button ref={usageButtonRef} type="button" className={`trial-line usage-control ${usage.status !== "available" ? `is-${usage.status}` : ""}`} onClick={() => { setUsageOpen(true); setNavOpen(false); void refreshUsage(); }} aria-haspopup="dialog"><span>USAGE</span><b>{usageLoading ? "Updating…" : compactUsage}</b></button>
        <button className="workspace-user" onClick={() => setAccountOpen((current) => !current)} aria-expanded={accountOpen}><span>{workspace.name.slice(0,2).toUpperCase()}</span><div><b>{workspace.name}</b><small>{workspace.role === "owner" ? "Owner" : "Member"}</small></div><em>•••</em></button>
        {accountOpen && <div className="account-menu"><form action="/api/auth/logout" method="post"><button className="workspace-signout" type="submit">Sign out</button></form></div>}
      </div>
    </aside>

    <section className={`conversation ${hasConversation ? "is-active" : "is-empty"}`}>
      <header className="conversation-header">
        <button className="mobile-menu" onClick={() => setNavOpen(true)} aria-label="Open workspace navigation">☰</button>
        <div className="conversation-title"><b>{title}</b><small>{hasConversation ? "Updated just now" : `${primaryMarket} workspace`}</small></div>
        {hasEvidence ? <button className="context-trigger" onClick={() => setContextOpen(true)}><span>Evidence</span> ◫</button> : <span />}
      </header>

      <div className="message-scroll" ref={scrollRef} onScroll={handleScroll}>
        {loadingSearch ? <section className="conversation-loading" aria-live="polite"><SignalMark /><span>Opening your latest search…</span></section> : !hasConversation ? <section className="empty-state">
          <div className="welcome-copy">{greeting && <p className="time-greeting">{greeting}</p>}<h1>Where should we<br />look first?</h1><p>Tell us what kind of storm work you’re looking for. We’ll check the recent weather, show you which areas stand out, and help you plan what to check next.</p></div>
          {renderComposer(true)}
          <div className="suggested-starts"><span>TRY ASKING</span><div>{starters.map((starter) => <button key={starter} onClick={() => chooseStarter(starter)}>{starter}<b>↗</b></button>)}</div></div>
          {configured === false && <div className="config-warning">Chat is not configured in this environment.</div>}
        </section> : <div className="messages">
          {messages.map((message, index) => <article key={message.id || index} className={`message ${message.role} ${message.streaming ? "streaming" : ""}`}>
            {message.role === "assistant" && <div className="message-author"><SignalMark />STORM SIGNAL</div>}
            {message.tools && message.tools.length > 0 && <button className="evidence-chip" onClick={() => setContextOpen(true)}><span>◎</span> Evidence used <b>Review ↗</b></button>}
            {message.streaming && <div className={`activity-line ${message.text ? "is-writing" : ""}`}><span>{activityStatus}</span><i /><i /><i /></div>}
            {message.text && <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>{message.streaming && <span className="stream-caret" aria-hidden="true" />}</div>}
            {message.incomplete && <p className="response-incomplete">Response stopped · Continue whenever you’re ready.</p>}
            {message.role === "assistant" && message.text && !message.streaming && message.id && <div className="message-actions" aria-label="Response actions">
              <button type="button" onClick={() => void copyMessage(message)} aria-label="Copy response" title="Copy response" className={copiedMessageId === message.id ? "is-active" : ""}><ActionIcon name="copy" /><span>{copiedMessageId === message.id ? "Copied" : "Copy"}</span></button>
              <button type="button" onClick={() => void rateMessage(message, "up")} aria-label="Helpful response" title="Helpful response" className={message.rating === "up" ? "is-active" : ""}><ActionIcon name="up" /></button>
              <button type="button" onClick={() => void rateMessage(message, "down")} aria-label="Unhelpful response" title="Unhelpful response" className={message.rating === "down" ? "is-active" : ""}><ActionIcon name="down" /></button>
              <button type="button" onClick={beginSearch} aria-label="Start a new search" title="New search"><ActionIcon name="new" /><span>New search</span></button>
            </div>}
          </article>)}
          <div ref={endRef} />
        </div>}
      </div>
      {showJump && <button className="jump-latest" onClick={jumpToLatest} aria-label="Jump to latest message">↓</button>}
      {hasConversation && renderComposer()}
    </section>

    {contextOpen && <button className="context-scrim" aria-label="Close evidence" onClick={() => setContextOpen(false)} />}
    <aside className={`context-panel ${contextOpen ? "is-open" : ""}`} aria-hidden={!contextOpen}>
      <header><div><p>EVIDENCE</p><b>What Storm Signal checked</b></div><button onClick={() => setContextOpen(false)} aria-label="Close evidence">×</button></header>
      <section><p className="context-label">CURRENT QUESTION</p><h2>{messages.find((message) => message.role === "user")?.text || "No active question"}</h2></section>
      <section className="context-facts"><div><span>Primary market</span><b>{primaryMarket}</b></div><div><span>Evidence window</span><b>From the conversation</b></div><div><span>Sources</span><b>{messages.flatMap((message) => message.tools || []).length || "Available after a search"}</b></div></section>
      <section className="context-note"><SignalMark /><div><b>Evidence supports the call. It does not make it.</b><p>Review the source, timing, geography, and limitations before acting in the field.</p></div></section>
    </aside>

    {usageOpen && <div className="usage-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeUsage(); }}>
      <section className="usage-modal" role="dialog" aria-modal="true" aria-labelledby="usage-title">
        <header><div><span>TRIAL ACCESS</span><h2 id="usage-title">Current usage window</h2></div><button type="button" onClick={closeUsage} aria-label="Close usage">×</button></header>
        <div className="usage-modal-body">
          <div className="usage-summary"><strong>{Math.round(usage.percentage)}%</strong><span>{usage.status === "limit_reached" ? "Limit reached" : usage.status === "almost_used" ? "Almost used" : "Available"}</span></div>
          <div className="usage-meter" role="progressbar" aria-label="Current usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usage.percentage)}><i style={{ width: `${Math.min(100, Math.max(0, usage.percentage))}%` }} /></div>
          <dl><div><dt>Window started</dt><dd>{localUsageTime(usage.windowStartedAt)}</dd></div><div><dt>More access</dt><dd>{usage.windowEndsAt ? localUsageTime(usage.windowEndsAt) : "Ready when you are"}</dd></div></dl>
          <p>Usage varies depending on the complexity of each request.</p>
        </div>
      </section>
    </div>}

    {feedbackMessage && <div className="feedback-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFeedbackMessage(null); }}>
      <section className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <header><div><span>HELP US IMPROVE</span><h2 id="feedback-title">What could be better?</h2></div><button type="button" onClick={() => setFeedbackMessage(null)} aria-label="Close feedback">×</button></header>
        <form onSubmit={submitFeedback}>
          <fieldset><legend>Choose any that apply</legend>{[
            ["incorrect", "The answer was incorrect"], ["not_relevant", "It didn’t answer my question"], ["unclear", "It was hard to understand"], ["missing_evidence", "It needed better evidence"], ["other", "Something else"],
          ].map(([value, label]) => <label key={value}><input type="checkbox" checked={feedbackReasons.includes(value)} onChange={() => setFeedbackReasons((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} /><span>{label}</span></label>)}</fieldset>
          <label className="feedback-details"><span>Share details <small>Optional</small></span><textarea value={feedbackDetails} onChange={(event) => setFeedbackDetails(event.target.value)} maxLength={1200} rows={4} placeholder="Tell us what happened or what you expected…" /></label>
          {feedbackError && <p className="feedback-error" role="alert">{feedbackError}</p>}
          <footer><button type="button" onClick={() => setFeedbackMessage(null)}>Cancel</button><button type="submit" disabled={feedbackBusy}>{feedbackBusy ? "Sending…" : "Send feedback"}</button></footer>
        </form>
      </section>
    </div>}
  </main>;
}
