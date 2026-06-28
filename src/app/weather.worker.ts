/// <reference lib="webworker" />

function parseParamCsv(csvText: string, pointIdsSet: Set<number>): Map<string, number> {
  const result = new Map<string, number>();
  
  const firstLineEnd = csvText.indexOf('\n');
  if (firstLineEnd === -1) return result;
  
  const headerLine = csvText.substring(0, firstLineEnd).replace(/\r/g, '');
  const header = headerLine.split(';');
  const idxId = header.indexOf('point_id');
  const idxDate = header.indexOf('Date');
  const idxVal = header.length - 1;

  if (idxId === -1 || idxDate === -1) return result;

  // Pre-convert point IDs to strings for fast inclusion checking
  const pidStrings = [...pointIdsSet].map(id => String(id));

  let pos = firstLineEnd + 1;
  const len = csvText.length;
  
  while (pos < len) {
    let nextNewline = csvText.indexOf('\n', pos);
    if (nextNewline === -1) nextNewline = len;
    
    const line = csvText.substring(pos, nextNewline);
    pos = nextNewline + 1;
    
    // Fast check: if the line doesn't contain any of the station IDs, skip it
    let matched = false;
    for (let i = 0; i < pidStrings.length; i++) {
      if (line.includes(pidStrings[i])) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;

    const cols = line.split(';');
    const id = parseInt(cols[idxId]);
    if (isNaN(id) || !pointIdsSet.has(id)) continue;

    const dt = cols[idxDate]?.trim();
    const val = parseFloat(cols[idxVal]);
    if (isNaN(val)) continue;

    result.set(`${id}_${dt}`, val);
  }
  return result;
}

function mergeHourlyData(
  pointId: number,
  params: string[],
  paramData: Record<string, Map<string, number>>
): any[] {
  const allDates = new Set<string>();
  for (const p of params) {
    const map = paramData[p];
    if (!map) continue;
    for (const key of map.keys()) {
      if (key.startsWith(`${pointId}_`)) {
        const dt = key.substring(key.indexOf('_') + 1);
        allDates.add(dt);
      }
    }
  }

  const sorted = [...allDates].sort();
  return sorted.map(dt => {
    const date = parseMeteoDate(dt);
    const key = `${pointId}_${dt}`;
    const h: any = { datetime: date };
    if (paramData['tre200h0']?.has(key)) h.temperature = paramData['tre200h0'].get(key);
    if (paramData['rre150h0']?.has(key)) h.precipitation = paramData['rre150h0'].get(key);
    if (paramData['fu3010h0']?.has(key)) h.windSpeed = paramData['fu3010h0'].get(key);
    if (paramData['fu3010h1']?.has(key)) h.windGust = paramData['fu3010h1'].get(key);
    if (paramData['rp0003i0']?.has(key)) h.precipProb = paramData['rp0003i0'].get(key);
    if (paramData['sre000h0']?.has(key)) h.sunshine = paramData['sre000h0'].get(key);
    if (paramData['jww003i0']?.has(key)) h.weatherIcon = paramData['jww003i0'].get(key);
    if (paramData['nprolohs']?.has(key)) h.cloudCoverLow = paramData['nprolohs'].get(key);
    return h;
  });
}

function mergeDailyData(
  pointId: number,
  params: string[],
  paramData: Record<string, Map<string, number>>
): any[] {
  const allDates = new Set<string>();
  for (const p of params) {
    const map = paramData[p];
    if (!map) continue;
    for (const key of map.keys()) {
      if (key.startsWith(`${pointId}_`)) {
        const dt = key.substring(key.indexOf('_') + 1);
        allDates.add(dt);
      }
    }
  }

  const sorted = [...allDates].sort();
  return sorted.map(dt => {
    const date = parseMeteoDate(dt);
    const key = `${pointId}_${dt}`;
    const d: any = { date };
    if (paramData['tre200pn']?.has(key)) d.tempMin = paramData['tre200pn'].get(key);
    if (paramData['tre200px']?.has(key)) d.tempMax = paramData['tre200px'].get(key);
    if (paramData['rka150p0']?.has(key)) d.precipTotal = paramData['rka150p0'].get(key);
    if (paramData['jp2000d0']?.has(key)) d.weatherIcon = paramData['jp2000d0'].get(key);
    return d;
  });
}

function parseMeteoDate(s: string): Date {
  const year  = parseInt(s.substring(0, 4));
  const month = parseInt(s.substring(4, 6)) - 1;
  const day   = parseInt(s.substring(6, 8));
  const hour  = parseInt(s.substring(8, 10)) || 0;
  const min   = parseInt(s.substring(10, 12)) || 0;
  return new Date(Date.UTC(year, month, day, hour, min));
}

addEventListener('message', async ({ data }) => {
  const { urls, pointIds, stations } = data;
  const pointIdsSet = new Set<number>(pointIds);

  const params = Object.keys(urls);
  const paramData: Record<string, Map<string, number>> = {};

  try {
    // Fetch and parse all CSV parameters in parallel in background thread
    await Promise.all(
      params.map(async (param) => {
        try {
          const res = await fetch(urls[param]);
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          const csvText = await res.text();
          paramData[param] = parseParamCsv(csvText, pointIdsSet);
        } catch (e) {
          console.error(`Worker failed to fetch/parse param ${param}:`, e);
          paramData[param] = new Map();
        }
      })
    );

    const HOURLY_PARAMS = ['tre200h0', 'rre150h0', 'fu3010h0', 'fu3010h1', 'rp0003i0', 'sre000h0', 'jww003i0', 'nprolohs'];
    const DAILY_PARAMS  = ['tre200pn', 'tre200px', 'rka150p0', 'jp2000d0'];

    const forecasts = stations.map((station: any) => {
      const hourly = mergeHourlyData(station.point_id, HOURLY_PARAMS, paramData);
      const daily  = mergeDailyData(station.point_id, DAILY_PARAMS, paramData);
      return { station, hourly, daily, fetchedAt: new Date() };
    });

    postMessage({ success: true, forecasts });
  } catch (err: any) {
    postMessage({ success: false, error: err.message || 'Unknown error' });
  }
});
