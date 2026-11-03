function pagination(body) {
  return {
    page: body.page,
    pageSize: body.pageSize,
    total: body.total,
    totalPages: Math.ceil(body.total / body.pageSize),
  };
}

export function mapMeterSearch(body) {
  return {
    data: body.data.map((meter) => ({
      meterId: meter.meterId,
      serialNumber: meter.serialNo,
      make: meter.make,
      phaseType: meter.phaseType,
      installationStatus: meter.installStatus,
      distributionTransformerCode: meter.dtCode,
    })),
    pagination: pagination(body),
  };
}

function parseHierarchyNode(value) {
  const match = value.match(/^(.*) \(([^()]+)\)$/);
  return match
    ? { name: match[1], code: match[2] }
    : { name: value, code: null };
}

export function mapMeterDetail(detail, geo) {
  const parameters = Object.fromEntries(
    detail.detail.data.map((item) => [item.parameterName, item.parameterValue]),
  );
  const requiredParameters = [
    'Meter ID',
    'Serial No',
    'Make',
    'Phase Type',
    'Installation Status',
    'Installation Type',
  ];
  if (requiredParameters.some((name) => !parameters[name])) {
    throw new Error('Meter nameplate is incomplete');
  }
  const hierarchy = detail.hierarchy;

  return {
    meterId: parameters['Meter ID'],
    serialNumber: parameters['Serial No'],
    make: parameters.Make,
    phaseType: parameters['Phase Type'],
    installationStatus: parameters['Installation Status'],
    installationType: parameters['Installation Type'],
    location: {
      latitude: Number(geo.data.latitude),
      longitude: Number(geo.data.longitude),
    },
    hierarchy: {
      zone: parseHierarchyNode(hierarchy.Zone),
      circle: parseHierarchyNode(hierarchy.Circle),
      division: parseHierarchyNode(hierarchy.Division),
      subdivision: parseHierarchyNode(hierarchy.Subdivision),
      substation: parseHierarchyNode(hierarchy['Sub Station']),
      feeder: parseHierarchyNode(hierarchy.Feeder),
      distributionTransformer: parseHierarchyNode(hierarchy.DT),
    },
  };
}

export function parsePortalTimestamp(value) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Unsupported portal timestamp: ${value}`);
  }

  const [, day, month, year, hour, minute] = match;
  const parts = [year, month, day, hour, minute].map(Number);
  const localTime = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  const localDate = new Date(localTime);
  const actualParts = [
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate(),
    localDate.getUTCHours(),
    localDate.getUTCMinutes(),
  ];
  if (actualParts.some((part, index) => part !== parts[index])) {
    throw new Error(`Invalid portal timestamp: ${value}`);
  }

  const indiaOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(localTime - indiaOffsetMs).toISOString();
}

export function mapConsumption(body) {
  const data = body.data.map((reading) => ({
    timestamp: parsePortalTimestamp(reading.timestamp),
    cumulativeKwh: Number(reading.kwh),
    cumulativeKvah: Number(reading.kvah),
    voltageR: Number(reading.voltR),
  }));

  return {
    data,
    meta: {
      count: data.length,
      firstTimestamp: data.at(0)?.timestamp ?? null,
      lastTimestamp: data.at(-1)?.timestamp ?? null,
      sourceTimezone: 'Asia/Kolkata',
    },
  };
}

export function mapTransformers(body) {
  return { data: body.data, pagination: pagination(body) };
}

export function mapExport(body) {
  return {
    data: body.data.map((meter) => ({
      meterId: meter.meterId,
      serialNumber: meter.serialNo,
      make: meter.make,
      phaseType: meter.phaseType,
      installationStatus: meter.installStatus,
      installationType: meter.installType,
      distributionTransformerCode: meter.dtCode,
      build: meter.build,
      location: {
        latitude: meter.geo.lat,
        longitude: meter.geo.lng,
      },
      hierarchy: {
        zone: meter.hierarchy.zone,
        circle: meter.hierarchy.circle,
        division: meter.hierarchy.division,
        subdivision: meter.hierarchy.subdivision,
        substation: meter.hierarchy.substation,
        feeder: meter.hierarchy.feeder,
        distributionTransformer: meter.hierarchy.dt,
      },
    })),
    meta: { total: body.total },
  };
}
