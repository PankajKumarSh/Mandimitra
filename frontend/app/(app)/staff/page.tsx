'use client';

import { Copy, History, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Spinner } from '@/components/ui';
import { ApprovalsPanel } from '@/features/staff/approvals';
import { useCan, useT, useToast } from '@/hooks';
import { formatDate, formatDateTime, formatMobile } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCreateInviteMutation, useRevokeInviteMutation, useStaffActivityQuery, useStaffQuery, useUpdateMembershipMutation } from '@/services/api';

function ActivityModal({ membershipId, onClose }: { membershipId: string | null; onClose: () => void }) {
  const { t, lang } = useT();
  const q = useStaffActivityQuery(membershipId!, { skip: !membershipId });
  return (
    <Modal open={!!membershipId} onClose={onClose} title={t('staff.loginHistory')} wide>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorState message={apiError(q.error).message} /> : !q.data?.length ? <EmptyState title={t('common.noResults')} /> : (
        <ul className="divide-y divide-line text-sm">
          {q.data.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-medium">{a.activityType.replaceAll('_', ' ')}</span>
              <span className="num text-ink-3">{formatDateTime(a.createdAt, lang)} · {a.ipAddress ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function StaffPage() {
  const { t, lang } = useT();
  const can = useCan();
  const toast = useToast();
  const list = useStaffQuery();
  const [invite, inviteState] = useCreateInviteMutation();
  const [revoke] = useRevokeInviteMutation();
  const [updateMember, updateState] = useUpdateMembershipMutation();
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ mobile: '', fullName: '', roleKey: 'MUNIM' });
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; status: 'ACTIVE' | 'DEACTIVATED' } | null>(null);
  const manage = can('staff:manage');

  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const r = await invite({ mobile: form.mobile, roleKey: form.roleKey, ...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}) }).unwrap();
      setLink(r.inviteUrl);
      setForm({ mobile: '', fullName: '', roleKey: 'MUNIM' });
    } catch (err) {
      const ae = apiError(err);
      setError(Array.isArray(ae.details) ? (ae.details as { message: string }[]).map((d) => d.message).join(' · ') : ae.message);
    }
  };

  const roleName = (r: { key: string; name: string; nameHindi?: string | null }) => (lang === 'hi' ? (r.nameHindi ?? r.name) : r.name);

  return (
    <>
      <PageHeader title={t('staff.title')} action={manage && <Button onClick={() => { setLink(null); setInviting(true); }}><Plus className="size-4" aria-hidden /> {t('staff.invite')}</Button>} />
      {can('approval:decide') && <div className="mb-5"><ApprovalsPanel /></div>}
      {list.isError ? <Card><ErrorState message={apiError(list.error).message} onRetry={list.refetch} /></Card> : list.isLoading || !list.data ? <Skeleton className="h-48" /> : (
        <div className="flex flex-col gap-5">
          <Card className="overflow-hidden [&>div]:p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('auth.fullName')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('staff.role')}</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{t('staff.lastLogin')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.members.map((m) => (
                    <tr key={m.membershipId} className="border-t border-line">
                      <td className="px-4 py-3">
                        <span className="font-medium">{m.user.fullName}</span>
                        <span className="num block text-sm text-ink-3">{formatMobile(m.user.mobile)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {m.isOwner ? <Badge tone="green">{t('staff.owner')}</Badge> : manage && m.status === 'ACTIVE' ? (
                          <Select aria-label={t('staff.role')} value={m.role.key} disabled={updateState.isLoading} className="h-9 w-40" onChange={async (e) => {
                            try {
                              await updateMember({ id: m.membershipId, roleKey: e.target.value }).unwrap();
                              toast.success(t('common.saved'));
                            } catch (err) { toast.error(apiError(err).message); }
                          }}>
                            <option value="MUNIM">{lang === 'hi' ? 'मुनीम' : 'Munim / Accountant'}</option>
                            <option value="VIEWER">{lang === 'hi' ? 'केवल देखने वाला' : 'Read-only'}</option>
                          </Select>
                        ) : <span className="text-ink-2">{roleName(m.role)}</span>}
                        {m.status === 'DEACTIVATED' && <Badge tone="red">{t('common.inactive')}</Badge>}
                      </td>
                      <td className="num hidden px-4 py-3 text-sm text-ink-2 sm:table-cell">{formatDateTime(m.user.lastLoginAt, lang)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setHistory(m.membershipId)} aria-label={t('staff.loginHistory')}><History className="size-4" aria-hidden /></Button>
                          {manage && !m.isOwner && (
                            <Button size="sm" variant="secondary" onClick={() => setConfirm({ id: m.membershipId, status: m.status === 'ACTIVE' ? 'DEACTIVATED' : 'ACTIVE' })}>
                              {m.status === 'ACTIVE' ? t('staff.deactivate') : t('staff.activate')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {list.data.invites.length > 0 && (
            <Card title={t('staff.pending')}>
              <ul className="divide-y divide-line">
                {list.data.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span>
                      <span className="font-medium">{i.fullName ?? formatMobile(i.mobile)}</span>
                      <span className="block text-sm text-ink-3">{formatMobile(i.mobile)} · {i.role.name} · {formatDate(i.expiresAt, lang)}</span>
                    </span>
                    {manage && <Button size="sm" variant="ghost" onClick={async () => { try { await revoke(i.id).unwrap(); toast.success(t('common.deleted')); } catch (err) { toast.error(apiError(err).message); } }}>{t('staff.revoke')}</Button>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Modal open={inviting} onClose={() => setInviting(false)} title={t('staff.invite')}>
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">{t('staff.inviteLink')}</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="num text-sm" onFocus={(e) => e.target.select()} />
              <Button variant="secondary" aria-label={t('common.copy')} onClick={async () => {
                try { await navigator.clipboard.writeText(link); toast.success(t('common.copied')); } catch { /* clipboard blocked: field is selectable */ }
              }}><Copy className="size-4" aria-hidden /></Button>
            </div>
            <div className="flex justify-end"><Button onClick={() => setInviting(false)}>{t('common.close')}</Button></div>
          </div>
        ) : (
          <form onSubmit={submitInvite} className="flex flex-col gap-4">
            <Field label={t('auth.mobile')} htmlFor="i-mobile" required>
              <Input id="i-mobile" type="tel" inputMode="numeric" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} required />
            </Field>
            <Field label={t('auth.fullName')} htmlFor="i-name" hint={t('common.optional')}>
              <Input id="i-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label={t('staff.role')} htmlFor="i-role">
              <Select id="i-role" value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
                <option value="MUNIM">{lang === 'hi' ? 'मुनीम — एंट्री कर सकता है' : 'Munim — can enter transactions'}</option>
                <option value="VIEWER">{lang === 'hi' ? 'केवल देखने वाला' : 'Read-only'}</option>
              </Select>
            </Field>
            {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
            <div className="flex justify-end"><Button type="submit" loading={inviteState.isLoading}>{t('staff.invite')}</Button></div>
          </form>
        )}
      </Modal>

      <ActivityModal membershipId={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={!!confirm}
        title={t('common.areYouSure')}
        message={confirm?.status === 'DEACTIVATED' ? t('staff.deactivate') : t('staff.activate')}
        danger={confirm?.status === 'DEACTIVATED'}
        loading={updateState.isLoading}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try { await updateMember({ id: confirm!.id, status: confirm!.status }).unwrap(); toast.success(t('common.saved')); }
          catch (err) { toast.error(apiError(err).message); }
          setConfirm(null);
        }}
      />
    </>
  );
}
