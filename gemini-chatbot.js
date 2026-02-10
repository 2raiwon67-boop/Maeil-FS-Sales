// ============================================================
// Gemini AI 챗봇 모듈
// ============================================================

const GEMINI_CONFIG = {
    apiKey: 'AIzaSyCQCe5f08gAUR29891Vrf8Xy4WlzKU-X60',
    model: 'gemini-pro',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
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
        const regions = ['남양주', '가평', '고양', '파주', '포천', '인천', '강화', '김포', '부천'];
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

    // Gemini API 호출 (스마트 모델 전환 적용)
    async ask(question) {
        try {
            this.lastQuestion = question;

            // 관련 데이터 필터링
            const relevantData = this.filterRelevantData(question);

            // 프롬프트 생성
            const prompt = this.buildPrompt(question, relevantData);

            // 1차 시도: 효율적인 Gemini 1.5 Flash
            try {
                console.log('Trying Gemini 1.5 Flash...');
                return await this.callGeminiAPI('gemini-1.5-flash', prompt);
            } catch (error) {
                // 404(Not Found) 또는 400(Invalid) 에러 발생 시
                if (error.message.includes('404') || error.message.includes('400')) {
                    console.warn('Gemini 1.5 Flash failed, switching to Gemini Pro...', error);
                    // 2차 시도: 안정적인 Gemini Pro
                    return await this.callGeminiAPI('gemini-pro', prompt);
                }
                throw error; // 다른 에러는 그대로 전파
            }

        } catch (error) {
            console.error('Gemini API Error:', error);
            // 에러 메시지 사용자 친화적으로 변환
            let userMsg = `죄송합니다. 오류가 발생했습니다: ${error.message}`;
            if (error.message.includes('404')) userMsg += '\n(모델을 찾을 수 없습니다)';
            if (error.message.includes('429')) userMsg += '\n(요청이 너무 많습니다)';
            return userMsg;
        }
    }

    async callGeminiAPI(model, prompt) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_CONFIG.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API Error: ${response.status} ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const answer = data.candidates[0].content.parts[0].text;

        // 대화 히스토리 저장
        this.conversationHistory.push({
            question: this.lastQuestion, // 저장된 질문 사용
            answer,
            timestamp: new Date().toISOString()
        });

        return answer;
    }

    // 프롬프트 생성
    buildPrompt(question, relevantData) {
        return `당신은 경기북부 FS 영업팀의 AI 비서입니다.
아래 방문일지 데이터를 기반으로 질문에 답변해주세요.

# 방문일지 데이터 (최근 ${relevantData.length}건)
${JSON.stringify(relevantData.slice(0, 50), null, 2)}

# 사용자 질문
${question}

# 답변 규칙
1. 친절하고 전문적으로 답변하세요
2. 구체적인 데이터를 인용하세요 (날짜, 담당자, 거래처명)
3. 필요시 표 형식이나 목록으로 정리하세요
4. 데이터가 없으면 "해당 정보를 찾을 수 없습니다"라고 답변하세요
5. 한국어로 답변하세요
6. 이모지를 적절히 사용하여 가독성을 높이세요

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

// 전역 인스턴스
const geminiBot = new GeminiChatbot();
