const HUBSPOT_BASE = 'https://api.hubapi.com';

async function hubspotRequest(path, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const r = await fetch(`${HUBSPOT_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    signal: controller.signal
  });
  clearTimeout(timeout);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { ok: false, status: r.status, statusText: r.statusText, parseError: true, raw: text };
  }
  return { ok: r.ok, status: r.status, statusText: r.statusText, data };
}

async function hubspotCreate(path, token, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const r = await fetch(`${HUBSPOT_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: controller.signal
  });
  clearTimeout(timeout);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { ok: false, status: r.status, statusText: r.statusText, parseError: true, raw: text };
  }
  return { ok: r.ok, status: r.status, statusText: r.statusText, data };
}

function normalizeString(v) {
  return (v === undefined || v === null) ? '' : String(v).trim();
}

module.exports = async (req, res) => {
  try {
    const token = process.env.HUBSPOT_PAT;
    if (!token) {
      return res.status(500).json({ success: false, error: 'Missing HUBSPOT_PAT env var' });
    }

    if (req.method === 'POST') {
      // Accept meeting and language from query or JSON body
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (_) { body = {}; }
      const meeting = normalizeString((req.query && req.query.meeting) || body.meeting);
      const language = normalizeString((req.query && (req.query.language || req.query.languages)) || body.language || body.languages);

      if (!meeting && !language) {
        return res.status(400).json({ success: false, error: 'Provide at least one of: meeting or language' });
      }

      // Build properties. Use common field names; adjust if your schema differs.
      const properties = {};
      if (meeting) properties.meeting = meeting;
      if (language) {
        // prefer a languages field if available
        properties.languages = language;
      }

      const createResp = await hubspotCreate('/crm/v3/objects/2-50779282', token, { properties });
      if (!createResp.ok) {
        return res.status(502).json({ success: false, error: 'HubSpot create failed', meta: { status: createResp.status, statusText: createResp.statusText }, body: createResp.data || createResp.raw });
      }

      const created = createResp.data || {};
      return res.status(201).json({ success: true, created: { id: created.id, properties: created.properties || {} } });
    }

    // GET: list/fetch with optional filters
    const { properties, meeting, languages } = req.query || {};
    const defaultProps = [
      'meeting', 'meeting_name', 'meeting_title', 'meeting_time', 'meeting_date',
      'languages', 'language', 'language_of_instruction'
    ];
    const propsParam = properties
      ? `&properties=${encodeURIComponent(properties)}`
      : `&properties=${encodeURIComponent(defaultProps.join(','))}`;

    let after = undefined;
    const all = [];

    for (let i = 0; i < 1000; i++) { // hard cap on pages
      const cursor = after ? `&after=${encodeURIComponent(after)}` : '';
      const path = `/crm/v3/objects/2-50779282?limit=100${cursor}${propsParam}`;
      const resp = await hubspotRequest(path, token);
      if (!resp.ok) {
        return res.status(502).json({ success: false, error: 'HubSpot upstream error', meta: { status: resp.status, statusText: resp.statusText }, body: resp.data || resp.raw });
      }
      const page = resp.data || {};
      const results = Array.isArray(page.results) ? page.results : [];
      all.push(...results);
      after = page.paging && page.paging.next && page.paging.next.after ? page.paging.next.after : undefined;
      if (!after) break;
    }

    // Map output to highlight likely fields while still returning full properties
    let items = all.map(o => {
      const props = o.properties || {};
      const meetingValue = props.meeting || props.meeting_name || props.meeting_title || props.meeting_time || props.meeting_date || null;
      const languagesValue = props.languages || props.language || props.language_of_instruction || null;
      return {
        id: o.id,
        meeting: meetingValue,
        languages: languagesValue,
        properties: props,
        _debugPropertyKeys: Object.keys(props)
      };
    });

    // Apply optional filters from query
    const meetingFilter = normalizeString(meeting).toLowerCase();
    const languagesFilterRaw = normalizeString(languages);
    const languagesList = languagesFilterRaw ? languagesFilterRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    if (meetingFilter) {
      items = items.filter(it => normalizeString(it.meeting).toLowerCase().includes(meetingFilter));
    }
    if (languagesList.length) {
      items = items.filter(it => {
        const val = normalizeString(it.languages).toLowerCase();
        if (!val) return false;
        return languagesList.some(lang => val.includes(lang.toLowerCase()));
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ success: true, count: items.length, items });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
