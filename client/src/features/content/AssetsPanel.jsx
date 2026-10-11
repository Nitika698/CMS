import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, ImageOff, Trash2, UploadCloud } from 'lucide-react';
import { apiUrl } from '../../lib/apiClient.js';
import { Button, EmptyState, Modal, Spinner, useToast } from '../../components/ui/index.js';
import { contentApi } from './api.js';
import { formatBytes } from './constants.js';

/** Signed, short-lived link for <img>/<video>; refreshed before it expires. The file itself stays private. */
function useAssetUrl(assetId) {
  const [state, setState] = useState({ url: null, failed: false });
  const refresh = useCallback(async () => {
    try {
      const link = await contentApi.accessLink(assetId);
      const url = apiUrl(link.path);
      setState({ url, failed: false });
      return url;
    } catch {
      setState((s) => ({ ...s, failed: true }));
      return null;
    }
  }, [assetId]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4 * 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  return { ...state, refresh };
}

function Preview({ asset, onRemove, canEdit }) {
  const { url, failed, refresh } = useAssetUrl(asset.id);
  const retried = useRef(false);
  const onError = () => {
    if (!retried.current) {
      retried.current = true;
      refresh(); // the link may simply have expired
    }
  };
  const openPdf = async () => {
    const fresh = await refresh();
    if (fresh) window.open(fresh, '_blank', 'noopener');
  };

  return (
    <li className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex h-44 items-center justify-center bg-slate-100">
        {failed && !url ? (
          <div className="text-center text-sm text-slate-500">
            <ImageOff className="mx-auto mb-1 h-6 w-6" aria-hidden />
            Preview unavailable
          </div>
        ) : !url ? (
          <Spinner label="Loading preview…" />
        ) : asset.resourceType === 'image' ? (
          <img src={url} alt={asset.name} onError={onError} className="h-full w-full object-contain" />
        ) : asset.resourceType === 'video' ? (
          <video src={url} controls preload="metadata" onError={onError} className="h-full w-full object-contain" aria-label={asset.name} />
        ) : (
          <button type="button" onClick={openPdf} className="flex flex-col items-center gap-2 text-slate-600 hover:text-brand-700">
            <FileText className="h-10 w-10" aria-hidden />
            <span className="text-sm font-medium">Open PDF</span>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900" title={asset.name}>
            {asset.name}
          </p>
          <p className="text-xs text-slate-500">
            {asset.resourceType} · {formatBytes(asset.bytes)}
          </p>
        </div>
        {canEdit && <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onRemove(asset)} aria-label={`Remove ${asset.name}`} />}
      </div>
    </li>
  );
}

const guessKind = (file) => (file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type === 'application/pdf' ? 'document' : null);

export default function AssetsPanel({ content, meta, canEdit, onChanged }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const max = meta?.limits.maxAssets ?? 20;
  const limits = meta?.limits.upload;
  const accept = (meta?.limits.allowed ?? []).flatMap((a) => a.mimes).join(',');
  const full = content.assets.length >= max;

  async function upload(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    let done = 0;
    for (const file of files) {
      // Quick feedback only: the server re-checks the real type from the file's bytes and enforces the limits.
      const kind = guessKind(file);
      const cap = kind && limits ? limits[`${kind}Bytes`] : null;
      if (!kind) {
        toast.error(`“${file.name}” isn’t a supported file type (JPEG, PNG, GIF, WebP, MP4, MOV, WebM or PDF).`);
        continue;
      }
      if (cap && file.size > cap) {
        toast.error(`“${file.name}” is ${formatBytes(file.size)}; the limit for this type is ${formatBytes(cap)}.`);
        continue;
      }
      try {
        await contentApi.upload(content.id, file);
        done += 1;
      } catch (ex) {
        toast.error(`“${file.name}”: ${ex.message}`);
        if (ex.code === 'TOO_MANY_ASSETS') break;
      }
    }
    if (done) toast.success(done === 1 ? 'File uploaded' : `${done} files uploaded`);
    setBusy(false);
    if (input.current) input.current.value = '';
    if (done) onChanged();
  }

  async function confirmRemove() {
    setRemoveBusy(true);
    try {
      await contentApi.removeAsset(content.id, removing.id);
      toast.success('File removed');
      setRemoving(null);
      onChanged();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => (e.preventDefault(), setDragging(false), !full && upload(e.dataTransfer.files))}
          className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white'}`}
        >
          <UploadCloud className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
          <p className="mt-2 text-sm text-slate-700">Drag files here, or</p>
          <input ref={input} id="asset-input" type="file" multiple accept={accept} className="sr-only" onChange={(e) => upload(e.target.files)} disabled={busy || full} />
          <label
            htmlFor="asset-input"
            className={`mt-2 inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 ${busy || full ? 'pointer-events-none opacity-50' : ''}`}
          >
            {busy ? 'Uploading…' : 'Choose files'}
          </label>
          <p className="mt-3 text-xs text-slate-500">
            JPEG, PNG, GIF, WebP · MP4, MOV, WebM · PDF
            {limits && ` · up to ${formatBytes(limits.imageBytes)} images, ${formatBytes(limits.videoBytes)} video, ${formatBytes(limits.documentBytes)} PDFs`}
            {` · ${content.assets.length} of ${max} files`}
          </p>
        </div>
      ) : (
        <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {content.archived ? 'Archived content can’t be changed. Restore it to add or remove files.' : 'Published content is locked, so files can’t be added or removed.'}
        </p>
      )}

      {content.assets.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={UploadCloud} title="No files yet" description="Attach the images, videos or PDFs for this content." />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.assets.map((a) => (
            <Preview key={a.id} asset={a} canEdit={canEdit} onRemove={setRemoving} />
          ))}
        </ul>
      )}

      <Modal
        open={!!removing}
        onClose={() => !removeBusy && setRemoving(null)}
        title="Remove this file?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={removeBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRemove} loading={removeBusy}>
              Remove file
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">“{removing?.name}” will be permanently deleted from storage.</p>
      </Modal>
    </div>
  );
}
