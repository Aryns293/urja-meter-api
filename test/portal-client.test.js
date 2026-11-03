import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { stringify } from 'devalue';
import { PortalClient } from '../src/portal/client.js';

const baseUrl = 'https://portal.test';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function loginResponse(token) {
  return new Response(JSON.stringify({ type: 'redirect', location: '/meters' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': `__Secure-better-auth.session_token=${token}; Max-Age=3600; Path=/; HttpOnly; Secure`,
    },
  });
}

function searchBody() {
  return {
    data: [{
      meterId: 'J100000',
      serialNo: 'SE33962',
      make: 'HPL',
      phaseType: 'single',
      installStatus: 'Installed',
      dtCode: 'DT-001',
    }],
    page: 1,
    pageSize: 20,
    total: 1,
  };
}

function makeClient(fetchImpl) {
  return new PortalClient({
    baseUrl,
    email: 'operator@example.com',
    password: 'secret',
    fetchImpl,
  });
}

test('login uses a same-origin form and the session is reused', async () => {
  let logins = 0;
  const client = makeClient(async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/login') {
      logins += 1;
      assert.equal(init.headers.origin, baseUrl);
      assert.match(init.headers['content-type'], /x-www-form-urlencoded/);
      assert.equal(init.body.get('email'), 'operator@example.com');
      return loginResponse('token-one');
    }
    assert.equal(init.headers.cookie, '__Secure-better-auth.session_token=token-one');
    return json(searchBody());
  });

  await client.searchMeters({ q: '', page: 1 });
  await client.searchMeters({ q: '', page: 1 });
  assert.equal(logins, 1);
});

test('an expired session is renewed once and the request is retried', async () => {
  let logins = 0;
  let searches = 0;
  const client = makeClient(async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/login') {
      logins += 1;
      return loginResponse(logins === 1 ? 'token-one' : 'token-two');
    }
    searches += 1;
    if (init.headers.cookie.endsWith('token-one')) {
      return json({ error: 'unauthorized', message: 'A valid session is required.' }, 401);
    }
    return json(searchBody());
  });

  const result = await client.searchMeters({ q: '', page: 1 });
  assert.equal(result.data[0].meterId, 'J100000');
  assert.equal(logins, 2);
  assert.equal(searches, 2);
});

test('SvelteKit detail data and geo responses are aggregated', async () => {
  const detail = {
    detail: {
      data: [
        { parameterName: 'Meter ID', parameterValue: 'J100000' },
        { parameterName: 'Serial No', parameterValue: 'SE33962' },
        { parameterName: 'Make', parameterValue: 'HPL' },
        { parameterName: 'Phase Type', parameterValue: 'single' },
        { parameterName: 'Installation Status', parameterValue: 'Installed' },
        { parameterName: 'Installation Type', parameterValue: 'Whole Current' },
      ],
    },
    hierarchy: {
      Zone: 'Jaipur Zone 1 (Z-01)',
      Circle: 'Circle 1 (C-01)',
      Division: 'Division 1 (D-01)',
      Subdivision: 'Subdivision 1 (SD-01)',
      'Sub Station': 'Substation 1 (SS-01)',
      Feeder: 'Feeder 1 (F-001)',
      DT: 'Malviya Nagar DT 1 (DT-001)',
    },
  };

  const client = makeClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/login') return loginResponse('token');
    if (url.pathname.endsWith('/__data.json')) {
      return json({ nodes: [{ type: 'data', data: JSON.parse(stringify(detail)) }] });
    }
    return json({ data: { latitude: '26.9', longitude: '75.8' } });
  });

  const result = await client.getMeter('J100000');
  assert.equal(result.meterId, 'J100000');
  assert.equal(result.hierarchy.substation.code, 'SS-01');
  assert.equal(result.location.latitude, 26.9);
});

