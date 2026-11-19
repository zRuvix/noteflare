import { useState, type FormEvent } from 'react'
import { Fingerprint, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useVault } from '@/lib/vault'
import { WrongSecretError } from '@/lib/crypto'
import { defaultPasskeyName, PasskeyCancelledError, PasskeyNoPrfError } from '@/lib/passkeys'
import { shortDate } from '@/lib/time'
import { useI18n } from '@/i18n'

/** List, add and remove the passkeys that unlock this vault. */
export function PasskeysDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n()
  const { passkeys, addPasskey, removePasskey } = useVault()
  const [name, setName] = useState(defaultPasskeyName)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPass('')
    setName(defaultPasskeyName())
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pass) return setError(t('unlock.enterPassphrase'))
    setBusy(true)
    setError(null)
    try {
      await addPasskey(pass, name.trim() || defaultPasskeyName())
      toast(t('pk.added'))
      reset()
    } catch (err) {
      if (err instanceof PasskeyCancelledError) setError(null)
      else setError(err instanceof WrongSecretError ? t('pk.wrongPassphrase') : err instanceof PasskeyNoPrfError ? t('pk.noPrf') : t('pk.failed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await removePasskey(id)
      toast(t('pk.removed'))
    } catch {
      toast.error(t('pk.removeFailed'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pk.title')}</DialogTitle>
          <DialogDescription>{t('pk.body')}</DialogDescription>
        </DialogHeader>
        {passkeys.length ? (
          <ul className="grid gap-2">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Fingerprint className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{t('pk.addedOn', { date: shortDate(p.createdAt) })}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={t('pk.remove', { name: p.name })} title={t('pk.remove', { name: p.name })} onClick={() => void remove(p.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('pk.none')}</p>
        )}
        <form onSubmit={submit} className="grid gap-3">
          <Input aria-label={t('pk.name')} placeholder={t('pk.name')} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="password" autoComplete="current-password" aria-label={t('pk.passphrase')} placeholder={t('pk.passphrase')} value={pass} onChange={(e) => setPass(e.target.value)} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="mt-2">
            <Button type="submit" disabled={busy || !pass}>
              <Fingerprint />
              {busy ? t('pk.adding') : t('pk.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
