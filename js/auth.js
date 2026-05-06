
// ============================================================
// 소속 목록 (지점/사업부 추가 시 여기만 수정)
// ============================================================
const BUSINESS_UNITS = [
    '수도권FS지역사업부장',
    '경기북부FS지점',
    '서울FS지점',
    '경기남부FS지점',
];

// ============================================================
// Supabase Auth Configuration (config.js에서 주입)
// ============================================================
const SUPABASE_URL = window.FS_CONFIG?.SUPABASE_URL || '';
const SUPABASE_KEY = window.FS_CONFIG?.SUPABASE_ANON_KEY || '';

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
    if (sessionStorage.getItem('fs_admin_access') === 'true') {
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
    if (sessionStorage.getItem('fs_admin_access') === 'true') {
        if (confirm('관리자 로그아웃 하시겠습니까?')) {
            sessionStorage.removeItem('fs_admin_access');
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
    if (sessionStorage.getItem('fs_admin_access') === 'true') {
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

// ============================================================
// 7. 로그인 저장 / 기기 관리
// - 1계정당 PC 1대 + 모바일 1대까지 로그인 저장 허용
// - 기기 정보는 Supabase user_metadata.registered_devices 에 저장
// ============================================================

function getDeviceId() {
    let id = localStorage.getItem('fs_device_id');
    if (!id) {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        arr[6] = (arr[6] & 0x0f) | 0x40;
        arr[8] = (arr[8] & 0x3f) | 0x80;
        id = [...arr].map((b, i) =>
            ([4,6,8,10].includes(i) ? '-' : '') + b.toString(16).padStart(2,'0')
        ).join('');
        localStorage.setItem('fs_device_id', id);
    }
    return id;
}

function getDeviceType() {
    return /Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'pc';
}

function getDeviceName() {
    const ua = navigator.userAgent;
    let os = 'Unknown';
    let browser = 'Unknown';
    if      (/iPhone/i.test(ua))   os = 'iPhone';
    else if (/iPad/i.test(ua))     os = 'iPad';
    else if (/Android/i.test(ua))  os = 'Android';
    else if (/Windows/i.test(ua))  os = 'Windows';
    else if (/Mac/i.test(ua))      os = 'macOS';
    if      (/Edg/i.test(ua))      browser = 'Edge';
    else if (/Chrome/i.test(ua))   browser = 'Chrome';
    else if (/Safari/i.test(ua))   browser = 'Safari';
    else if (/Firefox/i.test(ua))  browser = 'Firefox';
    return `${browser} / ${os}`;
}

// 기기 등록 시도 → { ok, error?, conflictDevice? }
async function registerDevice() {
    if (!client) return { ok: false, error: '클라이언트 오류' };
    const { data: { user } } = await client.auth.getUser();
    if (!user) return { ok: false, error: '사용자 정보 없음' };

    const deviceId   = getDeviceId();
    const deviceType = getDeviceType();
    const deviceName = getDeviceName();
    let devices = user.user_metadata?.registered_devices || [];

    // 이미 이 기기가 등록된 경우 → last_seen만 갱신
    if (devices.find(d => d.id === deviceId)) {
        const updated = devices.map(d =>
            d.id === deviceId ? { ...d, last_seen: new Date().toISOString() } : d
        );
        await client.auth.updateUser({ data: { registered_devices: updated } });
        return { ok: true };
    }

    // 같은 유형의 다른 기기가 이미 등록된 경우
    const conflict = devices.find(d => d.type === deviceType);
    if (conflict) {
        return { ok: false, conflictDevice: conflict, deviceType };
    }

    // 신규 등록
    const newDevice = {
        id: deviceId, type: deviceType, name: deviceName,
        registered_at: new Date().toISOString(),
        last_seen:     new Date().toISOString()
    };
    await client.auth.updateUser({ data: { registered_devices: [...devices, newDevice] } });
    return { ok: true };
}

// 기존 같은 유형 기기를 교체하고 현재 기기 등록
async function replaceDevice() {
    if (!client) return false;
    const { data: { user } } = await client.auth.getUser();
    if (!user) return false;

    const deviceId   = getDeviceId();
    const deviceType = getDeviceType();
    const deviceName = getDeviceName();
    let devices = (user.user_metadata?.registered_devices || [])
        .filter(d => d.type !== deviceType); // 같은 유형 제거

    devices.push({
        id: deviceId, type: deviceType, name: deviceName,
        registered_at: new Date().toISOString(),
        last_seen:     new Date().toISOString()
    });
    await client.auth.updateUser({ data: { registered_devices: devices } });
    return true;
}

// 현재 기기의 로그인 저장 해제
async function unregisterDevice() {
    if (!client) return;
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const deviceId = getDeviceId();
    const devices  = (user.user_metadata?.registered_devices || [])
        .filter(d => d.id !== deviceId);
    await client.auth.updateUser({ data: { registered_devices: devices } });
    localStorage.removeItem('fs_saved_email');
}

// UI 헬퍼: 로그아웃 버튼 이벤트 & 사용자 이름 표시
async function setupLogoutButton(buttonId = 'logoutBtn', nameDisplayId = 'userNameDisplay') {
    const btn = document.getElementById(buttonId);

    // 사용자 이름 + 소속 표시
    const user = await getUser();
    if (user && user.user_metadata && user.user_metadata.full_name) {
        const nameSpan = document.getElementById(nameDisplayId);
        if (nameSpan) {
            const bu = user.user_metadata.business_unit;
            nameSpan.innerText = bu
                ? `${user.user_metadata.full_name}님 (${bu})`
                : `${user.user_metadata.full_name}님`;
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

    // 관리자 링크 표시 (nav-component.js가 주입한 #adminPanelLink)
    if (sessionStorage.getItem('fs_admin_access') === 'true') {
        const adminLink = document.getElementById('adminPanelLink');
        if (adminLink) adminLink.style.display = 'inline';
    }
}
