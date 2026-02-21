import { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, ExternalLink, ShieldCheck, Sparkles, X, XCircle } from 'lucide-react';
import { APP_CONFIG } from '../config/appConfig';
import { CARD_PROPERTY_IDS } from '../config/database';
import { useBoardStore } from '../store/boardStore';
import type { PropertyDefinition, ServiceCard, Status } from '../types/board';
import { createDateInputFromTodayOffset, getAppointmentBadge } from '../utils/scheduling';
import { cx } from '../utils/cx';

type SlotSuggestion = {
  date: string;
  timeLabel: string;
  label: string;
  startIso: string;
  endIso: string;
};

type DispatchProposal = {
  cardId: string;
  title: string;
  status: Status;
  score: number;
  reasons: string[];
  missing: string[];
};

type ProposalOutcome = 'approved' | 'dismissed';

type DispatchRuntimeConfig = {
  enabled?: boolean;
  minScore?: number;
  maxDailySlots?: number;
  requiredFields?: string;
  scoreWeights?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onRunGoogleSync?: () => Promise<void> | void;
  dispatchConfig?: DispatchRuntimeConfig;
  onProposalOutcome?: (outcome: ProposalOutcome) => void;
};

type DispatchRules = {
  enabled: boolean;
  minScore: number;
  maxDailySlots: number;
  requiredFields: Set<string>;
  weights: {
    eingang: number;
    warteschlange: number;
    termin_ohne_datum: number;
    ueberfaellig: number;
    missing_date: number;
    missing_address: number;
    missing_phone: number;
    missing_source: number;
    no_comment: number;
    age_per_day: number;
    age_max: number;
  };
};

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll('ae', 'a')
    .replaceAll('oe', 'o')
    .replaceAll('ue', 'u')
    .replaceAll('ss', 's')
    .replace(/[^a-z0-9]/g, '');

const parseCsv = (value: string): string[] =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const DEFAULT_DISPATCH_RULES: DispatchRules = {
  enabled: true,
  minScore: 55,
  maxDailySlots: 3,
  requiredFields: new Set(['date', 'address', 'source']),
  weights: {
    eingang: 80,
    warteschlange: 65,
    termin_ohne_datum: 85,
    ueberfaellig: 95,
    missing_date: 18,
    missing_address: 12,
    missing_phone: 8,
    missing_source: 6,
    no_comment: 6,
    age_per_day: 2,
    age_max: 24,
  },
};

const parseScoreWeights = (raw: string | undefined): DispatchRules['weights'] => {
  const base = { ...DEFAULT_DISPATCH_RULES.weights };
  const entries = parseCsv(raw ?? '');
  for (const entry of entries) {
    const [left, right] = entry.split(':');
    if (!left || right === undefined) continue;
    const key = normalizeKey(left);
    const value = Number(right);
    if (!Number.isFinite(value)) continue;
    const matchKey = Object.keys(base).find((candidate) => normalizeKey(candidate) === key);
    if (!matchKey) continue;
    base[matchKey as keyof DispatchRules['weights']] = value;
  }
  return base;
};

const normalizeRequiredFieldKey = (raw: string): string | null => {
  const key = normalizeKey(raw);
  if (!key) return null;
  if (['source', 'quelle', 'kanal', 'eingang', 'herkunft'].includes(key)) return 'source';
  if (['location', 'ort', 'city', 'stadt'].includes(key)) return 'location';
  if (['address', 'adresse'].includes(key)) return 'address';
  if (['phone', 'telefon', 'tel', 'mobil'].includes(key)) return 'phone';
  if (['date', 'datum', 'termin'].includes(key)) return 'date';
  if (['time', 'uhrzeit', 'zeit'].includes(key)) return 'time';
  return key;
};

