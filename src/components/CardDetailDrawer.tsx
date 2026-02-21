import type { FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { CARD_PROPERTY_IDS, DEFAULT_DATABASE_SCHEMA, RUNTIME_PROPERTY_TYPES } from '../config/database';
import { SOURCES, STATUS_ORDER, type PropertyDefinition, type Source, type Status } from '../types/board';
import { useBoardStore } from '../store/boardStore';
import { CommentTimeline } from './CommentTimeline';
import { cx } from '../utils/cx';
import { APP_CONFIG } from '../config/appConfig';
import { createDateInputFromTodayOffset, getAppointmentBadge, getQuickDateLabel } from '../utils/scheduling';
import { apiFetch } from '../utils/apiClient';

function PropertyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 md:grid-cols-[140px_1fr] md:items-center md:gap-3">
      <label className="text-sm font-medium text-gray-500">{label}</label>
      <div>{children}</div>
    </div>
  );
}

const isRuntimeProperty = (property: PropertyDefinition): boolean =>
  (RUNTIME_PROPERTY_TYPES as readonly string[]).includes(property.type);

const isLikelySourceProperty = (property: PropertyDefinition): boolean => {
  const id = property.id.toLowerCase();
  const name = property.name.toLowerCase();
  return (
    id === 'source' ||
    id.includes('quelle') ||
    id.includes('kanal') ||
    id.includes('herkunft') ||
    id.includes('eingang') ||
    name === 'source' ||
    name.includes('quelle') ||
    name.includes('kanal') ||
    name.includes('herkunft') ||
    name.includes('eingang')
  );
};

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const isLikelyTimeProperty = (property: PropertyDefinition): boolean => {
  const id = normalizeKey(property.id);
  const name = normalizeKey(property.name);
  const keywords = ['uhrzeit', 'zeit', 'time', 'beginn', 'start', 'terminzeit'];
  return keywords.some((keyword) => id.includes(keyword) || name.includes(keyword));
};

