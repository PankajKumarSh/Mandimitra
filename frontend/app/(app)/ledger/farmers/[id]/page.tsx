'use client';

import { useParams } from 'next/navigation';
import { StatementView } from '@/features/ledger/statement-view';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <StatementView side="farmers" id={id} />;
}
