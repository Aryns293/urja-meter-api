import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapMeterDetail, parsePortalTimestamp } from '../src/portal/mappers.js';
import { energyResponseSchema, geoResponseSchema } from '../src/portal/schemas.js';

test('portal timestamps are interpreted as India Standard Time', () => {
  assert.equal(
    parsePortalTimestamp('23/06/2026 23:30'),
    '2026-06-23T18:00:00.000Z',
  );
});

test('meter detail splits hierarchy labels into names and codes', () => {
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
  const geo = { data: { latitude: '26.9', longitude: '75.8' } };
  const result = mapMeterDetail(detail, geo);

  assert.deepEqual(result.hierarchy.distributionTransformer, {
    name: 'Malviya Nagar DT 1',
    code: 'DT-001',
  });
  assert.deepEqual(result.location, { latitude: 26.9, longitude: 75.8 });
});

test('impossible portal calendar dates are rejected', () => {
  assert.throws(() => parsePortalTimestamp('31/02/2026 23:30'), /Invalid portal timestamp/);
  assert.throws(() => parsePortalTimestamp('23/06/2026 24:00'), /Invalid portal timestamp/);
});

test('upstream coordinates and readings must be finite decimal numbers', () => {
  const invalidGeo = geoResponseSchema.safeParse({
    data: { latitude: '', longitude: '75.8' },
  });
  assert.equal(invalidGeo.success, false);

  const invalidEnergy = energyResponseSchema.safeParse({
    data: [{ timestamp: '23/06/2026 23:30', kwh: 'not-a-number', kvah: '1', voltR: '220' }],
  });
  assert.equal(invalidEnergy.success, false);
});
