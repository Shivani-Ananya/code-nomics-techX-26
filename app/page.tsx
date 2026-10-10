"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { indentUnit } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  Activity,
  Braces,
  Check,
  Clock3,
  Code2,
  Coins,
  Lock,
  Pause,
  Play,
  ShieldCheck,
  ShoppingCart,
  Trophy,
  Users,
  LogOut,
  Maximize2,
} from "lucide-react";

type EventState = {
  session: { id: string; role: "host" | "participant" };
  participant?: any;
  rounds: Record<string, any>;
  leaderboard: any[];
  quiz?: any[];
  answers?: { questionId: number; answerIndex: number }[];
  problems?: any[];
  purchases?: any[];
  questionScores?: {
    questionId: number;
    bestPassedCount: number;
    totalTests: number;
    pointsAwarded: number;
  }[];
  latestSubmission?: {
    questionId: number;
    status: "queued" | "running" | "completed" | "failed";
    passedCount: number;
    processedTests?: number;
    verdict: string;
    lastError?: string;
    createdAt: number;
    completedAt?: number;
    totalTests?: number;
    pointsAwarded?: number;
  } | null;
  latestRun?: {
    questionId: number;
    status: "queued" | "running" | "completed" | "failed";
    stdout: string;
    stderr: string;
    exitCode: number;
    elapsedMs: number;
    timedOut: boolean;
    samplePassed: boolean;
    executionOk: boolean;
    expectedOutput: string;
    lastError?: string;
  } | null;
  totalQueued?: number;
  myQueuePosition?: number | null;
  questionCount?: number;
  participantRank?: number;
  judgeConfigured?: boolean;
  serverTime: number;
};

const formatTime = (seconds: number) =>
  String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0") +
  ":" +
  String(Math.max(0, seconds) % 60).padStart(2, "0");
const request = async (body?: Record<string, unknown>) => {
  const response = await fetch(
    "/api/event",
    body
      ? {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store", credentials: "same-origin" },
  );
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok)
    throw new Error(
      data.error ||
        `Server request failed (${response.status}). Check the server configuration and logs.`,
    );
  return data;
};

const handleLogout = async () => {
  try {
    await request({ action: "logout" });
    window.location.reload();
  } catch (e) {
    console.error(e);
  }
};

function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      className={compact ? "logout-button compact" : "logout-button"}
      onClick={handleLogout}
      title="Log out"
    >
      <LogOut size={compact ? 16 : 18} />
      <span>LOG OUT</span>
    </button>
  );
}

function Logo() {
  return (
    <div className="logo">
      <Image
        src="/logo.jpeg"
        alt="IEEE CS SYP TECHX Madras 26"
        width={760}
        height={170}
        priority
      />
    </div>
  );
}
function Pill({
  children,
  kind = "cyan",
}: {
  children: React.ReactNode;
  kind?: string;
}) {
  return <em className={"pill " + kind}>{children}</em>;
}

function useConfirmDialog() {
  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    resolve: (answer: boolean) => void;
  } | null>(null);
  const ask = useCallback(
    (message: string, title = "Confirm action") =>
      new Promise<boolean>((resolve) => setDialog({ title, message, resolve })),
    [],
  );
  const close = (answer: boolean) => {
    dialog?.resolve(answer);
    setDialog(null);
  };
  const popup = dialog ? (
    <div className="overlay confirm-overlay" onClick={() => close(false)}>
      <section
        className="confirm-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <Pill>CONFIRMATION</Pill>
        <h2 id="confirm-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <footer>
          <button onClick={() => close(false)}>CANCEL</button>
          <button className="primary" onClick={() => close(true)}>
            CONFIRM
          </button>
        </footer>
      </section>
    </div>
  ) : null;
  return { ask, popup };
}

type SecurityNotice = {
  violationCount: number;
  warningsRemaining: number;
  disqualified: boolean;
  reason: string;
  timestamp: number;
  deduplicated?: boolean;
};

