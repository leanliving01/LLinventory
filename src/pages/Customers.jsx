import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, Search, X, Mail, Phone, MapPin } from 'lucide-react';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';
import TablePagination from '@/components/shared/TablePagination';

export default function Customers() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(c =>
      (c.first_name || '').toLowerCase().includes(q) ||
      (c.last_name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.default_address_city || '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Customers</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {filtered.length} of {customers.length} customers from Shopify
        </p>
      </div>

      <SyncStatusBanner syncKeys={['shopify_customers']} />

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone, city..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setPage(0); }} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading customers...</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">City</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Orders</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Total Spent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageItems.map(c => (
                <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium">
                    {c.first_name} {c.last_name}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {c.email ? (
                      <span className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5" /> {c.email}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {c.phone ? (
                      <span className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" /> {c.phone}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {c.default_address_city ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" /> {c.default_address_city}{c.default_address_province ? `, ${c.default_address_province}` : ''}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums">{c.orders_count || 0}</td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                    {c.total_spent ? `R ${Number(c.total_spent).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {(c.tags || []).slice(0, 3).map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{tag}</Badge>
                      ))}
                      {(c.tags || []).length > 3 && (
                        <Badge variant="outline" className="text-[10px]">+{c.tags.length - 3}</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {customers.length === 0 ? 'No customers synced yet. Use the Sync button above to pull from Shopify.' : 'No customers match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <TablePagination
            page={page}
            pageSize={pageSize}
            totalItems={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={v => { setPageSize(v); setPage(0); }}
          />
        </div>
      )}
    </div>
  );
}