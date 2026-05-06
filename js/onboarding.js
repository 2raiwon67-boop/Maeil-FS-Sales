/**
 * onboarding.js — FS MISO 이용 가이드
 * 첫 로그인 후 1회 슬라이드 모달 표시
 * localStorage 'fsmiso_onboarding_v1' 키로 표시 여부 저장
 * window.showOnboarding() — 언제든 다시 열기 (프로필 드롭다운에서 호출)
 */

(function () {
    const STORAGE_KEY = 'fsmiso_onboarding_v1';

    // Android Chrome PWA 설치 프롬프트 저장
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
    });

    // ── 슬라이드 데이터 ──
    const SLIDES = [
        {
            icon: '👋',
            title: 'FS MISO에 오신 걸\n환영합니다',
            desc: '매일유업 FS팀 영업 지원 대시보드입니다.\n인허가 현황부터 방문 관리까지 한 곳에서 확인하세요.',
            pwa: true,
        },
        {
            icon: '📤',
            title: '데이터 업로드',
            desc: '처음 시작은 데이터 업로드부터입니다.\nExcel 파일을 드래그&드롭하면 지도에 자동으로 표시됩니다.',
            steps: [
                '유형 선택 — 인허가 / 거래처 / 방문일지 / 담당자',
                'Excel 파일 드래그&드롭 또는 파일 선택',
                '미리보기 확인 후 업로드 버튼 클릭',
            ],
            link: { text: '데이터 관리 페이지 열기', href: 'upload.html' },
        },
        {
            icon: '🗺️',
            title: '인허가 지도',
            desc: '지도에서 거래처와 인허가 현황을 한눈에 확인하세요.',
            steps: [
                '마커 클릭 → 상세 정보 & AI 브리핑 확인',
                '좌측 필터로 지역 / 담당자 / 상태 조건 적용',
                '장바구니 담기 → 방문 동선 계획',
            ],
        },
        {
            icon: '📋',
            title: '방문일지',
            desc: '방문 기록을 저장하고 AI 브리핑으로 거래 기회를 파악하세요.',
            steps: [
                '거래처별 방문 타임라인 조회',
                '방문 내용 인라인 수정 (편집 버튼)',
                'AI 브리핑으로 거래 기회 & 주의사항 확인',
            ],
            link: { text: '방문일지 열기', href: '방문일지.html' },
        },
        {
            icon: '💰',
            title: '견적서',
            desc: '매장 분석 후 맞춤 견적서를 작성하고 PDF로 저장하세요.',
            steps: [
                '매장명 입력 → 네이버 분석 버튼',
                '상품 추가 및 수량 / 가격 입력',
                'PDF 저장으로 거래처에 제출',
            ],
            link: { text: '견적서 열기', href: 'proposal.html' },
        },
        {
            icon: '💰',
            title: '시작하기',
            desc: '이제 FS MISO를 자유롭게 사용해보세요!',
            steps: [],
            finish: true,
        },
    ];

    // ── 스타일 주입 (1회만) ──
    var _stylesInjected = false;
    function injectStyles() {
        if (_stylesInjected) return;
        _stylesInjected = true;
        var style = document.createElement('style');
        style.textContent = [
            '.ob-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;animation:ob-fadein .3s ease;}',
            '@keyframes ob-fadein{from{opacity:0}to{opacity:1}}',
            '.ob-modal{background:#1d1d1f;border-radius:20px;width:100%;max-width:420px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.55);animation:ob-slidein .35s cubic-bezier(.34,1.56,.64,1);}',
            '@keyframes ob-slidein{from{transform:translateY(28px) scale(.95);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}',
            '.ob-progress{display:flex;gap:5px;padding:20px 24px 0;}',
            '.ob-dot{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.13);transition:background .3s;}',
            '.ob-dot.ob-active{background:#0071e3;}',
            '.ob-dot.ob-done{background:rgba(0,113,227,.38);}',
            '.ob-body{flex:1;padding:26px 24px 18px;overflow-y:auto;}',
            '.ob-icon{font-size:46px;line-height:1;margin-bottom:14px;}',
            '.ob-title{font-size:21px;font-weight:700;color:#fff;line-height:1.3;margin:0 0 10px;white-space:pre-line;font-family:inherit;}',
            '.ob-desc{font-size:13.5px;color:rgba(255,255,255,.58);line-height:1.65;margin:0 0 18px;white-space:pre-line;}',
            '.ob-steps{list-style:none;padding:0;margin:0 0 18px;display:flex;flex-direction:column;gap:7px;}',
            '.ob-steps li{display:flex;align-items:flex-start;gap:10px;font-size:13px;color:rgba(255,255,255,.72);line-height:1.5;}',
            '.ob-num{min-width:20px;height:20px;border-radius:50%;background:rgba(0,113,227,.22);border:1px solid rgba(0,113,227,.45);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#4d9fe8;margin-top:1px;flex-shrink:0;}',
            '.ob-link{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#4d9fe8;text-decoration:none;margin-bottom:2px;}',
            '.ob-link:hover{text-decoration:underline;}',
            '.ob-pwa{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px 16px;margin-bottom:6px;}',
            '.ob-pwa-title{font-size:13px;font-weight:600;color:rgba(255,255,255,.85);margin:0 0 5px;}',
            '.ob-pwa-desc{font-size:12px;color:rgba(255,255,255,.48);margin:0 0 10px;line-height:1.55;}',
            '.ob-btn-install{background:#0071e3;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}',
            '.ob-btn-install:hover{background:#0077ed;}',
            '.ob-footer{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;border-top:1px solid rgba(255,255,255,.07);}',
            '.ob-skip{background:none;border:none;font-size:13px;color:rgba(255,255,255,.3);cursor:pointer;padding:0;font-family:inherit;}',
            '.ob-skip:hover{color:rgba(255,255,255,.55);}',
            '.ob-nav{display:flex;gap:8px;}',
            '.ob-btn-prev{background:rgba(255,255,255,.07);color:rgba(255,255,255,.65);border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
            '.ob-btn-prev:hover{background:rgba(255,255,255,.12);}',
            '.ob-btn-next{background:#0071e3;color:#fff;border:none;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
            '.ob-btn-next:hover{background:#0077ed;}',
            '.ob-anim-fwd{animation:ob-fwd .22s ease both;}',
            '.ob-anim-back{animation:ob-bwd .22s ease both;}',
            '@keyframes ob-fwd{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:translateX(0)}}',
            '@keyframes ob-bwd{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:translateX(0)}}',
            '@media(max-width:768px){',
            '.ob-overlay{align-items:flex-end;padding:0;}',
            '.ob-modal{max-width:100%;border-radius:20px 20px 0 0;max-height:82vh;animation:ob-sheet .32s cubic-bezier(.34,1.4,.64,1);}',
            '@keyframes ob-sheet{from{transform:translateY(100%);opacity:.5}to{transform:translateY(0);opacity:1}}',
            '.ob-progress{padding:14px 20px 0;}',
            '.ob-body{padding:18px 20px 12px;}',
            '.ob-icon{font-size:38px;margin-bottom:10px;}',
            '.ob-title{font-size:18px;}',
            '.ob-desc{font-size:13px;margin-bottom:14px;}',
            '.ob-steps{margin-bottom:14px;gap:8px;}',
            '.ob-steps li{font-size:13px;}',
            '.ob-num{min-width:22px;height:22px;font-size:11px;}',
            '.ob-footer{padding:12px 20px;padding-bottom:max(12px,env(safe-area-inset-bottom));}',
            '.ob-btn-next,.ob-btn-prev{padding:12px 20px;font-size:15px;border-radius:12px;}',
            '.ob-btn-next{flex:1;}',
            '}',
        ].join('');
        document.head.appendChild(style);
    }

    function isIOS() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    }

    function isInstalled() {
        return window.navigator.standalone === true ||
            window.matchMedia('(display-mode: standalone)').matches;
    }

    // ── 슬라이드 렌더 ──
    function renderSlide(modal, idx, dir) {
        var slide = SLIDES[idx];
        var body = modal.querySelector('.ob-body');

        // 진행 점
        modal.querySelectorAll('.ob-dot').forEach(function (dot, i) {
            dot.className = 'ob-dot' +
                (i === idx ? ' ob-active' : '') +
                (i < idx  ? ' ob-done'   : '');
        });

        // 내용 빌드
        var html = '<div class="ob-icon">' + slide.icon + '</div>';
        html += '<h2 class="ob-title">' + slide.title + '</h2>';
        html += '<p class="ob-desc">' + slide.desc + '</p>';

        if (slide.steps) {
            html += '<ul class="ob-steps">';
            slide.steps.forEach(function (s, i) {
                html += '<li><span class="ob-num">' + (i + 1) + '</span><span>' + s + '</span></li>';
            });
            html += '</ul>';
        }

        if (slide.pwa && !isInstalled()) {
            if (isIOS()) {
                html += '<div class="ob-pwa">'
                    + '<p class="ob-pwa-title">📱 홈 화면에 추가하기 (iOS)</p>'
                    + '<p class="ob-pwa-desc">Safari 하단의 공유 버튼(□↑)을 탭한 후<br>\'홈 화면에 추가\'를 선택하면 앱처럼 사용할 수 있습니다.</p>'
                    + '</div>';
            } else if (deferredPrompt) {
                html += '<div class="ob-pwa">'
                    + '<p class="ob-pwa-title">📱 앱으로 설치하기</p>'
                    + '<p class="ob-pwa-desc">홈 화면에 설치하면 더 빠르게 열고 오프라인에서도 사용할 수 있습니다.</p>'
                    + '<button class="ob-btn-install" id="ob-install-btn">홈 화면에 설치</button>'
                    + '</div>';
            }
        }

        if (slide.link) {
            html += '<a class="ob-link" href="' + slide.link.href + '">' + slide.link.text + ' →</a>';
        }

        var wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        wrapper.classList.add(dir === 'back' ? 'ob-anim-back' : 'ob-anim-fwd');
        body.innerHTML = '';
        body.appendChild(wrapper);

        // 설치 버튼 이벤트
        var installBtn = modal.querySelector('#ob-install-btn');
        if (installBtn) {
            installBtn.addEventListener('click', function () {
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then(function (result) {
                    if (result.outcome === 'accepted') {
                        installBtn.textContent = '✓ 설치 완료';
                        installBtn.disabled = true;
                        deferredPrompt = null;
                    }
                });
            });
        }

        // 이전 버튼 표시 여부
        modal.querySelector('.ob-btn-prev').style.display = idx === 0 ? 'none' : '';

        // 다음/완료 버튼 텍스트
        modal.querySelector('.ob-btn-next').textContent = slide.finish ? '시작하기 🎉' : '다음';
    }

    // ── 모달 생성 ──
    function createModal() {
        injectStyles();

        var overlay = document.createElement('div');
        overlay.className = 'ob-overlay';

        var dots = SLIDES.map(function (_, i) {
            return '<div class="ob-dot' + (i === 0 ? ' ob-active' : '') + '"></div>';
        }).join('');

        overlay.innerHTML = '<div class="ob-modal">'
            + '<div class="ob-progress">' + dots + '</div>'
            + '<div class="ob-body"></div>'
            + '<div class="ob-footer">'
            + '<button class="ob-skip">건너뛰기</button>'
            + '<div class="ob-nav">'
            + '<button class="ob-btn-prev" style="display:none">이전</button>'
            + '<button class="ob-btn-next">다음</button>'
            + '</div>'
            + '</div>'
            + '</div>';

        document.body.appendChild(overlay);

        var modal = overlay.querySelector('.ob-modal');
        var current = 0;

        function close() {
            localStorage.setItem(STORAGE_KEY, '1');
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity .2s ease';
            setTimeout(function () { overlay.remove(); }, 200);
        }

        renderSlide(modal, 0, 'fwd');

        modal.querySelector('.ob-btn-next').addEventListener('click', function () {
            if (current < SLIDES.length - 1) {
                current++;
                renderSlide(modal, current, 'fwd');
            } else {
                close();
            }
        });

        modal.querySelector('.ob-btn-prev').addEventListener('click', function () {
            if (current > 0) {
                current--;
                renderSlide(modal, current, 'back');
            }
        });

        modal.querySelector('.ob-skip').addEventListener('click', close);
    }

    // ── 공개 API ──
    window.showOnboarding = function () {
        if (document.querySelector('.ob-overlay')) return; // 이미 열려있으면 무시
        createModal();
    };

    // ── 첫 방문 자동 표시 (PC만) ──
    function isMobile() {
        return window.innerWidth <= 768;
    }

    function maybeShow() {
        if (!isMobile() && !localStorage.getItem(STORAGE_KEY)) {
            setTimeout(createModal, 1000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeShow);
    } else {
        maybeShow();
    }
})();
