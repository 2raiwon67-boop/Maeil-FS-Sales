// ============================================================
// Gemini AI 챗봇 모듈 (머신러닝 & 전략 분석 시스템 통합 버전)
// ============================================================

const GEMINI_CONFIG = {
    apiKey: '', // Server-side environment variable used instead
    model: 'gemini-2.5-flash',
    apiUrl: '/api/chat' // Proxied via Vercel Function
};

class GeminiChatbot {
    constructor() {
        this.conversationHistory = [];
        this.dataContext = {
            visitLogs: [],
            accounts: [],
            licenses: []
        };
    }

    // 데이터 컨텍스트 설정
    setContext(visitLogs, accounts, licenses) {
        this.dataContext.visitLogs = visitLogs;
        this.dataContext.accounts = accounts;
        this.dataContext.licenses = licenses;
    }

    // 키워드 추출
    extractKeywords(question) {
        const keywords = {
            manager: null,
            account: null,
            period: null,
            region: null
        };

        // 담당자 추출
        const managers = ['이도현', '김지훈', '부대석', '전성모', '김재찬'];
        for (const manager of managers) {
            if (question.includes(manager)) {
                keywords.manager = manager;
                break;
            }
        }

        // 기간 추출
        if (question.includes('오늘') || question.includes('금일')) {
            keywords.period = 'today';
        } else if (question.includes('이번 주') || question.includes('금주')) {
            keywords.period = 'thisWeek';
        } else if (question.includes('이번 달') || question.includes('금월')) {
            keywords.period = 'thisMonth';
        }

        // 지역 추출
        const regions = ['남양주', '가평', '고양', '파주', '포천', '인천', '강화', '김포', '부천', '연천'];
        for (const region of regions) {
            if (question.includes(region)) {
                keywords.region = region;
                break;
            }
        }

        return keywords;
    }

    // 관련 데이터 필터링
    filterRelevantData(question) {
        const keywords = this.extractKeywords(question);
        let relevantVisits = [...this.dataContext.visitLogs];

        // 담당자 필터
        if (keywords.manager) {
            relevantVisits = relevantVisits.filter(v =>
                v['작성자'] === keywords.manager ||
                v['참여자']?.includes(keywords.manager)
            );
        }

        // 기간 필터
        if (keywords.period) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            relevantVisits = relevantVisits.filter(v => {
                const visitDate = this.parseVisitDate(v['일정기간']);
                if (!visitDate) return false;

                if (keywords.period === 'today') {
                    return visitDate >= today;
                } else if (keywords.period === 'thisWeek') {
                    const weekStart = new Date(today);
                    weekStart.setDate(today.getDate() - today.getDay());
                    return visitDate >= weekStart;
                } else if (keywords.period === 'thisMonth') {
                    return visitDate.getMonth() === now.getMonth() &&
                        visitDate.getFullYear() === now.getFullYear();
                }
                return true;
            });
        }

        // 지역 필터
        if (keywords.region) {
            relevantVisits = relevantVisits.filter(v =>
                v['방문처(거래처)']?.includes(keywords.region)
            );
        }

