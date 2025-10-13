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

    const contactId = payload.contactId || (payload.contact && payload.contact.id) || inputs.contactId || (inputs.contact && inputs.contact.id) || null;
    const email = inputs.email || (payload.contact && payload.contact.email) || null;

    const age = inputs.age || inputs['Agent age'] || inputs.agentAge || null;
    const city = inputs.city || inputs['City'] || inputs.agentCity || null;
    const allergies = inputs.allergies || inputs['allergies'] || inputs.agentSkinAllergies || null;

    const receivedData = {email, contactId, age, city, allergies};

    // Build properties object for HubSpot update
    const properties = {};
    if (age) properties.agent_age = String(age).trim();
    if (city) properties.agent_city = String(city).trim();
    if (allergies) properties.agent_skin_allergies = String(allergies).trim();

    let targetContactId = contactId;
    if (!targetContactId && email) {
      const searchBody = {filterGroups: [{filters: [{propertyName: 'email', operator: 'EQ', value: email}]}], limit: 1};
      const searchResp = await hubspotRequest('/crm/v3/objects/contacts/search', token, {method: 'POST', body: JSON.stringify(searchBody), headers: {'Content-Type': 'application/json'}});
      if (!searchResp.ok) return res.status(502).json({success: false, error: 'HubSpot search error', meta: searchResp});
      const results = Array.isArray(searchResp.data.results) ? searchResp.data.results : [];
      if (results.length === 0) return res.status(404).json({success: false, error: 'Contact not found by email'});
      targetContactId = results[0].id;
    }

    let updatedData = null;
    if (Object.keys(properties).length > 0 && targetContactId) {
      const updateBody = {properties};
      const updateResp = await hubspotRequest(`/crm/v3/objects/contacts/${encodeURIComponent(targetContactId)}`, token, {method: 'PATCH', body: JSON.stringify(updateBody), headers: {'Content-Type': 'application/json'}});
      if (!updateResp.ok) return res.status(502).json({success: false, error: 'HubSpot update error', meta: updateResp});
      updatedData = updateResp.data;
    }

    return res.status(200).json({success: true, receivedData, updatedData});
  } catch (err) {
    return res.status(500).json({success: false, error: err.message || String(err)});
  }
};
