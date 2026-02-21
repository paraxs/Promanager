import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  MapPin,
  Phone,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { APP_CONFIG } from '../config/appConfig';
import { CARD_PROPERTY_IDS } from '../config/database';
import { useBoardStore } from '../store/boardStore';
import { type ServiceCard } from '../types/board';
import { createDateInputFromTodayOffset, getAppointmentBadge } from '../utils/scheduling';
import { cx } from '../utils/cx';

type RadarSeverity = 'high' | 'medium' | 'low';
type RadarKind = 'overdue' | 'next_48h' | 'unscheduled' | 'missing_contact' | 'missing_source' | 'stale_queue';
type RadarFixType = 'set_today' | 'set_tomorrow' | 'set_fallback_source' | 'add_followup_comment' | 'open_card';

type RadarFinding = {
  id: string;
  cardId: string;
  kind: RadarKind;
  severity: RadarSeverity;
  title: string;
  detail: string;
  fixType: RadarFixType;
  fixLabel: string;
};

const severityWeight: Record<RadarSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const severityBadgeUi: Record<RadarSeverity, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-blue-100 text-blue-700 border-blue-200',
};

const severityLabel: Record<RadarSeverity, string> = {
  high: 'Hoch',
  medium: 'Mittel',
  low: 'Niedrig',
};

const isBlank = (value: unknown): boolean => typeof value !== 'string' || !value.trim();

const getDateValue = (card: ServiceCard): string | null => {
  const raw = card.values?.[CARD_PROPERTY_IDS.date];
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof card.date === 'string' && card.date.trim()) return card.date;
  return null;
};

const getCardAgeDays = (card: ServiceCard): number => {
  const updatedMs = Date.parse(card.updatedAt ?? card.createdAt ?? '');
  if (!Number.isFinite(updatedMs)) return 0;
  const diffMs = Date.now() - updatedMs;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
};

const getDaysSinceLastComment = (card: ServiceCard): number => {
  if (!Array.isArray(card.comments) || card.comments.length === 0) return Number.POSITIVE_INFINITY;
  const latestMs = card.comments.reduce((max, comment) => {
    const ts = Date.parse(comment.createdAt ?? '');
    return Number.isFinite(ts) ? Math.max(max, ts) : max;
  }, 0);
  if (!latestMs) return Number.POSITIVE_INFINITY;
  const diffMs = Date.now() - latestMs;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
};

