import { NextResponse } from 'next/server';

// TODO: 기존 api/send-license-alert.js 로직 마이그레이션
// Vercel Cron: 월~금 09:15 KST 인허가 주간 알림

export async function GET() {
  return NextResponse.json({ message: 'Not yet implemented' }, { status: 501 });
}
