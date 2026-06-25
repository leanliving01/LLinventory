import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Search, Save, Loader2, ShoppingCart, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { money } from '@/components/sales/order-shared/money';
import ProductPickerRow from '@/components/sales/manual/ProductPickerRow';

const todayISO = () => new Date().toISOString().slice(0, 10);
const rand = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()));

function Section({ title, children }) {
  return (
    <div className="bg-card rounded-xl border p-4 md:p-5 space-y-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children, htmlFor }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export default function NewSalesOrder() {
  const navigate = useNavigate();

  // Header / channel
  const [orderSource, setOrderSource] = useState('manual');
  const [orderDate, setOrderDate] = useState(todayISO());
  const [currency, setCurrency] = useState('ZAR');

  // Customer
  const [customerId, setCustomerId] = useState(''); // existing customer id (optional)
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerExternalId, setCustomerExternalId] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [shippingCity, setShippingCity] = useState('');
  const [shippingProvince, setShippingProvince] = useState('');
  const [shippingZip, setShippingZip] = useState('');
  const [shippingCountry, setShippingCountry] = useState('South Africa');

  // Lines
  const [lines, setLines] = useState([]); // {key, our_product_id, sku, name, qty, unit_price}

  // Charges
  const [shippingCost, setShippingCost] = useState('');
  const [discount, setDiscount] = useState('');

  // Payment
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [amountPaid, setAmountPaid] = useState('');

  // Notes
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // ---- Data ----------------------------------------------------------------
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list('-created_date', 1000),
    staleTime: 60000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-manual-order'],
    // Active only — archived products must not be pickable onto a new order.
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 3000),
    staleTime: 60000,
  });

  const { data: stockRows = [] } = useQuery({
    queryKey: ['soh-for-manual-order'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 10000),
    staleTime: 60000,
  });

  // Active package SKUs — mirrors backend loadPackageSkus (packaging.ts) so a
  // manually-entered package SKU is flagged as a parent and explodes server-side.
  const { data: packBoms = [] } = useQuery({
    queryKey: ['pack-boms-for-manual-order'],
    queryFn: () => base44.entities.PackBom.filter({ active: true }, 'package_sku', 200),
    staleTime: 60000,
  });
  const packageSkuSet = useMemo(
    () => new Set(packBoms.map(pb => (pb.package_sku || '').toUpperCase())),
    [packBoms],
  );

  const availableByProduct = useMemo(() => {
    const map = {};
    for (const r of stockRows) {
      if (!r.product_id) continue;
      map[r.product_id] = (map[r.product_id] || 0) + (Number(r.qty_on_hand) || 0);
    }
    return map;
  }, [stockRows]);

  // ---- Customer search dropdown --------------------------------------------
  const [custSearch, setCustSearch] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  const custBoxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (custBoxRef.current && !custBoxRef.current.contains(e.target)) setCustOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const custMatches = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    if (!q) return [];
    return customers.filter(c => {
      const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
      return name.includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q);
    }).slice(0, 8);
  }, [customers, custSearch]);

  const selectCustomer = (c) => {
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
    setCustomerId(c.id);
    setCustomerName(name);
    setCustomerEmail(c.email || '');
    setCustomerPhone(c.phone || '');
    setCustomerExternalId(c.shopify_customer_id || c.external_id || '');
    setShippingCity(c.default_address_city || '');
    setShippingProvince(c.default_address_province || '');
    setShippingZip(c.default_address_zip || '');
    setShippingCountry(c.default_address_country || shippingCountry);
    const addr = [c.default_address_address1, c.default_address_address2].filter(Boolean).join(', ');
    if (addr) setShippingAddress(addr);
    setCustOpen(false);
    setCustSearch('');
  };

  const clearCustomerLink = () => {
    setCustomerId('');
    setCustomerExternalId('');
  };

  // ---- Product search ------------------------------------------------------
  const [prodSearch, setProdSearch] = useState('');
  const [prodOpen, setProdOpen] = useState(false);
  const prodBoxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (prodBoxRef.current && !prodBoxRef.current.contains(e.target)) setProdOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const prodMatches = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [products, prodSearch]);

  const addProduct = (p) => {
    setLines(prev => [
      ...prev,
      {
        key: rand(),
        our_product_id: p.id,
        sku: p.sku || '',
        name: p.name || '',
        qty: 1,
        unit_price: Number(p.price) || 0,
      },
    ]);
    setProdSearch('');
    setProdOpen(false);
  };

  const updateLine = (key, patch) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) =>
    setLines(prev => prev.filter(l => l.key !== key));

  // ---- Totals --------------------------------------------------------------
  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0),
    [lines],
  );
  const shipNum = Number(shippingCost) || 0;
  const discNum = Number(discount) || 0;
  const total = subtotal + shipNum - discNum;

  // ---- Submit --------------------------------------------------------------
  const handleSubmit = async () => {
    if (!customerName.trim()) {
      toast.error('Customer name is required');
      return;
    }
    const validLines = lines.filter(l => l.our_product_id && (Number(l.qty) || 0) > 0);
    if (validLines.length === 0) {
      toast.error('Add at least one product line with quantity');
      return;
    }

    const financialLines = [];
    if (discNum > 0) {
      // Discount reduces revenue. Shipping is captured via shipping_cost column
      // only (NOT also as a financial line) to avoid double-counting the total.
      financialLines.push({ category: 'discount', label: 'Discount', amount: discNum, sign: -1 });
    }

    const payload = {
      order_source: orderSource,
      customer_name: customerName.trim(),
      customer_email: customerEmail.trim() || null,
      customer_phone: customerPhone.trim() || null,
      customer_external_id: customerExternalId || null,
      customer_address: shippingAddress.trim() || null,
      billing_address: billingAddress.trim() || null,
      shipping_city: shippingCity.trim() || null,
      shipping_province: shippingProvince.trim() || null,
      shipping_zip: shippingZip.trim() || null,
      shipping_country: shippingCountry.trim() || null,
      order_date: new Date(orderDate).toISOString(),
      currency,
      notes: notes.trim() || null,
      shipping_cost: shipNum,
      payment_status: paymentStatus,
      payment_method: paymentMethod.trim() || null,
      payment_reference: paymentReference.trim() || null,
      payment_date: paymentStatus === 'paid' ? new Date().toISOString() : null,
      amount_paid: amountPaid !== '' ? Number(amountPaid) : (paymentStatus === 'paid' ? total : 0),
      lines: validLines.map(l => ({
        sku: l.sku || null,
        name: l.name,
        variant_title: null,
        qty: Number(l.qty),
        unit_price: Number(l.unit_price) || 0,
        our_product_id: l.our_product_id,
        is_package_parent: packageSkuSet.has((l.sku || '').toUpperCase()),
        line_type: 'standalone',
      })),
      financial_lines: financialLines,
    };

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('create_manual_sales_order', { p_payload: payload });
      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.id) throw new Error('Order created but no id returned');
      toast.success(`Order ${result.internal_order_number || result.order_number} created`);
      navigate(`/sales/orders/${result.id}`);
    } catch (err) {
      console.error('[NewSalesOrder] create failed:', err);
      toast.error(`Failed to create order: ${err.message || 'unknown error'}`);
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1100px] mx-auto pb-28">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to="/sales"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <ShoppingCart className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">New Sales Order</h1>
      </div>

      {/* Channel & order info */}
      <Section title="Order information">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Sales channel">
            <Select value={orderSource} onValueChange={setOrderSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="wholesale">Wholesale</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Order date" htmlFor="order_date">
            <Input id="order_date" type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
          </Field>
          <Field label="Currency">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ZAR">ZAR</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      {/* Customer */}
      <Section title="Customer">
        <div ref={custBoxRef} className="relative">
          <Label className="text-xs text-muted-foreground">Find an existing customer (optional)</Label>
          <div className="relative mt-1.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search customer by name, email, phone..."
              value={custSearch}
              onChange={e => { setCustSearch(e.target.value); setCustOpen(true); }}
              onFocus={() => setCustOpen(true)}
              className="pl-9"
            />
          </div>
          {custOpen && custMatches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-popover border rounded-lg shadow-lg max-h-72 overflow-auto">
              {custMatches.map(c => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => selectCustomer(c)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 border-b last:border-b-0"
                >
                  <p className="text-sm font-medium">{`${c.first_name || ''} ${c.last_name || ''}`.trim() || '(no name)'}</p>
                  <p className="text-xs text-muted-foreground">{c.email || c.phone || '—'}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {customerId && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
              Linked to existing customer
            </span>
            <button type="button" onClick={clearCustomerLink} className="flex items-center gap-1 hover:text-foreground">
              <X className="w-3 h-3" /> unlink
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Name *" htmlFor="cust_name">
            <Input id="cust_name" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" />
          </Field>
          <Field label="Email" htmlFor="cust_email">
            <Input id="cust_email" type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="Phone" htmlFor="cust_phone">
            <Input id="cust_phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+27..." />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Billing address" htmlFor="billing">
            <Textarea id="billing" rows={2} value={billingAddress} onChange={e => setBillingAddress(e.target.value)} placeholder="Billing address" />
          </Field>
          <Field label="Shipping address" htmlFor="shipping">
            <Textarea id="shipping" rows={2} value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} placeholder="Street address" />
          </Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="City" htmlFor="city">
            <Input id="city" value={shippingCity} onChange={e => setShippingCity(e.target.value)} />
          </Field>
          <Field label="Province" htmlFor="province">
            <Input id="province" value={shippingProvince} onChange={e => setShippingProvince(e.target.value)} />
          </Field>
          <Field label="Postal code" htmlFor="zip">
            <Input id="zip" value={shippingZip} onChange={e => setShippingZip(e.target.value)} />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" value={shippingCountry} onChange={e => setShippingCountry(e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* Products */}
      <Section title="Products">
        <div ref={prodBoxRef} className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search products by name or SKU to add..."
              value={prodSearch}
              onChange={e => { setProdSearch(e.target.value); setProdOpen(true); }}
              onFocus={() => setProdOpen(true)}
              className="pl-9"
            />
          </div>
          {prodOpen && prodMatches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-popover border rounded-lg shadow-lg max-h-72 overflow-auto">
              {prodMatches.map(p => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 border-b last:border-b-0 flex items-center justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{p.name}</span>
                    <span className="block text-xs text-muted-foreground font-mono truncate">
                      {p.sku || '—'} · {availableByProduct[p.id] || 0} avail
                    </span>
                  </span>
                  <span className="text-sm font-medium tabular-nums shrink-0">{money(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground border-b">
              <span className="flex-1 min-w-[180px]">Product</span>
              <span className="w-20 text-right">Qty</span>
              <span className="w-28 text-right">Unit price</span>
              <span className="w-28 text-right">Total</span>
              <span className="w-9" />
            </div>
            {lines.map(l => (
              <ProductPickerRow
                key={l.key}
                line={l}
                available={availableByProduct[l.our_product_id] ?? null}
                onChange={patch => updateLine(l.key, patch)}
                onRemove={() => removeLine(l.key)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
            <Plus className="w-4 h-4 inline mr-1" /> Search above to add products to this order
          </p>
        )}
      </Section>

      {/* Charges */}
      <Section title="Charges">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Shipping charge" htmlFor="ship_cost">
            <Input id="ship_cost" type="number" min="0" step="0.01" value={shippingCost} onChange={e => setShippingCost(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Discount" htmlFor="discount">
            <Input id="discount" type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
      </Section>

      {/* Payment */}
      <Section title="Payment">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Payment status">
            <Select value={paymentStatus} onValueChange={setPaymentStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Unpaid (pending)</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partially_paid">Partially Paid</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount paid" htmlFor="amount_paid">
            <Input
              id="amount_paid"
              type="number"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={e => setAmountPaid(e.target.value)}
              placeholder={paymentStatus === 'paid' ? total.toFixed(2) : '0.00'}
            />
          </Field>
          <Field label="Payment method" htmlFor="pay_method">
            <Input id="pay_method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder="EFT, Card, Cash..." />
          </Field>
          <Field label="Payment reference" htmlFor="pay_ref">
            <Input id="pay_ref" value={paymentReference} onChange={e => setPaymentReference(e.target.value)} placeholder="Reference / invoice no." />
          </Field>
        </div>
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes for this order..." />
      </Section>

      {/* Summary + actions (sticky footer) */}
      <div className="sticky bottom-0 left-0 right-0 bg-card border rounded-xl p-4 shadow-lg flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span className="tabular-nums">{money(shipNum)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">{discNum ? `−${money(discNum)}` : money(0)}</span></div>
          <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline">
            <Link to="/sales">Cancel</Link>
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
            Create Order
          </Button>
        </div>
      </div>
    </div>
  );
}
