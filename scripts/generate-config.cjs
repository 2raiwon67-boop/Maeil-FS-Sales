// Vercel 빌드 시 환경변수에서 config.js 자동 생성
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
    console.error('[generate-config] SUPABASE_URL 또는 SUPABASE_ANON_KEY 환경변수가 없습니다.');
    process.exit(1);
}

const content = `window.FS_CONFIG = {
    SUPABASE_URL: '${url}',
    SUPABASE_ANON_KEY: '${key}'
};
`;

fs.writeFileSync(path.join(__dirname, '..', 'config.js'), content);
console.log('[generate-config] config.js 생성 완료');
