'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { License, Account } from '@/types';

export default function DashboardPage() {
  const { metadata } = useAuth();
  const supabase = createClient();

  const [licenses, setLicenses] = useState<License[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const businessUnit = metadata?.business_unit ?? null;

  const loadData = useCallback(async () => {
    if (!businessUnit) return;
    setLoading(true);

    const [licenseRes, accountRes] = await Promise.all([
      supabase
        .from('licenses')
        .select('*')
        .eq('business_unit', businessUnit)
        .order('id', { ascending: false })
        .limit(500),
      supabase
        .from('accounts')
        .select('*')
        .eq('business_unit', businessUnit)
        .order('id', { ascending: false })
        .limit(500),
    ]);

    if (licenseRes.data) setLicenses(licenseRes.data);
    if (accountRes.data) setAccounts(accountRes.data);
    setLoading(false);
  }, [businessUnit, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredAccounts = accounts.filter((a) => {
    const matchSearch =
      !searchTerm ||
      a.account_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.address?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus =
      statusFilter === 'all' || a.trade_status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    totalLicenses: licenses.length,
    totalAccounts: accounts.length,
    tradingAccounts: accounts.filter((a) => a.trade_status === '거래').length,
    nonTradingAccounts: accounts.filter((a) => a.trade_status === '비거래')
      .length,
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-gray-500">데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      {/* 상단 통계 카드 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              인허가
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalLicenses}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              거래처
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalAccounts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              거래 중
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              {stats.tradingAccounts}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              비거래
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-500">
              {stats.nonTradingAccounts}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 필터 */}
      <div className="flex flex-col gap-3 md:flex-row">
        <Input
          placeholder="거래처명 또는 주소 검색..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="md:max-w-sm"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className="w-full md:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="거래">거래</SelectItem>
            <SelectItem value="비거래">비거래</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 거래처 목록 */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filteredAccounts.map((account) => (
          <Card key={account.id} className="transition-shadow hover:shadow-md">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{account.account_name}</h3>
                <Badge
                  variant={
                    account.trade_status === '거래' ? 'default' : 'secondary'
                  }
                  className={
                    account.trade_status === '거래'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-600'
                  }
                >
                  {account.trade_status ?? '미분류'}
                </Badge>
              </div>
              <p className="text-sm text-gray-500">{account.address}</p>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {account.milk_company && (
                  <span>우유: {account.milk_company}</span>
                )}
                {account.manager && <span>담당: {account.manager}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredAccounts.length === 0 && (
        <div className="py-16 text-center text-gray-400">
          {searchTerm ? '검색 결과가 없습니다.' : '데이터가 없습니다.'}
        </div>
      )}
    </div>
  );
}
