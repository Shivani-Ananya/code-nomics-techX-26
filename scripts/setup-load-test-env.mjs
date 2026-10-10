const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const HOST_PASSWORD = process.env.EVENT_HOST_PASSWORD;

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE_URL) && process.env.ALLOW_REMOTE_LOAD_TEST !== 'true')
  throw new Error('Remote load-test setup is disabled. Use localhost or explicitly authorize the remote test target.');
if (!HOST_PASSWORD) throw new Error('EVENT_HOST_PASSWORD is required.');

async function setup() {
  console.log('=== Setting up 200-User Load Test Environment ===');
  console.log(`Connecting to ${BASE_URL}...`);

  // 1. Host Login
  const loginRes = await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', id: 'HOST-01', password: HOST_PASSWORD, role: 'host' }),
  });
  if (!loginRes.ok) {
    throw new Error(`Host login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const hostCookie = loginRes.headers.get('set-cookie');
  console.log('✅ Host login successful');

  // 2. Generate 200 Test Bot Team Names
  const teamNames = [];
  for (let i = 1; i <= 200; i++) {
    teamNames.push(`LoadBot_${String(i).padStart(3, '0')}`);
  }

  // 3. Batch Add Teams
  console.log('Seeding 200 test bot participant accounts...');
  const addTeamsRes = await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': hostCookie || '',
    },
    body: JSON.stringify({ action: 'add-teams', teams: teamNames }),
  });

  if (addTeamsRes.status === 201) {
    const data = await addTeamsRes.json();
    console.log(`✅ Created ${data.created?.length || 200} test bot accounts.`);
  } else if (addTeamsRes.status === 409) {
    console.log('ℹ️ Test bot accounts already exist.');
  } else {
    console.log(`⚠️ Add teams status: ${addTeamsRes.status}`, await addTeamsRes.text());
  }

  // 4. Start Round 1
  console.log('Activating Round 1 (Quiz)...');
  const startR1 = await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': hostCookie || '',
    },
    body: JSON.stringify({ action: 'host-control', round: 'round1', control: 'start' }),
  });
  if (!startR1.ok) {
    console.log('⚠️ Start Round 1 status:', startR1.status, await startR1.text());
  } else {
    console.log('✅ Round 1 is live.');
  }

  // Add extra time to Round 1 timer
  await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': hostCookie || '' },
    body: JSON.stringify({ action: 'host-control', round: 'round1', control: 'add', seconds: 1800 }),
  });

  console.log('=== Setup Complete! Ready for 200-User Load Test ===');
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
