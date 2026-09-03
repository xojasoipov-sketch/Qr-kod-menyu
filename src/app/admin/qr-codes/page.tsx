'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import QRCode from 'qrcode';
import {
  Armchair,
  Check,
  ConciergeBell,
  Copy,
  DoorOpen,
  Download,
  Link2,
  Printer,
  ScanLine,
  UtensilsCrossed,
} from 'lucide-react';
import type { Restaurant, Table } from '@/types/database';
import { getRestaurant, getTables } from '@/lib/api';
import { useRealtime } from '@/lib/use-realtime';
import type { RealtimePayload } from '@/lib/realtime/event-bus';

const BRANCH_ID = 'branch-001';
const RESTAURANT_ID = 'rest-001';
const ROOM_ZONE = 'Alohida Xonalar';

/** Bosma varaqadagi zonalar tartibi — zal, deraza, terrasa, VIP, xonalar. */
const ZONE_ORDER = [
  'Asosiy Zal',
  'Deraza Yonida',
  'Yozgi Terrasa',
  'Bar Zonasi',
  'VIP Sekciya',
  ROOM_ZONE,
];

type FilterKey = 'barchasi' | 'stollar' | 'xonalar';

const FILTERS: { key: FilterKey; label: string; icon: React.ReactNode }[] = [
  { key: 'barchasi', label: 'Barchasi', icon: <ConciergeBell className="w-3.5 h-3.5" /> },
  { key: 'stollar', label: 'Stollar', icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
  { key: 'xonalar', label: 'Xonalar', icon: <DoorOpen className="w-3.5 h-3.5" /> },
];

/** Bosma varaqa uslublari — ekranda ko'rinmaydigan, faqat printerga mo'ljallangan qatlam. */
const PRINT_STYLES = `
.qr-print-sheet { display: none; }

@media print {
  @page {
    size: A4 portrait;
    margin: 12mm;
  }

  html,
  body {
    background: #ffffff !important;
    color: #000000 !important;
  }

  body * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Navigatsiya, yon panel va barcha tugmalar bosmada yo'q */
  aside,
  nav,
  .qr-no-print {
    display: none !important;
  }

  .qr-page {
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
    background: #ffffff !important;
    color: #000000 !important;
  }

  .qr-print-sheet {
    display: block !important;
    margin: 0 0 8mm 0;
    padding-bottom: 3mm;
    border-bottom: 0.6pt solid #111111;
    color: #000000 !important;
  }

  .qr-zone {
    margin-top: 6mm;
  }

  .qr-zone-head {
    color: #000000 !important;
    border-color: #111111 !important;
    break-after: avoid;
    page-break-after: avoid;
  }

  .qr-zone-rule {
    background: #111111 !important;
    background-image: none !important;
  }

  .qr-grid {
    display: grid !important;
    grid-template-columns: repeat(3, 1fr) !important;
    gap: 5mm !important;
  }

  .qr-card {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    background: #ffffff !important;
    border: 0.5pt solid #111111 !important;
    border-radius: 2mm !important;
    box-shadow: none !important;
    padding: 4mm !important;
    color: #000000 !important;
  }

  .qr-card-tile {
    background: #ffffff !important;
    border: 0.5pt solid #444444 !important;
    box-shadow: none !important;
    padding: 2mm !important;
  }

  .qr-card-wordmark,
  .qr-card-name,
  .qr-card-number,
  .qr-card-meta,
  .qr-card-token,
  .qr-card-hint {
    color: #000000 !important;
  }

  .qr-card-meta,
  .qr-card-hint {
    color: #333333 !important;
  }

  .qr-card-token {
    color: #444444 !important;
  }

  .qr-card-rule {
    background: #111111 !important;
    background-image: none !important;
  }

  .qr-card-number {
    background: #ffffff !important;
    border: 0.5pt solid #111111 !important;
  }
}
`;

interface ZoneGroup {
  zone: string;
  tables: Table[];
}

export default function AdminQrCodesPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('barchasi');
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [renderedCount, setRenderedCount] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<number | null>(null);

  const tablesRef = useRef<Table[]>([]);
  tablesRef.current = tables;

  // Yagona haqiqat manbai — server. Ma'lumot faqat /lib/api orqali olinadi.
  const loadTables = useCallback(async () => {
    const next = await getTables(BRANCH_ID);
    setTables(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTables(BRANCH_ID), getRestaurant(RESTAURANT_ID)])
      .then(([nextTables, nextRestaurant]) => {
        if (cancelled) return;
        setTables(nextTables);
        setRestaurant(nextRestaurant);
      })
      .catch((err: unknown) => {
        console.error("Joylar ro'yxatini yuklab bo'lmadi:", err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRealtime = useCallback(
    (payload: RealtimePayload) => {
      if (payload.type === 'TABLE_UPDATED') {
        void loadTables().catch((err: unknown) => {
          console.error("Joylarni yangilab bo'lmadi:", err);
        });
      }
    },
    [loadTables]
  );

  useRealtime({ branchId: BRANCH_ID }, handleRealtime);

  /** Faqat token yoki joylar to'plami o'zgarganda QR qayta chiziladi. */
  const qrSignature = useMemo(
    () => tables.map((t) => `${t.id}:${t.qr_token}`).join('|'),
    [tables]
  );

  // 50 ta QR kod partiyalab chiziladi — brauzer oqimi bloklanmaydi.
  useEffect(() => {
    const list = tablesRef.current;
    if (list.length === 0) {
      setQrMap({});
      setRenderedCount(0);
      return;
    }

    let cancelled = false;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const collected: Record<string, string> = {};
    const BATCH_SIZE = 5;

    setQrMap({});
    setRenderedCount(0);

    const run = async () => {
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = list.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (table): Promise<[string, string]> => {
            try {
              const dataUrl = await QRCode.toDataURL(`${origin}/t/${table.qr_token}`, {
                width: 512,
                margin: 1,
                color: { dark: '#0C0A09', light: '#FFFFFF' },
              });
              return [table.id, dataUrl];
            } catch (err: unknown) {
              console.error(`QR kod chizilmadi (${table.qr_token}):`, err);
              return [table.id, ''];
            }
          })
        );
        if (cancelled) return;
        for (const [id, dataUrl] of results) {
          if (dataUrl) collected[id] = dataUrl;
        }
        setQrMap({ ...collected });
        setRenderedCount(Math.min(i + BATCH_SIZE, list.length));
        // Brauzerga nafas olish uchun vaqt beramiz.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [qrSignature]);

  const roomTables = useMemo(() => tables.filter((t) => t.zone === ROOM_ZONE), [tables]);
  const hallTables = useMemo(() => tables.filter((t) => t.zone !== ROOM_ZONE), [tables]);
  const totalSeats = useMemo(
    () => tables.reduce((sum, t) => sum + (t.capacity ?? 0), 0),
    [tables]
  );

  const visibleTables = useMemo(() => {
    if (filter === 'stollar') return hallTables;
    if (filter === 'xonalar') return roomTables;
    return tables;
  }, [filter, hallTables, roomTables, tables]);

  const zoneGroups = useMemo<ZoneGroup[]>(() => {
    const buckets = new Map<string, Table[]>();
    for (const table of visibleTables) {
      const zone = table.zone ?? 'Boshqa Joylar';
      const bucket = buckets.get(zone);
      if (bucket) bucket.push(table);
      else buckets.set(zone, [table]);
    }

    return Array.from(buckets.entries())
      .map(([zone, list]) => ({
        zone,
        tables: [...list].sort((a, b) => a.number - b.number),
      }))
      .sort((a, b) => {
        const ai = ZONE_ORDER.indexOf(a.zone);
        const bi = ZONE_ORDER.indexOf(b.zone);
        if (ai === -1 && bi === -1) return a.zone.localeCompare(b.zone, 'uz');
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
  }, [visibleTables]);

  const venueName = restaurant?.name ?? 'Muhtasham Restorani';
  const isRendering = tables.length > 0 && renderedCount < tables.length;

  const downloadPng = useCallback((table: Table, dataUrl: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `qr-${table.qr_token}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleCopyLink = useCallback(async (table: Table) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    try {
      await navigator.clipboard.writeText(`${origin}/t/${table.qr_token}`);
      setCopiedId(table.id);
      setTimeout(() => setCopiedId((prev) => (prev === table.id ? null : prev)), 2000);
    } catch (err: unknown) {
      console.error("Havolani ko'chirib bo'lmadi:", err);
    }
  }, []);

  const handleDownloadAll = useCallback(async () => {
    const ready = visibleTables.filter((t) => qrMap[t.id]);
    if (ready.length === 0) return;

    setBulkProgress(0);
    for (let i = 0; i < ready.length; i += 1) {
      const table = ready[i];
      const dataUrl = qrMap[table.id];
      if (dataUrl) downloadPng(table, dataUrl);
      setBulkProgress(i + 1);
      // Brauzer yuklab olishlarni ketma-ket qabul qilishi uchun kichik pauza.
      await new Promise<void>((resolve) => setTimeout(resolve, 220));
    }
    setTimeout(() => setBulkProgress(null), 1200);
  }, [downloadPng, qrMap, visibleTables]);

  return (
    <div className="qr-page p-6 max-w-7xl mx-auto space-y-7">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Faqat bosmada chiqadigan varaqa sarlavhasi */}
      <div className="qr-print-sheet">
        <div className="text-[10px] uppercase tracking-[0.3em]">{venueName}</div>
        <div className="font-serif text-lg mt-1">Stol va Xona QR Kodlari</div>
        <div className="text-[10px] mt-1">
          {hallTables.length} ta stol · {roomTables.length} ta xona · {totalSeats} o&apos;rin
        </div>
      </div>

      {/* Sarlavha */}
      <header className="qr-no-print flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-5 border-b border-surface-border">
        <div>
          <div className="flex items-center gap-2 text-gold-500/80">
            <ScanLine className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">
              Bosmaga tayyor varaqa
            </span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl text-stone-50 mt-2">
            QR Kodlar Varaqasi
          </h1>
          <p className="text-xs text-stone-400 mt-1.5 max-w-xl leading-relaxed">
            Har bir stol va xona uchun alohida QR kartochka. Bir marta chop eting, kesib oling
            va joyiga qo&apos;ying — mehmon kodni skanerlab menyuni ochadi.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => window.print()}
            className="px-4 py-2.5 rounded-xl bg-gold-500/10 text-gold-200 border border-gold-500/30 text-xs font-semibold hover:bg-gold-500/15 transition-colors flex items-center gap-2"
          >
            <Printer className="w-4 h-4 text-gold-400" />
            <span>Barchasini chop etish</span>
          </button>

          <button
            onClick={() => void handleDownloadAll()}
            disabled={isRendering || bulkProgress !== null}
            className="px-4 py-2.5 rounded-xl bg-surface-100 text-stone-200 border border-surface-border text-xs font-semibold hover:border-gold-500/40 hover:text-stone-50 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4 text-stone-400" />
            <span>
              {bulkProgress !== null
                ? `Yuklanmoqda — ${bulkProgress}/${visibleTables.length}`
                : "Hammasini PNG'da saqlash"}
            </span>
          </button>
        </div>
      </header>

      {/* Qisqa hisobot */}
      <div className="qr-no-print grid grid-cols-3 rounded-2xl border border-surface-border bg-surface-100 divide-x divide-surface-border shadow-luxury overflow-hidden">
        <SummaryCell
          icon={<UtensilsCrossed className="w-4 h-4 text-gold-500/80" />}
          label="Stollar"
          value={hallTables.length}
        />
        <SummaryCell
          icon={<DoorOpen className="w-4 h-4 text-gold-500/80" />}
          label="Alohida xonalar"
          value={roomTables.length}
        />
        <SummaryCell
          icon={<Armchair className="w-4 h-4 text-gold-500/80" />}
          label="Umumiy o'rin"
          value={totalSeats}
        />
      </div>

      {/* Filtrlar + holat qatori */}
      <div className="qr-no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {FILTERS.map((tab) => {
            const isActive = filter === tab.key;
            const count =
              tab.key === 'stollar'
                ? hallTables.length
                : tab.key === 'xonalar'
                  ? roomTables.length
                  : tables.length;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-2 ${
                  isActive
                    ? 'bg-gold-500/10 text-gold-200 border-gold-500/40'
                    : 'bg-surface-100 text-stone-400 border-surface-border hover:text-stone-200'
                }`}
              >
                <span className={isActive ? 'text-gold-400' : 'text-stone-500'}>{tab.icon}</span>
                <span>{tab.label}</span>
                <span className="font-mono text-[10px] text-stone-500">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="text-[11px] text-stone-500 font-medium">
          {isLoading
            ? 'Joylar yuklanmoqda…'
            : isRendering
              ? `QR kodlar chizilmoqda — ${renderedCount} / ${tables.length}`
              : `${tables.length} ta QR kod chop etishga tayyor`}
        </div>
      </div>

      {/* Zonalar */}
      <div className="space-y-10">
        {zoneGroups.map((group) => (
          <section key={group.zone} className="qr-zone space-y-4">
            <div className="qr-zone-head flex items-baseline justify-between gap-4 border-b border-surface-border pb-2">
              <h2 className="font-serif text-lg text-stone-100">{group.zone}</h2>
              <span className="text-[10px] uppercase tracking-wider text-stone-500">
                {group.tables.length} ta joy
              </span>
            </div>
            <div className="qr-zone-rule h-px w-24 bg-gradient-to-r from-gold-500/70 to-transparent -mt-3" />

            <div className="qr-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {group.tables.map((table) => (
                <QrPlaceCard
                  key={table.id}
                  table={table}
                  venueName={venueName}
                  dataUrl={qrMap[table.id]}
                  copied={copiedId === table.id}
                  onCopy={() => void handleCopyLink(table)}
                  onDownload={() => {
                    const dataUrl = qrMap[table.id];
                    if (dataUrl) downloadPng(table, dataUrl);
                  }}
                />
              ))}
            </div>
          </section>
        ))}

        {!isLoading && zoneGroups.length === 0 && (
          <div className="qr-no-print rounded-2xl border border-surface-border bg-surface-100 p-10 text-center">
            <ScanLine className="w-5 h-5 text-stone-600 mx-auto" />
            <p className="text-xs text-stone-400 mt-3">
              Bu tanlov bo&apos;yicha joy topilmadi.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="px-5 py-4 flex items-center gap-3">
      {icon}
      <div>
        <div className="font-serif text-xl text-stone-50 leading-none">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-stone-500 mt-1.5">{label}</div>
      </div>
    </div>
  );
}

function QrPlaceCard({
  table,
  venueName,
  dataUrl,
  copied,
  onCopy,
  onDownload,
}: {
  table: Table;
  venueName: string;
  dataUrl?: string;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const isRoom = table.zone === ROOM_ZONE;

  return (
    <motion.article
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="qr-card rounded-2xl border border-surface-border bg-surface-100 p-4 shadow-luxury flex flex-col gap-3"
    >
      {/* Muassasa nomi — bosilgan kartochka restoranga tegishli ekanini bildiradi */}
      <div className="flex items-center justify-between gap-2">
        <span className="qr-card-wordmark text-[9px] uppercase tracking-[0.22em] text-gold-600/90 truncate">
          {venueName}
        </span>
        <span className="qr-card-number shrink-0 font-serif text-[11px] text-gold-300 border border-gold-500/30 rounded-md px-1.5 py-0.5 leading-none">
          {isRoom ? 'X' : 'S'}
          {String(table.number).padStart(2, '0')}
        </span>
      </div>
      <div className="qr-card-rule h-px w-full bg-gradient-to-r from-gold-500/40 via-gold-500/10 to-transparent" />

      {/* QR oq plitkada — skanerlanishi uchun to'q rang och fonda bo'lishi shart */}
      <div className="qr-card-tile bg-white rounded-xl p-3 flex items-center justify-center aspect-square">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={`${table.name} uchun QR kod`}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-[10px] text-stone-400 font-medium">Tayyorlanmoqda…</span>
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="qr-card-name font-serif text-base text-stone-50 leading-tight">
          {table.name}
        </h3>
        <div className="qr-card-meta flex items-center gap-2 text-[11px] text-stone-400">
          <span>{table.zone ?? 'Asosiy Zal'}</span>
          <span className="text-stone-600">·</span>
          <span className="flex items-center gap-1">
            <Armchair className="w-3.5 h-3.5 text-stone-500" />
            {table.capacity ?? 0} kishi
          </span>
        </div>
        <div className="qr-card-token font-mono text-[10px] text-stone-500">{table.qr_token}</div>
        <p className="qr-card-hint text-[10px] text-stone-500 leading-relaxed pt-1">
          Menyuni ochish uchun kodni telefon kamerasida skanerlang.
        </p>
      </div>

      <div className="qr-no-print flex items-center gap-2 pt-1 mt-auto">
        <button
          onClick={onDownload}
          disabled={!dataUrl}
          className="flex-1 px-2.5 py-2 rounded-lg bg-surface-200/60 text-stone-300 border border-surface-border text-[11px] font-semibold hover:text-stone-50 hover:border-gold-500/40 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5 text-stone-500" />
          <span>PNG</span>
        </button>
        <button
          onClick={onCopy}
          className="flex-1 px-2.5 py-2 rounded-lg bg-surface-200/60 text-stone-300 border border-surface-border text-[11px] font-semibold hover:text-stone-50 hover:border-gold-500/40 transition-colors flex items-center justify-center gap-1.5"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-gold-400" />
              <span>Ko&apos;chirildi</span>
            </>
          ) : (
            <>
              <Link2 className="w-3.5 h-3.5 text-stone-500" />
              <span>Havola</span>
            </>
          )}
        </button>
      </div>
    </motion.article>
  );
}
