import { useEffect, useState } from 'react'
import { Copy, Link2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { api } from '@/lib/api'
import type { Note } from '@/lib/notes'
import { createShareLink } from '@/lib/share'
import { shortDate } from '@/lib/time'
import { useI18n } from '@/i18n'
import type { ShareInfo } from '../../shared/types'

type Expiry = '1' | '7' | '30' | 'never'

/** Create, copy and revoke read-only links to one note. */
export function ShareDialog({ note, open, onOpenChange }: { note: Note; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n()
  const [expiry, setExpiry] = useState<Expiry>('7')
  const [url, setUrl] = useState<string | null>(null)
  const [links, setLinks] = useState<ShareInfo[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl(null)
    api
      .listShares()
      .then((all) => setLinks(all.filter((s) => s.noteId === note.id)))
      .catch(() => setLinks([]))
  }, [open, note.id])

  const create = async () => {
    setBusy(true)
    try {
      const res = await createShareLink(note, expiry === 'never' ? null : (Number(expiry) as 1 | 7 | 30))
      setUrl(res.url)
      setLinks((l) => [res.info, ...l])
      await copy(res.url)
    } catch {
      toast.error(note.version ? t('share.failed') : t('share.notSaved'))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (u: string) => {
    try {
      await navigator.clipboard.writeText(u)
      toast(t('share.copied'))
    } catch {
      /* the link stays selectable in the field */
    }
  }

  const revoke = async (id: string) => {
    try {
      await api.revokeShare(id)
      setLinks((l) => l.filter((s) => s.id !== id))
      if (url?.includes(`/s/${id}#`)) setUrl(null)
      toast(t('share.revoked'))
    } catch {
      toast.error(t('share.revokeFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Clicks inside must not reach the note card underneath. */}
      <DialogContent onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('share.title')}</DialogTitle>
          <DialogDescription>{t('share.body')}</DialogDescription>
        </DialogHeader>
        <Segmented
          label={t('share.expires')}
          value={expiry}
          onChange={setExpiry}
          options={[
            { value: '1', label: t('share.day1') },
            { value: '7', label: t('share.day7') },
            { value: '30', label: t('share.day30') },
            { value: 'never', label: t('share.never') },
          ]}
        />
        {url && (
          <div className="flex gap-2">
            <Input readOnly aria-label={t('share.link')} value={url} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" size="icon" aria-label={t('share.copy')} title={t('share.copy')} onClick={() => void copy(url)}>
              <Copy />
            </Button>
          </div>
        )}
        {links.length > 0 && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t('share.active')}</p>
            <ul className="grid gap-2">
              {links.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {t('share.createdOn', { date: shortDate(s.createdAt) })} ·{' '}
                    {s.expiresAt ? t('share.expiresOn', { date: shortDate(s.expiresAt) }) : t('share.noExpiry')}
                  </p>
                  <Button variant="ghost" size="icon" aria-label={t('share.revoke')} title={t('share.revoke')} onClick={() => void revoke(s.id)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="mt-2">
          <Button onClick={() => void create()} disabled={busy}>
            <Link2 />
            {busy ? t('share.creating') : t('share.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