function ExamSecurity({
  round,
  state,
  setState,
  setError,
}: {
  round: "round1" | "round2";
  state: EventState;
  setState: (s: EventState) => void;
  setError: (s: string) => void;
}) {
  const [needsFullscreen, setNeedsFullscreen] = useState(true);
  const [notice, setNotice] = useState<SecurityNotice | null>(null);
  const armed = useRef(false);
  const reporting = useRef(false);
  const lastLocalReport = useRef(0);

  const enterSecureMode = useCallback(async () => {
    try {
      if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen();
      armed.current = true;
      setNeedsFullscreen(false);
      setNotice(null);
      setError("");
    } catch {
      setError("Fullscreen is required to participate. Allow fullscreen and try again.");
      setNeedsFullscreen(true);
    }
  }, [setError]);

  const reportViolation = useCallback(
    async (reason: string) => {
      const now = Date.now();
      if (!armed.current || reporting.current || now - lastLocalReport.current < 1000)
        return;
      lastLocalReport.current = now;
      reporting.current = true;
      try {
        const eventId =
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${now}-${Math.random().toString(36).slice(2)}`;
        const response = await fetch("/api/event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "security-violation",
            round,
            reason,
            eventId,
          }),
          keepalive: true,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Security event could not be recorded");
        if (data.securityNotice && !data.securityNotice.deduplicated)
          setNotice(data.securityNotice);
        setState(data);
      } catch (error) {
        setError((error as Error).message);
      } finally {
        reporting.current = false;
      }
    },
    [round, setError, setState],
  );

  useEffect(() => {
    armed.current = Boolean(document.fullscreenElement);
    setNeedsFullscreen(!document.fullscreenElement);
    document.body.classList.add("exam-security-active");

    const isEditor = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest(".cm-editor"));
    const blockClipboard = (event: Event) => {
      event.preventDefault();
      const reason =
        event.type === "copy"
          ? "copy-attempt"
          : event.type === "cut"
            ? "cut-attempt"
            : "paste-attempt";
      void reportViolation(reason);
    };
    const blockSelection = (event: Event) => {
      if (!isEditor(event.target)) event.preventDefault();
    };
    const blockContextMenu = (event: Event) => {
      event.preventDefault();
      void reportViolation("context-menu-attempt");
    };
    const blockShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && ["c", "v", "x", "a", "t", "n", "w"].includes(key)) {
        event.preventDefault();
        void reportViolation(key === "a" ? "select-all-attempt" : ["c", "v", "x"].includes(key) ? `${key === "c" ? "copy" : key === "v" ? "paste" : "cut"}-attempt` : "blocked-browser-shortcut");
      } else if ((event.ctrlKey && key === "tab") || (event.altKey && key === "tab") || key === "meta") {
        event.preventDefault();
        void reportViolation("blocked-browser-shortcut");
      }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") void reportViolation("tab-hidden");
    };
    const focusLost = () => void reportViolation("window-focus-lost");
    const fullscreenChanged = () => {
      const fullscreen = Boolean(document.fullscreenElement);
      setNeedsFullscreen(!fullscreen);
      if (!fullscreen && armed.current) void reportViolation("fullscreen-exit");
      if (fullscreen) armed.current = true;
    };

    document.addEventListener("copy", blockClipboard, true);
    document.addEventListener("cut", blockClipboard, true);
    document.addEventListener("paste", blockClipboard, true);
    document.addEventListener("selectstart", blockSelection, true);
    document.addEventListener("contextmenu", blockContextMenu, true);
    document.addEventListener("keydown", blockShortcuts, true);
    document.addEventListener("visibilitychange", visibilityChanged);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    window.addEventListener("blur", focusLost);
    return () => {
      document.body.classList.remove("exam-security-active");
      document.removeEventListener("copy", blockClipboard, true);
      document.removeEventListener("cut", blockClipboard, true);
      document.removeEventListener("paste", blockClipboard, true);
      document.removeEventListener("selectstart", blockSelection, true);
      document.removeEventListener("contextmenu", blockContextMenu, true);
      document.removeEventListener("keydown", blockShortcuts, true);
      document.removeEventListener("visibilitychange", visibilityChanged);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      window.removeEventListener("blur", focusLost);
    };
  }, [reportViolation]);

  const count = Number(state.participant?.securityViolationCount || 0);
  const remaining = Math.max(0, 3 - count);
  return (
    <>
      <div className={`exam-security-status ${count ? "warn" : ""}`}>
        <ShieldCheck size={15} /> EXAM SECURITY · {remaining} WARNING{remaining === 1 ? "" : "S"} LEFT
      </div>
      {(needsFullscreen || notice) && (
        <div className="overlay fullscreen-gate">
          <section className="confirm-card security-card" role="alertdialog" aria-modal="true">
            <Pill kind={notice ? "hard" : "cyan"}>
              {notice ? (notice.violationCount === 1 ? "FIRST WARNING" : "FINAL WARNING") : "EXAM SECURITY"}
            </Pill>
            <Maximize2 size={34} />
            <h2>{notice ? "Security violation detected" : "Fullscreen is required"}</h2>
            <p>
              {notice
                ? `Reason: ${notice.reason.replaceAll("-", " ")}. ${notice.warningsRemaining} warning${notice.warningsRemaining === 1 ? "" : "s"} remain before automatic disqualification.`
                : "Enter fullscreen to begin. Leaving this tab, losing window focus, exiting fullscreen, clipboard actions, right-click, and blocked browser shortcuts are recorded."}
            </p>
            <footer>
              <button className="primary" onClick={enterSecureMode}>
                {notice ? "ACKNOWLEDGE & CONTINUE" : "ENTER SECURE FULLSCREEN"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
function Top({ state, label }: { state: EventState; label: string }) {
  const user = state.participant;
  const time = label.includes("QUIZ")
    ? state.rounds.round1?.remainingSeconds
    : state.rounds.round2?.remainingSeconds;
  return (
    <header className="top">
      <Logo />
      <Pill>{label}</Pill>
      <div className="identity">
        <span>{(user?.name || "Host").slice(0, 2).toUpperCase()}</span>
        <b>
          {user?.name || "Host Admin"}
          <small>{state.session.id}</small>
        </b>
      </div>
      <div className="timer">
        <Clock3 />
        <span>
          <small>SERVER TIME</small>
          <b>{formatTime(time || 0)}</b>
        </span>
        <LogoutButton compact />
      </div>
    </header>
  );
}

export default function Home() {
  const [state, setState] = useState<EventState | null>(null);
  const [role, setRole] = useState<"host" | "participant">("participant");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await request());
    } catch (e) {
      if ((e as Error).message !== "Authentication required")
        setError((e as Error).message);
    }
  }, []);
  const refreshLive = useCallback(async (privateState = false) => {
    try {
      const response = await fetch(
        `/api/event?view=${privateState ? "private" : "live"}`,
        {
        cache: "no-store",
        credentials: "same-origin",
        },
      );
      const live = await response.json();
      if (response.status === 401) {
        setState(null);
        setError("Your session expired. Please sign in again.");
        return;
      }
      if (!response.ok) throw new Error(live.error || "Live update failed");
      setState((current) => {
        if (!current) return live;
        const participant = live.participant
          ? { ...current.participant, ...live.participant }
          : current.participant;
        return {
          ...current,
          ...live,
          participant,
          quiz: current.quiz,
          answers: current.answers,
          problems: current.problems,
          purchases: current.purchases,
          questionCount: current.questionCount,
          leaderboard:
            current.session.role === "host"
              ? live.leaderboard || current.leaderboard
              : current.leaderboard,
        };
      });
    } catch (e) {
      if ((e as Error).message !== "Authentication required")
        setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const sessionRole = state?.session.role;
  const round1Status = state?.rounds.round1?.status;
  const round2Status = state?.rounds.round2?.status;
  useEffect(() => {
    if (!sessionRole) return;
    const submissionStatus = state?.latestSubmission?.status;
    const runStatus = state?.latestRun?.status;
    const isJudging =
      submissionStatus === "queued" ||
      submissionStatus === "running" ||
      runStatus === "queued" ||
      runStatus === "running";
    const delay = isJudging ? 1500 : sessionRole === "host" ? 3000 : 10000;
    const timer = setInterval(
      () => refreshLive(isJudging && sessionRole === "participant"),
      delay,
    );
    return () => clearInterval(timer);
  }, [
    refreshLive,
    sessionRole,
    round1Status,
    round2Status,
    state?.latestSubmission?.status,
    state?.latestRun?.status,
  ]);

  // Participant-specific scores, flags, and queue details are deliberately
  // uncached. Refresh them less often while idle; active judging above remains
  // fast so run/submit feedback is responsive.
  useEffect(() => {
    if (sessionRole !== "participant") return;
    const timer = setInterval(() => refreshLive(true), 60_000);
    return () => clearInterval(timer);
  }, [refreshLive, sessionRole]);

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      setState(await request({ action: "login", role, id, password }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!state)
    return (
      <main className="login">
        <header>
          <Logo />
          <span className="online">
            <i /> CENTRAL EVENT SERVER
          </span>
        </header>
        <section>
          <div className="intro">
            <Pill>PRODUCTION CONTROL</Pill>
            <h1>
              THINK FAST.
              <br />
              <span>CODE FASTER.</span>
            </h1>
            <p>
              Scores, coins, timers, purchases, submissions and ranks are
              verified and stored by the event server.
            </p>
            <div className="steps">
              <b>
                01{" "}
                <small>
                  QUIZ
                  <br />
                  EARN COINS
                </small>
              </b>
              <b>
                02{" "}
                <small>
                  CODE
                  <br />
                  SOLVE & BID
                </small>
              </b>
              <b>
                03{" "}
                <small>
                  WIN
                  <br />
                  CLIMB THE BOARD
                </small>
              </b>
            </div>
          </div>
          <div className="loginbox">
            <div className="tabs">
              <button
                className={role === "participant" ? "active" : ""}
                onClick={() => {
                  setRole("participant");
                  setId("");
                  setPassword("");
                  setError("");
                }}
              >
                <Users /> Participant
              </button>
              <button
                className={role === "host" ? "active" : ""}
                onClick={() => {
                  setRole("host");
                  setId("");
                  setPassword("");
                  setError("");
                }}
              >
                <ShieldCheck /> Host
              </button>
            </div>
            <h2>
              {role === "host" ? "HOST CONTROL ACCESS" : "JOIN THE EVENT"}
            </h2>
            <p>Use the credentials issued by the event team.</p>
            <label>
              {role === "host" ? "ADMIN ID" : "TEAM NAME"}
              <input
                autoComplete="username"
                placeholder={
                  role === "host" ? "Enter host ID" : "Enter team name"
                }
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </label>
            <label>
              EVENT PASSWORD
              <input
                autoComplete="current-password"
                placeholder="Enter event password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
              />
            </label>
            {error && (
              <p className="api-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={loading || !id.trim() || !password}
              onClick={login}
            >
              {loading
                ? "AUTHENTICATINGâ€¦"
                : role === "host"
                  ? "OPEN CONTROL ROOM"
                  : "JOIN EVENT"}
            </button>
            <small className="secure">
              <Lock /> Signed HttpOnly session · Server-authorized actions
            </small>
          </div>
        </section>
      </main>
    );

  if (state.session.role === "host")
    return (
      <Host
        state={state}
        setState={setState}
        setError={setError}
        error={error}
      />
    );
  const p = state.participant;
  const r1 = state.rounds.round1;
  const r2 = state.rounds.round2;
  if (p.disqualified || p.locked)
    return (
      <StatusScreen
        title={p.disqualified ? "Participant disqualified" : "Account locked"}
        text={
          p.disqualified
            ? "Three exam-security violations were recorded. Submissions are locked until a host explicitly resets this participant."
            : "The host has locked this participant account. Contact the event desk."
        }
      />
    );
  if (!p.quizSubmittedAt && r1.status === "active")
    return <Quiz state={state} setState={setState} setError={setError} />;
  if (p.quizSubmittedAt && r2.status === "active" && !p.language)
    return <Language state={state} setState={setState} setError={setError} />;
  if (p.quizSubmittedAt && r2.status === "active" && p.codingSubmittedAt)
    return (
      <StatusScreen
        title="Coding round submitted"
        text="Your best partial and full-test scores are saved. Wait for the host to end and publish the event."
      />
    );
  if (p.quizSubmittedAt && r2.status === "active" && p.language)
    return <Coding state={state} setState={setState} setError={setError} />;
  if (r2.status === "ended")
    return (
      <StatusScreen
        title={r2.results_published ? "Event completed" : "Results locked"}
        text={
          r2.results_published
            ? "Your final rank is #" +
              (state.participantRank || 0) +
              "."
            : "The host will publish the final results shortly."
        }
      />
    );
  return <Waiting state={state} />;
}

function StatusScreen({ title, text }: { title: string; text: string }) {
  return (
    <div className="waiting">
      <Logo />
      <div className="seal">
        <Lock />
      </div>
      <h1>{title}</h1>
      <p>{text}</p>
      <LogoutButton />
    </div>
  );
}

function Waiting({ state }: { state: EventState }) {
  const p = state.participant;
  const waitingFor = !p.quizSubmittedAt
    ? "WAITING FOR HOST TO START ROUND 1"
    : "WAITING FOR HOST TO START ROUND 2";
  return (
    <div className="waiting">
      <Logo />
      <div className="seal">
        <Check />
      </div>
      <Pill>{p.quizSubmittedAt ? "ROUND 1 COMPLETE" : "CHECKED IN"}</Pill>
      <h1>
        {p.quizSubmittedAt
          ? "Quiz securely submitted."
          : "Welcome, " + p.name + "."}
      </h1>
      <p>
        Your progress is stored centrally. You will enter the round
        automatically when the host starts it.
      </p>
      {p.quizSubmittedAt && (
        <div className="results">
          <div>
            <small>CORRECT</small>
            <b>{p.quizCorrect}/40</b>
          </div>
          <div>
            <small>COINS EARNED</small>
            <b className="gold">{p.coins}</b>
          </div>
          <div>
            <small>CURRENT RANK</small>
            <b>#{state.participantRank || 0}</b>
          </div>
        </div>
      )}
      <div className="waitline">
        <i /> {waitingFor}
      </div>
      <LogoutButton />
    </div>
  );
}

function Quiz({
  state,
  setState,
  setError,
}: {
  state: EventState;
  setState: (s: EventState) => void;
  setError: (s: string) => void;
}) {
  const initial = Object.fromEntries(
    (state.answers || []).map((a) => [a.questionId, a.answerIndex]),
  );
  const [answers, setAnswers] = useState<Record<number, number>>(initial);
  const [current, setCurrent] = useState(0);
  const { ask, popup } = useConfirmDialog();
  const q = state.quiz![current];
  const totalQuestions = state.quiz?.length || 40;
  const isLastQuestion = current === totalQuestions - 1;
  const answer = async (index: number) => {
    setAnswers((old) => ({ ...old, [q.id]: index }));
    try {
      await request({ action: "answer", questionId: q.id, answerIndex: index });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const submit = async () => {
    if (
      !(await ask(
        "Submit the quiz? Answers will be locked and scored by the server.",
        "Submit Round 1",
      ))
    )
      return;
    try {
      setState(await request({ action: "submit-quiz" }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (state.rounds.round1?.remainingSeconds === 0) {
      request({ action: "submit-quiz" })
        .then(setState)
        .catch((e) => setError(e.message));
    }
  }, [state.rounds.round1?.remainingSeconds, setError, setState]);
  return (
    <div className="app">
      <ExamSecurity
        round="round1"
        state={state}
        setState={setState}
        setError={setError}
      />
      <Top state={state} label="ROUND 1 / QUIZ" />
      <main className="quiz">
        <section className="question">
          <div className="eyebrow">
            QUESTION {current + 1} / {totalQuestions}{" "}
            <Pill kind={q.difficulty.toLowerCase()}>{q.difficulty}</Pill>
          </div>
          <small>{q.category}</small>
          <h2>{q.prompt}</h2>
          <div className="answers">
            {q.options.map((option: string, index: number) => (
              <button
                className={answers[q.id] === index ? "chosen" : ""}
                onClick={() => answer(index)}
                key={option}
              >
                <b>{String.fromCharCode(65 + index)}</b>
                {option}
                {answers[q.id] === index && <Check />}
              </button>
            ))}
          </div>
          <footer>
            <button
              onClick={() => setCurrent(Math.max(0, current - 1))}
              disabled={current === 0}
            >
              Previous
            </button>
            {isLastQuestion ? (
              <button className="submit" onClick={submit}>
                SUBMIT QUIZ
              </button>
            ) : (
              <button
                onClick={() =>
                  setCurrent(Math.min(totalQuestions - 1, current + 1))
                }
              >
                Next
              </button>
            )}
          </footer>
        </section>
        <aside>
          <div className="balance">
            <small>SERVER BALANCE</small>
            <b>
              <Coins /> {state.participant.coins}
            </b>
            <span>VIRTUAL COINS</span>
          </div>
          <div className="nav">
            <header>
              <b>QUESTION NAVIGATOR</b>
              <span>{Object.keys(answers).length}/40 answered</span>
            </header>
            <div>
              {state.quiz!.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => setCurrent(index)}
                  className={
                    (current === index ? "current " : "") +
                    (answers[item.id] !== undefined ? "answered" : "")
                  }
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>
      {popup}
    </div>
  );
}

function Language({
  state,
  setState,
  setError,
}: {
  state: EventState;
  setState: (s: EventState) => void;
  setError: (s: string) => void;
}) {
  const [language, setLanguage] = useState<"Python" | "Java">("Python");
  const { ask, popup } = useConfirmDialog();
  const confirmLanguage = async () => {
    if (
      !(await ask(
        "Lock " + language + " for Round 2? This cannot be changed.",
        "Confirm language",
      ))
    )
      return;
    try {
      setState(await request({ action: "select-language", language }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="language">
      <ExamSecurity
        round="round2"
        state={state}
        setState={setState}
        setError={setError}
      />
      <Logo />
      <Pill>ROUND 2 IS LIVE</Pill>
      <h1>Choose your language</h1>
      <p>This server-enforced choice is locked for the entire coding round.</p>
      <div>
        <button
          className={language === "Python" ? "active" : ""}
          onClick={() => setLanguage("Python")}
        >
          <b>PY</b>Python 3.12
        </button>
        <button
          className={language === "Java" ? "active" : ""}
          onClick={() => setLanguage("Java")}
        >
          <b>JV</b>Java 21
        </button>
      </div>
      <button className="primary" onClick={confirmLanguage}>
        CONFIRM {language.toUpperCase()}
      </button>
      <LogoutButton />
      {popup}
    </div>
  );
}

function Coding({
  state,
  setState,
  setError,
}: {
  state: EventState;
  setState: (s: EventState) => void;
  setError: (s: string) => void;
}) {
  const p = state.participant;
  const problems = state.problems || [];
  const [question, setQuestion] = useState(0);
  const starter =
    p.language === "Python"
      ? "def solve():\n    # Write your solution\n    pass\n\nif __name__ == '__main__':\n    solve()\n"
      : "import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    // Write your solution\n  }\n}\n";
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [output, setOutput] = useState(
    state.judgeConfigured
      ? "Judge queue is ready. Click RUN to test with sample input, or SUBMIT to judge all hidden tests."
      : "Judge queue is disabled. Ask the host to enable it.",
  );
  const [runOutput, setRunOutput] = useState("");
  const [market, setMarket] = useState(false);
  const { ask, popup } = useConfirmDialog();
  const problem = problems[question];
  const source = drafts[problem.id] ?? starter;
  const activeRun = state.latestRun;
  const activeSubmission = state.latestSubmission;
  const isBusy =
    activeRun?.status === "queued" ||
    activeRun?.status === "running" ||
    activeSubmission?.status === "queued" ||
    activeSubmission?.status === "running";
  const score = (state.questionScores || []).find(
    (item) => item.questionId === problem.id,
  );
  const setSource = (value: string) =>
    setDrafts((current) => ({ ...current, [problem.id]: value }));
  const buy = async (kind: string) => {
    if (
      !(await ask(
        "Purchase this help? Coins are deducted permanently.",
        "Purchase help",
      ))
    )
      return;
    try {
      setState(
        await request({
          action: "purchase-help",
          kind,
          questionId: problem.id,
        }),
      );
      setMarket(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const runCode = async () => {
    if (isBusy) return;
    setRunOutput("QUEUED — Your sample run is waiting for a sandbox worker...");
    try {
      const data = await request({
        action: "run-sample",
        source,
        questionId: problem.id,
      });
      if (data.state) setState(data.state);
    } catch (e) {
      setRunOutput("Run failed: " + (e as Error).message);
    }
  };
  useEffect(() => {
    const run = state.latestRun;
    if (!run || run.questionId !== problem.id) return;
    if (run.status === "queued") {
      setRunOutput(
        `QUEUED${state.myQueuePosition ? ` — Queue position #${state.myQueuePosition}` : ""}\nWaiting for a sandbox worker...`,
      );
    } else if (run.status === "running") {
      setRunOutput("RUNNING — Executing your code with the sample input...");
    } else if (run.status === "failed") {
      setRunOutput(
        run.lastError ||
          "The sandbox could not process this run. Please retry.",
      );
    } else if (run.timedOut) {
      setRunOutput(
        "TIMEOUT — Your code exceeded the time limit on the sample input.",
      );
    } else if (run.exitCode !== 0) {
      let text = `RUNTIME ERROR (exit ${run.exitCode})\n`;
      if (run.stderr) text += `\nStderr:\n${run.stderr}`;
      if (run.stdout) text += `\nStdout:\n${run.stdout}`;
      setRunOutput(text);
    } else {
      let text = `${run.samplePassed ? "✓ SAMPLE PASSED" : "✗ SAMPLE OUTPUT DIFFERS"} (${run.elapsedMs}ms)\n\n`;
      text += `Your output:\n${run.stdout || "(empty)"}\n`;
      if (run.stderr) text += `\nStderr:\n${run.stderr}\n`;
      if (!run.samplePassed) text += `\nExpected:\n${run.expectedOutput}`;
      text += "\n\nYou may now submit this exact code to the hidden tests.";
      setRunOutput(text);
    }
  }, [problem.id, state.latestRun, state.myQueuePosition]);
  useEffect(() => {
    const submission = state.latestSubmission;
    if (!submission || submission.questionId !== problem.id) {
      const saved = (state.questionScores || []).find(
        (item) => item.questionId === problem.id,
      );
      setOutput(
        saved
          ? `Best result: ${saved.bestPassedCount}/${saved.totalTests} tests · ${saved.pointsAwarded}/${problem.points} points.`
          : "No execution recorded for this question yet.",
      );
      return;
    }
    if (submission.status === "queued") {
      const pos = state.myQueuePosition;
      const posText = pos ? ` — Queue position #${pos}` : "";
      setOutput(
        `QUEUED${posText}\nYour submission is waiting for a sandbox worker...\nTotal in queue: ${state.totalQueued || "?"}`,
      );
    } else if (submission.status === "running")
      setOutput(
        `RUNNING — Sandbox worker is executing hidden tests...\nPassed so far: ${submission.passedCount || 0}/${submission.processedTests || 0} processed (${submission.totalTests || "?"} total).`,
      );
    else if (submission.status === "completed")
      setOutput(
        `${submission.verdict === "accepted" ? "✓ ALL TESTS PASSED!" : "✗ PARTIAL / WRONG ANSWER"}\n\nTests passed: ${submission.passedCount}/${submission.totalTests || "?"}\nScore earned: ${submission.pointsAwarded || 0} / ${problem.points} pts${submission.verdict !== "accepted" ? "\n\nPartial marks are saved if this improves your best result." : ""}`,
      );
    else
      setOutput(
        submission.lastError ||
          "The judge could not process this submission. You may retry.",
      );
  }, [
    problem.id,
    problem.points,
    state.latestSubmission,
    state.myQueuePosition,
    state.questionScores,
    state.totalQueued,
  ]);
  const submit = async () => {
    if (
      !(await ask(
        `Submit your ${p.language} solution for ${problem.title}?`,
        "Submit to judge",
      ))
    )
      return;
    setOutput("Adding submission to the secure judge queue...");
    try {
      const data = await request({
        action: "submit-code",
        source,
        questionId: problem.id,
      });
      setOutput("Submission queued. Waiting for the sandbox worker...");
      if (data.state) setState(data.state);
    } catch (e) {
      setOutput((e as Error).message);
    }
  };
  const finish = async () => {
    if (
      !(await ask(
        "Turn in the coding round? You must have executed at least one judged submission for every question. You cannot submit more code afterward.",
        "Turn in coding round?",
      ))
    )
      return;
    try {
      setState(await request({ action: "finish-coding" }));
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <div className="ide">
      <ExamSecurity
        round="round2"
        state={state}
        setState={setState}
        setError={setError}
      />
      <Top state={state} label="ROUND 2 / CODING" />
      <div className="problemtabs">
        <div>
          {problems.map((item, index) => {
            const itemScore = (state.questionScores || []).find(
              (entry) => entry.questionId === item.id,
            );
            const passedAll =
              itemScore && itemScore.bestPassedCount === itemScore.totalTests;
            return (
              <button
                className={
                  index === question ? "active" : passedAll ? "done" : ""
                }
                onClick={() => setQuestion(index)}
                key={item.id}
              >
                {passedAll ? <Check /> : "Q" + (index + 1)}
                <small>{item.difficulty}</small>
                {itemScore && <small>{itemScore.pointsAwarded} pts</small>}
              </button>
            );
          })}
        </div>
        <aside>
          <span>
            <Coins /> {p.coins}
          </span>
          <span>HELP {p.helpsUsed}/3</span>
          <span>
            RANK #{state.participantRank || 0}
          </span>
          <button onClick={() => setMarket(true)}>
            <ShoppingCart /> HELP MARKETPLACE
          </button>
          <button className="turn-in" onClick={finish}>
            TURN IN ROUND
          </button>
        </aside>
      </div>
      <main className="workspace">
        <section className="brief">
          <div className="eyebrow">
            QUESTION {question + 1}{" "}
            <Pill kind={problem.difficulty.toLowerCase()}>
              {problem.difficulty}
            </Pill>
            <b>{problem.points} PTS</b>
            {score && (
              <b className="partial-score">
                BEST {score.bestPassedCount}/{score.totalTests} ·{" "}
                {score.pointsAwarded} PTS
              </b>
            )}
          </div>
          <h2>{problem.title}</h2>
          <p>{problem.statement}</p>
          <h4>INPUT FORMAT</h4>
          <p>{problem.inputFormat}</p>
          <h4>OUTPUT FORMAT</h4>
          <p>{problem.outputFormat}</p>
          <div className="examples">
            <pre>
              <small>EXAMPLE INPUT</small>
              {"\n"}
              {problem.sampleInput}
            </pre>
            <pre>
              <small>EXAMPLE OUTPUT</small>
              {"\n"}
              {problem.sampleOutput}
            </pre>
          </div>
        </section>
        <section className="codearea">
          <header>
            <Code2 /> solution.{p.language === "Python" ? "py" : "java"}
            <span>{p.language} · UTF-8</span>
          </header>
          <CodeMirror
            className="real-editor"
            value={source}
            height="100%"
            theme="dark"
            extensions={[
              p.language === "Python" ? python() : java(),
              EditorState.tabSize.of(4),
              indentUnit.of("    "),
              keymap.of([indentWithTab]),
            ]}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              indentOnInput: true,
            }}
            onChange={setSource}
          />
          <div className="console">
            <div className="console-tabs">
              <b>▶ RUN OUTPUT</b>
              <b className="console-sep">|</b>
              <b>⬆ JUDGE RESULT</b>
            </div>
            {runOutput && (
              <pre
                className={
                  "run-out" +
                  (runOutput.includes("✓")
                    ? " pass"
                    : runOutput.includes("✗") ||
                        runOutput.includes("ERROR") ||
                        runOutput.includes("TIMEOUT")
                      ? " fail"
                      : "")
                }
              >
                {runOutput}
              </pre>
            )}
            <pre
              className={
                "judge-out" +
                (output.includes("✓")
                  ? " pass"
                  : output.includes("✗")
                    ? " fail"
                    : output.includes("QUEUED") || output.includes("RUNNING")
                      ? " pending"
                      : "")
              }
            >
              {output}
            </pre>
          </div>
          <footer>
            <button
              disabled={question === 0}
              onClick={() => setQuestion((current) => Math.max(0, current - 1))}
            >
              PREVIOUS QUESTION
            </button>
            <button
              onClick={() => {
                setRunOutput("");
                setOutput("Sample output expected: " + problem.sampleOutput);
              }}
            >
              CHECK SAMPLE
            </button>
            <button
              className="run"
              disabled={!state.judgeConfigured || isBusy}
              onClick={runCode}
              title="Run your code against the sample input only (does not affect score)"
            >
              {isBusy ? "BUSY..." : "▶ RUN"}
            </button>
            <button
              className="submit"
              disabled={!state.judgeConfigured || isBusy}
              onClick={submit}
            >
              ⬆ SUBMIT TO JUDGE
            </button>
            <button
              disabled={question === problems.length - 1}
              onClick={() =>
                setQuestion((current) =>
                  Math.min(problems.length - 1, current + 1),
                )
              }
            >
              NEXT QUESTION
            </button>
          </footer>
        </section>
      </main>
      {market && (
        <div className="overlay" onClick={() => setMarket(false)}>
          <div className="market" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>
                <ShoppingCart /> Help Marketplace
              </h2>
              <button onClick={() => setMarket(false)}>✕</button>
            </header>
            <div className="market-balance">
              <span>
                Balance: <b className="gold">{p.coins} COINS</b>
              </span>
              <span>
                Purchases remaining: <b>{Math.max(0, 3 - p.helpsUsed)}/3</b>
              </span>
            </div>
            <p className="market-note">
              Every purchase is server-validated, coin-deducted, and
              question-specific.
            </p>
            {(
              ["small", "algorithm", "pseudocode", "reveal", "ai"] as const
            ).map((kind) => {
              const meta: Record<string, [string, number, string]> = {
                small: ["💡 Small Hint", 200, "A targeted tip to get unstuck"],
                algorithm: [
                  "🧠 Algorithm Hint",
                  300,
                  "Core algorithm insight for this problem",
                ],
                pseudocode: [
                  "📋 Pseudocode + Logic",
                  450,
                  "Step-by-step solution structure",
                ],
                reveal: [
                  "🔓 50% Code Reveal",
                  650,
                  "Starter template with key steps filled in",
                ],
                ai: [
                  "🤖 AI Walkthrough",
                  800,
                  "3-message guided AI explanation",
                ],
              };
              const [name, cost, desc] = meta[kind];
              const alreadyBought = (state.purchases || []).some(
                (pu: any) => pu.questionId === problem.id && pu.kind === kind,
              );
              const purchase = (state.purchases || []).find(
                (pu: any) => pu.questionId === problem.id && pu.kind === kind,
              );
              return (
                <div
                  key={kind}
                  className={"market-item" + (alreadyBought ? " bought" : "")}
                >
                  <span>
                    <b>{name}</b>
                    <small>{desc}</small>
                  </span>
                  <span className="market-item-right">
                    <strong>{cost} COINS</strong>
                    {alreadyBought ? (
                      <button
                        className="view-btn"
                        onClick={() => {
                          setRunOutput(
                            "── PURCHASED HELP ──\n" + purchase.content,
                          );
                          setMarket(false);
                        }}
                      >
                        VIEW
                      </button>
                    ) : (
                      <button
                        disabled={p.helpsUsed >= 3 || p.coins < cost}
                        onClick={() => buy(kind)}
                        className="buy-btn"
                      >
                        BUY
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            <div className="market-purchases">
              {(state.purchases || []).filter(
                (pu: any) => pu.questionId === problem.id,
              ).length > 0 && (
                <div className="purchased-list">
                  <h4>PURCHASED FOR THIS QUESTION</h4>
                  {(state.purchases || [])
                    .filter((pu: any) => pu.questionId === problem.id)
                    .map((pu: any) => (
                      <div key={pu.id} className="purchase-card">
                        <b>
                          {pu.kind.toUpperCase()} — {pu.cost} coins
                        </b>
                        <pre>{pu.content}</pre>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {popup}
    </div>
  );
}

function TeamManager({
  setState,
  setError,
}: {
  setState: (state: EventState) => void;
  setError: (message: string) => void;
}) {
  const [teamName, setTeamName] = useState("");
  const [bulkTeams, setBulkTeams] = useState("");
  const [created, setCreated] = useState<
    { id: string; name: string; password: string }[]
  >([]);
  const { ask, popup } = useConfirmDialog();
  const add = async (teams: string[]) => {
    try {
      const data = await request({ action: "add-teams", teams });
      setCreated(data.created || []);
      setState(data.state);
      setTeamName("");
      setBulkTeams("");
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const removeAll = async () => {
    if (
      !(await ask(
        "Permanently remove every participant team, including submissions, scores and purchases?",
        "Remove all teams?",
      ))
    )
      return;
    try {
      const data = await request({ action: "remove-all-teams" });
      setState(data.state);
      setCreated([]);
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <>
      <section className="management-card">
        <header>
          <div>
            <Pill>TEAM ACCESS</Pill>
            <h2>Add participant teams</h2>
          </div>
          <small>The team name is also its initial password.</small>
        </header>
        <div className="single-entry">
          <input
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            placeholder="Single team name"
            maxLength={80}
          />
          <button onClick={() => add([teamName])} disabled={!teamName.trim()}>
            ADD TEAM
          </button>
        </div>
        <label>
          BULK TEAM NAMES â€” ONE PER LINE
          <textarea
            value={bulkTeams}
            onChange={(event) => setBulkTeams(event.target.value)}
            placeholder={"Alpha Coders\nByte Brigade\nSyntax Squad"}
          />
        </label>
        <button
          className="management-submit"
          onClick={() => add(bulkTeams.split(/\r?\n|,/))}
          disabled={!bulkTeams.trim()}
        >
          CREATE TEAMS IN BULK
        </button>
        <button className="management-submit danger-action" onClick={removeAll}>
          REMOVE ALL CURRENT TEAMS
        </button>
        {created.length > 0 && (
          <div className="credential-result">
            <b>CREATED CREDENTIALS</b>
            {created.map((team) => (
              <code key={team.id}>
                username: {team.name} · password: {team.password} · internal
                ID: {team.id}
              </code>
            ))}
          </div>
        )}
      </section>
      {popup}
    </>
  );
}

const blankQuestion = {
  title: "",
  difficulty: "EASY",
  points: "300",
  statement: "",
  inputFormat: "",
  outputFormat: "",
  sampleInput: "",
  sampleOutput: "",
  hints: "",
  tests: '[{"input":"","expectedOutput":""}]',
};
function QuestionManager({
  questionCount,
  setState,
  setError,
}: {
  questionCount: number;
  setState: (state: EventState) => void;
  setError: (message: string) => void;
}) {
  const [question, setQuestion] = useState(blankQuestion);
  const [bulk, setBulk] = useState("");
  const update = (field: keyof typeof blankQuestion, value: string) =>
    setQuestion((current) => ({ ...current, [field]: value }));
  const save = async (questions: unknown[]) => {
    try {
      const data = await request({ action: "add-questions", questions });
      setState(data.state);
      setQuestion(blankQuestion);
      setBulk("");
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const saveSingle = () => {
    try {
      void save([
        {
          ...question,
          points: Number(question.points),
          hints: question.hints.split(/\r?\n/).filter(Boolean),
          tests: JSON.parse(question.tests),
        },
      ]);
    } catch {
      setError("Test cases must be valid JSON.");
    }
  };
  const saveBulk = () => {
    try {
      const questions = JSON.parse(bulk);
      if (!Array.isArray(questions)) throw new Error();
      void save(questions);
    } catch {
      setError("Bulk questions must be a valid JSON array.");
    }
  };
  return (
    <section className="management-card question-manager">
      <header>
        <div>
          <Pill>QUESTION BANK</Pill>
          <h2>Add coding questions</h2>
        </div>
        <small>{questionCount} currently available</small>
      </header>
      <div className="question-fields">
        <input
          value={question.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder="Question title"
        />
        <select
          value={question.difficulty}
          onChange={(event) => update("difficulty", event.target.value)}
        >
          <option>EASY</option>
          <option>MEDIUM</option>
          <option>HARD</option>
        </select>
        <input
          type="number"
          min="1"
          max="10000"
          value={question.points}
          onChange={(event) => update("points", event.target.value)}
          placeholder="Points"
        />
        <textarea
          className="wide"
          value={question.statement}
          onChange={(event) => update("statement", event.target.value)}
          placeholder="Problem statement"
        />
        <input
          value={question.inputFormat}
          onChange={(event) => update("inputFormat", event.target.value)}
          placeholder="Input format"
        />
        <input
          value={question.outputFormat}
          onChange={(event) => update("outputFormat", event.target.value)}
          placeholder="Output format"
        />
        <textarea
          value={question.sampleInput}
          onChange={(event) => update("sampleInput", event.target.value)}
          placeholder="Sample input"
        />
        <textarea
          value={question.sampleOutput}
          onChange={(event) => update("sampleOutput", event.target.value)}
          placeholder="Sample output"
        />
        <textarea
          value={question.hints}
          onChange={(event) => update("hints", event.target.value)}
          placeholder="Hints â€” one per line"
        />
        <textarea
          value={question.tests}
          onChange={(event) => update("tests", event.target.value)}
          placeholder='[{"input":"...","expectedOutput":"..."}]'
        />
      </div>
      <button className="management-submit" onClick={saveSingle}>
        ADD SINGLE QUESTION
      </button>
      <details>
        <summary>BULK QUESTION JSON</summary>
        <textarea
          className="bulk-json"
          value={bulk}
          onChange={(event) => setBulk(event.target.value)}
          placeholder='[{"title":"...","difficulty":"EASY","points":300,"statement":"...","inputFormat":"...","outputFormat":"...","sampleInput":"...","sampleOutput":"...","hints":[],"tests":[{"input":"...","expectedOutput":"..."}]}]'
        />
        <button
          className="management-submit"
          onClick={saveBulk}
          disabled={!bulk.trim()}
        >
          ADD BULK QUESTIONS
        </button>
      </details>
    </section>
  );
}

function Host({
  state,
  setState,
  setError,
  error,
}: {
  state: EventState;
  setState: (s: EventState) => void;
  setError: (s: string) => void;
  error: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<
    "all" | "locked" | "disqualified"
  >("all");
  const [scoreDelta, setScoreDelta] = useState("");
  const [scoreReason, setScoreReason] = useState("");
  const { ask, popup } = useConfirmDialog();
  const person =
    state.leaderboard.find((team) => team.id === selectedId) ||
    state.leaderboard[0] ||
    {};
  const visibleTeams = state.leaderboard.filter((team) =>
    teamFilter === "locked"
      ? team.locked && !team.disqualified
      : teamFilter === "disqualified"
        ? team.disqualified
        : true,
  );
  const control = async (round: string, action: string, seconds?: number) => {
    const roundState = state.rounds[round];
    if (
      action === "start" &&
      roundState?.status !== "waiting" &&
      !(await ask(
        round === "round1"
          ? "This starts a new event run. Team accounts and questions are kept, but all previous answers, submissions, scores, purchases and published results are cleared."
          : "This restarts the Round 2 server timer. Existing attempts and best scores are preserved.",
        round === "round1"
          ? "Reset and start Round 1?"
          : "Restart Round 2 timer?",
      ))
    )
      return;
    if (
      (action === "end" || action === "publish") &&
      !(await ask(
        action === "end"
          ? "This stops the selected round for every participant. You can explicitly restart its timer later."
          : "This makes the final Round 2 results visible to participants.",
        action === "end" ? "End the round?" : "Publish results?",
      ))
    )
      return;
    try {
      setState(
        await request({
          action: "host-control",
          round,
          control: action,
          seconds,
        }),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const moderate = async (action: string) => {
    if (
      !(await ask(
        `${action === "remove" ? "Permanently remove" : action} ${person.name}?${action === "remove" ? " Their submissions, scores and audit data will also be deleted." : ""}`,
        "Participant control",
      ))
    )
      return;
    try {
      const nextState = await request({
        action: "participant-control",
        participantId: person.id,
        control: action,
      });
      setState(nextState);
      if (action === "remove") setSelectedId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const adjustScore = async () => {
    const delta = Number(scoreDelta);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 5000)
      return setError(
        "Enter a whole-number score adjustment between -5000 and 5000.",
      );
    if (scoreReason.trim().length < 5)
      return setError("Add a short reason for the audit log.");
    if (
      !(await ask(
        `Apply ${delta > 0 ? "+" : ""}${delta} points to ${person.name}?`,
        "Manual score adjustment",
      ))
    )
      return;
    try {
      setState(
        await request({
          action: "manual-score",
          participantId: person.id,
          delta,
          reason: scoreReason.trim(),
        }),
      );
      setScoreDelta("");
      setScoreReason("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const round1 = state.rounds.round1;
  const round2 = state.rounds.round2;
  const liveRoundId =
    round2?.status === "active" || round2?.status === "paused"
      ? "round2"
      : round1?.status === "active" || round1?.status === "paused"
        ? "round1"
        : null;
  const displayRoundId =
    liveRoundId || (round2?.status === "ended" ? "round2" : "round1");
  const displayRound = state.rounds[displayRoundId];
  const displayStatus = String(displayRound?.status || "waiting");
  const startLabel = (round: any, number: number) =>
    round?.status === "waiting"
      ? `START ROUND ${number}`
      : round?.status === "active"
        ? `RESTART TIMER ${number}`
        : `RESTART ROUND ${number}`;
  const online = state.leaderboard.filter(
    (x) => state.serverTime - x.lastSeen < 15000,
  ).length;
  return (
    <div className="host">
      <aside className="side">
        <Logo />
        <nav>
          <button>
            <Activity /> Overview
          </button>
          <button className="active">
            <Users /> Participants
          </button>
          <button>
            <Braces /> Questions
          </button>
          <button>
            <Coins /> Coin ledger
          </button>
          <button>
            <Trophy /> Leaderboard
          </button>
        </nav>
        <div className="admin">
          <b>HS</b>
          <span>
            Host Admin<small>Server authority</small>
          </span>
          <LogoutButton compact />
        </div>
      </aside>
      <main>
        <header className="hosthead">
          <div>
            <Pill>HOST CONTROL</Pill>
            <h1>Central Event Operations</h1>
          </div>
          <div>
            <small>
              {displayRoundId === "round1" ? "ROUND 1" : "ROUND 2"} SERVER TIMER
            </small>
            <b>{formatTime(displayRound?.remainingSeconds || 0)}</b>
            <Pill
              kind={
                displayStatus === "ended"
                  ? "hard"
                  : displayStatus === "paused"
                    ? "medium"
                    : "green"
              }
            >
              {displayStatus.toUpperCase()}
            </Pill>
            <Pill kind={state.judgeConfigured ? "green" : "hard"}>
              {state.judgeConfigured ? "JUDGE ONLINE" : "MANUAL JUDGE"}
            </Pill>
          </div>
        </header>
        {error && <p className="api-error">{error}</p>}
        <div className="controls">
          <button className="start" onClick={() => control("round1", "start")}>
            <Play /> {startLabel(round1, 1)}
          </button>
          <button className="start" onClick={() => control("round2", "start")}>
            <Play /> {startLabel(round2, 2)}
          </button>
          <button
            disabled={!liveRoundId}
            onClick={() =>
              liveRoundId &&
              control(
                liveRoundId,
                state.rounds[liveRoundId]?.status === "paused"
                  ? "resume"
                  : "pause",
              )
            }
          >
            <Pause />{" "}
            {liveRoundId && state.rounds[liveRoundId]?.status === "paused"
              ? "RESUME"
              : "PAUSE"}
          </button>
          <button
            disabled={!liveRoundId}
            onClick={() => liveRoundId && control(liveRoundId, "add", 300)}
          >
            +5 MIN
          </button>
          <button
            disabled={!liveRoundId}
            className="danger"
            onClick={() => liveRoundId && control(liveRoundId, "end")}
          >
            END {liveRoundId === "round1" ? "ROUND 1" : "ROUND 2"}
          </button>
          <button
            disabled={round2?.status !== "ended"}
            onClick={() => control("round2", "publish")}
          >
            PUBLISH RESULTS
          </button>
        </div>
        <div className="stats">
          <article>
            <small>TOTAL</small>
            <b>{state.leaderboard.length}</b>
            <span>participants</span>
          </article>
          <article>
            <small>ONLINE</small>
            <b>{online}</b>
            <span>last 15 seconds</span>
          </article>
          <article>
            <small>PROBLEMS SOLVED</small>
            <b>{state.leaderboard.reduce((n, x) => n + x.solved, 0)}</b>
            <span>server total</span>
          </article>
          <article>
            <small>COINS IN PLAY</small>
            <b>{state.leaderboard.reduce((n, x) => n + x.coins, 0)}</b>
            <span>verified balance</span>
          </article>
          <article>
            <small>LOCKED</small>
            <b>
              {
                state.leaderboard.filter(
                  (team) => team.locked && !team.disqualified,
                ).length
              }
            </b>
            <span>teams</span>
          </article>
          <article>
            <small>DISQUALIFIED</small>
            <b>
              {state.leaderboard.filter((team) => team.disqualified).length}
            </b>
            <span>teams</span>
          </article>
        </div>
        <div className="host-management">
          <TeamManager setState={setState} setError={setError} />
          <QuestionManager
            questionCount={state.questionCount || 0}
            setState={setState}
            setError={setError}
          />
        </div>
        <div className="hostgrid">
          <section className="tablebox">
            <header>
              <div>
                <h2>Participant teams</h2>
                <div
                  className="team-filters"
                  aria-label="Filter participant teams"
                >
                  {(["all", "locked", "disqualified"] as const).map(
                    (filter) => (
                      <button
                        className={teamFilter === filter ? "active" : ""}
                        key={filter}
                        onClick={() => setTeamFilter(filter)}
                      >
                        {filter.toUpperCase()}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <span>
                <i /> SERVER SYNCHRONIZED
              </span>
            </header>
            <table>
              <thead>
                <tr>
                  <th>RANK</th>
                  <th>PARTICIPANT</th>
                  <th>LANG.</th>
                  <th>PROGRESS</th>
                  <th>SCORE</th>
                  <th>COINS</th>
                  <th>HELP</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {visibleTeams.map((x) => (
                  <tr
                    onClick={() => setSelectedId(x.id)}
                    className={person.id === x.id ? "selected" : ""}
                    key={x.id}
                  >
                    <td>
                      #
                      {state.leaderboard.findIndex((team) => team.id === x.id) +
                        1}
                    </td>
                    <td>
                      <b>{x.name}</b>
                      <small>{x.id}</small>
                    </td>
                    <td>
                      <code>{x.language || "â€”"}</code>
                    </td>
                    <td>
                      <progress
                        value={x.solved}
                        max={state.questionCount || 1}
                      />{" "}
                      {x.solved}/{state.questionCount || 0}
                    </td>
                    <td>{x.codingScore}</td>
                    <td className="gold">{x.coins}</td>
                    <td>{x.helpsUsed}/3</td>
                    <td>
                      <Pill
                        kind={
                          x.disqualified || x.locked
                            ? "hard"
                            : state.serverTime - x.lastSeen < 15000
                              ? "green"
                              : "muted"
                        }
                      >
                        {x.disqualified
                          ? "disqualified"
                          : x.locked
                            ? "locked"
                            : x.status}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <aside className="detail">
            <header>
              <b>{String(person.name || "â€”").slice(0, 2)}</b>
              <span>
                <h3>{person.name}</h3>
                <small>
                  {person.id} · {person.college}
                </small>
              </span>
            </header>
            <div className="meta">
              <span>
                LANGUAGE<b>{person.language || "Not selected"}</b>
              </span>
              <span>
                SOLVED
                <b>
                  {person.solved}/{state.questionCount || 0}
                </b>
              </span>
              <span>
                COINS<b className="gold">{person.coins}</b>
              </span>
              <span>
                HELP USED<b>{person.helpsUsed}/3</b>
              </span>
            </div>
            <h4>SERVER RECORD</h4>
            <div className="prow">
              <b>QUIZ</b>
              <span>
                Correct answers<small>{person.quizCorrect}/40</small>
              </span>
              <Check />
            </div>
            <div className="prow">
              <b>CODE</b>
              <span>
                Coding points<small>{person.codingScore}</small>
              </span>
              <Check />
            </div>
            <div className="prow">
              <b>STATE</b>
              <span>
                Account state
                <small>
                  {person.disqualified
                    ? "DISQUALIFIED"
                    : person.locked
                      ? "LOCKED"
                      : `Q${person.currentQuestion}`}
                </small>
              </span>
              <Lock />
            </div>
            <div className="prow">
              <b>SECURITY</b>
              <span>
                {person.securityViolationCount || 0}/3 violations
                <small>
                  {person.securityLastViolationAt
                    ? `${person.securityLastViolationReason?.replaceAll("-", " ") || "Recorded"} · ${new Date(person.securityLastViolationAt).toLocaleString()}`
                    : "No violations recorded"}
                </small>
              </span>
              <ShieldCheck />
            </div>
            <div className="manual-score">
              <h4>MANUAL SCORE OVERRIDE</h4>
              <p>
                Use only when automated judging is unavailable. Every change is
                audited.
              </p>
              <div>
                <input
                  aria-label="Score adjustment"
                  inputMode="numeric"
                  placeholder="+300 or -100"
                  value={scoreDelta}
                  onChange={(e) => setScoreDelta(e.target.value)}
                />
                <input
                  aria-label="Adjustment reason"
                  maxLength={200}
                  placeholder="Reason for adjustment"
                  value={scoreReason}
                  onChange={(e) => setScoreReason(e.target.value)}
                />
                <button onClick={adjustScore}>APPLY</button>
              </div>
            </div>
            {person.id && (
              <footer>
                {!person.disqualified && (
                  <button
                    onClick={() => moderate(person.locked ? "unlock" : "lock")}
                  >
                    {person.locked ? "UNLOCK" : "LOCK"} PARTICIPANT
                  </button>
                )}
                {!person.disqualified && (
                  <button
                    className="danger"
                    onClick={() => moderate("disqualify")}
                  >
                    DISQUALIFY
                  </button>
                )}
                {person.disqualified && (
                  <button onClick={() => moderate("reinstate")}>
                    RESET SECURITY & REINSTATE
                  </button>
                )}
                <button className="danger" onClick={() => moderate("remove")}>
                  REMOVE TEAM
                </button>
              </footer>
            )}
          </aside>
        </div>
      </main>
      {popup}
    </div>
  );
}
