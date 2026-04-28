import React from 'react';
import { FileText, ExternalLink, Image } from 'lucide-react';

/**
 * "Files" tab — shows recipe files attached to the BOM.
 * Staff can tap to open/download them.
 */
export default function FilesTab({ bom }) {
  const files = bom?.files || [];

  if (files.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No recipe files attached.</p>
        <p className="text-xs text-muted-foreground mt-1">Files can be added from the Recipe editor in admin.</p>
      </div>
    );
  }

  const getFileInfo = (url) => {
    const name = url.split('/').pop().split('?')[0] || 'File';
    const ext = name.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    const isPdf = ext === 'pdf';
    return { name, ext, isImage, isPdf };
  };

  return (
    <div className="space-y-3">
      {files.map((url, idx) => {
        const info = getFileInfo(url);
        return (
          <a
            key={idx}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-card border rounded-2xl p-4 flex items-center gap-4 active:bg-muted transition-colors block"
          >
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
              {info.isImage ? (
                <Image className="w-6 h-6 text-muted-foreground" />
              ) : (
                <FileText className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{info.name}</p>
              <p className="text-xs text-muted-foreground uppercase">{info.ext} file</p>
            </div>
            <ExternalLink className="w-5 h-5 text-muted-foreground shrink-0" />
          </a>
        );
      })}
    </div>
  );
}