        // 최신 100건만 반환 (토큰 제한)
        return relevantVisits.slice(0, 100);
    }

    // 날짜 파싱
    parseVisitDate(dateStr) {
        if (!dateStr) return null;
        try {
            // "2024-08-13 11:33~2024-08-13 12:33" 형식
            const startDate = dateStr.split('~')[0].trim();
            return new Date(startDate);
        } catch (e) {
            return null;
        }
    }

    // [New] Vercel Serverless Function Call
    async generate(prompt) {
        try {
            // 로컬 개발 환경 또는 Vercel 배포 환경 감지
            // 상대 경로 '/api/chat'을 사용하면 자동으로 현재 도메인의 API를 호출함
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`API Error: ${response.status} - ${errorData.error || 'Unknown Error'}`);
            }

            const data = await response.json();

            // Gemini API 응답 구조에 맞춰 텍스트 추출
            if (!data.candidates || !data.candidates[0]) {
                throw new Error('Invalid response format from Gemini API');
            }

            return data.candidates[0].content.parts[0].text;
        } catch (error) {
            console.error('Gemini Generate Error:', error);
            throw error;
        }
    }

    // Gemini API 호출 (Standard Chat Interface)
    async ask(question) {
        try {
            // 관련 데이터 필터링
            const relevantData = this.filterRelevantData(question);

            // 프롬프트 생성
            const prompt = this.buildPrompt(question, relevantData);

            // API 호출 (reuse generate logic internally, but buildPrompt wraps it)
            // But to be safe and keep context/history logic separate, let's call generate directly here.

            const answer = await this.generate(prompt);

            // 대화 히스토리 저장
            this.conversationHistory.push({
                question,
                answer,
                timestamp: new Date().toISOString()
            });

            return answer;

        } catch (error) {
            console.error('Gemini API Error:', error);
            return `죄송합니다. 오류가 발생했습니다.\n\n📌 문제: ${error.message}\n\n💡 해결방법:\n1. API 키가 유효한지 확인해주세요\n2. 인터넷 연결을 확인해주세요\n3. 잠시 후 다시 시도해주세요`;
        }
    }

    // 프롬프트 생성
    buildPrompt(question, relevantData) {
        return `당신은 경기북부 FS 영업팀의 AI 비서입니다.
아래 방문일지 데이터를 기반으로 질문에 핵심만 간단히 요약해서 답변해주세요.

# 방문일지 데이터 (최근 ${relevantData.length}건)
${JSON.stringify(relevantData.slice(0, 50), null, 2)}

# 사용자 질문
${question}

# 답변 규칙
1. **핵심만 간단하게 요약하세요.** (서술형보다는 개조식/글머리 기호 사용)
2. 날짜는 'MM/DD' 형태로 짧게 표기하세요. (예: 2024년 8월 13일 -> 8/13)
3. 불필요한 인사말이나 서론은 생략하고 본론부터 답변하세요.
4. 구체적인 데이터(담당자, 거래처명)는 필요할 때만 언급하세요.
5. 데이터가 없으면 "정보 없음"이라고만 하세요.
6. 이모지를 적절히 사용하여 가독성을 높이세요.

답변:`;
    }

    // 대화 히스토리 초기화
    clearHistory() {
        this.conversationHistory = [];
    }

    // 대화 히스토리 가져오기
    getHistory() {
        return this.conversationHistory;
    }
}

// ============================================================
// 1. 데이터 수집 및 전처리 모듈
// ============================================================
class DataCollector {
    constructor() {
        this.visitData = [];
        this.accountData = [];
        this.learningData = this.loadLearningData();
    }

    // Google Sheets 데이터 로드
    loadFromSheets(visitLogs, accounts) {
        this.visitData = visitLogs;
        this.accountData = accounts;
        console.log(`✅ 데이터 로드: 방문일지 ${visitLogs.length}건, 거래처 ${accounts.length}건`);
    }

    // 데이터 전처리
    preprocessData() {
        return {
            visits: this.cleanVisitData(),
            accounts: this.cleanAccountData(),
            aggregated: this.aggregateByRegion()
        };
    }

    cleanVisitData() {
        return this.visitData.map(v => ({
            date: this.parseDate(v['작성일']),
            manager: v['작성자'] || '미지정',
            accountCode: v['방문처(거래처코드)'] || '',
            accountName: v['방문처(거래처)'] || '',
            dealerCode: v['방문처(대리점코드)'] || '',
            dealerName: v['방문처(대리점)'] || '',
            content: v['내용'] || '',
            status: v['거래상태'] || '',
            success: this.isSuccess(v)
        }));
    }

    cleanAccountData() {
        return this.accountData.map(a => ({
            id: a['거래처ID'] || '',
            name: a['거래처명'] || '',
            manager: a['담당자명'] || '',
            address: a['주소'] || '',
            region: this.extractRegion(a['주소'])
        }));
    }

    aggregateByRegion() {
        const regions = {};
        const cleaned = this.cleanVisitData();

        cleaned.forEach(visit => {
            const account = this.accountData.find(a =>
                a['거래처명'] === visit.accountName
            );

            if (account && account['주소']) {
                const region = this.extractRegion(account['주소']);
                if (!regions[region]) {
                    regions[region] = {
                        totalVisits: 0,
                        successCount: 0,
                        managers: new Set(),
                        visits: []
                    };
                }

                regions[region].totalVisits++;
                if (visit.success) regions[region].successCount++;
                regions[region].managers.add(visit.manager);
                regions[region].visits.push(visit);
            }
        });

        // Set을 Array로 변환
        Object.keys(regions).forEach(region => {
            regions[region].managers = Array.from(regions[region].managers);
        });

        return regions;
    }

