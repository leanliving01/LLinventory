import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useLocation } from 'react-router-dom';
import { Bug, Mic, MicOff, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function BugReportForm({ onSubmitted }) {
  const { user } = useAuth();
  const location = useLocation();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef(null);

  const toggleVoice = () => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Voice input not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-ZA';

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setDescription(transcript);
    };

    recognition.onerror = () => {
      setRecording(false);
      toast.error('Voice recognition error');
    };

    recognition.onend = () => setRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) {
      toast.error('Please fill in both subject and description');
      return;
    }
    setSubmitting(true);

    // Generate AI prompt
    const aiPrompt = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a senior developer debugging the Lean Living production/inventory app (React + Base44 platform, Tailwind CSS, shadcn/ui).

A user reported this bug:
**Subject:** ${subject}
**Description:** ${description}
**Page route:** ${location.pathname}
**Reporter:** ${user?.full_name || 'Unknown'}

Generate a concise developer prompt to fix this bug. Include:
1. Summary of the bug
2. Expected vs actual behaviour
3. Affected components/files (infer from the page route — app uses pages/, components/, functions/, entities/)
4. Suggested fix approach

Write it as a ready-to-paste prompt for an AI coding assistant.`,
    });

    await base44.entities.BugReport.create({
      subject: subject.trim(),
      description: description.trim(),
      page_route: location.pathname,
      ai_prompt: aiPrompt,
      status: 'new',
      reporter_name: user?.full_name || 'Unknown',
      reporter_email: user?.email || '',
    });

    setSubject('');
    setDescription('');
    setSubmitting(false);
    toast.success('Bug report submitted');
    onSubmitted?.();
  };

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="bg-primary/10 border-b px-4 py-3 flex items-center gap-2">
        <Bug className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Report a Bug</h3>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject *</label>
          <Input
            placeholder="Brief description of the bug..."
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
          <div className="relative mt-1">
            <textarea
              placeholder="Describe the bug — what went wrong, what you expected, steps to reproduce... or click the mic to record."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none pr-10"
            />
            <button
              type="button"
              onClick={toggleVoice}
              className={`absolute right-2 top-2 p-1.5 rounded-md transition-colors ${recording ? 'bg-destructive/10 text-destructive animate-pulse' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              title={recording ? 'Stop recording' : 'Start voice input'}
            >
              {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>
          {recording && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
              Listening... speak now
            </p>
          )}
        </div>
        <Button
          onClick={handleSubmit}
          disabled={submitting || !subject.trim() || !description.trim()}
          className="gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Submit Bug Report
        </Button>
      </div>
    </div>
  );
}