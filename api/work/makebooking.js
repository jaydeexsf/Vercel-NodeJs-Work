const HUBSPOT_BASE = 'https://api.hubapi.com';
const TIMEOUT_MS = 20000;

async function hubspotRequest(path, token, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const method = opts.method || 'GET';
  const headers = Object.assign({'Authorization': `Bearer ${token}`}, opts.headers || {});
  const body = opts.body || null;
  const r = await fetch(`${HUBSPOT_BASE}${path}`, {method, headers, body, signal: controller.signal});
  clearTimeout(timeout);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { return {ok: false, status: r.status, statusText: r.statusText, parseError: true, raw: text}; }
  return {ok: r.ok, status: r.status, statusText: r.statusText, data};
}

module.exports = async (req, res) => {
  try {
    const token = process.env.HUBSPOT_PAT;
    if (!token) return res.status(500).json({success: false, error: 'Missing HUBSPOT_PAT env var'});
    if (req.method !== 'POST') return res.status(405).json({success: false, error: 'Only POST supported'});

    const payload = req.body || {};
    const inputs = payload.inputs || payload;

    // Robust email detection
    const emailKeys = ['email', 'Email', 'email:', 'Email:'];
    let email = null;
    for (const key of emailKeys) {
      if (inputs[key]) {
        email = inputs[key];
        break;
      }
    }
    if (!email && payload.contact && payload.contact.email) email = payload.contact.email;
    if (!email) return res.status(400).json({success: false, error: 'Missing email', receivedPayload: payload});

    // Collect all inputs to map to HubSpot properties
    const receivedData = {};
    Object.keys(inputs).forEach(k => {
      receivedData[k] = inputs[k];
    });
    receivedData.contactId = payload.contactId || (payload.contact && payload.contact.id) || null;

    // Search contact by email if no contactId
    let contactId = receivedData.contactId;
    if (!contactId) {
      const searchBody = {filterGroups: [{filters: [{propertyName: 'email', operator: 'EQ', value: email}]}], limit: 1};
      const searchResp = await hubspotRequest('/crm/v3/objects/contacts/search', token, {
        method: 'POST',
        body: JSON.stringify(searchBody),
        headers: {'Content-Type': 'application/json'}
      });
      if (!searchResp.ok) return res.status(502).json({success: false, error: 'HubSpot search error', meta: searchResp, receivedPayload: payload});
      const results = Array.isArray(searchResp.data.results) ? searchResp.data.results : [];
      if (results.length === 0) return res.status(404).json({success: false, error: 'Contact not found by email', receivedPayload: payload});
      contactId = results[0].id;
    }

    // Build HubSpot properties object dynamically from inputs
    const properties = {};
    Object.keys(inputs).forEach(k => {
      if (k.toLowerCase().includes('age')) properties.agent_age = String(inputs[k]).trim();
      else if (k.toLowerCase().includes('city')) properties.agent_city = String(inputs[k]).trim();
      else if (k.toLowerCase().includes('allergies')) properties.agent_skin_allergies = String(inputs[k]).trim();
    });

    // Update contact
    const updateResp = await hubspotRequest(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({properties}),
      headers: {'Content-Type': 'application/json'}
    });

    return res.status(200).json({
      success: true,
      receivedData,
      hubspotUpdateResponse: updateResp
    });
  } catch (err) {
    return res.status(500).json({success: false, error: err.message || String(err)});
  }
};
