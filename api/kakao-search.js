const ALLOWED_ORIGINS = [
    'https://2raiwon67-boop.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080'
];

export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0]);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
    if (!KAKAO_KEY) {
        return res.status(500).json({ error: 'Kakao API 키가 설정되지 않았습니다.' });
    }

    const { query, page = '1', size = '15' } = req.query;
    if (!query?.trim()) {
        return res.status(400).json({ error: '검색어를 입력해주세요.' });
    }

    const pageNum = Math.min(Math.max(parseInt(page) || 1, 1), 3);
    const sizeNum = Math.min(Math.max(parseInt(size) || 15, 1), 15);

    const params = new URLSearchParams({
        query: query.trim(),
        page: pageNum,
        size: sizeNum,
    });

    try {
        const kakaoRes = await fetch(
            `https://dapi.kakao.com/v2/local/search/keyword.json?${params}`,
            { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
        );

        if (!kakaoRes.ok) {
            const errText = await kakaoRes.text();
            return res.status(kakaoRes.status).json({ error: `카카오 API 오류: ${errText}` });
        }

        const data = await kakaoRes.json();
        return res.status(200).json(data);
    } catch (err) {
        console.error('[kakao-search] error:', err);
        return res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
    }
}
