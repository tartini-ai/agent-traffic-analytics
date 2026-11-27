import { useEffect, useRef, useState } from "react"
import { Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { asApiError } from "@/data/api"
import type { DeleteCleanup, SessionDeletion } from "@/data/session-types"
import type { SessionSummary } from "@/data/types"
import { WORDS } from "@/lib/words"

const W = WORDS.deleteSession
type Notice = { variant: "destructive" | "warn" | "info"; message: string }

function tracesLeft(outcome: DeleteCleanup | undefined) {
  return Boolean(outcome?.error || outcome?.log_cleared === false)
}

/** A successful HTTP response can still report database or backup cleanup failures. */
function noticeFor(result: SessionDeletion): Notice | null {
  if (!Array.isArray(result?.sessions)) return { variant: "destructive", message: W.unexpected }
  if (tracesLeft(result.database) || result.backups?.some(tracesLeft)) return { variant: "warn", message: W.cleanup }
  const removed = result.sessions.some((s) => s.found) || result.backups?.some((b) => b.rows > 0) || result.log_lines > 0
  return removed ? null : { variant: "info", message: W.gone }
}

export function DeleteSession({ sessionTitle, session, onDelete, onDone }: {
  sessionTitle: string; session: Pick<SessionSummary, "id" | "when">; onDelete: () => Promise<SessionDeletion>; onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const pending = useRef(false)
  useEffect(() => () => { pending.current = false }, [])

  const done = () => { setOpen(false); onDone() }
  const remove = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setNotice(null)
    let problem: Notice | null
    try {
      problem = noticeFor(await onDelete())
    } catch (error) {
      problem = { variant: "destructive", message: `${W.failed} ${asApiError(error).message}` }
    }
    // Do not redirect if the browser left this session while the server was deleting it.
    if (!pending.current) return
    pending.current = false
    setBusy(false)
    if (problem) setNotice(problem)
    else done()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (pending.current) return
      setOpen(next)
      setNotice(null)
    }}>
      <DialogTrigger asChild><Button variant="destructive" size="sm"><Trash2 aria-hidden />{W.action}</Button></DialogTrigger>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{W.title}</DialogTitle>
          <DialogDescription>{W.scope}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <span className="font-semibold">{sessionTitle}</span>
          <span className="text-muted-foreground">{session.when} · {WORDS.sessionId} <span className="font-mono break-all">{session.id}</span></span>
        </div>
        {notice && <Alert variant={notice.variant}><AlertDescription>{notice.message}</AlertDescription></Alert>}
        <DialogFooter>
          {notice?.variant === "info" ? <Button variant="outline" onClick={done}>{W.back}</Button> : <>
            <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>{busy ? W.pending : W.action}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
