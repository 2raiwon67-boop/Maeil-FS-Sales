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
    const NAV_ITEMS = [
        { href: 'index.html',    label: '인허가' },
        { href: '방문일지.html', label: '방문일지' },
        { href: 'proposal.html', label: '견적서' },
        { href: 'report.html',   label: '월별 보고서' },
        { href: 'upload.html',   label: '데이터 관리' },
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
            return '<a href="' + item.href + '" class="nav-link' + active + '">' + item.label + '</a>';
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
            + '<span id="userNameDisplay" style="color: #a1a1a6; font-size: 13px; margin-right: 14px;"></span>'
            + adminLink
            + '<a href="#" id="logoutBtn" class="nav-link" style="color: #ff6b6b; margin: 0;">로그아웃</a>'
            + '</div>'
            + '</nav>';
    }

    var placeholder = document.getElementById('nav-placeholder');
    if (placeholder) {
        placeholder.outerHTML = buildNav();
    }
})();