    parseDate(dateStr) {
        if (!dateStr) return null;
        try {
            return new Date(dateStr);
        } catch {
            return null;
        }
    }

    extractRegion(address) {
        if (!address) return '기타';

        const regions = ['남양주', '가평', '고양', '파주', '포천', '인천', '강화', '김포', '부천', '연천'];
        for (const region of regions) {
            if (address.includes(region)) return region;
        }
        return '기타';
    }

    isSuccess(visit) {
        const content = (visit['내용'] || '').toLowerCase();
        const status = (visit['거래상태'] || '').toLowerCase();

        const successKeywords = ['계약', '성공', '완료', '확정', '수주', '긍정'];
        return successKeywords.some(keyword =>
            content.includes(keyword) || status.includes(keyword)
        );
    }

    loadLearningData() {
        // [Browser Check] localStorage might not exist in Node environment
        if (typeof localStorage === 'undefined') {
            return {
                successPatterns: [],
                insights: {},
                predictions: []
            };
        }
        const saved = localStorage.getItem('ai_learning_data');
        return saved ? JSON.parse(saved) : {
            successPatterns: [],
            insights: {},
            predictions: []
        };
    }

    saveLearningData() {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('ai_learning_data', JSON.stringify(this.learningData));
        }
    }
}

// ============================================================
// 2. 패턴 분석 및 학습 엔진
// ============================================================
class PatternAnalyzer {
    constructor(dataCollector) {
        this.data = dataCollector;
    }

    // 성공 패턴 학습
    learnSuccessPatterns() {
        const cleaned = this.data.cleanVisitData();
        const successVisits = cleaned.filter(v => v.success);

        const patterns = {
            byManager: this.analyzeByManager(successVisits),
            byRegion: this.analyzeByRegion(successVisits),
            byTime: this.analyzeByTime(successVisits),
            keyPhrases: this.extractKeyPhrases(successVisits)
        };

        // 학습 데이터 저장
        this.data.learningData.successPatterns.push({
            timestamp: new Date().toISOString(),
            patterns,
            totalSuccess: successVisits.length,
            totalVisits: cleaned.length,
            conversionRate: (successVisits.length / cleaned.length * 100).toFixed(1)
        });

        this.data.saveLearningData();
        return patterns;
    }

    analyzeByManager(successVisits) {
        const managers = {};

        successVisits.forEach(visit => {
            if (!managers[visit.manager]) {
                managers[visit.manager] = {
                    count: 0,
                    avgLength: 0,
                    totalLength: 0,
                    regions: new Set()
                };
            }

            managers[visit.manager].count++;
            managers[visit.manager].totalLength += visit.content.length;

            // 지역 추출
            const account = this.data.accountData.find(a => a['거래처명'] === visit.accountName);
            if (account) {
                const region = this.data.extractRegion(account['주소']);
                managers[visit.manager].regions.add(region);
            }
        });

        // 평균 계산
        Object.keys(managers).forEach(manager => {
            managers[manager].avgLength = Math.round(
                managers[manager].totalLength / managers[manager].count
            );
            managers[manager].regions = Array.from(managers[manager].regions);
        });

        return managers;
    }

    analyzeByRegion(successVisits) {
        const aggregated = this.data.aggregateByRegion();
        const regions = {};

        Object.keys(aggregated).forEach(region => {
            const data = aggregated[region];
            regions[region] = {
                successRate: (data.successCount / data.totalVisits * 100).toFixed(1),
                totalVisits: data.totalVisits,
                successCount: data.successCount,
                topManagers: this.getTopManagersInRegion(region, data.visits)
            };
        });

        return regions;
    }

    analyzeByTime(successVisits) {
        const byMonth = {};
        const byDayOfWeek = [0, 0, 0, 0, 0, 0, 0];

        successVisits.forEach(visit => {
            if (visit.date) {
                const month = visit.date.getMonth();
                const day = visit.date.getDay();

                byMonth[month] = (byMonth[month] || 0) + 1;
                byDayOfWeek[day]++;
            }
        });

        return {
            byMonth,
            byDayOfWeek,
            bestMonth: Object.keys(byMonth).reduce((a, b) => byMonth[a] > byMonth[b] ? a : b, 0),
            bestDay: byDayOfWeek.indexOf(Math.max(...byDayOfWeek))
        };
    }

