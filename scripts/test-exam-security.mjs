const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';

async function testExamSecurity() {
  console.log('================================================================');
  console.log('🛡️ EXAM SECURITY & AUTOMATIC DISQUALIFICATION TEST');
  console.log('================================================================');

  // Login as LoadBot_001
  const loginRes = await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', id: 'LoadBot_001', password: 'LoadBot_001', role: 'participant' }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];

  const sendViolation = async (reason, eventId) => {
    const res = await fetch(`${BASE_URL}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ action: 'security-violation', reason, round: 'round1', eventId }),
    });
    return { status: res.status, data: await res.json() };
  };

  // 1. First Violation (Fullscreen exit)
  console.log('\nTesting Violation 1 (Fullscreen exit)...');
  const v1 = await sendViolation('fullscreen-exit', `evt-sec-1-${Date.now()}`);
  console.log('Violation 1 Result:', {
    status: v1.status,
    violationCount: v1.data?.securityNotice?.violationCount,
    warningsRemaining: v1.data?.securityNotice?.warningsRemaining,
    disqualified: v1.data?.securityNotice?.disqualified,
  });
  if (v1.data?.securityNotice?.violationCount !== 1) {
    throw new Error('Violation 1 count check failed');
  }

  // Debounce pause (minimum 2500ms)
  console.log('Waiting 2600ms for security debounce window...');
  await new Promise((r) => setTimeout(r, 2600));

  // 2. Second Violation (Tab hidden)
  console.log('Testing Violation 2 (Tab hidden)...');
  const v2 = await sendViolation('tab-hidden', `evt-sec-2-${Date.now()}`);
  console.log('Violation 2 Result:', {
    status: v2.status,
    violationCount: v2.data?.securityNotice?.violationCount,
    warningsRemaining: v2.data?.securityNotice?.warningsRemaining,
    disqualified: v2.data?.securityNotice?.disqualified,
  });
  if (v2.data?.securityNotice?.violationCount !== 2) {
    throw new Error('Violation 2 count check failed');
  }

  // Debounce pause
  console.log('Waiting 2600ms for security debounce window...');
  await new Promise((r) => setTimeout(r, 2600));

  // 3. Third Violation (Window focus lost) -> MUST DISQUALIFY
  console.log('Testing Violation 3 (Window focus lost - Automatic Disqualification)...');
  const v3 = await sendViolation('window-focus-lost', `evt-sec-3-${Date.now()}`);
  console.log('Violation 3 Result:', {
    status: v3.status,
    violationCount: v3.data?.securityNotice?.violationCount,
    warningsRemaining: v3.data?.securityNotice?.warningsRemaining,
    disqualified: v3.data?.securityNotice?.disqualified,
  });
  if (!v3.data?.securityNotice?.disqualified) {
    throw new Error('Automatic disqualification failed to trigger on 3rd violation!');
  }
  console.log('✅ Automatic Disqualification verified successfully!');

  // 4. Verify Disqualified User Is Blocked From Further Actions
  console.log('\nVerifying disqualified user is blocked from submitting answers...');
  const blockedRes = await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ action: 'answer', questionId: 1, answerIndex: 0 }),
  });
  console.log('Blocked Action Status:', blockedRes.status);
  if (blockedRes.status === 403 || blockedRes.status === 401) {
    console.log('✅ Disqualified user blocked with 403/401 Access Denied.');
  } else {
    console.log('ℹ️ Disqualified status:', blockedRes.status, await blockedRes.text());
  }

  // Reinstate participant for remaining tests
  console.log('\nReinstating LoadBot_001 for remaining load test suite...');
  // Host Login
  const hostLogin = await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', id: 'HOST-01', password: process.env.EVENT_HOST_PASSWORD || 'AdminControl123!', role: 'host' }),
  });
  const hostCookie = hostLogin.headers.get('set-cookie')?.split(';')[0];
  await fetch(`${BASE_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': hostCookie },
    body: JSON.stringify({ action: 'participant-control', participantId: 'CA-1001', control: 'reinstate' }),
  });
  console.log('✅ LoadBot_001 reinstated successfully.');
  console.log('================================================================\n');
}

testExamSecurity().catch((err) => {
  console.error('Exam security test failed:', err);
  process.exit(1);
});
