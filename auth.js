
// ============================================================
// Supabase Auth Configuration
// ============================================================
const SUPABASE_URL = 'https://hcqbmilmldeeuydtrayx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcWJtaWxtbGRlZXV5ZHRyYXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTQ0ODIsImV4cCI6MjA4NjM5MDQ4Mn0.vKYyZQmWOewxYm3KkMM9AsE5GZ3OgZ47N6rs89TF3Mg';

// Supabase 클라이언트 초기화 (전역 supabase 객체 확인)
let client;
try {
    if (typeof supabase !== 'undefined') {
        client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        console.error('Supabase library not loaded!');
    }
} catch (e) {
    console.error('Supabase init error:', e);
}

// ============================================================
// Auth Functions
// ============================================================

// 1. 로그인 여부 확인 및 리다이렉트
async function checkAuth() {
    const path = window.location.pathname;
    const isLoginPage   = path.includes('login.html')   || path.endsWith('/login');
    const isPendingPage = path.includes('pending.html');
    const isAdminPage   = path.includes('admin.html');

    // 관리자 우회 체크
    if (localStorage.getItem('fs_admin_access') === 'true') {
        if (isLoginPage) window.location.href = 'index.html';
        return { user: { email: 'admin@maeil.com', user_metadata: { full_name: '관리자', approved: true } } };
    }

    if (!client) return null;

    const { data: { session } } = await client.auth.getSession();

    // 세션 없음 → 로그인 페이지로
    if (!session && !isLoginPage) {
        window.location.href = 'login.html';
        return null;
    }

    if (session) {
        const meta = session.user.user_metadata || {};
        // approved가 명시적으로 false인 경우만 대기 처리 (기존 계정은 undefined → 통과)
        const isPending = meta.approved === false;

        if (isPending && !isPendingPage && !isLoginPage) {
            window.location.href = 'pending.html';
            return null;
        }

        if (!isPending && isPendingPage) {
            window.location.href = 'index.html';
            return null;
        }

        if (isLoginPage) {
            window.location.href = isPending ? 'pending.html' : 'index.html';
            return null;
        }
    }

    return session;
}

// 2. 이메일 로그인
async function signIn(email, password) {
    if (!client) return { error: { message: 'Supabase client not initialized' } };
    const { data, error } = await client.auth.signInWithPassword({
        email,
        password
    });
    return { data, error };
}

// 3. 로그아웃
async function signOut() {
    // 관리자 로그아웃
    if (localStorage.getItem('fs_admin_access') === 'true') {
        if (confirm('관리자 로그아웃 하시겠습니까?')) {
            localStorage.removeItem('fs_admin_access');
            window.location.href = 'login.html';
        }
        return;
    }

    if (!client) return;
    const { error } = await client.auth.signOut();
    if (!error) {
        window.location.href = 'login.html';
    } else {
        alert('로그아웃 실패: ' + error.message);
    }
}

// 4. 회원가입 (메타데이터 포함 + 승인 대기 상태로 시작)
async function signUp(email, password, metadata = {}) {
    if (!client) return { error: { message: 'Supabase client not initialized' } };
    const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
            data: { ...metadata, approved: false } // 관리자 승인 전까지 접근 차단
        }
    });
    return { data, error };
}

// 5. 현재 사용자 정보 가져오기 (UI 표시용)
async function getUser() {
    // 관리자 우회
    if (localStorage.getItem('fs_admin_access') === 'true') {
        return {
            email: 'admin@maeil.com',
            user_metadata: { full_name: '관리자' }
        };
    }

    if (!client) return null;
    const { data: { user } } = await client.auth.getUser();
    return user;
}

// ============================================================
// 6. 담당자 이메일 자동 매칭 (B방식)
// - 로그인/회원가입 성공 시 이름이 담당자관리 시트와 일치하면 이메일 자동 등록
// - 일치하지 않아도 로그인/가입은 정상 진행됨
// ============================================================
const AUTH_APPS_SCRIPT_URL = (typeof APPS_SCRIPT_URL !== 'undefined') ? APPS_SCRIPT_URL : 'https://script.google.com/macros/s/AKfycbxEXZ-22BYHC-98YhmjCOBS741-rGNKwk-IXj0Zoe6Gi1bmBCc74lf5z-zvOG5VQpOn/exec';

async function matchManagerEmail(fullName, email) {
    if (!fullName || !email) return;
    try {
        const response = await fetch(AUTH_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'matchManagerEmail',
                name: fullName,
                email: email
            })
        });
        const result = await response.json();
        if (result.matched) {
            console.log(`담당자 이메일 자동 연동 완료: ${fullName} → ${email}`);
        } else {
            console.log(`담당자 매칭 없음 (일반 사용자): ${fullName}`);
        }
    } catch (e) {
        // 매칭 실패해도 로그인/가입에는 영향 없음
        console.warn('담당자 이메일 매칭 실패 (무시):', e.message);
    }
}

// 페이지 로드 시 자동 실행
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});

// UI 헬퍼: 로그아웃 버튼 이벤트 & 사용자 이름 표시
async function setupLogoutButton(buttonId = 'logoutBtn', nameDisplayId = 'userNameDisplay') {
    const btn = document.getElementById(buttonId);

    // 사용자 이름 표시
    const user = await getUser();
    if (user && user.user_metadata && user.user_metadata.full_name) {
        const nameSpan = document.getElementById(nameDisplayId);
        if (nameSpan) {
            nameSpan.innerText = `${user.user_metadata.full_name}님`;
            nameSpan.style.color = '#ffffff';
            nameSpan.style.marginRight = '10px';
            nameSpan.style.fontSize = '13px';
        }
    }

    if (btn) {
        // 기존 이벤트 리스너 제거가 어려우므로 클론 후 교체 (중복 방지)
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut(); // confirm은 signOut 내부에서 처리
        });
    }
}