const normalizeSlotTime = (value: string): string => {
  const hhmm = /(\d{1,2}):(\d{2})/.exec(value);
  if (hhmm) {
    const hh = Number(hhmm[1]);
    const mm = Number(hhmm[2]);
    if (Number.isFinite(hh) && hh >= 0 && hh <= 23 && Number.isFinite(mm) && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  const hourOnly = /(\d{1,2})\s*uhr/i.exec(value);
  if (hourOnly) {
    const hh = Number(hourOnly[1]);
    if (Number.isFinite(hh) && hh >= 0 && hh <= 23) {
      return `${String(hh).padStart(2, '0')}:00`;
    }
  }

  return value.replace(/\s*uhr/i, '').trim();
};

type SlotSuggestion = {
  startIso: string;
  endIso: string;
  date: string;
  timeLabel: string;
  label: string;
};

export function CardDetailDrawer() {
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const card = useBoardStore((s) => (selectedCardId ? s.cardsById[selectedCardId] : null));
  const cardsById = useBoardStore((s) => s.cardsById);
  const database = useBoardStore((s) => s.database);
  const cardId = card?.id ?? null;
  const cardTitleValue = card?.values?.[CARD_PROPERTY_IDS.title];
  const cardTitle = typeof cardTitleValue === 'string' ? cardTitleValue : card?.title ?? '';

  const openCard = useBoardStore((s) => s.openCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const updateCardValue = useBoardStore((s) => s.updateCardValue);
  const moveCardToStatus = useBoardStore((s) => s.moveCardToStatus);
  const addComment = useBoardStore((s) => s.addComment);
  const hideCard = useBoardStore((s) => s.hideCard);
  const deleteCard = useBoardStore((s) => s.deleteCard);

  const [draftComment, setDraftComment] = useState('');
  const [slotSuggestions, setSlotSuggestions] = useState<SlotSuggestion[]>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const dateValueRaw = card?.values?.[CARD_PROPERTY_IDS.date];
  const dateValue = typeof dateValueRaw === 'string' || dateValueRaw === null ? dateValueRaw : card?.date ?? null;
  const appointmentBadge = getAppointmentBadge(dateValue);
  const remainingCommentChars = APP_CONFIG.project.maxCommentLength - draftComment.length;
  const scheduleHint = `Standardtermin: ${APP_CONFIG.scheduling.defaultAppointmentDurationMin} Min, Erinnerung ${APP_CONFIG.scheduling.reminderHoursBefore}h vorher.`;

  useEffect(() => {
    if (!cardId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') openCard(null);
    };

    window.addEventListener('keydown', onKeyDown);

    if (cardTitle.trim() === APP_CONFIG.defaults.newCardTitle) {
      requestAnimationFrame(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      });
    }

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cardId, cardTitle, openCard]);

  useEffect(() => {
    setSlotSuggestions([]);
    setSlotError('');
    setSlotLoading(false);
  }, [cardId]);

  const availableSources = useMemo(() => {
    const entries = new Set<string>(SOURCES);
    for (const property of database.properties ?? []) {
      if (property.type !== 'select' || !isLikelySourceProperty(property)) continue;
      for (const option of property.options ?? []) {
        const trimmed = option.trim();
        if (trimmed) entries.add(trimmed);
      }
    }
    for (const existingCard of Object.values(cardsById)) {
      for (const source of existingCard.sources ?? []) {
        if (typeof source !== 'string') continue;
        const trimmed = source.trim();
        if (trimmed) entries.add(trimmed);
      }
    }
    return Array.from(entries);
  }, [cardsById, database.properties]);

  const runtimeProperties = (database?.properties ?? DEFAULT_DATABASE_SCHEMA.properties).filter(isRuntimeProperty);
  const timeProperty = runtimeProperties.find(
    (property) =>
      property.id !== CARD_PROPERTY_IDS.date &&
      (property.type === 'text' || property.type === 'select') &&
      isLikelyTimeProperty(property),
  );

  const toggleSource = (source: Source) => {
    if (!card) return;

    const next = new Set(card.sources);
    if (next.has(source)) next.delete(source);
    else next.add(source);

    const normalized = Array.from(next) as Source[];
    updateCard(card.id, { sources: normalized.length ? normalized : [APP_CONFIG.defaults.fallbackSource] });
  };

  const addCustomSource = () => {
    if (!card) return;
    const input = window.prompt('Neue Quelle eingeben (z. B. Messenger, Post, Fax):', '');
    if (!input) return;
    const source = input.trim();
    if (!source) return;
    const normalized = source.toLowerCase();
    if (card.sources.some((entry) => entry.toLowerCase() === normalized)) return;
    updateCard(card.id, { sources: [...card.sources, source] });
  };

  const applyQuickDate = (offsetDays: number) => {
    if (!card) return;
    updateCardValue(card.id, CARD_PROPERTY_IDS.date, createDateInputFromTodayOffset(offsetDays));
  };

  const fetchSlotSuggestions = async () => {
    if (!card) return;

    setSlotLoading(true);
    setSlotError('');

    try {
      const response = await apiFetch('/api/google/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: APP_CONFIG.scheduling.timezone,
          workdayStart: APP_CONFIG.scheduling.workdayStart,
          workdayEnd: APP_CONFIG.scheduling.workdayEnd,
          durationMin: APP_CONFIG.scheduling.defaultAppointmentDurationMin,
          businessDays: APP_CONFIG.scheduling.businessDays,
          top: 3,
          fromDate: typeof dateValue === 'string' && dateValue ? dateValue : null,
        }),
      });

      const raw = await response.text();
      const parsed = (() => {
        try {
          return raw ? (JSON.parse(raw) as unknown) : null;
        } catch {
          return null;
        }
      })();

      if (!response.ok) {
        const message =
          parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
            ? (parsed as { error: string }).error
            : raw || `Google Slot-Vorschlaege fehlgeschlagen (${response.status})`;
        throw new Error(message);
      }

      const suggestionsRaw =
        parsed && typeof parsed === 'object' && Array.isArray((parsed as { suggestions?: unknown }).suggestions)
          ? ((parsed as { suggestions: unknown[] }).suggestions ?? [])
          : [];

      const normalized = suggestionsRaw
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const candidate = entry as Partial<SlotSuggestion>;
          if (typeof candidate.date !== 'string' || typeof candidate.timeLabel !== 'string') return null;
          return {
            startIso: typeof candidate.startIso === 'string' ? candidate.startIso : '',
            endIso: typeof candidate.endIso === 'string' ? candidate.endIso : '',
            date: candidate.date,
            timeLabel: candidate.timeLabel,
            label: typeof candidate.label === 'string' ? candidate.label : `${candidate.date} ${candidate.timeLabel}`,
          } satisfies SlotSuggestion;
        })
        .filter((entry): entry is SlotSuggestion => Boolean(entry));

      setSlotSuggestions(normalized);
      if (!normalized.length) {
        setSlotError('Keine freien Slots im gewaehlten Zeitraum gefunden.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Slot-Vorschlaege konnten nicht geladen werden.';
      setSlotError(message);
      setSlotSuggestions([]);
    } finally {
      setSlotLoading(false);
    }
  };

  const applySlotSuggestion = (slot: SlotSuggestion) => {
    if (!card) return;
    updateCardValue(card.id, CARD_PROPERTY_IDS.date, slot.date);
    if (timeProperty) {
      updateCardValue(card.id, timeProperty.id, normalizeSlotTime(slot.timeLabel));
    }
  };

  const submitComment = (event: FormEvent) => {
    event.preventDefault();
    if (!card) return;

    addComment(card.id, draftComment, APP_CONFIG.defaults.actorName);
    setDraftComment('');
  };

  const renderDynamicField = (property: PropertyDefinition) => {
    if (!card) return null;

    const rawValue = card.values[property.id];

    if (property.type === 'text') {
      const value = typeof rawValue === 'string' ? rawValue : '';

      return (
        <PropertyField key={property.id} label={property.name}>
          <div className="space-y-2">
            <input
              ref={property.id === CARD_PROPERTY_IDS.title ? titleInputRef : undefined}
              value={value}
              maxLength={property.id === CARD_PROPERTY_IDS.title ? APP_CONFIG.project.maxTitleLength : undefined}
              onChange={(e) => updateCardValue(card.id, property.id, e.target.value)}
              onBlur={(e) => {
                if (property.id !== CARD_PROPERTY_IDS.title) return;
                if (!e.target.value.trim()) updateCardValue(card.id, CARD_PROPERTY_IDS.title, APP_CONFIG.defaults.newCardTitle);
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder={property.name}
            />

            {property.id === CARD_PROPERTY_IDS.phone && value ? (
              <a className="text-sm text-blue-700 underline" href={`tel:${value}`}>
                {value} anrufen
              </a>
            ) : null}
          </div>
        </PropertyField>
      );
    }

    if (property.type === 'select') {
      const options = property.id === CARD_PROPERTY_IDS.status ? STATUS_ORDER : property.options ?? [];
      const rawString = typeof rawValue === 'string' ? rawValue : '';
      const hasValue = options.some((option) => option === rawString);
      const value = hasValue ? rawString : options[0] ?? '';

      return (
        <PropertyField key={property.id} label={property.name}>
          <select
            value={value}
            onChange={(e) => {
              const nextValue = e.target.value;
              if (property.id === CARD_PROPERTY_IDS.status) {
                moveCardToStatus(card.id, nextValue as Status, APP_CONFIG.defaults.actorName);
                return;
              }
              updateCardValue(card.id, property.id, nextValue);
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </PropertyField>
      );
    }

    if (property.type === 'date') {
      const value = typeof rawValue === 'string' ? rawValue : '';

      return (
        <PropertyField key={property.id} label={property.name}>
          <div className="space-y-2">
            <input
              type="date"
              value={value}
              onChange={(e) => updateCardValue(card.id, property.id, e.target.value || null)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />

            {property.id === CARD_PROPERTY_IDS.date ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {APP_CONFIG.scheduling.quickDateOffsetsDays.map((offsetDays) => (
                    <button
                      key={offsetDays}
                      type="button"
                      onClick={() => applyQuickDate(offsetDays)}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {getQuickDateLabel(offsetDays)}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => updateCardValue(card.id, CARD_PROPERTY_IDS.date, null)}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Leeren
                  </button>
                </div>

                {appointmentBadge ? (
                  <p
                    className={cx(
                      'text-xs',
                      appointmentBadge.tone === 'overdue' || appointmentBadge.tone === 'invalid'
                        ? 'font-medium text-red-700'
                        : 'text-gray-600',
                    )}
                  >
                    Terminstatus: {appointmentBadge.label}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">Kein Termin gesetzt.</p>
                )}

                {!APP_CONFIG.scheduling.allowWeekendAppointments && appointmentBadge && !appointmentBadge.isBusinessDay ? (
                  <p className="text-xs font-medium text-amber-700">Hinweis: Termin liegt am Wochenende.</p>
                ) : null}

                <p className="text-xs text-gray-500">{scheduleHint}</p>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => void fetchSlotSuggestions()}
                    disabled={slotLoading}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {slotLoading ? 'KI-Slots werden gesucht...' : 'KI-Slot-Vorschlaege'}
                  </button>

                  {slotError ? <p className="text-xs text-rose-700">{slotError}</p> : null}

                  {slotSuggestions.length ? (
                    <div className="flex flex-wrap gap-2">
                      {slotSuggestions.map((slot) => (
                        <button
                          key={`${slot.startIso}-${slot.endIso}-${slot.label}`}
                          type="button"
                          onClick={() => applySlotSuggestion(slot)}
                          className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {timeProperty ? (
                    <p className="text-xs text-gray-500">Uhrzeit wird in Feld "{timeProperty.name}" gesetzt.</p>
                  ) : (
                    <p className="text-xs text-gray-500">Kein Zeit-Feld erkannt. Vorschlaege setzen nur das Datum.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </PropertyField>
      );
    }

    return null;
  };

  return (
    <>
      <div
        className={cx(
          'fixed inset-0 z-40 bg-black/20 transition-opacity',
          card ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => openCard(null)}
        aria-hidden="true"
      />

      <aside
        className={cx(
          'fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto border-l border-gray-200 bg-white p-4 shadow-2xl transition-transform sm:p-6',
          card ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-label="Kartendetails"
      >
        {card ? (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-4xl">{cardTitle}</h2>
              <button
                type="button"
                onClick={() => openCard(null)}
                className="rounded-md border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                aria-label="Schliessen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {runtimeProperties.map((property) => renderDynamicField(property))}

              <PropertyField label="Quelle">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-3">
                    {availableSources.map((source) => {
                      const checked = card.sources.includes(source);
                      return (
                        <label key={source} className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSource(source)}
                            className="h-4 w-4"
                          />
                          <span>{source}</span>
                        </label>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={addCustomSource}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Quelle hinzufuegen
                  </button>
                </div>
              </PropertyField>
            </div>

            <section className="space-y-3 border-t border-gray-200 pt-5">
              <h3 className="text-sm font-semibold text-gray-700">Aktionen</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    hideCard(card.id);
                    openCard(null);
                  }}
                  className="min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Archivieren
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const ok = window.confirm('Diese Seite endgueltig loeschen?');
                    if (!ok) return;
                    deleteCard(card.id);
                    openCard(null);
                  }}
                  className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  Endgueltig loeschen
                </button>
              </div>
            </section>

            <section className="space-y-3 border-t border-gray-200 pt-5">
              <h3 className="text-sm font-semibold text-gray-700">Kommentare</h3>

              <CommentTimeline comments={card.comments} />

              <form onSubmit={submitComment} className="space-y-2">
                <p className="text-xs font-medium text-gray-600">Neuen Kommentar schreiben</p>
                <textarea
                  value={draftComment}
                  maxLength={APP_CONFIG.project.maxCommentLength}
                  onChange={(e) => setDraftComment(e.target.value)}
                  placeholder="Kommentar hinzufuegen..."
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Restzeichen: {remainingCommentChars}</span>
                  <button
                    type="submit"
                    className="min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Kommentar speichern
                  </button>
                </div>
              </form>
            </section>

            <section className="space-y-2 border-t border-gray-200 pt-5">
              <h3 className="text-sm font-semibold text-gray-700">Status-Verlauf</h3>
              {card.history.length === 0 ? (
                <p className="text-sm text-gray-400">Noch kein Statuswechsel.</p>
              ) : (
                <div className="space-y-2">
                  {[...card.history].reverse().map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                      <span className="font-medium">{entry.movedBy}</span>: {entry.from} {'->'} {entry.to}
                      <div className="text-xs text-gray-500">{new Date(entry.movedAt).toLocaleString('de-AT')}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </aside>
    </>
  );
}
