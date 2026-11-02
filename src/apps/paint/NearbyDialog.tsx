// Send to a device / Receive from a device. The sender shows an offer as a QR
// code; the receiver scans it (or opens its #rtc= link), answers with a code of
// its own, and the sender scans or pastes that back. The drawing then goes over
// the direct connection in lib/nearby.ts, once the receiver has said yes.
import { useEffect, useRef, useState } from "react";
import { useT, type MsgKey } from "../../i18n/index.ts";
import { answerOffer, createOffer, NearbyError, opened, receivePayload, RTC_PREFIX, sendPayload, type Payload } from "../../lib/nearby.ts";
import { CameraError, qrMatrix, qrPath, startScan } from "../../lib/qrScan.ts";
import { Dialog } from "../../ui/Dialog.tsx";

// shortcut: Paint97 has no fixed deployed URL, so a code made on localhost
// holds only the code (for the other device's in-app Receive scanner, since a
// phone cannot open this machine's localhost); give it a URL if one is set up.
function linkFor(code: string): string {
  const { protocol, hostname } = location;
  const local = protocol === "file:" || hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127.");
  return local ? RTC_PREFIX.slice(1) + code : location.origin + location.pathname + RTC_PREFIX + code;
}

const keyOf = (error: unknown): MsgKey =>
  error instanceof NearbyError || error instanceof CameraError ? error.key : "nearby.failed";