    extractKeyPhrases(successVisits) {
        const phrases = {};

        successVisits.forEach(visit => {
            const words = visit.content.split(/\s+/);
            words.forEach(word => {
                if (word.length >= 2) {
                    phrases[word] = (phrases[word] || 0) + 1;
                }
            });
        });

        // 상위 20개 키워드
        return Object.entries(phrases)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([word, count]) => ({ word, count }));
    }

    getTopManagersInRegion(region, visits) {
        const managerCounts = {};

        visits.filter(v => v.success).forEach(visit => {
            managerCounts[visit.manager] = (managerCounts[visit.manager] || 0) + 1;
        });

        return Object.entries(managerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, count]) => ({ name, count }));
    }
}

// ============================================================
// 3. 전략 분석 엔진
// ============================================================
class StrategyAnalyzer {
    constructor(dataCollector, patternAnalyzer) {
        this.data = dataCollector;
        this.patterns = patternAnalyzer;
    }

    // 지역별 종합 전략 분석
    analyzeRegionStrategy(region) {
        const aggregated = this.data.aggregateByRegion();
        const regionData = aggregated[region];

        if (!regionData) {
            return null;
        }

        return {
            overview: {
                region,
                totalVisits: regionData.totalVisits,
                successCount: regionData.successCount,
                conversionRate: (regionData.successCount / regionData.totalVisits * 100).toFixed(1),
                activeManagers: regionData.managers
            },
            opportunities: this.findOpportunities(region, regionData),
            risks: this.identifyRisks(region, regionData),
            recommendations: this.generateRecommendations(region, regionData),
            competitorInsights: this.analyzeCompetitors(regionData.visits)
        };
    }

    findOpportunities(region, regionData) {
        const opportunities = [];

        // 1. 전환율이 높은데 방문 횟수가 적은 경우
        const conversionRate = regionData.successCount / regionData.totalVisits;
        if (conversionRate > 0.7 && regionData.totalVisits < 10) {
            opportunities.push({
                type: 'high_potential',
                priority: 'high',
                description: `${region} 지역은 전환율 ${(conversionRate * 100).toFixed(0)}%로 매우 높으나 방문 횟수가 적습니다. 집중 공략 권장.`
            });
        }

        // 2. 최근 방문이 없는 고객
        const lastVisit = regionData.visits[regionData.visits.length - 1];
        if (lastVisit && lastVisit.date) {
            const daysSinceLastVisit = Math.floor((new Date() - lastVisit.date) / (1000 * 60 * 60 * 24));
            if (daysSinceLastVisit > 30) {
                opportunities.push({
                    type: 'follow_up',
                    priority: 'medium',
                    description: `마지막 방문 후 ${daysSinceLastVisit}일 경과. 재방문 필요.`
                });
            }
        }

        // 3. 신규 거래처 발굴 기회
        const uniqueAccounts = new Set(regionData.visits.map(v => v.accountName)).size;
        if (uniqueAccounts < 5) {
            opportunities.push({
                type: 'new_accounts',
                priority: 'medium',
                description: `현재 ${uniqueAccounts}개 거래처만 관리 중. 신규 거래처 발굴 여력 있음.`
            });
        }

        return opportunities;
    }

    identifyRisks(region, regionData) {
        const risks = [];
        const conversionRate = regionData.successCount / regionData.totalVisits;

        // 1. 낮은 전환율
        if (conversionRate < 0.3) {
            risks.push({
                type: 'low_conversion',
                severity: 'high',
                description: `전환율 ${(conversionRate * 100).toFixed(0)}%로 낮음. 영업 접근 방식 재검토 필요.`
            });
        }

        // 2. 담당자 편중
        if (regionData.managers.length === 1) {
            risks.push({
                type: 'single_point_failure',
                severity: 'medium',
                description: `1명의 담당자만 관리. 담당자 이탈 시 리스크 존재.`
            });
        }

        // 3. 성공 사례 부족
        if (regionData.successCount < 2) {
            risks.push({
                type: 'insufficient_success',
                severity: 'high',
                description: `성공 사례가 ${regionData.successCount}건으로 부족. 영업 전략 전면 재검토 필요.`
            });
        }

        return risks;
    }

