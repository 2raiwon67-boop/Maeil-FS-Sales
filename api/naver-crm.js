export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { storeName } = req.body || {};
    if (!storeName?.trim()) {
        return res.status(400).json({ success: false, error: '거래처명을 입력해주세요.' });
    }

    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        return res.status(500).json({ success: false, error: 'API 키가 설정되지 않았습니다.' });
    }

    const naverHeaders = {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
    };

    const stripHtml = (str) => str ? str.replace(/<[^>]*>/g, '') : '';

    try {
        const [localResult, blogResult] = await Promise.allSettled([
            fetch(
                `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(storeName)}&display=3`,
                { headers: naverHeaders }
            ).then(r => r.json()),
            fetch(
                `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(storeName)}&display=5&sort=date`,
                { headers: naverHeaders }
            ).then(r => r.json())
        ]);

        const localData = localResult.status === 'fulfilled' ? localResult.value : { items: [] };
        const blogData = blogResult.status === 'fulfilled' ? blogResult.value : { items: [] };

        return res.status(200).json({
            success: true,
            local: (localData.items || []).map(item => ({
                name: stripHtml(item.title),
                category: item.category,
                address: item.roadAddress || item.address,
                telephone: item.telephone
            })),
            blog: (blogData.items || []).map(item => ({
                title: stripHtml(item.title),
                description: stripHtml(item.description),
                date: item.postdate
            }))
        });
    } catch (error) {
        console.error('naver-crm error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
