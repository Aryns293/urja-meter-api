import { createHmac } from 'node:crypto';
import { unflatten } from 'devalue';
import { PortalError } from '../errors.js';
import {
  mapConsumption,
  mapExport,
  mapMeterDetail,
  mapMeterSearch,
  mapTransformers,
} from './mappers.js';
import {
  energyResponseSchema,
  exportResponseSchema,
  geoResponseSchema,
  keysResponseSchema,
  meterDetailSchema,
  searchResponseSchema,
  svelteDataResponseSchema,
  transformerResponseSchema,
} from './schemas.js';

function invalidPortalResponse() {
  return new PortalError(502, 'invalid_portal_response', 'Portal returned an unexpected response');
}

function parseResponse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw invalidPortalResponse();
  }
  return result.data;
}

function mapResponse(mapper, ...args) {
  try {
    return mapper(...args);
  } catch {
    throw invalidPortalResponse();
  }
}

export class PortalClient {
  constructor({ baseUrl, email, password, timeoutMs = 10000, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.email = email;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.session = null;
    this.loginPromise = null;
  }

  async ensureSession() {
    if (this.session && this.session.expiresAt > Date.now()) {
      return;
    }

    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }

    return this.loginPromise;
  }

  async login() {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          origin: this.baseUrl,
        },
        body: new URLSearchParams({ email: this.email, password: this.password }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await response.text();
    } catch (error) {
      throw this.networkError(error);
    }

    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((cookie) => cookie.includes('session_token='));

    if (!response.ok || !sessionCookie) {
      throw new PortalError(
        502,
        'portal_authentication_failed',
        'Could not authenticate with the portal',
      );
    }

    const maxAge = Number(sessionCookie.match(/Max-Age=(\d+)/i)?.[1] ?? 3600);
    this.session = {
      cookie: sessionCookie.split(';')[0],
      expiresAt: Date.now() + Math.max(maxAge - 60, 1) * 1000,
    };
  }

  networkError(error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return new PortalError(504, 'portal_timeout', 'The portal did not respond in time');
    }
    return new PortalError(502, 'portal_unavailable', 'Could not reach the portal');
  }

  async request(path, options = {}) {
    const {
      method = 'GET',
      headers = {},
      signingSecret,
      allowRetry = true,
      notFoundMessage = 'Resource not found in the portal',
    } = options;

    await this.ensureSession();
    const url = new URL(path, this.baseUrl);
    const requestHeaders = {
      accept: 'application/json',
      cookie: this.session.cookie,
      ...headers,
    };

    if (signingSecret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const payload = [method, url.pathname, url.search.slice(1), timestamp].join('\n');
      requestHeaders['x-timestamp'] = timestamp;
      requestHeaders['x-signature'] = createHmac('sha256', signingSecret)
        .update(payload)
        .digest('hex');
    }

    let response;
    let text;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      throw this.networkError(error);
    }

    let body = text;
    if (response.headers.get('content-type')?.includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch {
        throw invalidPortalResponse();
      }
    }

    const loginRedirect = response.ok
      && body?.type === 'redirect'
      && body?.location === '/login';

    if (response.status === 401 && body?.error === 'signature_invalid') {
      throw new PortalError(
        502,
        'portal_signature_failed',
        'The portal rejected the export request signature',
      );
    }

    if (response.status === 401 || loginRedirect) {
      if (allowRetry) {
        this.session = null;
        return this.request(path, { ...options, allowRetry: false });
      }
      throw new PortalError(
        502,
        'portal_authentication_failed',
        'The portal rejected the authenticated session',
      );
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new PortalError(404, 'not_found', body?.message ?? notFoundMessage);
      }
      if (response.status === 429) {
        throw new PortalError(503, 'portal_rate_limited', 'The portal is rate limiting requests');
      }
      throw new PortalError(
        502,
        'portal_error',
        body?.message ?? `Portal request failed with status ${response.status}`,
      );
    }

    return body;
  }

  async searchMeters({ q, page }) {
    const params = new URLSearchParams({ q, page: String(page) });
    const body = await this.request(`/portal/meters/search?${params}`);
    return mapResponse(mapMeterSearch, parseResponse(searchResponseSchema, body));
  }

  async getMeter(meterId) {
    const id = encodeURIComponent(meterId);
    const options = { notFoundMessage: 'Meter not found' };
    const [dataBody, geoBody] = await Promise.all([
      this.request(`/meters/${id}/__data.json`, options),
      this.request(`/portal/meters/${id}/geo`, options),
    ]);

    const svelteData = parseResponse(svelteDataResponseSchema, dataBody);
    let detail;
    for (const node of svelteData.nodes) {
      if (!node || node.type !== 'data' || !Array.isArray(node.data)) {
        continue;
      }
      let value;
      try {
        value = unflatten(node.data);
      } catch {
        throw invalidPortalResponse();
      }
      if (value?.detail && value?.hierarchy) {
        detail = parseResponse(meterDetailSchema, value);
        break;
      }
    }

    if (!detail) {
      throw invalidPortalResponse();
    }

    return mapResponse(
      mapMeterDetail,
      detail,
      parseResponse(geoResponseSchema, geoBody),
    );
  }

  async getConsumption(meterId) {
    const id = encodeURIComponent(meterId);
    const body = await this.request(`/portal/meters/${id}/energy`, {
      notFoundMessage: 'Meter not found',
    });
    return mapResponse(mapConsumption, parseResponse(energyResponseSchema, body));
  }

  async getTransformers({ page }) {
    const body = await this.request(`/portal/dts?page=${page}`);
    return mapResponse(mapTransformers, parseResponse(transformerResponseSchema, body));
  }

  async exportMeters() {
    const keysBody = await this.request('/portal/keys');
    const { signingSecret } = parseResponse(keysResponseSchema, keysBody).data;
    const body = await this.request('/portal/export?page=1', { signingSecret });
    return mapResponse(mapExport, parseResponse(exportResponseSchema, body));
  }
}