    generateRecommendations(region, regionData) {
        const recommendations = [];

        // 성공한 담당자의 패턴 학습
        const topManager = regionData.managers[0];
        if (topManager) {
            const managerVisits = regionData.visits.filter(v => v.manager === topManager && v.success);
            if (managerVisits.length > 0) {
                recommendations.push({
                    category: 'best_practice',
                    action: `${topManager} 담당자의 성공 사례를 팀 전체와 공유`,
                    impact: 'high',
                    effort: 'low'
                });
            }
        }

        // 방문 빈도 조정
        if (regionData.totalVisits < 5) {
            recommendations.push({
                category: 'frequency',
                action: `${region} 지역 방문 빈도를 주 1회 이상으로 증가`,
                impact: 'medium',
                effort: 'medium'
            });
        }

        // 크로스 셀링 기회
        recommendations.push({
            category: 'cross_selling',
            action: '성공 거래처에 추가 제품 제안',
            impact: 'medium',
            effort: 'low'
        });

        return recommendations;
    }

    analyzeCompetitors(visits) {
        const competitors = ['남양', '서울우유', '연세우유', '빙그레'];
        const mentions = {};

        visits.forEach(visit => {
            competitors.forEach(comp => {
                if (visit.content.includes(comp)) {
                    mentions[comp] = (mentions[comp] || 0) + 1;
                }
            });
        });

        return {
            mentions,
            mostMentioned: Object.keys(mentions).sort((a, b) => mentions[b] - mentions[a])[0],
            totalMentions: Object.values(mentions).reduce((a, b) => a + b, 0)
        };
    }

    // 전체 영역 종합 분석
    analyzeOverall() {
        const aggregated = this.data.aggregateByRegion();
        const allRegions = Object.keys(aggregated);

        // 지역별 성과 랭킹
        const rankings = allRegions.map(region => {
            const data = aggregated[region];
            return {
                region,
                score: this.calculateRegionScore(data),
                conversionRate: (data.successCount / data.totalVisits * 100).toFixed(1),
                totalVisits: data.totalVisits
            };
        }).sort((a, b) => b.score - a.score);

        // 자원 배분 제안
        const resourceAllocation = this.suggestResourceAllocation(rankings);

        // 분기별 목표
        const quarterlyGoals = this.generateQuarterlyGoals(rankings);

        return {
            rankings,
            resourceAllocation,
            quarterlyGoals,
            keyInsights: this.extractKeyInsights(aggregated)
        };
    }

    calculateRegionScore(data) {
        const conversionRate = data.successCount / data.totalVisits;
        const activityScore = Math.min(data.totalVisits / 10, 1); // 10회 이상 방문 시 만점
        const managerDiversity = Math.min(data.managers.length / 3, 1); // 3명 이상 시 만점

        return (conversionRate * 50) + (activityScore * 30) + (managerDiversity * 20);
    }

    suggestResourceAllocation(rankings) {
        return {
            'S급 (최우선)': rankings.filter(r => r.score >= 70).map(r => r.region),
            'A급 (중점관리)': rankings.filter(r => r.score >= 40 && r.score < 70).map(r => r.region),
            'B급 (안정유지)': rankings.filter(r => r.score < 40).map(r => r.region)
        };
    }

    generateQuarterlyGoals(rankings) {
        const topRegions = rankings.slice(0, 3);
        const struggling = rankings.slice(-2);

        return {
            Q1: [
                `S급 지역 (${topRegions.map(r => r.region).join(', ')}) 매출 20% 증대`,
                `B급 지역 (${struggling.map(r => r.region).join(', ')}) 전환율 개선`
            ],
            Q2: [
                '신규 거래처 10개 이상 확보',
                '전체 평균 전환율 50% 달성'
            ],
            'Q3-Q4': [
                '지역별 담당자 2명 이상 배치',
                '경쟁사 대응 전략 수립 및 실행'
            ]
        };
    }

