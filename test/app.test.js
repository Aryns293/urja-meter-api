import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { PortalError } from '../src/errors.js';

function clientWith(overrides = {}) {
  return {
    searchMeters: async () => ({
      data: [{ meterId: 'J100000', serialNumber: 'SE33962' }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }),
    getMeter: async () => ({
      meterId: 'J100000',
      location: { latitude: 26.9, longitude: 75.8 },
      hierarchy: { zone: { name: 'Jaipur Zone 1', code: 'Z-01' } },
    }),
    getConsumption: async () => ({
      data: [{ timestamp: '2026-06-23T18:00:00.000Z', cumulativeKwh: 48438.74 }],
      meta: { count: 1 },
    }),
    getTransformers: async () => ({
      data: [{ code: 'DT-001', capacityKva: 100 }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }),
    exportMeters: async () => ({ data: [], meta: { total: 403 } }),
    ...overrides,
  };
}

function api(overrides) {
  return request(createApp({ portalClient: clientWith(overrides) }));
}

test('health does not depend on the portal', async () => {
  const response = await api().get('/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('meter search forwards validated query parameters', async () => {
  let received;
  const response = await api({
    searchMeters: async (query) => {
      received = query;
      return { data: [], pagination: { page: 2, pageSize: 20, total: 0, totalPages: 0 } };
    },
  }).get('/api/v1/meters?q=SE33962&page=2').expect(200);

  assert.deepEqual(received, { q: 'SE33962', page: 2 });
  assert.equal(response.body.pagination.totalPages, 0);
});

test('meter detail returns the aggregated representation', async () => {
  const response = await api().get('/api/v1/meters/J100000').expect(200);
  assert.equal(response.body.data.meterId, 'J100000');
  assert.equal(response.body.data.hierarchy.zone.code, 'Z-01');
});

test('consumption and export endpoints return their data and metadata', async () => {
  const consumption = await api().get('/api/v1/meters/J100000/consumption').expect(200);
  assert.equal(consumption.body.meta.count, 1);
  assert.equal(consumption.body.data[0].cumulativeKwh, 48438.74);

  const exported = await api().get('/api/v1/meters/export').expect(200);
  assert.equal(exported.body.meta.total, 403);
});

test('transformer pagination defaults to page one', async () => {
  let received;
  await api({
    getTransformers: async (query) => {
      received = query;
      return { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
    },
  }).get('/api/v1/transformers').expect(200);
  assert.deepEqual(received, { page: 1 });
});

test('invalid input produces a consistent validation error', async () => {
  const response = await api().get('/api/v1/meters?page=0').expect(400);
  assert.equal(response.body.error.code, 'validation_error');
  assert.equal(response.body.error.details[0].field, 'page');
});

test('portal errors keep their public status and safe message', async () => {
  const missing = await api({
    getConsumption: async () => {
      throw new PortalError(404, 'not_found', 'Meter not found');
    },
  }).get('/api/v1/meters/J100404/consumption').expect(404);
  assert.equal(missing.body.error.message, 'Meter not found');

  const unavailable = await api({
    searchMeters: async () => {
      throw new PortalError(502, 'portal_unavailable', 'Could not reach the portal');
    },
  }).get('/api/v1/meters').expect(502);
  assert.equal(unavailable.body.error.code, 'portal_unavailable');
});

test('unknown routes return JSON', async () => {
  const response = await api().get('/does-not-exist').expect(404);
  assert.equal(response.body.error.code, 'not_found');
});

test('malformed URL encoding returns 400 instead of 500', async () => {
  const response = await api().get('/api/v1/meters/%E0%A4%A').expect(400);
  assert.equal(response.body.error.code, 'validation_error');
  assert.equal(response.body.error.message, 'Malformed URL encoding');
});
