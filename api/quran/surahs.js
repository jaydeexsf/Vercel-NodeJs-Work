module.exports = async (req, res) => {
  try {
    // Fetch surah metadata from a reliable public source (AlQuran Cloud API)
    // Docs: https://alquran.cloud/api
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await fetch('https://api.alquran.cloud/v1/surah', { signal: controller.signal });
    clearTimeout(timeout);

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      return res.status(502).json({ success: false, error: 'Upstream parse error', raw: text });
    }

    if (!r.ok || !data || data.status !== 'OK') {
      return res.status(502).json({ success: false, error: 'Upstream failure', meta: { status: r.status, statusText: r.statusText }, data });
    }

    const surahs = (data.data || []).map(s => ({
      number: s.number,
      name: s.englishName,
      nameShort: s.englishNameTranslation,
      revelationType: s.revelationType,
      ayahs: s.numberOfAyahs
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ success: true, count: surahs.length, surahs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
