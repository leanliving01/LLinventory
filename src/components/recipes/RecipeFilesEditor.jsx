import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Image, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Manages file uploads for a BOM record.
 * files: string[] of URLs
 * onChange: (newFiles: string[]) => void
 */
export default function RecipeFilesEditor({ files = [], onChange }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const handleUpload = async (e) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    setUploading(true);
    const newFiles = [...files];
    for (const file of selected) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      newFiles.push(file_url);
    }
    onChange(newFiles);
    setUploading(false);
    toast.success(`${selected.length} file(s) uploaded`);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRemove = (index) => {
    const updated = files.filter((_, i) => i !== index);
    onChange(updated);
  };

  const getFileInfo = (url) => {
    const name = url.split('/').pop().split('?')[0] || 'file';
    const ext = name.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
    return { name, ext, isImage };
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          Recipe Files ({files.length})
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 h-7 text-xs"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          Upload
        </Button>
        <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx" className="hidden" onChange={handleUpload} />
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files attached. Upload PDFs, images, or documents for kitchen staff.</p>
      ) : (
        <div className="space-y-2">
          {files.map((url, i) => {
            const { name, isImage } = getFileInfo(url);
            return (
              <div key={i} className="flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2">
                {isImage ? <Image className="w-4 h-4 text-blue-500 shrink-0" /> : <FileText className="w-4 h-4 text-orange-500 shrink-0" />}
                <span className="text-xs truncate flex-1">{decodeURIComponent(name)}</span>
                <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </a>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleRemove(i)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}