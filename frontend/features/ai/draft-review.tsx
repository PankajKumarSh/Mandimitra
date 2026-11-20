'use client';

import { AlertTriangle, FileEdit, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Modal, Spinner } from '@/components/ui';
import { ExpenseForm } from '@/features/expenses/expense-form';
import { LotForm } from '@/features/lots/lot-form';
import { SaleForm } from '@/features/lots/sale-form';
import { PaymentForm } from '@/features/payments/payment-form';
import { useT, useToast } from '@/hooks';
import { apiError } from '@/services/base-query';
import { useAiConfirmDraftMutation, useAiDiscardDraftMutation, useLotQuery } from '@/services/api';
import type { AiDraft, Unit } from '@/types/api';

type Opt = { id: string; label: string };

function Choice({ label, options, value, onChange }: { label: string; options: Opt[]; value: string | null; onChange: (id: string) => void }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      {options.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-center gap-2 text-[15px]">
          <input type="radio" className="size-4 accent-brand-800" checked={value === o.id} onChange={() => onChange(o.id)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function SaleFromDraft({ lotId, d, buyer, onDone }: { lotId: string; d: AiDraft; buyer: Opt | null; onDone: (id: string) => void }) {
  const lot = useLotQuery(lotId);
  if (!lot.data) return <Spinner />;
  const f = d.fields;
  return (
    <SaleForm
      lot={lot.data}
      initial={{
        buyer: buyer ?? undefined,
        weight: f.quantity,
        weightUnit: (f.quantityUnit === 'TON' ? 'QUINTAL' : f.quantityUnit) as Unit,
        bags: f.bags,
        rate: f.rate,
        rateUnit: (f.rateUnit || undefined) as Unit | undefined,
        saleDate: f.date || undefined,
      }}
      onDone={(s) => onDone(s.id)}
    />
  );
}

/**
 * Shows what the AI understood, lets the human resolve ambiguity, then opens the NORMAL form prefilled.
 * Only the form's own validated endpoint saves anything; the draft is linked afterwards.
 */
export function DraftReview({ draft, onClose }: { draft: AiDraft; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [confirm] = useAiConfirmDraftMutation();
  const [discard] = useAiDiscardDraftMutation();
  const c = draft.candidates;
  const f = draft.fields;
  const [farmerId, setFarmerId] = useState<string | null>(f.farmerId);
  const [buyerId, setBuyerId] = useState<string | null>(f.buyerId);
  const [lotId, setLotId] = useState<string | null>(f.lotId);
  const [open, setOpen] = useState(false);
  const farmer = c.farmers.find((x) => x.id === farmerId) ?? null;
  const buyer = c.buyers.find((x) => x.id === buyerId) ?? null;

  const linked = async (entityType: 'Lot' | 'Sale' | 'Payment' | 'Expense', entityId: string) => {
    setOpen(false);
    try {
      await confirm({ id: draft.id, entityType, entityId }).unwrap();
      toast.success(t('ai.saved'));
    } catch (e) {
      toast.error(apiError(e).message);
    }
    onClose();
  };

  const rows: [string, string][] = (
    [
      [t('lot.farmer'), farmer?.label ?? draft.names.farmer],
      [t('sale.buyer'), buyer?.label ?? draft.names.buyer],
      [t('lot.commodity'), c.commodity?.label ?? draft.names.commodity],
      [t('sale.weight'), f.quantity && `${f.quantity} ${t(`unit.${f.quantityUnit}`)}`],
      [t('lot.bags'), f.bags],
      [t('sale.rate'), f.rate && `₹${f.rate}${f.rateUnit ? ` / ${t(`unit.${f.rateUnit}`)}`  : ''}`],
      [t('pay.amount'), f.amount && `₹${f.amount}`],
      [t('pay.mode'), draft.kind === 'PAYMENT' ? t(`pay.${f.paymentMode}`) : ''],
      [t('pay.reference'), f.reference],
      [t('exp.category'), c.category?.label ?? draft.names.category],
      [t('lot.vehicle'), f.vehicleNumber],
      [t('pay.date'), f.date],
      [t('common.notes'), f.notes],
    ] as [string, string][]
  ).filter(([, v]) => !!v);

  const canOpen =
    draft.kind === 'LOT' ? !!farmerId : draft.kind === 'SALE' ? !!lotId : draft.kind === 'PAYMENT' ? (f.paymentSide === 'BUYER' ? !!buyerId : !!farmerId) : draft.kind === 'EXPENSE';

  return (
    <Card
      title={`${t('ai.reviewDraft')} · ${draft.kind}`}
      action={
        <button onClick={async () => { await discard(draft.id).unwrap().catch(() => undefined); onClose(); }} className="rounded-md p-1 text-ink-3 hover:bg-canvas" aria-label={t('ai.discard')}>
          <X className="size-5" />
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {t('ai.confidence')}: <Badge tone={draft.confidence === 'high' ? 'green' : draft.confidence === 'medium' ? 'amber' : 'red'}>{draft.confidence}</Badge>
        </p>
        {draft.kind === 'UNKNOWN' ? (
          <p className="text-[15px] text-warn-700">{t('ai.unknownKind')}</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {c.farmers.length > 1 && <Choice label={`${t('ai.choose')}: ${t('lot.farmer')}`} options={c.farmers} value={farmerId} onChange={setFarmerId} />}
        {c.buyers.length > 1 && <Choice label={`${t('ai.choose')}: ${t('sale.buyer')}`} options={c.buyers} value={buyerId} onChange={setBuyerId} />}
        {draft.kind === 'SALE' && c.lots.length > 1 && <Choice label={`${t('ai.choose')}: ${t('lot.number')}`} options={c.lots} value={lotId} onChange={setLotId} />}
        {draft.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-700">
            {draft.warnings.map((w) => (
              <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{w}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-3">{t('ai.readOnly')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={async () => { await discard(draft.id).unwrap().catch(() => undefined); onClose(); }}>{t('ai.discard')}</Button>
          <Button onClick={() => setOpen(true)} disabled={!canOpen && draft.kind !== 'UNKNOWN'}><FileEdit className="size-4" aria-hidden /> {t('ai.openForm')}</Button>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('ai.openForm')} wide>
        {(draft.kind === 'LOT' || draft.kind === 'UNKNOWN') && (
          <LotForm
            initialFarmer={farmer ?? undefined}
            initial={{
              commodityId: c.commodity?.id,
              bags: f.bags,
              weightUnit: f.quantityUnit === 'KG' ? 'KG' : 'QUINTAL',
              grossWeight: f.quantityUnit === 'KG' || f.quantityUnit === 'QUINTAL' ? f.quantity : '',
              vehicleNumber: f.vehicleNumber,
              arrivalDate: f.date,
              remarks: f.notes,
            }}
            onDone={(lot) => linked('Lot', lot.id)}
          />
        )}
        {draft.kind === 'SALE' && lotId && <SaleFromDraft lotId={lotId} d={draft} buyer={buyer} onDone={(id) => linked('Sale', id)} />}
        {draft.kind === 'PAYMENT' && (
          <PaymentForm
            initial={f.paymentSide === 'BUYER' ? (buyer ? { side: 'BUYER', id: buyer.id, label: buyer.label } : undefined) : farmer ? { side: 'FARMER', id: farmer.id, label: farmer.label } : undefined}
            values={{
              purpose: f.paymentPurpose === 'ADVANCE' || f.paymentPurpose === 'SETTLEMENT' ? f.paymentPurpose : undefined,
              mode: f.paymentMode,
              amount: f.amount,
              referenceNumber: f.reference,
              paymentDate: f.date,
              remarks: f.notes,
            }}
            onDone={(p) => linked('Payment', p.id)}
          />
        )}
        {draft.kind === 'EXPENSE' && (
          <ExpenseForm
            initial={{ categoryId: c.category?.id, amount: f.amount, expenseDate: f.date, mode: f.paymentMode, referenceNumber: f.reference, remarks: f.notes }}
            onDone={(e) => linked('Expense', e.id)}
          />
        )}
      </Modal>
    </Card>
  );
}
