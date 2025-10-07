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
      return res.status(405).json({ success: false, error: 'Only GET supported' });
    }

    // Timezone (optional query)
    const timezone = normalizeString(req.query.timezone) || 'UTC';

    // Step 1: Get all meeting links
    const listResp = await hubspotRequest('/scheduler/v3/meetings/meeting-links?limit=50', token);
    if (!listResp.ok) {
      return res.status(502).json({
        success: false,
        error: 'Failed to fetch meeting links',
        meta: { status: listResp.status, statusText: listResp.statusText },
        body: listResp.data || listResp.raw,
      });
    }

    const links = Array.isArray(listResp.data.results) ? listResp.data.results : [];

    // Step 2: Get all unique organizer user IDs
    const userIds = [...new Set(links.map(i => i.organizerUserId).filter(Boolean))];
    const userMap = {};

    for (const id of userIds) {
      const userResp = await hubspotRequest(`/settings/v3/users/${id}`, token);
      if (userResp.ok && userResp.data) {
        const u = userResp.data;
        userMap[id] = {
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          email: u.email || null,
        };
      }
    }

    // Step 3: Get availability + meeting details for each link
    const results = [];
    for (const link of links) {
      const slug = link.slug;
      let availability = [];
      let meetingDetails = {};

      try {
        const availResp = await hubspotRequest(
          `/scheduler/v3/meetings/meeting-links/book/availability-page/${encodeURIComponent(slug)}?timezone=${encodeURIComponent(timezone)}`,
          token
        );

        if (availResp.ok && availResp.data) {
          meetingDetails = {
            title: availResp.data.title || link.name,
            description: availResp.data.description || null,
            durationMinutes: availResp.data.durationMinutes || null,
          };
          availability = availResp.data.availableTimeslots || [];
        }
      } catch (err) {
        availability = [];
      }

      results.push({
        id: link.id,
        name: link.name,
        slug: link.slug,
        organizerUserId: link.organizerUserId,
        organizerName: userMap[link.organizerUserId]?.name || 'Unknown',
        organizerEmail: userMap[link.organizerUserId]?.email || null,
        type: link.type,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        url: `https://meetings.hubspot.com/${link.slug}`,
        meetingDetails,
        availableSlots: availability.map(slot => ({
          start: slot.startTime,
          end: slot.endTime,
          timezone: slot.timeZone || timezone,
        })),
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ success: true, count: results.length, items: results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
