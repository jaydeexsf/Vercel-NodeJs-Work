module.exports = async (req, res) => {
  try {
    const token = process.env.HUBSPOT_PAT;
    if (!token) return res.status(500).json({ success: false, error: 'Missing HUBSPOT_PAT env var' });
    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Only GET supported' });

    const name = req.query.name || '';
    const organizerUserId = req.query.organizerUserId || '';
    const type = req.query.type || '';

    const query = new URLSearchParams();
    if (name) query.append('name', name);
    if (organizerUserId) query.append('organizerUserId', organizerUserId);
    if (type) query.append('type', type);
    query.append('limit', '100');

    const path = `/scheduler/v3/meetings/meeting-links?${query.toString()}`;
    const resp = await hubspotRequest(path, token);

    if (!resp.ok) {
      return res.status(502).json({ success: false, error: 'HubSpot API error', meta: { status: resp.status, statusText: resp.statusText }, body: resp.data || resp.raw });
    }

    // Return full items for inspection
    const items = Array.isArray(resp.data.results) ? resp.data.results : [];
    return res.status(200).json({ success: true, count: items.length, items });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
