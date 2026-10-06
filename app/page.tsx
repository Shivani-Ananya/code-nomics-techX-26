"use client";

import { useCallback, useEffect, useState } from "react";
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
  latestSubmission?: {
    status: "queued" | "running" | "completed" | "failed";
    passedCount: number;
    verdict: string;
    lastError?: string;
    createdAt: number;
    completedAt?: number;
    totalTests?: number;
  } | null;
  questionCount?: number;
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
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
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
  useEffect(() => {
    refresh();
  }, [refresh]);
  const sessionRole = state?.session.role;
  const round1Status = state?.rounds.round1?.status;
  const round2Status = state?.rounds.round2?.status;
  useEffect(() => {
    if (!sessionRole) return;
    const participantIsActive =
      sessionRole === "participant" &&
      (round1Status === "active" || round2Status === "active");
    const delay = sessionRole === "host" || participantIsActive ? 2000 : 5000;
    const timer = setInterval(refresh, delay);
    return () => clearInterval(timer);
  }, [refresh, sessionRole, round1Status, round2Status]);

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
              {role === "host" ? "ADMIN ID" : "PARTICIPANT ID"}
              <input
                autoComplete="username"
                placeholder={
                  role === "host" ? "Enter host ID" : "Enter participant ID"
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
                ? "AUTHENTICATING…"
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
        title="Account locked"
        text="The host has locked this participant account. Contact the event desk."
      />
    );
  if (!p.quizSubmittedAt && r1.status === "active")
    return <Quiz state={state} setState={setState} setError={setError} />;
  if (p.quizSubmittedAt && r2.status === "active" && !p.language)
    return <Language state={state} setState={setState} setError={setError} />;
  if (
    p.quizSubmittedAt &&
    r2.status === "active" &&
    p.language &&
    p.currentQuestion > (state.questionCount || 0)
  )
    return (
      <StatusScreen
        title="Coding round completed"
        text="You have solved every available coding question. New questions added by the host will appear automatically."
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
              (state.leaderboard.findIndex((x) => x.id === p.id) + 1) +
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
            <b>#{state.leaderboard.findIndex((x) => x.id === p.id) + 1}</b>
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
      <Top state={state} label="ROUND 1 / QUIZ" />
      <main className="quiz">
        <section className="question">
          <div className="eyebrow">
            QUESTION {current + 1} / 40{" "}
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
            <button onClick={() => setCurrent(Math.max(0, current - 1))}>
              Previous
            </button>
            <button className="submit" onClick={submit}>
              SUBMIT QUIZ
            </button>
            <button onClick={() => setCurrent(Math.min(39, current + 1))}>
              Next
            </button>
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
  const [question, setQuestion] = useState(Math.max(0, p.currentQuestion - 1));
  const [source, setSource] = useState(
    p.language === "Python"
      ? "def solve():\n    # Write your solution\n    pass\n\nif __name__ == '__main__':\n    solve()\n"
      : "import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    // Write your solution\n  }\n}\n",
  );
  const [output, setOutput] = useState(
    state.judgeConfigured
      ? "Judge queue is ready."
      : "Judge queue is disabled. Ask the host to enable it.",
  );
  const [market, setMarket] = useState(false);
  const { ask, popup } = useConfirmDialog();
  const problem = state.problems![question];
  const buy = async (kind: string) => {
    if (
      !(await ask(
        "Purchase this help? Coins are deducted permanently.",
        "Purchase help",
      ))
    )
      return;
    try {
      setState(await request({ action: "purchase-help", kind }));
      setMarket(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    const submission = state.latestSubmission;
    if (!submission) return;
    if (submission.status === "queued")
      setOutput("Submission queued. Waiting for the sandbox worker…");
    else if (submission.status === "running")
      setOutput("Sandbox worker is executing the hidden test cases…");
    else if (submission.status === "completed")
      setOutput(
        `Hidden tests passed: ${submission.passedCount}/${submission.totalTests || "?"}${submission.verdict === "accepted" ? "\nPROBLEM SOLVED — next question unlocked." : ""}`,
      );
    else
      setOutput(
        submission.lastError ||
          "The judge could not process this submission. You may retry.",
      );
  }, [state.latestSubmission]);
  const submit = async () => {
    if (
      !(await ask(
        `Submit your ${p.language} solution for ${problem.title}?`,
        "Submit to judge",
      ))
    )
      return;
    setOutput("Adding submission to the secure judge queue…");
    try {
      const data = await request({ action: "submit-code", source });
      setOutput("Submission queued. Waiting for the sandbox worker…");
      if (data.state) setState(data.state);
    } catch (e) {
      setOutput((e as Error).message);
    }
  };
  return (
    <div className="ide">
      <Top state={state} label="ROUND 2 / CODING" />
      <div className="problemtabs">
        <div>
          {state.problems!.map((item, index) => (
            <button
              disabled={index >= p.currentQuestion}
              className={
                index === question
                  ? "active"
                  : index < p.currentQuestion - 1
                    ? "done"
                    : ""
              }
              onClick={() => setQuestion(index)}
              key={item.id}
            >
              {index < p.currentQuestion - 1 ? (
                <Check />
              ) : index >= p.currentQuestion ? (
                <Lock />
              ) : (
                "Q" + (index + 1)
              )}
              <small>{item.difficulty}</small>
            </button>
          ))}
        </div>
        <aside>
          <span>
            <Coins /> {p.coins}
          </span>
          <span>HELP {p.helpsUsed}/3</span>
          <span>
            RANK #{state.leaderboard.findIndex((x) => x.id === p.id) + 1}
          </span>
          <button onClick={() => setMarket(true)}>
            <ShoppingCart /> HELP MARKETPLACE
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
            <b>SERVER CONSOLE</b>
            <pre>{output}</pre>
          </div>
          <footer>
            <button
              onClick={() =>
                setOutput("Sample output expected: " + problem.sampleOutput)
              }
            >
              CHECK SAMPLE
            </button>
            <button
              className="submit"
              disabled={!state.judgeConfigured}
              onClick={submit}
            >
              SUBMIT TO JUDGE
            </button>
          </footer>
        </section>
      </main>
      {market && (
        <div className="overlay" onClick={() => setMarket(false)}>
          <div className="market" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>
                <ShoppingCart /> Help marketplace
              </h2>
              <button onClick={() => setMarket(false)}>×</button>
            </header>
            <p>Every purchase is validated and logged by the server.</p>
            {[
              ["small", "Small hint", 200],
              ["algorithm", "Algorithm hint", 300],
              ["pseudocode", "Pseudocode / key logic", 450],
              ["reveal", "50% code reveal", 650],
              ["ai", "AI assistance · 3 messages", 800],
            ].map(([kind, name, cost]) => (
              <button
                key={kind}
                disabled={p.helpsUsed >= 3 || p.coins < Number(cost)}
                onClick={() => buy(String(kind))}
              >
                <span>
                  <b>{name}</b>
                  <small>Tailored to {p.language}</small>
                </span>
                <strong>{cost} COINS</strong>
              </button>
            ))}
            <footer>
              BALANCE <b>{p.coins}</b>
              <span>
                HELP USED <b>{p.helpsUsed}/3</b>
              </span>
            </footer>
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
          BULK TEAM NAMES — ONE PER LINE
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
                {team.id} · {team.name} · password: {team.password}
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
          placeholder="Hints — one per line"
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
    if (
      (action === "end" || action === "publish") &&
      !(await ask(
        "This action affects every participant and cannot be silently reversed.",
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
  const status = state.rounds.round2?.status;
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
            <small>ROUND 2 SERVER TIMER</small>
            <b>{formatTime(state.rounds.round2?.remainingSeconds || 0)}</b>
            <Pill kind="green">{status?.toUpperCase()}</Pill>
            <Pill kind={state.judgeConfigured ? "green" : "hard"}>
              {state.judgeConfigured ? "JUDGE ONLINE" : "MANUAL JUDGE"}
            </Pill>
          </div>
        </header>
        {error && <p className="api-error">{error}</p>}
        <div className="controls">
          <button className="start" onClick={() => control("round1", "start")}>
            <Play /> START ROUND 1
          </button>
          <button className="start" onClick={() => control("round2", "start")}>
            <Play /> START ROUND 2
          </button>
          <button
            onClick={() =>
              control("round2", status === "paused" ? "resume" : "pause")
            }
          >
            <Pause /> {status === "paused" ? "RESUME" : "PAUSE"}
          </button>
          <button onClick={() => control("round2", "add", 300)}>+5 MIN</button>
          <button className="danger" onClick={() => control("round2", "end")}>
            END ROUND
          </button>
          <button onClick={() => control("round2", "publish")}>
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
                      <code>{x.language || "—"}</code>
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
              <b>{String(person.name || "—").slice(0, 2)}</b>
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
                    REINSTATE
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
