module.exports = async (req, res) => {
  try {
    const sample = [
      {
        collection: 'Bukhari',
        book: 1,
        hadith: 1,
        narrator: 'Umar ibn Al-Khattab (RA)',
        text: 'Actions are but by intentions...'
      },
      {
        collection: 'Muslim',
        book: 8,
        hadith: 2564,
        narrator: 'Abu Huraira (RA)',
        text: 'A strong believer is better and more beloved to Allah...'
      }
    ];

    const { collection } = req.query || {};
    const data = collection ? sample.filter(h => h.collection.toLowerCase() === String(collection).toLowerCase()) : sample;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ success: true, count: data.length, items: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
