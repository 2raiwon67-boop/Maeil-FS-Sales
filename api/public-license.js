// 공공데이터포털 지방행정 인허가 데이터 API 프록시
// API 키는 Vercel 환경변수 PUBLIC_DATA_API_KEY 에 설정

const SERVICE_ENDPOINTS = {
    '일반음식점': 'https://apis.data.go.kr/1741000/general_restaurants/info',
    '제과점영업':  'https://apis.data.go.kr/1741000/bakeries/info',
    '휴게음식점': 'https://apis.data.go.kr/1741000/rest_cafes/info'
};

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

    const API_KEY = process.env.PUBLIC_DATA_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ error: 'API 키가 설정되지 않았습니다. Vercel 환경변수 PUBLIC_DATA_API_KEY를 설정해주세요.' });
    }

    const { serviceType, startDate, endDate, pageNo = '1',
            SALS_STTS_CD, LOTNO_ADDR } = req.query;
    const endpoint = SERVICE_ENDPOINTS[serviceType];
    if (!endpoint) {
        return res.status(400).json({ error: '유효하지 않은 serviceType입니다. (일반음식점/제과점영업/휴게음식점)' });
    }

    const params = new URLSearchParams({
        serviceKey: API_KEY,
        pageNo,
        numOfRows: '1000',
        returnType: 'json'
    });

    // 서버 필터 (API가 지원하면 적용, 미지원이면 무시됨)
    if (SALS_STTS_CD) params.set('SALS_STTS_CD', SALS_STTS_CD);
    if (LOTNO_ADDR)   params.set('LOTNO_ADDR', LOTNO_ADDR);
    if (startDate)    params.set('startDate', startDate);
    if (endDate)      params.set('endDate', endDate);

    const url = `${endpoint}?${params}`;

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            return res.status(response.status).json({
                error: '공공데이터포털 API 오류',
                status: response.status
            });
        }

        const text = await response.text();
        const data = JSON.parse(text);
        res.json(data);

    } catch (e) {
        res.status(500).json({ error: '공공데이터포털 응답 처리 오류', details: e.message });
    }
}
