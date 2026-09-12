import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Wallet, Check, RefreshCw, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { hapticNotification } from '@/lib/haptics';

interface WalletInvoice {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  pay_link: string | null;
  direct_pay_link: string | null;
  mode: string;
  wallet_invoice_id: string | null;
  paid_at: string | null;
}

interface WalletPaymentProps {
  orderId: string;
  orderNumber?: string | null;
  amount: number;
  sessionToken?: string | null;
  onPaid: (orderId: string) => void;
  onCancel: () => void;
}

const POLL_MS = 2500;
const MAX_POLL_MS = 3 * 60 * 1000;

export function WalletPayment({
  orderId,
  orderNumber,
  amount,
  sessionToken,
  onPaid,
  onCancel,
}: WalletPaymentProps) {
  const [invoice, setInvoice] = useState<WalletInvoice | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(Date.now());

  const createInvoice = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('wallet-pay', {
        body: { action: 'create_invoice', order_id: orderId, session_token: sessionToken || undefined },
      });
      if (fnError) throw fnError;
      if (!data?.success) throw new Error(data?.error || 'Не вдалося створити рахунок');
      startedAt.current = Date.now();
      setInvoice(data.invoice);

      const link = data.invoice?.direct_pay_link || data.invoice?.pay_link;
      const tg = (window as any).Telegram?.WebApp;
      if (link) {
        if (tg?.openInvoice) tg.openInvoice(link);
        else if (tg?.openLink) tg.openLink(link);
        else window.open(link, '_blank', 'noopener');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка Wallet Pay');
    } finally {
      setIsCreating(false);
    }
  }, [orderId, sessionToken]);

  useEffect(() => {
    createInvoice();
  }, [createInvoice]);

  // Poll invoice status until paid / expired / timeout.
  useEffect(() => {
    if (!invoice || invoice.status !== 'active') return;
    const timer = setInterval(async () => {
      if (Date.now() - startedAt.current > MAX_POLL_MS) {
        clearInterval(timer);
        setError('Час очікування оплати вичерпано');
        return;
      }
      const { data } = await supabase.functions.invoke('wallet-pay', {
        body: { action: 'get_invoice_status', invoice_id: invoice.id },
      });
      if (data?.invoice) setInvoice(data.invoice);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [invoice]);

  // Realtime settlement (webhook path) — instant update without waiting for the poll.
  useEffect(() => {
    if (!invoice?.id) return;
    const channel = supabase
      .channel(`wallet_invoice_${invoice.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wallet_invoices', filter: `id=eq.${invoice.id}` },
        (payload) => setInvoice(payload.new as unknown as WalletInvoice),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [invoice?.id]);

  const isPaid = invoice?.status === 'paid';

  useEffect(() => {
    if (isPaid) {
      hapticNotification('success');
      toast.success('Оплату отримано через Telegram Wallet');
    }
  }, [isPaid]);

  if (isPaid && invoice) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center">
            <Check className="h-8 w-8 text-success" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Оплачено</h3>
          <p className="text-sm text-muted-foreground">
            Замовлення {orderNumber ? `#${orderNumber}` : ''} сплачено миттєво через Telegram Wallet
          </p>
        </div>

        {/* Чек */}
        <div className="rounded-xl border border-border p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Сума</span>
            <span className="font-semibold text-foreground">{invoice.amount} {invoice.currency}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Метод</span>
            <span className="text-foreground">Telegram Wallet</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Транзакція</span>
            <span className="text-foreground truncate max-w-[55%] text-right">{invoice.wallet_invoice_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Час</span>
            <span className="text-foreground">
              {invoice.paid_at ? new Date(invoice.paid_at).toLocaleString('uk-UA') : '—'}
            </span>
          </div>
          {invoice.mode === 'sandbox' && (
            <p className="text-[11px] text-warning pt-1">Тестовий режим (sandbox) — реальні кошти не списано</p>
          )}
        </div>

        <Button className="w-full h-12" onClick={() => onPaid(orderId)}>
          Готово
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center text-center gap-3 py-6">
        <div className="w-16 h-16 rounded-full bg-[hsl(200,85%,50%)]/15 flex items-center justify-center">
          {isCreating || invoice?.status === 'active' ? (
            <Loader2 className="h-7 w-7 animate-spin text-[hsl(200,85%,50%)]" />
          ) : (
            <Wallet className="h-7 w-7 text-[hsl(200,85%,50%)]" />
          )}
        </div>
        <h3 className="text-lg font-bold text-foreground">Оплата через Telegram Wallet</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {invoice?.mode === 'sandbox'
            ? 'Тестовий режим: оплата підтвердиться автоматично за кілька секунд.'
            : 'Підтвердьте платіж у Telegram Wallet — статус оновиться автоматично.'}
        </p>
        <div className="text-2xl font-bold text-foreground">{amount}₴</div>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {(invoice?.direct_pay_link || invoice?.pay_link) && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            const link = invoice.direct_pay_link || invoice.pay_link!;
            const tg = (window as any).Telegram?.WebApp;
            if (tg?.openInvoice) tg.openInvoice(link);
            else window.open(link, '_blank', 'noopener');
          }}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Відкрити Wallet
        </Button>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Пізніше
        </Button>
        <Button className="flex-1" onClick={createInvoice} disabled={isCreating}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Сплатити знову
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2 pt-1">
        <ShieldCheck className="h-4 w-4 text-success" />
        <span className="text-xs text-muted-foreground">Платіж проходить всередині Telegram</span>
      </div>
    </div>
  );
}
