import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function stripHtml(str: string): string {
  return str ? str.replace(/<[^>]*>/g, '') : '';
}

const CAFE_KEYWORDS = ['카페', '커피', '베이커리', '제과', '브런치', '디저트', '케이크', '티'];
const FOOD_KEYWORDS = ['음식점', '레스토랑', '식당', '주점', '패스트푸드'];

function categorySortScore(cat: string | undefined): number {
  if (!cat) return 9;
  if (CAFE_KEYWORDS.some((k) => cat.includes(k))) return 0;
  if (FOOD_KEYWORDS.some((k) => cat.includes(k))) return 1;
  return 5;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeName, productDB, previousReviewLinks } = body || {};

  if (!storeName?.trim()) {
    return NextResponse.json({ success: false, error: '매장명을 입력해주세요.' }, { status: 400 });
  }

  const isIncrementalUpdate = previousReviewLinks && previousReviewLinks.length > 0;
  const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET || !GEMINI_API_KEY) {
    return NextResponse.json({ success: false, error: 'API 키가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    let localData: any = { items: [] };
    let blogData: any = { items: [] };
    let naverCacheHit = false;

    // 네이버 API 캐시 조회 (240h)
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const cacheRes = await fetch(
          `${SUPABASE_URL}/rest/v1/naver_cache?store_name=eq.${encodeURIComponent(storeName.trim())}&select=local_data,blog_data,cached_at`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
        );
        if (cacheRes.ok) {
          const rows = await cacheRes.json();
          if (Array.isArray(rows) && rows.length > 0) {
            const row = rows[0];
            const ageMs = Date.now() - new Date(row.cached_at).getTime();
            if (ageMs < 240 * 60 * 60 * 1000) {
              localData = row.local_data || { items: [] };
              blogData = row.blog_data || { items: [] };
              naverCacheHit = true;
            }
          }
        }
      } catch {}
    }

    if (!naverCacheHit) {
      const naverHeaders = {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      };
      const [localResult, blogResult] = await Promise.allSettled([
        fetch(`https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(storeName)}&display=5`, { headers: naverHeaders }).then((r) => r.json()),
        fetch(`https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(storeName + ' 리뷰')}&display=10&sort=date`, { headers: naverHeaders }).then((r) => r.json()),
      ]);

      localData = localResult.status === 'fulfilled' ? localResult.value : { items: [] };
      blogData = blogResult.status === 'fulfilled' ? blogResult.value : { items: [] };

      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        fetch(`${SUPABASE_URL}/rest/v1/naver_cache`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ store_name: storeName.trim(), local_data: localData, blog_data: blogData, cached_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }

    let filteredBlogItems = blogData.items || [];
    if (isIncrementalUpdate) {
      const previousLinks = new Set(previousReviewLinks);
      filteredBlogItems = filteredBlogItems.filter((item: any) => !previousLinks.has(item.link));
      if (filteredBlogItems.length === 0) {
        return NextResponse.json({ success: true, cached: true, message: '최신 리뷰가 없습니다.' });
      }
    }

    // Gemini 분석 캐시
    const newReviewCount = isIncrementalUpdate ? filteredBlogItems.length : (blogData.items || []).length;
    let analysisCacheHit = false;
    let cachedAnalysis: any = null;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const acRes = await fetch(
          `${SUPABASE_URL}/rest/v1/store_analysis_cache?store_name=eq.${encodeURIComponent(storeName.trim())}&select=analysis,review_count,cached_at&limit=1`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
        );
        if (acRes.ok) {
          const rows = await acRes.json();
          if (Array.isArray(rows) && rows.length > 0) {
            const row = rows[0];
            const daysSince = (Date.now() - new Date(row.cached_at).getTime()) / 86400000;
            const reviewDiff = newReviewCount - (row.review_count || 0);
            if (daysSince < 7 && reviewDiff < 2) {
              cachedAnalysis = row.analysis;
              analysisCacheHit = true;
            }
          }
        }
      } catch {}
    }

    if (analysisCacheHit && cachedAnalysis) {
      const products = productDB || [];
      const recommendedItems = (cachedAnalysis.recommendedIndices || []).filter((i: number) => i >= 0 && i < products.length).map((i: number) => products[i]);
      return NextResponse.json({
        success: true, cached: true, tags: cachedAnalysis.tags || [], description: cachedAnalysis.description || '',
        items: recommendedItems, signatureMenus: cachedAnalysis.signatureMenus || [],
        reviewLinks: (blogData.items || []).map((i: any) => i.link), isUpdate: isIncrementalUpdate, recipeMatched: 0,
        naverInfo: { localResults: (localData.items || []).length, blogResults: newReviewCount, newReviews: newReviewCount },
      });
    }

    // 데이터 정리
    const localSummary = (localData.items || [])
      .map((item: any) => ({ name: stripHtml(item.title), category: item.category, address: item.roadAddress || item.address }))
      .sort((a: any, b: any) => categorySortScore(a.category) - categorySortScore(b.category));

    const blogSummary = filteredBlogItems.map((item: any) => ({
      title: stripHtml(item.title), description: stripHtml(item.description).substring(0, 100), link: item.link,
    }));

    // Recipe RAG
    let recipeSection = '';
    let recipeMatchCount = 0;
    if (SUPABASE_URL && SERVICE_KEY) {
      try {
        const embedText = [storeName, ...filteredBlogItems.slice(0, 5).map((b: any) => stripHtml(b.title))].join(' ');
        const embedRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: embedText }] }, outputDimensionality: 768 }) },
        );
        if (embedRes.ok) {
          const embedData = await embedRes.json();
          const vector = embedData.embedding?.values;
          if (Array.isArray(vector) && vector.length === 768) {
            const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_recipes`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({ query_embedding: `[${vector.join(',')}]`, match_count: 5 }),
            });
            if (rpcRes.ok) {
              const matched = await rpcRes.json();
              if (Array.isArray(matched) && matched.length > 0) {
                recipeMatchCount = matched.length;
                const recipeLines = matched.map((r: any) => `- [${r.category || '음료'}] ${r.name}: 자사제품=[${(r.main_products || []).join(', ')}] 태그=[${(r.tags || []).slice(0, 4).join(', ')}]`).join('\n');
                recipeSection = `\n## 자사 레시피 DB — 유사 메뉴 활용 사례\n${recipeLines}\n`;
              }
            }
          }
        }
      } catch {}
    }

    // Gemini 프롬프트
    const products = productDB || [];
    const productList = products.map((p: any, i: number) => `[${i}] ${p.name} / ${p.spec}${p.usage ? ` / 용도: ${p.usage}` : ''}`).join('\n');

    const systemInstruction = `매일유업 FS 영업 어시스턴트. 네이버 검색 결과로 매장을 분석하고 JSON만 응답하라.
분석 대상: 카페·베이커리·브런치·디저트·음식점 우선. 블로그 메뉴 키워드로 실제 업종 판단. 반드시 1개 매장만 분석.
응답 형식(JSON만, 코드블록 금지): {"tags":["3-5개"],"description":"영업공략 HTML 3-4문장(<strong>·<span style=\\"color:#0071e3;font-weight:700;\\"> 사용)","recommendedIndices":[정확히 3개],"signatureMenus":[{"menu":"","ingredients":"40자이내","maeilSolution":"40자이내"}]}
signatureMenus 최대 2개. 검색 결과 부족 시 업종 기반 추론.`;

    const prompt = `검색 매장: "${storeName}"\n\n[네이버 지역 검색]\n${JSON.stringify(localSummary, null, 2)}\n\n[블로그 리뷰]\n${JSON.stringify(blogSummary, null, 2)}${recipeSection}\n[제품 목록]\n${productList}\n\n분석:\n1. 태그 3-5개\n2. 영업공략 3-4문장\n3. 효과적 제품 정확히 3개(인덱스)\n4. 시그니처 메뉴 1-2개`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1500, topP: 0.95, topK: 40, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );

    if (!geminiRes.ok) throw new Error('Gemini API 호출 실패');

    const geminiData = await geminiRes.json();
    const candidate = geminiData.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('응답이 너무 길어 잘렸습니다.');

    const rawText = candidate?.content?.parts?.find((p: any) => !p.thought)?.text ?? candidate?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Gemini 응답이 비어있습니다.');

    let jsonStr = rawText.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1) jsonStr = jsonStr.substring(braceStart, braceEnd + 1);

    const analysis = JSON.parse(jsonStr);
    const recommendedItems = (analysis.recommendedIndices || []).filter((i: number) => i >= 0 && i < products.length).map((i: number) => products[i]);

    // 캐시 저장
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/store_analysis_cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ store_name: storeName.trim(), analysis, review_count: newReviewCount, cached_at: new Date().toISOString() }),
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true, tags: analysis.tags || [], description: analysis.description || '',
      items: recommendedItems, signatureMenus: analysis.signatureMenus || [],
      reviewLinks: filteredBlogItems.map((i: any) => i.link), isUpdate: isIncrementalUpdate, recipeMatched: recipeMatchCount,
      naverInfo: { localResults: localSummary.length, blogResults: blogSummary.length, newReviews: isIncrementalUpdate ? filteredBlogItems.length : blogSummary.length },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '분석 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