const normalizeDispatchRules = (config?: DispatchRuntimeConfig): DispatchRules => ({
  enabled: config?.enabled ?? DEFAULT_DISPATCH_RULES.enabled,
  minScore: clampNumber(config?.minScore, 0, 200, DEFAULT_DISPATCH_RULES.minScore),
  maxDailySlots: clampNumber(config?.maxDailySlots, 1, 20, DEFAULT_DISPATCH_RULES.maxDailySlots),
  requiredFields: (() => {
    const rawRequiredFields = parseCsv(config?.requiredFields ?? '');
    const baseRequiredFields = rawRequiredFields.length ? rawRequiredFields : Array.from(DEFAULT_DISPATCH_RULES.requiredFields);
    return new Set(baseRequiredFields.map((entry) => normalizeRequiredFieldKey(entry)).filter((entry): entry is string => Boolean(entry)));
  })(),
  weights: parseScoreWeights(config?.scoreWeights),
});

const isLikelyTimeProperty = (property: PropertyDefinition): boolean => {
  if (property.type !== 'text') return false;
  const key = normalizeKey(`${property.id} ${property.name}`);
  return key.includes('uhrzeit') || key.includes('zeit') || key.includes('time') || key.includes('beginn') || key.includes('start');
};

const getAgeDays = (card: ServiceCard): number => {
  const ms = Date.parse(card.updatedAt || card.createdAt || '');
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
};

const getCardDate = (card: ServiceCard): string | null => {
  const fromValues = card.values?.[CARD_PROPERTY_IDS.date];
  if (typeof fromValues === 'string' && fromValues.trim()) return fromValues;
  if (typeof card.date === 'string' && card.date.trim()) return card.date;
  return null;
};

const toDispatchProposal = (card: ServiceCard, rules: DispatchRules): DispatchProposal | null => {
  if (!rules.enabled) return null;
  if (card.hiddenAt || card.status === 'Erledigt') return null;

  const date = getCardDate(card);
  const badge = getAppointmentBadge(date);
  if (card.status === 'Terminiert' && date && badge?.tone !== 'overdue') return null;

  const reasons: string[] = [];
  const missing: string[] = [];
  let score = 0;

  if (card.status === 'Eingang / Anfrage') {
    score += rules.weights.eingang;
    reasons.push('Neue Anfrage wartet auf Einsatzplanung');
  } else if (card.status === 'Warteschlange') {
    score += rules.weights.warteschlange;
  } else if (card.status === 'Terminiert' && !date) {
    score += rules.weights.termin_ohne_datum;
    reasons.push('Terminiert ohne Datum');
  } else if (card.status === 'Terminiert' && badge?.tone === 'overdue') {
    score += rules.weights.ueberfaellig;
    reasons.push('Termin ueberfaellig');
  } else {
    return null;
  }

  if (!date) {
    score += rules.weights.missing_date;
    missing.push('Datum');
  }
  if (badge?.tone === 'overdue') {
    score += Math.max(0, Math.floor(rules.weights.ueberfaellig * 0.35));
  }
  if (!(card.address ?? '').trim()) {
    score += rules.weights.missing_address;
    missing.push('Adresse');
  }
  if (!(card.phone ?? '').trim()) {
    score += rules.weights.missing_phone;
    missing.push('Telefon');
  }
  if (!Array.isArray(card.sources) || card.sources.length === 0) {
    score += rules.weights.missing_source;
    missing.push('Quelle');
  }
  if (Array.isArray(card.comments) && card.comments.length === 0) {
    score += rules.weights.no_comment;
    reasons.push('Keine Rueckmeldung dokumentiert');
  }

  const ageDays = getAgeDays(card);
  if (ageDays >= 2) {
    score += Math.min(rules.weights.age_max, ageDays * rules.weights.age_per_day);
    reasons.push(`Offen seit ${ageDays} Tagen`);
  }

  if (score < rules.minScore) return null;

  return {
    cardId: card.id,
    title: card.title,
    status: card.status,
    score,
    reasons,
    missing,
  };
};

