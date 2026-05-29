import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Star } from 'lucide-react';

const ROLE_OPTIONS = [
  { value: 'general',   label: 'General' },
  { value: 'accounts',  label: 'Accounts / Finance' },
  { value: 'sales',     label: 'Sales' },
  { value: 'logistics', label: 'Logistics / Dispatch' },
  { value: 'technical', label: 'Technical' },
  { value: 'manager',   label: 'Manager' },
];

export function SupplierContactsSection({ contacts = [], onChange }) {
  const addContact = () => {
    onChange([
      ...contacts,
      {
        _key: crypto.randomUUID(),
        name: '',
        email: '',
        phone: '',
        role: 'general',
        is_primary: contacts.length === 0, // auto-primary if first
        notes: '',
      },
    ]);
  };

  const removeContact = (keyOrId) => {
    onChange(contacts.filter(c => (c._key ?? c.id) !== keyOrId));
  };

  const updateContact = (keyOrId, field, value) => {
    onChange(
      contacts.map(c =>
        (c._key ?? c.id) === keyOrId ? { ...c, [field]: value } : c
      )
    );
  };

  const setPrimary = (keyOrId) => {
    onChange(
      contacts.map(c => ({
        ...c,
        is_primary: (c._key ?? c.id) === keyOrId,
      }))
    );
  };

  if (contacts.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground italic">No contacts yet.</p>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addContact}>
          <Plus className="w-3.5 h-3.5" />
          Add Contact
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {contacts.map((contact) => {
        const key = contact._key ?? contact.id;
        return (
          <div key={key} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            {/* Row 1 — name + role + primary toggle + delete */}
            <div className="flex items-center gap-2">
              <Input
                value={contact.name}
                onChange={e => updateContact(key, 'name', e.target.value)}
                placeholder="Contact name"
                className="h-8 text-sm flex-1"
              />
              <Select value={contact.role || 'general'} onValueChange={v => updateContact(key, 'role', v)}>
                <SelectTrigger className="h-8 text-sm w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                title={contact.is_primary ? 'Primary contact' : 'Set as primary'}
                onClick={() => setPrimary(key)}
                className={`shrink-0 p-1.5 rounded transition-colors ${
                  contact.is_primary
                    ? 'text-amber-500 bg-amber-50 border border-amber-200'
                    : 'text-muted-foreground hover:text-amber-400 border border-transparent'
                }`}
              >
                <Star className="w-3.5 h-3.5" fill={contact.is_primary ? 'currentColor' : 'none'} />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                onClick={() => removeContact(key)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Row 2 — email + phone */}
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={contact.email}
                onChange={e => updateContact(key, 'email', e.target.value)}
                placeholder="Email"
                type="email"
                className="h-8 text-sm"
              />
              <Input
                value={contact.phone}
                onChange={e => updateContact(key, 'phone', e.target.value)}
                placeholder="Phone"
                type="tel"
                className="h-8 text-sm"
              />
            </div>

            {/* Row 3 — notes */}
            <Textarea
              value={contact.notes || ''}
              onChange={e => updateContact(key, 'notes', e.target.value)}
              placeholder="Notes (optional)"
              className="text-sm h-12 resize-none"
            />
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addContact}>
        <Plus className="w-3.5 h-3.5" />
        Add Contact
      </Button>
    </div>
  );
}
