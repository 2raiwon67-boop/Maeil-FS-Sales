
// ============================================================
// Supabase Auth Configuration
// ============================================================
const SUPABASE_URL = 'https://hcqbmilmldeeuydtrayx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcWJtaWxtbGRlZXV5ZHRyYXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTQ0ODIsImV4cCI6MjA4NjM5MDQ4Mn0.vKYyZQmWOewxYm3KkMM9AsE5GZ3OgZ47N6rs89TF3Mg';

// Supabase 클라이언트 초기화
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// Auth Functions
// ============================================================

// 1. 로그인 여부 확인 및 리다이렉트
async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();

    // 현재 페이지가 login.html이 아닌데 세션이 없으면 -> 로그인 페이지로 이동
    const currentPage = window.location.pathname.split('/').pop();
    if (!session && currentPage !== 'login.html') {
        window.location.href = 'login.html';
    }

    // 현재 페이지가 login.html인데 세션이 있으면 -> 메인 페이지로 이동
    if (session && currentPage === 'login.html') {
        window.location.href = 'index.html';
    }

    return session;
}

// 2. 이메일 로그인
async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    return { data, error };
}

// 3. 로그아웃
async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (!error) {
        window.location.href = 'login.html';
    } else {
        alert('로그아웃 실패: ' + error.message);
    }
}

// 4. 회원가입 (옵션)
async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password
    });
    return { data, error };
}

// 페이지 로드 시 자동 실행
document.addEventListener('DOMContentLoaded', () => {
    // 1초 뒤 인증 체크 (Supabase 로드 시간 고려)
    if (typeof createClient !== 'undefined') {
        checkAuth();
    } else {
        console.warn('Supabase JS library not loaded. Make sure to include the CDN link.');
    }
});

// UI 헬퍼: 로그아웃 버튼 이벤트 연결
function setupLogoutButton(buttonId = 'logoutBtn') {
    const btn = document.getElementById(buttonId);
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('로그아웃 하시겠습니까?')) {
                signOut();
            }
        });
    }
}
