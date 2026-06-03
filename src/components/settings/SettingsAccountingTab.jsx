import React from 'react';
import { Wallet, Boxes, TrendingUp } from 'lucide-react';
import SettingsTaxRatesTab from '@/components/settings/SettingsTaxRatesTab';
import AccountListSection from '@/components/settings/AccountListSection';

/**
 * Accounting settings — stacked sections:
 *   1. Tax Rates (existing)
 *   2. COGS Accounts
 *   3. Inventory Accounts
 *   4. Revenue Accounts
 * The account lists feed the product form's account dropdowns (no Xero dependency).
 */
export default function SettingsAccountingTab() {
  return (
    <div className="space-y-6 max-w-3xl">
      {/* Tax Rates (existing card + help text) */}
      <SettingsTaxRatesTab />

      {/* Chart of accounts — managed locally */}
      <AccountListSection accountType="cogs" title="COGS Accounts" icon={Wallet} />
      <AccountListSection accountType="inventory" title="Inventory Accounts" icon={Boxes} />
      <AccountListSection accountType="revenue" title="Revenue Accounts" icon={TrendingUp} />

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800 space-y-1">
        <p className="font-semibold">How accounts work on products:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Accounts added here populate the COGS / Inventory / Revenue dropdowns on each product.</li>
          <li>The account <strong>code</strong> (e.g. 403) is stored on the product so it maps to your accounting/Xero ledger.</li>
          <li>The default account is suggested when a product has none set.</li>
        </ul>
      </div>
    </div>
  );
}