const buildRadarFindings = (cards: ServiceCard[]): RadarFinding[] => {
  const findings: RadarFinding[] = [];

  for (const card of cards) {
    const dateValue = getDateValue(card);
    const badge = getAppointmentBadge(dateValue);
    const isDone = card.status === 'Erledigt';
    const isIntake = card.status === 'Eingang / Anfrage' || card.status === 'Warteschlange';

    if (!isDone && badge?.tone === 'overdue') {
      findings.push({
        id: `overdue:${card.id}`,
        cardId: card.id,
        kind: 'overdue',
        severity: 'high',
        title: 'Termin ueberfaellig',
        detail: `${badge.label} - ${card.title}`,
        fixType: 'set_today',
        fixLabel: 'Auf heute setzen',
      });
    }

    if (!isDone && (badge?.tone === 'today' || badge?.tone === 'tomorrow')) {
      const daysSinceComment = getDaysSinceLastComment(card);
      findings.push({
        id: `next48:${card.id}`,
        cardId: card.id,
        kind: 'next_48h',
        severity: daysSinceComment >= 2 ? 'high' : 'medium',
        title: 'Termin in den naechsten 48h',
        detail: `${badge.label} - ${card.title}`,
        fixType: 'add_followup_comment',
        fixLabel: 'Follow-up notieren',
      });
    }

    if (card.status === 'Terminiert' && !dateValue) {
      findings.push({
        id: `unscheduled:${card.id}`,
        cardId: card.id,
        kind: 'unscheduled',
        severity: 'high',
        title: 'Terminiert ohne Datum',
        detail: card.title,
        fixType: 'set_tomorrow',
        fixLabel: 'Morgen setzen',
      });
    }

    if (isIntake) {
      const missingAddress = isBlank(card.address);
      const missingPhone = isBlank(card.phone);
      if (missingAddress && missingPhone) {
        findings.push({
          id: `missing-contact:${card.id}`,
          cardId: card.id,
          kind: 'missing_contact',
          severity: 'medium',
          title: 'Kontaktangaben unvollstaendig',
          detail: `${card.title} - Adresse und Telefon fehlen`,
          fixType: 'open_card',
          fixLabel: 'Karte oeffnen',
        });
      } else if (missingAddress || missingPhone) {
        findings.push({
          id: `missing-contact-single:${card.id}`,
          cardId: card.id,
          kind: 'missing_contact',
          severity: 'low',
          title: 'Kontaktangaben nachziehen',
          detail: `${card.title} - ${missingAddress ? 'Adresse' : 'Telefon'} fehlt`,
          fixType: 'open_card',
          fixLabel: 'Karte oeffnen',
        });
      }
    }

    if (!card.sources?.length) {
      findings.push({
        id: `missing-source:${card.id}`,
        cardId: card.id,
        kind: 'missing_source',
        severity: 'medium',
        title: 'Quelle fehlt',
        detail: `${card.title} - ohne Kanal`,
        fixType: 'set_fallback_source',
        fixLabel: `Quelle = ${APP_CONFIG.defaults.fallbackSource}`,
      });
    }

    const ageDays = getCardAgeDays(card);
    if (card.status === 'Warteschlange' && card.comments.length === 0 && ageDays >= 5) {
      findings.push({
        id: `stale:${card.id}`,
        cardId: card.id,
        kind: 'stale_queue',
        severity: 'medium',
        title: 'Warteschlange ohne Rueckmeldung',
        detail: `${card.title} - seit ${ageDays} Tagen ohne Kommentar`,
        fixType: 'add_followup_comment',
        fixLabel: 'Follow-up Kommentar',
      });
    }
  }

  return findings.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity] || a.title.localeCompare(b.title));
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function OperationsRadar({ open, onClose }: Props) {
  const cardsById = useBoardStore((s) => s.cardsById);
  const openCard = useBoardStore((s) => s.openCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const updateCardValue = useBoardStore((s) => s.updateCardValue);
  const addComment = useBoardStore((s) => s.addComment);

  const [lastAutopilotMessage, setLastAutopilotMessage] = useState('');

  const cards = useMemo(
    () => Object.values(cardsById).filter((card): card is ServiceCard => Boolean(card) && !card.hiddenAt),
    [cardsById],
  );
  const findings = useMemo(() => buildRadarFindings(cards), [cards]);

  const findingStats = useMemo(
    () => ({
      high: findings.filter((entry) => entry.severity === 'high').length,
      medium: findings.filter((entry) => entry.severity === 'medium').length,
      low: findings.filter((entry) => entry.severity === 'low').length,
    }),
    [findings],
  );

  const applyFix = (finding: RadarFinding) => {
    const card = cardsById[finding.cardId];
    if (!card) return;

    if (finding.fixType === 'open_card') {
      openCard(finding.cardId);
      onClose();
      return;
    }
    if (finding.fixType === 'set_today') {
      updateCardValue(finding.cardId, CARD_PROPERTY_IDS.date, createDateInputFromTodayOffset(0));
      addComment(finding.cardId, 'Radar: Termin automatisch auf heute gesetzt.', APP_CONFIG.defaults.actorName);
      return;
    }
    if (finding.fixType === 'set_tomorrow') {
      updateCardValue(finding.cardId, CARD_PROPERTY_IDS.date, createDateInputFromTodayOffset(1));
      addComment(finding.cardId, 'Radar: Termin automatisch auf morgen gesetzt.', APP_CONFIG.defaults.actorName);
      return;
    }
    if (finding.fixType === 'set_fallback_source') {
      updateCard(finding.cardId, { sources: [APP_CONFIG.defaults.fallbackSource] });
      addComment(
        finding.cardId,
        `Radar: Quelle automatisch auf ${APP_CONFIG.defaults.fallbackSource} gesetzt.`,
        APP_CONFIG.defaults.actorName,
      );
      return;
    }
    if (finding.fixType === 'add_followup_comment') {
      addComment(finding.cardId, 'Radar: Bitte Rueckmeldung beim Kunden einholen.', APP_CONFIG.defaults.actorName);
    }
  };

  const runAutopilot = () => {
    const safeFixes = findings.filter((entry) =>
      ['set_today', 'set_tomorrow', 'set_fallback_source', 'add_followup_comment'].includes(entry.fixType),
    );
    const toApply = safeFixes.slice(0, 5);

    for (const entry of toApply) {
      applyFix(entry);
    }

    setLastAutopilotMessage(
      toApply.length
        ? `Autopilot hat ${toApply.length} sichere Korrektur(en) ausgefuehrt.`
        : 'Keine sicheren Korrekturen verfuegbar.',
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Operations Radar</h2>
            <p className="text-sm text-gray-500">Intelligente Prioritaeten und One-Click-Fixes fuer deinen Tagesbetrieb.</p>
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
            <p className="text-xs text-gray-500">Gesamt</p>
            <p className="text-lg font-semibold text-gray-900">{findings.length}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-700">Hoch</p>
            <p className="text-lg font-semibold text-red-800">{findingStats.high}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Mittel</p>
            <p className="text-lg font-semibold text-amber-800">{findingStats.medium}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs text-blue-700">Niedrig</p>
            <p className="text-lg font-semibold text-blue-800">{findingStats.low}</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runAutopilot}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100"
          >
            <Sparkles className="h-4 w-4" />
            Autopilot (sichere Fixes)
          </button>
          {lastAutopilotMessage ? <p className="text-xs text-gray-600">{lastAutopilotMessage}</p> : null}
        </div>

        {findings.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="inline-flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              Keine akuten Risiken erkannt.
            </div>
            <p className="mt-1">Das Board wirkt aktuell stabil und vollstaendig gepflegt.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {findings.map((finding) => (
              <div key={finding.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold', severityBadgeUi[finding.severity])}>
                    {finding.severity === 'high' ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : finding.severity === 'medium' ? (
                      <Clock3 className="h-3.5 w-3.5" />
                    ) : (
                      <CircleDot className="h-3.5 w-3.5" />
                    )}
                    {severityLabel[finding.severity]}
                  </span>
                  <p className="text-sm font-semibold text-gray-900">{finding.title}</p>
                </div>

                <p className="mb-2 text-sm text-gray-600">{finding.detail}</p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openCard(finding.cardId)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    Karte oeffnen
                  </button>

                  <button
                    type="button"
                    onClick={() => applyFix(finding)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    {finding.fixLabel}
                  </button>

                  {finding.kind === 'missing_contact' ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      <Phone className="h-3.5 w-3.5" />
                      Kontakt prüfen
                    </span>
                  ) : null}
                  {finding.kind === 'missing_source' ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      <MapPin className="h-3.5 w-3.5" />
                      Kanal fehlt
                    </span>
                  ) : null}
                  {finding.kind === 'next_48h' ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 text-xs text-sky-700">
                      <CalendarClock className="h-3.5 w-3.5" />
                      48h Fokus
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
