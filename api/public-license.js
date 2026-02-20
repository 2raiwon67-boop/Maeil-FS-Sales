// 공공데이터포털 지방행정 인허가 데이터 API 프록시
// API 키는 Vercel 환경변수 PUBLIC_DATA_API_KEY 에 설정

const SERVICE_ENDPOINTS = {
    '일반음식점': 'https://apis.data.go.kr/1741000/general_restaurants/info',
    '제과점영업':  'https://apis.data.go.kr/1741000/bakeries/info',
    '휴게음식점': 'https://apis.data.go.kr/1741000/rest_cafes/info'
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const API_KEY = process.env.PUBLIC_DATA_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ error: 'API 키가 설정되지 않았습니다. Vercel 환경변수 PUBLIC_DATA_API_KEY를 설정해주세요.' });
    }

    const { serviceType, siteWhlAddr, startDate, endDate, pageNo = '1' } = req.query;
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

    if (siteWhlAddr) params.set('siteWhlAddr', siteWhlAddr);
    if (startDate)   params.set('startDate', startDate);
    if (endDate)     params.set('endDate', endDate);

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
