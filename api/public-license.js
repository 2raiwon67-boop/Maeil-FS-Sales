// 공공데이터포털 지방행정 인허가 데이터 API 프록시
// API 키는 Vercel 환경변수 PUBLIC_DATA_API_KEY 에 설정
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const API_KEY = process.env.PUBLIC_DATA_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ error: 'API 키가 설정되지 않았습니다. Vercel 환경변수 PUBLIC_DATA_API_KEY를 설정해주세요.' });
    }

    const { opnSvcNm, siteWhlAddr, startDate, endDate, pageIndex = '1' } = req.query;
    if (!opnSvcNm) {
        return res.status(400).json({ error: 'opnSvcNm 파라미터가 필요합니다.' });
    }

    const params = new URLSearchParams({
        authKey: API_KEY,
        opnSvcNm,
        state1: '01',       // 영업/정상만
        pageIndex,
        pageSize: '1000',
        resultType: 'json'
    });

    if (siteWhlAddr) params.set('siteWhlAddr', siteWhlAddr);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const url = `https://www.localdata.go.kr/platform/rest/TO0/openDataApi?${params}`;

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
