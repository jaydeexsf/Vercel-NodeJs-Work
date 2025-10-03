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

module.exports = async (req, res) => {
  try {
    const token = process.env.HUBSPOT_PAT;
    if (!token) {
      return res.status(500).json({ success: false, error: 'Missing HUBSPOT_PAT env var' });
    }

    // Optional query: limit properties to a subset
    const { properties } = req.query || {};
    const propsParam = properties ? `&properties=${encodeURIComponent(properties)}` : '';

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
    const items = all.map(o => ({
      id: o.id,
      meeting: o.properties && (o.properties.meeting || o.properties.meeting_name || o.properties.meeting_title) || null,
      languages: o.properties && (o.properties.languages || o.properties.language || o.properties.language_of_instruction) || null,
      properties: o.properties || {}
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ success: true, count: items.length, items });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