test('export signs the exact method, path, query, and timestamp', async () => {
  const signingSecret = 'test-signing-secret';
  const hierarchyNode = { code: 'C-01', name: 'Circle 1' };
  const meter = {
    build: 'v2',
    meterId: 'J100000',
    serialNo: 'SE33962',
    make: 'HPL',
    phaseType: 'single',
    installStatus: 'Installed',
    installType: 'Whole Current',
    dtCode: 'DT-001',
    geo: { lat: 26.9, lng: 75.8 },
    hierarchy: {
      zone: hierarchyNode,
      circle: hierarchyNode,
      division: hierarchyNode,
      subdivision: hierarchyNode,
      substation: hierarchyNode,
      feeder: hierarchyNode,
      dt: hierarchyNode,
    },
  };
  let exportHeaders;
  const client = makeClient(async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/login') return loginResponse('token');
    if (url.pathname === '/portal/keys') return json({ data: { signingSecret } });
    exportHeaders = init.headers;
    return json({ data: [meter], total: 1 });
  });

  const result = await client.exportMeters();
  const payload = [
    'GET',
    '/portal/export',
    'page=1',
    exportHeaders['x-timestamp'],
  ].join('\n');
  const expected = createHmac('sha256', signingSecret).update(payload).digest('hex');

  assert.equal(exportHeaders['x-signature'], expected);
  assert.equal(result.meta.total, 1);
  assert.equal(result.data[0].serialNumber, 'SE33962');
});

test('an unexpected upstream schema becomes a safe 502 error', async () => {
  const client = makeClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/login') return loginResponse('token');
    return json({ data: 'not-an-array' });
  });

  await assert.rejects(
    client.searchMeters({ q: '', page: 1 }),
    (error) => error.status === 502 && error.code === 'invalid_portal_response',
  );
});

test('concurrent cold-start requests share one login', async () => {
  let logins = 0;
  const client = makeClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/login') {
      logins += 1;
      await Promise.resolve();
      return loginResponse('token');
    }
    return json(searchBody());
  });

  await Promise.all([
    client.searchMeters({ q: 'one', page: 1 }),
    client.searchMeters({ q: 'two', page: 1 }),
    client.searchMeters({ q: 'three', page: 1 }),
  ]);
  assert.equal(logins, 1);
});

test('response body read timeouts map to 504 during login and data requests', async () => {
  const bodyFailure = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => {
      throw new DOMException('Timed out', 'TimeoutError');
    },
  });

  const loginFailure = makeClient(async () => bodyFailure());
  await assert.rejects(
    loginFailure.searchMeters({ q: '', page: 1 }),
    (error) => error.status === 504 && error.code === 'portal_timeout',
  );

  const dataFailure = makeClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/login') return loginResponse('token');
    return bodyFailure();
  });
  await assert.rejects(
    dataFailure.searchMeters({ q: '', page: 1 }),
    (error) => error.status === 504 && error.code === 'portal_timeout',
  );
});

test('malformed flattened SvelteKit data maps to invalid_portal_response', async () => {
  const client = makeClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/login') return loginResponse('token');
    if (url.pathname.endsWith('/__data.json')) {
      return json({ nodes: [{ type: 'data', data: [] }] });
    }
    return json({ data: { latitude: '26.9', longitude: '75.8' } });
  });

  await assert.rejects(
    client.getMeter('J100000'),
    (error) => error.status === 502 && error.code === 'invalid_portal_response',
  );
});

test('signature failures do not trigger reauthentication', async () => {
  let logins = 0;
  let exports = 0;
  const client = makeClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/login') {
      logins += 1;
      return loginResponse('token');
    }
    if (url.pathname === '/portal/keys') {
      return json({ data: { signingSecret: 'secret' } });
    }
    exports += 1;
    return json({ error: 'signature_invalid', message: 'Missing or invalid request signature.' }, 401);
  });

  await assert.rejects(
    client.exportMeters(),
    (error) => error.status === 502 && error.code === 'portal_signature_failed',
  );
  assert.equal(logins, 1);
  assert.equal(exports, 1);
});

test('portal rate limiting maps to 503 without a retry', async () => {
  let requests = 0;
  const client = makeClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/login') return loginResponse('token');
    requests += 1;
    return json({ error: 'rate_limited', message: 'Too many requests' }, 429);
  });

  await assert.rejects(
    client.searchMeters({ q: '', page: 1 }),
    (error) => error.status === 503 && error.code === 'portal_rate_limited',
  );
  assert.equal(requests, 1);
});
