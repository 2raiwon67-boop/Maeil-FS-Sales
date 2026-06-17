import { NextResponse } from 'next/server';

// TODO: 기존 api/recipe-recommend.js 로직 마이그레이션
// pgvector 768차원 레시피 RAG

export async function POST() {
  return NextResponse.json({ message: 'Not yet implemented' }, { status: 501 });
}