    extractKeyInsights(aggregated) {
        const insights = [];
        const regions = Object.keys(aggregated);

        // 전체 전환율
        const totalVisits = regions.reduce((sum, r) => sum + aggregated[r].totalVisits, 0);
        const totalSuccess = regions.reduce((sum, r) => sum + aggregated[r].successCount, 0);
        const overallRate = (totalSuccess / totalVisits * 100).toFixed(1);

        insights.push(`전체 전환율: ${overallRate}%`);

        // 가장 활발한 지역
        const mostActive = regions.sort((a, b) =>
            aggregated[b].totalVisits - aggregated[a].totalVisits
        )[0];
        insights.push(`가장 활발한 지역: ${mostActive} (${aggregated[mostActive].totalVisits}회 방문)`);

        // 가장 성공적인 지역
        const mostSuccessful = regions.sort((a, b) => {
            const rateA = aggregated[a].successCount / aggregated[a].totalVisits;
            const rateB = aggregated[b].successCount / aggregated[b].totalVisits;
            return rateB - rateA;
        })[0];

        const successRate = (aggregated[mostSuccessful].successCount / aggregated[mostSuccessful].totalVisits * 100).toFixed(1);
        insights.push(`가장 성공적인 지역: ${mostSuccessful} (전환율 ${successRate}%)`);

        return insights;
    }
}

// ============================================================
// 4. Gemini AI 통합 시스템
// ============================================================
class AIAssistant {
    constructor(geminiBot, dataCollector, patternAnalyzer, strategyAnalyzer) {
        this.bot = geminiBot;
        this.data = dataCollector;
        this.patterns = patternAnalyzer;
        this.strategy = strategyAnalyzer;
    }

    // AI 학습 프롬프트 생성
    async generateStrategicInsights(region) {
        const analysis = this.strategy.analyzeRegionStrategy(region);
        const learnedPatterns = this.patterns.learnSuccessPatterns();

        const prompt = `
당신은 경기북부 FS의 수석 영업 전략가입니다.

# 📊 ${region} 지역 데이터 분석

## 현황
- 총 방문: ${analysis.overview.totalVisits}회
- 성공: ${analysis.overview.successCount}건
- 전환율: ${analysis.overview.conversionRate}%
- 담당자: ${analysis.overview.activeManagers.join(', ')}

## 기회 요인
${JSON.stringify(analysis.opportunities, null, 2)}

## 리스크 요인
${JSON.stringify(analysis.risks, null, 2)}

## 기존 추천사항
${JSON.stringify(analysis.recommendations, null, 2)}

## 학습된 성공 패턴
${JSON.stringify(learnedPatterns, null, 2)}

# 🎯 미션
위 데이터를 기반으로 **실행 가능한 전략**을 다음 형식으로 제시하세요:

## 1. 핵심 진단 (3줄 요약)

## 2. 즉시 실행 항목 (Quick Wins)
- [ ] 액션1
- [ ] 액션2
- [ ] 액션3

## 3. 중장기 전략 (3개월)

## 4. 예상 성과
- KPI 목표
- 달성 시나리오

## 5. 리스크 대응

답변 형식: 경영진 보고서 수준, 구체적 수치 포함
`;

        // [MODIFIED] Use generate instead of ask to avoid Persona wrapping
        return await this.bot.generate(prompt);
    }

    async generateOverallStrategy() {
        const overall = this.strategy.analyzeOverall();

        const prompt = `
당신은 경기북부 FS의 전략 기획 이사입니다.

# 📈 경기북부 전체 영업 현황

## 지역별 랭킹
${JSON.stringify(overall.rankings, null, 2)}

## 자원 배분 제안
${JSON.stringify(overall.resourceAllocation, null, 2)}

## 핵심 인사이트
${overall.keyInsights.join('\n')}

# 🎯 미션
경영진에게 보고할 **분기별 영업 전략**을 수립하세요:

## Executive Summary
- 현 상황 진단 (SWOT)
- 핵심 성과 지표

## 지역별 전략
- S급: 공격적 확장
- A급: 안정적 성장
- B급: 체질 개선

## 분기별 로드맵
- Q1 (즉시): 
- Q2 (확장):
- Q3-Q4 (장기):

## 의사결정 포인트
- 경영진 승인 필요 사항
- 팀 자율 실행 가능 사항

## 예산 및 인력 배분

답변 형식: 이사회 보고서 수준
`;

        // [MODIFIED] Use generate instead of ask
        return await this.bot.generate(prompt);
    }
}