const sizeOf = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`);

type Props = {
  /** What to send; absent for Receive. */
  send?: Payload;
  /** A pairing code from a #rtc= link, for Receive. */
  offer?: string;
  onClose: () => void;
  /** Called once, with what happened; a received drawing rides along. */
  onDone: (result: "sent" | "declined" | Payload) => void;
};

export function NearbyDialog({ send, offer, onClose, onDone }: Props) {
  const t = useT();
  const [help, setHelp] = useState<MsgKey>(send ? "nearby.making" : offer ? "nearby.offerHelp" : "nearby.receiveHelp");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<MsgKey | null>(null);
  const [qr, setQr] = useState<{ count: number; path: string } | null>(null);
  const [copyable, setCopyable] = useState<{ text: string; label: MsgKey } | null>(null);
  const [entry, setEntry] = useState(!send && !offer);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [question, setQuestion] = useState<{ title: string; bytes: number; answer: (yes: boolean) => void } | null>(null);
  const [connectOffer, setConnectOffer] = useState(Boolean(offer));
  const [retry, setRetry] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stopCamera = useRef<(() => void) | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const closed = useRef(false);
  const busy = useRef(false);
  const takeCode = useRef<(text: string) => Promise<void>>(() => Promise.resolve());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const fail = (cause: unknown) => { setStatus(""); setError(keyOf(cause)); };
  const showQr = async (text: string) => {
    const matrix = await qrMatrix(text);
    setQr({ count: matrix.count, path: qrPath(matrix) });
  };
  const camera = (on: boolean) => {
    stopCamera.current?.();
    stopCamera.current = null;
    setScanning(on);
  };

  /** Receiving side: answer the offer, show the answer, take the payload. */
  const answer = async (text: string) => {
    const connection = await answerOffer(text);
    if (closed.current) { connection.pc.close(); return; }
    pc.current?.close();
    pc.current = connection.pc;
    setRetry(null);
    setEntry(false);
    camera(false);
    setHelp("nearby.answerHelp");
    await showQr(connection.code);
    setCopyable({ text: connection.code, label: "nearby.copyCode" });
    setStatus(t("nearby.waitingSender"));
    try {
      const channel = await connection.channel;
      await opened(channel);
      setQr(null);
      setCopyable(null);
      const payload = await receivePayload(channel, {
        confirm: ({ title, bytes }) => new Promise<boolean>((resolve) => {
          setStatus(t("nearby.ask", { title: title || "untitled", size: sizeOf(bytes) }));
          setQuestion({ title, bytes, answer: (yes) => { setQuestion(null); setStatus(yes ? t("nearby.receiving") : ""); resolve(yes); } });
        }),
      });
      doneRef.current(payload ?? "declined");
    } catch (cause) {
      fail(cause);
      setQr(null);
      setCopyable(null);
      // The sender's offer stays open until it takes an answer, so a fresh one still works.
      setRetry(text);
    }
  };

  useEffect(() => {
    closed.current = false;
    if (send) {
      void (async () => {
        try {
          const connection = await createOffer();
          if (closed.current) { connection.pc.close(); return; }
          pc.current = connection.pc;
          const link = linkFor(connection.code);
          await showQr(link);
          setCopyable({ text: link, label: "nearby.copyLink" });
          setHelp("nearby.sendHelp");
          setEntry(true);
          takeCode.current = async (reply) => {
            await connection.accept(reply);
            setEntry(false);
            camera(false);
            setQr(null);
            setCopyable(null);
            setStatus(t("nearby.connecting"));
            try {
              await opened(connection.channel);
              setStatus(t("nearby.waitingAccept"));
              doneRef.current((await sendPayload(connection.channel, send)) ? "sent" : "declined");
            } catch (cause) { fail(cause); }
          };
        } catch (cause) { fail(cause); }
      })();
    } else {
      takeCode.current = answer;
    }
    return () => {
      closed.current = true;
      stopCamera.current?.();
      pc.current?.close();
    };
    // Mount-only: one dialog is one pairing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Run one code through whichever side this dialog is. */
  const attempt = async (text: string) => {
    if (busy.current || !text.trim()) return false;
    busy.current = true;
    setError(null);
    try { await takeCode.current(text); return true; }
    catch (cause) { fail(cause); return false; }
    finally { busy.current = false; }
  };

  useEffect(() => {
    if (!scanning || !video.current) return;
    let cancelled = false;
    startScan(video.current, (text) => void attempt(text).then((ok) => { if (ok) camera(false); }))
      .then((stop) => { if (cancelled) stop(); else stopCamera.current = stop; })
      .catch((cause) => { if (!cancelled) { setScanning(false); fail(cause); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const copy = async () => {
    if (!copyable) return;
    try { await navigator.clipboard.writeText(copyable.text); setStatus(t("nearby.copied")); }
    catch { setError("paint.clipFail"); }
  };

  return (
    <Dialog
      title={t(send ? "nearby.sendTitle" : "nearby.receiveTitle")}
      onClose={onClose}
      buttons={<>
        {question && <><button data-autofocus onClick={() => question.answer(true)}>{t("nearby.accept")}</button><button onClick={() => question.answer(false)}>{t("nearby.decline")}</button></>}
        {connectOffer && offer && <button data-autofocus onClick={() => { setConnectOffer(false); void attempt(offer); }}>{t("nearby.connect")}</button>}
        {entry && <button onClick={() => camera(!scanning)}>{t("nearby.scan")}</button>}
        {entry && <button onClick={() => void attempt(code)}>{t("nearby.connect")}</button>}
        {copyable && <button onClick={() => void copy()}>{t(copyable.label)}</button>}
        {retry && <button onClick={() => void attempt(retry)}>{t("nearby.newCode")}</button>}
        <button onClick={onClose}>{t("ui.close")}</button>
      </>}
    >
      <div className="nearby">
        <p>{t(help)}</p>
        {error && <p role="alert" className="nearby-error">{t(error)}</p>}
        {qr && (
          <svg className="nearby-qr" role="img" aria-label={t("nearby.qr")} viewBox={`0 0 ${qr.count + 8} ${qr.count + 8}`} shapeRendering="crispEdges">
            <rect width="100%" height="100%" fill="#fff" />
            <path d={qr.path} fill="#000" />
          </svg>
        )}
        {scanning && <video ref={video} className="nearby-camera" aria-label={t("nearby.camera")} />}
        {entry && (
          <div className="field-row-stacked">
            <label htmlFor="nearby-code">{t("nearby.paste")}</label>
            <input id="nearby-code" type="text" autoComplete="off" spellCheck={false} value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void attempt(code); } }} />
          </div>
        )}
        <p role="status" aria-live="polite">{status}</p>
      </div>
    </Dialog>
  );
}
