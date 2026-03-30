/**
 * nav-component.js — FS MISO 공통 네비게이션
 *
 * 사용법:
 *   <div id="nav-placeholder"></div>
 *   <script>
 *       // 옵션 (필요한 경우에만)
 *       window._NAV_OPTIONS = {
 *           showAdmin: true,   // 관리자 링크 포함 여부 (index.html만 true)
 *           noPrint: true,     // no-print 클래스 추가 여부 (proposal.html만 true)
 *           extraActions: '',  // nav-actions 좌측에 추가할 HTML
 *       };
 *   </script>
 *   <script src="nav-component.js"></script>
 */

(function () {
    // ── 색각 보정 모드 적용 (페이지 로드 즉시) ──
    if (localStorage.getItem('fs_colorblind_mode') === 'true') {
        document.body.classList.add('colorblind');
    }

    const NAV_ITEMS = [
        { href: 'index.html',    label: '거래처' },
        { href: '방문일지.html', label: '방문일지' },
        { href: 'proposal.html', label: '견적서' },
        { href: 'report.html',   label: '월별 보고서', mobileHide: true },
        { href: 'upload.html',   label: '데이터 관리', mobileHide: true },
    ];

    function getCurrentPage() {
        const parts = window.location.pathname.split('/');
        const file = parts[parts.length - 1];
        if (!file || file === '') return 'index.html';
        return decodeURIComponent(file);
    }

    function buildNav() {
        const opts = window._NAV_OPTIONS || {};
        const currentPage = getCurrentPage();
        const navClass = 'nav-bar' + (opts.noPrint ? ' no-print' : '');

        const links = NAV_ITEMS.map(function (item) {
            const active = currentPage === item.href ? ' active' : '';
            const hideClass = item.mobileHide ? ' nav-hide-mobile' : '';
            return '<a href="' + item.href + '" class="nav-link' + active + hideClass + '">' + item.label + '</a>';
        }).join('');

        const extraActions = opts.extraActions || '';

        const adminLink = opts.showAdmin
            ? '<a href="admin.html" id="adminPanelLink" class="nav-link" style="display:none; margin-right:8px; color:#f5c542;">관리자</a>'
            : '';

        return '<nav class="' + navClass + '">'
            + '<div style="display: flex; align-items: center;">'
            + '<div class="nav-logo">FS MISO</div>'
            + '<div class="nav-menu">' + links + '</div>'
            + '</div>'
            + '<div class="nav-actions" style="display: flex; align-items: center;">'
            + extraActions
            + '<span id="userNameDisplay" class="nav-hide-mobile" onclick="window._pcToggleProfile(event)" style="color:#a1a1a6;font-size:13px;margin-right:14px;cursor:pointer;" title="프로필"></span>'
            + adminLink
            + '<a href="#" id="logoutBtn" class="nav-link" style="display:none;">로그아웃</a>'
            + '</div>'
            + '</nav>';
    }

    var placeholder = document.getElementById('nav-placeholder');
    if (placeholder) {
        placeholder.outerHTML = buildNav();
    }

    // ── 모바일 하단 탭 바 ──
    var MOB_TABS = [
        { href: 'index.html',    label: '거래처',  icon: '🏠' },
        { href: '방문일지.html', label: '방문일지', icon: '📋' },
        { href: 'proposal.html', label: '견적서',  icon: '📄' },
    ];

    function buildMobTabBar() {
        var currentPage = getCurrentPage();

        var tabs = MOB_TABS.map(function (tab) {
            var active = currentPage === tab.href ? ' active' : '';
            // 클릭 즉시 active 추가로 체감 반응속도 개선
            var onClick = currentPage !== tab.href
                ? ' onclick="document.querySelectorAll(\'.mob-tab-item\').forEach(function(el){el.classList.remove(\'active\')});this.classList.add(\'active\')"'
                : '';
            return '<a href="' + tab.href + '" class="mob-tab-item' + active + '"' + onClick + '>'
                + '<span class="mob-tab-icon">' + tab.icon + '</span>'
                + '<span class="mob-tab-label">' + tab.label + '</span>'
                + '</a>';
        }).join('');

        var profileActive = '';  // 프로필은 탭 페이지가 아니므로 active 없음

        var profileTab = '<button class="mob-tab-item' + profileActive + '" id="mobProfileTab" onclick="window._mobToggleProfile()">'
            + '<span class="mob-tab-icon">👤</span>'
            + '<span class="mob-tab-label">프로필</span>'
            + '</button>';

        var tabBar = '<div class="mob-tab-bar" id="mobTabBar">' + tabs + profileTab + '</div>';

        var popup = '<div class="mob-profile-backdrop" id="mobProfileBackdrop" onclick="window._mobCloseProfile()"></div>'
            + '<div class="mob-profile-popup" id="mobProfilePopup">'
            + '<div class="mob-profile-name" id="mobProfileName">로딩 중...</div>'
            + '<button class="mob-profile-plan-btn" onclick="window._mobOpenMyPlans()">📅 내 일정</button>'
            + '<button class="mob-profile-plan-btn" onclick="window._mobCloseProfile();window._openSettings()">⚙️ 설정</button>'
            + '<button class="mob-profile-plan-btn" onclick="window._mobCloseProfile();window.showOnboarding&&window.showOnboarding()">📖 이용 가이드</button>'
            + '<button class="mob-profile-logout-btn" onclick="window._mobDoLogout()">로그아웃</button>'
            + '</div>';

        return tabBar + popup;
    }

    // ── PC 프로필 드롭다운 ──
    var pcProfileHTML = '<div class="pc-profile-backdrop" id="pcProfileBackdrop" onclick="window._pcCloseProfile()"></div>'
        + '<div class="pc-profile-dropdown" id="pcProfileDropdown">'
        + '<button class="pc-profile-btn" onclick="window._pcCloseProfile();window._mobOpenMyPlans()">📅 내 일정</button>'
        + '<button class="pc-profile-btn" onclick="window._pcCloseProfile();window._openSettings()">⚙️ 설정</button>'
        + '<button class="pc-profile-btn" onclick="window._pcCloseProfile();window.showOnboarding&&window.showOnboarding()">📖 이용 가이드</button>'
        + '<button class="pc-profile-btn logout" onclick="window._mobDoLogout()">로그아웃</button>'
        + '</div>';

    // ── 설정 모달 ──
    var settingsHTML = '<div class="settings-backdrop" id="settingsBackdrop" onclick="window._closeSettings()"></div>'
        + '<div class="settings-modal" id="settingsModal">'
        + '<div class="settings-modal-title">설정</div>'
        + '<div class="settings-row">'
        + '<div class="settings-row-info">'
        + '<span class="settings-row-label">색각 보정 모드</span>'
        + '<span class="settings-row-desc">적녹색맹을 위한 색상 조정</span>'
        + '</div>'
        + '<label class="miso-toggle"><input type="checkbox" id="colorblindToggle"><span class="miso-toggle-slider"></span></label>'
        + '</div>'
        + '<button class="settings-close-btn" onclick="window._closeSettings()">닫기</button>'
        + '</div>';

    document.body.insertAdjacentHTML('beforeend', buildMobTabBar() + pcProfileHTML + settingsHTML);

    // 설정 토글 이벤트 연결
    var colorblindToggle = document.getElementById('colorblindToggle');
    if (colorblindToggle) {
        colorblindToggle.checked = localStorage.getItem('fs_colorblind_mode') === 'true';
        colorblindToggle.addEventListener('change', function () {
            const enabled = this.checked;
            localStorage.setItem('fs_colorblind_mode', enabled ? 'true' : 'false');
            document.body.classList.toggle('colorblind', enabled);
            // index.html 마커 색상 즉시 갱신 (새로고침 없이)
            if (typeof window.updateMap === 'function') window.updateMap();
        });
    }

    // ── PC 프로필 드롭다운 함수 ──
    window._pcToggleProfile = function (e) {
        if (e) e.stopPropagation();
        var dropdown = document.getElementById('pcProfileDropdown');
        var backdrop = document.getElementById('pcProfileBackdrop');
        if (!dropdown) return;
        var isOpen = dropdown.classList.contains('open');
        if (isOpen) {
            dropdown.classList.remove('open');
            backdrop.classList.remove('open');
        } else {
            dropdown.classList.add('open');
            backdrop.classList.add('open');
        }
    };

    window._pcCloseProfile = function () {
        var dropdown = document.getElementById('pcProfileDropdown');
        var backdrop = document.getElementById('pcProfileBackdrop');
        if (dropdown) dropdown.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
    };

    // ── 설정 모달 함수 ──
    window._openSettings = function () {
        var modal = document.getElementById('settingsModal');
        var backdrop = document.getElementById('settingsBackdrop');
        var toggle = document.getElementById('colorblindToggle');
        if (!modal) return;
        if (toggle) toggle.checked = localStorage.getItem('fs_colorblind_mode') === 'true';
        modal.classList.add('open');
        backdrop.classList.add('open');
    };

    window._closeSettings = function () {
        var modal = document.getElementById('settingsModal');
        var backdrop = document.getElementById('settingsBackdrop');
        if (modal) modal.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
    };

    // 프로필 팝업 토글 함수
    window._mobToggleProfile = function () {
        var popup = document.getElementById('mobProfilePopup');
        var backdrop = document.getElementById('mobProfileBackdrop');
        if (!popup) return;
        var isOpen = popup.classList.contains('open');
        if (isOpen) {
            popup.classList.remove('open');
            backdrop.classList.remove('open');
        } else {
            // 사용자 이름 동기화 (nav-bar의 #userNameDisplay 값 활용)
            var nameEl = document.getElementById('userNameDisplay');
            var mobName = document.getElementById('mobProfileName');
            if (mobName && nameEl && nameEl.innerText) {
                mobName.textContent = nameEl.innerText;
            }
            popup.classList.add('open');
            backdrop.classList.add('open');
        }
    };

    window._mobCloseProfile = function () {
        var popup = document.getElementById('mobProfilePopup');
        var backdrop = document.getElementById('mobProfileBackdrop');
        if (popup) popup.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
    };

    window._mobDoLogout = function () {
        window._mobCloseProfile();
        var btn = document.getElementById('logoutBtn');
        if (btn) btn.click();
    };

    window._mobOpenMyPlans = function () {
        window._mobCloseProfile();
        if (typeof window._openMyPlans === 'function') window._openMyPlans();
    };
})();

/* ============================================================
   window.showToast(message, type, duration)
   모든 페이지에서 사용 가능한 공통 토스트 알림

   type:     'default' | 'success' | 'error' | 'warning'
   duration: ms (기본 3000)

   예시:
     showToast('저장되었습니다', 'success');
     showToast('오류가 발생했습니다', 'error', 5000);
   ============================================================ */
window.showToast = (function () {
    function getContainer() {
        var el = document.getElementById('miso-toast-container');
        if (!el) {
            el = document.createElement('div');
            el.id = 'miso-toast-container';
            el.className = 'miso-toast-container';
            document.body.appendChild(el);
        }
        return el;
    }

    return function showToast(message, type, duration) {
        type     = type     || 'default';
        duration = duration || 3000;

        var container = getContainer();
        var toast = document.createElement('div');
        toast.className = 'miso-toast' + (type !== 'default' ? ' ' + type : '');
        toast.textContent = message;
        container.appendChild(toast);

        // 다음 프레임에서 show 클래스 추가 (CSS transition 트리거)
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                toast.classList.add('show');
            });
        });

        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 250);
        }, duration);
    };
}());
