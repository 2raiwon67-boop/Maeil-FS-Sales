'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BUSINESS_UNITS } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveLogin, setSaveLogin] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async () => {
    if (!email || !password) {
      toast.error('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      toast.error('로그인 실패: ' + error.message);
      return;
    }

    if (saveLogin) {
      localStorage.setItem('fs_saved_email', email);
    }

    router.push('/');
    router.refresh();
  };

  const handleSignUp = async () => {
    if (!email || !password || !fullName || !businessUnit) {
      toast.error('모든 필수 항목을 입력해주세요.');
      return;
    }
    if (!privacyConsent) {
      toast.error('개인정보 수집에 동의해주세요.');
      return;
    }
    if (password.length < 6) {
      toast.error('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          business_unit: businessUnit,
          approved: false,
        },
      },
    });
    setLoading(false);

    if (error) {
      toast.error('회원가입 실패: ' + error.message);
      return;
    }

    toast.success('회원가입 완료! 관리자 승인 후 이용 가능합니다.');
    router.push('/pending');
  };

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="items-center space-y-2 text-center">
        <Image
          src="/assets/images/logo.png"
          alt="Maeil Logo"
          width={128}
          height={40}
          className="mx-auto"
          priority
        />
        <h1 className="text-2xl font-bold text-gray-800">FS MISO</h1>
        <p className="font-medium text-blue-600">
          FS 영업사원을 위한 All-In-One 대시보드
        </p>
        <p className="text-sm text-gray-500">
          안전한 서비스 이용을 위해 로그인해주세요.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">이메일</Label>
          <Input
            id="email"
            type="email"
            placeholder="admin@maeil.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">비밀번호</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mode === 'login' && handleLogin()}
          />
        </div>

        {mode === 'signup' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="fullName">이름</Label>
              <Input
                id="fullName"
                placeholder="홍길동"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>소속</Label>
              <Select value={businessUnit} onValueChange={(v) => setBusinessUnit(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="소속 선택" />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_UNITS.map((bu) => (
                    <SelectItem key={bu} value={bu}>
                      {bu}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">
                관리자 승인 시 최종 확정됩니다.
              </p>
            </div>

            <div className="rounded-md border bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
              <p className="mb-1 font-semibold text-gray-700">
                수집하는 개인정보 항목
              </p>
              <p>이름, 이메일</p>
              <p className="mb-1 mt-2 font-semibold text-gray-700">
                수집 및 이용 목적
              </p>
              <p>FS MISO 서비스 로그인 및 담당자 식별</p>
              <p className="mb-1 mt-2 font-semibold text-gray-700">
                보유 및 이용 기간
              </p>
              <p>서비스 탈퇴 시 즉시 삭제</p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="privacy"
                checked={privacyConsent}
                onCheckedChange={(v) => setPrivacyConsent(v === true)}
              />
              <Label htmlFor="privacy" className="text-sm">
                개인정보 수집 및 이용에 동의합니다
              </Label>
            </div>
          </>
        )}

        {mode === 'login' && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="saveLogin"
              checked={saveLogin}
              onCheckedChange={(v) => setSaveLogin(v === true)}
            />
            <Label htmlFor="saveLogin" className="text-sm text-gray-600">
              로그인 상태 유지
            </Label>
          </div>
        )}

        <Button
          className="w-full"
          onClick={mode === 'login' ? handleLogin : handleSignUp}
          disabled={loading}
        >
          {loading ? '처리 중...' : mode === 'login' ? '로그인' : '회원가입'}
        </Button>

        <div className="text-center">
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'login'
              ? '계정이 없으신가요? 회원가입'
              : '이미 계정이 있으신가요? 로그인'}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