// ============================================================
// 5. 전역 인스턴스 및 초기화
// ============================================================

// 전역 변수
const geminiBot = new GeminiChatbot(); // Initialize Chatbot First

let aiSystem = {
    collector: null,
    patternAnalyzer: null,
    strategyAnalyzer: null,
    assistant: null,
    isInitialized: false
};

// AI 시스템 초기화
function initializeAISystem(visitLogs, accounts) {
    console.log('🚀 AI 시스템 초기화 시작...');

    aiSystem.collector = new DataCollector();
    aiSystem.collector.loadFromSheets(visitLogs, accounts);

    aiSystem.patternAnalyzer = new PatternAnalyzer(aiSystem.collector);
    aiSystem.strategyAnalyzer = new StrategyAnalyzer(aiSystem.collector, aiSystem.patternAnalyzer);
    aiSystem.assistant = new AIAssistant(
        geminiBot,
        aiSystem.collector,
        aiSystem.patternAnalyzer,
        aiSystem.strategyAnalyzer
    );

    aiSystem.isInitialized = true;
    console.log('✅ AI 시스템 초기화 완료');

    // 초기 학습
    aiSystem.patternAnalyzer.learnSuccessPatterns();
    console.log('✅ 성공 패턴 학습 완료');

    return aiSystem;
}

// 학습 상태 조회
function getAILearningStatus() {
    if (!aiSystem.isInitialized) {
        return {
            status: 'not_initialized',
            message: '시스템이 초기화되지 않았습니다.'
        };
    }

    const learningData = aiSystem.collector.learningData;
    return {
        status: 'active',
        totalPatterns: learningData.successPatterns.length,
        lastUpdate: learningData.successPatterns.length > 0
            ? learningData.successPatterns[learningData.successPatterns.length - 1].timestamp
            : null,
        insights: Object.keys(learningData.insights).length,
        message: `${learningData.successPatterns.length}개 패턴 학습 완료`
    };
}

// 내보내기
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GeminiChatbot,
        DataCollector,
        PatternAnalyzer,
        StrategyAnalyzer,
        AIAssistant,
        initializeAISystem,
        getAILearningStatus,
        aiSystem
    };
}
// [Existing Code] ... (Keep GeminiChatbot class as is)

