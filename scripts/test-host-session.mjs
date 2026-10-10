const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const HOST_PASSWORD = process.env.EVENT_HOST_PASSWORD;

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE_URL) && process.env.ALLOW_REMOTE_SESSION_TEST !== "true")
  throw new Error("Remote session testing is disabled unless explicitly authorized.");
if (!HOST_PASSWORD) throw new Error("EVENT_HOST_PASSWORD is required.");

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

const login = await fetch(`${BASE_URL}/api/event`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "login",
    role: "host",
    id: "HOST-01",
    password: HOST_PASSWORD,
  }),
  signal: AbortSignal.timeout(15_000),
});
const loginBody = await readJson(login);
if (!login.ok || loginBody.session?.role !== "host")
  throw new Error(`Host login failed (${login.status}).`);

const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie?.startsWith("ca_session="))
  throw new Error("Host login did not issue a session cookie.");

for (let refresh = 1; refresh <= 2; refresh += 1) {
  const response = await fetch(`${BASE_URL}/api/event`, {
    headers: { cookie },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readJson(response);
  if (!response.ok || body.session?.id !== "HOST-01" || body.session?.role !== "host")
    throw new Error(`Host session did not survive refresh ${refresh} (${response.status}).`);
}

const logout = await fetch(`${BASE_URL}/api/event`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ action: "logout" }),
  signal: AbortSignal.timeout(15_000),
});
if (!logout.ok || !/Max-Age=0/i.test(logout.headers.get("set-cookie") || ""))
  throw new Error("Logout did not expire the host session cookie.");

const anonymous = await fetch(`${BASE_URL}/api/event`, {
  signal: AbortSignal.timeout(15_000),
});
if (anonymous.status !== 401)
  throw new Error(`Anonymous request should be rejected after logout (${anonymous.status}).`);

console.log(JSON.stringify({
  passed: true,
  login: "ok",
  refreshes: 2,
  logoutCookieCleared: true,
  anonymousStatus: anonymous.status,
}));
