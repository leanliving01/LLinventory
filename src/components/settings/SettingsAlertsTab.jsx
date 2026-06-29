import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Mail, MessageSquare, Save, Loader2, Plus, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/lib/navigationGuard';

export default function SettingsAlertsTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [emails, setEmails] = useState('');
  const [slackWebhook, setSlackWebhook] = useState('');
  const [newEmail, setNewEmail] = useState('');

  // Load existing settings
  const { data: settings = [] } = useQuery({
    queryKey: ['settings-alerts'],
    queryFn: () => base44.entities.Setting.filter({ group: 'alerts' }, 'key', 20),
  });

  useEffect(() => {
    const emailSetting = settings.find(s => s.key === 'alert_emails');
    const slackSetting = settings.find(s => s.key === 'slack_webhook_url');
    if (emailSetting) setEmails(emailSetting.value || '');
    if (slackSetting) setSlackWebhook(slackSetting.value || '');
  }, [settings]);

  const emailList = emails ? emails.split(',').map(e => e.trim()).filter(Boolean) : [];

  const addEmail = () => {
    if (!newEmail || !newEmail.includes('@')) { toast.error('Enter a valid email'); return; }
    const updated = [...emailList, newEmail.trim()].join(', ');
    setEmails(updated);
    setNewEmail('');
  };

  const removeEmail = (idx) => {
    const updated = emailList.filter((_, i) => i !== idx).join(', ');
    setEmails(updated);
  };

  const saveSetting = async (key, value, label) => {
    const existing = settings.find(s => s.key === key);
    if (existing) {
      await base44.entities.Setting.update(existing.id, { value });
    } else {
      await base44.entities.Setting.create({ key, value, group: 'alerts', label });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSetting('alert_emails', emails, 'Alert Email Recipients');
      await saveSetting('slack_webhook_url', slackWebhook, 'Slack Webhook URL');
      queryClient.invalidateQueries({ queryKey: ['settings-alerts'] });
      toast.success('Alert settings saved');
      return true;
    } catch (err) {
      toast.error('Save failed: ' + (err?.message || 'Unknown error'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Dirty = either field differs from its loaded setting value (same normalisation as the seed effect).
  const baselineEmails = settings.find(s => s.key === 'alert_emails')?.value || '';
  const baselineSlack = settings.find(s => s.key === 'slack_webhook_url')?.value || '';
  const hasUnsavedChanges = emails !== baselineEmails || slackWebhook !== baselineSlack;
  useUnsavedChanges(hasUnsavedChanges, {
    message: 'You have unsaved alert settings. Leave without saving?',
    onSave: handleSave,
  });

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Email Alerts */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold">Email Alerts</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          These emails receive the daily low-stock alert (weekdays 6:00 AM) and the nightly Shopify reconciliation summary (3:00 AM).
          If no addresses are set, both are sent to all admin users by default.
        </p>

        {/* Email list */}
        <div className="space-y-2">
          {emailList.map((email, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
              <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm flex-1">{email}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeEmail(idx)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          {emailList.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No custom recipients — alerts go to all admin users.</p>
          )}
        </div>

        {/* Add email */}
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="Add email address..."
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEmail()}
            className="flex-1"
          />
          <Button variant="outline" onClick={addEmail} className="gap-1">
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Slack Integration */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold">Slack Notifications</h3>
          <Badge variant="outline" className="text-[10px]">Coming Soon</Badge>
        </div>

        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm space-y-2">
              <p className="font-bold text-blue-800 dark:text-blue-300">How to connect Slack:</p>
              <ol className="list-decimal ml-4 space-y-1 text-blue-700 dark:text-blue-400">
                <li><strong>Go to your Slack workspace</strong> → Apps → Search for <strong>"Incoming Webhooks"</strong></li>
                <li><strong>Click "Add to Slack"</strong> and choose the channel (e.g. #inventory-alerts)</li>
                <li><strong>Copy the Webhook URL</strong> — it looks like: <code className="text-xs bg-blue-100 dark:bg-blue-900 px-1 rounded">https://hooks.slack.com/services/T.../B.../...</code></li>
                <li><strong>Paste it below</strong> and click Save</li>
              </ol>
              <p className="text-blue-700 dark:text-blue-400">
                Once connected, low-stock alerts will be posted to your Slack channel alongside the email notifications.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase">Slack Webhook URL</label>
          <Input
            value={slackWebhook}
            onChange={e => setSlackWebhook(e.target.value)}
            placeholder="https://hooks.slack.com/services/T.../B.../..."
            className="mt-1 font-mono text-sm"
          />
        </div>
      </div>

      {/* Save */}
      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save Alert Settings
      </Button>
    </div>
  );
}