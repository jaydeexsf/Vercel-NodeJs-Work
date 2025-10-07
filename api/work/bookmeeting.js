const HUBSPOT_BASE = 'https://api.hubapi.com';

async function hubspotRequest(path, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const r = await fetch(`${HUBSPOT_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
  });
  clearTimeout(timeout);
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
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

    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: 'Only GET supported for this endpoint' });
    }

    // Optional filters from query (name, organizerUserId, type)
    const name = normalizeString(req.query.name);
    const organizerUserId = normalizeString(req.query.organizerUserId);
    const type = normalizeString(req.query.type);

    const query = new URLSearchParams();
    if (name) query.append('name', name);
    if (organizerUserId) query.append('organizerUserId', organizerUserId);
    if (type) query.append('type', type);
    query.append('limit', '100');

    const path = `/scheduler/v3/meetings/meeting-links?${query.toString()}`;
    const resp = await hubspotRequest(path, token);

    if (!resp.ok) {
      return res.status(502).json({
        success: false,
        error: 'HubSpot API error',
        meta: { status: resp.status, statusText: resp.statusText },
        body: resp.data || resp.raw,
      });
    }

    const items = Array.isArray(resp.data.results) ? resp.data.results : [];
    const cleaned = items.map(link => ({
      id: link.id,
      name: link.name,
      slug: link.slug,
      organizerUserId: link.organizerUserId,
      type: link.type,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      url: `https://meetings.hubspot.com/${link.slug}`,
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ success: true, count: cleaned.length, items: cleaned });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