export function DispatchCenter({ open, onClose, onRunGoogleSync, dispatchConfig, onProposalOutcome }: Props) {
  const cardsById = useBoardStore((s) => s.cardsById);
  const database = useBoardStore((s) => s.database);
  const openCard = useBoardStore((s) => s.openCard);
  const moveCardToStatus = useBoardStore((s) => s.moveCardToStatus);
  const updateCardValue = useBoardStore((s) => s.updateCardValue);
  const updateCard = useBoardStore((s) => s.updateCard);
  const addComment = useBoardStore((s) => s.addComment);

  const [slotSuggestions, setSlotSuggestions] = useState<SlotSuggestion[]>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [slotIndexByCardId, setSlotIndexByCardId] = useState<Record<string, number>>({});
  const [proposalOutcome, setProposalOutcome] = useState<Record<string, ProposalOutcome>>({});
  const [busyCardId, setBusyCardId] = useState('');
  const [dispatchMessage, setDispatchMessage] = useState('');

  const rules = useMemo(() => normalizeDispatchRules(dispatchConfig), [dispatchConfig]);

  const timeProperty = useMemo(
    () => database.properties.find((property) => isLikelyTimeProperty(property)) ?? null,
    [database.properties],
  );

  const proposals = useMemo(() => {
    if (!rules.enabled) return [];
    const items = Object.values(cardsById)
      .map((card) => toDispatchProposal(card, rules))
      .filter((entry): entry is DispatchProposal => Boolean(entry))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'de'));
    return items.slice(0, 20);
  }, [cardsById, rules]);

  const pendingProposals = useMemo(
    () => proposals.filter((proposal) => !proposalOutcome[proposal.cardId]),
    [proposalOutcome, proposals],
  );

  const fetchSlots = async () => {
    setSlotLoading(true);
    setSlotError('');
    try {
      const top = Math.max(6, Math.min(30, pendingProposals.length * 3));
      const response = await fetch('/api/google/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: APP_CONFIG.scheduling.timezone,
          workdayStart: APP_CONFIG.scheduling.workdayStart,
          workdayEnd: APP_CONFIG.scheduling.workdayEnd,
          durationMin: APP_CONFIG.scheduling.defaultAppointmentDurationMin,
          businessDays: APP_CONFIG.scheduling.businessDays,
          top,
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(raw || `Google Slot API Fehler (${response.status})`);
      }
      const parsed = raw ? (JSON.parse(raw) as { suggestions?: unknown[] }) : { suggestions: [] };
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null;
              const candidate = entry as Record<string, unknown>;
              if (typeof candidate.date !== 'string' || typeof candidate.timeLabel !== 'string') return null;
              return {
                date: candidate.date,
                timeLabel: candidate.timeLabel,
                label:
                  typeof candidate.label === 'string' && candidate.label.trim()
                    ? candidate.label
                    : `${candidate.date} ${candidate.timeLabel}`,
                startIso: typeof candidate.startIso === 'string' ? candidate.startIso : '',
                endIso: typeof candidate.endIso === 'string' ? candidate.endIso : '',
              } satisfies SlotSuggestion;
            })
            .filter((entry): entry is SlotSuggestion => Boolean(entry))
        : [];

      setSlotSuggestions(suggestions);
      setSlotIndexByCardId((prev) => {
        const next = { ...prev };
        for (const [idx, proposal] of pendingProposals.entries()) {
          if (typeof next[proposal.cardId] === 'number') continue;
          next[proposal.cardId] = idx;
        }
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Slot-Vorschlaege konnten nicht geladen werden.';
      setSlotError(message);
    } finally {
      setSlotLoading(false);
    }
  };

  const getSlotForProposal = (proposal: DispatchProposal, fallbackIndex: number): SlotSuggestion | null => {
    if (slotSuggestions.length === 0) return null;
    const rawIndex = slotIndexByCardId[proposal.cardId] ?? fallbackIndex;
    const safeIndex = ((rawIndex % slotSuggestions.length) + slotSuggestions.length) % slotSuggestions.length;
    return slotSuggestions[safeIndex] ?? null;
  };

  const cycleSlot = (proposal: DispatchProposal, fallbackIndex: number) => {
    if (slotSuggestions.length === 0) return;
    const current = slotIndexByCardId[proposal.cardId] ?? fallbackIndex;
    setSlotIndexByCardId((prev) => ({
      ...prev,
      [proposal.cardId]: (current + 1) % slotSuggestions.length,
    }));
  };

  const approveProposal = async (proposal: DispatchProposal, fallbackIndex: number) => {
    const card = cardsById[proposal.cardId];
    if (!card) return;

    setBusyCardId(proposal.cardId);
    try {
      const slot = getSlotForProposal(proposal, fallbackIndex);
      const targetDate = slot?.date ?? createDateInputFromTodayOffset(1);
      const targetTimeLabel = slot?.timeLabel ?? '09:00 Uhr';

      const requiredMissing = new Set<string>();
      for (const requiredKey of rules.requiredFields) {
        if (requiredKey === 'date') {
          if (!targetDate) requiredMissing.add('Datum');
          continue;
        }
        if (requiredKey === 'address' && !(card.address ?? '').trim()) {
          requiredMissing.add('Adresse');
          continue;
        }
        if (requiredKey === 'phone' && !(card.phone ?? '').trim()) {
          requiredMissing.add('Telefon');
          continue;
        }
        if (requiredKey === 'source' && (!Array.isArray(card.sources) || card.sources.length === 0)) {
          updateCard(proposal.cardId, { sources: [APP_CONFIG.defaults.fallbackSource] });
        }
        if (requiredKey === 'location' && !(card.location ?? '').trim()) {
          requiredMissing.add('Ort');
          continue;
        }
        if (requiredKey === 'time') {
          if (!timeProperty) {
            requiredMissing.add('Uhrzeit-Feld');
            continue;
          }
          const existingTime = card.values?.[timeProperty.id];
          if (typeof existingTime !== 'string' || !existingTime.trim()) {
            if (!targetTimeLabel.trim()) {
              requiredMissing.add('Uhrzeit');
            }
          }
        }
      }
      if (requiredMissing.size > 0) {
        setDispatchMessage(`Freigabe blockiert (${proposal.title}): ${Array.from(requiredMissing).join(', ')} fehlt.`);
        return;
      }

      updateCardValue(proposal.cardId, CARD_PROPERTY_IDS.date, targetDate);
      if (timeProperty) {
        updateCardValue(proposal.cardId, timeProperty.id, targetTimeLabel);
      }
      if (card.status !== 'Terminiert') {
        moveCardToStatus(proposal.cardId, 'Terminiert', 'Dispatch Agent');
      }

      addComment(
        proposal.cardId,
        `Dispatch Agent freigegeben: Termin ${targetDate}${timeProperty ? ` ${targetTimeLabel}` : ''}.`,
        'Dispatch Agent',
      );
      setProposalOutcome((prev) => ({ ...prev, [proposal.cardId]: 'approved' }));
      onProposalOutcome?.('approved');
      setDispatchMessage(`Freigegeben: ${proposal.title}`);
    } finally {
      setBusyCardId('');
    }
  };

  const dismissProposal = (proposal: DispatchProposal) => {
    setProposalOutcome((prev) => ({ ...prev, [proposal.cardId]: 'dismissed' }));
    onProposalOutcome?.('dismissed');
    addComment(proposal.cardId, 'Dispatch Agent: Vorschlag verworfen.', 'Dispatch Agent');
  };

  const approveTopThree = async () => {
    if (pendingProposals.length === 0) return;
    if (slotSuggestions.length === 0) {
      await fetchSlots();
    }
    const targets = pendingProposals.slice(0, rules.maxDailySlots);
    for (const [idx, proposal] of targets.entries()) {
      await approveProposal(proposal, idx);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Dispatch Center (Freigabe)</h2>
            <p className="text-sm text-gray-500">
              Priorisierte Einsatzvorschlaege mit manueller Freigabe. Ziel: von Eingang zu Terminierung in Minuten.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
            aria-label="Schliessen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Proposals</p>
            <p className="text-lg font-semibold text-gray-900">{proposals.length}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Freigegeben</p>
            <p className="text-lg font-semibold text-emerald-800">
              {Object.values(proposalOutcome).filter((entry) => entry === 'approved').length}
            </p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs text-rose-700">Verworfen</p>
            <p className="text-lg font-semibold text-rose-800">
              {Object.values(proposalOutcome).filter((entry) => entry === 'dismissed').length}
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs text-blue-700">Offen</p>
            <p className="text-lg font-semibold text-blue-800">{pendingProposals.length}</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchSlots()}
            disabled={slotLoading}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CalendarClock className="h-4 w-4" />
            {slotLoading ? 'Slots werden geladen...' : 'Slots laden'}
          </button>
          <button
            type="button"
            onClick={() => void approveTopThree()}
            disabled={pendingProposals.length === 0 || !!busyCardId}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            Top {rules.maxDailySlots} freigeben
          </button>
          {onRunGoogleSync ? (
            <button
              type="button"
              onClick={() => void onRunGoogleSync()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Sparkles className="h-4 w-4" />
              Google Sync jetzt
            </button>
          ) : null}
          {slotError ? <p className="text-xs text-rose-700">{slotError}</p> : null}
          {dispatchMessage ? <p className="text-xs text-gray-600">{dispatchMessage}</p> : null}
        </div>

        {proposals.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="inline-flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              Kein Dispatch-Stau erkannt.
            </div>
            <p className="mt-1">Aktuell sind keine offenen Karten fuer den Freigabe-Flow priorisiert.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {proposals.map((proposal, idx) => {
              const outcome = proposalOutcome[proposal.cardId];
              const slot = getSlotForProposal(proposal, idx);
              const isBusy = busyCardId === proposal.cardId;
              return (
                <div key={proposal.cardId} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
                      Score {proposal.score}
                    </span>
                    <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{proposal.status}</span>
                    {outcome === 'approved' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Freigegeben
                      </span>
                    ) : null}
                    {outcome === 'dismissed' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                        <XCircle className="h-3.5 w-3.5" />
                        Verworfen
                      </span>
                    ) : null}
                  </div>

                  <p className="text-sm font-semibold text-gray-900">{proposal.title}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Gruende: {proposal.reasons.length ? proposal.reasons.join(' | ') : 'Priorisiert nach Regelwerk'}
                  </p>
                  {proposal.missing.length ? (
                    <p className="mt-1 text-xs text-amber-700">Fehlend: {proposal.missing.join(', ')}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cx(
                        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs',
                        slot ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700',
                      )}
                    >
                      <Clock3 className="h-3.5 w-3.5" />
                      {slot ? `Vorschlag: ${slot.label}` : 'Kein Slot geladen, Fallback: morgen 09:00'}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openCard(proposal.cardId);
                        onClose();
                      }}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Oeffnen
                    </button>

                    <button
                      type="button"
                      onClick={() => cycleSlot(proposal, idx)}
                      disabled={!slotSuggestions.length || !!outcome}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Naechster Slot
                    </button>

                    <button
                      type="button"
                      onClick={() => void approveProposal(proposal, idx)}
                      disabled={Boolean(outcome) || isBusy}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isBusy ? 'Freigabe...' : 'Freigeben'}
                    </button>

                    <button
                      type="button"
                      onClick={() => dismissProposal(proposal)}
                      disabled={Boolean(outcome) || isBusy}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Verwerfen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
