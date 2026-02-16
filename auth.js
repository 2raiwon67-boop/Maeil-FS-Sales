
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
    const isLoginPage = path.includes('login.html') || path.endsWith('/login');

    // 관리자 우회 체크
    if (localStorage.getItem('fs_admin_access') === 'true') {
        if (isLoginPage) {
            window.location.href = 'index.html';
        }
        return { user: { email: 'admin@maeil.com', user_metadata: { full_name: '관리자' } } };
    }

    if (!client) return null;

    const { data: { session } } = await client.auth.getSession();

    // 현재 페이지가 login.html이 아닌데 세션이 없으면 -> 로그인 페이지로 이동
    if (!session && !isLoginPage) {
        window.location.href = 'login.html';
    }

    // 현재 페이지가 login.html인데 세션이 있으면 -> 메인 페이지로 이동
    if (session && isLoginPage) {
        window.location.href = 'index.html';
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

// 4. 회원가입 (메타데이터 포함)
async function signUp(email, password, metadata = {}) {
    if (!client) return { error: { message: 'Supabase client not initialized' } };
    const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
            data: metadata // full_name, phone 등
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