// ============================================================
// 5. UI 통합 모듈 (Shared UI Logic)
// ============================================================
function setupAIUI() {
    // 1. 모달 HTML 주입
    const modalHTML = `
    <div id="aiStrategyModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; justify-content: center; align-items: center;">
        <div style="background: white; width: 90%; max-width: 600px; height: 80vh; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.2);">
            
            <!-- Header -->
            <div style="padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fbfbfd;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">🤖</span>
                    <div>
                        <div style="font-weight: 700; font-size: 16px;">AI 영업 전략가</div>
                        <div style="font-size: 12px; color: #666;">Data-Driven Sales Strategy</div>
                    </div>
                </div>
                <button onclick="closeAIStrategyModal()" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999;">&times;</button>
            </div>

            <!-- Chat Area -->
            <div id="aiChatContainer" style="flex: 1; padding: 20px; overflow-y: auto; background: #fff;">
                <!-- Welcome Message -->
                <div style="display: flex; gap: 12px; margin-bottom: 20px;">
                    <div style="width: 36px; height: 36px; background: #eee; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px;">🤖</div>
                    <div style="background: #f5f5f7; padding: 12px 16px; border-radius: 0 16px 16px 16px; max-width: 80%; font-size: 14px; line-height: 1.5; color: #1d1d1f;">
                        안녕하세요! <strong>수석 영업 전략가(AI)</strong>입니다.<br>
                        현재까지의 방문 데이터를 분석하여 <strong>최적의 영업 전략</strong>을 제안해 드립니다.<br><br>
                        👇 <strong>아래 버튼을 눌러보세요!</strong>
                    </div>
                </div>
            </div>

            <!-- Quick Actions -->
            <div style="padding: 15px 20px; border-top: 1px solid #eee; background: #fff; display: flex; gap: 10px; overflow-x: auto;">
                <button onclick="askAIStrategy('이번 주 공략 지역 추천해줘')" style="flex: 0 0 auto; padding: 8px 16px; background: #e3f2fd; color: #0071e3; border: 1px solid #0071e3; border-radius: 20px; font-size: 13px; cursor: pointer; font-weight: 500;">
                    📍 금주 공략 지역
                </button>
                <button onclick="askAIStrategy('미방문 거래처 리스트 뽑아줘')" style="flex: 0 0 auto; padding: 8px 16px; background: #f5f5f7; color: #333; border: 1px solid #ddd; border-radius: 20px; font-size: 13px; cursor: pointer;">
                    📋 미방문 거래처 확인
                </button>
                <button onclick="askAIStrategy('경쟁사 동향 요약해줘')" style="flex: 0 0 auto; padding: 8px 16px; background: #fff0f0; color: #d70015; border: 1px solid #ffb3b3; border-radius: 20px; font-size: 13px; cursor: pointer;">
                    🚨 경쟁사 동향
                </button>
            </div>

            <!-- Input Area -->
            <div style="padding: 20px; border-top: 1px solid #eee; display: flex; gap: 10px; background: #fff;">
                <input type="text" id="aiInput" placeholder="무엇이든 물어보세요..." onkeypress="if(event.key==='Enter') sendAIMessage()" 
                    style="flex: 1; padding: 12px; border: 1px solid #d2d2d7; border-radius: 12px; font-size: 14px; outline: none;">
                <button onclick="sendAIMessage()" style="background: #0071e3; color: white; border: none; padding: 0 20px; border-radius: 12px; font-weight: 600; cursor: pointer;">
                    전송
                </button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 2. 챗봇 인스턴스 초기화 (전역)
    window.chatbot = new GeminiChatbot();

    // 데이터를 로드하는 로직은 각 페이지별로 다를 수 있으므로, 
    // 페이지 로드 시 window.visitData 등을 확인하여 주입
    if (window.visitData) {
        window.chatbot.setContext(window.visitData, [], []);
    }
}

// Global Functions
window.openAIStrategyModal = function () {
    document.getElementById('aiStrategyModal').style.display = 'flex';
    // 모달 열릴 때 포커스
    setTimeout(() => document.getElementById('aiInput').focus(), 100);
};

window.closeAIStrategyModal = function () {
    document.getElementById('aiStrategyModal').style.display = 'none';
};

window.askAIStrategy = function (question) {
    document.getElementById('aiInput').value = question;
    sendAIMessage();
};

window.sendAIMessage = async function () {
    const input = document.getElementById('aiInput');
    const msg = input.value.trim();
    if (!msg) return;

    // 사용자 메시지 표시
    appendAIMessage('user', msg);
    input.value = '';

    // 로딩 표시
    const loadingId = appendAIMessage('ai', '🧠 데이터 분석 중...', true);

    try {
        // AI 답변 호출
        const answer = await window.chatbot.ask(msg);

        // 로딩 제거 및 답변 표시
        removeChatMessage(loadingId);
        appendAIMessage('ai', answer);
    } catch (e) {
        removeChatMessage(loadingId);
        appendAIMessage('ai', '죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        console.error(e);
    }
};

function appendAIMessage(role, text, isLoading = false) {
    const container = document.getElementById('aiChatContainer');
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.gap = '12px';
    div.style.marginBottom = '20px';
    div.id = isLoading ? 'ai-loading-' + Date.now() : '';

    if (role === 'user') {
        div.style.flexDirection = 'row-reverse';
        div.innerHTML = `
            <div style="background: #0071e3; color: white; padding: 12px 16px; border-radius: 16px 16px 0 16px; max-width: 80%; font-size: 14px; line-height: 1.5;">
                ${text}
            </div>
        `;
    } else {
        const icon = isLoading ? '⏳' : '🤖';
        const bg = isLoading ? '#f5f5f7' : '#f5f5f7'; // Loading state styling
        div.innerHTML = `
            <div style="width: 36px; height: 36px; background: #eee; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px;">${icon}</div>
            <div style="background: ${bg}; padding: 12px 16px; border-radius: 0 16px 16px 16px; max-width: 80%; font-size: 14px; line-height: 1.5; color: #1d1d1f; white-space: pre-wrap;">${text}</div>
        `;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div.id;
}

function removeChatMessage(id) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.remove();
}

// 자동 초기화
document.addEventListener('DOMContentLoaded', setupAIUI);
